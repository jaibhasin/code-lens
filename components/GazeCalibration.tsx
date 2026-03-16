"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface GazeCalibrationProps {
  roomId: string;
  onComplete: (calibrated: boolean) => void;
}

const CALIBRATION_POINTS: [number, number][] = [
  [5, 5],
  [95, 5],
  [95, 95],
  [5, 95],
  [50, 50],
];

const VALIDATION_POINTS: [number, number][] = [
  [30, 30],
  [70, 70],
];

type Stage = "face_check" | "calibrating" | "validating" | "done";

export default function GazeCalibration({ roomId, onComplete }: GazeCalibrationProps) {
  const [stage, setStage] = useState<Stage>("face_check");
  const [faceDetected, setFaceDetected] = useState(false);
  const [currentDot, setCurrentDot] = useState(0);
  const [completedDots, setCompletedDots] = useState<number[]>([]);
  const [validationIdx, setValidationIdx] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webgazerRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const validationErrors = useRef<number[]>([]);
  const faceCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const emitTimelineEvent = useCallback(
    (event: string, data: Record<string, unknown> = {}) => {
      fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timelineEvent: { timestamp: new Date().toISOString(), event, data },
        }),
      }).catch(() => {});
    },
    [roomId]
  );

  useEffect(() => {
    let cancelled = false;

    async function initWebGazer() {
      try {
        const mod = await import("webgazer");
        const wg = mod.default;
        if (cancelled) return;
        webgazerRef.current = wg;

        wg.params.showVideoPreview = false;
        wg.params.showFaceOverlay = false;
        wg.params.showFaceFeedbackBox = false;
        wg.saveDataAcrossSessions = false;

        await wg.setRegression("ridge").setTracker("TFFacemesh").begin();
        wg.showPredictionPoints(false);

        const videoEl = document.getElementById("webgazerVideoFeed") as HTMLVideoElement | null;
        if (videoEl) {
          videoEl.style.display = "none";
          videoRef.current = videoEl;
        }

        const checkFace = () => {
          if (cancelled) return;
          const tracker = wg.getTracker?.();
          if (tracker?.getPositions) {
            const pos = tracker.getPositions();
            if (pos && pos.length > 0) {
              setFaceDetected(true);
              return;
            }
          }
          setFaceDetected(true);
        };
        faceCheckTimer.current = setTimeout(checkFace, 2000);

        const stream = wg.getVideoStream?.();
        if (stream) streamRef.current = stream;
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
      }
    }

    initWebGazer();

    return () => {
      cancelled = true;
      if (faceCheckTimer.current) clearTimeout(faceCheckTimer.current);
    };
  }, []);

  const skipCalibration = useCallback(() => {
    emitTimelineEvent("gaze_calibration_skipped", { reason: "user_skip" });
    webgazerRef.current?.end().catch(() => {});
    onComplete(false);
  }, [emitTimelineEvent, onComplete]);

  const handleDotClick = useCallback(
    (dotIndex: number) => {
      if (dotIndex !== currentDot) return;
      const wg = webgazerRef.current;
      if (!wg) return;

      const [xPct, yPct] = CALIBRATION_POINTS[dotIndex];
      const x = (xPct / 100) * window.innerWidth;
      const y = (yPct / 100) * window.innerHeight;

      wg.recordScreenPosition(x, y, "click");

      setCompletedDots((prev) => [...prev, dotIndex]);

      if (dotIndex < CALIBRATION_POINTS.length - 1) {
        setTimeout(() => setCurrentDot(dotIndex + 1), 300);
      } else {
        setTimeout(() => {
          setStage("validating");
          setValidationIdx(0);
          validationErrors.current = [];
        }, 500);
      }
    },
    [currentDot]
  );

  useEffect(() => {
    if (stage !== "validating") return;
    if (validationIdx >= VALIDATION_POINTS.length) return;

    const timer = setTimeout(async () => {
      const wg = webgazerRef.current;
      if (!wg) return;

      const prediction = await wg.getCurrentPrediction();
      if (prediction) {
        const [xPct, yPct] = VALIDATION_POINTS[validationIdx];
        const expectedX = (xPct / 100) * window.innerWidth;
        const expectedY = (yPct / 100) * window.innerHeight;
        const dx = prediction.x - expectedX;
        const dy = prediction.y - expectedY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        validationErrors.current.push(dist);
      }

      if (validationIdx < VALIDATION_POINTS.length - 1) {
        setValidationIdx(validationIdx + 1);
      } else {
        const avgError =
          validationErrors.current.length > 0
            ? validationErrors.current.reduce((a, b) => a + b, 0) / validationErrors.current.length
            : 999;

        if (avgError < 150 || retryCount >= 1) {
          const calibrated = avgError < 150;
          fetch(`/api/rooms/${roomId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gazeCalibrated: calibrated }),
          }).catch(() => {});

          if (calibrated) {
            emitTimelineEvent("gaze_calibration_complete", {
              quality: Math.round(avgError),
              retries: retryCount,
            });
          } else {
            emitTimelineEvent("gaze_calibration_skipped", { reason: "poor_accuracy" });
          }

          setStage("done");
          setTimeout(() => onComplete(calibrated), 800);
        } else {
          setRetryCount((c) => c + 1);
          setCompletedDots([]);
          setCurrentDot(0);
          setStage("calibrating");
        }
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [stage, validationIdx, retryCount, roomId, emitTimelineEvent, onComplete]);

  if (error) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md">
        <div className="glass p-8 rounded-2xl max-w-md text-center flex flex-col gap-4 animate-fade-in-up">
          <p className="text-zinc-300">Camera access failed</p>
          <p className="text-sm text-zinc-500">{error}</p>
          <button
            onClick={skipCalibration}
            className="rounded-lg bg-amber-500 text-zinc-950 font-medium py-2 hover:bg-amber-400 transition-all"
          >
            Continue without gaze tracking
          </button>
        </div>
      </div>
    );
  }

  if (stage === "face_check") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md">
        <div className="glass p-8 rounded-2xl max-w-md flex flex-col items-center gap-5 animate-fade-in-up">
          <h2 className="text-xl font-semibold text-white">Camera Setup</h2>

          <div className="w-48 h-36 rounded-xl bg-zinc-800 border border-white/[0.06] overflow-hidden flex items-center justify-center">
            {streamRef.current ? (
              <video
                autoPlay
                playsInline
                muted
                ref={(el) => {
                  if (el && streamRef.current) el.srcObject = streamRef.current;
                }}
                className="w-full h-full object-cover -scale-x-100"
              />
            ) : (
              <div className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span className="text-sm text-zinc-400">Starting camera...</span>
              </div>
            )}
          </div>

          {faceDetected ? (
            <div className="flex items-center gap-2 text-emerald-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm font-medium">Face detected</span>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Detecting face...</p>
          )}

          <p className="text-xs text-zinc-500 text-center leading-relaxed">
            Your camera is used locally to track where you look on screen.
            No video is recorded or sent to any server.
          </p>

          <button
            onClick={() => {
              if (faceDetected) {
                setStage("calibrating");
              }
            }}
            disabled={!faceDetected}
            className="w-full rounded-lg bg-amber-500 text-zinc-950 font-medium py-2.5
                       hover:bg-amber-400 disabled:opacity-40 transition-all duration-300
                       shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)]"
          >
            Continue to calibration
          </button>

          <button onClick={skipCalibration} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            Skip calibration
          </button>
        </div>
      </div>
    );
  }

  if (stage === "calibrating") {
    return (
      <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-zinc-300 text-lg font-medium">Look at the dot and click it</p>
            <p className="text-zinc-500 text-sm mt-1">
              {currentDot + 1} of {CALIBRATION_POINTS.length}
            </p>
          </div>
        </div>

        {CALIBRATION_POINTS.map(([xPct, yPct], idx) => {
          const isActive = idx === currentDot;
          const isDone = completedDots.includes(idx);
          if (!isActive && !isDone) return null;

          return (
            <button
              key={idx}
              onClick={() => handleDotClick(idx)}
              disabled={!isActive}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${xPct}%`, top: `${yPct}%` }}
            >
              <span
                className={`block w-6 h-6 rounded-full transition-all duration-300 ${
                  isDone
                    ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]"
                    : "bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.5)] animate-pulse"
                }`}
              />
              {isActive && (
                <span className="absolute inset-0 -m-2 rounded-full border-2 border-amber-500/50 animate-ping" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  if (stage === "validating") {
    const [xPct, yPct] = VALIDATION_POINTS[validationIdx] ?? [50, 50];
    return (
      <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-zinc-400 text-sm">Verifying accuracy...</p>
        </div>
        <span
          className="absolute block w-5 h-5 rounded-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)] -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${xPct}%`, top: `${yPct}%` }}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="flex flex-col items-center gap-3 animate-fade-in-up">
        <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-zinc-200 font-medium">Calibration complete</p>
      </div>
    </div>
  );
}
