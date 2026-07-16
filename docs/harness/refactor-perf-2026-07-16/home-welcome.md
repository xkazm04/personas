# home/welcome — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: App Shell, Settings & Sharing | Files read: 14 | Missing: 0

## 1. Dead default export: the LanguageSwitcher dropdown component is never imported
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/home/sub_welcome/LanguageSwitcher.tsx:105
- **Scenario**: Every consumer of this module uses only the named `LanguageCardGrid` export (WelcomeLayout lazy import, settings AppearanceLanguageSettings). A repo-wide grep finds zero importers of the default `LanguageSwitcher` dropdown (lines 105-212, ~107 lines). The only other hit is a filename string in `lib/harness/scenario-parser.ts`.
- **Root cause**: The inline card grid superseded the dropdown variant, but the old component (plus its `fontReady` spinner badge and full duplicate of the language-card markup) was left behind.
- **Impact**: ~110 lines of unmaintained UI that duplicates the card markup (illustration, gradient overlay, check badge, label block) — any future card change must be made twice or silently drifts. Because the module is loaded via dynamic `import()` in WelcomeLayout, the whole module lands in the lazy chunk, so the dead dropdown also ships to users.
- **Fix sketch**: Delete the default export (lines 105-212) and the now-unused `useState`/`Loader2`/`Languages`/`Button` imports it drags in; keep `LanguageCardGrid`, `LANGUAGES`, `sortLanguages`, `langIllustration`. Verify no dynamic `import('./LanguageSwitcher')` consumes `.default` anywhere (only the WelcomeLayout mapping to `LanguageCardGrid` exists today). Optionally rename the file to `LanguageCardGrid.tsx`.

## 2. `NavCardWrapper` memo is defeated by an unstable `onCardClick` closure and per-render `[]` chips
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/home/sub_welcome/HomeWelcome.tsx:68 (and NavigationGrid.tsx:112)
- **Scenario**: HomeWelcome re-renders on every spine refresh (30s fleet metrics via navStatus), the 5-minute greeting tick, and language changes. Each render creates a new `onCardClick={(id) => setSidebarSection(...)}` arrow and, for cards without status chips, a fresh `status?.[card.id] ?? []` array — so the `memo()` wrapping `NavCardWrapper` never bails and all 6-8 framer-motion cards re-render together.
- **Root cause**: The memoized child receives two props whose identity changes on every parent render; `memo` does a shallow compare and always sees them as new.
- **Impact**: The memo is pure overhead today — every parent render re-renders every card, each carrying a `motion.button` with transition bookkeeping and a `SIDEBAR_ICONS` custom SVG icon. Measurable wasted work on a keep-alive page that re-renders on a timer; not user-visible jank yet, but the whole point of the `memo` is silently lost.
- **Fix sketch**: In HomeWelcome, wrap the handler in `useCallback` (or pass `setSidebarSection` directly since the store setter is stable). In NavigationGrid, hoist a module-level `const NO_CHIPS: NavStatChip[] = []` and pass `status?.[card.id] ?? NO_CHIPS`. Both are two-line changes that make the existing `memo` actually effective.

## 3. Card visual chrome duplicated between NavigationGrid and SetupCards
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/home/sub_welcome/NavigationGrid.tsx:54 (and SetupCards.tsx:504)
- **Scenario**: `NavCardWrapper` and `SetupCardItem` independently implement the same card recipe: gradient `bg-gradient-to-br ${gradFrom} ${gradTo}` shell, blur-3xl glow blob with hover opacity, uppercase title overlaid on a bottom `dark:from-black/*` gradient, and the identical `card.iconText.replace('text-', 'via-')` bottom hairline trick. The `NavCard` and `CardMeta` interfaces also repeat the same 6 styling fields (gradFrom/gradTo/glowColor/accentBorder/iconText...).
- **Root cause**: SetupCards was built by copying the nav-card chrome rather than extracting it.
- **Impact**: Styling changes to the home card language must be applied in two places with subtly different local state (`hovered` handling, lock overlay); the string-`replace` hack is duplicated, and the two already drift (padding, gradient stops).
- **Fix sketch**: Extract a small presentational `HomeCardShell` (props: gradient/glow/border/iconText tokens, `title`, `hovered`, `children` for the center slot and corner badges) used by both. Fold the shared 6 styling fields into one `CardTheme` type referenced by both `NavCard` and `CardMeta`. Keep motion/interaction behavior in the callers so this stays a pure-markup extraction.

## 4. LanguageCardGrid eagerly fetches all 14 language illustration PNGs
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/features/home/sub_welcome/LanguageSwitcher.tsx:77
- **Scenario**: Every Welcome mount renders the language grid (below the fold, after `DeferUntilIdle`) with `loading="eager"` on all 14 `lang-*.png` illustrations, so 14 image fetches + decodes fire on a section most users scroll past — competing with the hero WebP that the code elsewhere carefully preloads.
- **Root cause**: The inline grid copied the card markup but flipped the dead dropdown's `loading="lazy"` to `eager`, defeating the purpose of deferring the section.
- **Impact**: ~14 avoidable image decodes per Home visit (asset:// reads in Tauri, network in dev), adding cold-boot work on the app's landing surface for content usually off-screen.
- **Fix sketch**: Change `loading="eager"` to `loading="lazy"` on the grid images (they sit below the fold, so the browser will fetch them on approach). If the active language's card should still pop instantly, keep `eager` only for `isActive` and lazy for the rest.

## 5. useResumeContext re-ranks all executions on every ResumeBanner render
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/home/sub_welcome/useResumeContext.ts:135
- **Scenario**: The failure ranking runs `executions.map().filter().sort()` in the render body with no memoization, and the hook subscribes to the whole `executions` array — so every executions-store update (any run status change, polling refresh) re-runs the full scan/sort, plus once per unrelated ResumeBanner render.
- **Root cause**: Derivation lives inline in render instead of a `useMemo` keyed on `executions` (and a coarse time bucket for the 24h cutoff).
- **Impact**: O(n log n) over the executions list per render; harmless at today's list sizes, but it grows with execution history and does redundant `Date.parse` work on rows that never change.
- **Fix sketch**: Wrap the failure selection in `useMemo(() => ..., [executions])`; since only the max-timestamp failure is needed, replace map/filter/sort with a single-pass reduce tracking the newest qualifying row. The `now` cutoff can be captured inside the memo — staleness across a re-render gap is already tolerated by the 24h window.
