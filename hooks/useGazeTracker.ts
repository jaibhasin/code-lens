"use client";

import { useCallback, useEffect, useRef } from "react";
import type { GazeSample, GazeZone } from "@/lib/store";

const SAMPLE_INTERVAL_MS = 500; // 2 Hz
const FLUSH_INTERVAL_MS = 5_000;
const OFF_SCREEN_STREAK_THRESHOLD_MS = 10_000;

function classifyZone(xNorm: number, yNorm: number): GazeZone {
  if (xNorm < 0) return "off_left";
  if (xNorm > 1) return "off_right";
  if (yNorm < 0) return "off_top";
  if (yNorm > 1) return "off_bottom";
  return "on_screen";
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function useGazeTracker(
  roomId: string,
  active: boolean,
  pushTimelineEvent: (event: string, data?: Record<string, unknown>) => void
) {
  const bufferRef = useRef<GazeSample[]>([]);
  const offScreenStartRef = useRef<number | null>(null);
  const offScreenDirRef = useRef<GazeZone>("unknown");
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSampleRef = useRef<number>(0);

  const flush = useCallback(
    (useSendBeacon = false) => {
      if (bufferRef.current.length === 0) return;
      const payload = JSON.stringify({ gazeSamples: bufferRef.current });
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
    [roomId]
  );

  useEffect(() => {
    if (!active) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let wg: any = null;

    async function start() {
      const mod = await import("webgazer");
      wg = mod.default;

      wg.resume();

      sampleTimerRef.current = setInterval(async () => {
        const now = Date.now();
        if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS - 50) return;
        lastSampleRef.current = now;

        try {
          const prediction = await wg.getCurrentPrediction();
          if (!prediction) {
            bufferRef.current.push({
              ts: now,
              x: 0.5,
              y: 0.5,
              zone: "unknown",
              conf: 0,
            });
            return;
          }

          const xNorm = prediction.x / window.innerWidth;
          const yNorm = prediction.y / window.innerHeight;
          const zone = classifyZone(xNorm, yNorm);

          const sample: GazeSample = {
            ts: now,
            x: clamp(xNorm, -0.5, 1.5),
            y: clamp(yNorm, -0.5, 1.5),
            zone,
            conf: 1,
          };

          bufferRef.current.push(sample);

          if (zone !== "on_screen" && zone !== "unknown") {
            if (offScreenStartRef.current === null) {
              offScreenStartRef.current = now;
              offScreenDirRef.current = zone;
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
    };
  }, [active, flush, pushTimelineEvent]);
}
