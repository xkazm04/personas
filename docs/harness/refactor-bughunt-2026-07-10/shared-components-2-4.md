> Context: shared/components [2/4]
> Total: 8
> Critical: 0  High: 1  Medium: 4  Low: 3

## 1. AnimatedList re-creates its motion wrappers every render → children remount on every update
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: race-condition / state-corruption
- **File**: src/features/shared/components/display/AnimatedList.tsx:90-113
- **Scenario**: `const MotionContainer = motion.create(Container);` and `const MotionItem = motion.create(ItemTag);` run inside the render body. `motion.create()` returns a brand-new component *type* on each call, so every parent re-render produces new element types. React cannot reconcile a changed type — it unmounts and remounts the container and every item. If any child holds local/uncontrolled state (a focused `<input>`, in-progress edit, scroll position, hover), it is destroyed on each render; the entrance animation also replays on every update. AnimatedList is used by VirtualStream, Gallery2D, UseCasesList etc., so the blast radius is wide.
- **Root cause**: `motion.create` (formerly `motion()`) is a factory meant to be called once at module scope or memoized; here it is called unmemoized in render.
- **Impact**: lost focus / lost child state, flicker, wasted reconciliation on large lists — subtle "why did my input blur?" bugs.
- **Fix sketch**: Hoist the common cases to module scope (`const MotionDiv = motion.create('div')`, `MotionLi = motion.create('li')`) and pick by tag, or wrap in `useMemo(() => motion.create(Container), [Container])` / `useMemo(() => motion.create(ItemTag), [ItemTag])`.

## 2. ConfidenceArc uses the wrong large-arc-flag for values above 50%
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / correctness
- **File**: src/features/shared/components/display/ConfidenceArc.tsx:38-39
- **Scenario**: The fill arc always spans `angle = π * fraction ≤ π` (≤180°) along the upper semicircle, so the minor arc is always the intended one and `large-arc-flag` should be 0 for every value. The code sets `const largeArc = fraction > 0.5 ? 1 : 0;`. For any confidence 51–99% this selects the *major* (>180°) arc, so the SVG draws the fill the long way around (down below the baseline and back), which then gets clipped by the `height`-tall viewBox — the gauge shows a broken/near-empty fill exactly in the "healthy" high-confidence range.
- **Root cause**: Misapplied SVG arc flag — conflating "fraction past halfway" with "arc exceeds 180°".
- **Impact**: UX — the confidence gauge visually misrepresents (under-shows) the majority of its value range.
- **Fix sketch**: Set `const largeArc = 0;` (a semicircle sweep never needs the large-arc arc).

## 3. EstimatedProgressBar freezes if `estimatedSeconds` changes mid-run
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition / edge-case
- **File**: src/features/shared/components/progress/EstimatedProgressBar.tsx:43-76
- **Scenario**: `tick` is `useCallback(..., [estimatedSeconds])` and the driver effect deps are `[isRunning, tick]`. While a run is in flight, if the parent changes `estimatedSeconds` (e.g. a refined estimate arrives), `tick`'s identity changes → the effect re-runs. Its cleanup calls `cancelAnimationFrame(rafRef.current)`, cancelling the loop, but the new effect body hits neither branch (`isRunning` true *and* `wasRunningRef.current` already true), so it never re-schedules `requestAnimationFrame`. The bar stops updating for the rest of the run and never reaches 100%.
- **Root cause**: The rAF loop is owned by an effect keyed on `tick`, but the "start" branch is guarded by an edge transition (`!wasRunningRef.current`) that a mid-run dep change no longer satisfies.
- **Impact**: UX — progress bar silently stalls when the estimate is updated during execution.
- **Fix sketch**: Keep `tick` in a ref (or drop it from deps) so the effect only runs on `isRunning` transitions; on cleanup only cancel, and (re)start the loop whenever `isRunning` is true and no frame is pending.

## 4. TerminalHeader "running" summary has an unbalanced parenthesis
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/shared/components/terminal/TerminalHeader.tsx:78
- **Scenario**: `<span ...>({lineCount} {t.shared.terminal_extra.lines_suffix}</span>` opens a `(` before the count but never closes it. While a process is running the header reads e.g. `Running 0:12 (5 lines` with no closing paren (the completed branch on line 82 correctly renders `Completed (5 lines)`).
- **Root cause**: Missing `)` literal / the closing paren wasn't folded into the suffix string.
- **Impact**: UX — minor visual glitch in the live terminal header.
- **Fix sketch**: Add the closing paren after the suffix, or move both parens into the translated `lines_suffix` string for consistency with the completed branch.

## 5. TerminalSearchBar can never filter to meta/summary lines and re-uses a shared mutable Set
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/shared/components/terminal/TerminalSearchBar.tsx:11-49
- **Scenario**: `ALL_TYPES` contains 6 styles (`error, tool, status, text, meta, summary`) but `LINE_TYPE_CHIPS` only exposes 4. `meta` and `summary` are therefore permanently in `activeTypes` — a user can never hide them, and can never view *only* those lines. `isFiltering` also compares `activeTypes.size < ALL_TYPES.size` (6), so toggling all 4 chips off still leaves size 2 (correctly "filtering"), but the two hidden types make the chip UI and the underlying set inconsistent. Minor secondary point: initial and reset state both assign the same shared `ALL_TYPES` Set instance as state; safe today only because `toggleType` always copies before mutating.
- **Root cause**: Chip list and `ALL_TYPES` drifted; two style categories exist without UI affordances.
- **Impact**: UX — meta/summary lines are unfilterable; latent aliasing risk if a future edit mutates `activeTypes` in place.
- **Fix sketch**: Either add chips for `meta`/`summary` or derive `ALL_TYPES` from `LINE_TYPE_CHIPS` so counts stay in sync; construct a fresh `new Set(...)` for initial + reset state.

## 6. ErrorRecoveryBanner and InlineErrorBanner are near-duplicate components
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/shared/components/feedback/ErrorRecoveryBanner.tsx:1-114 (vs feedback/InlineErrorBanner.tsx:1-97)
- **Scenario**: Both render the identical shape: `role="alert"/"status"` + `STATUS_PALETTE[severity]` bordered card + leading Icon + message/body + optional retry/action button + optional dismiss + `actions` slot, and each maintains its own parallel per-severity config map (`text-{color}-300` title, `text-{color}-400/70` body, `bg-{color}-500/15 ...` button). ErrorRecoveryBanner adds `cause` + `actionType` presets; InlineErrorBanner adds `title`. Verified both are consumed across the app (banners referenced in dozens of feature files), so neither is dead — this is genuine structural duplication, not a delete.
- **Root cause**: Two teams grew the "inline banner" idiom independently; the superset is one component.
- **Impact**: maintainability — severity color scales and a11y wiring must be edited in two places and can drift.
- **Fix sketch**: Merge into one `Banner` primitive (props: `severity`, `title?`, `message`, `cause?`, `actionType?`/`onAction`, `onRetry`, `onDismiss`, `actions`, `compact`); keep thin named wrappers if call-site ergonomics matter.

## 7. Three overlapping status/badge color-scale maps in this context
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/shared/components/display/Badge.tsx:14-61, display/StatusBadge.tsx:20-45, display/StatusShape.tsx:16-22
- **Scenario**: `Badge` defines `BADGE_VARIANTS` / `BADGE_HOVER` / `BADGE_TOKENS`, `StatusBadge` independently defines `VARIANT_CLASSES` + `ACCENT_CLASSES`, and `StatusShape` defines `SHAPE_COLOR` — all encoding the same canonical scale (`bg-{c}-500/10`, `border-{c}-500/20`, `text-{c}-400`). StatusBadge's accent map is essentially `BADGE_VARIANTS` with two extra keys; StatusShape's colors are the `text-{c}-400` slice. The scale is even documented in `Badge.tsx`'s header as "canonical for ALL badge-like elements", yet two neighbors re-declare it.
- **Root cause**: No single exported source of truth for the badge color scale; each component inlined its own copy.
- **Impact**: maintainability — a palette tweak (or a new accent) must be replicated across three maps.
- **Fix sketch**: Make `Badge.BADGE_VARIANTS` (or a shared token module) the source; have `StatusBadge` derive its accent/variant classes from it and `StatusShape` read the `text` slice via `BADGE_TOKENS[...].text`.

## 8. `isFiltering` predicate duplicated between hook and component
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/shared/components/terminal/TerminalSearchBar.tsx:37 and :49
- **Scenario**: `useTerminalFilter` computes `const isFiltering = filter.keyword !== '' || filter.activeTypes.size < ALL_TYPES.size;` and `TerminalSearchBar` recomputes the exact same expression inline from its `filter` prop. If the "is this filter active" definition ever changes (e.g. once meta/summary chips exist, see finding 5) the two copies will diverge.
- **Root cause**: The component doesn't receive `isFiltering` from the hook, so it reimplements it.
- **Impact**: maintainability — a small drift risk on the filter-active indicator.
- **Fix sketch**: Export a pure `isFilterActive(filter)` helper (or pass `isFiltering` down) and use it in both places.
