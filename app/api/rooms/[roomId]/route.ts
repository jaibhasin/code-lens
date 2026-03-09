import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/store";
import type { Problem, TimelineEvent } from "@/lib/store";
import { generateDebrief } from "@/lib/ai-debrief";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const room = getRoom(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  return NextResponse.json(room);
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
      try {
        room.debrief = await generateDebrief(room);
      } catch (err) {
        room.debrief = {
          error: (err as Error).message,
          summary: "Debrief generation failed.",
        };
      }
    }
  }
  if (body.code !== undefined && body.status !== "ended") {
    room.code = body.code;
  }
  if (body.debrief !== undefined) {
    room.debrief = body.debrief;
  }
  if (body.interviewerCompany !== undefined) {
    room.interviewerCompany = body.interviewerCompany;
  }
  if (body.candidateName !== undefined) {
    room.candidateName = body.candidateName;
  }

  return NextResponse.json(room);
}
