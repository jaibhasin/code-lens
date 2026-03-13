/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/api/ai/pick-problem/route.ts
 *
 * API route: POST /api/ai/pick-problem
 *
 * PURPOSE:
 *   Takes the interviewer's filter criteria (difficulty, topic, optional hint),
 *   runs a semantic vector search over the LeetCode problem index in Upstash,
 *   then asks Claude to re-rank the top 10 results and return the best 3.
 *
 * FLOW:
 *   1. Build a natural-language query string from the filter inputs
 *   2. Call OpenAI text-embedding-3-small to get a 1536-dim query vector
 *   3. Upstash cosine similarity search → top 10 nearest problem records
 *   4. Claude re-ranks those 10, picking the 3 most interesting/varied ones
 *      and adding a one-sentence reasoning for each pick
 *   5. Return: Array of { slug, title, difficulty, topics, reasoning }
 *
 * REQUEST BODY:
 *   {
 *     difficulty: "Any" | "Easy" | "Medium" | "Hard"
 *     topic:      string   (e.g. "Sliding Window")  — "" means any
 *     hint:       string   (optional free text)
 *   }
 *
 * RESPONSE 200:
 *   {
 *     picks: [
 *       { slug: string, title: string, difficulty: string,
 *         topics: string[], reasoning: string },
 *       ...  // exactly 3 items
 *     ]
 *   }
 *
 * RESPONSE 400: missing/invalid body
 * RESPONSE 500: upstream API failure
 *
 * USED BY:
 *   app/room/[roomId]/setup/ai/page.tsx  — "AI Picks" flow step 2 → 3
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { vectorIndex } from "@/lib/upstash";
import type { ProblemMetadata } from "@/lib/upstash";

/** Shape of each item Claude returns in its re-rank JSON. */
interface ClausePickItem {
  slug: string;
  reasoning: string;
}

// ── Singleton clients ───────────────────────────────────────────────────────

/**
 * OpenAI client — used only for generating the query embedding.
 * Model: text-embedding-3-small (1536 dims, cheapest & fast).
 */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Anthropic/Claude client — used for re-ranking the top 10 vector results
 * down to the best 3, with a reasoning sentence per pick.
 */
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── 1. Parse & validate request body ──────────────────────────────────────
  let body: { difficulty?: string; topic?: string; hint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { difficulty = "Any", topic = "", hint = "" } = body;

  // ── 2. Build the natural-language query string ────────────────────────────
  //
  // The embedded text in Upstash follows the pattern:
  //   "{Difficulty} {Topics}. {Claude algorithmic summary}"
  //
  // So we build a query that matches that semantic space:
  //   "Medium Sliding Window, not too obvious, avoid Two Sum"
  //
  const parts: string[] = [];
  if (difficulty && difficulty !== "Any") parts.push(difficulty);
  if (topic) parts.push(topic);
  if (hint.trim()) parts.push(hint.trim());

  // Fallback: if interviewer gave no hints at all, use a broad query
  const queryText = parts.length > 0 ? parts.join(" ") : "algorithm data structures";

  // ── 3. Embed the query with OpenAI ────────────────────────────────────────
  let queryVector: number[];
  try {
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText,
    });
    queryVector = embeddingRes.data[0].embedding;
  } catch (err) {
    console.error("[pick-problem] OpenAI embedding error:", err);
    return NextResponse.json({ error: "Embedding generation failed" }, { status: 500 });
  }

  // ── 4. Similarity search in Upstash Vector ────────────────────────────────
  //
  // Returns up to 10 nearest problems by cosine similarity.
  // includeMetadata: true → we get slug, title, difficulty, topics, summary back.
  //
  let searchResults: Array<{ id: string | number; score: number; metadata?: ProblemMetadata }>;
  try {
    searchResults = await vectorIndex.query({
      vector: queryVector,
      topK: 10,
      includeMetadata: true,
      // Optional: filter by difficulty at the vector DB level to reduce noise
      ...(difficulty && difficulty !== "Any"
        ? { filter: `difficulty = '${difficulty}'` }
        : {}),
    });
  } catch (err) {
    console.error("[pick-problem] Upstash query error:", err);
    return NextResponse.json({ error: "Vector search failed" }, { status: 500 });
  }

  // Filter out any results without metadata (shouldn't happen but defensive)
  const candidates = searchResults
    .filter((r) => r.metadata)
    .map((r) => r.metadata as ProblemMetadata);

  if (candidates.length === 0) {
    return NextResponse.json({ error: "No matching problems found" }, { status: 404 });
  }

  // ── 5. Claude re-ranks the top 10 → picks best 3 ─────────────────────────
  //
  // We give Claude the full metadata for each candidate and ask it to pick
  // 3 that are:
  //   a) most relevant to the interviewer's filters / hint
  //   b) varied (not three variations of the same technique)
  //   c) interesting / non-trivial for an interview
  //
  const candidateJson = JSON.stringify(
    candidates.map((c, i) => ({
      index: i,
      slug: c.slug,
      title: c.title,
      difficulty: c.difficulty,
      topics: c.topics,
      summary: c.summary,
    })),
    null,
    2
  );

  const reRankPrompt = `You are helping an interviewer pick a coding problem for a technical interview.

The interviewer's request:
- Difficulty: ${difficulty}
- Topic: ${topic || "Any"}
- Extra hint: ${hint || "(none)"}

Here are the top ${candidates.length} candidate problems found via semantic search:

${candidateJson}

Your task:
1. Pick the BEST 3 problems from the list above that match the interviewer's request.
2. Prioritize variety — don't pick 3 near-identical problems.
3. Avoid picking "Two Sum" (slug: two-sum) unless it's the only option.
4. For each pick, write ONE sentence explaining why it's a good fit.

Return ONLY valid JSON in this exact shape (no markdown, no explanation outside the JSON):
[
  { "slug": "problem-slug", "reasoning": "one sentence why" },
  { "slug": "problem-slug", "reasoning": "one sentence why" },
  { "slug": "problem-slug", "reasoning": "one sentence why" }
]`;

  let pickedSlugs: ClausePickItem[];
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{ role: "user", content: reRankPrompt }],
    });

    // Extract text content from the response
    const rawText = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    pickedSlugs = JSON.parse(rawText);

    // Validate shape
    if (!Array.isArray(pickedSlugs) || pickedSlugs.length === 0) {
      throw new Error("Unexpected Claude response shape");
    }
  } catch (err) {
    console.error("[pick-problem] Claude re-rank error:", err);
    return NextResponse.json({ error: "Claude re-rank failed" }, { status: 500 });
  }

  // ── 6. Merge Claude's picks with the full metadata ────────────────────────
  //
  // Build a lookup map so we can attach title/difficulty/topics to each slug.
  //
  const metaBySlug = Object.fromEntries(candidates.map((c) => [c.slug, c]));

  const picks = pickedSlugs
    .slice(0, 3) // cap at 3 even if Claude returned more
    .map((pick) => {
      const meta = metaBySlug[pick.slug];
      return {
        slug: pick.slug,
        title: meta?.title ?? pick.slug,
        difficulty: meta?.difficulty ?? "Medium",
        topics: meta?.topics ?? [],
        reasoning: pick.reasoning,
      };
    });

  return NextResponse.json({ picks });
}
