"use client";

import { useEffect, useMemo, useRef } from "react";
import type { GazePlaneModel, GazeSample } from "@/lib/store";

interface GazeHeatmapProps {
  samples: GazeSample[];
  calibrated: boolean;
  planeModel?: GazePlaneModel | null;
}

const CANVAS_W = 840;
const CANVAS_H = 680;
const FIELD_X = 70;
const FIELD_Y = 40;
const FIELD_W = 700;
const FIELD_H = 520;
const BLOB_RADIUS = 28;

const FALLBACK_PLANE_MODEL: GazePlaneModel = {
  screenRect: { left: 0, top: 0, right: 1, bottom: 1 },
  outerRect: { left: -0.35, top: -0.3, right: 1.35, bottom: 1.3 },
  screenRectInPlane: { left: 0.205882, top: 0.1875, right: 0.794118, bottom: 0.8125 },
  quality: {
    validationErrorPx: 999,
    label: "low",
    source: "approximate_fallback",
    observedPointCount: 0,
  },
};

const INFERNO: [number, number, number][] = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 255, 164],
];

function intensityToRGBA(val: number): [number, number, number, number] {
  if (val === 0) return [0, 0, 0, 0];
  const t = Math.min(val / 255, 1);
  const idx = t * (INFERNO.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, INFERNO.length - 1);
  const f = idx - lo;
  const r = Math.round(INFERNO[lo][0] * (1 - f) + INFERNO[hi][0] * f);
  const g = Math.round(INFERNO[lo][1] * (1 - f) + INFERNO[hi][1] * f);
  const b = Math.round(INFERNO[lo][2] * (1 - f) + INFERNO[hi][2] * f);
  const a = Math.round(Math.min(t * 1.8, 1) * 230);
  return [r, g, b, a];
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function computeIntensityReference(intensities: Uint8ClampedArray, percentile: number): number {
  const hist = new Uint32Array(256);
  let nonZero = 0;
  for (let i = 0; i < intensities.length; i++) {
    const v = intensities[i];
    if (v > 0) {
      hist[v] += 1;
      nonZero += 1;
    }
  }
  if (nonZero === 0) return 1;

  const target = Math.max(1, Math.ceil(nonZero * clamp(percentile, 0.5, 0.999)));
  let cumulative = 0;
  for (let i = 1; i < hist.length; i++) {
    cumulative += hist[i];
    if (cumulative >= target) return i;
  }
  return 255;
}

function normalizeIntensity(raw: number, reference: number): number {
  if (raw <= 0 || reference <= 0) return 0;
  const linear = clamp(raw / reference, 0, 1);
  return Math.pow(linear, 0.78);
}

function planeRectToCanvas(rect: GazePlaneModel["screenRectInPlane"]) {
  return {
    x: FIELD_X + rect.left * FIELD_W,
    y: FIELD_Y + rect.top * FIELD_H,
    w: (rect.right - rect.left) * FIELD_W,
    h: (rect.bottom - rect.top) * FIELD_H,
  };
}

function sampleToCanvas(sample: GazeSample, planeModel: GazePlaneModel): { cx: number; cy: number } | null {
  if (sample.zone === "unknown") return null;

  const fallbackPlaneX = clamp(
    (sample.x - planeModel.outerRect.left) / (planeModel.outerRect.right - planeModel.outerRect.left),
    0,
    1
  );
  const fallbackPlaneY = clamp(
    (sample.y - planeModel.outerRect.top) / (planeModel.outerRect.bottom - planeModel.outerRect.top),
    0,
    1
  );
  const planeX = typeof sample.planeX === "number" ? sample.planeX : fallbackPlaneX;
  const planeY = typeof sample.planeY === "number" ? sample.planeY : fallbackPlaneY;

  return {
    cx: FIELD_X + planeX * FIELD_W,
    cy: FIELD_Y + planeY * FIELD_H,
  };
}

function computePlaneBreakdown(samples: GazeSample[]) {
  const valid = samples.filter((sample) => sample.zone !== "unknown");
  const total = valid.length;
  if (total === 0) return null;

  const weightedTotal = valid.reduce((sum, sample) => sum + (typeof sample.conf === "number" ? sample.conf : 1), 0);
  const onScreenWeight = valid.reduce((sum, sample) => {
    const isInside = typeof sample.insideScreen === "boolean" ? sample.insideScreen : sample.zone === "on_screen";
    return sum + (isInside ? (typeof sample.conf === "number" ? sample.conf : 1) : 0);
  }, 0);
  const offScreenWeight = Math.max(0, weightedTotal - onScreenWeight);
  const secondsPerSample = 0.5;

  return {
    onScreen: Math.round((onScreenWeight / weightedTotal) * 100),
    offScreen: Math.round((offScreenWeight / weightedTotal) * 100),
    onScreenSeconds: Math.round(onScreenWeight * secondsPerSample),
    offScreenSeconds: Math.round(offScreenWeight * secondsPerSample),
    total,
  };
}

function drawColorBar(ctx: CanvasRenderingContext2D) {
  const barX = FIELD_X;
  const barY = CANVAS_H - 54;
  const barW = FIELD_W;
  const barH = 10;
  const radius = 5;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, radius);
  ctx.clip();
  for (let x = 0; x < barW; x++) {
    const t = x / (barW - 1);
    const intensity = Math.round(t * 255);
    const [r, g, b] = intensityToRGBA(intensity);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(barX + x, barY, 1, barH);
  }
  ctx.restore();

  ctx.fillStyle = "rgba(161, 161, 170, 0.7)";
  ctx.font = "11px Inter, system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Low", barX, barY + barH + 6);
  ctx.textAlign = "center";
  ctx.fillText("Time spent looking", barX + barW / 2, barY + barH + 6);
  ctx.textAlign = "right";
  ctx.fillText("High", barX + barW, barY + barH + 6);
}

export default function GazeHeatmap({ samples, calibrated, planeModel }: GazeHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePlaneModel = planeModel ?? FALLBACK_PLANE_MODEL;
  const screenRect = useMemo(
    () => planeRectToCanvas(activePlaneModel.screenRectInPlane),
    [activePlaneModel]
  );
  const breakdown = useMemo(() => computePlaneBreakdown(samples), [samples]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const offscreen = document.createElement("canvas");
    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;
    const offCtx = offscreen.getContext("2d")!;
    offCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    for (const sample of samples) {
      const pt = sampleToCanvas(sample, activePlaneModel);
      if (!pt) continue;
      const sampleWeight = typeof sample.conf === "number" ? clamp(sample.conf, 0.15, 1) : 1;

      const grad = offCtx.createRadialGradient(pt.cx, pt.cy, 0, pt.cx, pt.cy, BLOB_RADIUS);
      grad.addColorStop(0, `rgba(255,255,255,${0.045 * sampleWeight})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      offCtx.fillStyle = grad;
      offCtx.fillRect(
        pt.cx - BLOB_RADIUS, pt.cy - BLOB_RADIUS,
        BLOB_RADIUS * 2, BLOB_RADIUS * 2
      );
    }

    const imgData = offCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const data = imgData.data;
    const intensities = new Uint8ClampedArray(CANVAS_W * CANVAS_H);
    for (let i = 0, px = 0; i < data.length; i += 4, px++) {
      intensities[px] = data[i];
    }
    const intensityReference = computeIntensityReference(intensities, 0.94);
    for (let i = 0; i < data.length; i += 4) {
      const intensity = data[i];
      const normalized = normalizeIntensity(intensity, intensityReference);
      const [r, g, b, a] = intensityToRGBA(Math.round(normalized * 255));
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "rgba(9, 9, 11, 0.8)";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.strokeStyle = "rgba(113, 113, 122, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H, 10);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(59, 130, 246, 0.25)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(screenRect.x, screenRect.y, screenRect.w, screenRect.h, 8);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(212, 212, 216, 0.75)";
    ctx.font = "600 12px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("front of user", FIELD_X, 12);

    ctx.fillStyle = "rgba(161, 161, 170, 0.6)";
    ctx.font = "11px Inter, system-ui, -apple-system, sans-serif";
    ctx.fillText("outer viewing field", FIELD_X, FIELD_Y + FIELD_H + 10);
    ctx.textAlign = "center";
    ctx.fillText("laptop screen", screenRect.x + screenRect.w / 2, screenRect.y + screenRect.h + 8);

    for (const sample of samples) {
      const pt = sampleToCanvas(sample, activePlaneModel);
      if (!pt) continue;
      const sampleWeight = typeof sample.conf === "number" ? clamp(sample.conf, 0.15, 1) : 1;
      const px = clamp(Math.round(pt.cx), 0, CANVAS_W - 1);
      const py = clamp(Math.round(pt.cy), 0, CANVAS_H - 1);
      const intensity = intensities[py * CANVAS_W + px] ?? 0;
      const normalized = normalizeIntensity(intensity, intensityReference);
      const [r, g, b] = intensityToRGBA(Math.round(normalized * 255));
      const dotAlpha = (0.16 + 0.24 * normalized) * sampleWeight;

      ctx.beginPath();
      ctx.fillStyle = `rgba(${r},${g},${b},${dotAlpha})`;
      ctx.arc(pt.cx, pt.cy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    drawColorBar(ctx);
  }, [activePlaneModel, samples, screenRect]);

  if (!calibrated && samples.length === 0) {
    return (
      <div className="flex items-center gap-2 text-zinc-500">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        <span className="text-sm">Gaze tracking was not available for this session</span>
      </div>
    );
  }

  if (samples.length === 0) {
    return <p className="text-sm text-zinc-500">No gaze data recorded.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="w-full rounded-xl"
        style={{ maxWidth: CANVAS_W, aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
      />

      {breakdown && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs px-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium ${
                breakdown.onScreen >= 80
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : breakdown.onScreen >= 60
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {breakdown.onScreen}% on-screen
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.04] text-zinc-300">
              {breakdown.offScreen}% off-screen
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.04] text-zinc-300">
              {breakdown.onScreenSeconds}s on-screen
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.04] text-zinc-300">
              {breakdown.offScreenSeconds}s off-screen
            </span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
              activePlaneModel.quality.source === "approximate_fallback"
                ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                : activePlaneModel.quality.label === "good"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/20 bg-amber-500/10 text-amber-300"
            }`}>
              {activePlaneModel.quality.source === "approximate_fallback"
                ? "fallback geometry"
                : activePlaneModel.quality.label === "good"
                  ? "good calibration fit"
                  : "low-confidence observed fit"}
            </span>
          </div>
          <span className="text-zinc-500">
            {breakdown.total.toLocaleString()} samples
          </span>
        </div>
      )}
    </div>
  );
}
