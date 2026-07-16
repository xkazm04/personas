# teams/factory [3/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 2 medium / 1 low)
> Context group: Execution & Orchestration | Files read: 10 | Missing: 0

## 1. GoldenGauge component is dead code duplicating GoldenInk
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_factory/passport/improve/GoldenGauge.tsx:8
- **Scenario**: `GoldenGauge` is exported but never imported anywhere in `src/` (grep across the repo finds only its own definition). The passport wall renders `GoldenInk` (ProjectsPassportWall.tsx:400) instead — a near line-for-line clone of the same rubric bar + tooltip, differing only in the color ramp (`scoreInk` vs `scoreTint`).
- **Root cause**: `GoldenInk` was written as a color-vocabulary fork of `GoldenGauge` (the comment at ProjectsPassportWall.tsx:397-399 says so), and the original was never deleted.
- **Impact**: A dead component with duplicated tooltip/gauge logic (`belowTarget` message construction is copy-pasted verbatim in both) — the next rubric-copy change will be made in one place and silently missed in the other.
- **Fix sketch**: Delete `GoldenGauge.tsx`, or if a tint-parametrized gauge is wanted, fold `GoldenInk` into it with a `tint: (pct) => …` prop and have the wall pass `scoreInk`. Verify no dynamic import first (none visible; component name only appears in its own file).

## 2. ReadinessTrend re-parses the full localStorage history map twice per card render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/teams/sub_factory/passport/ReadinessTrend.tsx:10
- **Scenario**: `ReadinessTrend` calls `getHistory(slug)` (line 10) and `trendDelta(slug)` (line 13); each internally runs `load()` in passportHistory.ts — `localStorage.getItem` + `JSON.parse` of the ENTIRE history map (all projects × up to 40 snapshots each). The component renders once per project card on the passport wall, and re-renders with every wall re-render (hover/motion/layout-group churn), so a wall of N projects does 2×N full-map synchronous parses per render pass.
- **Root cause**: `passportHistory.load()` has no caching, and `trendDelta` calls `getHistory` again instead of accepting the series the caller already fetched.
- **Impact**: Redundant synchronous JSON parsing on the main thread on a hot render path; cost grows quadratically-ish with project count (N cards × whole-map parse). Bounded by MAX_PER_PROJECT=40 but pure waste — the data only changes when `recordSnapshot` writes.
- **Fix sketch**: Memoize the parsed map in a module-level variable in passportHistory.ts, invalidated by `save()` (single-window desktop app, so cross-tab staleness is a non-issue), or have `ReadinessTrend` fetch the series once (`const hist = getHistory(slug)`) and compute the delta locally from `hist[len-1] - hist[len-2]` instead of calling `trendDelta` (which is a trivial two-element subtraction anyway). Wrapping the component in `React.memo` also cuts the re-render multiplier.

## 3. passportToMarkdown is built eagerly on every cover render instead of on copy
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/teams/sub_factory/passport/passportExport.ts:13 (call site ProjectsPassportWall.tsx:360)
- **Scenario**: `CoverBody` passes `text={passportToMarkdown(p, Date.now())}` to `CopyButton`, so every render of every project card runs `scoreAgainstRubric` plus full markdown assembly for a report that is only needed when the user actually clicks copy. `Date.now()` in render also makes the prop unstable, defeating any memoization of `CopyButton`.
- **Root cause**: The export string is computed as a plain prop rather than lazily at click time.
- **Impact**: Bounded per-card waste (string building + one extra rubric scoring per render), plus a guaranteed-unstable prop that forces `CopyButton` to re-render each pass. Cheap individually, but it stacks with finding #2 on the same hot path.
- **Fix sketch**: If `CopyButton` supports it, pass a `getText: () => passportToMarkdown(p, Date.now())` thunk evaluated on click; otherwise `useMemo(() => passportToMarkdown(p, now), [p])` in `CoverBody` with a render-stable `now`. Either removes the per-render computation and stabilizes the prop.
