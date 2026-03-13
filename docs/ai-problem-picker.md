# AI Problem Picker Feature

> **Status:** in-progress
> **Last updated:** 2026-03-14

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

### Vector Database: Upstash Vector + OpenAI Embeddings
- **Upstash Vector** — serverless vector DB, free tier, perfect for Next.js/Vercel
- **OpenAI `text-embedding-3-small`** — industry gold standard for semantic search, 1536 dimensions
  - Seeding cost: ~500 problems × ~100 tokens = **~$0.001 one-time**
  - Per-query cost: ~100 tokens = fraction of a cent
- 3 new env vars: `UPSTASH_VECTOR_REST_URL`, `UPSTASH_VECTOR_REST_TOKEN`, `OPENAI_API_KEY`

### What gets stored in each vector record
```
id:       "two-sum"                          (the LeetCode slug)
vector:   [float32 × 1536]                  (OpenAI text-embedding-3-small)
metadata: {
  slug:       "two-sum",
  title:      "Two Sum",
  difficulty: "Easy",
  topics:     ["Arrays", "Hash Table"],
  summary:    "Use a hash map to store complement → index pairs for O(n) lookup.
               Classic hash table application — the trick is one pass through
               the array while checking if the needed complement already exists."
}
```

The embedded text = `"Easy Arrays Hash Table. <Claude-generated algorithmic summary>"`.
The `summary` describes the **technique**, not the problem story — so embeddings cluster by algorithm, not narrative.

### Query flow
```
Interviewer prompt: "medium sliding window not too obvious"
      ↓
Build query string: "Medium Sliding Window medium sliding window not too obvious"
      ↓
OpenAI text-embedding-3-small → 1536-dim query vector
      ↓
Upstash Vector similarity search (top 10)
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

### One-time setup
1. Create a free Upstash Vector index at [console.upstash.com](https://console.upstash.com) → "Vector" → "Create Index"
   - **Dimensions:** `1536` (matches OpenAI `text-embedding-3-small`)
   - **Distance metric:** `COSINE`
   - Copy `REST URL` and `REST TOKEN` into `.env`
2. Add `OPENAI_API_KEY` to `.env`
3. Start the Next.js dev server (`npm run dev`) — the seed script calls the local API
4. Run: `npx tsx scripts/seed-problems.ts`

### How it iterates through problems

The script has a hardcoded list of ~300-500 free-tier LeetCode slugs. It processes them **sequentially** (not in parallel) with a 500ms delay between each to avoid rate limits:

```
for each slug in SLUGS:
  1. FETCH   → POST /api/import/leetcode { slug }
               gets real title, description, difficulty, examples from LeetCode

  2. SUMMARIZE → ask Claude for a 2-3 sentence algorithmic summary
                 (technique-focused: data structure, approach, key insight)

  3. BUILD   → embedText = "${difficulty} ${topics}. ${claudeSummary}"

  4. EMBED   → OpenAI text-embedding-3-small(embedText) → float32[1536]

  5. UPSERT  → vectorIndex.upsert({
                 id: slug,
                 vector: embedding,
                 metadata: { slug, title, difficulty, topics, summary }
               })

  6. LOG     → "✓ sliding-window-maximum (Hard) [47/312]"
```

**Resume-safe:** Script checks if slug already exists in Upstash before processing — skips if found. Safe to re-run after interruptions.

### Example of what gets stored
```
id:     "sliding-window-maximum"
vector: [float32 × 1536]  ← OpenAI embedding of the text below
metadata: {
  slug:       "sliding-window-maximum",
  title:      "Sliding Window Maximum",
  difficulty: "Hard",
  topics:     ["Sliding Window", "Deque"],
  summary:    "Maintain a monotonic deque of indices to track the maximum in a
               fixed-size window. Evict from the back when a larger element
               arrives, from the front when out of window. O(n) overall."
}
```

The embedded text = `"Hard Sliding Window Deque. Maintain a monotonic deque..."` — describes the **algorithm**, not the story, so similar techniques cluster together in vector space.

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

## Status: in-progress

## Decisions
- Used OpenAI `text-embedding-3-small` (1536 dims) over Upstash built-in embedding for better semantic quality
- Company name stored in `localStorage["codelens_company"]` — set on landing page, read by sub-pages
- `ProblemMetadata` has an index signature `[key: string]: unknown` to satisfy `@upstash/vector`'s `Dict` constraint
- Seed script uses Claude Haiku for cost-efficient bulk summary generation
- All sub-pages use lazy `useState` initializers (not `useEffect`) to hydrate from localStorage — avoids cascading render lint errors

## Implemented this session (2026-03-14)
- `app/room/[roomId]/setup/page.tsx` — refactored to 3-card picker landing
- `app/room/[roomId]/setup/leetcode/page.tsx` — extracted LeetCode import form
- `app/room/[roomId]/setup/manual/page.tsx` — extracted manual problem form
- `app/room/[roomId]/setup/ai/page.tsx` — full AI picker UI (form → picking → cards → rewriting)
- `app/api/ai/pick-problem/route.ts` — vector search + Claude re-rank API
- `app/api/ai/rewrite-problem/route.ts` — Claude problem rewrite API
- `lib/upstash.ts` — Upstash Vector client singleton + `ProblemMetadata` type
- `lib/problem-topics.ts` — shared topic list constants
- `scripts/seed-problems.ts` — one-time seeding script (~300 slugs, resume-safe)
- `.env.example` updated with `UPSTASH_VECTOR_REST_URL`, `UPSTASH_VECTOR_REST_TOKEN`, `OPENAI_API_KEY`
- `@upstash/vector` and `openai` npm packages installed

## Open questions
- Topics metadata: currently empty array in seed script (LeetCode doesn't expose topics in public GraphQL easily). Could add a hardcoded slug→topics map or scrape differently.
- Need to actually run the seed script once Upstash index is created and env vars are set

## Rejected approaches
- Upstash built-in embedding: switched to OpenAI for better semantic clustering by algorithm type

## Changelog

| Date | Change |
|------|--------|
| 2026-03-13 | Initial design — 3-option picker, AI rewrite flow |
| 2026-03-13 | Switched from JSON dataset to Upstash Vector for semantic search |
| 2026-03-13 | Seed strategy finalized: Claude auto-generates algorithmic summaries during seeding (no manual effort) |
| 2026-03-13 | Switched from Upstash built-in embedding to OpenAI `text-embedding-3-small` for better semantic quality |
| 2026-03-14 | Full implementation — all files created, TypeScript clean, lint passing |
