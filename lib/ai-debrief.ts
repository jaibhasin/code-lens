/**
 * ai-debrief.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a structured AI debrief for a completed coding interview session.
 *
 * Architecture:
 *  1. Helper functions compress raw session data (timeline, snapshots, runs)
 *     into a concise prompt that fits within the model's context window.
 *  2. buildUserPrompt() assembles the full prompt with all compressed data.
 *  3. generateDebrief() calls Claude Sonnet 4.6 via the Anthropic SDK and
 *     returns a validated JSON object with scores, flags, and narrative fields.
 *
 * Environment variable required:
 *   ANTHROPIC_API_KEY — set in .env.local (never commit this file)
 *
 * Model: claude-sonnet-4-6 (fast, cost-effective, strong reasoning)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Room, TimelineEvent } from "./store";

/* ─── Anthropic client (reads ANTHROPIC_API_KEY from env automatically) ─── */
const anthropic = new Anthropic();

// ─── Timeline helpers ───────────────────────────────────────────────────────

function compressTimelineMiddle(events: TimelineEvent[]): string {
  if (events.length === 0) return "(no events)";

  const buckets = new Map<string, Record<string, number>>();

  for (const ev of events) {
    const ms = new Date(ev.timestamp).getTime();
    const bucketKey = `${Math.floor(ms / 300_000) * 300_000}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, {});
    const b = buckets.get(bucketKey)!;
    b[ev.event] = (b[ev.event] ?? 0) + 1;
  }

  return Array.from(buckets.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([ts, counts]) => {
      const label = new Date(Number(ts)).toISOString();
      const summary = Object.entries(counts)
        .map(([k, v]) => `${k}×${v}`)
        .join(", ");
      return `  ${label}: ${summary}`;
    })
    .join("\n");
}

function buildSmartTimeline(timeline: TimelineEvent[]): string {
  const FIRST = 10;
  const LAST = 20;

  if (timeline.length <= FIRST + LAST) {
    return JSON.stringify(timeline, null, 2);
  }

  const first = timeline.slice(0, FIRST);
  const middle = timeline.slice(FIRST, timeline.length - LAST);
  const last = timeline.slice(timeline.length - LAST);

  return [
    "=== First events (full detail) ===",
    JSON.stringify(first, null, 2),
    "",
    "=== Middle session (compressed — counts per 5-min window) ===",
    compressTimelineMiddle(middle),
    "",
    "=== Final events (full detail) ===",
    JSON.stringify(last, null, 2),
  ].join("\n");
}

// ─── Hidden test summary ────────────────────────────────────────────────────

function buildHiddenTestSummary(room: Room): string {
  const hiddenInputs = new Set(room.problem.hiddenTests.map((t) => t.input));
  if (hiddenInputs.size === 0) return "No hidden tests were configured for this problem.";

  const lines: string[] = [];
  let submitCount = 0;

  for (const run of room.runs) {
    const hiddenResults = run.testResults.filter((r) => hiddenInputs.has(r.input));
    if (hiddenResults.length === 0) continue;
    submitCount++;
    lines.push(`Submit #${submitCount} (${run.timestamp}, ${run.language}):`);
    for (const r of hiddenResults) {
      const label = r.status === "passed" ? "PASS" : `FAIL (got: ${JSON.stringify(r.actualOutput)})`;
      lines.push(`  - input=${JSON.stringify(r.input)} expected=${JSON.stringify(r.expectedOutput)} → ${label}`);
    }
  }

  if (lines.length === 0) {
    return `${hiddenInputs.size} hidden test(s) configured but candidate never submitted (only ran visible tests).`;
  }

  const lastSubmit = room.runs.filter((run) =>
    run.testResults.some((r) => hiddenInputs.has(r.input))
  ).at(-1);

  const finalPassed = lastSubmit
    ? lastSubmit.testResults.filter((r) => hiddenInputs.has(r.input) && r.status === "passed").length
    : 0;

  lines.push("");
  lines.push(`Final hidden test score: ${finalPassed}/${hiddenInputs.size} passed on last submit.`);

  return lines.join("\n");
}

// ─── Code evolution (snapshot diffs) ────────────────────────────────────────

interface SnapshotDiff {
  index: number;
  fromTs: string;
  toTs: string;
  linesAdded: number;
  linesRemoved: number;
  charDelta: number;
  elapsedSec: number;
  isRewrite: boolean;
}

/**
 * Compares two code strings line-by-line and counts actual additions/removals.
 *
 * Uses index-based tracking instead of Set to avoid collapsing duplicate lines
 * (e.g. multiple `}` or blank lines). Each line from `before` is matched at most
 * once against a line in `after` — unmatched before-lines count as removals,
 * unmatched after-lines count as additions.
 */
function simpleLineDiff(before: string, after: string): { added: number; removed: number } {
  const bLines = before.split("\n");
  const aLines = after.split("\n");

  // Track which after-lines have been matched so each is consumed only once
  const matched = new Array(aLines.length).fill(false);

  let removed = 0;

  for (const bLine of bLines) {
    // Find the first unmatched after-line that equals this before-line
    const idx = aLines.findIndex((aLine, i) => !matched[i] && aLine === bLine);
    if (idx !== -1) {
      matched[idx] = true; // consume the match
    } else {
      removed++; // no match found → line was removed
    }
  }

  // Any unmatched after-lines are additions
  const added = matched.filter((m) => !m).length;

  return { added, removed };
}

function buildCodeEvolution(room: Room): string {
  const snaps = room.snapshots;
  if (snaps.length < 2) {
    return snaps.length === 0
      ? "No code snapshots were recorded."
      : "Only 1 snapshot recorded — not enough to show evolution.";
  }

  const sessionStart = room.startedAt ?? new Date(snaps[0].timestamp).getTime();
  const diffs: SnapshotDiff[] = [];

  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1];
    const curr = snaps[i];
    const { added, removed } = simpleLineDiff(prev.code, curr.code);
    const prevLines = prev.code.split("\n").length;
    const isRewrite = prevLines > 5 && removed > prevLines * 0.3;
    diffs.push({
      index: i,
      fromTs: prev.timestamp,
      toTs: curr.timestamp,
      linesAdded: added,
      linesRemoved: removed,
      charDelta: curr.charCount - prev.charCount,
      elapsedSec: Math.round((new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000),
      isRewrite,
    });
  }

  function minuteMark(ts: string): string {
    const ms = new Date(ts).getTime() - sessionStart;
    return `${Math.round(ms / 60_000)}m`;
  }

  const lines: string[] = [];
  const totalMin = snaps.length > 0
    ? Math.round((new Date(snaps[snaps.length - 1].timestamp).getTime() - new Date(snaps[0].timestamp).getTime()) / 60_000)
    : 0;
  lines.push(`${snaps.length} snapshots over ${totalMin} minutes`);
  lines.push("");

  for (const d of diffs) {
    const marker = d.isRewrite ? " *** REWRITE" : "";
    lines.push(
      `  ${minuteMark(d.fromTs)} → ${minuteMark(d.toTs)}: ` +
      `+${d.linesAdded} lines, -${d.linesRemoved} lines ` +
      `(${d.charDelta >= 0 ? "+" : ""}${d.charDelta} chars)${marker}`
    );
  }

  // Find largest single jump
  const biggestJump = diffs.reduce((max, d) => (Math.abs(d.charDelta) > Math.abs(max.charDelta) ? d : max), diffs[0]);
  const rewrites = diffs.filter((d) => d.isRewrite);

  lines.push("");
  lines.push(
    `Largest single change: +${biggestJump.linesAdded}/-${biggestJump.linesRemoved} lines ` +
    `at ${minuteMark(biggestJump.toTs)} (${biggestJump.charDelta >= 0 ? "+" : ""}${biggestJump.charDelta} chars)`
  );
  lines.push(`Major rewrites detected: ${rewrites.length}`);

  // Development pattern classification
  const avgDelta = diffs.reduce((s, d) => s + Math.abs(d.charDelta), 0) / diffs.length;
  const maxDelta = Math.max(...diffs.map((d) => Math.abs(d.charDelta)));
  const pattern = maxDelta > avgDelta * 4 ? "Burst-heavy (large jumps in code size)" : "Incremental (steady development)";
  lines.push(`Development pattern: ${pattern}`);

  return lines.join("\n");
}

// ─── Integrity signals ──────────────────────────────────────────────────────

function buildIntegritySignals(room: Room): string {
  const sessionStart = room.startedAt ?? 0;
  const events = room.timeline;

  const pastes = events.filter((e) => e.event === "paste");
  const blurs = events.filter((e) => e.event === "tab_blur");
  const focuses = events.filter((e) => e.event === "tab_focus");
  // fullscreen_exit is an integrity signal parallel to tab_blur:
  // candidate left the fullscreen view, potentially to access external resources.
  const fullscreenExits = events.filter((e) => e.event === "fullscreen_exit");

  if (pastes.length === 0 && blurs.length === 0 && fullscreenExits.length === 0) {
    return "No paste events, tab switches, or fullscreen exits detected. All code appears to have been typed organically.";
  }

  function minuteMark(ts: string): string {
    const ms = new Date(ts).getTime() - sessionStart;
    return `${Math.round(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
  }

  const lines: string[] = [];

  // Paste events
  lines.push(`Paste events: ${pastes.length} detected`);
  for (const p of pastes) {
    const chars = (p.data.charCount as number) ?? 0;
    const pLines = (p.data.lineCount as number) ?? 0;
    const src = (p.data.source as string) ?? "unknown";
    lines.push(`  - ${minuteMark(p.timestamp)}: ${chars} chars pasted (${pLines} lines) [source: ${src}]`);
  }

  // Tab switches
  lines.push(`Tab switches: ${blurs.length} detected`);
  let totalAway = 0;
  for (const f of focuses) {
    const away = (f.data.awaySeconds as number) ?? 0;
    totalAway += away;
  }
  // Pair blurs[i] with focuses[i] chronologically — each focus consumed once.
  // Sorting ensures blur→focus pairs align correctly even if events arrived
  // slightly out of order.
  const sortedBlurs = [...blurs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const sortedFocuses = [...focuses].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  for (let i = 0; i < sortedBlurs.length; i++) {
    const matchingFocus = sortedFocuses[i]; // 1:1 index pairing, each focus used once
    const awaySec = matchingFocus ? ((matchingFocus.data.awaySeconds as number) ?? 0) : 0;
    lines.push(`  - ${minuteMark(sortedBlurs[i].timestamp)}: left tab${awaySec > 0 ? ` for ${awaySec}s` : ""}`);
  }
  if (totalAway > 0) lines.push(`  Total time away: ${totalAway}s`);

  // Fullscreen exits — each exit is a discrete integrity event.
  // Listed individually so the AI can correlate them with pastes/tab switches.
  if (fullscreenExits.length > 0) {
    lines.push(`Fullscreen exits: ${fullscreenExits.length} detected`);
    for (const fx of fullscreenExits) {
      lines.push(`  - ${minuteMark(fx.timestamp)}: candidate exited fullscreen`);
    }
  } else {
    lines.push("Fullscreen exits: 0");
  }

  // Correlate: paste within 30s after a tab_focus
  const pasteAfterSwitch: string[] = [];
  for (const p of pastes) {
    const pTime = new Date(p.timestamp).getTime();
    for (const f of focuses) {
      const fTime = new Date(f.timestamp).getTime();
      if (pTime >= fTime && pTime - fTime < 30_000) {
        const chars = (p.data.charCount as number) ?? 0;
        const awaySec = (f.data.awaySeconds as number) ?? 0;
        pasteAfterSwitch.push(
          `${chars}-char paste at ${minuteMark(p.timestamp)} within ${Math.round((pTime - fTime) / 1000)}s of returning from ${awaySec}s tab switch`
        );
        break;
      }
    }
  }

  lines.push("");
  if (pasteAfterSwitch.length > 0) {
    lines.push(`Paste-after-tab-switch correlations: ${pasteAfterSwitch.length}`);
    for (const c of pasteAfterSwitch) {
      lines.push(`  *** ${c}`);
    }
  } else {
    lines.push("Paste-after-tab-switch correlations: 0");
  }

  // Gaze tracking signals
  if (!room.gazeCalibrated) {
    lines.push("");
    lines.push("Gaze tracking: unavailable — candidate did not complete calibration.");
  } else if (!room.gazeSamples || room.gazeSamples.length === 0) {
    lines.push("");
    lines.push("Gaze tracking: calibration completed but no gaze data was recorded (possible tracking failure or very short session).");
  } else if (room.gazeSamples.length > 0) {
    const validSamples = room.gazeSamples.filter((s) => s.zone !== "unknown");
    const offScreen = validSamples.filter((s) => s.zone !== "on_screen");
    const totalValid = validSamples.length;

    if (totalValid > 0) {
      const offScreenRatio = offScreen.length / totalValid;
      const offPct = Math.round(offScreenRatio * 100);
      lines.push("");
      lines.push(`Gaze tracking: ${totalValid} valid samples, ${100 - offPct}% on-screen, ${offPct}% off-screen`);

      const dirCounts: Record<string, number> = {};
      for (const s of offScreen) {
        dirCounts[s.zone] = (dirCounts[s.zone] ?? 0) + 1;
      }
      for (const [dir, count] of Object.entries(dirCounts)) {
        const pct = Math.round((count / totalValid) * 100);
        const label = dir.replace("off_", "");
        lines.push(`  - Off-${label}: ${pct}%${pct > 15 ? " (elevated)" : ""}`);
      }

      if (offScreenRatio > 0.20) {
        lines.push(`  *** ${offPct}% off-screen gaze — elevated concern`);
      }

      // Cross-correlate gaze off-screen streaks with paste events
      const gazeStreaks = events.filter((e) => e.event === "gaze_off_screen_streak");
      if (gazeStreaks.length > 0 && pastes.length > 0) {
        const gazeAfterPaste: string[] = [];
        for (const gs of gazeStreaks) {
          const gsTime = new Date(gs.timestamp).getTime();
          for (const p of pastes) {
            const pTime = new Date(p.timestamp).getTime();
            if (Math.abs(gsTime - pTime) < 30_000) {
              const chars = (p.data.charCount as number) ?? 0;
              const dur = (gs.data.durationSeconds as number) ?? 0;
              gazeAfterPaste.push(
                `${dur}s off-screen gaze streak near ${chars}-char paste at ${minuteMark(p.timestamp)}`
              );
              break;
            }
          }
        }
        if (gazeAfterPaste.length > 0) {
          lines.push("");
          lines.push(`Gaze-paste correlations: ${gazeAfterPaste.length}`);
          for (const c of gazeAfterPaste) {
            lines.push(`  *** ${c}`);
          }
        }
      }
    }
  }

  // Candidate self-termination
  const endAttempts = events.filter((e) => e.event === "end_attempt");
  if (endAttempts.length > 0) {
    lines.push("");
    lines.push("Candidate self-terminated the session (clicked 'End attempt').");
    for (const ea of endAttempts) {
      const codeLen = (ea.data.codeLength as number) ?? 0;
      lines.push(`  - At ${minuteMark(ea.timestamp)}, code was ${codeLen} chars when they chose to stop.`);
    }
  }

  // Cross-reference with snapshots for sudden code jumps
  const snaps = room.snapshots;
  if (snaps.length >= 2) {
    const largeJumps: string[] = [];
    for (let i = 1; i < snaps.length; i++) {
      const delta = snaps[i].charCount - snaps[i - 1].charCount;
      if (delta > 200) {
        const snapTime = new Date(snaps[i].timestamp).getTime();
        const nearBlur = blurs.find((b) => {
          const bTime = new Date(b.timestamp).getTime();
          return snapTime - bTime < 120_000 && snapTime > bTime;
        });
        if (nearBlur) {
          largeJumps.push(
            `+${delta} chars at ${minuteMark(snaps[i].timestamp)} preceded by tab switch at ${minuteMark(nearBlur.timestamp)}`
          );
        }
      }
    }
    if (largeJumps.length > 0) {
      lines.push("");
      lines.push("Large code jumps near tab switches:");
      for (const j of largeJumps) lines.push(`  *** ${j}`);
    }
  }

  return lines.join("\n");
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior technical interviewer with 15+ years of experience evaluating software engineers. Your role is to produce rigorous, evidence-based candidate evaluations from live coding session data. You are objective, calibrated, and specific — you cite concrete observations from the session rather than making generic statements. You understand the difference between a candidate who writes clean O(n) code after brief planning and one who brute-forces and never optimises. You also carefully analyze integrity signals to identify potential use of external help during the session.`;

function buildUserPrompt(room: Room): string {
  const durationMs = room.endedAt && room.startedAt ? room.endedAt - room.startedAt : 0;
  const durationMin = Math.round(durationMs / 60000);

  const difficultyLine = room.problem.difficulty
    ? `**Difficulty:** ${room.problem.difficulty} (calibrate scoring accordingly — a "Strong" performance on Hard ≠ a "Strong" on Easy)`
    : "";

  const candidateLine = room.candidateName ? `**Candidate:** ${room.candidateName}` : "";
  const companyLine = room.interviewerCompany ? `**Interviewing for:** ${room.interviewerCompany}` : "";

  return `Analyze the following coding interview session and return a structured JSON evaluation.

## Interview context
${candidateLine}
${companyLine}
${difficultyLine}

## Problem
**Title:** ${room.problem.title}
**Description:** ${room.problem.description}

**Examples:** ${JSON.stringify(room.problem.examples, null, 2)}

## Session data
- **Duration:** ${durationMin} minutes
- **Language:** ${room.language}

## Timeline
${buildSmartTimeline(room.timeline)}

## Final code
\`\`\`
${room.code}
\`\`\`

## Run history (last 20 runs, includes test results)
${JSON.stringify(room.runs.slice(-20), null, 2)}

## Hidden test results
${buildHiddenTestSummary(room)}

## Code Evolution
${buildCodeEvolution(room)}

## Integrity Signals
${buildIntegritySignals(room)}

---

Return a JSON object with EXACTLY these keys. All string fields may use plain text.

**Qualitative fields (strings):**
- approach_analysis       — Initial strategy, edge case awareness, brute-force vs. optimal choice, and whether they planned before coding
- problem_solving_behavior — Where they got stuck, how they iterated, number of runs before a passing submit, reaction to failures, language switches. If the candidate chose to end their attempt early (look for an "end_attempt" timeline event), note this and consider what progress they had made up to that point — self-awareness about when to stop is not inherently negative.
- code_quality            — Variable naming, readability, structure, edge case coverage, time/space complexity awareness
- time_breakdown          — Estimated time distribution: reading/planning vs. coding vs. debugging (infer from keystroke and run events)
- hire_reasoning          — One clear paragraph justifying the hire_signal verdict with specific evidence from this session
- code_evolution_analysis — How the code evolved over the session: was development incremental or burst-heavy? Were there major rewrites? Did the solution appear suddenly or grow organically? Cite specific snapshot transitions as evidence.

**Numeric score fields (integers):**
- approach_score          — 1–5: problem decomposition and algorithm selection
- problem_solving_score   — 1–5: debugging skill, iteration quality, resilience under pressure
- code_quality_score      — 1–5: code craft (readability, correctness, edge cases)
- structured_thinking_score — 1–5: inferred from timeline pacing and self-correction patterns (1 = no evidence of structured thinking, 5 = clearly structured and systematic approach — planned before coding, iterated methodically)
- overall_score           — 1–10: holistic hire signal (1 = definitely not, 10 = exceptional)
- integrity_score         — 1–5: how confident are you that the candidate wrote this code themselves, based on the integrity signals, code evolution, paste events, and tab-switch patterns

**Array field:**
- integrity_flags         — JSON array of strings. Each string is a specific concern about session integrity (e.g. "312-char paste immediately after 12s tab switch", "Solution appeared fully formed with no incremental development"). Return an empty array [] if no concerns.

**Verdict field (string, exactly one of these four values):**
- hire_signal             — "Strong Hire" | "Hire" | "No Hire" | "Strong No Hire"

**Strengths & Weaknesses (arrays of strings):**
- strengths              — 2–4 specific strengths observed during the session (e.g. "Quickly identified the optimal O(n) approach", "Clean variable naming and modular structure")
- weaknesses             — 2–4 specific areas for improvement (e.g. "Did not consider empty-input edge case", "Brute-force approach with no optimization attempt")

**Summary field (string):**
- summary                 — 2–3 sentences a hiring manager can read at a glance

Scoring anchors:
  1 = did not demonstrate the skill at all
  2 = significant gaps
  3 = meets bar (acceptable)
  4 = above bar (solid)
  5 = exceptional

integrity_score anchors:
  5 = All code written organically, no suspicious patterns
  4 = Minor anomalies (small pastes, brief tab switches) that are likely benign
  3 = Some suspicious patterns but inconclusive
  2 = Strong indicators of external help (large paste-after-switch, sudden complete solution)
  1 = Overwhelming evidence of copied solution (no incremental development, multiple large pastes)

Difficulty calibration anchors:
  Easy:   expect optimal solution in <15 min. Score 3 = correct O(n) solution. Score 5 = elegant with all edge cases in <10 min.
  Medium: expect working solution in <25 min. Score 3 = correct brute-force or near-optimal. Score 5 = optimal with clean code in <20 min.
  Hard:   expect meaningful progress in <35 min. Score 3 = working brute-force. Score 5 = optimal solution with edge cases handled.

hire_signal thresholds (use overall_score as a guide):
  8–10 → Strong Hire
  6–7  → Hire
  4–5  → No Hire
  1–3  → Strong No Hire`;
}

// ─── Main export ────────────────────────────────────────────────────────────

/**
 * Validates that the AI response contains all expected fields with correct types.
 * Returns the validated debrief or a fallback with an error message if validation fails.
 */
function validateDebriefResponse(raw: Record<string, unknown>): Record<string, unknown> {
  // Required string fields
  const requiredStrings = [
    "approach_analysis", "problem_solving_behavior", "code_quality",
    "time_breakdown", "hire_reasoning", "code_evolution_analysis",
    "hire_signal", "summary",
  ];
  // Required numeric fields with their expected ranges
  const requiredNumbers: [string, number, number][] = [
    ["approach_score", 1, 5],
    ["problem_solving_score", 1, 5],
    ["code_quality_score", 1, 5],
    ["structured_thinking_score", 1, 5],
    ["overall_score", 1, 10],
    ["integrity_score", 1, 5],
  ];

  const missing: string[] = [];

  for (const key of requiredStrings) {
    if (typeof raw[key] !== "string") missing.push(`${key} (expected string)`);
  }
  for (const [key, min, max] of requiredNumbers) {
    const val = raw[key];
    if (typeof val !== "number" || val < min || val > max) {
      missing.push(`${key} (expected number ${min}-${max})`);
    }
  }
  if (!Array.isArray(raw.integrity_flags)) {
    missing.push("integrity_flags (expected array)");
  }
  if (!Array.isArray(raw.strengths)) {
    missing.push("strengths (expected array)");
  }
  if (!Array.isArray(raw.weaknesses)) {
    missing.push("weaknesses (expected array)");
  }

  const validSignals = ["Strong Hire", "Hire", "No Hire", "Strong No Hire"];
  if (!validSignals.includes(raw.hire_signal as string)) {
    missing.push(`hire_signal (expected one of: ${validSignals.join(", ")})`);
  }

  // If critical fields are missing, return a fallback debrief with the error details
  if (missing.length > 0) {
    return {
      ...raw,
      error: `Validation failed — missing or invalid fields: ${missing.join(", ")}`,
    };
  }

  return raw;
}

/**
 * generateDebrief()
 * ─────────────────────────────────────────────────────────────────────────────
 * Main export — calls Claude Sonnet 4.6 and returns a validated debrief object.
 *
 * Flow:
 *  1. Build the prompt from room data (timeline, snapshots, runs, code).
 *  2. Call the Anthropic Messages API with JSON output enforced via
 *     a system instruction. Temperature is kept low (0.2) for consistent
 *     structured output.
 *  3. Parse and validate the JSON response, then return it.
 *
 * Error handling:
 *  - If ANTHROPIC_API_KEY is missing, returns a placeholder debrief so the
 *    UI doesn't crash — the interviewer will see a clear setup message.
 *  - API errors bubble up to the caller (the /api/rooms/[roomId] route handler).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function generateDebrief(room: Room): Promise<Record<string, unknown>> {
  /* Guard: API key must be present before attempting any API call */
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      approach_analysis: "Set ANTHROPIC_API_KEY in .env.local to generate debriefs.",
      problem_solving_behavior: "",
      code_quality: "",
      time_breakdown: "",
      hire_reasoning: "",
      code_evolution_analysis: "",
      approach_score: 0,
      problem_solving_score: 0,
      code_quality_score: 0,
      structured_thinking_score: 0,
      overall_score: 0,
      integrity_score: 0,
      integrity_flags: [],
      strengths: [],
      weaknesses: [],
      hire_signal: "No Hire",
      summary: "Debrief skipped (no Anthropic API key).",
    };
  }

  /*
   * Call Claude Sonnet 4.6.
   * - system: sets the interviewer persona (SYSTEM_PROMPT)
   * - user:   contains all session data + the JSON schema to fill
   * - max_tokens: 4096 is plenty for the structured JSON response
   *
   * We rely on the system prompt's instruction to "return a JSON object"
   * rather than a formal structured-output schema, keeping it simple and
   * compatible with the current SDK version.
   */
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",       // fast + strong reasoning, cost-effective
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildUserPrompt(room) },
    ],
  });

  /* Extract the text block from the response content array */
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Empty Claude response — no text block returned");
  }

  /*
   * Claude sometimes wraps JSON in a markdown code fence (```json ... ```).
   * Strip fences if present, then parse the raw JSON string.
   */
  const raw = textBlock.text.trim();
  const jsonString = raw.startsWith("```")
    ? raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
    : raw;

  const parsed = JSON.parse(jsonString) as Record<string, unknown>;

  /* Validate that all required fields exist with correct types */
  return validateDebriefResponse(parsed);
}
