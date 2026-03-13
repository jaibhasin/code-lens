"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Room } from "@/lib/store";

interface Debrief {
  approach_analysis?: string;
  approach_score?: number;
  problem_solving_behavior?: string;
  problem_solving_score?: number;
  code_quality?: string;
  code_quality_score?: number;
  time_breakdown?: string;
  /** Renamed from communication_score — tracks structured/systematic thinking */
  structured_thinking_score?: number;
  overall_score?: number;
  hire_signal?: string;
  hire_reasoning?: string;
  summary?: string;
  code_evolution_analysis?: string;
  integrity_score?: number;
  integrity_flags?: string[];
  /** Specific strengths observed during the session */
  strengths?: string[];
  /** Specific areas for improvement */
  weaknesses?: string[];
  /** Present when the debrief is still being generated */
  status?: string;
  error?: string;
}

function ScoreDot({ score, max }: { score: number; max: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={`w-2.5 h-2.5 rounded-full ${
            i < score ? "bg-amber-400" : "bg-zinc-700"
          }`}
        />
      ))}
    </div>
  );
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = Math.round((score / max) * 100);
  const color =
    pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full bg-zinc-800 rounded-full h-1.5">
      <div
        className={`h-1.5 rounded-full transition-all ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function HireSignalBadge({ signal }: { signal: string }) {
  const colors: Record<string, string> = {
    "Strong Hire": "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    "Hire": "bg-blue-500/20 text-blue-300 border-blue-500/40",
    "No Hire": "bg-amber-500/20 text-amber-300 border-amber-500/40",
    "Strong No Hire": "bg-red-500/20 text-red-300 border-red-500/40",
  };
  const cls = colors[signal] ?? "bg-zinc-700 text-zinc-300 border-zinc-600";
  return (
    <span className={`inline-block px-3 py-1 rounded-full border text-sm font-semibold ${cls}`}>
      {signal}
    </span>
  );
}

export default function DebriefPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  /**
   * Role-based view filtering via ?role= query param.
   * - "candidate" → simplified view: only score, verdict, summary, strengths, weaknesses
   * - anything else (default) → full interviewer view with all details
   */
  const viewRole = searchParams.get("role") === "candidate" ? "candidate" : "interviewer";
  const [room, setRoom] = useState<Room | null>(null);
  /** Tracks whether polling has exceeded the 90-second timeout */
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const startTime = Date.now();

    const load = async () => {
      const r = await fetch(`/api/rooms/${roomId}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      if (!r) return;
      setRoom(r);
      // Stop polling once debrief is ready and not just a "generating" placeholder
      const debrief = r.debrief as Debrief | null;
      if (debrief && debrief.status !== "generating") {
        clearInterval(id);
      }
      // Show timeout message after 90s of polling without a completed debrief
      if (Date.now() - startTime > 90_000 && (!debrief || debrief.status === "generating")) {
        setTimedOut(true);
      }
    };

    const id = setInterval(load, 3000);
    load();
    return () => clearInterval(id);
  }, [roomId]);

  const debrief = room?.debrief as Debrief | null;
  const isReady = debrief && debrief.status !== "generating";

  if (!isReady) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-3">
        <svg className="animate-spin w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <p className="text-zinc-400">Generating evaluation…</p>
        {timedOut && (
          <p className="text-amber-400 text-sm mt-2">
            This is taking longer than expected. The AI evaluation may have failed — try refreshing the page.
          </p>
        )}
      </main>
    );
  }

  // At this point isReady is true, meaning both room and room.debrief are non-null.
  // TypeScript can't infer this from the `isReady` check, so we narrow explicitly.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const safeRoom = room!;
  const d = safeRoom.debrief as Debrief;

  if (d.error) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold">Session debrief</h1>
        <p className="text-amber-500 mt-4">{d.error}</p>
      </main>
    );
  }

  const dimensions = [
    { label: "Approach & Algorithm", score: d.approach_score, max: 5 },
    { label: "Problem-Solving", score: d.problem_solving_score, max: 5 },
    { label: "Code Quality", score: d.code_quality_score, max: 5 },
    { label: "Structured Thinking", score: d.structured_thinking_score, max: 5 },
  ];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Interview Evaluation</h1>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-400">
          {safeRoom.candidateName && <span>{safeRoom.candidateName}</span>}
          {safeRoom.candidateName && safeRoom.interviewerCompany && <span>·</span>}
          {safeRoom.interviewerCompany && <span>{safeRoom.interviewerCompany}</span>}
          {safeRoom.problem.title && (
            <>
              <span>·</span>
              <span>
                {safeRoom.problem.title}
                {safeRoom.problem.difficulty && (
                  <span
                    className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${
                      safeRoom.problem.difficulty === "Easy"
                        ? "bg-emerald-900/50 text-emerald-400"
                        : safeRoom.problem.difficulty === "Medium"
                        ? "bg-amber-900/50 text-amber-400"
                        : "bg-red-900/50 text-red-400"
                    }`}
                  >
                    {safeRoom.problem.difficulty}
                  </span>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Verdict card */}
      <div className="mt-6 p-5 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Verdict</p>
            {d.hire_signal && <HireSignalBadge signal={d.hire_signal} />}
          </div>
          {typeof d.overall_score === "number" && (
            <div className="text-center">
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Overall</p>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-zinc-100">{d.overall_score}</span>
                <span className="text-zinc-500 text-sm">/10</span>
              </div>
            </div>
          )}
        </div>

        {d.summary && (
          <p className="text-zinc-300 text-sm leading-relaxed border-t border-zinc-800 pt-4">
            {d.summary}
          </p>
        )}
      </div>

      {/* Strengths & Weaknesses — two-column card with green/amber highlights */}
      {((d.strengths && d.strengths.length > 0) || (d.weaknesses && d.weaknesses.length > 0)) && (
        <div className="mt-6 p-5 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-4">
            Strengths & Weaknesses
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Strengths column */}
            {d.strengths && d.strengths.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-emerald-400 mb-2">Strengths</h3>
                <ul className="space-y-1.5">
                  {d.strengths.map((s, i) => (
                    <li key={i} className="text-sm text-zinc-300 flex gap-2">
                      <span className="text-emerald-500 shrink-0">+</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Weaknesses column */}
            {d.weaknesses && d.weaknesses.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-amber-400 mb-2">Areas for Improvement</h3>
                <ul className="space-y-1.5">
                  {d.weaknesses.map((w, i) => (
                    <li key={i} className="text-sm text-zinc-300 flex gap-2">
                      <span className="text-amber-500 shrink-0">-</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dimension scores — interviewer only */}
      {viewRole === "interviewer" && dimensions.some((d) => typeof d.score === "number") && (
        <div className="mt-6 p-5 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-4">
            Dimension Scores
          </h2>
          <div className="space-y-4">
            {dimensions.map(({ label, score, max }) =>
              typeof score === "number" ? (
                <div key={label}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-sm text-zinc-300">{label}</span>
                    <div className="flex items-center gap-2">
                      <ScoreDot score={score} max={max} />
                      <span className="text-xs text-zinc-500 w-6 text-right">{score}/{max}</span>
                    </div>
                  </div>
                  <ScoreBar score={score} max={max} />
                </div>
              ) : null
            )}
          </div>
        </div>
      )}

      {/* Integrity — interviewer only (candidates should not see integrity flags) */}
      {viewRole === "interviewer" && typeof d.integrity_score === "number" && (
        <div className="mt-6 p-5 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-widest">
              Session Integrity
            </h2>
            <div className="flex items-center gap-2">
              <ScoreDot score={d.integrity_score} max={5} />
              <span className="text-xs text-zinc-500">{d.integrity_score}/5</span>
            </div>
          </div>
          <ScoreBar score={d.integrity_score} max={5} />
          {d.integrity_flags && d.integrity_flags.length > 0 ? (
            <div className="mt-4 p-3 rounded-lg bg-red-950/30 border border-red-900/40">
              <p className="text-xs font-medium text-red-400 uppercase tracking-widest mb-2">Flags</p>
              <ul className="space-y-1.5">
                {d.integrity_flags.map((flag, i) => (
                  <li key={i} className="text-sm text-red-300 flex gap-2">
                    <span className="text-red-500 shrink-0">!</span>
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-sm text-emerald-400">No integrity concerns detected.</p>
          )}
        </div>
      )}

      {/* Hire reasoning — interviewer only */}
      {viewRole === "interviewer" && d.hire_reasoning && (
        <div className="mt-6 p-5 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-3">
            Reasoning
          </h2>
          <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{d.hire_reasoning}</p>
        </div>
      )}

      {/* Qualitative sections — interviewer only (detailed analysis) */}
      {viewRole === "interviewer" && <div className="mt-6 space-y-5">
        {[
          { key: "approach_analysis", label: "Approach & Algorithm", score: d.approach_score, max: 5 },
          { key: "problem_solving_behavior", label: "Problem-Solving Behavior", score: d.problem_solving_score, max: 5 },
          { key: "code_quality", label: "Code Quality", score: d.code_quality_score, max: 5 },
          { key: "time_breakdown", label: "Time Breakdown" },
          { key: "code_evolution_analysis", label: "Code Evolution" },
        ].map(({ key, label, score, max }) => {
          const text = d[key as keyof Debrief] as string | undefined;
          if (!text) return null;
          return (
            <section key={key} className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-widest">
                  {label}
                </h2>
                {typeof score === "number" && max && (
                  <div className="flex items-center gap-1.5">
                    <ScoreDot score={score} max={max} />
                    <span className="text-xs text-zinc-500">{score}/{max}</span>
                  </div>
                )}
              </div>
              <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
            </section>
          );
        })}
      </div>}

      <p className="mt-10 text-zinc-600 text-sm">Share this URL to let others view the evaluation.</p>
    </main>
  );
}
