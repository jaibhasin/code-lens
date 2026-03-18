import { describe, expect, it } from "vitest";

import {
  buildFrontPlaneModel,
  projectGazeToPlane,
  smoothNormalizedPoint,
  type FrontPlaneCalibrationPoint,
} from "./gaze-plane";

const CALIBRATION_POINTS: FrontPlaneCalibrationPoint[] = [
  { xPx: 20, yPx: 16, expectedXNorm: 0.02, expectedYNorm: 0.02, observedXNorm: 0.02, observedYNorm: 0.02 },
  { xPx: 980, yPx: 16, expectedXNorm: 0.98, expectedYNorm: 0.02, observedXNorm: 0.98, observedYNorm: 0.02 },
  { xPx: 980, yPx: 784, expectedXNorm: 0.98, expectedYNorm: 0.98, observedXNorm: 0.98, observedYNorm: 0.98 },
  { xPx: 20, yPx: 784, expectedXNorm: 0.02, expectedYNorm: 0.98, observedXNorm: 0.02, observedYNorm: 0.98 },
  { xPx: 500, yPx: 400, expectedXNorm: 0.5, expectedYNorm: 0.5, observedXNorm: 0.5, observedYNorm: 0.5 },
];

describe("buildFrontPlaneModel", () => {
  it("fits the screen inside a larger outer plane", () => {
    const model = buildFrontPlaneModel({
      calibrationPoints: CALIBRATION_POINTS,
      viewportWidth: 1000,
      viewportHeight: 800,
      validationErrorPx: 42,
    });

    expect(model.screenRect.left).toBeCloseTo(0, 5);
    expect(model.screenRect.right).toBeCloseTo(1, 5);
    expect(model.screenRect.top).toBeCloseTo(0, 5);
    expect(model.screenRect.bottom).toBeCloseTo(1, 5);

    expect(model.outerRect.left).toBeLessThan(model.screenRect.left);
    expect(model.outerRect.right).toBeGreaterThan(model.screenRect.right);
    expect(model.outerRect.top).toBeLessThan(model.screenRect.top);
    expect(model.outerRect.bottom).toBeGreaterThan(model.screenRect.bottom);

    expect(model.screenRectInPlane.left).toBeGreaterThan(0);
    expect(model.screenRectInPlane.right).toBeLessThan(1);
    expect(model.screenRectInPlane.top).toBeGreaterThan(0);
    expect(model.screenRectInPlane.bottom).toBeLessThan(1);
    expect(model.quality.label).toBe("good");
  });

  it("marks higher validation error as low quality", () => {
    const model = buildFrontPlaneModel({
      calibrationPoints: CALIBRATION_POINTS,
      viewportWidth: 1000,
      viewportHeight: 800,
      validationErrorPx: 185,
    });

    expect(model.quality.label).toBe("low");
  });

  it("moves the inferred screen box when observed calibration points drift", () => {
    const driftedModel = buildFrontPlaneModel({
      calibrationPoints: [
        { xPx: 250, yPx: 200, expectedXNorm: 0.25, expectedYNorm: 0.25, observedXNorm: 0.3, observedYNorm: 0.28 },
        { xPx: 750, yPx: 200, expectedXNorm: 0.75, expectedYNorm: 0.25, observedXNorm: 0.78, observedYNorm: 0.27 },
        { xPx: 250, yPx: 600, expectedXNorm: 0.25, expectedYNorm: 0.75, observedXNorm: 0.31, observedYNorm: 0.76 },
        { xPx: 750, yPx: 600, expectedXNorm: 0.75, expectedYNorm: 0.75, observedXNorm: 0.79, observedYNorm: 0.75 },
      ],
      viewportWidth: 1000,
      viewportHeight: 800,
      validationErrorPx: 84,
    });

    expect(driftedModel.screenRect.left).toBeCloseTo(0.065, 2);
    expect(driftedModel.screenRect.right).toBeCloseTo(1.025, 2);
    expect(driftedModel.screenRect.top).toBeCloseTo(0.035, 2);
    expect(driftedModel.screenRect.bottom).toBeCloseTo(0.995, 2);
  });

  it("falls back to an approximate model when observations are missing", () => {
    const fallbackModel = buildFrontPlaneModel({
      calibrationPoints: [
        { xPx: 250, yPx: 200, expectedXNorm: 0.25, expectedYNorm: 0.25, observedXNorm: 0.3, observedYNorm: 0.28 },
      ],
      viewportWidth: 1000,
      viewportHeight: 800,
      validationErrorPx: 240,
    });

    expect(fallbackModel.quality.source).toBe("approximate_fallback");
    expect(fallbackModel.quality.observedPointCount).toBe(1);
    expect(fallbackModel.screenRect.left).toBeCloseTo(0, 5);
    expect(fallbackModel.screenRect.right).toBeCloseTo(1, 5);
  });

  it("falls back when observed points do not span both axes", () => {
    const fallbackModel = buildFrontPlaneModel({
      calibrationPoints: [
        { xPx: 250, yPx: 200, expectedXNorm: 0.25, expectedYNorm: 0.25, observedXNorm: 0.3, observedYNorm: 0.1 },
        { xPx: 750, yPx: 200, expectedXNorm: 0.75, expectedYNorm: 0.25, observedXNorm: 0.78, observedYNorm: 0.12 },
      ],
      viewportWidth: 1000,
      viewportHeight: 800,
      validationErrorPx: 180,
    });

    expect(fallbackModel.quality.source).toBe("approximate_fallback");
    expect(fallbackModel.screenRect.top).toBeCloseTo(0, 5);
    expect(fallbackModel.screenRect.bottom).toBeCloseTo(1, 5);
  });
});

describe("projectGazeToPlane", () => {
  const model = buildFrontPlaneModel({
    calibrationPoints: CALIBRATION_POINTS,
    viewportWidth: 1000,
    viewportHeight: 800,
    validationErrorPx: 42,
  });

  it("maps on-screen gaze into the inner screen rectangle", () => {
    const point = projectGazeToPlane({
      xNorm: 0.5,
      yNorm: 0.5,
      model,
    });

    expect(point.insideScreen).toBe(true);
    expect(point.zone).toBe("on_screen");
    expect(point.planeX).toBeGreaterThan(model.screenRectInPlane.left);
    expect(point.planeX).toBeLessThan(model.screenRectInPlane.right);
    expect(point.planeY).toBeGreaterThan(model.screenRectInPlane.top);
    expect(point.planeY).toBeLessThan(model.screenRectInPlane.bottom);
  });

  it("preserves richer off-screen positions around the screen", () => {
    const leftPoint = projectGazeToPlane({
      xNorm: -0.18,
      yNorm: 0.48,
      model,
    });
    const belowPoint = projectGazeToPlane({
      xNorm: 0.52,
      yNorm: 1.22,
      model,
    });

    expect(leftPoint.insideScreen).toBe(false);
    expect(leftPoint.zone).toBe("off_left");
    expect(leftPoint.planeX).toBeLessThan(model.screenRectInPlane.left);
    expect(leftPoint.planeY).toBeGreaterThan(model.screenRectInPlane.top);
    expect(leftPoint.planeY).toBeLessThan(model.screenRectInPlane.bottom);

    expect(belowPoint.insideScreen).toBe(false);
    expect(belowPoint.zone).toBe("off_bottom");
    expect(belowPoint.planeY).toBeGreaterThan(model.screenRectInPlane.bottom);
  });
});

describe("smoothNormalizedPoint", () => {
  it("keeps the first sample unchanged and smooths later samples", () => {
    expect(smoothNormalizedPoint(null, { x: 0.2, y: 0.3 }, 0.35)).toEqual({
      x: 0.2,
      y: 0.3,
    });

    expect(
      smoothNormalizedPoint({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.9 }, 0.25)
    ).toEqual({
      x: 0.35,
      y: 0.45,
    });
  });
});
