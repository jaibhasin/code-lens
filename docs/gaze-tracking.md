## Status: in-progress

## Decisions
- **WebGazer.js chosen for MVP** — single npm install, built-in calibration + ridge regression, 100% client-side. Accuracy (~50–150px) is sufficient for on-screen vs off-screen classification. GPL license noted; replacement path documented.
- **MediaPipe deferred to future** — better accuracy/license/bundle but requires building custom affine mapper from scratch. Documented in `future_improvements/webgazer-replacement.md`.
- **5-point calibration (corners + center)** — best usability/accuracy tradeoff per research. 9-point rejected as too much friction for interview context.
- **Calibration placed in waiting phase** — after candidate enters name, before interviewer starts session. Avoids dead time during active interview. Earlier plan had it after session start.
- **2Hz sample rate** — doubles heatmap resolution vs 1Hz for only ~230 KB per 60-min session. Higher rates (4Hz+) rejected as unnecessary for zone-level classification.
- **Unified heatmap design** — single canvas with outer rectangle (field of view) + inner rectangle (screen), not two separate panels. User specifically requested this layout.
- **Heatmap is interviewer-only** — candidate debrief view does not show gaze data. Confirmed with user.
- **Gaze never auto-fails candidates** — signals feed into AI integrity score only. Pattern-based (streaks, cross-correlation) not single-sample flags.
- **sendBeacon fallback** — guarantees final sample batch reaches server even on tab close/session end.
- **No raw video stored** — only `(x, y, zone, confidence)` tuples. Privacy by design.

## Implemented this session

### New files created
- `components/GazeCalibration.tsx` — 3-stage calibration overlay: (1) camera permission + webcam preview + face check, (2) 5-point click calibration with pulsing dots, (3) 2-point validation with one retry
- `hooks/useGazeTracker.ts` — 2Hz gaze sampling hook with zone classification (on_screen/off_left/off_right/off_top/off_bottom/unknown), 5s batched PATCH, sendBeacon on beforeunload/visibilitychange, off-screen streak detection (>10s emits timeline event)
- `components/GazeHeatmap.tsx` — Canvas-based heatmap (720x540, 4:3). Outer rect = field of view, inner rect = screen (432x243, 16:9, centered). Gaussian blobs via radial gradients on offscreen canvas, grayscale→color remap (blue→amber→red). Zone percentage breakdown below canvas with amber/red highlighting for elevated off-screen.
- `types/webgazer.d.ts` — TypeScript declarations for the webgazer module (no @types/webgazer exists)
- `future_improvements/webgazer-replacement.md` — Roadmap for replacing WebGazer with MediaPipe Face Landmarker + custom affine transform

### Modified files
- `lib/store.ts` — Added `GazeZone` type, `GazeSample` interface, `gazeCalibrated: boolean` + `gazeSamples: GazeSample[]` to `Room`, 3 new `TimelineEventType` values (`gaze_calibration_complete`, `gaze_calibration_skipped`, `gaze_off_screen_streak`), defaults in `createRoom()`
- `app/api/rooms/[roomId]/route.ts` — PATCH handler accepts `gazeSamples` array (batch append) and `gazeCalibrated` boolean
- `app/room/[roomId]/page.tsx` — Added `showCalibration` + `gazeCalibrated` state, `GazeCalibration` dynamic import, `useGazeTracker` hook mount (gated to candidate + active + calibrated), calibration shown after name gate submit
- `app/room/[roomId]/debrief/page.tsx` — Added `GazeHeatmap` dynamic import, new glass card after integrity section (interviewer-only, shows heatmap or "not available" message)
- `lib/ai-debrief.ts` — Extended `buildIntegritySignals` with gaze section: off-screen ratio, per-direction breakdown, elevated concern flag (>20%), gaze-paste cross-correlation (30s window), unavailable-calibration note
- `docs/CHEATING_DETECTION_STRATEGY.md` — Added "Implemented: Gaze Tracking" section with summary of what was built, decisions, and file list
- `package.json` — Added `webgazer` dependency

## Open questions
- **WebGazer face detection reliability** — the face check in stage 1 currently falls back to `setFaceDetected(true)` after 2s timeout even if tracker API doesn't confirm. Need real-device testing to verify WebGazer's `getTracker().getPositions()` works reliably across browsers.
- **Webcam preview in calibration** — uses `wg.getVideoStream()` which may not be available in all WebGazer versions. Fallback shows a loading spinner. Needs cross-browser testing (Chrome, Firefox, Safari).
- **Validation accuracy threshold** — set at 150px. May need tuning based on real user testing. Too strict = false recalibration loops. Too loose = unreliable tracking.
- **Model drift during long waits** — if candidate calibrates then waits 15+ minutes for interviewer, WebGazer's model may drift. WebGazer auto-refines from cursor movements during the session, but this hasn't been validated for CodeLens's specific UX flow.
- **Heatmap visual quality** — the Gaussian blob alpha (0.04) and radius (18px) may need tuning based on real session data density. With ~7,200 samples the heatmap should be dense enough, but short sessions may look sparse.
- **GET response size** — `gazeSamples` is included in the full room JSON from GET `/api/rooms/[roomId]`. For 60-min sessions (~230 KB), this adds non-trivial payload to every poll. Consider: separate endpoint for gaze data, or exclude from polling responses and only include in debrief fetch.

## Rejected approaches
- **9-point calibration** — more accurate at edges but adds friction. 5-point with validation is a better UX tradeoff for interviews.
- **Two-panel heatmap (screen map + bar chart)** — original plan had separate on-screen heatmap and off-screen direction bars. User preferred unified view with outer/inner rectangles. More intuitive.
- **MediaPipe for MVP** — better long-term but requires building calibration math from scratch (affine transform, ridge regression). WebGazer bundles this. Deferred to `future_improvements/`.
- **1Hz sampling** — original plan. Doubled to 2Hz for better heatmap density at negligible storage cost.
- **Calibration after session starts** — original plan. Moved to waiting phase to avoid dead time during active interview.
- **External heatmap library (simpleheat)** — considered for rendering quality. Rejected to keep zero extra dependencies; raw Canvas 2D with grayscale→color remap achieves the same effect.
- **Storing confidence from WebGazer** — WebGazer doesn't expose a clean confidence score per prediction. The `conf` field is set to `1` for valid predictions and `0` for null/failed ones. True confidence estimation would require the MediaPipe upgrade.
