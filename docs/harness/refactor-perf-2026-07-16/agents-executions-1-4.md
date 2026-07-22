# agents/executions [1/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 5 medium / 0 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Failed-status predicate duplicated across 5 sites in the bulk-rerun feature
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_executions/libs/useBulkRerun.ts:69
- **Scenario**: The predicate `status === 'failed' || status === 'cancelled' || status === 'timeout'` is written out independently in useBulkRerun.ts:69 (`isFailedStatus`, module-private), BulkRerunToolbar.tsx:22 (`isFailed`), BulkRerunReport.tsx:34 and :39 (inline), and ExecutionList.tsx:289 and :297 (inline). If a new terminal-failure status is added (e.g. `incomplete`, which ExecutionLifecycleIcons already treats as failed) or `timeout` semantics change, "select all failed", the rerun success verdict, and the regression/recovery classification silently disagree.
- **Root cause**: `isFailedStatus` in useBulkRerun.ts is not exported, so each consumer re-derived the same status set.
- **Impact**: Drift hazard in the money/verdict path of bulk rerun — selection, per-item success, and cohort regression counts all depend on the same set staying in sync across 4 files.
- **Fix sketch**: Export `isFailedStatus` from useBulkRerun.ts (or move it to `libs/useExecutionList.ts` next to the other shared helpers) and replace the 4 other occurrences. BulkRerunReport's `regressions`/`recoveries` filters can then reuse it directly, mirroring `deriveCohort`.

## 2. PersonaRunner hand-rolls a summary card that duplicates ExecutionSummaryCard
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_executions/components/runner/PersonaRunner.tsx:189
- **Scenario**: PersonaRunner.tsx:189-203 renders status icon + capitalized status + Timer/duration + DollarSign/cost, and for `cancelled` a "stopped while running \<last_tool\>" line plus a "resume from here" button — the same structure, translations (`stopped_while_running`, `resume_from_here`), and amber styling that `detail/views/ExecutionSummaryCard.tsx:93-168` implements (including its cancelled branch with `onResume`).
- **Root cause**: The runner's inline card predates (or bypassed) the extracted ExecutionSummaryCard; the two operate on slightly different summary shapes (`parseSummaryLine` output vs `useExecutionSummary`'s `ExecutionSummary`), so nobody consolidated.
- **Impact**: Two visual/behavioral sources of truth for "how a finished execution is summarized"; styling or copy fixes to one (e.g. the amber cancelled treatment) won't reach the other.
- **Fix sketch**: Adapt the runner's parsed summary (`status`, `duration_ms`, `cost_usd`, `last_tool`) into the `ExecutionSummary` shape (toolCalls can carry the single last tool) and render `<ExecutionSummaryCard summary={...} onResume={exec.handleResume} />`, or extract the shared status/duration/cost + cancelled-resume block into a small presentational component both use. Verify the runner card's `summaryPresentation.border/bg` wrapper matches before swapping.

## 3. OutputDiffSection renders the entire line diff unvirtualized and accumulates chunks quadratically
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_executions/components/list/ComparisonDiff.tsx:65
- **Scenario**: Comparing two executions with long terminal logs (thousands of lines is normal for agent runs): the worker streams 50-entry chunks and each chunk does `setDiff(prev => [...prev, ...chunk])` (line 66-67) — a full array copy plus a full React re-render of everything rendered so far, i.e. O(n²/50) copies and re-renders. The result list itself (lines 106-136) renders every diff entry as a 3-column grid row inside a `max-h-64` box, so a 10k-line diff mounts 10k DOM rows of which ~15 are visible.
- **Root cause**: Chunk streaming was added for progressiveness but appends via state copies, and the diff list never got the row virtualization the execution table already uses (`useVirtualList`).
- **Impact**: Noticeable main-thread stalls and memory churn when diffing large logs — exactly the case the off-thread worker was introduced to protect; the worker computes off-thread but the UI pays it back on render.
- **Fix sketch**: Render through `useVirtualList` (already in the codebase, used by ExecutionList) instead of mapping all entries; precompute line numbers in one pass so rows are pure. For streaming, either buffer chunks in a ref and flush on a rAF/interval, or drop intermediate `setDiff` appends entirely and rely on the final `setDiff(result)` with a progress indicator — the chunk-by-chunk paint into a 256px box has little UX value.

## 4. Module-level diff caches grow without bound for the app session
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/agents/sub_executions/libs/comparisonDiffWorkerClient.ts:27
- **Scenario**: `lineCache` and `jsonCache` are module-level `Map`s keyed by content hash; every distinct pair of execution logs/outputs ever diffed stores its full `LineDiffEntry[]` (one entry per log line, including the text) for the lifetime of the app. Personas is a long-running Tauri desktop app; an operator triaging a bulk-rerun cohort can diff dozens of multi-MB logs in one session.
- **Root cause**: The cache has no eviction policy — entries are only ever added (lines 141, 151, 181, 188).
- **Impact**: Unbounded memory growth proportional to total bytes of all logs ever compared in a session; the cached arrays duplicate the log text roughly 1:1.
- **Fix sketch**: Cap both maps as small LRUs (e.g. 16 entries: on hit, delete+re-set the key; on insert past cap, delete the oldest via `map.keys().next().value`). Hit rate for re-opening the same comparison is preserved; anything older is cheap to recompute in the worker.

## 5. useTraceData collapse filtering does a linear span lookup per ancestor per node (O(n²))
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/agents/sub_executions/detail/inspector/useTraceData.ts:136
- **Scenario**: `isAncestorCollapsed` walks each node's parent chain and resolves every parent with `unifiedTrace.spans.find(...)` (line 140). The whole memo re-runs on every collapse toggle and — worse — on every live `execution-trace-span` event during a running execution (each event rebuilds `trace`, hence `unifiedTrace`, hence this block). For a trace with n spans of depth d this is O(n·d) `find`s, each O(n) → O(n²·d̄) per event.
- **Root cause**: No span-id → span index; the parent chain is resolved by repeated array scans inside a filter that runs for all nodes.
- **Impact**: Tool-heavy executions emit hundreds of spans; during live streaming this quadratic pass runs per span event, competing with the terminal/timeline for main-thread time. Bounded (spans, not unbounded data), but on a hot live path.
- **Fix sketch**: Inside the memo build `const byId = new Map(unifiedTrace.spans.map(s => [s.span_id, s]))` once and use it in the ancestor walk; better, compute the set of hidden nodes top-down while flattening (a node is hidden iff its parent is hidden or collapsed), making the whole pass O(n). `buildSpanTree` already has the parent relationships to do this.
