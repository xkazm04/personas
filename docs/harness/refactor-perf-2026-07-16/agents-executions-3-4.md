# agents/executions [3/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. `libs/inspectorHelpers.ts` is a byte-identical, zero-importer duplicate of `inspectorTypes.ts`
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_executions/libs/inspectorHelpers.ts:1
- **Scenario**: The file is character-for-character identical to `detail/inspector/inspectorTypes.ts` (parseToolSteps, durationColor, formatCost, formatTimeGap). A repo-wide grep finds zero imports of `inspectorHelpers` — everything imports from `./inspectorTypes`.
- **Root cause**: A helper module was moved/copied from `libs/` into `detail/inspector/` (or vice versa) and the original was never deleted.
- **Impact**: Two sources of truth for the duration-color thresholds and cost formatting; a future edit to one silently diverges from the other, and the dead copy inflates the bundle graph if ever re-imported by accident.
- **Fix sketch**: Delete `src/features/agents/sub_executions/libs/inspectorHelpers.ts`. No call-site changes needed (zero importers confirmed via grep across src/). If a `libs/`-level home is preferred long-term, instead delete `inspectorTypes.ts` and repoint its 4 importers — but the one-line delete is the cheaper, safe move.

## 2. `ToolCallCard` component is dead — no importers anywhere
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_executions/detail/inspector/ToolCallCard.tsx:8
- **Scenario**: Repo-wide grep for `ToolCallCard` matches only its own definition file. It is the old stacked-card tool-call renderer that `ExecutionInspector`'s master/detail layout (with `StepIO`/`HighlightedJsonBlock`) explicitly replaced, per the inspectorShared doc comment about "the baseline's plain `<pre>` previews".
- **Root cause**: The inspector redesign swapped in the master/detail view but left the superseded baseline component behind.
- **Impact**: 80 lines of unreferenced UI code in a hot feature directory; readers auditing the inspector must reason about a component that never renders. (Components are only ever imported statically in this codebase, so dynamic-use risk is nil; cross-context callers already covered by the repo-wide grep.)
- **Fix sketch**: Delete `ToolCallCard.tsx`. If the collapsible-card presentation is wanted later, it can be rebuilt on `StepIO`, which already handles the input/output rendering with highlighting.

## 3. Duration-tier thresholds duplicated between `dotColor` and `durationColor`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_executions/runnerTypes.tsx:38
- **Scenario**: `dotColor` (runner stream tool-call dots) hardcodes the same <2000ms / <10000ms tiers as `durationColor` in `detail/inspector/inspectorTypes.ts:10`; its own comment admits it "mirrors ExecutionInspector's durationColor".
- **Root cause**: Two color functions with different output shapes (bg-only class vs badge class trio) each re-encode the tier boundaries instead of sharing them.
- **Impact**: If the "slow tool call" threshold is ever tuned, the runner dots and inspector badges will disagree — a subtle UX inconsistency the comment tries to paper over.
- **Fix sketch**: Extract `export function durationTier(ms): 'pending' | 'fast' | 'slow' | 'very-slow'` next to `durationColor`, and have both `dotColor` and `durationColor` map tier → classes. Two small switch statements replace duplicated numeric literals.

## 4. Line-diff crosses the worker boundary twice (chunks + full result)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/features/agents/sub_executions/workers/comparisonDiff.worker.ts:41
- **Scenario**: `computeLineDiff` streams the diff in 50-entry chunks (`line-chunk`), then posts the entire accumulated `result` array again in `line-complete`. Comparing two large execution outputs (thousands of lines) structured-clones every diff entry twice.
- **Root cause**: The completion message carries the full result so the client can resolve its promise/cache, instead of the client assembling the result from the chunks it already received.
- **Impact**: 2x serialization cost and 2x main-thread deserialization on exactly the case the worker exists for (big diffs) — the final `line-complete` clone can block the UI thread for a large payload, undoing part of the off-thread win.
- **Fix sketch**: In `comparisonDiffWorkerClient.ts`, accumulate chunks per pending request (`pending.parts.push(...chunk)`) and change `line-complete` to a zero-payload `{ id, kind: 'line-complete' }`; resolve with the accumulated array and cache that. Worker keeps `chunk` only, drops the `result` accumulation entirely (also halving worker-side memory).

## 5. Module-level diff caches grow without bound for the app session
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/agents/sub_executions/libs/comparisonDiffWorkerClient.ts:27
- **Scenario**: `lineCache` and `jsonCache` are module-scope `Map`s keyed by content hash with no eviction. A user comparing many execution pairs in a long-lived Tauri session (each side potentially a large tool output) accumulates every full diff array ever computed.
- **Root cause**: Caching was added for repeat comparisons but without any size cap or LRU policy.
- **Impact**: Unbounded memory growth proportional to total diffed content over the session; in a desktop app that stays open for days this is a slow leak holding large string arrays alive.
- **Fix sketch**: Cap each cache (e.g. 20 entries) with insert-order eviction: after `cache.set(key, result)`, `if (cache.size > MAX) cache.delete(cache.keys().next().value)`. Map iteration order gives cheap FIFO; a touch-on-get upgrade makes it LRU if desired.

## 6. `useExecutionList` returns a new `refresh` function every render (plus a redundant selector)
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_executions/libs/useExecutionList.ts:81
- **Scenario**: Line 81 re-selects `fetchExecutions` (already selected at line 48) and line 83 wraps it in a fresh arrow function on every render, so any consumer putting `refresh` in a `useEffect`/`useCallback` dependency array re-fires on every parent render.
- **Root cause**: The closure over `personaId` was created inline in the return object instead of memoized; the duplicate selector is leftover from an edit.
- **Impact**: Bounded but real: effect churn in consumers of a hook that renders on every execution-list update (frequent while a run is streaming), plus a redundant Zustand subscription.
- **Fix sketch**: Drop the line-81 selector and return `refresh: useCallback(() => fetchExecutions(personaId), [fetchExecutions, personaId])`. One-line change, stabilizes the identity for all callers.
