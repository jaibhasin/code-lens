/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/room/[roomId]/debrief/page.tsx — Evaluation / Debrief Page
 *
 * Displays the AI-generated interview evaluation after a session ends.
 *
 * ROLE-BASED VIEWS:
 *   - Interviewer (default): full view with all scores, analysis, integrity
 *   - Candidate (?role=candidate): simplified — score, verdict, summary only
 *
 * GLASSMORPHISM:
 *   - All section cards: .glass replacing bg-zinc-900/60 border-zinc-800
 *   - Staggered entrance: each card gets animate-fade-in-up with incremental delay
 *   - ScoreBar: glow shadow matching bar color, track is bg-white/[0.06]
 *   - ScoreDot: filled dots get amber glow shadow-[0_0_6px], empty dots bg-white/[0.08]
 *   - HireSignalBadge: matching color glow shadow
 *   - Integrity flags: glass card with red glow accent
 *   - Loading state: glass wrapper + spinner glow
 * ─────────────────────────────────────────────────────────────────────────────
 */

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
  structured_thinking_score?: number;
  overall_score?: number;
  hire_signal?: string;
  hire_reasoning?: string;
  summary?: string;
  code_evolution_analysis?: string;
  integrity_score?: number;
  integrity_flags?: string[];
  strengths?: string[];
  weaknesses?: string[];
  status?: string;
  error?: string;
}

/* ── ScoreDot ──────────────────────────────────────────────────────────────
 * Renders a row of dots (filled/empty) to visualize a score.
 * Filled dots get an amber neon glow; empty dots are subtle glass. */
function ScoreDot({ score, max }: { score: number; max: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={`w-2.5 h-2.5 rounded-full ${
            i < score
              ? "bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.5)]"
              : "bg-white/[0.08]"
          }`}
        />
      ))}
    </div>
  );
}

/* ── ScoreBar ──────────────────────────────────────────────────────────────
 * Horizontal progress bar with color-coded fill + matching glow shadow.
 * Track uses glass-themed bg-white/[0.06]. */
function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = Math.round((score / max) * 100);
  const color =
    pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  /* Glow shadow matches the bar color for a neon effect */
  const glow =
    pct >= 70
      ? "shadow-[0_0_10px_rgba(16,185,129,0.3)]"
      : pct >= 40
      ? "shadow-[0_0_10px_rgba(245,158,11,0.3)]"
      : "shadow-[0_0_10px_rgba(239,68,68,0.3)]";
  return (
    <div className="w-full bg-white/[0.06] rounded-full h-1.5">
      <div
        className={`h-1.5 rounded-full transition-all ${color} ${glow}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ── HireSignalBadge ───────────────────────────────────────────────────────
 * Color-coded badge with matching glow shadow for the hire verdict. */
function HireSignalBadge({ signal }: { signal: string }) {
  const config: Record<string, { cls: string; glow: string }> = {
    "Strong Hire": {
      cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
      glow: "shadow-[0_0_15px_rgba(16,185,129,0.2)]",
    },
    "Hire": {
      cls: "bg-blue-500/20 text-blue-300 border-blue-500/40",
      glow: "shadow-[0_0_15px_rgba(59,130,246,0.2)]",
    },
    "No Hire": {
      cls: "bg-amber-500/20 text-amber-300 border-amber-500/40",
      glow: "shadow-[0_0_15px_rgba(245,158,11,0.2)]",
    },
    "Strong No Hire": {
      cls: "bg-red-500/20 text-red-300 border-red-500/40",
      glow: "shadow-[0_0_15px_rgba(239,68,68,0.2)]",
    },
  };
  const c = config[signal] ?? { cls: "bg-zinc-700 text-zinc-300 border-zinc-600", glow: "" };
  return (
    <span className={`inline-block px-3 py-1 rounded-full border text-sm font-semibold ${c.cls} ${c.glow}`}>
      {signal}
    </span>
  );
}

export default function DebriefPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const viewRole = searchParams.get("role") === "candidate" ? "candidate" : "interviewer";
  const [room, setRoom] = useState<Room | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const startTime = Date.now();

    const load = async () => {
      const r = await fetch(`/api/rooms/${roomId}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      if (!r) return;
      setRoom(r);
      const debrief = r.debrief as Debrief | null;
      if (debrief && debrief.status !== "generating") {
        clearInterval(id);
      }
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

  // ── Loading state — glass wrapper with glowing spinner ──────────────────
  if (!isReady) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="p-10 rounded-2xl glass flex flex-col items-center gap-4 animate-fade-in-up">
          <div className="relative">
            <div className="absolute inset-0 w-6 h-6 rounded-full bg-amber-500/20 animate-glow-pulse blur-xl" />
            <svg className="animate-spin w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
          <p className="text-zinc-400">Generating evaluation…</p>
          {timedOut && (
            <p className="text-amber-400 text-sm mt-2">
              This is taking longer than expected. The AI evaluation may have failed — try refreshing the page.
            </p>
          )}
        </div>
      </main>
    );
  }

  const safeRoom = room as Room;
  const d = safeRoom.debrief as Debrief;

  if (d.error) {
    return (
      <main className="min-h-screen p-8 max-w-3xl mx-auto">
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
    <main className="min-h-screen p-8 max-w-3xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1 animate-fade-in-up">
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

      {/* ── Verdict card — glass panel ─────────────────────────────────── */}
      <div className="mt-6 p-5 rounded-xl glass flex flex-col gap-4 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
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
          <p className="text-zinc-300 text-sm leading-relaxed border-t border-white/[0.06] pt-4">
            {d.summary}
          </p>
        )}
      </div>

      {/* ── Strengths & Weaknesses — glass panel ───────────────────────── */}
      {((d.strengths && d.strengths.length > 0) || (d.weaknesses && d.weaknesses.length > 0)) && (
        <div className="mt-6 p-5 rounded-xl glass animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-4">
            Strengths & Weaknesses
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

      {/* ── Dimension scores — interviewer only, glass panel ────────────── */}
      {viewRole === "interviewer" && dimensions.some((d) => typeof d.score === "number") && (
        <div className="mt-6 p-5 rounded-xl glass animate-fade-in-up" style={{ animationDelay: "300ms" }}>
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

      {/* ── Integrity — interviewer only, glass + red glow accents ──────── */}
      {viewRole === "interviewer" && typeof d.integrity_score === "number" && (
        <div className="mt-6 p-5 rounded-xl glass animate-fade-in-up" style={{ animationDelay: "400ms" }}>
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
            <div className="mt-4 p-3 rounded-lg bg-red-500/[0.06] border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.08)]">
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

      {/* ── Hire reasoning — interviewer only ───────────────────────────── */}
      {viewRole === "interviewer" && d.hire_reasoning && (
        <div className="mt-6 p-5 rounded-xl glass animate-fade-in-up" style={{ animationDelay: "500ms" }}>
          <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-3">
            Reasoning
          </h2>
          <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{d.hire_reasoning}</p>
        </div>
      )}

      {/* ── Qualitative sections — interviewer only ─────────────────────── */}
      {viewRole === "interviewer" && <div className="mt-6 space-y-5">
        {[
          { key: "approach_analysis", label: "Approach & Algorithm", score: d.approach_score, max: 5 },
          { key: "problem_solving_behavior", label: "Problem-Solving Behavior", score: d.problem_solving_score, max: 5 },
          { key: "code_quality", label: "Code Quality", score: d.code_quality_score, max: 5 },
          { key: "time_breakdown", label: "Time Breakdown" },
          { key: "code_evolution_analysis", label: "Code Evolution" },
        ].map(({ key, label, score, max }, idx) => {
          const text = d[key as keyof Debrief] as string | undefined;
          if (!text) return null;
          return (
            <section
              key={key}
              className="p-5 rounded-xl glass animate-fade-in-up"
              style={{ animationDelay: `${600 + idx * 100}ms` }}
            >
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
