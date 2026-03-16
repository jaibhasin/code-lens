declare module "webgazer" {
  interface GazePrediction {
    x: number;
    y: number;
  }

  interface WebGazer {
    begin(): Promise<WebGazer>;
    end(): Promise<void>;
    pause(): WebGazer;
    resume(): WebGazer;
    setRegression(type: string): WebGazer;
    setTracker(type: string): WebGazer;
    setGazeListener(
      listener: (data: GazePrediction | null, elapsedTime: number) => void
    ): WebGazer;
    getCurrentPrediction(): Promise<GazePrediction | null>;
    recordScreenPosition(x: number, y: number, eventType: string): void;
    showPredictionPoints(show: boolean): WebGazer;
    getVideoStream(): MediaStream | undefined;
    getTracker(): { getPositions?: () => unknown[] | false } | undefined;
    params: {
      showVideoPreview: boolean;
      showFaceOverlay: boolean;
      showFaceFeedbackBox: boolean;
    };
    saveDataAcrossSessions: boolean;
  }

  const webgazer: WebGazer;
  export default webgazer;
}
