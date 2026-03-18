import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/store";
import type { Problem, TimelineEvent, CodeSnapshot, GazeSample, GazeZone, GazePlaneModel } from "@/lib/store";
import { generateDebrief } from "@/lib/ai-debrief";

const MAX_GAZE_SAMPLES = 15_000;
const VALID_GAZE_ZONES = new Set<GazeZone>([
  "on_screen", "off_left", "off_right", "off_top", "off_bottom", "unknown",
]);

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function isValidGazeSampleShape(s: unknown): s is Record<string, unknown> {
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

function normalizeGazeSample(s: unknown): GazeSample | null {
  if (!isValidGazeSampleShape(s)) return null;

  const obj = s as Record<string, unknown>;
  const x = obj.x as number;
  const y = obj.y as number;
  const rawX = typeof obj.rawX === "number" ? obj.rawX : x;
  const rawY = typeof obj.rawY === "number" ? obj.rawY : y;
  const planeX = typeof obj.planeX === "number" ? clamp(obj.planeX, 0, 1) : clamp(x, 0, 1);
  const planeY = typeof obj.planeY === "number" ? clamp(obj.planeY, 0, 1) : clamp(y, 0, 1);

  return {
    ts: obj.ts as number,
    x,
    y,
    rawX,
    rawY,
    planeX,
    planeY,
    insideScreen: typeof obj.insideScreen === "boolean" ? obj.insideScreen : obj.zone === "on_screen",
    clamped: typeof obj.clamped === "boolean" ? obj.clamped : false,
    zone: obj.zone as GazeZone,
    conf: obj.conf as number,
  };
}

function isValidPlaneRect(rect: unknown): boolean {
  if (typeof rect !== "object" || rect === null) return false;
  const obj = rect as Record<string, unknown>;
  return (
    typeof obj.left === "number" &&
    typeof obj.top === "number" &&
    typeof obj.right === "number" &&
    typeof obj.bottom === "number"
  );
}

function isValidGazePlaneModel(model: unknown): model is GazePlaneModel {
  if (typeof model !== "object" || model === null) return false;
  const obj = model as Record<string, unknown>;
  if (!isValidPlaneRect(obj.screenRect) || !isValidPlaneRect(obj.outerRect) || !isValidPlaneRect(obj.screenRectInPlane)) {
    return false;
  }
  if (typeof obj.quality !== "object" || obj.quality === null) return false;
  const quality = obj.quality as Record<string, unknown>;
  return (
    typeof quality.validationErrorPx === "number" &&
    (quality.label === "good" || quality.label === "low") &&
    (quality.source === "observed_fit" || quality.source === "approximate_fallback") &&
    typeof quality.observedPointCount === "number"
  );
}

function appendGazeSamples(room: { gazeSamples: GazeSample[] }, raw: unknown[]) {
  const budget = Math.max(0, MAX_GAZE_SAMPLES - room.gazeSamples.length);
  if (budget === 0) return;
  const valid = raw.map(normalizeGazeSample).filter((sample): sample is GazeSample => sample !== null).slice(0, budget);
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
  if (body.gazePlaneModel !== undefined && isValidGazePlaneModel(body.gazePlaneModel)) {
    room.gazePlaneModel = body.gazePlaneModel;
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
  if (body.gazePlaneModel !== undefined && isValidGazePlaneModel(body.gazePlaneModel)) {
    room.gazePlaneModel = body.gazePlaneModel;
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
