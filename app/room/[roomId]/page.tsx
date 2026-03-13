"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room, Language } from "@/lib/store";
import type { TestResult } from "@/lib/store";
import dynamic from "next/dynamic";
import type { MonacoWithYjsHandle, AwarenessPeer } from "@/components/MonacoWithYjs";

/*
 * y-monaco touches `window` at module-evaluation time, which crashes
 * Next.js SSR. Dynamically importing with ssr:false ensures the module
 * is only ever loaded in the browser.
 *
 * We cast to the original component type so TypeScript still checks props
 * correctly — dynamic() loses the generic forwardRef signature otherwise.
 */
const MonacoWithYjs = dynamic(
  () => import("@/components/MonacoWithYjs").then((m) => m.MonacoWithYjs),
  { ssr: false }
) as typeof import("@/components/MonacoWithYjs").MonacoWithYjs;

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
   * Updated by MonacoWithYjs via the onPresenceChange callback whenever
   * someone joins, leaves, or updates their awareness state.
   * Used to render the presence dot in the header.
   */
  const [peers, setPeers] = useState<AwarenessPeer[]>([]);
  const [copied, setCopied] = useState(false);
  /**
   * Candidate's name — collected via a gate screen before entering the room.
   * For the interviewer this stays empty (they entered their company in setup).
   * Once submitted it is persisted to the room via PATCH so the interviewer
   * can also see the candidate's name.
   */
  const [candidateName, setCandidateName] = useState("");
  /**
   * Controls whether the candidate name-entry gate is visible.
   * Starts true for candidates (they must enter their name first).
   * Interviewers skip straight into the room.
   */
  const [showNameGate, setShowNameGate] = useState(role === "candidate");
  const editorRef = useRef<MonacoWithYjsHandle>(null);
  const router = useRouter();

  useEffect(() => {
    fetch(`/api/rooms/${roomId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Room not found"))))
      .then(setRoom)
      .catch(() => setError("Room not found"));
  }, [roomId]);

  /**
   * Poll for the candidate's name while the interviewer is waiting.
   * Only runs for the interviewer — candidates set their own name locally.
   */
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

  /**
   * Poll for session start while the candidate is in the waiting state.
   *
   * The candidate's editor is locked (read-only) until the interviewer clicks
   * "Start session", which flips room.status from "waiting" → "active".
   * We poll every 2 s and update local room state as soon as it changes,
   * which causes the editor lock and waiting overlay to lift automatically.
   */
  useEffect(() => {
    if (role !== "candidate") return;
    if (room?.status !== "waiting") return; // already active or ended

    const id = setInterval(async () => {
      const r = await fetch(`/api/rooms/${roomId}`).then((x) => x.json());
      if (r.status !== "waiting") {
        // Suppress paste detection during the initial template load that fires
        // when the session becomes active and the editor seeds its template.
        suppressPasteDetectionRef.current = true;
        setTimeout(() => { suppressPasteDetectionRef.current = false; }, 500);
        setRoom(r);
        clearInterval(id);

        // Auto-enter fullscreen when session starts as an integrity measure.
        // .catch() handles browsers that reject requestFullscreen() without
        // a prior user gesture (e.g. Firefox). The header button covers this case.
        if (document.fullscreenEnabled) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      }
    }, 2000);

    return () => clearInterval(id);
  }, [role, roomId, room?.status]);

  /**
   * Called when the candidate submits their name in the gate screen.
   * Persists the name to the room so the interviewer sees it too,
   * then dismisses the gate and reveals the editor.
   */
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

  /**
   * Behavioral signal tracking for the AI timeline.
   *
   * lastActivityRef     — timestamp of most recent content change
   * lastKeystrokeEmit   — timestamp of the last "keystroke" event we pushed
   * pauseDetectedRef    — true once we have emitted a "pause" for the current
   *                       idle stretch (prevents duplicate pause events)
   *
   * Strategy:
   *  - On every content change: update lastActivity; if > 60s elapsed since
   *    last change (and we haven't reported a pause yet), emit "pause" first;
   *    then emit "keystroke" at most once per 30 s of typing activity.
   *  - A 15-second interval checks for sustained inactivity (> 90 s) to catch
   *    pauses that happen while the candidate is just thinking (no typing).
   */
  const lastActivityRef = useRef<number>(0);
  const lastKeystrokeEmitRef = useRef<number>(0);
  const pauseDetectedRef = useRef<boolean>(false);
  /**
   * When true, paste detection is temporarily suppressed.
   * Set before injecting templates (language switch / session start) to prevent
   * large template insertions from being flagged as candidate paste events.
   */
  const suppressPasteDetectionRef = useRef<boolean>(false);

  /**
   * Drives the "Re-enter fullscreen" amber button in the header.
   * Starts false; flips to true when requestFullscreen() resolves,
   * and back to false on a "fullscreenchange" exit event.
   */
  const [isFullscreen, setIsFullscreen] = useState(false);
  /**
   * Timestamp (ms) when the candidate last exited fullscreen.
   * Mirrors the tabBlurTimeRef pattern — stored in a ref to avoid
   * triggering re-renders, used only for future correlation logic.
   */
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

    // Detect bulk inserts as potential paste (backup for middle-click paste etc.)
    // Skip detection when suppressed — template injections are not pastes.
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

  /**
   * Fullscreen exit tracking — mirrors the tab_blur/tab_focus pattern.
   *
   * When the candidate exits fullscreen (Escape, browser chrome, OS hotkey),
   * we log a "fullscreen_exit" timeline event so the AI debrief can flag it
   * as a potential integrity signal alongside tab switches and paste events.
   *
   * Guarded by role === "candidate" and room.status === "active" so the
   * interviewer is completely unaffected.
   *
   * Known limitation: F11 on Windows/Linux bypasses the Fullscreen API entirely
   * and cannot be detected — documented in the plan as a known browser limitation.
   */
  useEffect(() => {
    if (role !== "candidate") return;
    if (room?.status !== "active") return;

    // Sync initial fullscreen state — the polling effect may have already
    // entered fullscreen before this effect's first run.
    setIsFullscreen(!!document.fullscreenElement);

    const handleFullscreenChange = () => {
      const nowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(nowFullscreen);
      if (!nowFullscreen) {
        // Candidate exited fullscreen — record timestamp and push integrity signal
        fullscreenExitTimeRef.current = Date.now();
        pushTimelineEvent("fullscreen_exit", {});
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [role, room?.status, pushTimelineEvent]);

  // Periodic code snapshots (every 60s)
  const snapshotCountRef = useRef(0);

  useEffect(() => {
    if (role !== "candidate") return;
    if (room?.status !== "active") return;

    // Helper to capture a single snapshot and POST it to the server
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

    // Capture an immediate t=0 snapshot as a baseline for code evolution analysis.
    // Without this, the first snapshot would be at 60s, leaving no reference point.
    captureSnapshot();

    const id = setInterval(captureSnapshot, 60_000);

    return () => clearInterval(id);
  }, [role, room?.status, roomId]);

  /**
   * Ends the interview session by sending the final code to the server.
   * Awaits the PATCH to ensure the server acknowledged the end — if the request
   * fails, shows an error alert so the user knows the debrief won't generate.
   * The debrief generation itself runs in the background on the server (non-blocking).
   */
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
      return; // Don't navigate — let the user retry
    }
    router.push(`/room/${roomId}/debrief`);
  };

  /**
   * Templates mirror what MonacoWithYjs preloads on first mount.
   * We keep a copy here so that when the user switches language we can
   * detect "is the editor still on a pristine template?" before overwriting.
   */
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

    // Inject the new language template only when the editor is empty OR
    // still contains one of the unmodified starter templates (i.e. the
    // candidate has not written any real code yet).
    const currentCode = editorRef.current?.getCode() ?? "";
    const previousTemplate = room ? LANG_TEMPLATES[room.language] : "";
    const isUntouched =
      currentCode.trim() === "" || currentCode === previousTemplate;
    // Suppress paste detection while injecting the template — the large char
    // insert is a template swap, not a candidate paste from an external source.
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
        // Refresh room so interviewer's view gets the updated runs list.
        const r = await fetch(`/api/rooms/${roomId}`).then((x) => x.json());
        setRoom(r);
      } finally {
        setRunning(false);
      }
    },
    [room, roomId, pushTimelineEvent]
  );

  /**
   * Poll for new test runs while the interviewer is watching.
   * The candidate's Run/Submit updates room.runs on the server; the interviewer
   * needs to see those results in real-time without having clicked Run themselves.
   * We poll every 3 s and update room (and runResults) whenever a new run appears.
   */
  useEffect(() => {
    if (role !== "interviewer") return;
    if (room?.status === "ended") return;

    const id = setInterval(async () => {
      const r = await fetch(`/api/rooms/${roomId}`).then((x) => x.json());
      // Only update if a new run was added.
      if (r.runs?.length !== room?.runs?.length) {
        setRoom(r);
        // Mirror the latest run's results into runResults so the table renders.
        const latest = r.runs?.[r.runs.length - 1];
        if (latest?.testResults) setRunResults(latest.testResults);
      }
    }, 3000);

    return () => clearInterval(id);
  }, [role, roomId, room?.runs?.length, room?.status]);

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

  /**
   * Name gate — shown to candidates before they enter the room.
   * A simple full-screen overlay that collects the candidate's name.
   * Submitting persists the name to the room (so the interviewer sees it)
   * and dismisses the gate.
   */
  if (showNameGate) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-6">
        <h1 className="text-2xl font-semibold">Welcome to your interview</h1>
        {room.interviewerCompany && (
          <p className="text-zinc-400">
            Interviewing at <span className="text-white font-medium">{room.interviewerCompany}</span>
          </p>
        )}
        <div className="flex flex-col gap-3 w-72">
          <label className="text-sm text-zinc-300">Your name</label>
          <input
            autoFocus
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCandidateName()}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 focus:outline-none focus:border-amber-500"
            placeholder="e.g. Jane Smith"
          />
          <button
            onClick={submitCandidateName}
            disabled={!candidateName.trim()}
            className="rounded-lg bg-amber-500 text-zinc-950 font-medium py-2 hover:bg-amber-400 disabled:opacity-40"
          >
            Enter room
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0">
        {/*
         * Header left — room ID plus participant names.
         * interviewerCompany comes from setup; candidateName is entered by the
         * candidate on their gate screen and immediately synced to the room.
         * The interviewer's view refreshes automatically because room state is
         * polled/updated whenever the candidate submits their name via PATCH.
         */}
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
          {/* Copy candidate invite link — only the interviewer needs this */}
          {role === "interviewer" && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded bg-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-600"
            >
              {copied ? "Copied!" : "Copy invite link"}
            </button>
          )}
          {/*
           * Re-enter fullscreen button — visible only to candidates who have
           * exited fullscreen during an active session. Amber color signals
           * "attention required" without being alarming. Clicking it re-enters
           * fullscreen (user gesture satisfies browser requirements, so this
           * works even in Firefox where the auto-trigger silently fails).
           */}
          {role === "candidate" && room.status === "active" && !isFullscreen && (
            <button
              onClick={() => {
                if (document.fullscreenEnabled) {
                  document.documentElement.requestFullscreen().catch(() => {});
                }
              }}
              className="rounded bg-zinc-700 px-3 py-1 text-sm text-amber-400 border border-amber-500/50 hover:bg-zinc-600"
            >
              Re-enter fullscreen
            </button>
          )}

          <select
            value={room.language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="rounded bg-zinc-800 px-2 py-1 text-sm border border-zinc-600"
          >
            <option value="c">C</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="go">Go</option>
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
          {/*
           * Presence indicator — shown to both roles.
           *
           * Candidate sees a blue pulsing dot when the interviewer is connected.
           * Interviewer sees a green pulsing dot when the candidate is connected.
           *
           * `peers` is populated from y-websocket awareness; it updates in
           * real-time as people join/leave (no polling needed).
           * `animate-pulse` is a Tailwind built-in — no animation library needed.
           */}
          {role === "candidate" && (() => {
            const interviewer = peers.find(p => p.role === "interviewer");
            return (
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${interviewer ? "bg-blue-500 animate-pulse" : "bg-zinc-600"}`} />
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
                <span className={`w-2 h-2 rounded-full ${candidate ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"}`} />
                <span className="text-xs text-zinc-400">
                  {candidate ? "Candidate online" : "Candidate offline"}
                </span>
              </div>
            );
          })()}
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
          {/*
           * Waiting overlay — shown to the candidate until the interviewer
           * clicks "Start session". Sits on top of the editor (pointer-events-none
           * on the editor beneath so the overlay is the only interactive layer).
           * The overlay disappears the moment the polling effect detects
           * room.status has changed to "active".
           */}
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
            {room.status === "waiting" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/80 backdrop-blur-sm">
                {role === "interviewer" ? (
                  <>
                    <p className="text-zinc-300 text-sm">Candidate is ready. Start the session when you are.</p>
                    <button
                      onClick={markActive}
                      className="px-8 py-3 rounded-lg bg-amber-500 text-zinc-950 font-semibold text-lg hover:bg-amber-400 transition"
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

      {/*
       * Fullscreen exit warning overlay — shown only to candidates during an
       * active session when they exit fullscreen (Escape, OS hotkey, etc.).
       *
       * This is a non-blocking warning: it floats over the UI without locking
       * interaction. The candidate can dismiss it or re-enter fullscreen.
       * The exit has already been recorded in the timeline for the AI debrief.
       *
       * Design intent:
       *  - Red border + icon  → signals "something is wrong"
       *  - Clear message      → tells the candidate exactly what happened
       *  - Primary CTA        → re-enters fullscreen (user gesture, works in all browsers)
       *  - Dismiss button     → lets them continue working (warning is still logged)
       */}
      {role === "candidate" && room.status === "active" && !isFullscreen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl border border-red-500/60 bg-zinc-900 shadow-2xl p-8 flex flex-col items-center gap-5">
            {/* Warning icon */}
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border border-red-500/40">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>

            {/* Heading */}
            <h2 className="text-xl font-bold text-white tracking-tight">Fullscreen Required</h2>

            {/* Body */}
            <p className="text-center text-zinc-300 text-sm leading-relaxed">
              You have exited fullscreen mode. This session requires you to stay in fullscreen at all times.{" "}
              <span className="text-red-400 font-medium">This exit has been recorded</span> and will be visible to your interviewer.
            </p>

            {/* Actions */}
            <button
              onClick={() => {
                if (document.fullscreenEnabled) {
                  document.documentElement.requestFullscreen().catch(() => {});
                }
              }}
              className="w-full rounded-lg bg-red-500 hover:bg-red-400 text-white font-semibold py-3 transition-colors"
            >
              Return to Fullscreen
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
