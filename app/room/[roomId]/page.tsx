"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room, Language } from "@/lib/store";
import type { TestResult } from "@/lib/store";
import { MonacoWithYjs, type MonacoWithYjsHandle } from "@/components/MonacoWithYjs";

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const roleFromUrl = searchParams.get("role") === "interviewer" ? "interviewer" : "candidate";
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role] = useState<"interviewer" | "candidate">(roleFromUrl);
  const [runResults, setRunResults] = useState<TestResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const editorRef = useRef<MonacoWithYjsHandle>(null);
  const router = useRouter();

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

  const endSession = async () => {
    await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ended" }),
    });
    router.push(`/room/${roomId}/debrief`);
  };

  const setLanguage = async (language: Language) => {
    await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    });
    setRoom((r) => (r ? { ...r, language } : null));
  };

  const runTests = useCallback(
    async (includeHidden: boolean) => {
      const code = editorRef.current?.getCode() ?? "";
      if (!room) return;
      setRunning(true);
      try {
        const visibleTests = room.problem.examples.map((ex) => ({
          input: ex.input,
          expectedOutput: ex.output,
        }));
        const hiddenTests = room.problem.hiddenTests.map((t) => ({
          input: t.input,
          expectedOutput: t.expectedOutput,
        }));
        const testCases = includeHidden ? [...visibleTests, ...hiddenTests] : visibleTests;
        const res = await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            language: room.language,
            testCases,
            roomId,
            isSubmit: includeHidden,
          }),
        });
        const data = await res.json();
        if (data.results) setRunResults(data.results);
        if (roomId) {
          const r = await fetch(`/api/rooms/${roomId}`).then((x) => x.json());
          setRoom(r);
        }
      } finally {
        setRunning(false);
      }
    },
    [room, roomId]
  );

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
          <button
            onClick={() => runTests(false)}
            disabled={running}
            className="rounded bg-emerald-600 px-3 py-1 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            {running ? "Running…" : "Run"}
          </button>
          <button
            onClick={() => runTests(true)}
            disabled={running}
            className="rounded bg-blue-600 px-3 py-1 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            Submit
          </button>
          <span className="text-sm text-zinc-400 capitalize">{role}</span>
          {room.status === "waiting" && role === "interviewer" && (
            <button
              onClick={markActive}
              className="rounded bg-amber-500 px-3 py-1 text-zinc-950 text-sm font-medium"
            >
              Start session
            </button>
          )}
          {room.status !== "waiting" && room.status !== "ended" && role === "interviewer" && (
            <button
              onClick={endSession}
              className="rounded bg-red-600 px-3 py-1 text-white text-sm font-medium hover:bg-red-500"
            >
              End session
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
            <MonacoWithYjs
              ref={editorRef}
              roomId={roomId}
              language={room.language}
              height="100%"
            />
          </div>
        </div>
        <div className="flex flex-col rounded-lg border border-zinc-700 bg-zinc-900/50 overflow-hidden">
          <h2 className="text-sm font-medium text-zinc-400 px-3 py-2 border-b border-zinc-700 shrink-0">
            Problem
          </h2>
          <div className="flex-1 min-h-0 overflow-auto flex flex-col">
            <div className="p-4 shrink-0">
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
            <div className="border-t border-zinc-700 flex-1 min-h-0 flex flex-col">
              <h4 className="text-zinc-400 font-medium px-3 py-2 shrink-0">Test results</h4>
              <div className="flex-1 overflow-auto px-3 pb-3">
                {runResults === null || runResults.length === 0 ? (
                  <p className="text-zinc-500 text-sm">Run or submit to see results.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-zinc-700">
                        <th className="py-1 pr-2">#</th>
                        <th className="py-1 pr-2">Status</th>
                        <th className="py-1">Input / Expected / Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runResults.map((tr, i) => (
                        <tr key={i} className="border-b border-zinc-800">
                          <td className="py-2 pr-2 align-top">{i + 1}</td>
                          <td className="py-2 pr-2 align-top">
                            <span
                              className={
                                tr.status === "passed"
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }
                            >
                              {tr.status}
                            </span>
                          </td>
                          <td className="py-2 align-top break-all">
                            <p className="text-zinc-500">In: {tr.input}</p>
                            <p className="text-zinc-400">Exp: {tr.expectedOutput}</p>
                            <p className="text-zinc-300">Got: {tr.actualOutput}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
