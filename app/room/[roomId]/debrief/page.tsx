"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Room } from "@/lib/store";

export default function DebriefPage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    fetch(`/api/rooms/${roomId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Not found"))))
      .then(setRoom)
      .catch(() => setRoom(null));
  }, [roomId]);

  if (!room) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">Session debrief</h1>
      <p className="text-zinc-400 mt-1">Room {roomId}</p>
      {room.debrief ? (
        <pre className="mt-6 p-4 rounded bg-zinc-800 text-sm whitespace-pre-wrap">
          {JSON.stringify(room.debrief, null, 2)}
        </pre>
      ) : (
        <p className="mt-6 text-zinc-500">No debrief generated yet.</p>
      )}
    </main>
  );
}
