# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Development (run both in separate terminals)
npm run ws:yjs   # Yjs WebSocket server on port 1234
npm run dev      # Next.js dev server on port 3000

# Production
npm run build
npm start

# Linting
npm run lint
```

## Environment Setup

Copy `.env.example` to `.env.local`. Only `ANTHROPIC_API_KEY` is required for full functionality:

```
ANTHROPIC_API_KEY=sk-ant-...         # Required for AI debriefs
JUDGE0_BASE_URL=https://ce.judge0.com  # Defaults to community edition
JUDGE0_AUTH_TOKEN=                    # Optional, for private Judge0 instances
NEXT_PUBLIC_WS_URL=ws://localhost:1234 # Yjs WebSocket (browser-exposed)
```

## Architecture Overview

CodeLens is a real-time collaborative coding interview platform. Two servers must run simultaneously:
1. **Next.js** (port 3000) — serves UI and API routes
2. **Yjs WebSocket server** (port 1234) — syncs the shared Monaco editor state via CRDT

### Data Flow & Session Lifecycle

```
Interviewer                          Candidate
  |                                     |
  | POST /api/rooms                     |
  | → roomId (nanoid)                   |
  |                                     |
  | /room/{id}/setup?role=interviewer   |
  | → configure problem, hidden tests   |
  | → optional: import from LeetCode    |
  |                                     |
  |                        /room/{id}   |
  |                        → name gate  |
  |                        → polls for  |
  |                          "active"   |
  |                                     |
  | PATCH status:"active"               |
  |        ← editor unlocks            |
  |                                     |
  |    ←— Yjs CRDT sync (ws:1234) —→   |
  |    ← real-time code collaboration → |
  |                                     |
  | PATCH status:"ended"                |
  | → triggers generateDebrief()        |
  |   (async, Claude Sonnet 4.6)        |
  |                                     |
  | /room/{id}/debrief (full view)      |
  |                     (simple view)   |
```

### State Management

All room state lives in a **single in-memory `Map<string, Room>`** in `lib/store.ts` — no database. Sessions are lost on server restart. This is intentional for the current prototype stage.

### Key Design Patterns

**Collaborative editing**: Yjs CRDT (`yjs` + `y-monaco` + `y-websocket`) handles conflict resolution automatically. `components/MonacoWithYjs.tsx` binds the Monaco editor to a Yjs document. Remote cursors are color-coded (emerald=candidate, blue=interviewer).

**Timeline tracking**: Every candidate action (keystrokes, pastes, tab blur/focus, runs, submits, language changes) is appended to `room.timeline` as a `TimelineEvent`. Up to 60 code snapshots are recorded. This feeds into the AI debrief integrity analysis.

**Debrief generation** (`lib/ai-debrief.ts`): When a session ends, the server fires an async call to Claude Sonnet 4.6. The timeline is compressed (first 10, middle window, last 20 events) to fit the context window. Claude returns structured JSON with scores, verdict, strengths/weaknesses, and integrity flags. The UI polls `/api/rooms/{id}` every 3s until `debrief.status` is no longer `"generating"`.

**Code execution** (`lib/judge0.ts`): Wraps the Judge0 API. Sends candidate code + test cases, polls for result, normalizes output for comparison (trims whitespace, normalizes newlines).

**LeetCode import** (`app/api/import/leetcode/route.ts`): Fetches from LeetCode's public GraphQL API, parses problem HTML, extracts examples from the description text.

### API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/rooms` | POST | Create room, returns `roomId` |
| `/api/rooms/[roomId]` | GET, PATCH | Fetch or update room state |
| `/api/execute` | POST | Run code via Judge0, stores results in room |
| `/api/import/leetcode` | POST | Scrape and parse a LeetCode problem |

### Role-Based Access

Rooms have no authentication. Role is passed via URL query param `?role=interviewer`. The debrief page uses `?role=candidate` to show a simplified view (score + verdict only).

### Anti-Cheating Signals

Paste events, tab-switch durations, and code snapshots are all recorded in the timeline. The AI debrief prompt instructs Claude to analyze these signals for suspicious patterns (large paste after tab switch, solution appearing fully-formed, etc.). See `docs/CHEATING_DETECTION_STRATEGY.md` for the full threat model.

## Feature Tracking

Active feature notes live in `docs/`. Each file tracks one feature in progress.

**At the end of every session, update the relevant feature file with:**
- Decisions made and why
- What was implemented
- Open questions remaining
- Any approaches that were tried and rejected

Never end a session without updating the feature file. This keeps context available across tools (Cursor, new Claude sessions) without re-explaining.

### Feature File Format

Each `docs/*.md` must follow this structure:

```markdown
## Status: [in-progress | done | blocked]

## Decisions
- ...

## Implemented this session
- ...

## Open questions
- ...

## Rejected approaches
- ...
```

## Rules

- Write tests for any new API route before marking it done
- Run `npm run lint` before committing
- Keep `lib/store.ts` as the single source of truth for room state — no parallel state
- Do not add a database unless explicitly asked; prototype uses in-memory store intentionally