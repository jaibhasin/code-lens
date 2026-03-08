"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Room, Language } from "@/lib/store";
import { MonacoWithYjs } from "@/components/MonacoWithYjs";

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const roleFromUrl = searchParams.get("role") === "interviewer" ? "interviewer" : "candidate";
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role] = useState<"interviewer" | "candidate">(roleFromUrl);

  useEffect(() => {
    fetch(`/api/rooms/${roomId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Room not found"))))
      .then(setRoom)
      .catch(() => setError("Room not found"));
  }, [roomId]);

  const markActive = async () => {
    await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    setRoom((r) => (r ? { ...r, status: "active" } : null));
  };

  const setLanguage = async (language: Language) => {
    await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    });
    setRoom((r) => (r ? { ...r, language } : null));
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
      <header className="border-b border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0">
        <span className="font-mono text-sm text-zinc-400">Room {roomId}</span>
        <div className="flex items-center gap-4">
          <select
            value={room.language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="rounded bg-zinc-800 px-2 py-1 text-sm border border-zinc-600"
          >
            <option value="c">C</option>
            <option value="cpp">C++</option>
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
          </select>
          <span className="text-sm text-zinc-400 capitalize">{role}</span>
          {room.status === "waiting" && role === "interviewer" && (
            <button
              onClick={markActive}
              className="rounded bg-amber-500 px-3 py-1 text-zinc-950 text-sm font-medium"
            >
              Start session
            </button>
          )}
        </div>
      </header>
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 p-4">
        <div className="flex flex-col rounded-lg border border-zinc-700 bg-zinc-900/50 overflow-hidden">
          <h2 className="text-sm font-medium text-zinc-400 px-3 py-2 border-b border-zinc-700 shrink-0">
            Code
          </h2>
          <div className="flex-1 min-h-0">
            <MonacoWithYjs roomId={roomId} language={room.language} height="100%" />
          </div>
        </div>
        <div className="flex flex-col rounded-lg border border-zinc-700 bg-zinc-900/50 overflow-hidden">
          <h2 className="text-sm font-medium text-zinc-400 px-3 py-2 border-b border-zinc-700 shrink-0">
            Problem
          </h2>
          <div className="flex-1 overflow-auto p-4">
            <h3 className="font-medium text-lg">{room.problem.title || "Untitled"}</h3>
            <div className="mt-2 text-sm text-zinc-300 whitespace-pre-wrap">
              {room.problem.description || "No description."}
            </div>
            {room.problem.examples.length > 0 && (
              <div className="mt-4">
                <h4 className="text-zinc-400 font-medium mb-2">Examples</h4>
                {room.problem.examples.map((ex, i) => (
                  <div key={i} className="mb-3 p-2 rounded bg-zinc-800/50 text-sm">
                    <p><span className="text-zinc-500">Input:</span> {ex.input}</p>
                    <p><span className="text-zinc-500">Output:</span> {ex.output}</p>
                    {ex.explanation && <p className="text-zinc-500">{ex.explanation}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
