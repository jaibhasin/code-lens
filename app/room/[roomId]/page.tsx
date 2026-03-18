"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room, Language, GazePlaneModel } from "@/lib/store";
import type { TestResult } from "@/lib/store";
import dynamic from "next/dynamic";
import type { MonacoWithYjsHandle, AwarenessPeer } from "@/components/MonacoWithYjs";
import { useGazeTracker } from "@/hooks/useGazeTracker";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/room/[roomId]/page.tsx — Interview Room
 *
 * The main collaborative coding environment. Two-panel layout:
 *   Left: Monaco editor with Yjs CRDT sync
 *   Right: Problem description + test results
 *
 * GLASSMORPHISM HIGHLIGHTS:
 *   - Header: frosted glass bar (bg-white/[0.03] backdrop-blur-xl)
 *   - Header buttons: matching accent glow (Run=emerald, Submit=blue, Start=amber, End=red)
 *   - Presence dots: neon glow when active (shadow-[0_0_6px])
 *   - Editor/Problem panels: .glass containers
 *   - Panel headers: bg-white/[0.02] border-b border-white/[0.06]
 *   - Waiting overlay: bg-black/60 backdrop-blur-md + amber glow on Start button
 *   - Fullscreen warning: glass card with red glow + pulsing warning icon
 *   - Name gate: glass card wrapper with amber-glowing input + button
 *   - Examples blocks: bg-white/[0.03] border-white/[0.06]
 * ─────────────────────────────────────────────────────────────────────────────
 */

/*
 * y-monaco touches `window` at module-evaluation time, which crashes
 * Next.js SSR. Dynamically importing with ssr:false ensures the module
 * is only ever loaded in the browser.
 */
const MonacoWithYjs = dynamic(
  () => import("@/components/MonacoWithYjs").then((m) => m.MonacoWithYjs),
  { ssr: false }
) as typeof import("@/components/MonacoWithYjs").MonacoWithYjs;

const GazeCalibration = dynamic(() => import("@/components/GazeCalibration"), {
  ssr: false,
});

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
  /**
   * Live list of remote peers in the Yjs awareness layer.
   * Updated by MonacoWithYjs via the onPresenceChange callback.
   */
  const [peers, setPeers] = useState<AwarenessPeer[]>([]);
  const [copied, setCopied] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [candidateFinished, setCandidateFinished] = useState(false);
  const [candidateName, setCandidateName] = useState("");
  const [showNameGate, setShowNameGate] = useState(role === "candidate");
  const [showCalibration, setShowCalibration] = useState(false);
  const [gazeCalibrated, setGazeCalibrated] = useState(false);
  const [localGazePlaneModel, setLocalGazePlaneModel] = useState<GazePlaneModel | null>(null);
  const editorRef = useRef<MonacoWithYjsHandle>(null);
  const router = useRouter();

  useEffect(() => {
    fetch(`/api/rooms/${roomId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Room not found"))))
      .then((nextRoom: Room) => {
        setRoom(nextRoom);
        if (nextRoom.gazeCalibrated) {
          setGazeCalibrated(true);
        }
        if (nextRoom.gazePlaneModel) {
          setLocalGazePlaneModel(nextRoom.gazePlaneModel);
        }
      })
      .catch(() => setError("Room not found"));
  }, [roomId]);

  /* Poll for the candidate's name (interviewer side) */
  useEffect(() => {
    if (role !== "interviewer") return;
    if (room?.candidateName) return;

    const id = setInterval(async () => {
      const r = await fetch(`/api/rooms/${roomId}`).then((x) => x.json());
      if (r.candidateName) {
        setRoom(r);
        clearInterval(id);
      }
    }, 3000);

    return () => clearInterval(id);
  }, [role, roomId, room?.candidateName]);

  /* Poll for session start (candidate side) */
  useEffect(() => {
    if (role !== "candidate") return;
    if (room?.status !== "waiting") return;

    const id = setInterval(async () => {
      const r = await fetch(`/api/rooms/${roomId}`).then((x) => x.json());
      if (r.status !== "waiting") {
        suppressPasteDetectionRef.current = true;
        setTimeout(() => { suppressPasteDetectionRef.current = false; }, 500);
        setRoom(r);
        clearInterval(id);

        if (document.fullscreenEnabled) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      }
    }, 2000);

    return () => clearInterval(id);
  }, [role, roomId, room?.status]);

  const submitCandidateName = async () => {
    const trimmed = candidateName.trim();
    if (!trimmed) return;
    await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: trimmed }),
    });
    setRoom((r) => (r ? { ...r, candidateName: trimmed } : null));
    setShowNameGate(false);
    setShowCalibration(true);
  };

  const markActive = async () => {
    await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    setRoom((r) => (r ? { ...r, status: "active" } : null));
  };

  const pushTimelineEvent = useCallback(
    (event: string, data: Record<string, unknown> = {}) => {
      fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timelineEvent: {
            timestamp: new Date().toISOString(),
            event,
            data,
          },
        }),
      }).catch(() => {});
    },
    [roomId]
  );

  /* Behavioral signal tracking for the AI timeline */
  const lastActivityRef = useRef<number>(0);
  const lastKeystrokeEmitRef = useRef<number>(0);
  const pauseDetectedRef = useRef<boolean>(false);
  const suppressPasteDetectionRef = useRef<boolean>(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenExitTimeRef = useRef<number>(0);

  const handleContentChange = useCallback((charDelta: number) => {
    if (role !== "candidate") return;
    if (room?.status !== "active") return;

    const now = Date.now();
    const idleMs = now - lastActivityRef.current;

    if (lastActivityRef.current > 0 && idleMs > 60_000 && !pauseDetectedRef.current) {
      pushTimelineEvent("pause", { idleSeconds: Math.round(idleMs / 1000) });
      pauseDetectedRef.current = true;
    }

    const timeSinceLast = now - lastActivityRef.current;
    if (!suppressPasteDetectionRef.current && charDelta > 80 && (timeSinceLast < 2_000 || lastActivityRef.current === 0)) {
      pushTimelineEvent("paste", { charCount: charDelta, lineCount: Math.ceil(charDelta / 40), source: "bulk_insert" });
    }

    lastActivityRef.current = now;
    pauseDetectedRef.current = false;

    if (now - lastKeystrokeEmitRef.current > 30_000) {
      pushTimelineEvent("keystroke", { t: new Date(now).toISOString() });
      lastKeystrokeEmitRef.current = now;
    }
  }, [role, room?.status, pushTimelineEvent]);

  useEffect(() => {
    if (role !== "candidate") return;
    if (room?.status !== "active") return;

    const id = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (lastActivityRef.current > 0 && idleMs > 90_000 && !pauseDetectedRef.current) {
        pushTimelineEvent("pause", { idleSeconds: Math.round(idleMs / 1000) });
        pauseDetectedRef.current = true;
      }
    }, 15_000);

    return () => clearInterval(id);
  }, [role, room?.status, pushTimelineEvent]);

  const handlePaste = useCallback((charCount: number, lineCount: number) => {
    if (role !== "candidate") return;
    if (room?.status !== "active") return;
    pushTimelineEvent("paste", { charCount, lineCount, source: "clipboard" });
  }, [role, room?.status, pushTimelineEvent]);

  // Tab visibility tracking
  const tabBlurTimeRef = useRef<number>(0);

  useEffect(() => {
    if (role !== "candidate") return;
    if (room?.status !== "active") return;

    const handler = () => {
      if (document.hidden) {
        tabBlurTimeRef.current = Date.now();
        pushTimelineEvent("tab_blur", {});
      } else {
        const awayMs = tabBlurTimeRef.current > 0 ? Date.now() - tabBlurTimeRef.current : 0;
        pushTimelineEvent("tab_focus", { awaySeconds: Math.round(awayMs / 1000) });
        tabBlurTimeRef.current = 0;
      }
    };

    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [role, room?.status, pushTimelineEvent]);

  /* Fullscreen exit tracking */
  useEffect(() => {
    if (role !== "candidate") return;
    if (room?.status !== "active") return;

    setIsFullscreen(!!document.fullscreenElement);

    const handleFullscreenChange = () => {
      const nowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(nowFullscreen);
      if (!nowFullscreen) {
        fullscreenExitTimeRef.current = Date.now();
        pushTimelineEvent("fullscreen_exit", {});
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [role, room?.status, pushTimelineEvent]);

  useGazeTracker(
    roomId,
    gazeCalibrated && role === "candidate" && room?.status === "active",
    pushTimelineEvent,
    localGazePlaneModel ?? room?.gazePlaneModel ?? null
  );

  // Periodic code snapshots (every 60s)
  const snapshotCountRef = useRef(0);

  useEffect(() => {
    if (role !== "candidate") return;
    if (room?.status !== "active") return;

    const captureSnapshot = () => {
      if (snapshotCountRef.current >= 60) return;
      const code = editorRef.current?.getCode() ?? "";
      const snapshot = {
        timestamp: new Date().toISOString(),
        code,
        charCount: code.length,
        lineCount: code.split("\n").length,
      };
      fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
      }).catch(() => {});
      snapshotCountRef.current++;
    };

    captureSnapshot();
    const id = setInterval(captureSnapshot, 60_000);
    return () => clearInterval(id);
  }, [role, room?.status, roomId]);

  const endSession = async () => {
    const code = editorRef.current?.getCode() ?? room?.code ?? "";
    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ended", code }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
    } catch (err) {
      alert(`Failed to end session: ${(err as Error).message}. Please try again.`);
      return;
    }
    router.push(`/room/${roomId}/debrief?role=interviewer`);
  };

  const endAttempt = async () => {
    const code = editorRef.current?.getCode() ?? room?.code ?? "";
    pushTimelineEvent("end_attempt", {
      reason: "candidate_self_terminated",
      codeLength: code.length,
    });
    setShowEndConfirm(false);
    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateFinished: true, code }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
    } catch (err) {
      alert(`Failed to end attempt: ${(err as Error).message}. Please try again.`);
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    router.push(`/room/${roomId}/debrief?role=candidate`);
  };

  const LANG_TEMPLATES: Record<Language, string> = {
    c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* TODO: implement your solution here */
void solution() {

}

int main() {
    solution();
    return 0;
}
`,
    cpp: `#include <bits/stdc++.h>
using namespace std;

/* TODO: implement your solution here */
void solution() {

}

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    solution();
    return 0;
}
`,
    python: `import sys
from typing import List, Optional

# TODO: implement your solution here
def solution():
    pass

if __name__ == "__main__":
    solution()
`,
    java: `import java.util.*;
import java.io.*;

public class Main {

    /* TODO: implement your solution here */
    static void solution() {

    }

    public static void main(String[] args) {
        solution();
    }
}
`,
    javascript: `const readline = require("readline");

// TODO: implement your solution here
function solution() {

}

solution();
`,
    typescript: `import * as readline from "readline";

// TODO: implement your solution here
function solution(): void {

}

solution();
`,
    go: `package main

import (
\t"bufio"
\t"fmt"
\t"os"
)

// TODO: implement your solution here
func solution() {

}

func main() {
\t_ = bufio.NewReader(os.Stdin)
\t_ = fmt.Println
\tsolution()
}
`,
  };

  const setLanguage = async (language: Language) => {
    pushTimelineEvent("language_change", { language });
    await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    });

    const currentCode = editorRef.current?.getCode() ?? "";
    const previousTemplate = room ? LANG_TEMPLATES[room.language] : "";
    const isUntouched =
      currentCode.trim() === "" || currentCode === previousTemplate;
    if (isUntouched) {
      suppressPasteDetectionRef.current = true;
      editorRef.current?.setCode(LANG_TEMPLATES[language]);
      setTimeout(() => { suppressPasteDetectionRef.current = false; }, 500);
    }

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
        pushTimelineEvent(includeHidden ? "submit" : "run", {
          testCount: testCases.length,
          passed: data.results?.filter((r: TestResult) => r.status === "passed").length,
        });
        const r = await fetch(`/api/rooms/${roomId}`).then((x) => x.json());
        setRoom(r);
      } finally {
        setRunning(false);
      }
    },
    [room, roomId, pushTimelineEvent]
  );

  /* Poll for new test runs (interviewer side) */
  useEffect(() => {
    if (role !== "interviewer") return;
    if (room?.status === "ended") return;

    const id = setInterval(async () => {
      const r = await fetch(`/api/rooms/${roomId}`).then((x) => x.json());
      if (r.runs?.length !== room?.runs?.length) {
        setRoom(r);
        const latest = r.runs?.[r.runs.length - 1];
        if (latest?.testResults) setRunResults(latest.testResults);
      }
    }, 3000);

    return () => clearInterval(id);
  }, [role, roomId, room?.runs?.length, room?.status]);

  /* Poll for candidate finishing their attempt (interviewer side) */
  useEffect(() => {
    if (role !== "interviewer") return;
    if (candidateFinished) return;
    if (room?.status !== "active") return;

    const id = setInterval(async () => {
      const r = await fetch(`/api/rooms/${roomId}`).then((x) => x.json()).catch(() => null);
      if (r?.candidateFinishedAt) {
        setCandidateFinished(true);
        setRoom(r);
        clearInterval(id);
      }
    }, 3000);

    return () => clearInterval(id);
  }, [role, roomId, candidateFinished, room?.status]);

  // ── Error state ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-red-400">{error}</p>
      </main>
    );
  }

  // ── Loading state ───────────────────────────────────────────────────────
  if (!room) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400">Loading room…</p>
      </main>
    );
  }

  // ── Name gate — glass card with amber accents ───────────────────────────
  if (showNameGate) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6">
        <div className="p-8 rounded-2xl glass max-w-md w-full flex flex-col items-center gap-5 animate-fade-in-up">
          <h1 className="text-2xl font-semibold">Welcome to your interview</h1>
          {room.interviewerCompany && (
            <p className="text-zinc-400">
              Interviewing at <span className="text-white font-medium">{room.interviewerCompany}</span>
            </p>
          )}
          <div className="flex flex-col gap-3 w-full">
            <label className="text-sm text-zinc-300">Your name</label>
            <input
              autoFocus
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCandidateName()}
              className="rounded-lg glass-input px-3 py-2 text-zinc-100"
              placeholder="e.g. Jane Smith"
            />
            {/* Amber glow button */}
            <button
              onClick={submitCandidateName}
              disabled={!candidateName.trim()}
              className="rounded-lg bg-amber-500 text-zinc-950 font-medium py-2
                         hover:bg-amber-400 disabled:opacity-40 transition-all duration-300
                         shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)]"
            >
              Enter room
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (showCalibration && role === "candidate") {
    return (
      <GazeCalibration
        roomId={roomId}
        onComplete={({ calibrated, planeModel }) => {
          setGazeCalibrated(calibrated);
          if (planeModel) {
            setLocalGazePlaneModel(planeModel);
          }
          setShowCalibration(false);
        }}
      />
    );
  }

  return (
    <main className="min-h-screen text-zinc-100 flex flex-col">

      {/* ── Header — frosted glass bar ──────────────────────────────────── */}
      {/* bg-white/[0.03] + backdrop-blur-xl creates the frosted glass effect.
       * border-b border-white/[0.06] gives a subtle divider. */}
      <header className="bg-white/[0.03] backdrop-blur-xl border-b border-white/[0.06] px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-zinc-400">Room {roomId}</span>
          {room.interviewerCompany && (
            <span className="text-sm text-zinc-300">
              <span className="text-zinc-500">by</span> {room.interviewerCompany}
            </span>
          )}
          {room.candidateName && (
            <span className="text-sm text-zinc-300">
              <span className="text-zinc-500">·</span> {room.candidateName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Copy invite link — interviewer only */}
          {role === "interviewer" && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded bg-white/[0.06] border border-white/[0.1] px-3 py-1 text-sm text-zinc-200 hover:bg-white/[0.1] transition-colors"
            >
              {copied ? "Copied!" : "Copy invite link"}
            </button>
          )}

          {/* Re-enter fullscreen — amber accent, candidate only */}
          {role === "candidate" && room.status === "active" && !isFullscreen && (
            <button
              onClick={() => {
                if (document.fullscreenEnabled) {
                  document.documentElement.requestFullscreen().catch(() => {});
                }
              }}
              className="rounded bg-white/[0.06] px-3 py-1 text-sm text-amber-400 border border-amber-500/50
                         hover:bg-white/[0.1] transition-colors shadow-[0_0_10px_rgba(245,158,11,0.15)]"
            >
              Re-enter fullscreen
            </button>
          )}

          {role === "candidate" ? (
            <select
              value={room.language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="rounded glass-input px-2 py-1 text-sm text-zinc-100"
            >
              <option value="c">C</option>
              <option value="cpp">C++</option>
              <option value="java">Java</option>
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
              <option value="go">Go</option>
            </select>
          ) : (
            <span className="rounded bg-white/[0.06] border border-white/[0.1] px-2 py-1 text-sm text-zinc-400 capitalize">
              {room.language === "cpp" ? "C++" : room.language}
            </span>
          )}

          {/* Run & Submit — candidate only */}
          {role === "candidate" && (
            <>
              <button
                onClick={() => runTests(false)}
                disabled={running}
                className="rounded bg-emerald-600 px-3 py-1 text-white text-sm font-medium
                           hover:bg-emerald-500 disabled:opacity-50 transition-all duration-300
                           shadow-[0_0_15px_rgba(16,185,129,0.25)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
              >
                {running ? "Running…" : "Run"}
              </button>

              <button
                onClick={() => runTests(true)}
                disabled={running}
                className="rounded bg-blue-600 px-3 py-1 text-white text-sm font-medium
                           hover:bg-blue-500 disabled:opacity-50 transition-all duration-300
                           shadow-[0_0_15px_rgba(59,130,246,0.25)] hover:shadow-[0_0_20px_rgba(59,130,246,0.4)]"
              >
                Submit
              </button>
            </>
          )}

          {/* Presence indicator — neon glow dots when active */}
          {role === "candidate" && (() => {
            const interviewer = peers.find(p => p.role === "interviewer");
            return (
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  interviewer
                    ? "bg-blue-500 animate-pulse shadow-[0_0_6px_rgba(59,130,246,0.6)]"
                    : "bg-zinc-600"
                }`} />
                <span className="text-xs text-zinc-400">
                  {interviewer ? "Interviewer watching" : "Interviewer offline"}
                </span>
              </div>
            );
          })()}
          {role === "interviewer" && (() => {
            const candidate = peers.find(p => p.role === "candidate");
            return (
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  candidate
                    ? "bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.6)]"
                    : "bg-zinc-600"
                }`} />
                <span className="text-xs text-zinc-400">
                  {candidate ? "Candidate online" : "Candidate offline"}
                </span>
              </div>
            );
          })()}
          <span className="text-sm text-zinc-400 capitalize">{role}</span>

          {/* Start session — amber glow */}
          {room.status === "waiting" && role === "interviewer" && (
            <button
              onClick={markActive}
              className="rounded bg-amber-500 px-3 py-1 text-zinc-950 text-sm font-medium
                         shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)]
                         transition-all duration-300"
            >
              Start session
            </button>
          )}

          {/* End session — red glow (interviewer) */}
          {room.status !== "waiting" && room.status !== "ended" && role === "interviewer" && (
            <button
              onClick={endSession}
              className="rounded bg-red-600 px-3 py-1 text-white text-sm font-medium
                         hover:bg-red-500 transition-all duration-300
                         shadow-[0_0_15px_rgba(239,68,68,0.25)] hover:shadow-[0_0_20px_rgba(239,68,68,0.4)]"
            >
              End session
            </button>
          )}

          {/* End attempt — muted outline (candidate) */}
          {room.status === "active" && role === "candidate" && (
            <button
              onClick={() => setShowEndConfirm(true)}
              className="rounded border border-zinc-600 px-3 py-1 text-zinc-400 text-sm
                         hover:border-red-500/60 hover:text-red-400 transition-all duration-300"
            >
              End attempt
            </button>
          )}
        </div>
      </header>

      {/* ── Candidate finished banner — interviewer only ────────────────── */}
      {candidateFinished && role === "interviewer" && (
        <div className="mx-4 mt-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30
                        flex items-center gap-3 animate-fade-in-up">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
          <span className="text-sm text-amber-200">
            {room?.candidateName || "Candidate"} has finished their attempt. You can end the session when ready.
          </span>
        </div>
      )}

      {/* ── Two-panel layout ────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 p-4">

        {/* ── Code panel — glass container ──────────────────────────────── */}
        <div className="flex flex-col rounded-xl glass overflow-hidden">
          {/* Panel header — slightly darker glass divider */}
          <h2 className="text-sm font-medium text-zinc-400 px-3 py-2 bg-white/[0.02] border-b border-white/[0.06] shrink-0">
            Code
          </h2>
          <div className="flex-1 min-h-0 relative">
            <MonacoWithYjs
              ref={editorRef}
              roomId={roomId}
              language={room.language}
              height="100%"
              role={role}
              extraReadOnly={role === "candidate" && room.status === "waiting"}
              onPresenceChange={setPeers}
              onContentChange={handleContentChange}
              onPaste={handlePaste}
            />
            {/* Waiting overlay — frosted glass with amber CTA */}
            {room.status === "waiting" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-md">
                {role === "interviewer" ? (
                  <>
                    <p className="text-zinc-300 text-sm">Candidate is ready. Start the session when you are.</p>
                    <button
                      onClick={markActive}
                      className="px-8 py-3 rounded-xl bg-amber-500 text-zinc-950 font-semibold text-lg
                                 hover:bg-amber-400 transition-all duration-300
                                 shadow-[0_0_30px_rgba(245,158,11,0.4)] hover:shadow-[0_0_40px_rgba(245,158,11,0.6)]"
                    >
                      Start Session
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <svg className="animate-spin w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      <span className="text-zinc-100 font-medium">Waiting for interviewer to start…</span>
                    </div>
                    <p className="text-xs text-zinc-500">The editor will unlock automatically once the session begins.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Problem panel — glass container ───────────────────────────── */}
        <div className="flex flex-col rounded-xl glass overflow-hidden">
          <h2 className="text-sm font-medium text-zinc-400 px-3 py-2 bg-white/[0.02] border-b border-white/[0.06] shrink-0">
            Problem
          </h2>
          <div className="flex-1 min-h-0 overflow-auto flex flex-col">
            <div className="p-4 shrink-0">
              <h3 className="font-medium text-lg">{room.problem.title || "Untitled"}</h3>
              <div className="mt-2 text-sm text-zinc-300 prose-problem">
                {room.problem.description ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="text-zinc-300 leading-relaxed mb-3">{children}</p>,
                      strong: ({ children }) => <strong className="text-zinc-100 font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="text-zinc-200 italic">{children}</em>,
                      h1: ({ children }) => <h1 className="text-zinc-200 text-lg font-semibold mt-4 mb-2">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-zinc-200 text-base font-semibold mt-4 mb-2">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-zinc-200 text-sm font-semibold mt-3 mb-1">{children}</h3>,
                      ul: ({ children }) => <ul className="list-disc list-inside text-zinc-400 mb-3 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside text-zinc-400 mb-3 space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="text-zinc-300">{children}</li>,
                      code: ({ children, className }) => {
                        const isBlock = className?.includes("language-");
                        if (isBlock) {
                          return <code className={`block bg-black/30 rounded-lg p-3 text-xs text-zinc-200 overflow-x-auto ${className ?? ""}`}>{children}</code>;
                        }
                        return <code className="bg-white/[0.06] border border-white/[0.08] rounded px-1.5 py-0.5 text-xs text-emerald-300">{children}</code>;
                      },
                      pre: ({ children }) => <pre className="mb-3">{children}</pre>,
                    }}
                  >
                    {room.problem.description}
                  </ReactMarkdown>
                ) : (
                  <span className="text-zinc-500">No description.</span>
                )}
              </div>
              {/* Examples — glass-styled blocks */}
              {room.problem.examples.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-zinc-400 font-medium mb-2">Examples</h4>
                  {room.problem.examples.map((ex, i) => (
                    <div key={i} className="mb-3 p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm">
                      <p><span className="text-zinc-500">Input:</span> {ex.input}</p>
                      <p><span className="text-zinc-500">Output:</span> {ex.output}</p>
                      {ex.explanation && <p className="text-zinc-500">{ex.explanation}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Test results section */}
            <div className="border-t border-white/[0.06] flex-1 min-h-0 flex flex-col">
              <h4 className="text-zinc-400 font-medium px-3 py-2 shrink-0">Test results</h4>
              <div className="flex-1 overflow-auto px-3 pb-3">
                {runResults === null || runResults.length === 0 ? (
                  <p className="text-zinc-500 text-sm">Run or submit to see results.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-white/[0.06]">
                        <th className="py-1 pr-2">#</th>
                        <th className="py-1 pr-2">Status</th>
                        <th className="py-1">Input / Expected / Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runResults.map((tr, i) => (
                        <tr key={i} className="border-b border-white/[0.04]">
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

      {/* ── "End attempt" confirmation modal ──────────────────────────── */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="relative w-full max-w-md rounded-2xl glass p-8 flex flex-col items-center gap-5 animate-fade-in-up">
            <h2 className="text-xl font-bold text-white tracking-tight">Ready to finish?</h2>
            <p className="text-center text-zinc-300 text-sm leading-relaxed">
              It&apos;s completely okay to end early — knowing when to step back is a strength.
              Your progress so far will be saved and reviewed.
            </p>
            <p className="text-center text-zinc-500 text-xs">
              This cannot be undone. The interviewer will be notified that you have finished.
            </p>
            <div className="flex gap-3 w-full mt-1">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 rounded-lg border border-zinc-600 py-2.5 text-zinc-300 text-sm font-medium
                           hover:border-zinc-500 hover:text-zinc-200 transition-colors"
              >
                Keep going
              </button>
              <button
                onClick={endAttempt}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-white text-sm font-medium
                           hover:bg-red-500 transition-all duration-300
                           shadow-[0_0_15px_rgba(239,68,68,0.25)] hover:shadow-[0_0_20px_rgba(239,68,68,0.4)]"
              >
                End attempt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fullscreen exit warning — glass card with red glow ──────────── */}
      {/* Pulsing warning icon signals "something is wrong".
       * The exit has already been recorded in the timeline. */}
      {role === "candidate" && room.status === "active" && !isFullscreen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="relative w-full max-w-md rounded-2xl glass border-red-500/40 shadow-[0_0_40px_rgba(239,68,68,0.15)] p-8 flex flex-col items-center gap-5 animate-fade-in-up">
            {/* Warning icon with pulsing red glow */}
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border border-red-500/40 shadow-[0_0_20px_rgba(239,68,68,0.2)] animate-glow-pulse">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>

            <h2 className="text-xl font-bold text-white tracking-tight">Fullscreen Required</h2>

            <p className="text-center text-zinc-300 text-sm leading-relaxed">
              You have exited fullscreen mode. This session requires you to stay in fullscreen at all times.{" "}
              <span className="text-red-400 font-medium">This exit has been recorded</span> and will be visible to your interviewer.
            </p>

            {/* Red glow CTA */}
            <button
              onClick={() => {
                if (document.fullscreenEnabled) {
                  document.documentElement.requestFullscreen().catch(() => {});
                }
              }}
              className="w-full rounded-lg bg-red-500 hover:bg-red-400 text-white font-semibold py-3
                         transition-all duration-300
                         shadow-[0_0_20px_rgba(239,68,68,0.3)] hover:shadow-[0_0_30px_rgba(239,68,68,0.5)]"
            >
              Return to Fullscreen
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
