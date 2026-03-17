/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/api/ai/rewrite-problem/route.ts
 *
 * API route: POST /api/ai/rewrite-problem
 *
 * PURPOSE:
 *   Takes a real LeetCode problem (title + description) and asks Claude to
 *   rewrite it with a brand-new real-world scenario so the candidate cannot
 *   Google the original problem name.
 *
 *   IMPORTANT: Only the title and description are rewritten.
 *   The original examples[] and hiddenTests[] are preserved byte-for-byte
 *   (appended server-side by this route before returning), so test cases
 *   remain valid and unchanged.
 *
 * FLOW:
 *   1. Receive { slug, originalTitle, originalDescription, examples, hiddenTests }
 *   2. Call Claude with the original title + description
 *   3. Claude returns { title: string, description: string }
 *   4. Attach the original examples and hiddenTests
 *   5. Return the full rewritten Problem object ready to PATCH into the room
 *
 * REQUEST BODY:
 *   {
 *     slug:                string
 *     originalTitle:       string
 *     originalDescription: string
 *     examples:            ProblemExample[]
 *     hiddenTests:         HiddenTest[]
 *   }
 *
 * RESPONSE 200:
 *   {
 *     problem: Problem   // { title, description, examples, hiddenTests, difficulty }
 *   }
 *
 * RESPONSE 400: missing fields
 * RESPONSE 500: Claude API failure
 *
 * USED BY:
 *   app/room/[roomId]/setup/ai/page.tsx  — "AI Picks" flow step 5 (rewrite)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Problem, ProblemExample, HiddenTest, ProblemDifficulty } from "@/lib/store";

// ── Singleton client ─────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── 1. Parse body ──────────────────────────────────────────────────────────
  let body: {
    slug?: string;
    originalTitle?: string;
    originalDescription?: string;
    difficulty?: ProblemDifficulty;
    examples?: ProblemExample[];
    hiddenTests?: HiddenTest[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { originalTitle, originalDescription, difficulty, examples = [], hiddenTests = [] } = body;

  // #region agent log
  console.log(`[DEBUG-74ad34] rewrite-problem: hasTitle=${!!originalTitle} hasDesc=${!!originalDescription} titleVal="${originalTitle}" descType=${typeof originalDescription} descLen=${typeof originalDescription==='string'?originalDescription.length:'N/A'}`);
  // #endregion

  if (!originalTitle || !originalDescription) {
    // #region agent log
    console.log(`[DEBUG-74ad34] rewrite-problem FAILING: !title=${!originalTitle} !desc=${!originalDescription} desc="${originalDescription}"`);
    // #endregion
    return NextResponse.json({ error: "originalTitle and originalDescription are required" }, { status: 400 });
  }

  // ── 2. Build Claude prompt ─────────────────────────────────────────────────
  //
  // We instruct Claude to:
  //   - Invent a completely different real-world narrative
  //   - Preserve the exact algorithmic structure (same inputs/outputs)
  //   - NOT change variable names in examples (they stay as-is since we reuse them)
  //   - Return ONLY JSON: { title, description }
  //
  const rewritePrompt = `You are helping disguise a well-known coding interview problem so the candidate cannot Google it.

Original problem title: "${originalTitle}"
Original description:
---
${originalDescription}
---

Your task:
1. Invent a completely NEW real-world scenario/narrative for this problem.
   Example: "Two Sum" → "Find two transaction IDs in a payment log that sum to a refund target"
   Example: "Valid Parentheses" → "Check if a sequence of warehouse door open/close events is balanced"
2. Rewrite the description to use the new narrative while preserving the EXACT same:
   - Input/output format (same types, same structure)
   - Algorithmic requirements
   - Constraints (e.g. "1 ≤ n ≤ 10^5")
3. Do NOT change the examples in the description — just make sure they still make sense
   with the new narrative. You may rename variable/parameter labels if needed.
4. Keep the same difficulty and complexity requirements.
5. Write clearly for a software engineering audience — professional but accessible.

Return ONLY valid JSON in exactly this shape (no markdown, no explanation):
{
  "title": "New title here",
  "description": "Full rewritten problem description here..."
}`;

  // ── 3. Call Claude ─────────────────────────────────────────────────────────
  let rewritten: { title: string; description: string };

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: rewritePrompt }],
    });

    const rawText = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    rewritten = JSON.parse(rawText);

    if (!rewritten.title || !rewritten.description) {
      throw new Error("Claude response missing title or description");
    }
  } catch (err) {
    console.error("[rewrite-problem] Claude error:", err);
    return NextResponse.json({ error: "Problem rewrite failed" }, { status: 500 });
  }

  // ── 4. Assemble full Problem object ───────────────────────────────────────
  //
  // The rewritten title and description come from Claude.
  // The examples and hiddenTests come from the original LeetCode import —
  // they are preserved byte-for-byte so test execution still works correctly.
  //
  const problem: Problem = {
    title: rewritten.title,
    description: rewritten.description,
    examples,
    hiddenTests,
    ...(difficulty ? { difficulty } : {}),
  };

  return NextResponse.json({ problem });
}
