import type { GazeZone } from "@/lib/store";

export interface FrontPlaneCalibrationPoint {
  xPx: number;
  yPx: number;
  expectedXNorm: number;
  expectedYNorm: number;
  observedXNorm: number;
  observedYNorm: number;
}

export interface PlaneRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FrontPlaneModel {
  screenRect: PlaneRect;
  outerRect: PlaneRect;
  screenRectInPlane: PlaneRect;
  quality: {
    validationErrorPx: number;
    label: "good" | "low";
    source: "observed_fit" | "approximate_fallback";
    observedPointCount: number;
  };
}

interface BuildFrontPlaneModelArgs {
  calibrationPoints: FrontPlaneCalibrationPoint[];
  viewportWidth: number;
  viewportHeight: number;
  validationErrorPx: number;
}

interface ProjectGazeToPlaneArgs {
  xNorm: number;
  yNorm: number;
  model: FrontPlaneModel;
}

const HORIZONTAL_EXPANSION = 0.35;
const VERTICAL_EXPANSION = 0.3;
const LOW_QUALITY_ERROR_PX = 150;
const MIN_OBSERVED_POINTS = 2;
const MIN_AXIS_SCALE = 0.35;
const MAX_AXIS_SCALE = 1.6;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function roundCoord(val: number): number {
  return Math.round(val * 1_000_000) / 1_000_000;
}

function classifyAgainstScreen(x: number, y: number, screenRect: PlaneRect): GazeZone {
  if (x >= screenRect.left && x <= screenRect.right && y >= screenRect.top && y <= screenRect.bottom) {
    return "on_screen";
  }

  const dx =
    x < screenRect.left ? screenRect.left - x : x > screenRect.right ? x - screenRect.right : 0;
  const dy =
    y < screenRect.top ? screenRect.top - y : y > screenRect.bottom ? y - screenRect.bottom : 0;

  if (dx >= dy) {
    return x < screenRect.left ? "off_left" : "off_right";
  }

  return y < screenRect.top ? "off_top" : "off_bottom";
}

function fitAxis(
  points: FrontPlaneCalibrationPoint[],
  expectedKey: "expectedXNorm" | "expectedYNorm",
  observedKey: "observedXNorm" | "observedYNorm"
) {
  const expectedValues = points.map((point) => point[expectedKey]);
  const observedValues = points.map((point) => point[observedKey]);
  const expectedMean = expectedValues.reduce((sum, value) => sum + value, 0) / expectedValues.length;
  const observedMean = observedValues.reduce((sum, value) => sum + value, 0) / observedValues.length;

  const denominator = expectedValues.reduce((sum, value) => sum + (value - expectedMean) ** 2, 0);
  if (denominator === 0) {
    return {
      offset: observedMean - expectedMean,
      scale: 1,
    };
  }

  const numerator = points.reduce(
    (sum, point) =>
      sum + (point[expectedKey] - expectedMean) * (point[observedKey] - observedMean),
    0
  );
  const scale = numerator / denominator;
  const offset = observedMean - scale * expectedMean;

  return { offset, scale };
}

function buildExpandedOuterRect(screenRect: PlaneRect, viewportWidth: number, viewportHeight: number): {
  outerRect: PlaneRect;
  screenRectInPlane: PlaneRect;
} {
  const screenWidth = Math.max(screenRect.right - screenRect.left, 1 / viewportWidth);
  const screenHeight = Math.max(screenRect.bottom - screenRect.top, 1 / viewportHeight);

  const outerRect = {
    left: screenRect.left - screenWidth * HORIZONTAL_EXPANSION,
    right: screenRect.right + screenWidth * HORIZONTAL_EXPANSION,
    top: screenRect.top - screenHeight * VERTICAL_EXPANSION,
    bottom: screenRect.bottom + screenHeight * VERTICAL_EXPANSION,
  };

  const outerWidth = outerRect.right - outerRect.left;
  const outerHeight = outerRect.bottom - outerRect.top;

  return {
    outerRect,
    screenRectInPlane: {
      left: (screenRect.left - outerRect.left) / outerWidth,
      right: (screenRect.right - outerRect.left) / outerWidth,
      top: (screenRect.top - outerRect.top) / outerHeight,
      bottom: (screenRect.bottom - outerRect.top) / outerHeight,
    },
  };
}

export function buildFrontPlaneModel({
  calibrationPoints,
  viewportWidth,
  viewportHeight,
  validationErrorPx,
}: BuildFrontPlaneModelArgs): FrontPlaneModel {
  const observedPointCount = calibrationPoints.length;
  const expectedXSpread = observedPointCount > 0
    ? Math.max(...calibrationPoints.map((point) => point.expectedXNorm)) -
      Math.min(...calibrationPoints.map((point) => point.expectedXNorm))
    : 0;
  const expectedYSpread = observedPointCount > 0
    ? Math.max(...calibrationPoints.map((point) => point.expectedYNorm)) -
      Math.min(...calibrationPoints.map((point) => point.expectedYNorm))
    : 0;
  const fallbackScreenRect = { left: 0, right: 1, top: 0, bottom: 1 };
  const fallbackGeometry = buildExpandedOuterRect(fallbackScreenRect, viewportWidth, viewportHeight);

  if (
    observedPointCount < MIN_OBSERVED_POINTS ||
    expectedXSpread === 0 ||
    expectedYSpread === 0
  ) {
    return {
      screenRect: fallbackScreenRect,
      outerRect: fallbackGeometry.outerRect,
      screenRectInPlane: fallbackGeometry.screenRectInPlane,
      quality: {
        validationErrorPx,
        label: "low",
        source: "approximate_fallback",
        observedPointCount,
      },
    };
  }

  const xFit = fitAxis(calibrationPoints, "expectedXNorm", "observedXNorm");
  const yFit = fitAxis(calibrationPoints, "expectedYNorm", "observedYNorm");

  const screenRect = {
    left: xFit.offset,
    right: xFit.offset + xFit.scale,
    top: yFit.offset,
    bottom: yFit.offset + yFit.scale,
  };
  const fitIsPlausible =
    Number.isFinite(xFit.scale) &&
    Number.isFinite(yFit.scale) &&
    xFit.scale >= MIN_AXIS_SCALE &&
    xFit.scale <= MAX_AXIS_SCALE &&
    yFit.scale >= MIN_AXIS_SCALE &&
    yFit.scale <= MAX_AXIS_SCALE &&
    screenRect.left < screenRect.right &&
    screenRect.top < screenRect.bottom;

  if (!fitIsPlausible) {
    return {
      screenRect: fallbackScreenRect,
      outerRect: fallbackGeometry.outerRect,
      screenRectInPlane: fallbackGeometry.screenRectInPlane,
      quality: {
        validationErrorPx,
        label: "low",
        source: "approximate_fallback",
        observedPointCount,
      },
    };
  }

  const geometry = buildExpandedOuterRect(screenRect, viewportWidth, viewportHeight);

  return {
    screenRect,
    outerRect: geometry.outerRect,
    screenRectInPlane: geometry.screenRectInPlane,
    quality: {
      validationErrorPx,
      label: validationErrorPx >= LOW_QUALITY_ERROR_PX ? "low" : "good",
      source: "observed_fit",
      observedPointCount,
    },
  };
}

export function projectGazeToPlane({ xNorm, yNorm, model }: ProjectGazeToPlaneArgs) {
  const outerWidth = model.outerRect.right - model.outerRect.left;
  const outerHeight = model.outerRect.bottom - model.outerRect.top;

  const planeX = clamp((xNorm - model.outerRect.left) / outerWidth, 0, 1);
  const planeY = clamp((yNorm - model.outerRect.top) / outerHeight, 0, 1);

  const insideScreen =
    xNorm >= model.screenRect.left &&
    xNorm <= model.screenRect.right &&
    yNorm >= model.screenRect.top &&
    yNorm <= model.screenRect.bottom;

  return {
    planeX,
    planeY,
    insideScreen,
    zone: classifyAgainstScreen(xNorm, yNorm, model.screenRect),
    clamped:
      xNorm < model.outerRect.left ||
      xNorm > model.outerRect.right ||
      yNorm < model.outerRect.top ||
      yNorm > model.outerRect.bottom,
  };
}

export function smoothNormalizedPoint(
  previous: { x: number; y: number } | null,
  next: { x: number; y: number },
  smoothingFactor: number
) {
  if (!previous) return next;

  return {
    x: roundCoord(previous.x + (next.x - previous.x) * smoothingFactor),
    y: roundCoord(previous.y + (next.y - previous.y) * smoothingFactor),
  };
}
