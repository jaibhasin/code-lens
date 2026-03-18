import { NextRequest, NextResponse } from "next/server";
import type { Problem, ProblemExample, HiddenTest } from "@/lib/store";

const LEETCODE_GRAPHQL = "https://leetcode.com/graphql";

const QUESTION_QUERY = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      title
      content
      difficulty
      exampleTestcases
      metaData
    }
  }
`;

function extractSlugFromUrl(url: string): string | null {
  const trimmed = url.trim();
  // Match leetcode.com/problems/<slug>/ or /problems/<slug>
  const m = trimmed.match(/leetcode\.com\/problems\/([^/?]+)/i);
  return m ? m[1] : null;
}

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"',
  "&apos;": "'", "&le;": "≤", "&ge;": "≥", "&ne;": "≠", "&hellip;": "…",
  "&ldquo;": "\u201C", "&rdquo;": "\u201D", "&lsquo;": "\u2018", "&rsquo;": "\u2019",
  "&mdash;": "—", "&ndash;": "–", "&times;": "×", "&divide;": "÷",
  "&infin;": "∞", "&larr;": "←", "&rarr;": "→", "&lArr;": "⇐", "&rArr;": "⇒",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&[a-zA-Z]+;/g, (ent) => HTML_ENTITIES[ent] ?? ent)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function htmlToMarkdown(html: string): string {
  if (!html) return "";

  let md = html;

  // Pre blocks → fenced code blocks (handle before stripping other tags)
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    const code = inner.replace(/<[^>]+>/g, "");
    return "\n```\n" + decodeEntities(code).trim() + "\n```\n";
  });

  // Inline code (outside pre blocks)
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, (_, inner) => {
    return "`" + decodeEntities(inner.replace(/<[^>]+>/g, "")) + "`";
  });

  // Superscripts → caret notation (e.g. 10<sup>4</sup> → 10^4)
  md = md.replace(/<sup>([\s\S]*?)<\/sup>/gi, (_, inner) => "^" + inner.replace(/<[^>]+>/g, ""));

  // Bold
  md = md.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_, __, inner) => "**" + inner + "**");

  // Italic
  md = md.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (_, __, inner) => "*" + inner + "*");

  // Unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    return "\n" + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, li: string) => {
      return "- " + li.replace(/<[^>]+>/g, "").trim() + "\n";
    }).trim() + "\n";
  });

  // Ordered lists
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    let idx = 0;
    return "\n" + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, li: string) => {
      idx++;
      return idx + ". " + li.replace(/<[^>]+>/g, "").trim() + "\n";
    }).trim() + "\n";
  });

  // Paragraphs → double newline
  md = md.replace(/<p[^>]*>/gi, "\n\n");
  md = md.replace(/<\/p>/gi, "");

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Strip any remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = decodeEntities(md);

  // Normalize excessive blank lines (3+ → 2)
  md = md.replace(/\n{3,}/g, "\n\n");

  return md.trim();
}

function parseExampleTestcases(
  exampleTestcases: string,
  metaDataJson: string | null
): ProblemExample[] {
  const lines = exampleTestcases.split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  let numInputs = 1;
  if (metaDataJson) {
    try {
      const meta = JSON.parse(metaDataJson) as { params?: unknown[] };
      if (Array.isArray(meta.params) && meta.params.length > 0) {
        numInputs = meta.params.length;
      }
    } catch {
      // ignore
    }
  }

  // LeetCode exampleTestcases is typically inputs only (no expected output in the string).
  // Group by numInputs per test; output left empty — user can add from problem description.
  const examples: ProblemExample[] = [];
  for (let i = 0; i + numInputs <= lines.length; i += numInputs) {
    const inputLines = lines.slice(i, i + numInputs);
    examples.push({
      input: inputLines.join("\n"),
      output: "",
    });
  }

  if (examples.length === 0 && lines.length >= 2) {
    for (let i = 0; i + 1 < lines.length; i += 2) {
      examples.push({ input: lines[i] ?? "", output: lines[i + 1] ?? "" });
    }
  }

  return examples;
}

/** Parse problem content HTML for "Output:" and "Explanation:" to fill example outputs. */
function parseOutputsAndExplanationsFromContent(content: string): {
  outputs: string[];
  explanations: string[];
} {
  const outputs: string[] = [];
  const explanations: string[] = [];
  if (!content) return { outputs, explanations };
  // LeetCode format: <strong>Output:</strong> 2 or <strong>Explanation:</strong> The square root...
  const outputRegex = /Output:\s*<\/[^>]+>\s*([^\n<]*)/gi;
  const explanationRegex = /Explanation:\s*<\/[^>]+>\s*([^\n<]*)/gi;
  let m;
  while ((m = outputRegex.exec(content)) !== null) {
    const val = m[1].replace(/&nbsp;/g, " ").trim();
    if (val) outputs.push(val);
  }
  while ((m = explanationRegex.exec(content)) !== null) {
    const val = m[1].replace(/&nbsp;/g, " ").trim();
    if (val) explanations.push(val);
  }
  return { outputs, explanations };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const urlOrSlug = (body.url ?? body.slug ?? "").trim();
    if (!urlOrSlug) {
      return NextResponse.json(
        { error: "Missing url or slug" },
        { status: 400 }
      );
    }

    const slug = urlOrSlug.includes("leetcode.com")
      ? extractSlugFromUrl(urlOrSlug)
      : urlOrSlug;

    if (!slug) {
      return NextResponse.json(
        { error: "Invalid LeetCode URL or slug" },
        { status: 400 }
      );
    }

    const res = await fetch(LEETCODE_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      body: JSON.stringify({
        operationName: "questionData",
        variables: { titleSlug: slug },
        query: QUESTION_QUERY,
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `LeetCode returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      data?: { question?: { title?: string; content?: string; difficulty?: string; exampleTestcases?: string; metaData?: string } };
      errors?: unknown[];
    };

    if (data.errors?.length) {
      return NextResponse.json(
        { error: "Problem not found or not accessible" },
        { status: 404 }
      );
    }

    const q = data.data?.question;
    if (!q?.title) {
      return NextResponse.json(
        { error: "Problem not found" },
        { status: 404 }
      );
    }

    const examples = parseExampleTestcases(
      q.exampleTestcases ?? "",
      q.metaData ?? null
    );

    const { outputs: parsedOutputs, explanations: parsedExplanations } =
      parseOutputsAndExplanationsFromContent(q.content ?? "");
    for (let i = 0; i < examples.length; i++) {
      if (parsedOutputs[i] !== undefined) examples[i].output = parsedOutputs[i];
      if (parsedExplanations[i] !== undefined) examples[i].explanation = parsedExplanations[i];
    }

    const hiddenTests: HiddenTest[] = examples
      .filter((e) => e.input.trim() && e.output.trim())
      .map((e) => ({ input: e.input, expectedOutput: e.output }));

    const difficulty = q.difficulty as "Easy" | "Medium" | "Hard" | undefined;

    const problem: Problem = {
      title: q.title,
      description: q.content ? htmlToMarkdown(q.content) : "",
      examples,
      hiddenTests,
      ...(difficulty ? { difficulty } : {}),
    };

    // #region agent log
    console.log(`[DEBUG-74ad34] import/leetcode: title="${problem.title}" hasContent=${!!q.content} contentLen=${q.content?.length} descLen=${problem.description.length} descFirst100="${problem.description.substring(0,100)}"`);
    // #endregion

    return NextResponse.json(problem);
  } catch (err) {
    console.error("LeetCode import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
