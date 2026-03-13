/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/room/[roomId]/setup/manual/page.tsx
 *
 * Sub-page: Manual problem entry path
 *
 * PURPOSE:
 *   Interviewer writes a completely custom problem from scratch.
 *   Same fields as the old setup form, extracted into its own route.
 *
 * GLASSMORPHISM:
 *   - Glass container wraps the entire form area
 *   - All inputs/textareas/selects use .glass-input with amber focus glow
 *   - Example/test groups: nested glass panels (bg-white/[0.03] border-white/[0.08])
 *   - Save button: amber glow shadow
 *   - Back link: smooth color transition
 *   - Page entrance: animate-fade-in-up
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import type { Problem, ProblemExample, HiddenTest, ProblemDifficulty } from "@/lib/store";

const defaultExample: ProblemExample = { input: "", output: "", explanation: "" };
const defaultHidden: HiddenTest = { input: "", expectedOutput: "" };

export default function ManualSetupPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;

  // ── State ────────────────────────────────────────────────────────────────
  const [company, setCompany] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("codelens_company") ?? "";
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<ProblemDifficulty | "">("");
  const [examples, setExamples] = useState<ProblemExample[]>([{ ...defaultExample }]);
  const [hiddenTests, setHiddenTests] = useState<HiddenTest[]>([{ ...defaultHidden }]);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCompanyChange = (val: string) => {
    setCompany(val);
    localStorage.setItem("codelens_company", val);
  };

  // ── Example helpers ───────────────────────────────────────────────────────
  const addExample = () => setExamples((e) => [...e, { ...defaultExample }]);
  const removeExample = (i: number) => setExamples((e) => e.filter((_, j) => j !== i));
  const updateExample = (i: number, field: keyof ProblemExample, value: string) =>
    setExamples((e) => e.map((ex, j) => (j === i ? { ...ex, [field]: value } : ex)));

  // ── Hidden test helpers ───────────────────────────────────────────────────
  const addHidden = () => setHiddenTests((h) => [...h, { ...defaultHidden }]);
  const removeHidden = (i: number) => setHiddenTests((h) => h.filter((_, j) => j !== i));
  const updateHidden = (i: number, field: keyof HiddenTest, value: string) =>
    setHiddenTests((h) => h.map((t, j) => (j === i ? { ...t, [field]: value } : t)));

  // ── Room link copy ────────────────────────────────────────────────────────
  const roomLink =
    typeof window !== "undefined" ? `${window.location.origin}/room/${roomId}` : "";

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomLink]);

  // ── Save & go ─────────────────────────────────────────────────────────────
  const saveAndGo = async () => {
    setSaving(true);
    const problem: Problem = {
      title: title.trim(),
      description: description.trim(),
      examples: examples.filter((e) => e.input.trim() || e.output.trim()),
      hiddenTests: hiddenTests.filter((h) => h.input.trim() || h.expectedOutput.trim()),
      ...(difficulty ? { difficulty } : {}),
    };
    try {
      await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem, interviewerCompany: company.trim() }),
      });
      router.push(`/room/${roomId}?role=interviewer`);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen text-zinc-100 p-8 max-w-3xl mx-auto animate-fade-in-up">

      {/* Back link — smooth color transition on hover */}
      <button
        onClick={() => router.push(`/room/${roomId}/setup`)}
        className="text-sm text-zinc-400 hover:text-zinc-200 mb-6 flex items-center gap-1 transition-colors duration-300"
      >
        ← Back to setup
      </button>

      <h1 className="text-2xl font-semibold">Write a custom problem</h1>
      <p className="text-zinc-400 mt-1 text-sm">Room: {roomId}</p>

      {/* ── Glass container wrapping the entire form ───────────────────── */}
      <div className="mt-6 p-6 rounded-xl glass">
        <div className="space-y-4">

          {/* Company name */}
          <div>
            <label className="block text-sm font-medium text-zinc-300">Your company name</label>
            <input
              value={company}
              onChange={(e) => handleCompanyChange(e.target.value)}
              className="mt-1 w-full rounded-lg glass-input px-3 py-2 text-zinc-100 placeholder:text-zinc-500"
              placeholder="e.g. Acme Corp"
            />
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-zinc-300">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg glass-input px-3 py-2 text-zinc-100 placeholder:text-zinc-500"
              placeholder="e.g. Two Sum"
            />
          </div>

          {/* Difficulty */}
          <div>
            <label className="block text-sm font-medium text-zinc-300">Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as ProblemDifficulty | "")}
              className="mt-1 w-full rounded-lg glass-input px-3 py-2 text-zinc-100"
            >
              <option value="">Not specified</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-zinc-300">Description (markdown)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg glass-input px-3 py-2 min-h-[120px] text-zinc-100 placeholder:text-zinc-500"
              placeholder="Problem statement..."
            />
          </div>

          {/* Examples — nested glass panels for visual grouping */}
          <div>
            <div className="flex justify-between items-center">
              <label className="block text-sm font-medium text-zinc-300">
                Examples (visible to candidate)
              </label>
              <button type="button" onClick={addExample} className="text-sm text-amber-500 hover:underline">
                + Add
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Input is passed as raw stdin — write just the value, e.g.{" "}
              <code className="bg-white/[0.05] px-1 rounded">4</code> not{" "}
              <code className="bg-white/[0.05] px-1 rounded">x=4</code>.
            </p>
            {examples.map((ex, i) => (
              <div key={i} className="mt-2 p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] space-y-2">
                <input
                  value={ex.input}
                  onChange={(e) => updateExample(i, "input", e.target.value)}
                  className="w-full rounded glass-input px-2 py-1 text-sm text-zinc-100"
                  placeholder="Input"
                />
                <input
                  value={ex.output}
                  onChange={(e) => updateExample(i, "output", e.target.value)}
                  className="w-full rounded glass-input px-2 py-1 text-sm text-zinc-100"
                  placeholder="Expected output"
                />
                <input
                  value={ex.explanation ?? ""}
                  onChange={(e) => updateExample(i, "explanation", e.target.value)}
                  className="w-full rounded glass-input px-2 py-1 text-sm text-zinc-100"
                  placeholder="Explanation (optional)"
                />
                {examples.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeExample(i)}
                    className="text-sm text-red-400 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Hidden tests — same nested glass panel style */}
          <div>
            <div className="flex justify-between items-center">
              <label className="block text-sm font-medium text-zinc-300">Hidden test cases</label>
              <button type="button" onClick={addHidden} className="text-sm text-amber-500 hover:underline">
                + Add
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Same stdin format — raw value only. These are not shown until after submission.
            </p>
            {hiddenTests.map((h, i) => (
              <div key={i} className="mt-2 p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] space-y-2">
                <input
                  value={h.input}
                  onChange={(e) => updateHidden(i, "input", e.target.value)}
                  className="w-full rounded glass-input px-2 py-1 text-sm text-zinc-100"
                  placeholder="Input"
                />
                <input
                  value={h.expectedOutput}
                  onChange={(e) => updateHidden(i, "expectedOutput", e.target.value)}
                  className="w-full rounded glass-input px-2 py-1 text-sm text-zinc-100"
                  placeholder="Expected output"
                />
                {hiddenTests.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeHidden(i)}
                    className="text-sm text-red-400 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Save — amber glow button */}
      <div className="mt-8 flex flex-wrap gap-4 items-center">
        <button
          onClick={saveAndGo}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-amber-500 text-zinc-950 font-medium
                     hover:bg-amber-400 disabled:opacity-50 transition-all duration-300
                     shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)]"
        >
          {saving ? "Saving…" : "Save & go to room"}
        </button>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={roomLink}
            className="w-72 rounded glass-input px-2 py-1 text-sm text-zinc-400"
          />
          <button
            onClick={copyLink}
            className="px-3 py-1 rounded bg-white/[0.06] border border-white/[0.1] text-sm hover:bg-white/[0.1] transition-colors"
          >
            {copied ? "Copied" : "Copy room link"}
          </button>
        </div>
      </div>
    </main>
  );
}
