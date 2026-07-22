# agents/lab [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 5 medium / 0 low)
> Context group: Agent Lab & Evolution | Files read: 34 | Missing: 0

## 1. Broken i18n interpolation in success toast — user sees the raw template string
- **Severity**: High
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/agents/sub_lab/components/shared/ImprovePromptButton.tsx:97
- **Scenario**: Every time a user clicks "Auto-improve" and the Matrix run starts successfully, the toast reads literally `{t.agents.lab.improvement_run_started}! Check the Matrix tab for results.` — the braces are inside a plain string literal, not a template expression.
- **Root cause**: `addToast('{t.agents.lab.improvement_run_started}! ...')` uses single quotes around what was meant to be an interpolated translation key; it was never a template literal, so it ships as raw text.
- **Impact**: Garbled, untranslated text on the happy path of a primary lab action; also bypasses the i18n catalog entirely (the trailing "Check the Matrix tab..." is hardcoded English).
- **Fix sketch**: Replace with a real catalog string, e.g. `addToast(t.agents.lab.improvement_run_started_toast, 'success')` where the key contains the full sentence, or compose via `tx(...)` if a variable is needed. Grep for other `'{t.` literals while at it.

## 2. reportGenerator: four near-identical scenario-table builders and card-HTML blocks
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_lab/libs/reportGenerator.ts:262-393
- **Scenario**: Any change to the report table layout (column styling, the `--` empty cell, score coloring) must be repeated in `scenarioTable`, `abScenarioTable`, `evalScenarioTable`, and `matrixScenarioTable`; the ~15-line metric-card HTML block is likewise copy-pasted 4x in `arenaHtml`/`abHtml`/`evalHtml`/`matrixHtml` (lines 131-143, 165-177, 200-212, 238-247), and `scoreLabel` is defined a third time here (also in ArenaResultsView.tsx:30 and ScenarioDetailPanel.tsx:62).
- **Root cause**: Each lab mode grew its own HTML builder instead of parameterizing one generic scenario-table renderer and one aggregate-card helper.
- **Impact**: ~150 duplicated lines in one file; the four copies have already begun drifting (arena's table stores a single result per cell, the other three store arrays and average) — a styling or escaping fix applied to one silently misses the others.
- **Fix sketch**: Extract `renderScenarioTable(scenarios, columns: Array<{header: string; compositeFor(scenario): number | null}>)` and `renderAggCard(agg: AggRow, opts)` used by all four modes; move `scoreLabel` (and its null-tolerant variant) into `@/lib/eval/evalFramework` next to `scoreColor`, which all three consumers already import.

## 3. Cross-feature design-context parser library lives inside a component file
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/agents/sub_lab/use-cases/UseCasesList.tsx:52-148
- **Scenario**: `parseDesignContext` / `serializeDesignContext` / `mergeCredentialLink` (plus the LRU parse cache and 6 type re-exports) are pure data-layer utilities that — per their own comments — are consumed by `useConnectorStatuses`, `subscriptionLifecycle`, `personaSelectors`, and `ImprovePromptButton`. They live in the middle of a React component file, with a second `import` statement appearing at line 152 after 150 lines of code.
- **Root cause**: The parser accreted inside the component that first needed it and was never moved when other features started importing from `.../use-cases/UseCasesList` (a component path) to get a parsing function.
- **Impact**: Store/lifecycle modules depend on a UI component file (inverted layering, worse tree-shaking, confusing import graph); the mid-file import ordering also hides the component's real dependency list. Related duplication in the same directory: `CATEGORY_STYLES` exists both here (token-based, lines 154-161) and hand-rolled in UseCaseRow.tsx:8-15, and `MODE_BADGE` is duplicated in UseCaseRow.tsx:17-21 and UseCaseExecutionPanel.tsx:12-15.
- **Fix sketch**: Move the parser block + cache + type re-exports to e.g. `src/lib/personas/designContext.ts` and update imports (verify cross-context callers first; keep a temporary re-export shim in UseCasesList.tsx if needed). Fold the two CATEGORY_STYLES/MODE_BADGE copies into one shared map next to the `UseCaseItem` type.

## 4. LabEventStream derives tool-call durations with an O(n^2) slice-per-event scan on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-recompute
- **File**: src/features/agents/sub_lab/components/shared/LabEventStream.tsx:18-29
- **Scenario**: A scenario with a long agent transcript (hundreds of tool_use/tool_result events) opens its detail panel; each `tool_use` triggers `events.slice(i + 1).find(...)` — a fresh array allocation plus a linear scan — and the whole derivation reruns on every parent re-render because line 48 calls it unconditionally (no memo), including the re-render caused by the `<details>` toggle setState itself.
- **Root cause**: Pairing tool_use with the next tool_result was written as a nested search instead of a single forward pass, and the result is not memoized on `events`.
- **Impact**: O(n^2) time and O(n^2) transient allocations per render of the event stream; with a few hundred events this is measurable jank exactly when the user opens the heaviest panels.
- **Fix sketch**: Single pass: iterate once, remember the pending `tool_use` index, and on the next `tool_result` record the `tsMsRelative` delta. Wrap in `useMemo(() => deriveToolCallDurations(events ?? []), [events])`.

## 5. ArenaHistory recomputes per-run winner aggregation inside a table-cell render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_lab/components/arena/ArenaHistory.tsx:90
- **Scenario**: The "Winner scores" column calls `computeWinnerScore(resultsMap[run.id])` inside its `render` closure, so every render of the history table re-groups and re-averages all results of every listed run. The Colosseum panel re-renders on any agentStore arena slice change (progress ticks while a run executes, results streaming in), multiplying this by runs x results each tick.
- **Root cause**: Aggregation lives in the cell renderer instead of being derived once per (run, results) pair; the `useMemo` on `buildColumns` only memoizes the closures, not the work they do.
- **Impact**: O(runs x results) score aggregation on a hot re-render path during active arena runs — wasted CPU that grows with history size; expanded rows then aggregate the same data again via `aggregateArenaResults`.
- **Fix sketch**: Precompute `const winnerScores = useMemo(() => new Map(runs.map(r => [r.id, computeWinnerScore(resultsMap[r.id])])), [runs, resultsMap])` in `ArenaHistory` and have the column render read the map. Alternatively reuse `aggregateArenaResults`' top aggregate to avoid a second bespoke aggregator.

## 6. seriesColor/seriesFillColor default-arg rebuilds the full chart theme (7 getComputedStyle reads) per call
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: forced-style-recalc
- **File**: src/features/agents/sub_lab/shared/chartTheme.ts:133-140
- **Scenario**: Any caller using the convenient `seriesColor(i)` form (no explicit theme) triggers `getChartTheme()`, which performs seven `getComputedStyle(document.documentElement)` reads plus color parsing/mixing — per series, per chart render. In a Recharts render pass with several series and frequent re-renders during live lab runs, this repeats forced style computation.
- **Root cause**: `theme: ChartTheme = getChartTheme()` evaluates the expensive default on every invocation; there is no module-level cache, and only `useChartTheme()` memoizes (per component, per theme change).
- **Impact**: Repeated synchronous style reads on the render path of lab charts; cheap once, but multiplied across series x renders it is the kind of layout-adjacent work that shows up in profiles during streaming updates.
- **Fix sketch**: Cache the computed theme at module level keyed by the active themeId (invalidate when `useChartTheme` sees `themeId`/`customTheme` change), or drop the default arg and require callers to pass the theme from `useChartTheme()` — a quick grep of call sites decides which is less invasive.
