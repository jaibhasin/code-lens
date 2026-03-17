import type { Language } from "./store";

const JUDGE0_BASE = process.env.JUDGE0_BASE_URL || "https://ce.judge0.com";
const JUDGE0_AUTH = process.env.JUDGE0_AUTH_TOKEN;

/**
 * Judge0 language IDs for each supported language.
 * Full list: https://ce.judge0.com/languages
 *
 *  50  → C (GCC 9.2.0)
 *  54  → C++ (GCC 9.2.0)
 *  62  → Java (OpenJDK 13.0.1)
 *  63  → JavaScript (Node.js 12.14.0)
 *  71  → Python (3.8.1)
 *  74  → TypeScript (3.7.4)
 *  95  → Go (1.13.5)
 */
const LANGUAGE_IDS: Record<Language, number> = {
  c: 50,
  cpp: 54,
  java: 62,
  javascript: 63,
  python: 71,
  typescript: 74,
  go: 95,
};

export interface Judge0SubmissionRequest {
  source_code: string;
  language_id: number;
  stdin?: string;
  expected_output?: string;
  cpu_time_limit?: number;
  memory_limit?: number;
}

export interface Judge0SubmissionResponse {
  token?: string;
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  status: { id: number; description: string };
  time: string | null;
  memory: number | null;
}

const STATUS_IDS = {
  accepted: 3,
  wrongAnswer: 4,
  compilationError: 6,
  timeLimitExceeded: 5,
  runtimeErrorSIGSEGV: 7,
  runtimeErrorSIGXFSZ: 8,
  runtimeErrorSIGFPE: 9,
  runtimeErrorSIGABRT: 10,
  runtimeErrorNZEC: 11,
  runtimeErrorOther: 12,
} as const;

export function getLanguageId(lang: Language): number {
  return LANGUAGE_IDS[lang];
}

export async function runSubmission(
  code: string,
  language: Language,
  stdin: string
): Promise<Judge0SubmissionResponse> {
  const language_id = getLanguageId(language);
  const body = {
    source_code: code,
    language_id,
    stdin: stdin || undefined,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (JUDGE0_AUTH) {
    headers["X-Auth-Token"] = JUDGE0_AUTH;
  }

  const res = await fetch(`${JUDGE0_BASE}/submissions?base64_encoded=false&wait=true`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Judge0 error ${res.status}: ${text}`);
  }

  return res.json() as Promise<Judge0SubmissionResponse>;
}

export function mapJudge0StatusToResult(
  statusId: number
): "passed" | "failed" | "TLE" | "runtime_error" | "compilation_error" {
  if (statusId === STATUS_IDS.accepted) return "passed";
  if (statusId === STATUS_IDS.compilationError) return "compilation_error";
  if (statusId >= STATUS_IDS.runtimeErrorSIGSEGV && statusId <= STATUS_IDS.runtimeErrorOther) return "runtime_error";
  if (statusId === STATUS_IDS.timeLimitExceeded) return "TLE";
  return "failed";
}
