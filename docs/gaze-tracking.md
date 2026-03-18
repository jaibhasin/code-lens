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

## Implemented this session (Turbopack build fix — Mar 17 2026)

### Modified files
- `package.json` — Changed dev script from `next dev` to `next dev --webpack` to bypass Turbopack's inability to parse the `@mediapipe/face_mesh` IIFE module format
- `next.config.ts` — Added webpack rule: `{ test: /[\\/]@mediapipe[\\/].*\.js$/, type: "javascript/auto" }` so webpack correctly auto-detects the module type for `@mediapipe` packages during both dev and production builds

### Root cause
The `webgazer` → `@tensorflow-models/face-landmarks-detection` → `@mediapipe/face_mesh` import chain broke because `face_mesh.js` uses `(function(){...}).call(this)` (IIFE attaching to `this`). Turbopack analyzes this as ESM and sees zero exports. Webpack's `javascript/auto` type handles it by auto-detecting CJS semantics at runtime.

## Bugs & inefficiencies fixed (review session)

1. **CRITICAL: sendBeacon data loss** — `navigator.sendBeacon()` sends POST, but the route only had GET/PATCH. All final gaze data on page unload was silently dropped (405). Fix: added a dedicated POST handler in `route.ts` that accepts gazeSamples.
2. **Face detection was a no-op** — `checkFace()` unconditionally called `setFaceDetected(true)` on line 88 regardless of whether face was detected. Fix: now retries up to 5 times at 1.5s intervals; only falls back to true after all attempts.
3. **Off-screen streak wrong direction** — if gaze moved from off_left→off_right, the streak timer continued counting with the original direction. Fix: streak now resets when gaze zone changes direction.
4. **Unbounded gazeSamples** — no server-side cap meant a malicious client could exhaust memory. Fix: capped at 15,000 samples (~100 min at 2Hz), enforced in both POST and PATCH handlers.
5. **Bloated PATCH response** — every 5s gaze flush returned the full room JSON including all accumulated gazeSamples. Fix: gaze-batch PATCHes now return `{ ok, gazeSampleCount }` only.
6. **No input validation** — gazeSamples accepted arbitrary payloads. Fix: added `isValidGazeSample()` that checks types and valid zone values before appending.
7. **Null predictions polluted storage** — when WebGazer returned null, a junk sample (x:0.5, y:0.5, zone:unknown) was pushed. Fix: null predictions are now skipped entirely.
8. **WebGazer not paused on calibration unmount** — only cleaned up on explicit skip. Fix: added `wg.pause()` to cleanup, and `stream.getTracks().stop()` on skip to release webcam.
9. **Heatmap hooks violation** — `useMemo` was called after early returns, violating React rules of hooks. Fix: moved before early returns. Also stabilized canvas re-render to trigger on `sampleCount` change instead of reference equality.
10. **Debrief ignored calibrated-but-empty edge case** — if calibration succeeded but no samples arrived, the AI debrief said nothing. Fix: now adds a note about possible tracking failure.

## Implemented this session (WebGazer runtime errors fix — Mar 17 2026)

### Problem
Two runtime errors when entering a room as candidate:
1. `webgazerRef.current?.end(...).catch is not a function` — `webgazer.end()` returns void/this, not a Promise, so `.catch()` chaining crashed on skip
2. `_mediapipe_face_mesh__WEBPACK_IMPORTED_MODULE_2__.FaceMesh is not a constructor` — even with the `javascript/auto` webpack rule from the previous session, the `@mediapipe/face_mesh` IIFE module still broke because its `FaceMesh` constructor is registered via `P("FaceMesh", ...)` on `this || self` (global scope), not via `module.exports` or `export`. Webpack module wrapping scoped away the global assignment.

### Root cause (deep)
The import chain `webgazer` → `@tensorflow-models/face-landmarks-detection` → `@mediapipe/face_mesh` fails because `face_mesh.js` is a Closure Compiler output that attaches exports to the global `this` object. In a webpack module wrapper, `this` is not `window` — it's `undefined` (strict) or the module scope. So `require("@mediapipe/face_mesh").FaceMesh` returns `undefined`, and `new undefined(...)` throws "is not a constructor".

### Solution: bypass webpack entirely
Stopped trying to make webpack handle the mediapipe module format. Instead, load webgazer's pre-built UMD bundle (`dist/webgazer.js`, which was built by webgazer's own webpack and already handles all internal imports correctly) as a static script from `public/`.

### Modified files
- `components/GazeCalibration.tsx` — (1) Replaced `import("webgazer")` with script-tag loader that injects `/webgazer/webgazer.js` and reads `window.webgazer`. (2) Sets `wg.params.faceMeshSolutionPath = "/webgazer/mediapipe/face_mesh"` (absolute path) so WASM files resolve correctly regardless of page URL. (3) Replaced `.catch()` chains on `wg.end()` and `wg.pause()` with try/catch blocks since those methods don't return Promises.
- `hooks/useGazeTracker.ts` — Replaced `import("webgazer")` with `(window as any).webgazer` since the script is already loaded by GazeCalibration before the tracker hook activates.
- `next.config.ts` — Removed the `javascript/auto` mediapipe webpack rule (no longer needed since webgazer isn't bundled by webpack at all). Config is now empty.

### New files created
- `public/webgazer/webgazer.js` — Pre-built UMD bundle copied from `node_modules/webgazer/dist/webgazer.js` (~1.9 MB)
- `public/webgazer/mediapipe/face_mesh/*` — WASM + binary model assets copied from `node_modules/webgazer/dist/mediapipe/face_mesh/` (face_mesh.js, .binarypb, .wasm files, solution loaders)

## Implemented this session (Camera init race condition fix — Mar 18 2026)

### Problem
"Camera access failed — WebGazer failed to initialize" error shown immediately when entering a room as candidate, even when the camera is available and permissions are granted.

### Root cause
The `loadScript()` function in `GazeCalibration.tsx` had a race condition with React strict-mode double-mounting. On the second mount, the `<script>` tag for webgazer already existed in the DOM (from the first mount), so `loadScript()` resolved the promise immediately. But the script hadn't finished executing yet, so `window.webgazer` was still `undefined`, and the `if (!wg)` check threw "WebGazer failed to initialize".

Additionally, the webcam preview used `streamRef.current` (a ref) for conditional rendering. Since updating a ref doesn't trigger a React re-render, the video preview never showed — it was stuck on the "Starting camera..." spinner even after `begin()` succeeded.

### Fix
1. **`loadScript()` now handles the existing-script-tag case properly**: checks `window.webgazer` first (already loaded → resolve); otherwise attaches `load`/`error` event listeners on the existing tag AND polls every 100ms as a fallback in case the `load` event already fired before the listener was attached.
2. **Camera stream tracked in state** (`cameraStream`) in addition to the ref, so the video preview re-renders when the stream becomes available.
3. **User-friendly error messages**: maps browser `getUserMedia` errors (NotAllowedError, NotFoundError, NotReadableError) to plain-English messages with specific recovery instructions.

### Modified files
- `components/GazeCalibration.tsx` — rewrote `loadScript()` race handling, added `cameraStream` state, improved error messages

## Implemented this session (Debrief "not available" bug fix — Mar 18 2026)

### Problem
After a candidate completes calibration and takes a test, the debrief page shows "Gaze tracking was not available for this session" instead of the gaze heatmap.

### Root cause
1. **Debrief rendering condition always true** — `safeRoom.gazeCalibrated !== undefined` was used to decide whether to show the Gaze Analysis section. Since `gazeCalibrated` defaults to `false` (not `undefined`) in `lib/store.ts`, the condition was always true, so the section always rendered and `GazeHeatmap` received `calibrated={false}`.
2. **Silent PATCH failure** — The PATCH to set `gazeCalibrated: true` in `GazeCalibration.tsx` used `.catch(() => {})`, so transient network failures silently lost the flag.

### Fix
1. `debrief/page.tsx` — Changed rendering condition from `gazeCalibrated !== undefined` to `gazeCalibrated === true` (only show when calibration explicitly succeeded or samples exist).
2. `debrief/page.tsx` — Changed `calibrated` prop to infer from samples: `gazeCalibrated || gazeSamples.length > 0` (samples prove tracking worked).
3. `GazeHeatmap.tsx` — Changed guard from `!calibrated` to `!calibrated && samples.length === 0` (show heatmap if samples exist regardless of flag).
4. `GazeCalibration.tsx` — Replaced fire-and-forget PATCH with retry logic (2 retries, 1s delay).

### Modified files
- `app/room/[roomId]/debrief/page.tsx` — rendering condition + calibrated prop inference
- `components/GazeHeatmap.tsx` — resilient guard condition
- `components/GazeCalibration.tsx` — PATCH retry logic
- `lib/ai-debrief.ts` — `buildIntegritySignals()` now infers calibration from samples (same bug: `!room.gazeCalibrated` was always true when the flag defaulted to `false`, causing the AI prompt to say "candidate did not complete calibration" even when gaze data existed)

## Implemented this session (Always accept calibration after retry — Mar 18 2026)

### Problem
AI debrief reports "Gaze calibration was skipped due to 'poor_accuracy'" even when the candidate completed all calibration dots and saw "Calibration complete" with a green checkmark.

### Root cause
After the retry attempt, if `avgError >= 150px`, the code set `calibrated = false` and emitted `gaze_calibration_skipped { reason: "poor_accuracy" }`. But the UI always showed "Calibration complete" regardless — so the candidate thought it worked while the system silently disabled gaze tracking. The 150px threshold is too strict for typical consumer webcam conditions.

### Fix
1. `GazeCalibration.tsx` — Always set `calibrated = true` after the retry. Even noisy data is useful for zone-level classification (on-screen vs off-screen). The `gaze_calibration_skipped` event with `reason: "poor_accuracy"` is removed entirely — calibration is only "skipped" when the user explicitly clicks "Skip" or camera fails.
2. Timeline event now always emits `gaze_calibration_complete` with a `low_accuracy: true` flag when `avgError >= 150`, so the AI can note reduced data confidence without claiming calibration was skipped.

### Modified files
- `components/GazeCalibration.tsx` — always accept calibration after retry, emit `low_accuracy` flag instead of `gaze_calibration_skipped`

## Implemented this session (Calibration dot positioning — Mar 18 2026)

### Change
Moved corner calibration dots from 5% to 2% from each edge (`[5,5]` → `[2,2]`, etc.) so they sit closer to actual screen corners. Improves WebGazer ridge regression accuracy at viewport extremes.

### Modified files
- `components/GazeCalibration.tsx` — `CALIBRATION_POINTS` array values

## Implemented this session (Heatmap redesign — Mar 18 2026)

### Problem
The original heatmap used a rainbow-style colormap (blue→amber→red→white), had cramped layout, no color legend, and off-screen stats were flat text below the canvas. Not presentation-ready.

### Changes
Complete rewrite of `components/GazeHeatmap.tsx`:
1. **Inferno colormap** — 8-stop approximation of matplotlib's perceptually uniform "inferno" (dark indigo → purple → red-orange → bright yellow). Replaces misleading rainbow/jet palette.
2. **Canvas enlarged** — 720×540 → 780×620 with proper margins (70px sides, 50px top, 80px bottom for legend).
3. **Directional off-screen arrows** — triangular arrows in the margins pointing away from the screen rectangle, with percentage labels. Color-coded by severity (zinc < 15%, amber 15–25%, red > 25%). Replaces flat text list.
4. **Color bar legend** — horizontal gradient bar at bottom with rounded corners, labeled "Low / Gaze density / High".
5. **Typography** — monospace → Inter/system-ui sans-serif. Consistent font weights (600 for numbers, 400 for labels).
6. **Stats bar** — on-screen percentage is now a color-coded badge (green ≥80%, amber ≥60%, red <60%) with an eye icon. Sample count right-aligned.
7. **Screen rectangle** — solid rounded-corner border replaces dashed line. Label changed to "candidate's screen".
8. **Blob radius** — 18px → 24px for smoother blending. Alpha ramp ×1.5 → ×1.8 for better hotspot contrast.
9. **Background** — subtle zinc-950 tinted fill instead of near-invisible white.

### Modified files
- `components/GazeHeatmap.tsx` — full rewrite (color palette, layout, canvas pipeline, legend, stats bar)

## Open questions
- **Webcam preview in calibration** — uses `wg.getVideoStream()` which may not be available in all WebGazer versions. Fallback shows a loading spinner. Needs cross-browser testing (Chrome, Firefox, Safari).
- **Model drift during long waits** — if candidate calibrates then waits 15+ minutes for interviewer, WebGazer's model may drift. WebGazer auto-refines from cursor movements during the session, but this hasn't been validated for CodeLens's specific UX flow.
- **Heatmap with very few samples** — blob radius is 24px. Short sessions (<50 samples) may look sparse. Could consider dynamically scaling radius based on sample count.
- **GET response size** — `gazeSamples` is still included in the full room JSON from GET `/api/rooms/[roomId]`. For 60-min sessions (~230 KB), this adds non-trivial payload to debrief page fetches. Consider: separate endpoint or lazy-load on debrief only.
- **Re-enable Turbopack** — still forced to `--webpack` in package.json dev script. The public/ script-tag approach sidesteps the bundling issue entirely, but the `--webpack` flag remains from the earlier fix. Could potentially re-enable Turbopack now that webgazer is no longer imported through the module system, but needs testing.
- **public/webgazer/ files should auto-copy** — currently manually copied from node_modules. If webgazer is upgraded, these files must be re-copied. Consider a `postinstall` script: `cp -r node_modules/webgazer/dist/webgazer.js public/webgazer/ && cp -r node_modules/webgazer/dist/mediapipe public/webgazer/`.
- **Bundle size** — `public/webgazer/webgazer.js` is ~1.9 MB served uncompressed. With gzip it's much smaller, but could consider lazy-loading it only when the candidate role is detected.

## Rejected approaches
- **9-point calibration** — more accurate at edges but adds friction. 5-point with validation is a better UX tradeoff for interviews.
- **Two-panel heatmap (screen map + bar chart)** — original plan had separate on-screen heatmap and off-screen direction bars. User preferred unified view with outer/inner rectangles. More intuitive.
- **MediaPipe for MVP** — better long-term but requires building calibration math from scratch (affine transform, ridge regression). WebGazer bundles this. Deferred to `future_improvements/`.
- **1Hz sampling** — original plan. Doubled to 2Hz for better heatmap density at negligible storage cost.
- **Calibration after session starts** — original plan. Moved to waiting phase to avoid dead time during active interview.
- **External heatmap library (simpleheat)** — considered for rendering quality. Rejected to keep zero extra dependencies; raw Canvas 2D with grayscale→color remap achieves the same effect.
- **Storing confidence from WebGazer** — WebGazer doesn't expose a clean confidence score per prediction. The `conf` field is set to `1` for valid predictions and `0` for null/failed ones. True confidence estimation would require the MediaPipe upgrade.
- **Keeping Turbopack for dev** — Next.js 16 defaults to Turbopack, but `@mediapipe/face_mesh` v0.4.x ships as an IIFE (`(function(){...}).call(this)`) with no standard CJS/ESM exports. Turbopack's static ESM analysis sees zero exports and errors on `import { FaceMesh } from "@mediapipe/face_mesh"` (called by `@tensorflow-models/face-landmarks-detection`, a transitive dep of `webgazer`). CJS `require()` works fine because `this` becomes `module.exports` at runtime. Webpack handles this via `javascript/auto` module type. Switched dev to `--webpack` rather than hacking a shim or aliasing the module.
- **Webpack `javascript/auto` rule for @mediapipe** — tried `{ test: /[\\/]@mediapipe[\\/].*\.js$/, type: "javascript/auto" }` in next.config.ts. This tells webpack to auto-detect module format, but the mediapipe IIFE doesn't use `module.exports` at all — it sets globals via `this`. So even with auto-detection, `require("@mediapipe/face_mesh").FaceMesh` was still `undefined`. The bundled script-tag approach was the only reliable fix.
- **CDN loading for webgazer** — considered loading from jsDelivr/unpkg, but the mediapipe WASM files need to be co-located at a known relative path (`./mediapipe/face_mesh/`). Serving from `public/` gives full control over asset paths without external CDN dependency.
- **Rainbow/jet colormap for heatmap** — original implementation used blue→amber→red→white gradient. Replaced with inferno because rainbow colormaps create false visual contours (perceived intensity jumps at green→yellow and yellow→red boundaries that don't correspond to actual data changes). Inferno is perceptually uniform — equal data differences look like equal visual differences.
