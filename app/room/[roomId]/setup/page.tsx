"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import type { Problem, ProblemExample, HiddenTest, ProblemDifficulty } from "@/lib/store";

const defaultExample: ProblemExample = { input: "", output: "", explanation: "" };
const defaultHidden: HiddenTest = { input: "", expectedOutput: "" };

export default function RoomSetupPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;

  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<ProblemDifficulty | "">("");
  const [examples, setExamples] = useState<ProblemExample[]>([{ ...defaultExample }]);
  const [hiddenTests, setHiddenTests] = useState<HiddenTest[]>([{ ...defaultHidden }]);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leetcodeUrl, setLeetcodeUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const roomLink = typeof window !== "undefined" ? `${window.location.origin}/room/${roomId}` : "";

  const addExample = () => setExamples((e) => [...e, { ...defaultExample }]);
  const removeExample = (i: number) => setExamples((e) => e.filter((_, j) => j !== i));
  const updateExample = (i: number, field: keyof ProblemExample, value: string) => {
    setExamples((e) => e.map((ex, j) => (j === i ? { ...ex, [field]: value } : ex)));
  };

  const addHidden = () => setHiddenTests((h) => [...h, { ...defaultHidden }]);
  const removeHidden = (i: number) => setHiddenTests((h) => h.filter((_, j) => j !== i));
  const updateHidden = (i: number, field: keyof HiddenTest, value: string) => {
    setHiddenTests((h) => h.map((t, j) => (j === i ? { ...t, [field]: value } : t)));
  };

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomLink]);

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
        problem.hiddenTests?.length > 0
          ? problem.hiddenTests
          : [{ ...defaultHidden }]
      );
      if (problem.difficulty) setDifficulty(problem.difficulty);
      setLeetcodeUrl("");
    } finally {
      setImporting(false);
    }
  };

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
        // Save the problem and the company name together in one request.
        body: JSON.stringify({ problem, interviewerCompany: company.trim() }),
      });
      router.push(`/room/${roomId}?role=interviewer`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">Configure problem</h1>
      <p className="text-zinc-400 mt-1">Room: {roomId}</p>

      <div className="mt-6 p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
        <label className="block text-sm font-medium text-zinc-300">Import from LeetCode</label>
        <p className="text-xs text-zinc-500 mt-0.5">Paste a problem URL to fill title, description, and examples.</p>
        <div className="mt-2 flex gap-2">
          <input
            value={leetcodeUrl}
            onChange={(e) => setLeetcodeUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchFromLeetCode()}
            placeholder="https://leetcode.com/problems/two-sum/"
            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm placeholder:text-zinc-500"
            disabled={importing}
          />
          <button
            type="button"
            onClick={fetchFromLeetCode}
            disabled={importing || !leetcodeUrl.trim()}
            className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/50 text-sm font-medium hover:bg-amber-500/30 disabled:opacity-50 disabled:pointer-events-none"
          >
            {importing ? "Fetching…" : "Fetch problem"}
          </button>
        </div>
        {importError && (
          <p className="mt-2 text-sm text-red-400">{importError}</p>
        )}
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300">Your company name</label>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2"
            placeholder="e.g. Acme Corp"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2"
            placeholder="e.g. Two Sum"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300">Difficulty</label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as ProblemDifficulty | "")}
            className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100"
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
            className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 min-h-[120px]"
            placeholder="Problem statement..."
          />
        </div>

        <div>
          <div className="flex justify-between items-center">
            <label className="block text-sm font-medium text-zinc-300">Examples (visible to candidate)</label>
            <button type="button" onClick={addExample} className="text-sm text-amber-500 hover:underline">
              + Add
            </button>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Input is passed as raw stdin — write just the value, e.g. <code className="bg-zinc-800 px-1 rounded">4</code> not <code className="bg-zinc-800 px-1 rounded">x=4</code>.
            Multi-line inputs are fine (one value per line).
          </p>
          {examples.map((ex, i) => (
            <div key={i} className="mt-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700 space-y-2">
              <input
                value={ex.input}
                onChange={(e) => updateExample(i, "input", e.target.value)}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-sm"
                placeholder="Input"
              />
              <input
                value={ex.output}
                onChange={(e) => updateExample(i, "output", e.target.value)}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-sm"
                placeholder="Expected output"
              />
              <input
                value={ex.explanation ?? ""}
                onChange={(e) => updateExample(i, "explanation", e.target.value)}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-sm"
                placeholder="Explanation (optional)"
              />
              {examples.length > 1 && (
                <button type="button" onClick={() => removeExample(i)} className="text-sm text-red-400 hover:underline">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div>
          <div className="flex justify-between items-center">
            <label className="block text-sm font-medium text-zinc-300">Hidden test cases</label>
            <button type="button" onClick={addHidden} className="text-sm text-amber-500 hover:underline">
              + Add
            </button>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Same stdin format — raw value only, e.g. <code className="bg-zinc-800 px-1 rounded">8</code>.
            These are not shown to the candidate until after submission.
          </p>
          {hiddenTests.map((h, i) => (
            <div key={i} className="mt-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700 space-y-2">
              <input
                value={h.input}
                onChange={(e) => updateHidden(i, "input", e.target.value)}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-sm"
                placeholder="Input"
              />
              <input
                value={h.expectedOutput}
                onChange={(e) => updateHidden(i, "expectedOutput", e.target.value)}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-sm"
                placeholder="Expected output"
              />
              {hiddenTests.length > 1 && (
                <button type="button" onClick={() => removeHidden(i)} className="text-sm text-red-400 hover:underline">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-4 items-center">
        <button
          onClick={saveAndGo}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-amber-500 text-zinc-950 font-medium hover:bg-amber-400 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save & go to room"}
        </button>
        <div className="flex items-center gap-2">
          <input readOnly value={roomLink} className="w-72 rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-400" />
          <button
            onClick={copyLink}
            className="px-3 py-1 rounded bg-zinc-700 text-sm hover:bg-zinc-600"
          >
            {copied ? "Copied" : "Copy room link"}
          </button>
        </div>
      </div>
    </main>
  );
}
