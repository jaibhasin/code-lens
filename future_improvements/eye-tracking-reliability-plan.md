# Eye-Tracking Detection Review + Histogram Plan

## Status: in-progress

## Overview
- Audit the current gaze-cheating logic.
- Build a reusable pipeline to generate a real-session histogram image for the debrief report.
- Deliver a research-backed reliability evaluation and concrete architecture recommendations.

## Scope
- Review the existing gaze-cheating pipeline end-to-end in:
  - [`hooks/useGazeTracker.ts`](../hooks/useGazeTracker.ts)
  - [`components/GazeCalibration.tsx`](../components/GazeCalibration.tsx)
  - [`lib/ai-debrief.ts`](../lib/ai-debrief.ts)
  - [`app/api/rooms/[roomId]/route.ts`](../app/api/rooms/[roomId]/route.ts)
  - [`components/GazeHeatmap.tsx`](../components/GazeHeatmap.tsx)
- Build instrumentation + visualization for real sessions.
- Produce a detailed evaluation covering failure modes, expected false-positive/false-negative behavior, and alternatives.

## Confirmed Observations
- Current detection is threshold-driven and zone-based (on-screen vs off-screen direction).
- Gaze sampling runs at 2 Hz with 10-second off-screen streak events.
- Integrity logic combines gaze with tab/paste/fullscreen signals via fixed windows.
- Session data is in-memory today; no persisted analytics dataset exists yet.

## Proposed Architecture
```mermaid
flowchart TD
  browserCapture[BrowserGazeCapture] --> roomStore[InMemoryRoomStore]
  roomStore --> debriefSignals[IntegritySignalBuilder]
  roomStore --> exportPipeline[LocalExportPipeline]
  exportPipeline --> histogramGen[HistogramImageGenerator]
  histogramGen --> reportEmbed[DebriefReportImageEmbed]
```

## Implementation Plan
1. Add a local export path for completed room telemetry.
   - Return histogram-ready aggregates per room (zone counts, off-screen streak durations, paste-after-switch, gaze-paste correlations).
   - Keep payload analytics-focused (avoid returning full room blobs).

2. Add a deterministic histogram generator script.
   - Consume exported aggregates and create a report-quality PNG.
   - Include at least: off-screen ratio distribution, per-direction off-screen percentages, suspicious-correlation counts.
   - Save chart at a stable path for report embedding.

3. Integrate chart output into the AI report/debrief.
   - Add a report section that displays the histogram with sample-size/date-range caveats.
   - Handle no-data state gracefully until first real session is available.

4. Deliver a technical evaluation document.
   - Failure modes: lighting, eyewear, head movement, multi-monitor geometry, webcam quality/FPS, neurodivergent gaze patterns, accessibility accommodations.
   - Reliability analysis: realistic FP/FN tendencies at scale under current thresholds.
   - Comparative analysis:
     - Commercial positioning (ExamSoft, Honorlock, Proctorio).
     - Recent research benchmarks for webcam gaze accuracy and robustness.
     - Reference repos (OptiKey, GazeTracking, EyeGestures): calibration, landmarks, smoothing/fixation logic, head-motion handling.
   - Ranked recommendation set by impact vs complexity.

5. Update tracking docs after implementation.
   - Record decisions, what was implemented, open questions, and rejected approaches in the relevant feature note.

## Planned Outputs
- Report-ready histogram PNG generated from real sessions.
- Thorough reliability evaluation with concrete risks and confidence limits.
- Prioritized roadmap: quick wins, medium-term upgrades, and high-accuracy multi-signal architecture path.

## Task Checklist
- [ ] Implement local telemetry export endpoint for histogram-ready room aggregates.
- [ ] Create script to generate polished PNG histograms from real-session detection data.
- [ ] Embed histogram image into debrief/report with no-data fallback.
- [ ] Write detailed technical evaluation (failure modes, reliability, competitor/research comparison).
- [ ] Update relevant feature documentation with decisions and outcomes.

## Decisions
- Shift the immediate goal from aggregate histograms to a session-level front-plane heatmap because the user wants a spatial map of where the candidate looked over time.
- Keep WebGazer as the capture source for now, but stop treating it as a simple viewport bucket system. Project each sample onto a larger front-facing plane with a smaller embedded laptop-screen rectangle.
- Persist a fitted `gazePlaneModel` from calibration so capture, storage, debrief text, and rendering all share the same geometry.
- Validate the new mapping with deterministic geometry tests and known-target synthetic checks before asking for real human calibration trials.

## Implemented this session
- Added a tested front-plane geometry module in `lib/gaze-plane.ts` plus `vitest` coverage in `lib/gaze-plane.test.ts`.
- Expanded stored gaze samples in `lib/store.ts` to include raw normalized coordinates, projected plane coordinates, `insideScreen`, and clamp state. Added room-level `gazePlaneModel`.
- Updated `components/GazeCalibration.tsx` to average multiple validation predictions per point and persist a fitted plane model alongside `gazeCalibrated`.
- Updated `hooks/useGazeTracker.ts` to smooth raw predictions, project them onto the front plane, and store richer per-sample data while preserving directional streak timeline events.
- Rebuilt `components/GazeHeatmap.tsx` to render a large outer viewing field with a smaller inner laptop-screen rectangle and time-weighted point/density accumulation across the whole plane.
- Updated `app/room/[roomId]/debrief/page.tsx` and `lib/ai-debrief.ts` so the debrief uses the new plane model consistently.
- Added a `test` script to `package.json` and verified `npm run test`, targeted ESLint on touched files, and `npm run build`.

## Open questions
- Whether the current 5-point click calibration should be increased to a denser grid for even better heatmap fidelity.
- Whether the front-plane scale constants should stay fixed or become user/device-tuned after a few internal benchmark sessions.
- Whether low-quality calibration sessions should still render the heatmap fully or switch to a more explicit “approximate only” presentation.
- Whether WebGazer should remain the long-term provider or be replaced with the planned MediaPipe-based path for better gaze stability.

## Rejected approaches
- Keeping the old on-screen plus four-arrow view. It cannot honestly represent the front-of-user plane the user asked for.
- Treating off-screen looks as only `off_left/off_right/off_top/off_bottom` buckets. That loses the spatial structure needed for the new visualization.
- Requiring a large real-world dataset before making any implementation progress. For this iteration, a tested geometry layer plus future small benchmark sessions is a better starting point.
