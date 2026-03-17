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

  const { code, language, testCases, roomId } = body;
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
    // Map non-output statuses first (compile error, TLE, runtime error).
    // For anything that produced stdout we compare ourselves — Judge0's
    // built-in accepted/wrong-answer is only reliable when expected_output
    // is sent in the submission, which we intentionally omit so we always
    // get the raw stdout back and can show it in the UI.
    const engineStatus = mapJudge0StatusToResult(statusId);

    let status: TestResult["status"];
    let actualOutput: string;

    if (engineStatus === "compilation_error" || engineStatus === "TLE" || engineStatus === "runtime_error") {
      // Non-output statuses — surface the error message.
      status = engineStatus;
      actualOutput = res.stderr || res.compile_output || res.message || "";
    } else {
      // Code ran to completion — compare stdout against expected output.
      actualOutput = normalizeOutput(res.stdout);
      const expected = (tc.expectedOutput ?? "").trimEnd();
      status = actualOutput === expected ? "passed" : "failed";
    }

    results.push({
      input,
      expectedOutput: (tc.expectedOutput ?? "").trimEnd(),
      actualOutput: actualOutput.trimEnd(),
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
