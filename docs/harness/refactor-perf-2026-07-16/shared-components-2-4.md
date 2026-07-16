# shared/components [2/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Shared UI & Design System | Files read: 34 | Missing: 0

## 1. AnimatedList creates new motion component types on every render, remounting the entire list
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/components/display/AnimatedList.tsx:90
- **Scenario**: `MotionContainer = motion.create(Container)` and `MotionItem = motion.create(ItemTag)` are called inside the component body. Every re-render of AnimatedList (any parent state change, new item arriving in ChannelList/Gallery2D/AutomationsSection/UseCasesList) produces brand-new component *types*, so React reconciles them as different elements and unmounts + remounts the whole container and every item.
- **Root cause**: `motion.create()` is a component factory and must be called once at module scope (or memoized); calling it during render breaks element-type identity across renders.
- **Impact**: Full DOM teardown/rebuild of the list on each render — entrance animations replay from scratch, child local state (focus, hover, uncontrolled inputs) is lost, and large lists (2D gallery) pay heavy layout cost. framer-motion also logs a dev warning for exactly this pattern.
- **Fix sketch**: Hoist the four possible combos to module scope: `const MOTION_TAGS = { div: motion.div, ul: motion.ul, ol: motion.ol, li: motion.li }` and look up `MOTION_TAGS[Container]` / `MOTION_TAGS[ItemTag]` in render. No API change; also removes the `motion.create` calls entirely since `motion.div` etc. are prebuilt.

## 2. ErrorRecoveryBanner duplicates InlineErrorBanner almost line-for-line
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/components/feedback/ErrorRecoveryBanner.tsx:27
- **Scenario**: The feedback folder ships three overlapping banners: `InlineErrorBanner`, `ErrorRecoveryBanner`, and `ErrorBanner` (which already delegates to InlineErrorBanner). ErrorRecoveryBanner's SEVERITY_CONFIG (tokens/Icon/titleText/buttonBg strings) and its entire JSX skeleton (rounded-xl border + icon + message + action button + dismiss) are a copy of InlineErrorBanner's TIER map with a `cause` line and action-type presets bolted on — even the `buttonBg` class strings are byte-identical.
- **Root cause**: ErrorRecoveryBanner was added as a new primitive instead of extending InlineErrorBanner with `cause`/`actionType` props.
- **Impact**: Two sources of truth for error-banner styling; palette or a11y fixes (e.g. the `role`/`aria-live` split InlineErrorBanner does per-severity but ErrorRecoveryBanner hardcodes to assertive) must be applied twice and will drift. Also note ErrorRecoveryBanner hardcodes English labels ('Retry', 'Check Connection', 'Open Settings', 'Dismiss') while InlineErrorBanner is translated.
- **Fix sketch**: Fold `cause?: string` and `actionType?/actionLabel?` into InlineErrorBanner (they're additive props), re-export ErrorRecoveryBanner as a thin wrapper or migrate its call sites, then delete the duplicate SEVERITY_CONFIG. Requires a cross-context caller sweep (usages exist in overview/vault features) before deleting.

## 3. StatusBadge re-declares the badge color scale that Badge.tsx canonicalizes
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/components/display/StatusBadge.tsx:29
- **Scenario**: `Badge.tsx` documents itself as the "canonical opacity scale for ALL badge-like elements" (`{color}-500/10` / `-500/20` / `-400`) and exports BADGE_VARIANTS/BADGE_TOKENS. `StatusBadge.tsx` in the same folder re-declares the identical scale in ACCENT_CLASSES for 15 colors (plus a VARIANT_CLASSES semantic layer), with its own separate BadgeSize type that clashes in name with Badge's.
- **Root cause**: Two badge primitives evolved in parallel; StatusBadge never consumed the exported token maps.
- **Impact**: Any palette adjustment must be made in two hand-maintained maps; the two components already disagree (Badge has yellow but no accent superset; StatusBadge has teal/indigo/pink/lime/slate missing from BADGE_VARIANTS), so "same variant name, different rendering" is one edit away.
- **Fix sketch**: Extend BADGE_VARIANTS in Badge.tsx with the missing colors and have StatusBadge build ACCENT_CLASSES from it (border/bg/text order differs only cosmetically). Longer term StatusBadge can render through `<Badge variant=...>` and keep only the `processing` ping-dot logic. Verify cross-context callers before renaming the exported BadgeSize types.

## 4. EstimatedProgressBar drives two setState calls per animation frame (~120 renders/sec)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/components/progress/EstimatedProgressBar.tsx:43
- **Scenario**: While `isRunning`, `tick()` runs on every requestAnimationFrame and calls `setElapsed` + `setProgress` with fresh float values, so the component re-renders ~60 times per second (and re-renders map over milestone divs, recompute labels, re-evaluate translations) for the entire duration of a run that this component estimates at 30+ seconds.
- **Root cause**: Continuous rAF-driven React state for values that are only perceptually meaningful at ~1 update/sec (elapsed seconds label) and whose bar width could animate via CSS.
- **Impact**: Sustained 60fps React reconciliation on a hot path (visible during every CLI/transform run), burning CPU in a desktop app for a 2px-tall bar; competes with the actual streaming work happening at the same time.
- **Fix sketch**: Replace the rAF loop with a 250–500ms `setInterval` that sets integer-second elapsed and a coarser progress value, and add `transition: width 300ms linear` on the fill div so motion stays smooth between updates. Alternatively keep rAF but write `width` to a ref'd DOM node directly and only setState when the integer second or phase changes.

## 5. TerminalStrip rebuilds the full log string and all line elements on every streamed line
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/components/terminal/TerminalStrip.tsx:54
- **Scenario**: `logText = lines.join('\n')` executes unconditionally on every render — including while collapsed, when the copy button isn't even mounted. The component re-renders once per streamed CLI line, so over a run of n lines this is O(n²) total character copying; expanded, it also re-runs `lineClassName(line)` (regex classification) for every historical line each time one line is appended.
- **Root cause**: Eager derivation of copy-payload and per-line classes with no memoization on a component whose props change at streaming frequency.
- **Impact**: Long runs (thousands of lines) make each incoming line progressively more expensive — a classic streaming-log hot path in this app (used by CLI output panels), causing jank exactly when the user is watching output scroll.
- **Fix sketch**: Compute the copy text lazily (`useMemo(() => lines.join('\n'), [lines])` at minimum, or give CopyButton a `getText` callback so join happens only on click), and memoize the rendered line list with `useMemo` keyed on `lines`/`lineClassName` (or extract a memoized `<LogLine>` so unchanged lines skip re-render). Consider capping rendered lines to the last few hundred since the panel is `max-h-40`.

## 6. ColorPicker hardcodes '#8b5cf6' three times instead of its own DEFAULT_PERSONA_COLOR export
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/shared/components/forms/ColorPicker.tsx:108
- **Scenario**: Lines 108, 127 and 130 use the literal `'#8b5cf6'` for the native-input fallback, the "is customized" check, and the reset action — while line 22 defines `DEFAULT_PERSONA_COLOR = COLOR_PRESETS[0]` (the same value) and the doc comment tells importers to "reach for the named exports rather than copying the array".
- **Root cause**: The default was inlined before/despite the named constant being introduced in the same file.
- **Impact**: Changing the default persona color (or reordering COLOR_PRESETS) silently breaks the reset button and the customized-check in the very component that owns the constant.
- **Fix sketch**: Replace the three literals with `DEFAULT_PERSONA_COLOR`. Case-normalize the comparison on line 127 (`value.toLowerCase() !== DEFAULT_PERSONA_COLOR`) to match the case-insensitive handling used elsewhere in the file.
