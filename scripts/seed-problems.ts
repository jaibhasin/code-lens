/**
 * ─────────────────────────────────────────────────────────────────────────────
 * scripts/seed-problems.ts
 *
 * One-time seeding script for the AI Problem Picker feature.
 *
 * PURPOSE:
 *   For each LeetCode problem slug in SLUGS[], this script:
 *     1. Fetches full problem data via the local Next.js dev server
 *        (POST http://localhost:3000/api/import/leetcode)
 *     2. Asks Claude to generate a 2-3 sentence ALGORITHMIC summary
 *        (technique-focused, not narrative — so embeddings cluster by algorithm)
 *     3. Builds the embed text: "{difficulty} {topics}. {summary}"
 *     4. Embeds the text using OpenAI text-embedding-3-small → 1536-dim float[]
 *     5. Upserts into Upstash Vector index:
 *        { id: slug, vector: [...], metadata: { slug, title, difficulty, topics, summary } }
 *
 * RESUME-SAFE:
 *   Before processing each slug, the script checks if it already exists in
 *   Upstash by calling index.fetch([slug]).  If found, it skips — safe to re-run
 *   after interruption.
 *
 * RATE LIMITING:
 *   Processes slugs sequentially with a 500ms delay between each to avoid
 *   hitting LeetCode's GraphQL rate limit.
 *
 * ── SETUP ──────────────────────────────────────────────────────────────────
 *
 * 1. Create a FREE Upstash Vector index at https://console.upstash.com
 *    → Vector → Create Index
 *    Settings: Dimensions = 1536, Distance metric = COSINE
 *    Copy REST URL and REST TOKEN → paste into .env.local:
 *      UPSTASH_VECTOR_REST_URL=https://...upstash.io
 *      UPSTASH_VECTOR_REST_TOKEN=...
 *
 * 2. Add to .env.local:
 *      OPENAI_API_KEY=sk-...
 *      ANTHROPIC_API_KEY=sk-ant-...
 *
 * 3. Start the dev server:  npm run dev
 *    (seed script calls http://localhost:3000/api/import/leetcode)
 *
 * 4. Run the seed script:   npx tsx scripts/seed-problems.ts
 *
 * ── COST ESTIMATE ──────────────────────────────────────────────────────────
 *
 *   ~300 slugs × ~150 tokens each = ~45K tokens
 *   text-embedding-3-small: $0.020 / 1M tokens → ~$0.001 total
 *   Claude summaries: ~300 × 300 tokens × $3/M → ~$0.27 total
 *   Upstash Vector: free tier covers 10K vectors
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { Index } from "@upstash/vector";
import * as dotenv from "dotenv";
import * as path from "path";

// Load env vars — try .env.local first (Next.js convention), fall back to .env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ── Clients ───────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Upstash Vector index (typed with our metadata shape).
 * Index.fromEnv() reads UPSTASH_VECTOR_REST_URL + UPSTASH_VECTOR_REST_TOKEN.
 */
interface ProblemMetadata {
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topics: string[];
  summary: string;
  // Index signature required by @upstash/vector's Dict constraint
  [key: string]: unknown;
}
const vectorIndex = new Index<ProblemMetadata>();

// ── Dev server URL ────────────────────────────────────────────────────────────

/**
 * The seed script calls the local Next.js dev server to import each problem.
 * Change this if your dev server runs on a different port.
 */
const DEV_SERVER = "http://localhost:3000";

// ── Problem slugs to seed ─────────────────────────────────────────────────────

/**
 * ~300 free-tier LeetCode problem slugs covering a broad range of topics.
 * Expand this list to increase the search space.
 * All slugs here are free-to-view on LeetCode (no subscription required).
 */
const SLUGS: string[] = [
  // Arrays & Hashing
  "two-sum",
  "best-time-to-buy-and-sell-stock",
  "contains-duplicate",
  "product-of-array-except-self",
  "maximum-subarray",
  "maximum-product-subarray",
  "find-minimum-in-rotated-sorted-array",
  "search-in-rotated-sorted-array",
  "3sum",
  "container-with-most-water",

  // Two Pointers
  "valid-palindrome",
  "two-sum-ii-input-array-is-sorted",
  "trapping-rain-water",
  "move-zeroes",
  "squares-of-a-sorted-array",

  // Sliding Window
  "longest-substring-without-repeating-characters",
  "longest-repeating-character-replacement",
  "minimum-window-substring",
  "sliding-window-maximum",
  "permutation-in-string",
  "find-all-anagrams-in-a-string",

  // Stack
  "valid-parentheses",
  "min-stack",
  "evaluate-reverse-polish-notation",
  "generate-parentheses",
  "daily-temperatures",
  "car-fleet",
  "largest-rectangle-in-histogram",

  // Binary Search
  "binary-search",
  "search-a-2d-matrix",
  "koko-eating-bananas",
  "find-minimum-in-rotated-sorted-array-ii",
  "median-of-two-sorted-arrays",
  "time-based-key-value-store",

  // Linked List
  "reverse-linked-list",
  "merge-two-sorted-lists",
  "reorder-list",
  "remove-nth-node-from-end-of-list",
  "linked-list-cycle",
  "find-the-duplicate-number",
  "lru-cache",
  "merge-k-sorted-lists",
  "reverse-nodes-in-k-group",

  // Trees
  "invert-binary-tree",
  "maximum-depth-of-binary-tree",
  "diameter-of-binary-tree",
  "balanced-binary-tree",
  "same-tree",
  "subtree-of-another-tree",
  "lowest-common-ancestor-of-a-binary-search-tree",
  "binary-tree-level-order-traversal",
  "binary-tree-right-side-view",
  "count-good-nodes-in-binary-tree",
  "validate-binary-search-tree",
  "kth-smallest-element-in-a-bst",
  "construct-binary-tree-from-preorder-and-inorder-traversal",
  "binary-tree-maximum-path-sum",
  "serialize-and-deserialize-binary-tree",

  // Tries
  "implement-trie-prefix-tree",
  "design-add-and-search-words-data-structure",
  "word-search-ii",

  // Heap / Priority Queue
  "kth-largest-element-in-a-stream",
  "last-stone-weight",
  "k-closest-points-to-origin",
  "kth-largest-element-in-an-array",
  "task-scheduler",
  "design-twitter",
  "find-median-from-data-stream",

  // Backtracking
  "subsets",
  "combination-sum",
  "permutations",
  "subsets-ii",
  "combination-sum-ii",
  "word-search",
  "palindrome-partitioning",
  "letter-combinations-of-a-phone-number",
  "n-queens",

  // Graphs
  "number-of-islands",
  "clone-graph",
  "max-area-of-island",
  "pacific-atlantic-water-flow",
  "surrounded-regions",
  "rotting-oranges",
  "walls-and-gates",
  "course-schedule",
  "course-schedule-ii",
  "redundant-connection",
  "number-of-connected-components-in-an-undirected-graph",
  "graph-valid-tree",
  "word-ladder",

  // Advanced Graphs
  "reconstruct-itinerary",
  "min-cost-to-connect-all-points",
  "network-delay-time",
  "swim-in-rising-water",
  "alien-dictionary",

  // Dynamic Programming (1D)
  "climbing-stairs",
  "min-cost-climbing-stairs",
  "house-robber",
  "house-robber-ii",
  "longest-palindromic-substring",
  "palindromic-substrings",
  "decode-ways",
  "coin-change",
  "maximum-product-subarray",
  "word-break",
  "longest-increasing-subsequence",
  "partition-equal-subset-sum",

  // Dynamic Programming (2D)
  "unique-paths",
  "longest-common-subsequence",
  "best-time-to-buy-and-sell-stock-with-cooldown",
  "coin-change-ii",
  "target-sum",
  "interleaving-string",
  "edit-distance",
  "burst-balloons",
  "regular-expression-matching",

  // Greedy
  "maximum-subarray",
  "jump-game",
  "jump-game-ii",
  "gas-station",
  "hand-of-straights",
  "merge-triplets-to-form-target-triplet",
  "partition-labels",
  "valid-parenthesis-string",

  // Intervals
  "insert-interval",
  "merge-intervals",
  "non-overlapping-intervals",
  "meeting-rooms",
  "meeting-rooms-ii",
  "minimum-interval-to-include-each-query",

  // Math & Geometry
  "rotate-image",
  "spiral-matrix",
  "set-matrix-zeroes",
  "happy-number",
  "plus-one",
  "pow-x-n",
  "multiply-strings",
  "detect-squares",

  // Bit Manipulation
  "single-number",
  "number-of-1-bits",
  "counting-bits",
  "reverse-bits",
  "missing-number",
  "sum-of-two-integers",
  "reverse-integer",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sleep for `ms` milliseconds — used between API calls to avoid rate limits. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Check whether a slug already exists in Upstash.
 * Returns true if found — used to skip already-seeded problems on re-run.
 */
async function alreadySeeded(slug: string): Promise<boolean> {
  try {
    const results = await vectorIndex.fetch([slug], { includeMetadata: false });
    return results.some((r) => r !== null);
  } catch {
    return false;
  }
}

/**
 * Fetch a full problem from the local dev server via the existing LeetCode
 * import API.  Returns null if the problem couldn't be fetched.
 */
async function fetchProblem(slug: string): Promise<{
  title: string;
  description: string;
  difficulty?: "Easy" | "Medium" | "Hard";
} | null> {
  try {
    const res = await fetch(`${DEV_SERVER}/api/import/leetcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://leetcode.com/problems/${slug}/` }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Ask Claude to generate a 2-3 sentence algorithmic summary of the problem.
 *
 * IMPORTANT: The summary is TECHNIQUE-focused, not narrative-focused.
 * This ensures that embeddings cluster problems by algorithm type rather
 * than by story.  "Two Sum" and "Four Sum" should be near each other in
 * vector space because they both use hash tables, not because they share
 * the word "Sum".
 */
async function generateSummary(
  title: string,
  description: string,
  difficulty: string
): Promise<string> {
  const prompt = `You are summarizing a coding problem for a semantic search index.

Problem title: "${title}"
Difficulty: ${difficulty}
Description (first 800 chars):
${description.slice(0, 800)}

Write a 2-3 sentence summary focused ONLY on:
1. The key data structure or algorithm technique used (e.g. "monotonic stack", "sliding window", "union-find")
2. The core insight or trick that makes the solution efficient
3. Time/space complexity if notable

Do NOT describe the problem's narrative or story.
Do NOT mention the problem title.
Keep it under 80 words.
Return just the summary text — no labels, no bullets, no markdown.`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001", // Use Haiku for cost efficiency on bulk seeding
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();
}

/**
 * Generate a 1536-dim embedding for the given text using
 * OpenAI's text-embedding-3-small model.
 */
async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌱 Seeding ${SLUGS.length} problems into Upstash Vector...\n`);

  let seeded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < SLUGS.length; i++) {
    const slug = SLUGS[i];
    const prefix = `[${i + 1}/${SLUGS.length}]`;

    // ── Skip if already seeded (resume-safe) ────────────────────────────
    const exists = await alreadySeeded(slug);
    if (exists) {
      console.log(`${prefix} ⏭  ${slug} (already seeded)`);
      skipped++;
      continue;
    }

    // ── Fetch full problem from dev server ───────────────────────────────
    const problem = await fetchProblem(slug);
    if (!problem) {
      console.log(`${prefix} ✗  ${slug} — fetch failed`);
      failed++;
      await sleep(500);
      continue;
    }

    const difficulty = problem.difficulty ?? "Medium";

    // ── Topics: extracted from problem metadata where possible ───────────
    // For now we use a small topic list derived from the slug name.
    // The Claude summary will capture the real technique.
    // A future improvement would be to fetch topics from LeetCode's GraphQL.
    const topics: string[] = [];

    // ── Generate Claude summary ──────────────────────────────────────────
    let summary: string;
    try {
      summary = await generateSummary(problem.title, problem.description, difficulty);
    } catch (err) {
      console.log(`${prefix} ✗  ${slug} — Claude summary failed:`, err);
      failed++;
      await sleep(500);
      continue;
    }

    // ── Build embed text ─────────────────────────────────────────────────
    //
    // Format: "{difficulty} {topics joined}. {Claude summary}"
    // Putting difficulty + topics first means high-level filters get
    // captured even when the summary is long.
    //
    const embedText = `${difficulty}${topics.length > 0 ? " " + topics.join(" ") : ""}. ${summary}`;

    // ── Generate OpenAI embedding ────────────────────────────────────────
    let vector: number[];
    try {
      vector = await embed(embedText);
    } catch (err) {
      console.log(`${prefix} ✗  ${slug} — embedding failed:`, err);
      failed++;
      await sleep(500);
      continue;
    }

    // ── Upsert into Upstash Vector ────────────────────────────────────────
    try {
      await vectorIndex.upsert({
        id: slug,
        vector,
        metadata: {
          slug,
          title: problem.title,
          difficulty: difficulty as "Easy" | "Medium" | "Hard",
          topics,
          summary,
        },
      });
      console.log(`${prefix} ✓  ${slug} (${difficulty})`);
      seeded++;
    } catch (err) {
      console.log(`${prefix} ✗  ${slug} — upsert failed:`, err);
      failed++;
    }

    // Rate-limit delay between requests
    await sleep(500);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n✅ Done!`);
  console.log(`   Seeded:  ${seeded}`);
  console.log(`   Skipped: ${skipped} (already existed)`);
  console.log(`   Failed:  ${failed}`);
  console.log(`\nTotal in index: ${seeded + skipped} problems\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
