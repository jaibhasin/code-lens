"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildFrontPlaneModel } from "@/lib/gaze-plane";

interface GazeCalibrationProps {
  roomId: string;
  onComplete: (result: { calibrated: boolean; planeModel: ReturnType<typeof buildFrontPlaneModel> | null }) => void;
}

/* Calibration dots placed at ~2% from each edge so the corner points
 * sit closer to the actual screen corners — improves WebGazer's ridge
 * regression accuracy at the extremes of the viewport. */
const CALIBRATION_POINTS: [number, number][] = [
  [2, 2],
  [98, 2],
  [98, 98],
  [2, 98],
  [50, 50],
];

const VALIDATION_POINTS: [number, number][] = [
  [25, 25],
  [75, 25],
  [25, 75],
  [75, 75],
];

const VALIDATION_SAMPLE_COUNT = 6;
const VALIDATION_SAMPLE_DELAY_MS = 120;

type Stage = "face_check" | "calibrating" | "validating" | "done";

export default function GazeCalibration({ roomId, onComplete }: GazeCalibrationProps) {
  const [stage, setStage] = useState<Stage>("face_check");
  const [faceDetected, setFaceDetected] = useState(false);
  const [currentDot, setCurrentDot] = useState(0);
  const [completedDots, setCompletedDots] = useState<number[]>([]);
  const [validationIdx, setValidationIdx] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Track camera stream in state so the video preview re-renders when ready
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webgazerRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const validationErrors = useRef<number[]>([]);
  const validationObservations = useRef<Array<{ observedXNorm: number; observedYNorm: number } | null>>([]);
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

    // Loads a script tag, handling the case where it already exists
    // (e.g. React strict-mode double-mount) by polling for the global
    // instead of resolving immediately — prevents a race where the tag
    // exists but hasn't finished executing yet.
    function loadScript(src: string): Promise<void> {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
        if (existing) {
          // Script tag already in DOM — if webgazer global is ready, resolve now
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((window as any).webgazer) {
            resolve();
            return;
          }
          // Script tag exists but hasn't finished executing yet (strict-mode
          // double-mount race). Wait for it by listening for load/error events
          // on the existing tag and polling as a fallback.
          const onLoad = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error("Failed to load webgazer script")); };
          const cleanup = () => {
            existing.removeEventListener("load", onLoad);
            existing.removeEventListener("error", onError);
            clearInterval(poll);
          };
          existing.addEventListener("load", onLoad);
          existing.addEventListener("error", onError);
          // Fallback poll in case the load event already fired before we attached
          const poll = setInterval(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((window as any).webgazer) { cleanup(); resolve(); }
          }, 100);
          return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load webgazer script"));
        document.head.appendChild(script);
      });
    }

    async function initWebGazer() {
      try {
        await loadScript("/webgazer/webgazer.js");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wg = (window as any).webgazer;
        if (!wg) throw new Error("WebGazer failed to initialize");
        if (cancelled) return;
        webgazerRef.current = wg;

        wg.params.faceMeshSolutionPath = "/webgazer/mediapipe/face_mesh";
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

        let attempts = 0;
        const MAX_ATTEMPTS = 5;
        const checkFace = () => {
          if (cancelled) return;
          attempts++;
          const tracker = wg.getTracker?.();
          if (tracker?.getPositions) {
            const pos = tracker.getPositions();
            if (pos && pos.length > 0) {
              setFaceDetected(true);
              return;
            }
          }
          if (attempts < MAX_ATTEMPTS) {
            faceCheckTimer.current = setTimeout(checkFace, 1500);
          } else {
            setFaceDetected(true);
          }
        };
        faceCheckTimer.current = setTimeout(checkFace, 2000);

        // Grab the live camera stream so the face-check preview can render it.
        // Setting both ref (for cleanup) and state (to trigger re-render).
        const stream = wg.getVideoStream?.();
        if (stream) {
          streamRef.current = stream;
          setCameraStream(stream);
        }
      } catch (err) {
        if (cancelled) return;
        // Map browser-level camera errors to user-friendly messages
        const raw = (err as Error).message ?? String(err);
        const friendly =
          raw.includes("NotAllowed") || raw.includes("Permission denied")
            ? "Camera permission was denied. Please allow camera access and reload."
            : raw.includes("NotFound") || raw.includes("Requested device not found")
              ? "No camera detected. Please connect a webcam and reload."
              : raw.includes("NotReadable") || raw.includes("Could not start video source")
                ? "Camera is in use by another app. Close it and reload."
                : raw;
        setError(friendly);
      }
    }

    initWebGazer();

    return () => {
      cancelled = true;
      if (faceCheckTimer.current) clearTimeout(faceCheckTimer.current);
      try {
        webgazerRef.current?.pause();
      } catch {
        // webgazer cleanup may fail if not fully initialized
      }
    };
  }, []);

  const skipCalibration = useCallback(() => {
    emitTimelineEvent("gaze_calibration_skipped", { reason: "user_skip" });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      webgazerRef.current?.end();
    } catch {
      // webgazer cleanup may fail if not fully initialized
    }
    onComplete({ calibrated: false, planeModel: null });
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
          validationObservations.current = new Array(VALIDATION_POINTS.length).fill(null);
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

      const captureValidationPrediction = async () => {
        const predictions: { x: number; y: number }[] = [];

        for (let i = 0; i < VALIDATION_SAMPLE_COUNT; i++) {
          await new Promise((resolve) => setTimeout(resolve, VALIDATION_SAMPLE_DELAY_MS));
          const nextPrediction = await wg.getCurrentPrediction();
          if (nextPrediction) {
            predictions.push({ x: nextPrediction.x, y: nextPrediction.y });
          }
        }

        if (predictions.length === 0) return null;

        return {
          x: predictions.reduce((sum, prediction) => sum + prediction.x, 0) / predictions.length,
          y: predictions.reduce((sum, prediction) => sum + prediction.y, 0) / predictions.length,
        };
      };

      const prediction = await captureValidationPrediction();
      if (prediction) {
        const [xPct, yPct] = VALIDATION_POINTS[validationIdx];
        const expectedX = (xPct / 100) * window.innerWidth;
        const expectedY = (yPct / 100) * window.innerHeight;
        const dx = prediction.x - expectedX;
        const dy = prediction.y - expectedY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        validationErrors.current.push(dist);
        validationObservations.current[validationIdx] = {
          observedXNorm: prediction.x / window.innerWidth,
          observedYNorm: prediction.y / window.innerHeight,
        };
      }

      if (validationIdx < VALIDATION_POINTS.length - 1) {
        setValidationIdx(validationIdx + 1);
      } else {
        const avgError =
          validationErrors.current.length > 0
            ? validationErrors.current.reduce((a, b) => a + b, 0) / validationErrors.current.length
            : 999;

        if (avgError < 150 || retryCount >= 1) {
          // Always accept calibration after the retry — even noisy data is useful
          // for zone-level (on-screen vs off-screen) classification. The actual
          // accuracy is recorded in the timeline event for the AI to factor in.
          const calibrated = true;
          const fittedPoints = VALIDATION_POINTS.map(([xPct, yPct], index) => {
            const observation = validationObservations.current[index];
            if (!observation) return null;
            return {
              xPx: (xPct / 100) * window.innerWidth,
              yPx: (yPct / 100) * window.innerHeight,
              expectedXNorm: xPct / 100,
              expectedYNorm: yPct / 100,
              observedXNorm: observation.observedXNorm,
              observedYNorm: observation.observedYNorm,
            };
          }).filter((point): point is NonNullable<typeof point> => point !== null);
          const planeModel = buildFrontPlaneModel({
            calibrationPoints: fittedPoints,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            validationErrorPx: Math.round(avgError),
          });
          /* Persist the gazeCalibrated flag to the server with retry logic.
           * A transient network failure here used to silently leave the flag as
           * `false`, which made the debrief page think calibration never happened.
           * We retry up to 2 times with a 1-second delay between attempts. */
          const patchCalibrated = async (retriesLeft = 2) => {
            try {
              const res = await fetch(`/api/rooms/${roomId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  gazeCalibrated: calibrated,
                  gazePlaneModel: planeModel,
                }),
              });
              if (!res.ok && retriesLeft > 0) {
                await new Promise((r) => setTimeout(r, 1000));
                return patchCalibrated(retriesLeft - 1);
              }
            } catch {
              if (retriesLeft > 0) {
                await new Promise((r) => setTimeout(r, 1000));
                return patchCalibrated(retriesLeft - 1);
              }
            }
          };
          patchCalibrated();

          emitTimelineEvent("gaze_calibration_complete", {
            quality: Math.round(avgError),
            retries: retryCount,
            low_accuracy: avgError >= 150,
            plane_quality: planeModel.quality.label,
          });

          setStage("done");
          setTimeout(() => onComplete({ calibrated, planeModel }), 800);
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
            {cameraStream ? (
              <video
                autoPlay
                playsInline
                muted
                ref={(el) => {
                  if (el && cameraStream) el.srcObject = cameraStream;
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
