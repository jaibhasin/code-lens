# AI Problem Picker Feature

> **Status:** In Planning
> **Last updated:** 2026-03-13

---

## Overview

This feature adds a 3-option problem selection flow to the interview setup. Instead of a single combined form, the interviewer is presented with a clean landing page offering three paths to configure the coding problem for a session.

---

## Problem Source Options

| Option | Description |
|--------|-------------|
| **LeetCode URL** | Paste a LeetCode problem URL — scrapes title, description, and examples automatically |
| **Enter Manually** | Write a custom problem from scratch (title, description, examples, hidden tests) |
| **AI Picks** | Describe what you want — AI finds 3 matching problems, you choose one, AI rewrites it so the candidate can't Google it |

---

## AI Picks Flow (Detailed)

### Step 1 — Filter Form
The interviewer specifies:
- **Difficulty:** Any / Easy / Medium / Hard
- **Topic:** Arrays, Sliding Window, Trees, DP, Graphs, etc.
- **Hint (optional):** Free-text like _"something not too obvious, not Two Sum"_

### Step 2 — Vector Search
- The interviewer's filters + hint are combined into a query string
- The query is embedded using **Upstash Vector's built-in embedding** (no OpenAI key needed)
- A similarity search returns the top ~10 nearest problems from the index
- Claude re-ranks and selects the best 3, returning a one-sentence reasoning for each

### Step 3 — Fetch Real Problems
- The 3 slugs are used to fetch full problem data (description, examples, hidden tests) via the existing `/api/import/leetcode` endpoint — 3 parallel requests

### Step 4 — Choose a Problem
- Interviewer sees 3 cards: real title, difficulty badge, topic tags, Claude's reasoning
- Clicks **Select** on one

### Step 5 — AI Rewrites the Problem
- Claude rewrites the **title and description** with a completely fresh real-world scenario
  - e.g. "Two Sum" → "Find two transaction IDs in a payment log that sum to a refund target"
- The original **examples and hidden tests are kept byte-for-byte identical**
- The candidate cannot Google the rewritten problem

### Step 6 — Enter the Room
- Rewritten problem is saved to the room
- Interviewer is navigated to the room as usual

---

## Architecture

### Vector Database: Upstash Vector
Chosen because:
- **Serverless** — no always-on infrastructure, perfect for Next.js/Vercel
- **Built-in embedding** — no OpenAI API key needed; Upstash handles embedding internally
- **Free tier** — generous for this use case
- **Simple setup** — just 2 env vars: `UPSTASH_VECTOR_REST_URL` + `UPSTASH_VECTOR_REST_TOKEN`
- **One-time seed script** — embed all ~2500 free LeetCode problems once; update anytime

### What gets stored in each vector record
```
id:       "two-sum"                          (the LeetCode slug)
vector:   [float32 × 1536]                  (embedding of the text below)
metadata: {
  slug:       "two-sum",
  title:      "Two Sum",
  difficulty: "Easy",
  topics:     ["Arrays", "Hash Table"],
  summary:    "Given an array of integers, return indices of the two numbers that add up to a target. Use a hash map for O(n) lookup. Classic hash table application — the trick is storing complement → index."
}
```

The `summary` field is the key — it describes the **algorithmic insight**, not the problem story, so embeddings cluster by technique rather than theme.

### Query flow
```
Interviewer prompt: "medium sliding window not too obvious"
      ↓
Build query string: "Medium Sliding Window medium sliding window not too obvious"
      ↓
Upstash Vector similarity search (top 10, filtered by difficulty/topic metadata)
      ↓
Claude re-ranks 10 → picks best 3 with reasoning
      ↓
Fetch full problems from /api/import/leetcode (3 parallel)
      ↓
Show 3 cards → user picks → Claude rewrites → save → room
```

---

## File Structure

```
app/
  room/[roomId]/
    setup/
      page.tsx                  ← MODIFIED: 3-card picker landing
      leetcode/
        page.tsx                ← NEW: extracted LeetCode import form
      manual/
        page.tsx                ← NEW: extracted manual form
      ai/
        page.tsx                ← NEW: AI picker UI (4 step states)

app/api/
  ai/
    pick-problem/
      route.ts                  ← NEW: vector search + Claude re-rank → 3 slugs
    rewrite-problem/
      route.ts                  ← NEW: Claude rewrites title + description

lib/
  upstash.ts                    ← NEW: Upstash Vector client singleton
  problem-topics.ts             ← NEW: shared topic list constants

scripts/
  seed-problems.ts              ← NEW: one-time script to embed & upsert all problems
```

### Untouched Files
- `app/api/rooms/[roomId]/route.ts` — PATCH already supports `{ problem, interviewerCompany }`
- `app/api/import/leetcode/route.ts` — reused as-is
- `lib/store.ts`, `lib/ai-debrief.ts`, `app/room/[roomId]/page.tsx`
- No new npm dependencies beyond `@upstash/vector`

---

## New Environment Variables

```bash
# Upstash Vector (get from console.upstash.com)
UPSTASH_VECTOR_REST_URL=https://...upstash.io
UPSTASH_VECTOR_REST_TOKEN=...
```

No OpenAI key needed — Upstash handles embedding internally.

---

## Company Name Persistence
- Input field lives on the **picker landing page**
- Saved to `localStorage` key `codelens_company` on every keystroke
- All sub-pages read it from `localStorage` on mount

---

## UI States — AI Picker Page

```
"form"      → filter form (difficulty + topic + hint)
"picking"   → amber spinner: "Searching for matching problems…"
"cards"     → 3 problem cards with Select button each
"rewriting" → amber spinner: "Rewriting problem for your interview…"
→ done      → router.push to /room/[roomId]?role=interviewer
```

---

## Claude Prompts

### Re-rank (inside pick-problem route)
> Give Claude the top 10 vector results as JSON. Ask it to pick the best 3 for the interviewer's specific request, returning `[{ slug, reasoning }]`.

### Rewrite Problem
> Give Claude the real title + description. Instruct it to create a new real-world scenario that preserves the exact algorithmic structure. Claude returns `{ title, description }` only — examples and hiddenTests are attached server-side from the original.

---

## Seed Script (`scripts/seed-problems.ts`)

Runs once (or whenever you want to update the dataset):
1. Script contains a hardcoded list of ~300-500 free-tier LeetCode problem slugs (just the slugs — no content needed upfront)
2. For each slug:
   - Fetch the real problem via the existing `/api/import/leetcode` scraper (gets title, description, difficulty, examples)
   - Ask Claude to write a 2-3 sentence **algorithmic summary** — describes the technique, data structure, and key insight, NOT the story wrapper
   - Build `data` string: `"${difficulty} ${topics.join(' ')}. ${claudeSummary}"`
   - Call `vectorIndex.upsert({ id: slug, data, metadata: { slug, title, difficulty, topics, summary } })`
3. Upstash auto-embeds `data` using `bge-m3` — no embedding model to call directly
4. Run with: `npx tsx scripts/seed-problems.ts`

### Example of what gets stored
```
id:   "sliding-window-maximum"
data: "Hard Sliding Window Deque. Maintain a monotonic deque of indices to track
       the maximum element in a fixed-size window. Evict elements from the back
       when a larger element arrives, and from the front when out of window.
       Achieves O(n) overall by ensuring each element is enqueued/dequeued once."
metadata: {
  slug:       "sliding-window-maximum",
  title:      "Sliding Window Maximum",
  difficulty: "Hard",
  topics:     ["Sliding Window", "Deque"],
  summary:    "Maintain a monotonic deque..."
}
```

The `summary` describes the **algorithm** so embeddings cluster by technique, not problem story.

---

## Cost Estimate
| Operation | Cost |
|-----------|------|
| Vector search (per query) | ~$0.0001 |
| Claude re-rank (~2K tokens) | ~$0.006 |
| Claude rewrite (~2K tokens) | ~$0.006 |
| **Total per AI-path setup** | **~$0.013** |

Seeding ~2500 problems: ~$0.005 one-time (Upstash free tier covers it entirely).

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-13 | Initial design — 3-option picker, AI rewrite flow |
| 2026-03-13 | Switched from JSON dataset to Upstash Vector for semantic search |
| 2026-03-13 | Seed strategy finalized: Claude auto-generates algorithmic summaries during seeding (no manual effort) |
