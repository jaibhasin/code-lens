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
    <main className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100">
      <h1 className="text-3xl font-semibold tracking-tight">CodeLens</h1>
      <p className="mt-2 text-zinc-400 text-center max-w-sm">
        Where Engineers Are Forged Under Pressure
      </p>
      <button
        onClick={handleCreateRoom}
        disabled={loading}
        className="mt-8 px-6 py-3 rounded-lg bg-amber-500 text-zinc-950 font-medium hover:bg-amber-400 disabled:opacity-50 transition"
      >
        {loading ? "Creating…" : "Create Room"}
      </button>
    </main>
  );
}
