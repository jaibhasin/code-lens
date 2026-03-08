import { NextRequest, NextResponse } from "next/server";
import { getRoom, updateRoom } from "@/lib/store";
import type { Problem } from "@/lib/store";

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
  if (body.status !== undefined) {
    room.status = body.status;
    if (body.status === "active" && !room.startedAt) {
      room.startedAt = Date.now();
    }
    if (body.status === "ended") {
      room.endedAt = Date.now();
    }
  }
  if (body.code !== undefined) {
    room.code = body.code;
  }
  if (body.debrief !== undefined) {
    room.debrief = body.debrief;
  }

  return NextResponse.json(room);
}
