/**
 * ─────────────────────────────────────────────────────────────────────────────
 * components/GazeHeatmap.tsx — Presentation-ready gaze heatmap visualization
 *
 * Renders a canvas-based heatmap of where the candidate looked during the
 * interview. Uses a perceptually uniform "inferno" colormap (dark → yellow)
 * for accurate intensity perception.
 *
 * LAYOUT:
 *   ┌──────────────────────────────────────────┐
 *   │  Off-top indicator arrow + %             │
 *   │  ┌────────────────────────────────────┐  │
 *   │← │        Screen area (heatmap)       │ →│  Off-left / Off-right
 *   │  └────────────────────────────────────┘  │
 *   │  Off-bottom indicator arrow + %          │
 *   │  ┌─ Color bar legend ─────────────────┐  │
 *   │  │ Low ██████████████████████████ High │  │
 *   │  └────────────────────────────────────┘  │
 *   └──────────────────────────────────────────┘
 *
 * COLOR PALETTE:
 *   Inferno — perceptually uniform, sequential. Dark (low density) →
 *   deep purple → red-orange → bright yellow (high density).
 *   Avoids rainbow/jet artifacts that create false contours.
 *
 * CANVAS PIPELINE:
 *   1. Accumulate Gaussian blobs on an offscreen grayscale canvas
 *   2. Read pixel data, remap grayscale → inferno RGBA
 *   3. Composite onto main canvas with screen region border + labels
 *   4. Draw directional off-screen indicators as arrows outside the border
 *   5. Draw a horizontal color bar legend below the heatmap
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use client";

import { useEffect, useMemo, useRef } from "react";
import type { GazeSample, GazeZone } from "@/lib/store";

/* ── Component props ──────────────────────────────────────────────────────── */
interface GazeHeatmapProps {
  samples: GazeSample[];
  calibrated: boolean;
}

/* ── Canvas dimensions ────────────────────────────────────────────────────── *
 * CANVAS_W/H = total drawing area including margins for labels.
 * INNER_W/H  = the "screen" rectangle where on-screen gaze points map.
 * Padding around the inner rect leaves room for off-screen arrows + legend. */
const CANVAS_W = 780;
const CANVAS_H = 620;

/* Screen rectangle — 16:9 aspect ratio, centered with generous margins
 * so directional arrows and labels have space around it. */
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 80; // extra room for the color bar legend
const MARGIN_X = 70;      // room for left/right off-screen arrows

const INNER_W = CANVAS_W - MARGIN_X * 2;
const INNER_H = CANVAS_H - MARGIN_TOP - MARGIN_BOTTOM;
const INNER_X = MARGIN_X;
const INNER_Y = MARGIN_TOP;

/* Gaussian blob radius — controls how "smooth" the heatmap looks.
 * Larger = smoother blending between nearby gaze points. */
const BLOB_RADIUS = 24;

/* ── Inferno colormap ─────────────────────────────────────────────────────── *
 * 8-stop approximation of matplotlib's "inferno" — perceptually uniform,
 * dark-to-bright sequential. Each entry is [R, G, B] at evenly spaced
 * intensity values from 0 (no data) to 255 (max density).
 * Source: https://bids.github.io/colormap/ */
const INFERNO: [number, number, number][] = [
  [0, 0, 4],        // 0.00 — near-black (no data)
  [40, 11, 84],      // 0.14 — deep indigo
  [101, 21, 110],    // 0.29 — purple
  [159, 42, 99],     // 0.43 — magenta-plum
  [212, 72, 66],     // 0.57 — red-orange
  [245, 125, 21],    // 0.71 — orange
  [250, 193, 39],    // 0.86 — amber-yellow
  [252, 255, 164],   // 1.00 — bright pale yellow (hotspot)
];

/**
 * Maps a grayscale intensity (0–255) to an RGBA tuple using the inferno
 * colormap. Zero intensity → fully transparent (no data drawn there).
 */
function intensityToRGBA(val: number): [number, number, number, number] {
  if (val === 0) return [0, 0, 0, 0];

  /* Normalize intensity to 0–1 range */
  const t = Math.min(val / 255, 1);

  /* Interpolate between the two nearest colormap stops */
  const idx = t * (INFERNO.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, INFERNO.length - 1);
  const f = idx - lo;

  const r = Math.round(INFERNO[lo][0] * (1 - f) + INFERNO[hi][0] * f);
  const g = Math.round(INFERNO[lo][1] * (1 - f) + INFERNO[hi][1] * f);
  const b = Math.round(INFERNO[lo][2] * (1 - f) + INFERNO[hi][2] * f);

  /* Alpha ramps up with intensity — faint areas are semi-transparent,
   * hot areas are fully opaque. Capped at 230 to avoid harsh edges. */
  const a = Math.round(Math.min(t * 1.8, 1) * 230);

  return [r, g, b, a];
}

/* ── Coordinate mapping ───────────────────────────────────────────────────── *
 * Converts a normalized gaze sample (x: 0–1, y: 0–1) to canvas pixel
 * coordinates within the inner "screen" rectangle. Off-screen samples
 * (zone != on_screen) are clamped to the canvas bounds. */
function sampleToCanvas(s: GazeSample): { cx: number; cy: number } | null {
  if (s.zone === "unknown") return null;

  const cx = INNER_X + s.x * INNER_W;
  const cy = INNER_Y + s.y * INNER_H;

  return {
    cx: Math.max(0, Math.min(CANVAS_W, cx)),
    cy: Math.max(0, Math.min(CANVAS_H, cy)),
  };
}

/* ── Zone breakdown computation ───────────────────────────────────────────── *
 * Counts how many samples fell in each gaze zone and returns percentages.
 * Used by both the canvas drawing (directional arrows) and the stats bar. */
function computeZoneBreakdown(samples: GazeSample[]) {
  const valid = samples.filter((s) => s.zone !== "unknown");
  const total = valid.length;
  if (total === 0) return null;

  const counts: Record<GazeZone, number> = {
    on_screen: 0,
    off_left: 0,
    off_right: 0,
    off_top: 0,
    off_bottom: 0,
    unknown: 0,
  };

  for (const s of valid) {
    counts[s.zone]++;
  }

  return {
    onScreen: Math.round((counts.on_screen / total) * 100),
    offLeft: Math.round((counts.off_left / total) * 100),
    offRight: Math.round((counts.off_right / total) * 100),
    offTop: Math.round((counts.off_top / total) * 100),
    offBottom: Math.round((counts.off_bottom / total) * 100),
    total,
  };
}

/* ── Severity color ───────────────────────────────────────────────────────── *
 * Returns a CSS-ready rgba color based on how elevated an off-screen
 * percentage is. Used for directional arrow fill + label color. */
function severityColor(pct: number): string {
  if (pct > 25) return "rgba(239, 68, 68, 0.9)";  // red — high concern
  if (pct > 15) return "rgba(245, 158, 11, 0.9)";  // amber — moderate
  return "rgba(161, 161, 170, 0.5)";                // zinc — normal
}

/* ── Draw a directional arrow on the canvas ───────────────────────────────── *
 * Draws a small triangular arrow pointing away from the screen rectangle,
 * with a percentage label. Only drawn when that direction has > 0% samples. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  direction: "top" | "bottom" | "left" | "right",
  pct: number
) {
  if (pct === 0) return;

  const color = severityColor(pct);
  const centerX = INNER_X + INNER_W / 2;
  const centerY = INNER_Y + INNER_H / 2;
  const arrowSize = 8;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "none";

  ctx.beginPath();
  switch (direction) {
    case "top": {
      const y = INNER_Y - 18;
      ctx.moveTo(centerX - arrowSize, y + arrowSize);
      ctx.lineTo(centerX, y - 2);
      ctx.lineTo(centerX + arrowSize, y + arrowSize);
      ctx.fill();
      ctx.font = "600 12px Inter, system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${pct}%`, centerX, y - 5);
      ctx.font = "10px Inter, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "rgba(161, 161, 170, 0.6)";
      ctx.fillText("off-top", centerX, y - 18);
      break;
    }
    case "bottom": {
      const y = INNER_Y + INNER_H + 18;
      ctx.moveTo(centerX - arrowSize, y - arrowSize);
      ctx.lineTo(centerX, y + 2);
      ctx.lineTo(centerX + arrowSize, y - arrowSize);
      ctx.fill();
      ctx.font = "600 12px Inter, system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`${pct}%`, centerX, y + 5);
      ctx.font = "10px Inter, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "rgba(161, 161, 170, 0.6)";
      ctx.fillText("off-bottom", centerX, y + 19);
      break;
    }
    case "left": {
      const x = INNER_X - 18;
      ctx.moveTo(x + arrowSize, centerY - arrowSize);
      ctx.lineTo(x - 2, centerY);
      ctx.lineTo(x + arrowSize, centerY + arrowSize);
      ctx.fill();
      ctx.font = "600 12px Inter, system-ui, -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(`${pct}%`, x - 6, centerY);
      ctx.font = "10px Inter, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "rgba(161, 161, 170, 0.6)";
      ctx.textAlign = "center";
      ctx.fillText("off", x - 16, centerY - 14);
      ctx.fillText("left", x - 16, centerY + 14);
      break;
    }
    case "right": {
      const x = INNER_X + INNER_W + 18;
      ctx.moveTo(x - arrowSize, centerY - arrowSize);
      ctx.lineTo(x + 2, centerY);
      ctx.lineTo(x - arrowSize, centerY + arrowSize);
      ctx.fill();
      ctx.font = "600 12px Inter, system-ui, -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${pct}%`, x + 6, centerY);
      ctx.font = "10px Inter, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "rgba(161, 161, 170, 0.6)";
      ctx.textAlign = "center";
      ctx.fillText("off", x + 20, centerY - 14);
      ctx.fillText("right", x + 20, centerY + 14);
      break;
    }
  }
  ctx.restore();
}

/* ── Draw the color bar legend ────────────────────────────────────────────── *
 * Horizontal gradient bar below the heatmap showing the inferno colormap
 * with "Low" and "High" labels. Gives the viewer a reference for
 * interpreting heatmap intensity. */
function drawColorBar(ctx: CanvasRenderingContext2D) {
  const barX = INNER_X;
  const barY = CANVAS_H - 40;
  const barW = INNER_W;
  const barH = 10;
  const radius = 5; // rounded corners

  /* Draw the gradient bar with rounded corners using a clipping path */
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, radius);
  ctx.clip();

  /* Fill each pixel column with the corresponding inferno color */
  for (let x = 0; x < barW; x++) {
    const t = x / (barW - 1);
    const intensity = Math.round(t * 255);
    const [r, g, b] = intensityToRGBA(intensity);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(barX + x, barY, 1, barH);
  }
  ctx.restore();

  /* "Low" label — left end */
  ctx.fillStyle = "rgba(161, 161, 170, 0.7)";
  ctx.font = "11px Inter, system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Low", barX, barY + barH + 6);

  /* "Gaze density" label — center */
  ctx.textAlign = "center";
  ctx.fillText("Gaze density", barX + barW / 2, barY + barH + 6);

  /* "High" label — right end */
  ctx.textAlign = "right";
  ctx.fillText("High", barX + barW, barY + barH + 6);
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * GazeHeatmap — main component
 * ═══════════════════════════════════════════════════════════════════════════ */
export default function GazeHeatmap({ samples, calibrated }: GazeHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* Memoize the zone breakdown so it doesn't recompute on every render.
   * Only recalculates when the sample count changes. */
  const sampleCount = samples.length;
  const breakdown = useMemo(() => computeZoneBreakdown(samples), [sampleCount]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Canvas rendering effect ────────────────────────────────────────────
   * Runs whenever sampleCount changes. Draws the full heatmap visualization
   * in five stages: background → Gaussian blobs → colormap remap →
   * screen border + arrows → color bar legend. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sampleCount === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /* Stage 1: Accumulate Gaussian blobs on an offscreen grayscale canvas.
     * Each gaze sample becomes a soft white radial gradient blob. Where
     * blobs overlap, intensity values add up (brighter = more fixation). */
    const offscreen = document.createElement("canvas");
    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;
    const offCtx = offscreen.getContext("2d")!;
    offCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    for (const s of samples) {
      const pt = sampleToCanvas(s);
      if (!pt) continue;

      const grad = offCtx.createRadialGradient(pt.cx, pt.cy, 0, pt.cx, pt.cy, BLOB_RADIUS);
      grad.addColorStop(0, "rgba(255,255,255,0.04)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      offCtx.fillStyle = grad;
      offCtx.fillRect(
        pt.cx - BLOB_RADIUS, pt.cy - BLOB_RADIUS,
        BLOB_RADIUS * 2, BLOB_RADIUS * 2
      );
    }

    /* Stage 2: Read the grayscale pixel data and remap each pixel through
     * the inferno colormap. This converts white-on-black density blobs
     * into the final colored heatmap. */
    const imgData = offCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      const intensity = data[i]; // grayscale — R channel has the value
      const [r, g, b, a] = intensityToRGBA(intensity);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }

    /* Stage 3: Clear the main canvas and draw a subtle dark background,
     * then composite the colored heatmap data on top. */
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "rgba(9, 9, 11, 0.6)"; // zinc-950 tinted
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.putImageData(imgData, 0, 0);

    /* Stage 4: Draw the "screen" rectangle border — solid with rounded
     * corners and a subtle glow, plus corner labels for orientation. */
    ctx.save();
    ctx.strokeStyle = "rgba(113, 113, 122, 0.35)"; // zinc-500 at 35%
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(INNER_X, INNER_Y, INNER_W, INNER_H, 6);
    ctx.stroke();
    ctx.restore();

    /* "Screen" label centered below the inner rectangle */
    ctx.fillStyle = "rgba(161, 161, 170, 0.45)";
    ctx.font = "11px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("candidate's screen", INNER_X + INNER_W / 2, INNER_Y + INNER_H + 4);

    /* Stage 5: Draw directional off-screen arrows if there's zone data */
    if (breakdown) {
      drawArrow(ctx, "top", breakdown.offTop);
      drawArrow(ctx, "bottom", breakdown.offBottom);
      drawArrow(ctx, "left", breakdown.offLeft);
      drawArrow(ctx, "right", breakdown.offRight);
    }

    /* Stage 6: Draw the color bar legend at the bottom */
    drawColorBar(ctx);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleCount, breakdown]);

  /* ── Early returns for edge cases ─────────────────────────────────────── */

  /* Show "not available" only when both the calibrated flag is false AND there
   * are no gaze samples. If samples exist, tracking clearly worked — so render
   * the heatmap regardless of the flag (handles edge case where the PATCH to
   * set gazeCalibrated=true failed silently). */
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

  /* ── Main render ────────────────────────────────────────────────────────
   * Canvas fills its container width with a fixed aspect ratio.
   * Below the canvas: on-screen percentage badge + sample count. */
  return (
    <div className="flex flex-col gap-4">
      {/* Heatmap canvas */}
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="w-full rounded-xl"
        style={{ maxWidth: CANVAS_W, aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
      />

      {/* Summary stats bar — on-screen %, sample count, and data quality note */}
      {breakdown && (
        <div className="flex items-center justify-between text-xs px-1">
          {/* On-screen percentage with color-coded badge */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium ${
                breakdown.onScreen >= 80
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : breakdown.onScreen >= 60
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"
              }`}
            >
              {/* Eye icon */}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {breakdown.onScreen}% on-screen
            </span>
          </div>

          {/* Sample count */}
          <span className="text-zinc-500">
            {breakdown.total.toLocaleString()} samples
          </span>
        </div>
      )}
    </div>
  );
}
