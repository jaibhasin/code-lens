# CodeLens

Where Engineers Are Forged Under Pressure — a real-time collaborative code interview platform with AI-generated session debriefs and webcam-based gaze tracking.

## Run locally

1. **Install:** `npm install`

2. **Start the Yjs WebSocket server** (for real-time editor sync):
   ```bash
   npm run ws:yjs
   ```
   Runs on `ws://localhost:1234` by default.

3. **Start the app:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

4. **Optional env** (see `.env.example`):
   - `ANTHROPIC_API_KEY` — for AI debrief generation (required for debriefs)
   - `JUDGE0_BASE_URL` / `JUDGE0_AUTH_TOKEN` — code execution (defaults to Judge0 CE)
   - `NEXT_PUBLIC_WS_URL` — Yjs WebSocket URL (default `ws://localhost:1234`)

## Flow

1. **Interviewer:** Click "Create Room" → configure problem (title, description, examples, hidden tests) → optionally import from LeetCode → copy room link.
2. **Candidate:** Open the link → enter name → complete gaze calibration (or skip) → wait for session start → code in the shared editor (C, C++, Python, JavaScript, TypeScript, Java, Go).
3. **Both:** Run (visible examples) and Submit (all tests). Code runs via Judge0.
4. **Interviewer:** Click "End session" → AI debrief is generated → both can open the shareable debrief URL.

No auth, no database — room links are access control; state is in-memory.

## Features

### Real-Time Collaborative Editor
- Monaco editor synced via Yjs CRDT over WebSocket
- Remote cursors color-coded by role (emerald = candidate, blue = interviewer)
- 7 language templates (C, C++, Python, JavaScript, TypeScript, Java, Go)

### AI-Powered Debrief
- Claude Sonnet 4.6 generates structured evaluations after each session
- Scores across 4 dimensions (approach, problem-solving, code quality, structured thinking)
- Hire signal verdict with evidence-based reasoning
- Code evolution analysis from periodic snapshots

### Gaze Tracking (Anti-Cheat)
- Webcam-based eye tracking via WebGazer.js (runs entirely client-side, no video stored)
- 5-point click calibration with 2-point validation pass
- 2 Hz continuous monitoring during active session
- Classifies gaze into zones: on-screen, off-left, off-right, off-top, off-bottom
- Post-session heatmap on debrief page (interviewer-only) showing gaze distribution across the full field of view with the screen region highlighted
- Gaze patterns feed into AI integrity analysis (off-screen ratio, direction breakdown, cross-correlation with paste/tab-switch events)

### Session Integrity Signals
- Paste detection (clipboard + bulk insert)
- Tab blur/focus tracking with duration
- Fullscreen exit monitoring
- Gaze off-screen streak detection (>10 s)
- Cross-signal correlation (paste after tab switch, gaze streak near paste)
- All signals feed into the AI debrief integrity score

### Code Execution
- Judge0 integration for running and submitting code
- Visible example tests + hidden tests configured by interviewer
- Per-test pass/fail results displayed in real time

### LeetCode Import
- Paste a LeetCode URL on the setup page to auto-import problem title, description, and examples

## Architecture

```
Interviewer                              Candidate
     |                                        |
     |  POST /api/rooms → roomId              |
     |                                        |
     |  /room/{id}/setup?role=interviewer      |
     |  → configure problem, hidden tests      |
     |                                        |
     |                          /room/{id}     |
     |                          → name gate    |
     |                          → gaze calibration
     |                          → polls for "active"
     |                                        |
     |  PATCH status:"active"                  |
     |                          ← editor unlocks
     |                                        |
     |  ←——— Yjs CRDT sync (ws:1234) ———→     |
     |  ← real-time code collaboration →       |
     |                          gaze samples → |
     |                          (batched PATCH every 5s)
     |                                        |
     |  PATCH status:"ended"                   |
     |  → triggers generateDebrief()           |
     |    (async, Claude Sonnet 4.6)           |
     |                                        |
     |  /room/{id}/debrief (full view)         |
     |                  (simple view for candidate)
```

**Two servers run simultaneously:**
- **Next.js** (port 3000) — UI + API routes
- **Yjs WebSocket** (port 1234) — CRDT sync for the shared editor

**State:** Single in-memory `Map<string, Room>` in `lib/store.ts`. No database — sessions are lost on restart. Intentional for prototype stage.

## API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/rooms` | POST | Create room, returns `roomId` |
| `/api/rooms/[roomId]` | GET, POST, PATCH | Fetch room, receive sendBeacon gaze data (POST), update room state (PATCH) |
| `/api/execute` | POST | Run code via Judge0 |
| `/api/import/leetcode` | POST | Import a LeetCode problem |

## Project Structure

```
app/
  api/
    rooms/          — room CRUD + gaze data endpoints
    execute/        — Judge0 code execution
    import/leetcode — LeetCode scraper
  room/[roomId]/
    page.tsx        — interview room (editor + problem panel)
    setup/          — interviewer problem configuration
    debrief/        — post-session evaluation page
components/
  MonacoWithYjs.tsx   — collaborative Monaco editor
  GazeCalibration.tsx — 5-point calibration overlay
  GazeHeatmap.tsx     — post-session gaze heatmap (canvas)
hooks/
  useGazeTracker.ts   — continuous gaze sampling + batched upload
lib/
  store.ts          — in-memory room state + types
  ai-debrief.ts     — Claude-powered evaluation generation
  judge0.ts         — Judge0 API wrapper
types/
  webgazer.d.ts     — TypeScript declarations for webgazer
docs/               — feature tracking files
future_improvements/ — planned upgrades (e.g. MediaPipe gaze replacement)
```
