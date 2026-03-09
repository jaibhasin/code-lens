"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Room } from "@/lib/store";

export default function DebriefPage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    // Poll every 3 s until the debrief field is populated.
    // We navigate here immediately when End Session is clicked (before the
    // OpenAI call finishes), so we need to wait for the server to finish.
    const load = async () => {
      const r = await fetch(`/api/rooms/${roomId}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      if (!r) return;
      setRoom(r);
      if (r.debrief) clearInterval(id); // stop once debrief arrives
    };

    const id = setInterval(load, 3000);
    load(); // immediate first load
    return () => clearInterval(id);
  }, [roomId]);

  if (!room || !room.debrief) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-3">
        <svg className="animate-spin w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <p className="text-zinc-400">Generating debrief…</p>
      </main>
    );
  }

  const debrief = room.debrief as Record<string, string> | null | undefined;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">Session debrief</h1>
      <p className="text-zinc-400 mt-1">Room {roomId}</p>
      {room.problem.title && (
        <p className="text-zinc-500 text-sm mt-1">Problem: {room.problem.title}</p>
      )}

      {debrief && typeof debrief === "object" && !debrief.error ? (
        <div className="mt-8 space-y-6">
          {debrief.summary && (
            <section>
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Summary</h2>
              <p className="mt-2 text-zinc-200 leading-relaxed">{debrief.summary}</p>
            </section>
          )}
          {debrief.approach_analysis && (
            <section>
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Approach</h2>
              <p className="mt-2 text-zinc-300 text-sm whitespace-pre-wrap">{debrief.approach_analysis}</p>
            </section>
          )}
          {debrief.problem_solving_behavior && (
            <section>
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Problem-solving</h2>
              <p className="mt-2 text-zinc-300 text-sm whitespace-pre-wrap">{debrief.problem_solving_behavior}</p>
            </section>
          )}
          {debrief.code_quality && (
            <section>
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Code quality</h2>
              <p className="mt-2 text-zinc-300 text-sm whitespace-pre-wrap">{debrief.code_quality}</p>
            </section>
          )}
          {debrief.time_breakdown && (
            <section>
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Time breakdown</h2>
              <p className="mt-2 text-zinc-300 text-sm whitespace-pre-wrap">{debrief.time_breakdown}</p>
            </section>
          )}
          {debrief.final_signal && (
            <section className="pt-4 border-t border-zinc-800">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Signal</h2>
              <p className="mt-2 font-medium text-amber-400">{String(debrief.final_signal)}</p>
              {debrief.reasoning && (
                <p className="mt-1 text-zinc-300 text-sm">{String(debrief.reasoning)}</p>
              )}
            </section>
          )}
        </div>
      ) : (
        <div className="mt-8">
          {debrief?.error ? (
            <p className="text-amber-500">{debrief.error}</p>
          ) : (
            <p className="text-zinc-500">No debrief generated yet.</p>
          )}
        </div>
      )}

      <p className="mt-12 text-zinc-500 text-sm">Share this URL to let others view the debrief.</p>
    </main>
  );
}
