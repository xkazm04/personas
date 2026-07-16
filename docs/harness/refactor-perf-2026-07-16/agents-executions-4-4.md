# agents/executions [4/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 1 high / 2 medium / 1 low)
> Context group: Execution & Orchestration | Files read: 17 | Missing: 1

## 1. Two dead helper files that are byte-level duplicates of live modules — with drift already underway
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_executions/libs/inspectorHelpers.ts:1 (and src/features/agents/sub_executions/libs/waterfallHelpers.ts:1)
- **Scenario**: A developer greps for `parseToolSteps` or `STAGE_COLORS`, lands in `libs/inspectorHelpers.ts` or `libs/waterfallHelpers.ts`, edits it, and nothing changes in the app — both files have ZERO importers anywhere in `src/` (verified by repo-wide grep; only their own definition lines match).
- **Root cause**: `libs/inspectorHelpers.ts` is byte-identical to `detail/inspector/inspectorTypes.ts` (which IS imported by ToolCallCard/ExecutionInspector/inspectorShared/CostBreakdownBar). `libs/waterfallHelpers.ts` is a stale copy of `trace/stageColors.ts` (which IS imported by StageBar/SubSpanBar/PipelineWaterfall). A prior consolidation left the orphans behind.
- **Impact**: Real hazard, not theoretical: the two STAGE_COLORS copies have already drifted — `waterfallHelpers.ts` colors spawn_engine/stream_output amber, `stageColors.ts` colors them violet (plus barGradient/haloColor fields only in the live copy). `traceInspectorTypes.ts` even carries a comment documenting that exactly this kind of parallel-copy drift bit this context before.
- **Fix sketch**: Delete `libs/inspectorHelpers.ts` and `libs/waterfallHelpers.ts` outright (grep confirms no importers; run tsc to be safe). No call-site changes needed.

## 2. `parseToolSteps` defined 5× and the precision-4 `formatCost` wrapper defined 3× across the executions feature
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_executions/trace/stageColors.ts:25
- **Scenario**: If tool_steps ever needs real parsing (e.g. a JSON-string fallback or schema validation — the current body suggests it once did more), the change must be replicated in stageColors.ts, inspector/inspectorTypes.ts, libs/comparisonHelpers.ts:7, hooks/execution/useReplayTimeline.ts:70, plus the two dead copies in finding 1 — and any missed copy silently diverges.
- **Root cause**: The 4-line `parseToolSteps(raw)` guard and the `formatCost(v) => _formatCost(v, { precision: 4 })` wrapper (inspector/inspectorTypes.ts:18, libs/useReplayState.ts:14, + dead inspectorHelpers.ts) were copy-pasted into each sub-area instead of living in one shared lib module.
- **Impact**: Six definition sites for two trivial functions inside one feature; each is a divergence point and inflates every grep/audit of this context.
- **Fix sketch**: Create (or extend) a single `libs/executionFormatters.ts` in sub_executions exporting `parseToolSteps` and the precision-4 `formatCost`; re-point the ~8 import sites; delete the local copies. useReplayTimeline.ts (outside the feature) can import the shared one too since it already ships the same body.

## 3. `StatusIcon` component duplicated byte-for-byte in RunnerHeader.tsx and runnerTypes.tsx; RunnerHeader.tsx contains no RunnerHeader
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_executions/components/runner/RunnerHeader.tsx:31
- **Scenario**: PersonaRunner imports `StatusIcon` from RunnerHeader.tsx while ExecutionSummaryCard imports an identical `StatusIcon` from ../../runnerTypes.tsx:60 — a style/behavior tweak to one leaves the other stale, and searching for the "RunnerHeader" component finds a file that exports only a pin button and an icon.
- **Root cause**: The header component was evidently refactored away but its helpers stayed under the old filename, and one of them was re-created in runnerTypes.tsx instead of being imported.
- **Impact**: Bounded — two 3-line components — but it's a guaranteed drift pair on the run-status visual, and the misnamed file costs navigation time.
- **Fix sketch**: Keep the runnerTypes.tsx `StatusIcon` as canonical; have RunnerHeader.tsx re-export it (or update PersonaRunner's import) and rename the file to something honest like `MiniPlayerPinButton.tsx` since that's its only real content.

## 4. Memoized ExecutionListRow receives the entire `executions` array as a prop, defeating `memo` for every row on every list change
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_executions/components/list/ExecutionListRow.tsx:145
- **Scenario**: While a run is live, the execution list re-fetches/polls and produces a new `executions` array identity each tick; because every `ExecutionListRowImpl` takes `executions` (and `execIdx`) just to build a 10-item cost window for `CostSparkline`, the array-identity change invalidates the `memo()` wrapper on ALL rows, re-rendering the full list (Tooltips, badges, sanitizers like maskSensitiveJson on expanded rows) each tick.
- **Root cause**: The sparkline window `executions.slice(execIdx, execIdx + 10).map(e => e.cost_usd).reverse()` is computed inside the row from the whole-list prop, instead of the parent passing a stable, row-scoped `sparklineCosts: number[]` (or the row deriving it from a memoized selector).
- **Impact**: O(rows) wasted re-renders per poll tick on the hottest list in the executions feature; grows with history length and completely nullifies the deliberate `memo()` on the row.
- **Fix sketch**: In the parent, compute `costs` per row (memoized on the executions array) and pass only that small array — or better, pass a primitive-friendly prop (e.g. join the 10 numbers or memoize per-id) so `memo`'s shallow compare holds when a row's window is unchanged. Drop the `executions`/`execIdx` props from the row entirely.
