import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createRoom } from "@/lib/store";

export async function POST() {
  const roomId = nanoid(10);
  createRoom(roomId);
  return NextResponse.json({ roomId });
}
