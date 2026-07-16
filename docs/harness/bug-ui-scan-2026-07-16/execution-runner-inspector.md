# Execution Runner & Inspector — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 3, Medium: 1, Low: 1)

## 1. Queue promotion ignores the resource-pressure throttle
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/queue.rs:342 (also :390)
- **Scenario**: Host CPU/memory crosses the governor's high watermark while 4 executions run and 10 more are queued. The governor calls `set_resource_throttled(true)`, so new `admit()` calls correctly queue instead of run. But the moment any running execution completes, `drain_and_start_next` (engine/mod.rs:1756) calls `drain_next_global()` → `drain_next()`, which checks `quota_available()` and capacity but **never `resource_available()`** — the queued execution is promoted and spawned onto the stressed host.
- **Root cause**: The resource gate was added to `admit()` (queue.rs:267) but not mirrored in the two drain paths, unlike the quota gate which guards all three. The design assumption "admission is paused" only holds for first admission, not for promotions, and with a non-empty queue promotions are the dominant path.
- **Impact**: Under sustained pressure the throttle changes nothing in steady state — every completion back-fills a slot, keeping the host at full concurrency and defeating the OOM protection the governor exists for (the exact "pile onto a stressed host" scenario the doc comment on `resource_throttled` warns about).
- **Fix sketch**: Add `if !self.resource_available() { return None; }` at the top of `drain_next()` (which `drain_next_global()` delegates to), matching the quota check. Ensure the governor triggers a drain pass when it un-throttles so queued work isn't stranded until the next completion.

## 2. Idempotency dedup of an already-finished run pins the UI in "running" for 30 minutes
- **Severity**: High
- **Category**: bug
- **File**: src/stores/slices/agents/executionSlice.ts:431-477
- **Scenario**: A foreground `executePersona` IPC times out (backend actually spawned the run — this is exactly why the key is kept on `InvokeTimeoutError`, line 487). The short run completes on the backend. The user clicks Run again within the 5-min reuse window: the retry reuses the idempotency key, the backend's `create_with_idempotency` returns the **already-completed** execution and skips the spawn (executions.rs:359-368). The frontend then unconditionally sets `activeExecutionId`, `phase: 'running'`, and persists `isExecuting: true` to localStorage.
- **Root cause**: The success path assumes the returned execution is live and will emit future `EXECUTION_STATUS` events. The recovery path (line 246) checks `TERMINAL_STATUS_SET.has(execution.status)` before trusting persisted state, but the dedup return path performs no such check — yet it is the one path explicitly designed to hand back a run that may have finished already.
- **Impact**: No terminal event ever arrives, so `finishExecution` never runs: the runner shows a phantom active execution, every subsequent run is silently forced into background mode, and the state only clears via the 30-minute `runLifecycle` safety timeout (which additionally surfaces a bogus "Run timed out" error for a run that succeeded).
- **Fix sketch**: After `await executePersona(...)`, if `TERMINAL_STATUS_SET.has(execution.status)` (or `execution.completed_at` is set), skip the active-state/localStorage write, clear `pendingForegroundIdem`, call the finish path (or `upsertFinishedExecution`) and surface the result immediately.

## 3. Pipeline persona nodes bypass the budget cap and connector-readiness gate
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/pipeline_executor.rs:403-443
- **Scenario**: A persona has `max_budget_usd` set and has already exceeded its monthly spend, or has an unresolved connector credential (`setup_status = needs_credentials`). A team pipeline containing that persona runs (manually or on a trigger): `run_persona_node` calls `exec_repo::create` + `engine.start_execution` directly, never routing through `execute_persona_inner`.
- **Root cause**: The budget check (executions.rs:318-330) and the live connector-readiness gate (executions.rs:203-231) live only in `execute_persona_inner`; the pipeline executor was extracted with its own spawn path on the assumption all admission policy lives in the engine, but those two gates are enforced at the command layer.
- **Impact**: Monthly budget ceilings are silently not enforced for pipeline runs — a scheduled team pipeline keeps burning real API spend past the user-set cap. Not-ready personas produce exactly the misleading free-form "value_delivered" output the readiness gate was built to block (the node "succeeds", gets auto-committed to team memory, and threads downstream).
- **Fix sketch**: Extract the budget + live-readiness checks into a shared pre-flight helper and call it in `run_persona_node` before `exec_repo::create`, failing the node with a clear error string ("budget exceeded" / "connectors need setup") instead of spawning.

## 4. Chain drill-down click fails silently
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/agents/sub_executions/detail/ExecutionDetail.tsx:39-43
- **Scenario**: In the Chain tab the user clicks a linked execution to drill down. If `getExecution` rejects — backend hiccup, execution row purged, or an ownership `AppError::Auth` — the promise is swallowed by `silentCatch('execution-detail:openChainExecution')` and `chainOpen` never sets.
- **Root cause**: Error handling delegated to a log-only catch; the component has no error/loading state for this fetch, so the design assumes the fetch always succeeds.
- **Impact**: The click does literally nothing — no modal, no spinner, no toast. The user retries, concludes the feature is broken, and has no signal about why. This is the only click-to-navigate action in the detail view with zero feedback on failure (contrast: the list fetch has `executionsError` + retry, dry-run has `errorMessage` in its modal).
- **Fix sketch**: Track a `chainOpenError`/loading pair; on failure show a small inline toast or the existing error-banner pattern ("Couldn't open execution — it may have been deleted"), and give the clicked row a brief pending state while the fetch is in flight.

## 5. Detail tab switcher has no tab semantics for keyboard/screen-reader users
- **Severity**: Low
- **Category**: ui
- **File**: src/features/agents/sub_executions/detail/ExecutionDetailTabs.tsx:30-70
- **Scenario**: A screen-reader or keyboard user opens an execution with all seven tabs visible (detail, director, inspector, trace, pipeline, chain, replay). The switcher renders plain `<button>`s in a `<div>` — no `role="tablist"`/`role="tab"`, no `aria-selected`, no arrow-key navigation — so the active tab is conveyed only by background color; hovering an inactive tab even *dims* it (`text-foreground` → `hover:text-foreground/95`).
- **Root cause**: The component styles a tab pattern without the corresponding ARIA/keyboard contract, and the selected state exists only visually (the tab panels also lack `role="tabpanel"`/`aria-labelledby` wiring in ExecutionDetail.tsx).
- **Impact**: Assistive-tech users can't tell which of up to seven views is active or that these buttons form one tab group; conditional tabs (Director/Chain/Replay) appearing and disappearing makes this worse since position can't be memorized. The inverted hover reads as an anti-affordance for everyone.
- **Fix sketch**: Add `role="tablist"` on the container, `role="tab"` + `aria-selected` + roving `tabIndex` with ArrowLeft/ArrowRight on the buttons, and `aria-controls`/`role="tabpanel"` on the content region; fix the hover class to brighten (e.g. `hover:bg-secondary/60`) rather than reduce opacity.
