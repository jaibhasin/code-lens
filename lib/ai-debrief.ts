import type { Room } from "./store";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function buildPrompt(room: Room): string {
  const durationMs = room.endedAt && room.startedAt ? room.endedAt - room.startedAt : 0;
  const durationMin = Math.round(durationMs / 60000);

  return `You are an expert technical interviewer. Analyze this coding session and produce a structured candidate evaluation.

## Problem
**Title:** ${room.problem.title}
**Description:** ${room.problem.description}

**Examples:** ${JSON.stringify(room.problem.examples, null, 2)}

## Session data
- **Duration:** ${durationMin} minutes
- **Language:** ${room.language}
- **Timeline events:** ${JSON.stringify(room.timeline.slice(-50), null, 2)}

## Final code
\`\`\`
${room.code}
\`\`\`

## Run history (last 20 runs)
${JSON.stringify(room.runs.slice(-20), null, 2)}

---

Produce a JSON object with these exact keys (all strings; use markdown where helpful):

1. **approach_analysis** — How did they start? Edge cases? Brute force vs optimal?
2. **problem_solving_behavior** — Where did they get stuck? How many runs before submit? Iteration on failures? Language switches?
3. **code_quality** — Naming, structure, edge cases, complexity awareness.
4. **time_breakdown** — Time on reading, planning, coding, debugging (estimate from timeline).
5. **final_signal** — One of: "Strong", "Mixed", "Weak". Then one paragraph reasoning.
6. **summary** — 2–3 sentence overall summary.

Return only valid JSON, no surrounding text.`;
}

export async function generateDebrief(room: Room): Promise<Record<string, unknown>> {
  if (!OPENAI_API_KEY) {
    return {
      approach_analysis: "Set OPENAI_API_KEY in .env to generate debriefs.",
      problem_solving_behavior: "",
      code_quality: "",
      time_breakdown: "",
      final_signal: "Mixed",
      summary: "Debrief skipped (no OpenAI API key).",
    };
  }

  const prompt = buildPrompt(room);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty OpenAI response");

  const raw = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  return JSON.parse(raw) as Record<string, unknown>;
}
