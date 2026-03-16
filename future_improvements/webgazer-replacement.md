# Replace WebGazer with Custom MediaPipe-Based Gaze Engine

## Status: planned

## Why WebGazer is a temporary choice

- **Maintenance freeze**: As of February 2026, the WebGazer team announced updates are no longer guaranteed. The library still works but will not receive bug fixes or improvements.
- **GPL license**: WebGazer is licensed under GPLv3. This is fine for internal tooling but requires careful review before any commercial distribution.
- **Bundle size**: ~3.5 MB including TensorFlow.js dependencies. This is loaded dynamically but still a significant download for candidates.
- **Accuracy ceiling**: ~50–150px error in typical conditions. Sufficient for on-screen vs off-screen classification but limits finer-grained analysis.
- **Glasses & lighting**: WebGazer struggles with reflective glasses and low-light conditions, producing noisy or missing predictions.

## Better approach: MediaPipe Face Landmarker + custom affine mapper

### Architecture

1. **Face/iris detection**: Use `@mediapipe/tasks-vision` FaceLandmarker which outputs 478 3D landmarks including 10 iris landmarks (5 per eye). Apache 2.0 license, actively maintained by Google.

2. **Iris-to-gaze mapping**: Extract iris center position relative to eye contours from the landmark data. This gives a normalized "iris direction vector" for each eye.

3. **Calibration**: During the same 5-point click sequence, record iris direction vectors paired with known screen coordinates. Use least-squares to fit an affine transform mapping iris features to screen `(x, y)`.

4. **Runtime prediction**: For each frame, extract iris landmarks, apply the affine transform, output predicted screen coordinates. Zone classification and batching remain identical to the current pipeline.

### Expected improvements

| Dimension | WebGazer (current) | MediaPipe (proposed) |
|---|---|---|
| Bundle size | ~3.5 MB | ~500 KB (WASM) |
| License | GPL v3 | Apache 2.0 |
| Accuracy | ~50–150px | ~30–80px (estimated) |
| Glasses handling | Poor | Better (refined eye landmarks) |
| Maintenance | Frozen | Actively maintained |

### Key technical challenges

- **Affine transform fitting**: Need to implement ridge regression or SVD-based least-squares in JS. ~100 lines of code; well-documented math.
- **Calibration quality estimation**: Need to compute residuals from the fit to estimate expected prediction error.
- **Head pose compensation**: MediaPipe gives full head rotation; use this to compensate for head movement (WebGazer handles this internally via its regression model).

## Effort estimate

- **Core implementation**: 3–5 days
  - MediaPipe integration + landmark extraction
  - Affine transform calibration math
  - Head pose compensation
  - Drop-in replacement for `useGazeTracker` hook
- **Testing & tuning**: 2–3 days
  - Cross-browser validation
  - Accuracy benchmarks vs WebGazer
  - Edge cases (glasses, lighting, head tilt)

## Prerequisites

- Current WebGazer-based pipeline fully working and validated
- Access to 5+ test participants for accuracy comparison
- Decision on whether to ship as GPL (keep WebGazer) or Apache (must switch)

## Migration path

The `GazeSample` data format and `useGazeTracker` hook interface remain unchanged. The heatmap, debrief integration, and integrity signals work identically regardless of which library produces the gaze predictions. Migration is a provider swap inside the hook.
