/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/page.tsx — Home / Landing Page
 *
 * The first screen users see. Single CTA to create a room.
 *
 * GLASSMORPHISM HIGHLIGHTS:
 *   - Hero title uses .text-gradient (amber → violet)
 *   - Blurred glow orb behind the title for ambient depth
 *   - CTA button has amber glow shadow that intensifies on hover
 *   - Subtle dot-grid background pattern overlay
 *   - Entire content block fades in with animate-fade-in-up
 * ───────────────────────────────────────────────────────────────────────────── */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleCreateRoom() {
    setLoading(true);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const { roomId } = await res.json();
      if (roomId) router.push(`/room/${roomId}/setup`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-zinc-100 relative overflow-hidden">

      {/* ── Subtle dot-grid background pattern ──────────────────────────── */}
      {/* Creates a fine repeating dot pattern via radial-gradient.
       * Low opacity so it adds texture without competing with content. */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* ── Ambient glow orb ────────────────────────────────────────────── */}
      {/* Blurred gradient blob positioned behind the title.
       * animate-float gives it a gentle bobbing motion for life. */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] rounded-full bg-gradient-to-br from-amber-500/20 via-violet-500/10 to-transparent blur-3xl animate-float pointer-events-none" />

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center animate-fade-in-up">
        {/* Hero title — large, bold, gradient text */}
        <h1 className="text-5xl font-bold tracking-tight text-gradient">
          CodeLens
        </h1>

        <p className="mt-3 text-zinc-400 text-center max-w-sm text-lg">
          Where Engineers Are Forged Under Pressure
        </p>

        {/* CTA button — amber with glow shadow.
         * Hover intensifies the glow and slightly scales up.
         * transition-all ensures smooth state changes. */}
        <button
          onClick={handleCreateRoom}
          disabled={loading}
          className="mt-10 px-8 py-3.5 rounded-xl bg-amber-500 text-zinc-950 font-semibold text-lg
                     shadow-[0_0_20px_rgba(245,158,11,0.3)]
                     hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] hover:scale-[1.02]
                     disabled:opacity-50 transition-all duration-300"
        >
          {loading ? "Creating…" : "Create Room"}
        </button>
      </div>
    </main>
  );
}
