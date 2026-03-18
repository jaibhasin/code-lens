# Fix Problem Display & Hidden Test Cases

## Status: in-progress

## Decisions
- Used a hand-rolled regex-based `htmlToMarkdown()` converter rather than pulling in a heavy library like `turndown` — LeetCode HTML is well-structured and predictable
- Comprehensive HTML entity decoding map covers common entities beyond the original 4 (`&le;`, `&ge;`, `&hellip;`, quotes, arrows, etc.) plus numeric/hex entities
- `react-markdown` + `remark-gfm` for rendering — safe (no `dangerouslySetInnerHTML`), supports GFM tables/strikethrough
- Custom component overrides in ReactMarkdown styled for the existing dark glass theme (zinc palette, emerald accents for inline code)
- AI rewrite prompt updated to produce Markdown output so rewritten problems also render properly

## Implemented this session
- **Part A complete**: Problem display now renders as formatted Markdown instead of a flat text blob
- Replaced `htmlToPlainText()` with `htmlToMarkdown()` in `app/api/import/leetcode/route.ts`
- Added `decodeEntities()` helper with comprehensive entity map
- Updated Claude rewrite prompt in `app/api/ai/rewrite-problem/route.ts` to output Markdown
- Replaced plain text div with `<ReactMarkdown>` in `app/room/[roomId]/page.tsx` with themed component overrides
- Installed `react-markdown` and `remark-gfm` dependencies

## Open questions
- Part B (hidden test cases from HuggingFace) still pending — separate task

## Rejected approaches
- None this session

## Problem

### 1. Problem Description Looks Bad
LeetCode problems display as a flat blob of plain text instead of the nicely formatted content you see on leetcode.com. Two causes:

- **Import strips formatting**: `htmlToPlainText()` in `app/api/import/leetcode/route.ts` (lines 25-41) converts LeetCode's rich HTML into plain text. It collapses ALL whitespace with `.replace(/\s+/g, " ")`, destroying paragraphs, lists, bold text, and structure.
- **Frontend can't render markdown**: `app/room/[roomId]/page.tsx` (line 779) renders the description as raw text inside a `whitespace-pre-wrap` div. No markdown parser, no HTML renderer — just plain text.

### 2. No Real Hidden Test Cases
LeetCode's public GraphQL API only returns `exampleTestcases` (the visible examples shown to users). It does NOT provide hidden test cases. The current code (`app/api/import/leetcode/route.ts`, lines 180-182) just copies the same example test cases as "hidden tests":

```js
const hiddenTests: HiddenTest[] = examples
  .filter((e) => e.input.trim() && e.output.trim())
  .map((e) => ({ input: e.input, expectedOutput: e.output }));
```

This means candidates are only tested against cases they can already see — no real validation of edge cases, boundary conditions, or performance.

---

## Plan

### Part A: Fix Problem Display

#### A1. Install dependencies
```bash
npm install react-markdown remark-gfm
```
- `react-markdown` — renders markdown as React components (safe, no `dangerouslySetInnerHTML`)
- `remark-gfm` — GitHub-Flavored Markdown support (tables, strikethrough, task lists)

#### A2. Replace `htmlToPlainText()` with `htmlToMarkdown()`
**File:** `app/api/import/leetcode/route.ts` (lines 25-41)

Instead of stripping all HTML, convert it to proper Markdown:
- `<strong>`, `<b>` → `**text**`
- `<em>`, `<i>` → `*text*`
- `<li>` → `- item` (with newlines)
- `<ul>`, `<ol>` → proper list formatting
- `<p>` → double newline between paragraphs
- `<br>` → single newline
- `<pre>` → triple-backtick code blocks (already partially done)
- `<code>` → backtick inline code (already partially done)
- `<sup>` → `^text` (for constraints like 10^4)
- Decode ALL HTML entities (current code only handles `&nbsp;`, `&lt;`, `&gt;`, `&amp;` — misses `&hellip;`, `&ldquo;`, `&le;`, `&ge;`, etc.)
- **Do NOT** collapse whitespace with `/\s+/g` — preserve line breaks

#### A3. Update AI rewrite prompt to output Markdown
**File:** `app/api/ai/rewrite-problem/route.ts` (line 94-119)

Add instructions to the Claude prompt to return the description in Markdown format:
- Bold for emphasis (`**Constraints:**`)
- Bullet lists for constraints
- Code formatting for variable names
- Proper paragraph breaks

#### A4. Render markdown in the room page
**File:** `app/room/[roomId]/page.tsx` (lines 779-781)

Replace:
```jsx
<div className="mt-2 text-sm text-zinc-300 whitespace-pre-wrap">
  {room.problem.description || "No description."}
</div>
```

With `<ReactMarkdown>` using custom component overrides styled for the dark glass theme:
- `h1-h4`: zinc-200, appropriate sizing
- `p`: zinc-300, relaxed leading
- `code` (inline): subtle bg with border
- `pre > code`: dark code block, rounded corners
- `ul/ol`: indented lists, zinc-400 bullets
- `strong`: zinc-100 (brighter for emphasis)

---

### Part B: Fetch Real Hidden Test Cases

#### Resource: HuggingFace LeetCodeDataset
**URL:** https://huggingface.co/datasets/newfacade/LeetCodeDataset

- 2,870 LeetCode problems with **100+ test cases each** (edge cases, stress tests)
- Apache 2.0 license (free to use)
- Keyed by LeetCode slug (e.g., `"two-sum"`) via the `task_id` field
- Test case format: `{ input: "nums = [2,7,11,15], target = 9", output: "[0, 1]" }`
- Accessible via HuggingFace's free `/rows` API — no scraping, no auth needed

**Other resources considered:**
- [akhilkammila/leetcode-testcase-extractor](https://github.com/akhilkammila/leetcode-testcase-extractor) — Selenium bot that fails one test at a time to extract cases. Only covers ~50 problems, gets rate-limited/banned. Not practical.
- Kaggle datasets — mostly problem descriptions and metadata, not comprehensive test suites.

#### B1. Fetch test cases from HuggingFace at import time
**File:** `app/api/import/leetcode/route.ts`

After importing the problem from LeetCode's GraphQL API:
1. Query HuggingFace datasets API with the LeetCode slug as `task_id`
   - API: `https://datasets-server.huggingface.co/search?dataset=newfacade/LeetCodeDataset&config=default&split=train&query=<slug>`
   - Or use the `/rows` endpoint and filter client-side
2. Extract the `input_output` array from the matching row
3. Convert to `HiddenTest[]` format: `{ input, expectedOutput }`
4. Exclude any that match the visible examples (so hidden tests are truly hidden)
5. Optionally limit to ~20-30 test cases to keep execution time reasonable

#### B2. Fallback for missing problems
If the slug isn't found in the HuggingFace dataset (newer problems released after July 2024):
- Fall back to current behavior (copy examples as hidden tests)
- Log a warning: `"[import] No hidden tests found in dataset for slug: ${slug}"`
- The interviewer can still manually add hidden tests via the setup page

---

## Files to Modify
1. ~~`package.json` — add `react-markdown`, `remark-gfm`~~ **DONE**
2. `app/api/import/leetcode/route.ts` — ~~`htmlToPlainText()` → `htmlToMarkdown()`~~ **DONE** + fetch hidden tests from HuggingFace (Part B)
3. ~~`app/api/ai/rewrite-problem/route.ts` — update Claude prompt to output markdown~~ **DONE**
4. ~~`app/room/[roomId]/page.tsx` — replace plain text render with `<ReactMarkdown>`~~ **DONE**

---

## Remaining Issues & Limitations

### Test Case Accuracy
- The HuggingFace dataset's test cases were generated/collected for Python problems. Input formats may not directly map to other languages (JavaScript, Java, C++, etc.). The `input` field uses Python-style syntax (e.g., `nums = [2,7,11,15]`), which would need parsing or reformatting for use as stdin input to Judge0.
- Need to investigate whether the `input` format matches what Judge0 expects as stdin, or if a translation layer is needed.

### Dataset Coverage Gap
- The dataset covers problems up to ~July 2024 (question_id up to ~3240). Any LeetCode problems released after that won't have hidden test cases. As of March 2026, there are ~3,500+ problems, so ~260+ problems would fall back to the example-only approach.

### Test Case Input Format Mismatch
- LeetCode's `exampleTestcases` gives raw values like `[2,7,11,15]\n9` (one value per line)
- The HuggingFace dataset gives `nums = [2,7,11,15], target = 9` (Python assignment style)
- These formats don't match. The hidden tests from HuggingFace may need to be reformatted to match what the candidate's code expects as stdin input via Judge0.

### No Expected Output Verification
- The HuggingFace dataset's `output` field contains the expected return value, but Judge0 compares **stdout** (what the program prints). The candidate's code needs to print the result, not just return it. This is already a design consideration in CodeLens but could cause mismatches if the HuggingFace output format differs from what the candidate's print statement produces.

### Rate Limiting
- The HuggingFace datasets API is free but may have rate limits for high-volume usage. If many interviewers import problems simultaneously, we might need to cache the dataset locally or add retry logic.

### ~~HTML Entity Decoding Gaps~~ RESOLVED
- Fixed: `htmlToMarkdown()` now includes a comprehensive entity map (`&le;`, `&ge;`, `&hellip;`, quotes, arrows, etc.) plus numeric (`&#NNN;`) and hex (`&#xHH;`) entity decoding.

### Manual Setup Unaffected
- Problems added via the manual setup flow (`/room/{id}/setup/manual`) won't benefit from HuggingFace test cases since there's no LeetCode slug to look up. Interviewers using manual setup still need to write their own test cases.
