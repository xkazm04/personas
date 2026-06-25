# Execution Runner & Inspector — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: execution-runner-and-inspector | Group: Execution Engine
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. Idempotency key is regenerated every call, so the backend dedup never fires — a timed-out run, then a retry, double-spawns (double API spend)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race / silent-failure (duplicate execution, orphaned run)
- **File**: src/stores/slices/agents/executionSlice.ts:307 (also 309-316, 356-366); src/api/agents/executions.ts:50-65; src/lib/tauriInvoke.ts:269-272
- **Scenario**: User clicks Run. `execute_persona_inner` creates the row and `state.engine.start_execution(...).await`s; under queue-mutex contention or a slow CLI spawn this exceeds the 90 s IPC timeout. `invokeWithTimeout` rejects with `InvokeTimeoutError`; the slice `catch` runs `markFailed` + resets state. The backend execution is, however, already spawned and running. The user (seeing the error) clicks Run again → `executePersona` mints a **fresh** `crypto.randomUUID()` (line 307) → the backend `create_with_idempotency` sees a new key → a **second** execution spawns. Two CLI runs now burn credits for one logical request.
- **Root cause**: The idempotency key is generated *inside* the slice action on every invocation. The in-flight dedup (`inflightByKey`) only collapses concurrent calls sharing the same key; once the first settles/times out the key is deleted, so a sequential retry never matches. The backend feature added "so a timeout-retry returns the existing execution" (executions.rs:333-345) is therefore unreachable from this path. Additionally, on the initial timeout the slice never set `activeExecutionId` (the `await` threw before line 345), so the first run is orphaned — its output/terminal status are discarded by the UI.
- **Impact**: Duplicate executions = doubled token/$ spend and duplicate side-effects (messages, events, memories). First run orphaned: cost incurred, output invisible.
- **Fix sketch**: Derive a stable idempotency key per logical run attempt (e.g. hash of personaId+inputData+useCaseId, or persist the key in slice state across the retry) so a retry reuses it and the backend returns the existing execution. On `InvokeTimeoutError`, do not hard-fail — keep `isExecuting` and poll/recover the most-recent running execution for that persona before allowing a fresh spawn.
- **Value**: impact=7 effort=2

## 2. Switching personas (or startup recovery) drops the focused run's terminal status event — `isExecuting` stays pinned for up to 30 min, forcing every new run into background mode
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: lifecycle-state race (stale "running" state)
- **File**: src/hooks/execution/usePersonaExecution.ts:29-34 (isOwnerAligned), 51-52, 230-240 (persona-switch cleanup), 254-291 (bg listener skip at :267); src/stores/slices/agents/runLifecycle.ts:20
- **Scenario**: User starts a foreground run on persona P, then navigates to persona Q while it runs. The persona-change effect (line 231-239) calls `cleanup()`, tearing down the correlated CLI stream that owns `handleStatusEvent`. `activeExecutionId` is **not** cleared on persona switch. When P completes, the only remaining `EXECUTION_STATUS` listener is the background one (line 259), which returns early because `store.activeExecutionId === execId` (line 267) — P is still the active id but isn't in `backgroundExecutions`. So P's terminal event is processed by *neither* handler. `finishExecution` never runs; `isExecuting` remains `true` and the `personas:active-execution` recovery key is never cleared.
- **Root cause**: Two listeners partition responsibility by "focused vs background", but a focused execution the user *navigated away from* falls into the gap: the focused listener was torn down, and the background listener explicitly excludes the active id. Recovery only happens via the 30-min `RUN_MAX_DURATION_MS` safety timeout (runLifecycle.ts:20) or the backend zombie sweep (which only fires for genuinely stalled runs, not normal completions).
- **Impact**: For up to 30 minutes after a normal completion, `executePersona` reads `isAlreadyExecuting=true` and silently forces all subsequent runs into background mode (no terminal output). A page refresh in that window re-"recovers" an already-finished execution.
- **Fix sketch**: Keep a persistent (non-cleanup'd) terminal-status listener keyed by `execution_id` for the active execution even after persona switch, OR have the background listener also handle `activeExecutionId === execId` when the correlated stream has been detached. Clear `activeExecutionId`/`isExecuting` when the owning execution reaches terminal regardless of which persona is selected.
- **Value**: impact=7 effort=3

## 3. `cancelExecution` always tears down foreground state in `finally` even when the backend cancel rejected — still-running execution is orphaned and keeps burning credits while the UI shows idle
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: recovery gap / error handling
- **File**: src/stores/slices/agents/executionSlice.ts:369-399 (caller id at :371, finally at :379-398)
- **Scenario**: User cancels the active run. The IPC `cancel_execution` rejects (backend unreachable, timeout, or `verify_execution_owner` Auth error). The `catch` logs the error, then the `finally` unconditionally runs `markCancelled` + sets `activeExecutionId:null, isExecuting:false` and removes the localStorage recovery key ("Always reset execution state regardless of API success/failure"). The execution is still alive on the backend but the UI has fully abandoned it — no active id, no recovery key, no listener.
- **Root cause**: `finally` treats cancel as best-effort UI reset without distinguishing a confirmed backend cancel from a failed one. Secondary defect: `callerPersonaId = get().executionPersonaId ?? ''` (line 371) assumes the cancelled id belongs to the *foreground* persona; cancelling any non-foreground (e.g. background) execution sends the wrong `caller_persona_id`, so the backend ownership check rejects and the cancel silently no-ops while the foreground state is still torn down.
- **Impact**: Orphaned execution continues consuming API credits with no UI affordance to see or stop it; lost recovery key prevents post-refresh reconciliation. Wrong-persona cancels silently fail.
- **Fix sketch**: Only reset state when the backend confirms the cancel (or the execution is confirmed terminal). On reject, keep `activeExecutionId`/recovery key and surface a retry. Look up the target execution's real `persona_id` (it's already in `backgroundExecutions`, or fetch it) for `caller_persona_id` instead of assuming the foreground persona.
- **Value**: impact=6 effort=3

## 4. Dead-letter persistence drops output/tool-steps/outcome/session-id — a completed run whose DB write fails 4× is recorded as empty `Failed` yet still billed
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: partial-failure persistence / silent data loss
- **File**: src-tauri/src/engine/execution_engine/persist.rs:62-83 (and 188-202)
- **Scenario**: A run finishes successfully; `persist_status_update` is called with `status=Completed`, `output_data=Some(...)`, `tool_steps`, `business_outcome`, `claude_session_id`. The DB write fails 4× (lock contention / disk). The dead-letter branch then writes `UpdateExecutionStatus { status: Failed, error_message, duration_ms, input_tokens, output_tokens, cost_usd, ..Default::default() }`. `Default` nulls `output_data`, `tool_steps`, `business_outcome`, and `claude_session_id`.
- **Root cause**: The dead-letter update carries only cost/token/duration, deliberately discarding the payload fields. The completed result is destroyed and reborn as a `Failed` row with no output, no business outcome, and no session id (so warm-session resume/continuation linkage is also lost) — while `cost_usd` is still attributed, producing a "Failed but it cost money and produced nothing" inconsistency.
- **Impact**: Permanent, silent loss of a successful run's output and provenance; misleading Failed status; broken resume linkage. Rare trigger but unrecoverable when it hits.
- **Fix sketch**: Preserve the original `update`'s `output_data`, `tool_steps`, `business_outcome`, and `claude_session_id` in the dead-letter write (clone the relevant fields instead of `..Default::default()`), and set a distinct error like "result persisted partially: status write failed" so the row reflects that work completed.
- **Value**: impact=7 effort=3

## 5. Prompt-cache-hit ratio is computed with two different denominators across surfaces — the same execution shows different "cache hit %"
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: undocumented metric definition / inconsistent magic formula
- **File**: src/features/agents/sub_executions/detail/inspector/inspectorShared.tsx:25-27 vs src/features/plugins/fleet/sub_grid/FleetTokenSummaryBar.tsx:63-64
- **Scenario**: The per-execution Inspector strip computes `cacheHitPct = cache_read / (input_tokens + cache_read + cache_creation)`. The Fleet token bar computes `cacheHitPct = cache_read / (input_tokens + cache_read)` — it excludes `cache_creation` from the denominator. For a cache-priming run (large `cache_creation`), the two surfaces report materially different percentages for identical underlying token counts, with no documentation of which definition is "the" cache-hit ratio.
- **Root cause**: There is no shared, documented helper for "prompt-cache hit ratio"; each surface re-derives the formula with a different denominator. The intended definition (cache_read over total input vs over reusable input) is unstated, so the inconsistency is invisible to reviewers.
- **Impact**: Users inspecting the same run in two places see conflicting cache efficiency numbers, eroding trust in cost/cache observability and making cache-tuning decisions unreliable. No crash, but wrong/confusing results — the exact metric this context exists to surface.
- **Fix sketch**: Extract one documented `cacheHitRatio({ input, cacheRead, cacheCreation })` helper with a comment defining the denominator (Anthropic usage: total input = input + cache_read + cache_creation; hit ratio = cache_read / total). Use it in both the Inspector strip and the Fleet bar.
- **Value**: impact=4 effort=2
