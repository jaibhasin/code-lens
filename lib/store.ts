export type Language = "c" | "cpp" | "python" | "javascript" | "java" | "go" | "typescript";

export interface ProblemExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface HiddenTest {
  input: string;
  expectedOutput: string;
}

export type ProblemDifficulty = "Easy" | "Medium" | "Hard";

export interface Problem {
  title: string;
  description: string;
  examples: ProblemExample[];
  hiddenTests: HiddenTest[];
  difficulty?: ProblemDifficulty;
}

export type ParticipantRole = "interviewer" | "candidate";

export interface Participant {
  socketId: string;
  role: ParticipantRole;
  joinedAt: number;
}

export interface CodeSnapshot {
  timestamp: string;
  code: string;
  charCount: number;
  lineCount: number;
}

// All possible timeline event types tracked during an interview session.
// Each maps to a specific candidate behavior detected by the room page.
// "fullscreen_exit" is an integrity signal — candidate left fullscreen mode
// (similar to tab_blur: indicates they may have accessed external resources).
export type TimelineEventType =
  | "keystroke"
  | "run"
  | "submit"
  | "pause"
  | "language_change"
  | "paste"
  | "tab_blur"
  | "tab_focus"
  | "fullscreen_exit"
  | "gaze_calibration_complete"
  | "gaze_calibration_skipped"
  | "gaze_off_screen_streak";

export type GazeZone =
  | "on_screen"
  | "off_left"
  | "off_right"
  | "off_top"
  | "off_bottom"
  | "unknown";

export interface GazeSample {
  ts: number;
  x: number;
  y: number;
  zone: GazeZone;
  conf: number;
}

export interface TimelineEvent {
  timestamp: string;
  event: TimelineEventType;
  data: Record<string, unknown>;
}

export type TestStatus =
  | "passed"
  | "failed"
  | "TLE"
  | "runtime_error"
  | "compilation_error";

export interface TestResult {
  input: string;
  expectedOutput: string;
  actualOutput: string;
  status: TestStatus;
}

export interface RunRecord {
  timestamp: string;
  code: string;
  language: string;
  testResults: TestResult[];
}

export type RoomStatus = "waiting" | "active" | "ended";

export interface Room {
  roomId: string;
  problem: Problem;
  language: Language;
  participants: Participant[];
  timeline: TimelineEvent[];
  code: string;
  runs: RunRecord[];
  snapshots: CodeSnapshot[];
  status: RoomStatus;
  startedAt: number | null;
  endedAt: number | null;
  debrief: Record<string, unknown> | null;
  /** Company name entered by the interviewer on the setup page. */
  interviewerCompany: string;
  /** Candidate's name, entered when they land on the room page. */
  candidateName: string;
  gazeCalibrated: boolean;
  gazeSamples: GazeSample[];
}

const rooms = new Map<string, Room>();

function defaultProblem(): Problem {
  return {
    title: "",
    description: "",
    examples: [],
    hiddenTests: [],
  };
}

export function createRoom(roomId: string): Room {
  const room: Room = {
    roomId,
    problem: defaultProblem(),
    language: "python",
    participants: [],
    timeline: [],
    code: "",
    runs: [],
    snapshots: [],
    status: "waiting",
    startedAt: null,
    endedAt: null,
    debrief: null,
    interviewerCompany: "",
    candidateName: "",
    gazeCalibrated: false,
    gazeSamples: [],
  };
  rooms.set(roomId, room);
  return room;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function updateRoom(
  roomId: string,
  updater: (room: Room) => void
): Room | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  updater(room);
  return room;
}

export function deleteRoom(roomId: string): boolean {
  return rooms.delete(roomId);
}

export { rooms };
