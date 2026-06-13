# UI Perfectionist scan — shared reviewer reference (2026-06-13)

You are auditing **personas**, a Tauri + Next.js desktop app with a *mature* design
system. Your job is NOT to invent new visual patterns — it is to find where the UI
**deviates from the system that already exists**, and where readability / hierarchy /
polish fall short of a world-class product. Judge every finding against the system below.

## The design system (read before judging)

- **199 shared components** catalogued at `src/features/shared/components/CATALOG.md`,
  imported as `@/features/shared/components/<category>/<Name>`. The rule the codebase
  enforces: **import what exists; never hand-roll** a spinner, empty state, button,
  modal, tooltip, badge, table, copy-button, relative-time, number-format, toggle,
  select, form field, status badge/dot, section card/header, skeleton, etc.
- **Reuse migration backlog**: `docs/refactor/shared-component-reuse.md` ("use X instead
  of hand-rolling Y").
- **Design tokens** (`src/lib/design/`): `statusTokens.ts` (success/warning/error/info →
  text/bg/border/ring/icon classes — the single source of truth for status color),
  `listTokens.ts` (`ROW_SEPARATOR` = `border-primary/[0.06]` for all row separators),
  `eventTokens.ts`, `statusTokens`. Raw `text-emerald-400` / `bg-red-500/10` / ad-hoc
  separator borders that duplicate a token are deviations.
- **Theming**: colors come from CSS custom props (`primary`, `--focus-ring-*`, etc.) via
  `themeStore.ts` + `src/styles/globals.css`. Hard-coded hex / non-theme Tailwind colors
  that should be `primary`/semantic tokens break theme + dark/light parity.
- **globals.css utilities**: `focus-ring`, `is-disabled`, `app-safe-area`, coarse-pointer
  44px tap floor, reveal-on-hover→visible-on-touch. Interactive elements must use these
  rather than re-implementing focus/disabled/hover.
- **Typography**: `src/styles/typography.css` defines the type ramp. Ad-hoc `text-[13px]`
  / inconsistent weights that fight the ramp are findings.

## What to look for (priority order for THIS codebase)

1. **Hand-rolled UI that a catalog component already covers** — raw `<button>` instead of
   `Button`, custom spinner instead of `LoadingSpinner`, bespoke empty/error blocks instead
   of `EmptyState`/`ErrorBanner`, hand-built `<table>` instead of `UnifiedTable`, raw
   `<select>` instead of `Listbox`/`ThemedSelect`, `new Date().toLocaleString()` instead of
   `RelativeTime`/`AbsoluteTime`, `toFixed`/`toLocaleString` instead of `Numeric`. This is
   the #1 theme — cite the exact catalog component to use.
2. **Token deviations** — raw status colors instead of `statusTokens`; ad-hoc row borders
   instead of `ROW_SEPARATOR`; hard-coded colors that should be themed.
3. **Visual hierarchy & readability** — competing font sizes/weights, weak/again-and-again
   spacing, low-contrast text, dense unscannable rows, missing section structure
   (`SectionCard`/`SectionHeader`/`SectionLabel`).
4. **State coverage** — missing loading (`LoadingSpinner`/`ListSkeleton`/`TableSkeleton`),
   empty (`EmptyState`), and error (`ErrorBanner`) states on async surfaces.
5. **Polish** — missing hover/focus-visible states, abrupt (no) transitions, inconsistent
   icon sizing/alignment, inconsistent rounding/shadow vs the rest of the app.
6. **Accessibility-as-quality** — interactive elements without `focus-ring`/aria, icon-only
   buttons without labels, `title=` where `Tooltip` belongs.

## Hard rules

- **Don't** propose purely cosmetic changes with no UX/readability benefit.
- **Don't** propose a new component when a catalog one exists — propose adopting it.
- **Don't** propose anything that hurts accessibility or theme parity.
- Every finding must name a concrete **file:line** (or file + nearby anchor) and a concrete
  fix referencing the existing system (catalog component / token / utility).

## Output format (write to your assigned report file)

For each finding:

```
## N. <concise title>
- **Severity**: critical | high | medium | low
- **Category**: reuse | token | hierarchy | state-coverage | polish | a11y
- **File**: path/to/File.tsx:line
- **Problem**: what's wrong and why it reads as not-world-class
- **Fix sketch**: concrete change — name the catalog component / token / utility to use
```

Severity for a UI scan: **critical** = broken/illegible/inaccessible or systemically wrong
across a whole surface; **high** = clear inconsistency a user notices; **medium** = polish
gap; **low** = nit. Be honest — most UI findings are medium/high, few are critical.
