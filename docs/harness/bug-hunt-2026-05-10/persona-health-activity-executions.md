# Bug Hunt — Persona Health, Activity & Executions

> Group: Personas Workspace
> Files scanned: 14 (literal `ExecutionsPage.tsx` / `ExecutionTraceView.tsx` / `HealthPage.tsx` / `ActivityFeed.tsx` not present — used analogues: `sub_executions/components/list/ExecutionList.tsx`, `detail/inspector/TraceInspector.tsx`, `sub_health/components/HealthTab.tsx`, `sub_activity/ActivityTab.tsx`)
> Total: 2C / 5H / 4M / 1L = 12 findings

---

## 1. `clearExecutionOutput` fires-and-forgets `cancelExecution` then resets local state in the same tick — engine cancel races local cleanup

- **Severity**: critical
- **Category**: race-condition
- **File**: `src/stores/slices/agents/executionSlice.ts:512-522`
- **Scenario**: User clicks "Clear" while a run is active. `clearExecutionOutput` calls `get().cancelExecution(activeId)` *without await*, then synchronously runs `executionSink.clear()` + `set({ activeExecutionId: null, executionPersonaId: null, ... })`. Inside `cancelExecution`'s `finally` (line 357-374), the code reads `get().activeExecutionId` to compute `lastExecutionId` and calls `fetchExecutions(get().selectedPersona?.id)` — but `activeExecutionId` is already `null` because `clearExecutionOutput` cleared it first.
- **Root cause**: Assumes the awaited path inside `cancelExecution.finally` will run before the next `set` from `clearExecutionOutput` completes. In practice, `clearExecutionOutput` returns synchronously and wipes state during the same microtask, leaving `lastExecutionId` (which Resume relies on) set to `null` and the `localStorage` key may be re-written incorrectly.
- **Impact**: Resume button no longer works after a Clear; backend cancel may also fire with stale `executionPersonaId === ''` (since `cancelExecution` reads `get().executionPersonaId ?? ''`).
- **Fix sketch**: `await get().cancelExecution(activeId)` in `clearExecutionOutput`, OR snapshot the IDs before scheduling cancel and pass them explicitly so the finally block doesn't reach into already-reset state.

## 2. Recovered-execution verification on store creation doesn't bound the verify call — a hung backend pins `executionVerificationFailed = false` until network timeout (could be minutes)

- **Severity**: critical
- **Category**: cleanup-gap
- **File**: `src/stores/slices/agents/executionSlice.ts:189-208`
- **Scenario**: Store is created (or HMR), recovery reads localStorage, the IIFE awaits `getExecution(activeExecutionId, ...)`. If the Tauri IPC hangs (engine deadlock, backend not yet ready), there is no timeout/abort — the await sits forever. `executionVerificationFailed` stays false, the UI shows a "running" execution that can't be cancelled (because the cancel command also hangs), and `isExecuting` stays locked.
- **Root cause**: No `Promise.race` with a deadline (e.g. 15s). Recovery assumes `getExecution` either resolves fast or throws, but on backend startup races it can pend indefinitely.
- **Impact**: First minute(s) after app launch with a stale recovered execution and a slow backend → app is wedged; user can't start a new run because `isAlreadyExecuting` is `true`.
- **Fix sketch**: Wrap `getExecution` in `Promise.race([call, timeout(15_000)])`; on timeout set `executionVerificationFailed: true` and exit. Also expose a "force clear" path that nukes localStorage without backend round-trip.

## 3. `finishExecution` runs `frontend_complete` middleware *after* reading `executionPersonaId` but before `set` clearing — store reset uses **post-middleware** values for some reads

- **Severity**: high
- **Category**: stale-closure
- **File**: `src/stores/slices/agents/executionSlice.ts:415-462`
- **Scenario**: Lines 415-419 destructure `chatStreaming, executionPersonaId, ...` from `get()` and call `finishChatStream(...)` *without await* (`void get().finishChatStream(...)`). On line 426 we re-read `get().executionPersonaId` for drift snapshot. Between the unawaited chat stream finalize and the second `get()`, any synchronous slice that mutates `executionPersonaId` (e.g. another middleware tick) would yield mismatched IDs across the two reads. The drift snapshot can attach to the wrong persona.
- **Root cause**: Two `get()` reads of the same field with side-effecting code (`finishChatStream`, middleware) between them.
- **Impact**: Drift events occasionally land under persona B when persona A's run actually completed; recent-executions snapshot belongs to a different agent.
- **Fix sketch**: Snapshot `const pidAtFinish = get().executionPersonaId` once at the top of `finishExecution` and use it consistently throughout.

## 4. `runFullHealthDigest` swallows individual persona failures into "partial" rows but `Promise.allSettled.rejected` still drops them silently

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/stores/slices/agents/healthCheckSlice.ts:160-168`
- **Scenario**: `checkSinglePersona` already catches its own errors and returns a partial row, so `Promise.allSettled` should never reject. But if `parseFeasibilityToHealthResult`/`parseJsonOrDefault` itself throws synchronously *before* the try/catch (e.g. malformed `design_context` triggers a panic in a downstream call), the rejection branch (`r.status !== 'fulfilled'`) silently drops that persona — the digest reports `agents_checked: N-1` and the user sees the broken persona simply missing.
- **Root cause**: The fall-through `if (r.status === 'fulfilled' && r.value)` has no else branch.
- **Impact**: User sees "all healthy" while a corrupt persona has vanished from the digest.
- **Fix sketch**: In the else branch, push a synthesized `partial` row with an `info` issue carrying the rejection reason, mirroring the catch-side fallback.

## 5. `HealthTab` auto-refresh latch resets on persona-id change but compares `selectedPersona?.id` — first render after persona load triggers `runHealthCheck` with stale `result` from previous persona

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/sub_health/components/HealthTab.tsx:14-28`
- **Scenario**: User switches persona. The first effect (line 15-23) runs *before* the latch-reset effect (line 26-28) on the same render commit; `healthCheck.phase === 'done'` and `healthCheck.result.checkedAt` still reference the previous persona's result, which is stale, so `runHealthCheck(newPersona)` fires immediately. But the latch is already `true` (from the previous persona's run), so the auto-refresh is **skipped** until the second persona switch — UX inconsistency. Conversely, if order flipped (latch reset first), every persona switch with stale data would auto-rerun and burn API quota.
- **Root cause**: Two effects with cross-cutting dependencies on `selectedPersona?.id`. Order-of-execution within React's effect queue is "as declared," but the latch reset and the staleness check both trigger on the same commit.
- **Impact**: Auto-refresh is either flaky (skips) or aggressive (re-runs on every switch); both are user-observable.
- **Fix sketch**: Combine into one effect that gates on `result.personaId === selectedPersona.id` AND staleness AND `!autoRefreshed.current`, then set the latch atomically.

## 6. `ActivityTab.loadData` uses 5 parallel `.catch(() => [])` — backend-down is invisible, user sees an empty feed instead of an error

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/agents/sub_activity/ActivityTab.tsx:43-49`
- **Scenario**: All five fetches (`listExecutions`, `listEvents`, `listMemories`, `listManualReviews`, `listMessages`) are wrapped in `.catch(() => [] as ...)`. If the Tauri backend is down or auth fails, every call rejects and the feed silently renders an empty state ("no activity") instead of an error toast — the user can't tell the difference between "this persona has no activity" and "the backend exploded."
- **Root cause**: Defensive catch swallows the failure entirely. No error state is plumbed into the component.
- **Impact**: Backend outages or auth-token invalidation read as "everything is fine, just empty."
- **Fix sketch**: Track a per-source failure flag, render a banner ("Could not load executions: <err>") at minimum for any non-empty subset of failures. At least log to `silentCatch` so a Sentry breadcrumb is recorded.

## 7. `ActivityTab` `handleHeatmapDayClick` declared *after* the early `if (!selectedPersona) return` — violates React rules-of-hooks

- **Severity**: high
- **Category**: edge-case
- **File**: `src/features/agents/sub_activity/ActivityTab.tsx:150-167`
- **Scenario**: `if (!selectedPersona)` returns early at line 150-156, then `useCallback(handleHeatmapDayClick)` is declared at line 158. On any render where `selectedPersona` is null, this hook is skipped; on the next render where it's non-null, the hook count differs → React throws "rendered more hooks than the previous render" and the component crashes.
- **Root cause**: Hook called after a conditional return.
- **Impact**: Selecting a persona for the first time after the activity tab is mounted with no persona will crash the tab.
- **Fix sketch**: Move `useCallback` above the `if (!selectedPersona) return` guard.

## 8. Background-execution promotion has no listener cleanup when the active execution ends — leaks `BackgroundExecution` rows

- **Severity**: medium
- **Category**: memory-leak
- **File**: `src/stores/slices/agents/executionSlice.ts:308-321, 540-552`
- **Scenario**: When `runInBackground` is true, `executePersona` pushes a `BackgroundExecution` to `backgroundExecutions[]`. There's `updateBackgroundExecution` and `removeBackgroundExecution`, but neither is invoked from `finishExecution` or `cancelExecution` for *background* runs — only the *active* run gets cleaned up. If the event listener that fires `removeBackgroundExecution` (presumably wired elsewhere) drops a `done` event (race during persona switch / HMR), the background row is permanent.
- **Root cause**: Two parallel cleanup tracks (lifecycle for active, event-driven for background) with no reconciliation sweep.
- **Impact**: After a long session with many background runs, the array grows unboundedly and the mini-player or runner header re-renders for every change.
- **Fix sketch**: Periodic sweep that drops `backgroundExecutions` whose `executionId` is in `TERMINAL_STATUS_SET` per backend probe; or add a TTL like `completedOutputs`.

## 9. `cancelExecution` reads `get().activeExecutionId` AFTER calling `executionLifecycle.markCancelled(set)` to compute `lastId` — but `markCancelled` may already have nulled it

- **Severity**: medium
- **Category**: stale-closure
- **File**: `src/stores/slices/agents/executionSlice.ts:367-371`
- **Scenario**: Comment says "Preserve the execution ID for Resume before clearing active state" — line 367 reads `lastId = get().activeExecutionId` immediately followed by `executionLifecycle.markCancelled(set)`. If `runLifecycle` ever decides to clear `activeExecutionId` (currently it likely only flips `isExecuting`), Resume breaks. The bug is latent — depends on `runLifecycle` semantics.
- **Root cause**: Assumes `markCancelled` only flips a flag; not enforced by types.
- **Impact**: Future refactor to runLifecycle (e.g. resetting executionId there) silently breaks Resume with no test coverage.
- **Fix sketch**: Capture `lastId` *before* any side-effecting call, or have `markCancelled` return the captured id explicitly.

## 10. `get_execution_log_lines` "tail mode" reads the entire file into a ring buffer per call — pathological for multi-GB logs

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/commands/execution/executions.rs:592-605`
- **Scenario**: When `offset` is `None`, the code iterates **every** line of the log file with `BufReader::lines()` to collect the last 500 matching ones. A long-running execution can produce GB-scale log files (`[STDOUT] ` lines from a chatty tool). Each tail call walks the entire file from the start. UI auto-refresh calling this every few seconds means the disk is read repeatedly.
- **Root cause**: No reverse-line-iterator / file-size-based seek-backwards strategy.
- **Impact**: Slow log-tab on large logs; high CPU + IO when the panel auto-refreshes.
- **Fix sketch**: Use `Seek` to start near `file_len - 256KB`, scan forward from a newline boundary, then ring-buffer. Or memoize file size and skip if unchanged since last call.

## 11. `cancel_execution` IPC: error in `engine.cancel_execution` is swallowed (returns Ok regardless of what the engine reported)

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/execution/executions.rs:511-523`
- **Scenario**: `engine.cancel_execution` returns a `bool` indicating whether anything was cancelled. The handler logs `tracing::warn!` if false but always returns `Ok(())`. If the engine internally panicked or the DB write failed (the engine is documented to handle "flag, DB write, process kill, tracker cleanup, and abort"), there's no surfacing — the frontend treats cancel as successful and clears local state, leaving an orphan engine process.
- **Root cause**: `Ok(())` regardless of `cancelled` value.
- **Impact**: User sees "cancelled" UI while the Claude CLI process keeps running, consuming API budget.
- **Fix sketch**: Return `Err` if `cancelled == false` AND the execution status in DB isn't already terminal; let frontend retry.

## 12. `HealthIssueCard.handleApply` calls `onApplyFix` then unconditionally `onResolved(issue.id)` if `ok` — but resolution is local-only; on next digest run the same issue ID re-appears

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/agents/health/HealthIssueCard.tsx:34-37`, intersects `healthCheckSlice.ts:54` (deterministic `makeIssueId`)
- **Scenario**: User applies a fix, `onResolved(id)` flips a local `resolved: true` flag in the digest result. Next time `runFullHealthDigest` runs, `parseFeasibilityToHealthResult` re-derives issues from the API response with deterministic IDs. If the underlying problem still exists (the fix didn't actually take, or it regressed), the issue reappears — but the previous-render's `resolved: true` is overwritten with `false`.
- **Root cause**: Resolution state isn't persisted across digest re-runs; the comment at line 51-52 of healthCheckSlice acknowledges deterministic IDs but doesn't persist the resolved set.
- **Impact**: User feels they "fixed" something only to see it return on the next refresh.
- **Fix sketch**: Persist a `resolvedIssueIds: Set<string>` on the slice (localStorage or DB), and have `parseFeasibilityToHealthResult` consult it when assigning the `resolved` flag.
