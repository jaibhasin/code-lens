## Status: done

## Decisions
- **Warning is a blocking modal, not a dismissible toast** — candidate cannot click away from it; they must re-enter fullscreen to continue working. This is intentional: a dismissible warning would be trivially bypassed. The interviewer already sees the exit in the debrief, so the modal is purely for the candidate's awareness + pressure.
- **No backend changes needed** — fullscreen exit was already being recorded via `pushTimelineEvent("fullscreen_exit", {})` in the existing `fullscreenchange` listener (`app/room/[roomId]/page.tsx:290–301`). The warning is purely a UI layer on top of the existing `isFullscreen` state.
- **Overlay uses `z-50` with `backdrop-blur-sm`** — sits above the entire room UI including the header. The blurred backdrop makes it clear the editor is inaccessible, reinforcing the "you must fix this" message without hiding the code entirely.
- **Red color scheme chosen over amber** — amber is already used for the "Re-enter fullscreen" header button (a softer nudge). The modal is a stronger signal so red was used to distinguish severity.
- **Kept the header "Re-enter fullscreen" button** — it still renders behind the modal. Once fullscreen is re-entered both disappear together (both driven by `!isFullscreen`).
- **No dismiss/continue button** — not adding one. If a future requirement arises to allow continuing outside fullscreen, add it then. YAGNI.

## Implemented this session
- **`app/room/[roomId]/page.tsx`** — Added a fullscreen exit warning overlay rendered after the main room grid:
  - Conditionally rendered when: `role === "candidate" && room.status === "active" && !isFullscreen`
  - Contains: red warning icon (SVG triangle), "Fullscreen Required" heading, explanatory body text telling candidate the exit was recorded, single "Return to Fullscreen" CTA button
  - Button calls `document.documentElement.requestFullscreen()` — user gesture, works in all browsers including Firefox
  - Uses `fixed inset-0 z-50` so it covers the full viewport including the header

## Open questions
- Should the overlay also appear on the interviewer's side showing that the candidate exited fullscreen? Currently interviewers see it only in the post-session debrief integrity flags.
- Consider adding a countdown timer ("Return to fullscreen in 30s or this will be flagged as a serious violation") for extra pressure — deferred for now.
- F11 fullscreen on Windows/Linux bypasses the Fullscreen API entirely — this warning will NOT trigger in that case. Known browser limitation, documented in `CLAUDE.md` architecture notes.

## Rejected approaches
- **Dismissible toast/banner** — rejected because candidates would just dismiss it and continue outside fullscreen. The modal blocking approach gives no easy escape.
- **Locking the editor (read-only) when not in fullscreen** — considered but rejected. Would be disruptive if fullscreen exits accidentally (Escape key), and the candidate still needs to be able to type to return to work immediately after re-entering. The warning + log is sufficient deterrent.
- **Separate `showFullscreenWarning` state variable** — unnecessary since `!isFullscreen` during an active candidate session is exactly the condition. Adding a separate state would allow the warning to be dismissed without re-entering fullscreen, which defeats the purpose.
