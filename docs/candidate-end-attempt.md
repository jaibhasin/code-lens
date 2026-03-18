# Candidate "End Attempt" Feature

## Status: done

## Decisions
- Button label is **"End attempt"** — neutral/professional, avoids defeatist language like "give up"
- Confirmation modal uses encouraging copy: "It's completely okay to end early — knowing when to step back is a strength."
- Button is styled as a muted outline (`border-zinc-600`, no glow) so it doesn't compete visually with Run/Submit
- Only visible to candidates when session status is `"active"`
- Candidate "End attempt" does NOT end the session — it only records a signal. Only the interviewer can end the session and trigger the evaluation.
- A dedicated `end_attempt` timeline event is logged, so the AI debrief can distinguish candidate-initiated ends from interviewer-initiated ones
- Candidate is redirected to a "Session Complete" screen with no evaluation data
- Interviewer sees a banner notification when the candidate finishes

## Implemented this session
- `showEndConfirm` state + confirmation modal in `app/room/[roomId]/page.tsx`
- `endAttempt()` handler that pushes `end_attempt` timeline event with `reason` and `codeLength`, then calls `endSession()`
- "End attempt" button in header, candidate-only, active-session-only
- Updated `lib/ai-debrief.ts`:
  - `buildIntegritySignals()` now surfaces `end_attempt` events with timestamp and code length
  - Debrief prompt's `problem_solving_behavior` field instructs Claude to note self-termination and consider progress made

## Implemented (separate end flows session)
- Added `candidateFinishedAt: number | null` to Room interface and createRoom in `lib/store.ts`
- Added `end_attempt` to `TimelineEventType` union (was missing)
- PATCH API route (`app/api/rooms/[roomId]/route.ts`) handles `candidateFinished` field — sets timestamp and saves code without changing room status
- Refactored `endAttempt()` in room page: PATCHes `{ candidateFinished: true, code }` instead of ending the session, exits fullscreen, redirects to `/room/{id}/debrief?role=candidate`
- Updated confirmation modal copy: "The interviewer will be notified that you have finished" (was: "The session will end for both you and the interviewer")
- Interviewer `endSession()` now redirects to `/room/{id}/debrief?role=interviewer`
- Added interviewer-side polling to detect `candidateFinishedAt`, with amber banner notification
- Debrief page: candidate view (`?role=candidate`) shows a "Session Complete" screen with checkmark, thank-you message, and no evaluation data

## Open questions
- Could add a free-text "reason" field in the confirmation modal (e.g. "I'm stuck", "I'm done")

## Rejected approaches
- "Give up" label — too negative, user requested something motivating
- Separate "surrender" API endpoint — unnecessary, reusing the existing PATCH status:"ended" flow is simpler and consistent
- Candidate ending the session directly — gives the candidate power to trigger the evaluation and see it; only the interviewer should control session lifecycle
