"use client";

import { useCallback, useEffect, useRef } from "react";
import { projectGazeToPlane, smoothNormalizedPoint } from "@/lib/gaze-plane";
import type { GazeSample, GazeZone, GazePlaneModel } from "@/lib/store";

const SAMPLE_INTERVAL_MS = 500; // 2 Hz
const FLUSH_INTERVAL_MS = 5_000;
const OFF_SCREEN_STREAK_THRESHOLD_MS = 10_000;
const SMOOTHING_FACTOR = 0.35;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

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

export function useGazeTracker(
  roomId: string,
  active: boolean,
  pushTimelineEvent: (event: string, data?: Record<string, unknown>) => void,
  planeModel: GazePlaneModel | null
) {
  const bufferRef = useRef<GazeSample[]>([]);
  const offScreenStartRef = useRef<number | null>(null);
  const offScreenDirRef = useRef<GazeZone>("unknown");
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSampleRef = useRef<number>(0);
  const smoothedPointRef = useRef<{ x: number; y: number } | null>(null);

  const flush = useCallback(
    (useSendBeacon = false) => {
      if (bufferRef.current.length === 0) return;
      const payload = JSON.stringify({
        gazeSamples: bufferRef.current,
        ...(planeModel ? { gazePlaneModel: planeModel } : {}),
      });
      bufferRef.current = [];

      if (useSendBeacon && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(
          `/api/rooms/${roomId}`,
          new Blob([payload], { type: "application/json" })
        );
      } else {
        fetch(`/api/rooms/${roomId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: payload,
        }).catch(() => {});
      }
    },
    [planeModel, roomId]
  );

  useEffect(() => {
    if (!active) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let wg: any = null;

    async function start() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wg = (window as any).webgazer;
      if (!wg) return;

      wg.resume();

      sampleTimerRef.current = setInterval(async () => {
        const now = Date.now();
        if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS - 50) return;
        lastSampleRef.current = now;

        try {
          const prediction = await wg.getCurrentPrediction();
          if (!prediction) return;

          const rawXNorm = prediction.x / window.innerWidth;
          const rawYNorm = prediction.y / window.innerHeight;
          const smoothedPoint = smoothNormalizedPoint(
            smoothedPointRef.current,
            { x: rawXNorm, y: rawYNorm },
            SMOOTHING_FACTOR
          );
          smoothedPointRef.current = smoothedPoint;

          const modelInUse = planeModel ?? FALLBACK_PLANE_MODEL;
          const projection = projectGazeToPlane({
            xNorm: smoothedPoint.x,
            yNorm: smoothedPoint.y,
            model: modelInUse,
          });

          const sample: GazeSample = {
            ts: now,
            x: clamp(smoothedPoint.x, -1, 2),
            y: clamp(smoothedPoint.y, -1, 2),
            rawX: clamp(rawXNorm, -1, 2),
            rawY: clamp(rawYNorm, -1, 2),
            planeX: projection.planeX,
            planeY: projection.planeY,
            insideScreen: projection.insideScreen,
            clamped: projection.clamped,
            zone: projection.zone,
            conf: projection.clamped ? 0.6 : modelInUse.quality.label === "low" ? 0.75 : 1,
          };

          bufferRef.current.push(sample);

          if (projection.zone !== "on_screen" && projection.zone !== "unknown") {
            if (offScreenStartRef.current === null || offScreenDirRef.current !== projection.zone) {
              offScreenStartRef.current = now;
              offScreenDirRef.current = projection.zone;
            }
            const duration = now - offScreenStartRef.current;
            if (duration >= OFF_SCREEN_STREAK_THRESHOLD_MS) {
              pushTimelineEvent("gaze_off_screen_streak", {
                durationSeconds: Math.round(duration / 1000),
                direction: offScreenDirRef.current,
              });
              offScreenStartRef.current = now;
            }
          } else {
            offScreenStartRef.current = null;
          }
        } catch {
          // WebGazer prediction can fail transiently
        }
      }, SAMPLE_INTERVAL_MS);

      flushTimerRef.current = setInterval(() => flush(false), FLUSH_INTERVAL_MS);
    }

    start();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        flush(true);
        wg?.pause();
      } else {
        wg?.resume();
      }
    };

    const handleBeforeUnload = () => flush(true);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      if (sampleTimerRef.current) clearInterval(sampleTimerRef.current);
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      flush(true);
      wg?.pause();
      smoothedPointRef.current = null;
    };
  }, [active, flush, planeModel, pushTimelineEvent]);
}
