## Status: in-progress

## Decisions
- Keep `WebGazer` as the capture provider for now because the immediate goal was a better session heatmap, not a full provider replacement; a MediaPipe migration is still a future option once the front-plane model is validated.
- Shift the primary objective from cheating-signal histograms to a session-level front-plane heatmap because the user explicitly wanted a full spatial map of where the candidate looked over time.
- Replace the old viewport bucket mental model with a single front-facing plane because a large outer viewing field plus a smaller laptop rectangle cannot be represented honestly with only `on_screen` and four directional buckets.
- Treat the laptop screen as an inferred rectangle inside the larger plane because the requested visualization depends on one shared coordinate system for on-screen and off-screen looking.
- Fit geometry from observed validation predictions when enough real validation data exists because the screen rectangle needed to move with actual calibration drift, not remain effectively hard-coded.
- Add an explicit `approximate_fallback` geometry path because missing or weak validation data should not be mislabeled as a measured fit.
- Keep the existing calibration UX broadly intact while improving the validation pass because the user asked for freedom to change the algorithm, but there was no request to redesign the candidate flow from scratch.
- Use multiple averaged validation predictions per target because single-frame validation was too noisy for a believable fitted plane model.
- Persist the fitted plane model on the room and backfill it with gaze batches because capture, storage, debrief, and rendering needed to stay on the same geometry even if the initial calibration PATCH failed or the session ended quickly.
- Keep `2 Hz` sampling because it already provides enough temporal density for a session heatmap while avoiding unnecessary payload growth.
- Add smoothing before projection because raw predictions were too jittery for a dot-based front-plane heatmap.
- Store both raw normalized coordinates and projected plane coordinates because future debugging and provider comparisons will need to distinguish capture noise from projection behavior.
- Keep directional streak timeline events alongside the new plane samples because the existing integrity flow still uses those events and the heatmap work should not silently remove them.
- Make sample quality affect rendering and debrief interpretation because quality metadata would be misleading if it were stored but ignored.
- Surface `observed_fit` versus `approximate_fallback` in the UI because low-confidence observed fits and true fallback geometry are materially different states for future experiments and reviewer trust.
- Keep the heatmap interviewer-only because nothing in this session changed the earlier product decision to avoid exposing gaze analytics to the candidate view.
- Update the handoff note in `docs/` and the working note in `future_improvements/` because this session is laying the foundation for future heatmap experiments, provider swaps, and reliability work.

## Implemented this session
- `lib/gaze-plane.ts` — created a tested front-plane geometry module that builds the outer viewing field, embeds the inferred laptop rectangle, projects gaze samples, smooths normalized points, and falls back explicitly when calibration evidence is insufficient or implausible.
- `lib/gaze-plane.test.ts` — added geometry tests covering normal fits, drifted fits, fallback with missing observations, fallback with insufficient axis spread, projection behavior, and smoothing behavior.
- `lib/store.ts` — expanded `GazeSample` with `rawX`, `rawY`, `planeX`, `planeY`, `insideScreen`, and `clamped`; added `GazePlaneRect`, `GazePlaneModel`, and `room.gazePlaneModel`.
- `components/GazeCalibration.tsx` — changed validation from sparse single-shot checks to averaged multi-sample validation, captured observed validation predictions, built a fitted or fallback `gazePlaneModel`, persisted it with calibration state, and returned it immediately to the room page.
- `hooks/useGazeTracker.ts` — switched runtime capture from simple viewport buckets to smoothed front-plane projection, stored richer per-sample geometry and confidence data, included the plane model in batch flushes, and preserved directional streak timeline events.
- `app/api/rooms/[roomId]/route.ts` — normalized richer gaze sample payloads, validated/stored `gazePlaneModel` on both `PATCH` and `POST`, and kept compatibility for older samples by backfilling missing fields.
- `components/GazeHeatmap.tsx` — rebuilt the renderer around the new front-plane model: large outer rectangle for the forward viewing field, smaller embedded laptop-screen rectangle, time-weighted point and density accumulation across the whole plane, and clearer quality badges for observed fits versus fallback geometry.
- `app/room/[roomId]/page.tsx` — kept a local plane model immediately after calibration, passed it into `useGazeTracker`, and synced it from room fetches so local capture and later review share the same geometry.
- `app/room/[roomId]/debrief/page.tsx` — passed `gazePlaneModel` into the heatmap so the debrief renders the same fitted geometry used during capture.
- `lib/ai-debrief.ts` — updated integrity text to use `insideScreen` and quality-weighted gaze aggregation, report front-plane fit metadata, and downgrade low-quality geometry to weak evidence instead of elevated concern.
- `package.json` — added a `test` script and added `vitest` as a dev dependency to support geometry-first TDD for the new plane model.
- `package-lock.json` — updated lockfile for the new `vitest` dependency.
- `next-env.d.ts` — changed as part of the build/tooling refresh after adding test/build verification in this session.
- `future_improvements/eye-tracking-reliability-plan.md` — updated the working note with the front-plane heatmap decisions, implementation summary, open questions, and rejected approaches from this session.

## Open questions
- Whether the current validation targets are enough for a high-fidelity front-plane fit or whether the calibration grid should become denser in a future session.
- Whether viewport changes after calibration, especially fullscreen transitions and browser resizing, should trigger recalibration or a plane-model rescale.
- Whether the debrief should eventually expose a small “fit diagnostics” panel with observed point count, fallback status, and validation error for debugging sessions.
- Whether the current confidence model is enough for future experiments or whether per-sample quality should incorporate more signals than `clamped` plus calibration quality.
- Whether a replay/debug page should be added so future work can inspect raw points, smoothed points, and projected points without waiting for a full interview session.
- Whether `WebGazer` should remain the long-term provider once the front-plane visualization stabilizes, or whether the planned MediaPipe-based approach should replace it for better landmark stability and licensing clarity.
- Whether GET payload size will become a problem now that gaze samples carry more data and whether a dedicated heatmap endpoint should be introduced later.

## Rejected approaches
- Keep the old `on_screen` plus `off_left/off_right/off_top/off_bottom` visualization as the main heatmap model because it cannot represent the front-of-user plane the user asked for.
- Infer the inner laptop rectangle from fixed calibration target percentages alone because that produced effectively the same screen box every session and ignored actual calibration drift.
- Treat missing or weak validation observations as if they were measured geometry because that would create falsely precise heatmaps and misleading debrief evidence.
- Store quality metadata without using it downstream because that would make `conf`, `clamped`, and fit quality decorative instead of meaningful.
- Rely only on the initial calibration PATCH to persist the fitted geometry because short sessions, retry exhaustion, or unload paths could make capture and debrief diverge.
- Start with a large formal dataset effort before improving the geometry pipeline because the immediate need was to build a believable front-plane heatmap foundation first.
- Replace `WebGazer` immediately in this session because the user’s main goal was the heatmap representation, and the provider swap would have expanded scope beyond what was needed to lay the first front-plane foundation.
