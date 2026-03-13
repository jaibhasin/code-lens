/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/room/[roomId]/setup/page.tsx
 *
 * The problem-picker landing page — first screen an interviewer sees after
 * creating a room.
 *
 * PURPOSE:
 *   Presents 3 cards so the interviewer can choose HOW to source the problem.
 *
 * THREE PATHS:
 *   1. LeetCode URL  → /room/[roomId]/setup/leetcode
 *   2. Enter Manually → /room/[roomId]/setup/manual
 *   3. AI Picks      → /room/[roomId]/setup/ai
 *
 * COMPANY NAME:
 *   The "Your company name" field lives HERE (on the landing page) so it is
 *   entered once regardless of which path is taken.
 *   Saved to localStorage key "codelens_company" on every keystroke.
 *   Sub-pages read it from localStorage on mount.
 *
 * GLASSMORPHISM:
 *   - Company input uses .glass-input with amber focus glow
 *   - Path cards use .glass-card with per-card accent glow on hover
 *     (LeetCode=amber, Manual=white/subtle, AI=violet)
 *   - CTA buttons have backdrop-blur + matching accent glow
 *   - hover:scale-[1.01] micro-animation on cards
 *   - Entire page wrapped in animate-fade-in-up
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

// ── Card definitions ─────────────────────────────────────────────────────────
// Each card represents one problem-source path.
// `glowClass` controls the hover glow color per card.

const PATHS = [
  {
    id: "leetcode",
    icon: "🔗",
    title: "LeetCode URL",
    description:
      "Paste a LeetCode problem URL. We'll scrape the title, description, and examples automatically.",
    cta: "Import from LeetCode",
    /* Amber glow on hover — matches the LeetCode brand warmth */
    glowClass: "hover:shadow-[0_0_30px_rgba(245,158,11,0.15)] hover:border-amber-500/40",
    ctaClass:
      "bg-amber-500/20 text-amber-400 border border-amber-500/50 hover:bg-amber-500/30 backdrop-blur-sm",
  },
  {
    id: "manual",
    icon: "✏️",
    title: "Write Manually",
    description:
      "Author a completely custom problem — title, description, examples, and hidden test cases.",
    cta: "Write a problem",
    /* Subtle white glow — neutral path, no strong brand color */
    glowClass: "hover:shadow-[0_0_30px_rgba(255,255,255,0.05)] hover:border-zinc-400/40",
    ctaClass:
      "bg-white/[0.06] text-zinc-200 border border-white/[0.1] hover:bg-white/[0.1] backdrop-blur-sm",
  },
  {
    id: "ai",
    icon: "✨",
    title: "AI Picks",
    description:
      "Describe what you want — difficulty, topic, optional hint. AI finds 3 matching problems, you pick one, AI rewrites it so the candidate can't Google it.",
    cta: "Let AI pick",
    /* Violet glow on hover — signals "AI / magic" */
    glowClass: "hover:shadow-[0_0_30px_rgba(139,92,246,0.15)] hover:border-violet-500/40",
    ctaClass:
      "bg-violet-500/20 text-violet-300 border border-violet-500/50 hover:bg-violet-500/30 backdrop-blur-sm",
  },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

export default function SetupLandingPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;

  /* Company name — persisted to localStorage so sub-pages can read it.
   * Initialised lazily from localStorage (no useEffect needed). */
  const [company, setCompany] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("codelens_company") ?? "";
  });

  // Persist every keystroke to localStorage
  const handleCompanyChange = (val: string) => {
    setCompany(val);
    localStorage.setItem("codelens_company", val);
  };

  /* Navigate to the selected sub-page.
   * Each sub-page reads company from localStorage and roomId from useParams(). */
  const goTo = (subPath: string) => {
    router.push(`/room/${roomId}/setup/${subPath}`);
  };

  return (
    <main className="min-h-screen text-zinc-100 p-8 max-w-2xl mx-auto animate-fade-in-up">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <h1 className="text-2xl font-semibold">Set up the interview</h1>
      <p className="text-zinc-400 mt-1 text-sm">Room: {roomId}</p>

      {/* ── Company name ─────────────────────────────────────────────────── */}
      {/* Saved to localStorage so the chosen sub-page can pre-fill it. */}
      <div className="mt-6">
        <label className="block text-sm font-medium text-zinc-300">
          Your company name
        </label>
        <input
          value={company}
          onChange={(e) => handleCompanyChange(e.target.value)}
          className="mt-1 w-full rounded-lg glass-input px-3 py-2 text-sm placeholder:text-zinc-500 text-zinc-100"
          placeholder="e.g. Acme Corp"
        />
      </div>

      {/* ── Path cards ───────────────────────────────────────────────────── */}
      <div className="mt-8 space-y-3">
        <p className="text-sm text-zinc-400 font-medium uppercase tracking-wider mb-4">
          How do you want to choose the problem?
        </p>

        {PATHS.map((path) => (
          <div
            key={path.id}
            className={`p-5 glass-card cursor-pointer ${path.glowClass} transition-all duration-300`}
            onClick={() => goTo(path.id)}
          >
            <div className="flex items-start justify-between gap-4">
              {/* Left: icon + text */}
              <div className="flex gap-4 items-start">
                <span className="text-2xl select-none">{path.icon}</span>
                <div>
                  <h2 className="text-base font-semibold text-zinc-100">
                    {path.title}
                  </h2>
                  <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
                    {path.description}
                  </p>
                </div>
              </div>

              {/* Right: CTA button */}
              <button
                type="button"
                onClick={(e) => {
                  // Prevent double-fire from card's onClick
                  e.stopPropagation();
                  goTo(path.id);
                }}
                className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${path.ctaClass}`}
              >
                {path.cta}
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
