## Status: done

## Decisions

- **CSS-only animations** — No JS animation libraries (Framer Motion, GSAP) used. All keyframes defined in `globals.css` to keep bundle lean and avoid layout thrashing.
- **Max 2 backdrop-blur layers per view** — Header + overlay/modal only. Avoids GPU compositing overload on low-end machines. Editor surface has no blur.
- **CSS custom properties for glass values** — `--glass-bg`, `--glass-border`, `--glass-blur`, `--glass-shadow`, and glow color vars (`--glow-amber`, etc.) defined in `:root` so they're easy to tune globally without hunting through component files.
- **`@layer utilities` for glass classes** — `.glass`, `.glass-input`, `.glass-card`, `.text-gradient`, `.glow-*`, `.animate-*` all live in Tailwind's utility layer so they compose cleanly with Tailwind modifiers.
- **`overflow-hidden` on glass panels** — Required for proper GPU compositing; prevents content from bleeding through the backdrop-blur boundary.
- **Body background via `@layer base`** — Two radial gradient overlays (faint violet top-right + faint amber bottom-left) baked into the body so every page gets ambient depth without any wrapper component.
- **Geist font** — Switched from no explicit font to Geist via `next/font/google`. Font variable applied to `<html>`, class applied to `<body>`. Clean, modern sans that fits the glassmorphism aesthetic.
- **No database/state changes** — Purely visual. All API routes, room state, Yjs sync, and logic untouched.
- **Staggered animation delays via inline `style`** — Tailwind's `animation-delay` utilities aren't built-in, so `style={{ animationDelay: "Xms" }}` used on debrief cards and AI picker cards for staggered entrance without a JS library.

## Implemented this session

### `app/globals.css`
- Replaced single `@import "tailwindcss"` with full design system
- CSS custom properties for glass opacity, border, blur, shadow, and 5 glow colors
- `@layer base`: body dark bg `#09090b` + two radial gradient overlays (fixed attachment)
- Custom scrollbar: 6px width, semi-transparent thumb, rounded
- Keyframes: `fade-in-up`, `glow-pulse`, `shimmer`, `float`
- `@layer utilities`: `.glass`, `.glass-input`, `.glass-card`, `.text-gradient`, `.glow-amber/emerald/blue/violet/red`, `.animate-fade-in-up/glow-pulse/shimmer/float`

### `app/layout.tsx`
- Added Geist font import from `next/font/google`
- Applied `geist.variable` to `<html>`, `geist.className` + dark base classes to `<body>`

### `app/page.tsx`
- Removed `bg-zinc-950` (body handles it)
- Added dot-grid background overlay via radial-gradient
- Added floating amber-violet glow orb (animated with `animate-float`)
- Title: `text-5xl font-bold text-gradient`
- CTA button: amber glow shadow, hover intensifies + `scale-[1.02]`
- Content wrapped in `animate-fade-in-up`

### `app/room/[roomId]/setup/page.tsx`
- Removed `bg-zinc-950`
- Company input: `.glass-input` with amber focus glow
- Path cards: `.glass-card` with per-card accent glow on hover
  - LeetCode: `shadow-[0_0_30px_rgba(245,158,11,0.15)]` amber
  - Manual: `shadow-[0_0_30px_rgba(255,255,255,0.05)]` subtle white
  - AI: `shadow-[0_0_30px_rgba(139,92,246,0.15)]` violet
- CTA buttons: backdrop-blur + matching accent glow
- Added `animate-fade-in-up` on main

### `app/room/[roomId]/setup/manual/page.tsx`
- Removed `bg-zinc-950`
- Added `animate-fade-in-up`
- Glass container wrapping entire form
- All inputs/textareas/selects: `.glass-input`
- Example/test groups: `bg-white/[0.03] border-white/[0.08]` nested panels
- Save button: amber glow shadow
- Back link: `transition-colors duration-300`

### `app/room/[roomId]/setup/leetcode/page.tsx`
- Removed `bg-zinc-950`
- Added `animate-fade-in-up`
- Import card: `.glass` with `border-amber-500/20` accent
- Fetch button: amber glow shadow
- Success banner: `.glass border-emerald-500/30` + emerald glow shadow
- Edit form wrapped in `.glass` container with `animate-fade-in-up`
- All editable fields: `.glass-input`

### `app/room/[roomId]/setup/ai/page.tsx`
- Removed `bg-zinc-950`
- **form state**: glass container, violet CTA with glow shadow
- **picking state**: spinner with pulsing amber glow aura div behind it
- **cards state**: `.glass-card` per pick card, violet hover glow, staggered delay (0/100/200ms), difficulty badges with color-matched glow, topic chips `bg-white/[0.05]`
- **rewriting state**: spinner with pulsing violet glow aura
- Error panels: `.glass border-red-500/30`

### `app/room/[roomId]/page.tsx`
- Header: `bg-white/[0.03] backdrop-blur-xl border-b border-white/[0.06]`
- All header buttons updated with accent glows:
  - Copy invite: `bg-white/[0.06]` glass style
  - Re-enter fullscreen: amber `shadow-[0_0_10px_rgba(245,158,11,0.15)]`
  - Language select: `.glass-input`
  - Run: emerald glow `shadow-[0_0_15px_rgba(16,185,129,0.25)]`
  - Submit: blue glow `shadow-[0_0_15px_rgba(59,130,246,0.25)]`
  - Start session: amber glow `shadow-[0_0_20px_rgba(245,158,11,0.3)]`
  - End session: red glow `shadow-[0_0_15px_rgba(239,68,68,0.25)]`
- Presence dots: neon active glow `shadow-[0_0_6px_rgba(COLOR,0.6)]`
- Editor and Problem panels: `.glass rounded-xl overflow-hidden`
- Panel headers: `bg-white/[0.02] border-b border-white/[0.06]`
- Waiting overlay: `bg-black/60 backdrop-blur-md`, Start Session button with large amber glow
- Name gate: `.glass` card with amber glow button
- Examples: `bg-white/[0.03] border border-white/[0.06]`
- Test results table: `border-white/[0.06]` and `border-white/[0.04]` rows
- Fullscreen warning: `.glass border-red-500/40 shadow-[0_0_40px_rgba(239,68,68,0.15)]`, warning icon with `animate-glow-pulse`, CTA with red glow

### `app/room/[roomId]/debrief/page.tsx`
- All section cards: `bg-zinc-900/60 border-zinc-800` → `.glass`
- Staggered entrance: each card gets `animate-fade-in-up` + incremental `animationDelay` (100ms steps)
- `ScoreBar`: track `bg-white/[0.06]`, fill bar gets matching glow shadow per color
- `ScoreDot`: filled dots `shadow-[0_0_6px_rgba(245,158,11,0.5)]`, empty dots `bg-white/[0.08]`
- `HireSignalBadge`: matching color glow shadow per verdict
- Integrity flags: `bg-red-500/[0.06] border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.08)]`
- Loading state: `.glass` wrapper, spinner with amber glow aura
- Removed `eslint-disable @typescript-eslint/no-non-null-assertion` by using `room as Room` cast

## Open questions

- **`select` dropdown option backgrounds** — Native `<option>` elements don't inherit `.glass-input` styles on macOS/Windows (OS renders them). Could replace with custom dropdowns (Radix Select) for full design consistency. Deferred as low priority.
- **Monaco editor theme** — The editor itself is untouched. A custom dark Monaco theme with glass-matching colors (e.g. transparent editor background) would complete the aesthetic. Requires `monaco-editor/esm/vs/editor/editor.api` theme registration.
- **Mobile responsive check** — Cards tested to stack via Tailwind grid defaults, but no physical device test done. The `glass-card hover:scale-[1.01]` may need `@media (hover: none)` suppression for touch devices.
- **`shimmer` animation** — Defined in keyframes but not yet used on any specific element. Could be applied to loading skeleton states if those are added.

## Rejected approaches

- **Framer Motion for animations** — Would give more control over stagger and spring physics, but adds ~120KB to the bundle. CSS-only approach chosen to keep it lean.
- **Tailwind `backdrop-blur-*` class on `.glass-card`** — Tailwind's `backdrop-blur-xl` class was considered for composability, but `.glass-card` as a custom utility class was cleaner since it bundles bg + border + shadow + blur + radius + transition into one token.
- **`animation-delay` Tailwind plugin** — Could have added a plugin for `delay-100`, `delay-200`, etc., but inline `style` is simpler and avoids plugin boilerplate for a handful of elements.
- **Putting glow orbs on every page** — Considered adding the floating glow orb (from home page) to the setup and room pages too. Rejected because room page is a dense UI and the orb would create visual noise; home page is the only sparse-enough canvas for it.
