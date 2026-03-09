# CodeLens

Where Engineers Are Forged Under Pressure — a real-time collaborative code interview platform with AI-generated session debriefs.

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
   - `OPENAI_API_KEY` — for AI debrief generation (required for debriefs)
   - `JUDGE0_BASE_URL` / `JUDGE0_AUTH_TOKEN` — code execution (defaults to Judge0 CE)
   - `NEXT_PUBLIC_WS_URL` — Yjs WebSocket URL (default `ws://localhost:1234`)

## Flow

1. **Interviewer:** Click “Create Room” → configure problem (title, description, examples, hidden tests) → copy room link.
2. **Candidate:** Open the link → code in the shared editor (C, C++, Python, JavaScript).
3. **Both:** Run (visible examples) and Submit (all tests). Code runs via Judge0.
4. **Interviewer:** Click “End session” → AI debrief is generated → both can open the shareable debrief URL.

No auth, no database — room links are access control; state is in-memory.
