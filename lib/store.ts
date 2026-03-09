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

export interface Problem {
  title: string;
  description: string;
  examples: ProblemExample[];
  hiddenTests: HiddenTest[];
}

export type ParticipantRole = "interviewer" | "candidate";

export interface Participant {
  socketId: string;
  role: ParticipantRole;
  joinedAt: number;
}

export type TimelineEventType =
  | "keystroke"
  | "deletion"
  | "run"
  | "submit"
  | "pause"
  | "language_change";

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
  status: RoomStatus;
  startedAt: number | null;
  endedAt: number | null;
  debrief: Record<string, unknown> | null;
  /** Company name entered by the interviewer on the setup page. */
  interviewerCompany: string;
  /** Candidate's name, entered when they land on the room page. */
  candidateName: string;
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
    status: "waiting",
    startedAt: null,
    endedAt: null,
    debrief: null,
    interviewerCompany: "",
    candidateName: "",
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
