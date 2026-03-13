/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/room/[roomId]/setup/ai/page.tsx
 *
 * Sub-page: AI Picks flow
 *
 * PURPOSE:
 *   Lets the interviewer describe what kind of problem they want.
 *   AI finds 3 matching problems, interviewer picks one, AI rewrites it.
 *
 * UI STATE MACHINE:
 *   "form"      → Initial screen with filters
 *   "picking"   → Spinner while searching
 *   "cards"     → 3 problem cards to choose from
 *   "rewriting" → Spinner while AI rewrites
 *
 * GLASSMORPHISM (4 states):
 *   - form: glass container, violet accent button with glow
 *   - picking: spinner with amber glow shadow + glow-pulse behind
 *   - cards: glass-card with violet hover glow, staggered fade-in,
 *            difficulty badges with matching color glow, topic chips as bg-white/[0.05]
 *   - rewriting: spinner with violet glow
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { Problem, ProblemDifficulty } from "@/lib/store";
import { PROBLEM_TOPICS } from "@/lib/problem-topics";

// ── Types ────────────────────────────────────────────────────────────────────

/** One item returned by /api/ai/pick-problem */
interface PickedProblem {
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topics: string[];
  reasoning: string;
}

/** All possible states of the UI state machine */
type AiPickerState = "form" | "picking" | "cards" | "rewriting";

// ── Difficulty badge colour map ───────────────────────────────────────────────
// Each difficulty gets its own color scheme + subtle glow shadow

const DIFF_COLORS: Record<string, string> = {
  Easy: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]",
  Medium: "text-amber-400 bg-amber-400/10 border-amber-400/30 shadow-[0_0_8px_rgba(245,158,11,0.2)]",
  Hard: "text-red-400 bg-red-400/10 border-red-400/30 shadow-[0_0_8px_rgba(239,68,68,0.2)]",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function AiPickerPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;

  // ── Global state ──────────────────────────────────────────────────────────
  const company = typeof window !== "undefined"
    ? (localStorage.getItem("codelens_company") ?? "")
    : "";

  // ── State machine ─────────────────────────────────────────────────────────
  const [uiState, setUiState] = useState<AiPickerState>("form");

  // Filter form values
  const [difficulty, setDifficulty] = useState<"Any" | ProblemDifficulty>("Any");
  const [topic, setTopic] = useState("");
  const [hint, setHint] = useState("");

  // Results
  const [picks, setPicks] = useState<PickedProblem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ── Step 1 → 2: Find problems via vector search + Claude re-rank ──────────
  const findProblems = async () => {
    setError(null);
    setUiState("picking");

    try {
      const res = await fetch("/api/ai/pick-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ difficulty, topic, hint }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong finding problems.");
        setUiState("form");
        return;
      }

      setPicks(data.picks ?? []);
      setUiState("cards");
    } catch {
      setError("Network error — please try again.");
      setUiState("form");
    }
  };

  // ── Step 3 → done: Select a card, fetch full problem, rewrite, save ───────
  const selectProblem = async (pick: PickedProblem) => {
    setError(null);
    setUiState("rewriting");

    try {
      // 3a. Fetch full problem from LeetCode
      const importRes = await fetch("/api/import/leetcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `https://leetcode.com/problems/${pick.slug}/` }),
      });
      const importData = await importRes.json();

      if (!importRes.ok) {
        setError(importData.error ?? "Failed to fetch full problem from LeetCode.");
        setUiState("cards");
        return;
      }

      const fullProblem = importData as Problem;

      // 3b. Ask Claude to rewrite the title + description
      const rewriteRes = await fetch("/api/ai/rewrite-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: pick.slug,
          originalTitle: fullProblem.title,
          originalDescription: fullProblem.description,
          difficulty: fullProblem.difficulty ?? pick.difficulty,
          examples: fullProblem.examples,
          hiddenTests: fullProblem.hiddenTests,
        }),
      });
      const rewriteData = await rewriteRes.json();

      if (!rewriteRes.ok) {
        setError(rewriteData.error ?? "Problem rewrite failed.");
        setUiState("cards");
        return;
      }

      const rewrittenProblem: Problem = rewriteData.problem;

      // 3c. Save the rewritten problem to the room
      await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problem: rewrittenProblem,
          interviewerCompany: company.trim(),
        }),
      });

      // 3d. Navigate to the room
      router.push(`/room/${roomId}?role=interviewer`);
    } catch {
      setError("Something went wrong — please try again.");
      setUiState("cards");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen text-zinc-100 p-8 max-w-2xl mx-auto">

      {/* Back link (only shown when in form or cards state) */}
      {(uiState === "form" || uiState === "cards") && (
        <button
          onClick={() =>
            uiState === "cards" ? setUiState("form") : router.push(`/room/${roomId}/setup`)
          }
          className="text-sm text-zinc-400 hover:text-zinc-200 mb-6 flex items-center gap-1 transition-colors duration-300"
        >
          ← {uiState === "cards" ? "Back to filters" : "Back to setup"}
        </button>
      )}

      {/* ── STATE: form ─────────────────────────────────────────────────── */}
      {/* Glass container wrapping all filter controls.
       * Violet accent on the CTA button signals "AI / magic". */}
      {uiState === "form" && (
        <div className="animate-fade-in-up">
          <h1 className="text-2xl font-semibold">AI Problem Picker</h1>
          <p className="text-zinc-400 mt-1 text-sm">
            Describe what you want — AI will find 3 matching problems, you pick one, and AI
            rewrites it so the candidate can&apos;t Google it.
          </p>

          {error && (
            <div className="mt-4 p-3 rounded-lg glass border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="mt-6 p-6 rounded-xl glass">
            <div className="space-y-4">
              {/* Difficulty selector */}
              <div>
                <label className="block text-sm font-medium text-zinc-300">Difficulty</label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
                  className="mt-1 w-full rounded-lg glass-input px-3 py-2 text-zinc-100"
                >
                  <option value="Any">Any</option>
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
                </select>
              </div>

              {/* Topic selector */}
              <div>
                <label className="block text-sm font-medium text-zinc-300">Topic</label>
                <select
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="mt-1 w-full rounded-lg glass-input px-3 py-2 text-zinc-100"
                >
                  <option value="">Any topic</option>
                  {PROBLEM_TOPICS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Free-text hint */}
              <div>
                <label className="block text-sm font-medium text-zinc-300">
                  Hint{" "}
                  <span className="text-zinc-500 font-normal">(optional)</span>
                </label>
                <textarea
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  className="mt-1 w-full rounded-lg glass-input px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 min-h-[72px] resize-none"
                  placeholder={`e.g. "something creative, not Two Sum" or "good for mid-level engineers"`}
                />
              </div>
            </div>
          </div>

          {/* Violet CTA button with glow */}
          <button
            onClick={findProblems}
            className="mt-6 px-5 py-2.5 rounded-lg bg-violet-600 text-white font-medium
                       hover:bg-violet-500 transition-all duration-300
                       shadow-[0_0_20px_rgba(139,92,246,0.3)] hover:shadow-[0_0_30px_rgba(139,92,246,0.5)]"
          >
            Find problems ✨
          </button>
        </div>
      )}

      {/* ── STATE: picking ──────────────────────────────────────────────── */}
      {/* Spinner with amber glow shadow + glow-pulse aura behind it. */}
      {uiState === "picking" && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 animate-fade-in-up">
          <div className="relative">
            {/* Pulsing glow aura behind spinner */}
            <div className="absolute inset-0 w-10 h-10 rounded-full bg-amber-500/20 animate-glow-pulse blur-xl" />
            <div className="w-10 h-10 rounded-full border-4 border-amber-500/30 border-t-amber-500 animate-spin shadow-[0_0_20px_rgba(245,158,11,0.3)]" />
          </div>
          <p className="text-zinc-300 text-sm">Searching for matching problems…</p>
          <p className="text-zinc-500 text-xs">Running semantic search + Claude re-rank</p>
        </div>
      )}

      {/* ── STATE: cards ────────────────────────────────────────────────── */}
      {/* 3 problem cards with staggered fade-in entrance (0/100/200ms delay).
       * Each card is a glass-card with violet hover glow. */}
      {uiState === "cards" && (
        <div className="animate-fade-in-up">
          <h1 className="text-2xl font-semibold">Choose a problem</h1>
          <p className="text-zinc-400 mt-1 text-sm">
            AI found these 3 problems for your criteria. Pick one — it will be rewritten so the
            candidate can&apos;t Google it.
          </p>

          {error && (
            <div className="mt-4 p-3 rounded-lg glass border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="mt-6 space-y-4">
            {picks.map((pick, idx) => (
              <div
                key={pick.slug}
                className="p-5 glass-card hover:shadow-[0_0_30px_rgba(139,92,246,0.15)] hover:border-violet-500/30 transition-all duration-300"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                {/* Title + difficulty badge with matching color glow */}
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-zinc-100">{pick.title}</h2>
                  <span
                    className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${
                      DIFF_COLORS[pick.difficulty] ?? "text-zinc-400"
                    }`}
                  >
                    {pick.difficulty}
                  </span>
                </div>

                {/* Topic chips — semi-transparent glass-like pills */}
                {pick.topics.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pick.topics.map((t) => (
                      <span
                        key={t}
                        className="text-xs text-zinc-400 bg-white/[0.05] border border-white/[0.08] px-2 py-0.5 rounded-full"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Claude's reasoning */}
                <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
                  <span className="text-violet-400 font-medium">Why this: </span>
                  {pick.reasoning}
                </p>

                {/* Select button — violet glow */}
                <button
                  onClick={() => selectProblem(pick)}
                  className="mt-4 px-4 py-2 rounded-lg bg-violet-600/80 text-white text-sm font-medium
                             hover:bg-violet-600 transition-all duration-300
                             shadow-[0_0_15px_rgba(139,92,246,0.2)] hover:shadow-[0_0_25px_rgba(139,92,246,0.4)]"
                >
                  Select this problem
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── STATE: rewriting ────────────────────────────────────────────── */}
      {/* Spinner in violet to distinguish from "picking" step. */}
      {uiState === "rewriting" && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 animate-fade-in-up">
          <div className="relative">
            {/* Pulsing violet glow aura */}
            <div className="absolute inset-0 w-10 h-10 rounded-full bg-violet-500/20 animate-glow-pulse blur-xl" />
            <div className="w-10 h-10 rounded-full border-4 border-violet-500/30 border-t-violet-500 animate-spin shadow-[0_0_20px_rgba(139,92,246,0.3)]" />
          </div>
          <p className="text-zinc-300 text-sm">Rewriting problem for your interview…</p>
          <p className="text-zinc-500 text-xs">
            Claude is crafting a new scenario — examples and tests stay identical
          </p>
        </div>
      )}
    </main>
  );
}
