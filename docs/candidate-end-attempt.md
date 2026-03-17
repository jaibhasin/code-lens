# Candidate "End Attempt" Feature

## Status: done

## Decisions
- Button label is **"End attempt"** — neutral/professional, avoids defeatist language like "give up"
- Confirmation modal uses encouraging copy: "It's completely okay to end early — knowing when to step back is a strength."
- Button is styled as a muted outline (`border-zinc-600`, no glow) so it doesn't compete visually with Run/Submit
- Only visible to candidates when session status is `"active"`
- Reuses the existing `endSession()` flow (PATCH status → "ended", redirect to debrief)
- A dedicated `end_attempt` timeline event is logged *before* ending, so the AI debrief can distinguish candidate-initiated ends from interviewer-initiated ones

## Implemented this session
- `showEndConfirm` state + confirmation modal in `app/room/[roomId]/page.tsx`
- `endAttempt()` handler that pushes `end_attempt` timeline event with `reason` and `codeLength`, then calls `endSession()`
- "End attempt" button in header, candidate-only, active-session-only
- Updated `lib/ai-debrief.ts`:
  - `buildIntegritySignals()` now surfaces `end_attempt` events with timestamp and code length
  - Debrief prompt's `problem_solving_behavior` field instructs Claude to note self-termination and consider progress made

## Open questions
- Should the interviewer see a notification that the candidate ended their attempt (before the redirect)?
- Could add a free-text "reason" field in the confirmation modal (e.g. "I'm stuck", "I'm done")

## Rejected approaches
- "Give up" label — too negative, user requested something motivating
- Separate "surrender" API endpoint — unnecessary, reusing the existing PATCH status:"ended" flow is simpler and consistent
