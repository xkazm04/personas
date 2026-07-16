# agents/model_config — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 1 high / 1 medium / 2 low)
> Context group: Persona Authoring & Design | Files read: 18 | Missing: 0

## 1. Infinite arena-results refetch loop after a comparison completes
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: refetch-loop
- **File**: src/features/agents/sub_model_config/components/compare/ModelABCompare.tsx:33
- **Scenario**: User runs an A/B comparison and leaves the panel open after it finishes. The results-fetch effect depends on `arenaResultsMap` AND calls `fetchArenaResults`, which writes a new `arenaResultsMap` reference on every call — re-triggering the effect indefinitely.
- **Root cause**: Verified against the store: `labSlice.ts` `fetchResults` only short-circuits when the run is found terminal in `arenaRuns` (`runNow` lookup, labSlice.ts:193), but `wrapStart` never inserts the run into `arenaRuns` and ModelABCompare never calls `fetchArenaRuns` — so `runNow` is always `undefined`, `finalizedResultIds` never records the run, and every fetch unconditionally does `set({ arenaResultsMap: {...} })` with fresh array/object references. Effect deps `[..., arenaResultsMap]` then fire again while `activeRunId && !isLabRunning && labProgress === null` stays true.
- **Impact**: Continuous busy-loop of Tauri IPC + SQLite reads + React re-renders (one iteration per IPC round-trip) for as long as the panel/persona stays open after any completed run. Also, the `arenaResultsMap[activeRunId]` read inside `.then()` uses the closure's pre-fetch map, so `setLastResults` is fed stale data and the second effect exists purely to compensate.
- **Fix sketch**: Split trigger from data: fetch once on completion in an effect depending only on `[activeRunId, isLabRunning, labProgress]` (drop `arenaResultsMap` from deps), and let the existing second effect (`arenaResultsMap[activeRunId]` → `setLastResults`) be the sole store→local sync. Alternatively/additionally, fix the store seam: have `fetchResults` mark `finalizedResultIds` when the per-mode `is*Running` flag is false instead of relying on a `runsKey` lookup that callers may never populate.

## 2. Model catalog duplicated between ModelSelector and compareHelpers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_model_config/components/ModelSelector.tsx:66
- **Scenario**: Adding a model or correcting a cost string (e.g. Anthropic price change) requires touching two parallel lists; they can silently diverge — the picker would advertise one price while the compare dropdown shows another.
- **Root cause**: `ANTHROPIC_MODELS`/`OLLAMA_MODELS` (ModelSelector.tsx:66-80) and `ALL_COMPARE_MODELS` (libs/compareHelpers.ts:21-34) independently define the same ids, display names, and cost strings ('~$0.25/1K', '~$3/1K', '~$15/1K', 'Free'), including the same `p.label.split(' (')[0] ?? p.label` label-derivation trick in both files.
- **Impact**: Real maintenance hazard: two sources of truth for user-visible pricing/model identity in the same feature folder.
- **Fix sketch**: Make `ALL_COMPARE_MODELS` (or a new `libs/modelCatalog.ts`) the single catalog carrying id/label/provider/cost/group, and derive ModelSelector's per-provider columns from it (`catalog.filter(m => m.group === 'Anthropic')` etc.), keeping the extra `custom` entry local to the selector.

## 3. Scenario-name extraction duplicated across compare components
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_model_config/components/compare/CompareOutputPreviews.tsx:17
- **Scenario**: Any change to how scenarios are identified/ordered (e.g. sorting, filtering failed rows) must be made twice or the table and previews disagree.
- **Root cause**: `ComparisonResults` (CompareResultsTable.tsx:29-33) and `OutputPreviews` (CompareOutputPreviews.tsx:17-21) each run the identical `useMemo` building a `Set` of `r.scenarioName` from the same `results` array, and `OutputPreviews` is rendered by `ComparisonResults` which already has the list.
- **Impact**: Bounded duplication plus a redundant second pass over `results`; trivial data sizes, so purely a maintenance concern.
- **Fix sketch**: Compute `scenarios` once in `ComparisonResults` and pass it to `OutputPreviews` as a prop (or extract a `uniqueScenarios(results)` helper into compareHelpers.ts next to the other aggregation utilities).

## 4. aggregateResults is a subset of aggregateResultsDetailed; missingModels re-computes full metrics
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_model_config/libs/compareHelpers.ts:56
- **Scenario**: In ModelABCompare, `metricsA`/`metricsB` memos call `aggregateResults` and the `missingModels` memo calls `aggregateResultsDetailed` for the same two models — computing `computeMetrics` (four reduce passes each) twice per model per result change, only to read `.status`.
- **Root cause**: `aggregateResults` (filter + computeMetrics) duplicates the body of `aggregateResultsDetailed` instead of delegating, and the caller uses the detailed variant purely as an existence check.
- **Impact**: Negligible runtime cost at arena scale (dozens of rows) but two code paths to keep in sync for the same aggregation semantics.
- **Fix sketch**: Implement `aggregateResults` as `const r = aggregateResultsDetailed(results, modelId); return r.status === 'ok' ? r.metrics : null;`. In ModelABCompare, derive `missingModels` from the already-memoized `metricsA`/`metricsB` (`lastResults.length > 0 && metricsA === null`) instead of re-aggregating.
