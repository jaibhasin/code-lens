import { NextRequest, NextResponse } from "next/server";
import {
  runSubmission,
  mapJudge0StatusToResult,
  type Judge0SubmissionResponse,
} from "@/lib/judge0";
import { getRoom, updateRoom } from "@/lib/store";
import type { Language, TestResult } from "@/lib/store";

interface RunRequestBody {
  code: string;
  language: Language;
  testCases: { input: string; expectedOutput: string }[];
  roomId?: string;
  isSubmit?: boolean;
}

function normalizeOutput(s: string | null): string {
  if (s == null) return "";
  return s.trimEnd();
}

export async function POST(req: NextRequest) {
  let body: RunRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { code, language, testCases, roomId, isSubmit } = body;
  if (!code || !language || !Array.isArray(testCases)) {
    return NextResponse.json(
      { error: "Missing code, language, or testCases" },
      { status: 400 }
    );
  }

  const results: TestResult[] = [];

  for (const tc of testCases) {
    const input = tc.input ?? "";
    let res: Judge0SubmissionResponse;
    try {
      res = await runSubmission(code, language, input);
    } catch (err) {
      results.push({
        input,
        expectedOutput: tc.expectedOutput ?? "",
        actualOutput: (err as Error).message,
        status: "runtime_error",
      });
      continue;
    }

    const statusId = res.status?.id ?? 0;
    const status = mapJudge0StatusToResult(statusId);
    const actualOutput =
      status === "passed" || status === "failed"
        ? normalizeOutput(res.stdout)
        : res.stderr || res.message || res.compile_output || res.stdout || "";

    results.push({
      input,
      expectedOutput: (tc.expectedOutput ?? "").trimEnd(),
      actualOutput: typeof actualOutput === "string" ? actualOutput.trimEnd() : String(actualOutput),
      status,
    });
  }

  if (roomId) {
    const room = getRoom(roomId);
    if (room) {
      updateRoom(roomId, (r) => {
        r.runs.push({
          timestamp: new Date().toISOString(),
          code,
          language,
          testResults: results,
        });
      });
    }
  }

  return NextResponse.json({ results });
}
