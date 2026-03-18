import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/store";
import type { Problem, TimelineEvent, CodeSnapshot, GazeSample, GazeZone } from "@/lib/store";
import { generateDebrief } from "@/lib/ai-debrief";

const MAX_GAZE_SAMPLES = 15_000;
const VALID_GAZE_ZONES = new Set<GazeZone>([
  "on_screen", "off_left", "off_right", "off_top", "off_bottom", "unknown",
]);

function isValidGazeSample(s: unknown): s is GazeSample {
  if (typeof s !== "object" || s === null) return false;
  const obj = s as Record<string, unknown>;
  return (
    typeof obj.ts === "number" &&
    typeof obj.x === "number" &&
    typeof obj.y === "number" &&
    typeof obj.conf === "number" &&
    typeof obj.zone === "string" &&
    VALID_GAZE_ZONES.has(obj.zone as GazeZone)
  );
}

function appendGazeSamples(room: { gazeSamples: GazeSample[] }, raw: unknown[]) {
  const budget = Math.max(0, MAX_GAZE_SAMPLES - room.gazeSamples.length);
  if (budget === 0) return;
  const valid = raw.filter(isValidGazeSample).slice(0, budget);
  if (valid.length > 0) room.gazeSamples.push(...valid);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = getRoom(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  return NextResponse.json(room);
}

/**
 * POST handler — used exclusively by navigator.sendBeacon() which can only
 * send POST requests. Accepts the same gazeSamples payload as PATCH.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = getRoom(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const body = await req.json();

  if (body.gazeSamples && Array.isArray(body.gazeSamples)) {
    appendGazeSamples(room, body.gazeSamples);
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = getRoom(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const body = await req.json();

  if (body.problem !== undefined) {
    room.problem = body.problem as Problem;
  }
  if (body.language !== undefined) {
    room.language = body.language;
  }
  if (body.timelineEvent !== undefined) {
    const ev = body.timelineEvent as TimelineEvent;
    if (ev.timestamp && ev.event) {
      room.timeline.push(ev);
    }
  }
  if (body.status !== undefined) {
    room.status = body.status;
    if (body.status === "active" && !room.startedAt) {
      room.startedAt = Date.now();
    }
    if (body.status === "ended") {
      room.endedAt = Date.now();
      if (body.code !== undefined) {
        room.code = body.code;
      }
      // Set a placeholder status so the debrief page knows generation is in progress.
      // Run the actual AI generation in the background — don't block the PATCH response.
      room.debrief = { status: "generating" };
      generateDebrief(room)
        .then((d) => { room.debrief = d; })
        .catch((err) => {
          room.debrief = {
            error: (err as Error).message,
            summary: "Debrief generation failed.",
          };
        });
    }
  }
  if (body.code !== undefined && body.status !== "ended") {
    room.code = body.code;
  }
  if (body.debrief !== undefined) {
    room.debrief = body.debrief;
  }
  if (body.snapshot !== undefined) {
    const snap = body.snapshot as CodeSnapshot;
    if (snap.timestamp && snap.code !== undefined && room.snapshots.length < 60) {
      room.snapshots.push(snap);
    }
  }
  if (body.interviewerCompany !== undefined) {
    room.interviewerCompany = body.interviewerCompany;
  }
  if (body.candidateName !== undefined) {
    room.candidateName = body.candidateName;
  }
  if (body.candidateFinished) {
    room.candidateFinishedAt = Date.now();
    if (body.code !== undefined) {
      room.code = body.code;
    }
  }
  if (body.gazeSamples && Array.isArray(body.gazeSamples)) {
    appendGazeSamples(room, body.gazeSamples);
  }
  if (body.gazeCalibrated !== undefined) {
    room.gazeCalibrated = body.gazeCalibrated;
  }

  const hasGazeBatch = body.gazeSamples && Array.isArray(body.gazeSamples);
  if (hasGazeBatch) {
    return NextResponse.json({
      ok: true,
      gazeSampleCount: room.gazeSamples.length,
    });
  }
  return NextResponse.json(room);
}
