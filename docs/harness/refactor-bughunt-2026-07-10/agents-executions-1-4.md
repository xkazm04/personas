> Context: agents/executions [1/4]
> Total: 8
> Critical: 0  High: 0  Medium: 3  Low: 5

## 1. Bulk-rerun regression/recovery counts diverge from the rows they claim to summarize
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/agents/sub_executions/libs/useBulkRerun.ts:102-107 + src/features/agents/sub_executions/components/list/BulkRerunReport.tsx:30-41
- **Scenario**: `deriveCohort` computes `regressionCount`/`recoveredCount` using `isFailedStatus()` semantics (`failed|cancelled|timeout`), so it treats *any* non-failed original (e.g. `incomplete`, `queued`) as a "success" baseline. `BulkRerunReport` then re-derives the *listed* regression/recovery rows with strict literals: regressions require `origStatus === 'completed'`, recoveries require `newStatus === 'completed'`. If a user bulk-reruns an `incomplete` execution that then fails, the summary card increments `regressionCount` (shows "1 regression") but the Regressions section lists **zero** rows — the headline number contradicts the table beneath it.
- **Root cause**: Two independent definitions of "regression"/"recovery" — one predicate-based in the hook, one literal-based in the view — that were never reconciled.
- **Impact**: UX / trust — users see a non-zero regression/recovery count with an empty or shorter list, undermining confidence in the cohort report (success theater in reverse).
- **Fix sketch**: Have `BulkRerunReport` filter its rows using the same `isFailedStatus()` predicate exported from `useBulkRerun`, or export a shared `classifyTransition(orig,new)` helper and drive both the counts and the row lists from it.

## 2. A single diff-worker crash silently disables off-thread diffing for the rest of the session
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/agents/sub_executions/libs/comparisonDiffWorkerClient.ts:49-113
- **Scenario**: `worker.onerror` rejects all pending diffs and sets `worker = null`. `getWorker()` short-circuits on `if (worker !== undefined) return worker;`, so once `worker` is `null` (not `undefined`) it is **never rebuilt**. After one transient worker error, every subsequent comparison silently falls back to the synchronous main-thread `diffLines`/`jsonDiff` path for the whole session, re-introducing the UI-jank the worker existed to prevent.
- **Root cause**: `null` is overloaded to mean both "environment has no Worker support (permanent)" and "worker crashed (should retry)".
- **Impact**: Performance regression that is invisible (no log, no toast) — large log diffs block the render thread.
- **Fix sketch**: In `onerror`, set `worker = undefined` (not `null`) so the next `getWorker()` attempts a fresh construction; keep `null` only for the `typeof Worker === 'undefined'` unsupported case.

## 3. Cached diff results ignore cancellation and can setState after unmount
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/agents/sub_executions/libs/comparisonDiffWorkerClient.ts:123-133 + src/features/agents/sub_executions/components/list/ComparisonDiff.tsx:65-78
- **Scenario**: On a cache hit `computeLineDiffOffThread` returns `cancel: () => undefined` and schedules `queueMicrotask(() => onChunk(cached))`. If `OutputDiffSection` unmounts (or its logs change) before the microtask runs, the effect cleanup calls the no-op cancel, so the queued `onChunk` still fires `setDiff(...)` on an unmounted/stale component.
- **Root cause**: The cache fast-path opts out of the cancellation contract that the worker path honors.
- **Impact**: React "state update on unmounted component" noise; potential stale diff flashing when toggling rows quickly.
- **Fix sketch**: Back the cached path with a `let cancelled = false` flag captured by the returned `cancel`, and guard `onChunk`/`resolve` on it.

## 4. "Use latest annotation" picker value is set from a UTC string into a local datetime-local input
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/agents/sub_executions/components/list/BulkRerunToolbar.tsx:146-157
- **Scenario**: The button calls `onSelectSinceTimestamp(latestAnnotationDate)` (a UTC ISO string — correct) but also `setSinceValue(latestAnnotationDate.slice(0,16))`. A `<input type="datetime-local">` interprets its value as *local* time, so the picker now displays the annotation time shifted by the user's UTC offset. If the user then tweaks the field and clicks "Apply", `new Date(sinceValue).toISOString()` re-reads it as local, applying a filter offset by the tz gap from what the "latest annotation" button just applied.
- **Root cause**: Mixing UTC ISO strings with the local-time semantics of `datetime-local` without offset conversion.
- **Impact**: UX — confusing/incorrect "since" boundary near timezone-sensitive edges (users far from UTC).
- **Fix sketch**: Convert to a local `datetime-local` string before assigning to `sinceValue` (subtract `getTimezoneOffset()`), or drop the `setSinceValue` line since the filter is already applied directly.

## 5. Dead code: three of four lifecycle SVG icons (and a second StatusIcon) are unused
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/agents/sub_executions/components/ExecutionLifecycleIcons.tsx:34-184
- **Scenario**: Grep across `personas/src` shows the only external import of this module is `RunningIcon` (in `replay/ReplayTerminalPanel.tsx`). `IdleIcon`, `CompletedIcon`, `FailedIcon`, and the module's own `StatusIcon` are referenced *only* within this file (StatusIcon switches over the other three). Consumers of an execution-status icon use the unrelated `StatusIcon` from `runnerTypes.tsx` (e.g. `ExecutionSummaryCard`) or `RunnerHeader`. So ~130 of the file's 185 lines are unreachable.
- **Root cause**: A richer animated icon set was built but only `RunningIcon` was ever wired up; the rest was left behind.
- **Impact**: Maintainability — dead SVG/animation code plus a name-colliding second `StatusIcon` that invites wrong-import confusion.
- **Fix sketch**: Delete `IdleIcon`, `CompletedIcon`, `FailedIcon`, and this file's `StatusIcon`; keep `RunningIcon` (rename file to `RunningIcon.tsx` or fold into the running indicator). Verify no dynamic/string-keyed lookups first.

## 6. Duplicated "is failed status" predicate across five call sites
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/agents/sub_executions/libs/useBulkRerun.ts:69-71 + components/list/BulkRerunToolbar.tsx:22-24 + components/list/ExecutionList.tsx:225,233 + components/list/BulkRerunReport.tsx:33-40
- **Scenario**: The same `status === 'failed' || status === 'cancelled' || status === 'timeout'` test is re-written as `isFailedStatus` (useBulkRerun), `isFailed` (BulkRerunToolbar), inline twice in ExecutionList's `handleSelectAllFailed`/`handleSelectSinceTimestamp`, and inline in BulkRerunReport's regression/recovery filters. They must stay in lockstep but nothing enforces it — and finding #1 is a direct symptom of them drifting.
- **Root cause**: No shared status-classification helper for the executions feature.
- **Impact**: Maintainability + latent bugs — a new terminal status (e.g. `errored`) would have to be added in 5 places.
- **Fix sketch**: Export a single `isFailedExecutionStatus(status)` (and companion `isSuccessStatus`) from a `libs/executionStatus.ts` and import it everywhere.

## 7. Cancelled-summary + resume UI block is duplicated between PersonaRunner and ExecutionSummaryCard
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/agents/sub_executions/components/runner/PersonaRunner.tsx:189-203 + detail/views/ExecutionSummaryCard.tsx:93-168
- **Scenario**: Both render the same status/duration/cost header and the same "stopped while running <tool> + Resume from here" block (identical Tailwind classes, icons, and `t.agents.executions.stopped_while_running` / `resume_from_here` tokens). PersonaRunner reads a parsed summary-line object; ExecutionSummaryCard reads the `ExecutionSummary` hook shape — but the presentation is copy-pasted.
- **Root cause**: The summary card component was introduced but PersonaRunner kept its own inline variant instead of adopting it.
- **Impact**: Maintainability — style/behavior changes (e.g. resume affordance) must be made twice and can diverge.
- **Fix sketch**: Have PersonaRunner map its parsed summary into the `ExecutionSummary` shape and render `ExecutionSummaryCard`, or extract the shared status-header + resume footer into one presentational subcomponent.

## 8. Annotation Save button shows "Saved" while the save is still in flight
- **Lens**: code-refactor
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/agents/sub_executions/components/AnnotationEditor.tsx:186-193
- **Scenario**: `{saving ? a.annotation_saved : a.annotation_save}` — while the async `onSave` is pending, the label reads the *completed* token `annotation_saved` ("Saved") rather than an in-progress "Saving…". There is no distinct pending state; the button just flips straight to "Saved" and back to "Save".
- **Root cause**: Reuse of the terminal-state token for the transient loading state.
- **Impact**: UX — misleading feedback; on a slow save the user sees "Saved" before the write actually resolves.
- **Fix sketch**: Add/point to a `annotation_saving` token and render it for the `saving` branch; keep `annotation_saved` for a brief post-success confirmation if desired.
