/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/room/[roomId]/setup/leetcode/page.tsx
 *
 * Sub-page: LeetCode URL import path
 *
 * PURPOSE:
 *   Interviewer pastes a LeetCode problem URL. We hit /api/import/leetcode
 *   to scrape the real problem, auto-fill all fields, then let the interviewer
 *   review/tweak before saving to the room.
 *
 * GLASSMORPHISM:
 *   - Import card: glass panel with amber border glow
 *   - Fetch button: amber glass glow
 *   - Success message: glass card with emerald glow, fade-in animation
 *   - All editable fields: glass-input treatment
 *   - Page entrance: animate-fade-in-up
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import type { Problem, ProblemExample, HiddenTest, ProblemDifficulty } from "@/lib/store";

const defaultExample: ProblemExample = { input: "", output: "", explanation: "" };
const defaultHidden: HiddenTest = { input: "", expectedOutput: "" };

export default function LeetCodeSetupPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;

  // ── State ────────────────────────────────────────────────────────────────
  const [company, setCompany] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("codelens_company") ?? "";
  });
  const [leetcodeUrl, setLeetcodeUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Problem fields (editable after import)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<ProblemDifficulty | "">("");
  const [examples, setExamples] = useState<ProblemExample[]>([{ ...defaultExample }]);
  const [hiddenTests, setHiddenTests] = useState<HiddenTest[]>([{ ...defaultHidden }]);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Whether a problem has been successfully imported (shows the edit form). */
  const [imported, setImported] = useState(false);

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

  // ── LeetCode import ───────────────────────────────────────────────────────
  const fetchFromLeetCode = async () => {
    if (!leetcodeUrl.trim()) return;
    setImportError(null);
    setImporting(true);
    try {
      const res = await fetch("/api/import/leetcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: leetcodeUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Failed to fetch problem");
        return;
      }
      const problem = data as Problem;
      setTitle(problem.title);
      setDescription(problem.description);
      setExamples(
        problem.examples.length > 0
          ? problem.examples.map((e) => ({ ...e, explanation: e.explanation ?? "" }))
          : [{ ...defaultExample }]
      );
      setHiddenTests(
        problem.hiddenTests?.length > 0 ? problem.hiddenTests : [{ ...defaultHidden }]
      );
      if (problem.difficulty) setDifficulty(problem.difficulty);
      setLeetcodeUrl("");
      setImported(true);
    } finally {
      setImporting(false);
    }
  };

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

      {/* Back link */}
      <button
        onClick={() => router.push(`/room/${roomId}/setup`)}
        className="text-sm text-zinc-400 hover:text-zinc-200 mb-6 flex items-center gap-1 transition-colors duration-300"
      >
        ← Back to setup
      </button>

      <h1 className="text-2xl font-semibold">Import from LeetCode</h1>
      <p className="text-zinc-400 mt-1 text-sm">Room: {roomId}</p>

      {/* Company name */}
      <div className="mt-6">
        <label className="block text-sm font-medium text-zinc-300">Your company name</label>
        <input
          value={company}
          onChange={(e) => handleCompanyChange(e.target.value)}
          className="mt-1 w-full rounded-lg glass-input px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
          placeholder="e.g. Acme Corp"
        />
      </div>

      {/* LeetCode URL input — glass card with amber accent border */}
      <div className="mt-6 p-4 rounded-xl glass border-amber-500/20">
        <label className="block text-sm font-medium text-zinc-300">LeetCode problem URL</label>
        <p className="text-xs text-zinc-500 mt-0.5">
          Paste a problem URL to fill title, description, examples, and difficulty.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={leetcodeUrl}
            onChange={(e) => setLeetcodeUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchFromLeetCode()}
            placeholder="https://leetcode.com/problems/two-sum/"
            className="flex-1 rounded-lg glass-input px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
            disabled={importing}
          />
          {/* Fetch button — amber glow shadow */}
          <button
            type="button"
            onClick={fetchFromLeetCode}
            disabled={importing || !leetcodeUrl.trim()}
            className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/50 text-sm font-medium
                       hover:bg-amber-500/30 disabled:opacity-50 disabled:pointer-events-none transition-all duration-300
                       shadow-[0_0_15px_rgba(245,158,11,0.15)] hover:shadow-[0_0_25px_rgba(245,158,11,0.3)]"
          >
            {importing ? "Fetching…" : "Fetch problem"}
          </button>
        </div>
        {importError && <p className="mt-2 text-sm text-red-400">{importError}</p>}
      </div>

      {/* Editable fields — shown only after a successful import */}
      {imported && (
        <div className="mt-6 space-y-4 animate-fade-in-up">

          {/* Success message — glass card with emerald glow */}
          <div className="p-3 rounded-lg glass border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
            <p className="text-sm text-emerald-400">
              ✓ Problem imported — review and edit below before saving.
            </p>
          </div>

          <div className="p-6 rounded-xl glass">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg glass-input px-3 py-2 text-zinc-100"
                />
              </div>

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

              <div>
                <label className="block text-sm font-medium text-zinc-300">Description (markdown)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg glass-input px-3 py-2 min-h-[140px] text-sm text-zinc-100"
                />
              </div>

              {/* Examples */}
              <div>
                <div className="flex justify-between items-center">
                  <label className="block text-sm font-medium text-zinc-300">
                    Examples (visible to candidate)
                  </label>
                  <button type="button" onClick={addExample} className="text-sm text-amber-500 hover:underline">
                    + Add
                  </button>
                </div>
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

              {/* Hidden tests */}
              <div>
                <div className="flex justify-between items-center">
                  <label className="block text-sm font-medium text-zinc-300">Hidden test cases</label>
                  <button type="button" onClick={addHidden} className="text-sm text-amber-500 hover:underline">
                    + Add
                  </button>
                </div>
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
        </div>
      )}
    </main>
  );
}
