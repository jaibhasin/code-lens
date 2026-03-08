"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Room } from "@/lib/store";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234";

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const roleFromUrl = searchParams.get("role") === "interviewer" ? "interviewer" : "candidate";
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role] = useState<"interviewer" | "candidate">(roleFromUrl);
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    fetch(`/api/rooms/${roomId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Room not found"))))
      .then(setRoom)
      .catch(() => setError("Room not found"));
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    const socket = new WebSocket(WS_URL);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "join", roomId, role }));
      setWs(socket);
    };
    return () => {
      socket.close();
      setWs(null);
    };
  }, [roomId, role]);

  const markActive = async () => {
    await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    setRoom((r) => (r ? { ...r, status: "active" } : null));
  };

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-red-400">{error}</p>
      </main>
    );
  }
  if (!room) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading room…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <span className="font-mono text-sm text-zinc-400">Room {roomId}</span>
        <div className="flex gap-2">
          <span className="text-sm text-zinc-400 capitalize">{role}</span>
          {room.status === "waiting" && (
            <button
              onClick={markActive}
              className="rounded bg-amber-500 px-3 py-1 text-zinc-950 text-sm font-medium"
            >
              Start session
            </button>
          )}
        </div>
      </header>
      <div className="flex-1 p-4 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <h2 className="text-sm font-medium text-zinc-400 mb-2">Code editor</h2>
          <p className="text-zinc-500 text-sm">Monaco editor will go here (Phase 2)</p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <h2 className="text-sm font-medium text-zinc-400 mb-2">Problem</h2>
          <h3 className="font-medium">{room.problem.title || "Untitled"}</h3>
          <div className="mt-2 text-sm text-zinc-300 whitespace-pre-wrap">
            {room.problem.description || "No description."}
          </div>
        </div>
      </div>
    </main>
  );
}
