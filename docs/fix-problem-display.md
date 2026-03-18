# Fix Problem Display (Markdown Rendering)

## Status: done

## Decisions
- Used a hand-rolled regex-based `htmlToMarkdown()` converter instead of a library like `turndown` — LeetCode's HTML is well-structured with consistent tag patterns (`<p>`, `<strong>`, `<ul>/<li>`, `<pre>`, `<code>`, `<sup>`), so a purpose-built function is simpler and avoids an extra dependency
- Built a comprehensive `HTML_ENTITIES` map (25+ named entities) plus numeric (`&#NNN;`) and hex (`&#xHH;`) decoding, rather than the previous 4-entity approach — LeetCode uses `&le;`, `&ge;`, `&hellip;`, smart quotes, arrows, etc. extensively in constraint descriptions
- Chose `react-markdown` + `remark-gfm` for frontend rendering — safe (no `dangerouslySetInnerHTML`), supports GFM tables/strikethrough, and works as a standard React component in the existing `"use client"` page
- Styled ReactMarkdown with custom component overrides matching the existing dark glassmorphism theme (zinc palette, emerald accents for inline code) rather than importing a separate prose/typography stylesheet
- Updated the AI rewrite prompt to explicitly request Markdown output so Claude-rewritten problems also render properly through the same pipeline

## Implemented this session

### `app/api/import/leetcode/route.ts`
- Deleted `htmlToPlainText()` (lines 25-41) — was stripping all HTML and collapsing whitespace with `/\s+/g`
- Added `HTML_ENTITIES` map with 25+ named HTML entities
- Added `decodeEntities()` helper that handles named, numeric, and hex entities
- Added `htmlToMarkdown()` that converts LeetCode HTML to Markdown:
  - `<pre>` → fenced code blocks (processed first to protect contents)
  - `<code>` → backtick inline code
  - `<sup>` → caret notation (e.g. `10^4`)
  - `<strong>`/`<b>` → `**bold**`
  - `<em>`/`<i>` → `*italic*`
  - `<ul>/<li>` → `- ` bullet lists
  - `<ol>/<li>` → `1. ` numbered lists
  - `<p>` → double newline paragraph breaks
  - `<br>` → single newline
  - Remaining tags stripped, entities decoded, excessive blank lines normalized
- Updated call site: `htmlToPlainText(q.content)` → `htmlToMarkdown(q.content)`

### `app/api/ai/rewrite-problem/route.ts`
- Added instruction #6 to Claude rewrite prompt: format output in Markdown (bold section headers, bullet lists for constraints, backtick code formatting, paragraph breaks, `^n` for superscripts)

### `app/room/[roomId]/page.tsx`
- Added imports: `react-markdown`, `remark-gfm`
- Replaced plain text `<div className="whitespace-pre-wrap">` with `<ReactMarkdown>` using `remarkGfm` plugin
- Custom component overrides for dark glass theme:
  - `p`: `text-zinc-300 leading-relaxed mb-3`
  - `strong`: `text-zinc-100 font-semibold`
  - `em`: `text-zinc-200 italic`
  - `h1-h3`: `text-zinc-200` with graduated sizing
  - `ul/ol`: `list-disc/list-decimal list-inside text-zinc-400`
  - `li`: `text-zinc-300`
  - `code` (inline): `bg-white/[0.06] border border-white/[0.08] text-emerald-300`
  - `code` (block): `bg-black/30 rounded-lg p-3 text-zinc-200`
  - `pre`: simple wrapper with `mb-3`

### `package.json`
- Added `react-markdown` and `remark-gfm` dependencies

## Open questions
- The `htmlToMarkdown()` regex approach handles LeetCode's known HTML patterns well, but deeply nested or malformed HTML could produce odd output — hasn't been an issue with real LeetCode content tested so far
- Part B of the original feature file (fetching real hidden test cases from HuggingFace) is still pending as a separate task — tracked in `future_improvements/problem-display-and-hidden-tests.md`

## Rejected approaches
- **`turndown` library**: Considered using the `turndown` npm package for HTML→Markdown conversion, but LeetCode HTML is predictable enough that a custom function avoids the extra dependency (~30KB) and gives us precise control over output formatting (e.g. `<sup>` → `^n` caret notation isn't a standard Markdown convention)
- **`dangerouslySetInnerHTML`**: Could have rendered the original LeetCode HTML directly in the browser, but this is an XSS risk and wouldn't work for AI-rewritten descriptions (which come back as plain text/Markdown, not HTML)
- **Tailwind Typography plugin (`@tailwindcss/typography`)**: Could have used `prose` classes instead of custom component overrides, but the dark glassmorphism theme needs very specific zinc/emerald color values that don't match any default prose theme
