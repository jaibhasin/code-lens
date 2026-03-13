/**
 * ─────────────────────────────────────────────────────────────────────────────
 * lib/problem-topics.ts
 *
 * Shared constants for the AI Problem Picker feature.
 *
 * PURPOSE:
 *   Defines the list of algorithm/data-structure topics that the interviewer
 *   can filter by when using the "AI Picks" path on the setup page.
 *   This same array is used by:
 *     - the AI picker UI dropdown  (app/room/[roomId]/setup/ai/page.tsx)
 *     - the pick-problem API route (app/api/ai/pick-problem/route.ts)
 *     - the seed script            (scripts/seed-problems.ts)
 *
 * HOW IT FITS:
 *   Interviewer picks a topic  →  query string built in pick-problem route  →
 *   OpenAI embeds the query  →  Upstash Vector similarity search clusters
 *   problems by ALGORITHM (not story), so "Sliding Window" finds problems
 *   that use a sliding-window approach regardless of their narrative.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** All selectable topics for the AI Picks filter form. */
export const PROBLEM_TOPICS = [
  "Arrays",
  "Hash Table",
  "Linked List",
  "Stack",
  "Queue",
  "Trees",
  "Binary Search",
  "Sliding Window",
  "Two Pointers",
  "Dynamic Programming",
  "Backtracking",
  "Graphs",
  "BFS",
  "DFS",
  "Heap / Priority Queue",
  "Sorting",
  "Greedy",
  "Math",
  "String",
  "Recursion",
  "Divide and Conquer",
  "Bit Manipulation",
  "Trie",
  "Union Find",
  "Monotonic Stack",
] as const;

/** Union type of all valid topic strings — used for type-safe props. */
export type ProblemTopic = (typeof PROBLEM_TOPICS)[number];
