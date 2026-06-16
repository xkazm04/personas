# Bug Hunter — Execution Runner & Inspector

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: execution-runner-inspector | Group: Execution Engine

## 1. Queue stalls forever when a promoted execution's context is missing (lost drain → permanent starvation)
- **Severity**: Critical
- **Category**: ⚡ Race condition / 🔮 Latent failure (queue starvation)
- **File**: `src-tauri/src/engine/mod.rs:1899` (and the function `drain_and_start_next`, 1668–1905)
- **Scenario**: An execution finishes and frees a slot. `drain_and_start_next` calls `tracker.drain_next_global()`, which **dequeues the candidate AND registers it as running** (`drain_next` → `add_running`, see queue.rs:376) atomically. It then looks up the saved `QueuedExecutionContext` from `queued_contexts`. If that context is absent — e.g. a `cancel_execution` ran `remove_queued` + removed the context *after* `drain_next_global` had already popped the entry from the per-persona `VecDeque` but the cancel's `remove_queued` found nothing (it was already dequeued), or any path where the context map and the queue diverge — the `else` branch only calls `remove_running(&persona_id, &exec_id)` and returns. It does **not** re-invoke `drain_and_start_next`.
- **Root cause**: The drain consumes a queued slot and a running slot, but the "context missing" recovery releases the running slot without re-attempting the drain. Every other terminal path (success/panic/cancel) re-drains; this one dead-ends.
- **Impact**: A single divergence between `queues` and `queued_contexts` permanently strands all remaining queued executions for that persona (and, because the global cap accounting is correct but no further drain is triggered, the next promotion only happens when an *unrelated* running execution completes). Under a busy fleet the queue silently stops draining; executions sit in `queued` forever. The zombie reaper (executions.rs:1452) only sweeps `status='running'`, so these never self-heal and never notify.
- **Fix sketch**: In the `else` branch (mod.rs:1899–1902), after `remove_running`, recursively call `drain_and_start_next(...)` (or loop) so the freed slot is offered to the next candidate. Also write the orphaned execution to `failed`/`incomplete` so it doesn't linger in `queued`.

## 2. `queued` executions are never reaped — stuck forever during indefinite/aligned quota cooldowns
- **Severity**: High
- **Category**: 🔮 Latent failure (stuck state, no recovery)
- **File**: `src-tauri/src/db/repos/execution/executions.rs:1452` (`sweep_zombie_executions`); interacts with `mod.rs:2023` (cooldown alignment) and `queue.rs:343,391` (drains held during cooldown)
- **Scenario**: When an execution fails against a session limit, `handle_execution_result` arms `set_quota_cooldown` with a deadline aligned to the CLI's reported reset, clamped up to **6 hours** (mod.rs:2025). While the cooldown is active, both `admit` and `drain_next_global` refuse to promote (queue.rs:266,343,391), so newly-submitted work piles up in `status='queued'`. `sweep_zombie_executions` only selects `WHERE status = 'running'`, so queued rows are never transitioned to a terminal state regardless of age.
- **Root cause**: The zombie sweep's definition of "stuck" excludes the `queued` state, but the quota/resource gates can legitimately hold executions in `queued` for hours. There is no upper bound or reaper on queue residency.
- **Impact**: After a multi-hour session-limit window, executions can be stranded in `queued` indefinitely (e.g. if the app restarts mid-cooldown and re-admit at mod.rs:705 re-queues them, or if the context is lost). The Activity feed counts them under "Running" (`ExecutionCounts.running` includes `pending`, execution.rs:198), so the UI shows phantom in-flight work that never resolves and never errors.
- **Fix sketch**: Extend `sweep_zombie_executions` to also transition `queued` rows older than a (larger) threshold to `incomplete` when no live tracker slot/context backs them, or add a dedicated queue-residency reaper. Bound max queue wait independent of the cooldown deadline.

## 3. Pipeline node poll times out at 600 s even while its execution is still legitimately `queued`
- **Severity**: High
- **Category**: 🕳️ Edge case / 💀 Silent failure (success theater / false failure)
- **File**: `src-tauri/src/engine/pipeline_executor.rs:411-483` (`run_persona_node` poll loop)
- **Scenario**: `run_persona_node` calls `engine.start_execution(...)`, which may **queue** the execution (global cap of 4, per-persona cap, or an active quota cooldown) rather than run it. The poll loop then sleeps 1 s × 600 and only treats `"completed"` / `"failed"` / `"cancelled"` as terminal. A row sitting in `"queued"` (or paused by a multi-hour quota cooldown) keeps looping; after 600 s the node is force-marked `"failed"` with `"Execution timed out"` — even though the underlying execution may still be queued and will later run to completion.
- **Root cause**: The poll's fixed 600 s wall-clock budget counts queue wait time as run time, and there is no awareness of the `queued` state. A node behind the global concurrency cap during a busy pipeline can exhaust the budget before it ever starts.
- **Impact**: Pipelines spuriously fail nodes (and mark all downstream nodes `skipped`, pipeline_executor.rs:907-924) under load or during quota cooldowns. Worse, the engine execution it abandoned keeps running and consuming credits after the pipeline declared the node failed — the node's `cancel` is only issued on the explicit cancel path, not on poll timeout, so a real run completes invisibly (cost incurred, output discarded).
- **Fix sketch**: Treat `queued`/`pending` as non-terminal-but-not-elapsing; only start the 600 s timer once the row reaches `running`. On timeout, cancel the underlying execution before marking the node failed so no orphaned run keeps spending.

## 4. Early-return failure paths in the runner use the unconditional `update_status`, racing the cancel safety-net
- **Severity**: Medium
- **Category**: ⚡ Race condition (lost-cancel / status clobber)
- **File**: `src-tauri/src/engine/runner/mod.rs:1580` (and 475, 997, 1227, 1666); contrast `execution_engine/persist.rs:138` and `executions.rs:863`
- **Scenario**: The canonical completion path (`handle_execution_result` → `persist_status_if_not_final`) carefully refuses to overwrite a `cancelled` row (executions.rs:863 special-cases the cancelled sink). But several runner early-return paths (validation failure at 1580, credential/spawn failures at 475/997/1227) write status via the **unconditional** `exec_repo::update_status`, which sets `status = ?1` with no `WHERE status = 'running'` guard. If a user clicks Stop in the narrow window after one of these failure writes is queued, `cancel_execution`'s `persist_status_if_running` writes `cancelled`, then (or before) the runner's unconditional write stamps `failed`, and the two can land in either order.
- **Root cause**: Two write paths with different concurrency discipline target the same row. The conditional CAS was retrofitted onto the main completion path but not the runner's early-exit writes.
- **Impact**: A user-cancelled execution can be reported as `failed` (or a failed one as `cancelled`), corrupting the lifecycle record, budget attribution, and the healing/retry decision (a `failed` status triggers healing retries that a `cancelled` would not — burning credits the user tried to stop).
- **Fix sketch**: Route every runner status write through `update_status_if_not_final` / `update_status_if_running` (the conditional variants), reserving unconditional `update_status` for the initial `running` transition only.

## 5. Cache-read tokens are dropped from the cache-hit ratio on cancelled/failed runs, and never persisted via the cancel branch
- **Severity**: Low
- **Category**: 💀 Silent failure (metric miscounting)
- **File**: `src-tauri/src/engine/runner/mod.rs:2716-2728` (`set_cache_tokens`) + `src-tauri/src/engine/mod.rs:1059-1064` (cancel-branch metrics) + `src/features/.../inspector/ExecutionInspector.tsx:26`
- **Scenario**: Prompt-cache tokens are written by a *separate* column-scoped call `set_cache_tokens` inside the runner's finalize block, gated on `cache_read_tokens > 0 || cache_creation_tokens > 0` and only reached if `run_execution_with_ceiling` runs its finalize to completion. The cancel branch in `mod.rs` (1049-1068) persists `cost_usd`, `input_tokens`, `output_tokens` but has no path to write cache tokens; if a cancel kills the CLI mid-stream the finalize that calls `set_cache_tokens` may not run. The inspector then computes `cacheHitPct = cacheRead / (input_tokens + cacheRead + cacheCreation)` (ExecutionInspector.tsx:26-28) — with `cacheRead`/`cacheCreation` left at the default 0 but `input_tokens` populated, the displayed cache-hit ratio reads 0% even when the run was heavily cache-served.
- **Root cause**: Token accounting is split across two write paths (status write vs. column-scoped cache write) with no shared transaction; the cancel/partial-finalize paths only cover one of them.
- **Impact**: Cache-hit ratio (a headline cost-observability metric) is understated to 0% for cancelled and abnormally-terminated runs, making cache effectiveness and cost attribution misleading exactly for the long/expensive runs users are most likely to cancel.
- **Fix sketch**: Fold `cache_read_tokens`/`cache_creation_tokens` into `UpdateExecutionStatus` and the conditional status write so they persist atomically with the final status on every terminal path (including cancel), instead of a separate best-effort call only on the happy path.
