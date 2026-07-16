# shared/components [4/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 3 medium / 1 low)
> Context group: Shared UI & Design System | Files read: 23 | Missing: 0

## 1. LoadingSpinner is a null-render stub with dead props that mislead every caller
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/shared/components/feedback/LoadingSpinner.tsx:12
- **Scenario**: `LoadingSpinner` deliberately renders nothing (spinners disabled app-wide), yet keeps a `size?: 'xs'…'2xl'` and `className` API. `SuspenseFallback.tsx:14` still passes `size="lg"`, and any other caller passing size/className is passing props that are silently ignored.
- **Root cause**: The component was gutted "for import compatibility" but its prop surface and callers were never trimmed, so the type signature advertises behavior that no longer exists.
- **Impact**: Maintenance hazard: new code keeps choosing spinner sizes that do nothing, and readers debugging "missing spinner" have to discover the stub. The `SpinnerSize` type and both unused props are pure dead weight.
- **Fix sketch**: Narrow the props to `{ label?: string }` (or rename to `SrOnlyLoadingLabel`), delete `SpinnerSize`, and drop the `size="lg"` argument in `SuspenseFallback`. Grep other callers for `size=`/`className=` usages and strip them in the same pass (cross-context verification needed for caller count).

## 2. TruncateWithTooltip remounts its element mid-hover, so the first hover never shows the tooltip and measurement is hover-gated
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/components/display/TruncateWithTooltip.tsx:45
- **Scenario**: On first mouseenter, `checkOverflow` flips `isTruncated` to true, which switches the returned tree from the bare `<Tag>` to `<Tooltip><Tag/></Tooltip>`. The root component type changes, so React unmounts and recreates the DOM element under the cursor — the new element never received the mouseenter, so the tooltip typically does not open until the user leaves and re-hovers. The same remount discards focus when triggered via keyboard.
- **Root cause**: Conditional wrapping (`if (!isTruncated) return inner;`) changes the element tree shape based on state set during the hover event itself; overflow is also only re-measured on hover/focus, so a resize that un-truncates leaves stale tooltip wrapping.
- **Fix sketch**: Always render the `Tooltip` wrapper and gate it with a `disabled={!isTruncated}` (or `content={isTruncated ? text : null}`) prop so the DOM element is stable across the state flip. Optionally measure in a `useLayoutEffect` + `ResizeObserver` instead of onMouseEnter so `isTruncated` is correct before the first hover.

## 3. SpringCount drives a React re-render on every animation frame per instance
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/components/display/SpringCount.tsx:41
- **Scenario**: `useMotionValueEvent(spring, 'change', v => setDisplay(v))` converts each spring frame (~60/s for the settle duration) into a full React render of the component. Dashboards that show several SpringCounts (telemetry panels, stats rows) multiply this: N counters animating simultaneously = N×60 renders/s through React's scheduler.
- **Root cause**: The animated value is round-tripped through `useState` instead of being written to the DOM directly via a motion value, which is the pattern framer-motion provides precisely to avoid per-frame reconciliation.
- **Impact**: Bounded (renders are tiny spans) but measurable scheduler churn on pages with many counters, and it defeats parent memoization during the animation window. The default `<Numeric>` path re-runs its formatting each frame too.
- **Fix sketch**: Render a `motion.span` bound to a derived motion value (`useTransform(spring, v => format(Math.round(v)))`) so frames bypass React entirely; keep the `useState` path only if a custom `format` returning React nodes is required. Alternatively, quantize: only `setDisplay` when `Math.round(v)` actually changes, which cuts renders to one per visible digit change.

## 4. Collapse keeps an unused innerRef
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/shared/components/display/Collapse.tsx:16
- **Scenario**: `innerRef` is created and attached to the inner div but never read anywhere in the file — likely a leftover from an earlier height-measuring implementation before the CSS grid-rows trick.
- **Root cause**: Refactor to the pure-CSS `0fr → 1fr` approach removed the need for DOM measurement but left the ref behind.
- **Impact**: Cosmetic only; a few lines of noise that suggest measurement happens when it doesn't.
- **Fix sketch**: Delete `innerRef`, the `useRef` import usage, and the `ref={innerRef}` attribute; keep the `overflow: hidden` style.
