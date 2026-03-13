/**
 * ─────────────────────────────────────────────────────────────────────────────
 * lib/upstash.ts
 *
 * Upstash Vector client singleton for the AI Problem Picker feature.
 *
 * PURPOSE:
 *   Creates a single shared Index client that all server-side code reuses.
 *   Avoids spinning up a new HTTP connection on every API call in development.
 *
 * WHAT IS UPSTASH VECTOR?
 *   A serverless vector database (free tier available at console.upstash.com).
 *   We store one record per LeetCode problem:
 *     - id:       LeetCode slug  (e.g. "two-sum")
 *     - vector:   1536-dimensional float array from OpenAI text-embedding-3-small
 *     - metadata: { slug, title, difficulty, topics[], summary }
 *
 *   During "AI Picks", we embed the interviewer's query and call
 *   index.query() to find the closest matching problems by cosine similarity.
 *
 * SETUP:
 *   1. Create a free index at console.upstash.com → Vector → Create Index
 *      Settings: Dimensions = 1536, Distance metric = COSINE
 *   2. Copy the REST URL and REST TOKEN into .env.local:
 *        UPSTASH_VECTOR_REST_URL=https://...upstash.io
 *        UPSTASH_VECTOR_REST_TOKEN=...
 *   3. Run the seed script once:  npx tsx scripts/seed-problems.ts
 *
 * USED BY:
 *   app/api/ai/pick-problem/route.ts  — similarity search at query time
 *   scripts/seed-problems.ts          — upsert during initial seeding
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Index } from "@upstash/vector";

/**
 * Shape of the metadata we store alongside each problem's vector.
 * Must match exactly what the seed script upserts.
 *
 * The index signature `[key: string]: unknown` is required by @upstash/vector's
 * internal `Dict` constraint — Upstash needs metadata to be an open record type.
 */
export interface ProblemMetadata {
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topics: string[];
  /** Claude-generated 2-3 sentence technique-focused summary, used as embed text */
  summary: string;
  [key: string]: unknown;
}

/**
 * Singleton Upstash Vector Index instance.
 *
 * `Index.fromEnv()` reads UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN
 * automatically from process.env — no constructor args needed.
 *
 * The generic type parameter tells TypeScript what shape our metadata has,
 * so index.query() results are typed as QueryResult<ProblemMetadata>[].
 */
export const vectorIndex = new Index<ProblemMetadata>();
