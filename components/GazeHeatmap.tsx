"use client";

import { useEffect, useMemo, useRef } from "react";
import type { GazeSample, GazeZone } from "@/lib/store";

interface GazeHeatmapProps {
  samples: GazeSample[];
  calibrated: boolean;
}

const CANVAS_W = 720;
const CANVAS_H = 540;

const INNER_W = 432;
const INNER_H = 243;
const INNER_X = (CANVAS_W - INNER_W) / 2;
const INNER_Y = (CANVAS_H - INNER_H) / 2;

const BLOB_RADIUS = 18;

function sampleToCanvas(s: GazeSample): { cx: number; cy: number } | null {
  if (s.zone === "unknown") return null;

  const cx = INNER_X + s.x * INNER_W;
  const cy = INNER_Y + s.y * INNER_H;

  return {
    cx: Math.max(0, Math.min(CANVAS_W, cx)),
    cy: Math.max(0, Math.min(CANVAS_H, cy)),
  };
}

const GRADIENT_COLORS: [number, number, number][] = [
  [0, 0, 0],       // 0 — transparent
  [30, 58, 138],    // low — blue
  [59, 130, 246],   // med-low — lighter blue
  [245, 158, 11],   // medium — amber
  [239, 68, 68],    // high — red
  [255, 255, 255],  // max — white
];

function intensityToRGBA(val: number): [number, number, number, number] {
  if (val === 0) return [0, 0, 0, 0];

  const t = Math.min(val / 255, 1);
  const idx = t * (GRADIENT_COLORS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, GRADIENT_COLORS.length - 1);
  const f = idx - lo;

  const r = Math.round(GRADIENT_COLORS[lo][0] * (1 - f) + GRADIENT_COLORS[hi][0] * f);
  const g = Math.round(GRADIENT_COLORS[lo][1] * (1 - f) + GRADIENT_COLORS[hi][1] * f);
  const b = Math.round(GRADIENT_COLORS[lo][2] * (1 - f) + GRADIENT_COLORS[hi][2] * f);
  const a = Math.round(Math.min(t * 1.5, 1) * 200);

  return [r, g, b, a];
}

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

export default function GazeHeatmap({ samples, calibrated }: GazeHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sampleCount = samples.length;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sampleCount === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
      offCtx.fillRect(pt.cx - BLOB_RADIUS, pt.cy - BLOB_RADIUS, BLOB_RADIUS * 2, BLOB_RADIUS * 2);
    }

    const imgData = offCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      const intensity = data[i];
      const [r, g, b, a] = intensityToRGBA(intensity);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.putImageData(imgData, 0, 0);

    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(161,161,170,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(INNER_X, INNER_Y, INNER_W, INNER_H);
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(161,161,170,0.5)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("Screen", INNER_X + INNER_W / 2, INNER_Y + INNER_H + 16);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleCount]);

  const breakdown = useMemo(() => computeZoneBreakdown(samples), [sampleCount]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!calibrated) {
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
    <div className="flex flex-col gap-3">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="w-full rounded-lg border border-white/[0.06]"
        style={{ maxWidth: CANVAS_W, aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
      />
      {breakdown && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className="text-zinc-400">
            On-screen: <span className="text-zinc-200 font-medium">{breakdown.onScreen}%</span>
          </span>
          {breakdown.offLeft > 0 && (
            <span className={breakdown.offLeft > 25 ? "text-red-400" : breakdown.offLeft > 15 ? "text-amber-400" : "text-zinc-400"}>
              Off-left: <span className="font-medium">{breakdown.offLeft}%</span>
            </span>
          )}
          {breakdown.offRight > 0 && (
            <span className={breakdown.offRight > 25 ? "text-red-400" : breakdown.offRight > 15 ? "text-amber-400" : "text-zinc-400"}>
              Off-right: <span className="font-medium">{breakdown.offRight}%</span>
            </span>
          )}
          {breakdown.offTop > 0 && (
            <span className={breakdown.offTop > 25 ? "text-red-400" : breakdown.offTop > 15 ? "text-amber-400" : "text-zinc-400"}>
              Off-top: <span className="font-medium">{breakdown.offTop}%</span>
            </span>
          )}
          {breakdown.offBottom > 0 && (
            <span className={breakdown.offBottom > 25 ? "text-red-400" : breakdown.offBottom > 15 ? "text-amber-400" : "text-zinc-400"}>
              Off-bottom: <span className="font-medium">{breakdown.offBottom}%</span>
            </span>
          )}
          <span className="text-zinc-500">({breakdown.total} samples)</span>
        </div>
      )}
    </div>
  );
}
