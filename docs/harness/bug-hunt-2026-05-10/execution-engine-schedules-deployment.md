# Bug Hunt — Execution Engine, Schedules & Deployment

> Group: Pipelines, Recipes & Execution
> Files scanned: 11 (3 listed paths missing: SchedulesPage.tsx, DeploymentPage.tsx, CloudTargetCard.tsx do not exist in repo; substituted runner/mod.rs, cli_process.rs, mod.rs cancel paths, subscription.rs run_single, project_tracking/scheduler.rs, platforms/deploy.rs)
> Total: 4C / 6H / 4M / 1L = 15 findings

---

## 1. Streaming select! has no cancellation arm — kill leaves stream blocked on next read

- **Severity**: critical
- **Category**: cancel-leak
- **File**: `src-tauri/src/engine/runner/mod.rs:1438` (inside `tokio::select!` at 1439)
- **Scenario**: User clicks Cancel during a normal stream. `cancel_execution` flips the flag and calls `kill_process(pid)` (line 982). `taskkill /F /T` on Windows reaps the child, eventually closing stdout — at which point `read_line_limited` returns `Ok(None)` and the loop breaks. But the `select!` has only two arms (`read_line_limited` and `heartbeat_interval.tick()`); it never polls `cancelled`. Until the OS actually closes the pipe (which can take seconds on Windows for orphaned grand-children with `/T`), the runner sits inside `read_line_limited` waiting for data. If the kill fails or the pipe lingers, the streaming closure never returns and the 5-second cancel grace-period (mod.rs:987) elapses, falling into the abort path that may double-write status.
- **Root cause**: `cancelled` Arc is checked at three explicit gate points (1021, 1182, 1273) but not inside the streaming hot loop, so cancel is implicit-via-EOF rather than direct.
- **Impact**: Cancel takes 5+ seconds to clean up, sometimes longer; abort fallback at engine/mod.rs:993 is hit routinely; users see "cancelling…" UI hang.
- **Fix sketch**: Add a third arm `_ = wait_for_cancel(&cancelled) => break;` (a small async helper that polls the AtomicBool with `tokio::time::sleep(50ms)` or use a `Notify`/oneshot signal set by `cancel_execution`).

## 2. Healing-retry sleep is uncancellable — kills race lose to delayed retries

- **Severity**: critical
- **Category**: cancel-leak
- **File**: `src-tauri/src/engine/mod.rs:2664` (`spawn_delayed_retry` body), 2674 `tokio::time::sleep(delay).await`
- **Scenario**: A run fails with a rate-limit. `spawn_delayed_retry` is fired with `delay_secs = 240`. During the 4-minute sleep there is **no cancellation flag, no JoinHandle stored, no entry in `tasks` map**. User cancels the original execution (or even deletes the persona); the original task and its DB row go away, but the orphaned retry task fires `create_retry`, registers a new flag at line 2763, and starts spawning a Claude CLI for a persona that may have just been deleted. After 5 minutes it lands on a CASCADE-deleted persona row and dies dirty.
- **Root cause**: `spawn_delayed_retry` is fire-and-forget; its handle is dropped at the spawn site (mod.rs:1219, 2253, 2276). The retry has no upstream cancellation linkage to the persona/original execution.
- **Impact**: Retries survive persona deletion, exec cancellation, and app shutdown for up to MAX_BACKOFF_SECS (300s). Wasted API spend, status-write failures on missing rows, possible secondary panics.
- **Fix sketch**: Register a cancel-flag for the *retry* in `cancelled_flags` keyed by `original_exec_id` BEFORE the sleep; replace `sleep` with `tokio::select! { _ = sleep(delay) => {}, _ = cancel_signal => return; }`. Store the JoinHandle in a per-persona retry-handles map so persona deletion can abort pending retries.

## 3. Subscription tick uses default `MissedTickBehavior::Burst` — overrun causes tick stampede

- **Severity**: critical
- **Category**: schedule-overrun
- **File**: `src-tauri/src/engine/subscription.rs:1050` and `:1066`
- **Scenario**: A subscription's `tick()` blocks for > `interval` (e.g. trigger_scheduler_tick taking 2× interval during DB contention). The `tokio::time::interval` was created without `set_missed_tick_behavior(Delay|Skip)`. After the slow tick returns, the next two-three `tick().await` calls return *immediately* in burst mode, and the same N triggers are evaluated 2-3× back-to-back inside one second. Combined with the SQL-claim race already documented at line 1611, multiple instances of the same trigger can squeak through if any non-`mark_triggered` path participates (event publish before mark for legacy paths, or backfill loops).
- **Root cause**: Default tokio behavior is `Burst`. The line 1170 warn ("Tick overrun") even logs the symptom but never adjusts behavior.
- **Impact**: After any slow tick (DB stall, file-watcher backlog), a flurry of duplicated polling/scheduler ticks runs, causing duplicate event publishes for race-vulnerable triggers and multiplying load right when the system is already strained.
- **Fix sketch**: After both `interval(...)` calls (line 1050, 1066) add `interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);`. Same fix in `project_tracking/scheduler.rs:48`.

## 4. read_line_limited 5-min watchdog returns `Ok(None)` indistinguishable from real EOF — runner waits forever

- **Severity**: critical
- **Category**: silent-failure
- **File**: `src-tauri/src/engine/cli_process.rs:55-60` and `runner/mod.rs:1800`
- **Scenario**: A Claude CLI subagent stalls (no stdout for 5 minutes). `read_line_limited` hits LINE_READ_TIMEOUT (300s). Because `line_buf` is empty, it returns `Ok(None)`. Caller at runner/mod.rs:1800 treats `Ok(None)` as EOF and breaks out of the streaming loop. We exit the `tokio::time::timeout(timeout_duration, ...)` Ok-side, so `stream_result.is_err() == false`, `timed_out == false` is set at line 1880. We then call `driver.wait()` at line 1895 — which blocks until the still-alive child actually exits. There is no kill on the read-watchdog path. The execution can hang indefinitely (until the 660s hard timeout — but we've already exited that wrapper!).
- **Root cause**: Conflating "no newline within 5 min" with EOF. The empty-buffer case loses the watchdog signal entirely.
- **Impact**: Long-stalled agents block executions forever, hold the persona's concurrency slot, and leak child processes. The whole queue downstream of the persona stalls.
- **Fix sketch**: Have `read_line_limited` return a third state — `Ok(LineRead::WatchdogTimeout)` — that the caller maps to "kill child, finalize as TimedOut". Or define a stale activity check in the heartbeat arm that calls `driver.kill()` if `last_activity.elapsed() > LINE_READ_TIMEOUT` and bails out of the streaming closure.

## 5. Deployment partial-rollback: remote workflow created but local persistence fails leaves orphan

- **Severity**: high
- **Category**: rollback-partial
- **File**: `src-tauri/src/engine/platforms/deploy.rs:124-205` (n8n; same pattern in zapier/github branches)
- **Scenario**: `client.create_workflow` succeeds → workflow is now live on the user's n8n instance. Then either `get_decrypted_fields` (line 141), `audit_log::log_decrypt`, `create_with_error`, or `create_and_activate` fails (DB lock, encryption error, validation). The function returns Err. The remote n8n workflow is never deleted. User has a phantom workflow on the platform that personas doesn't know about — it cannot be listed, deactivated, or deleted from the UI.
- **Root cause**: No try/cleanup wrapper; failure-after-remote-create paths don't call `client.delete_workflow(&workflow_id)`.
- **Impact**: Orphaned active workflows accumulate on n8n/zapier/github after every transient deploy failure. Some may auto-fire on webhooks and incur side effects with no local visibility. Especially bad with `activate_workflow` succeeding then DB write failing — production webhook fires with no record.
- **Fix sketch**: Wrap the post-`create_workflow` block in a closure; on Err, call `client.delete_workflow(&workflow_id)` (best-effort, log on second-failure) before returning. Apply same pattern to zapier and github paths.

## 6. `execute_team` TOCTOU: two concurrent IPCs both pass `has_running_pipeline` and create dual runs

- **Severity**: high
- **Category**: race-condition
- **File**: `src-tauri/src/commands/teams/teams.rs:210-218`
- **Scenario**: Two clicks of "Run pipeline" arrive within ~1ms (or two IPCs from the same UI in poor network conditions). Both call `has_running_pipeline(team_id) → false` because no run row exists yet. Both fall through to `create_pipeline_run`, both spawn `pipeline_executor::run_pipeline`, and both register run guards. Two competing pipelines run for the same team — same LLM calls, conflicting node-status emits, doubled cost.
- **Root cause**: No row-level claim or unique constraint on `(team_id, status='running')` in `pipeline_runs`. Check and create are not atomic.
- **Impact**: Duplicate team runs per double-click; the IPC layer is unmutexed so the cost-doubling failure mode is realistic on any team with a pipeline button.
- **Fix sketch**: Add a SQL UNIQUE partial index `WHERE status='running'` on `pipeline_runs(team_id)` and treat the constraint violation in `create_pipeline_run` as the user-friendly Validation error; or wrap check+create in a single transaction.

## 7. `cancel_pipeline` racing `register_run_guarded` silently no-ops

- **Severity**: high
- **Category**: race-condition
- **File**: `src-tauri/src/commands/teams/teams.rs:333-338` and `src-tauri/src/lib.rs:228-233`
- **Scenario**: User clicks Run, then immediately clicks Cancel before the IPC for Run has reached `register_run_guarded` (line 292). `cancel_run("pipeline", run_id)` looks up the key, finds nothing (`runs.get(&key)` → None), and silently returns. A few hundred ms later the run-guard is registered with `flag = false`, the spawn proceeds, and the user's cancel intent is lost — but the UI already shows "cancelled".
- **Root cause**: Flag registration happens after the spawn was decided to proceed, but cancel is a fire-and-forget map lookup with no buffering for not-yet-registered runs.
- **Impact**: Cancel-during-startup silently fails. Pipeline runs to completion, often producing the very work the user tried to abort. Cost not recovered.
- **Fix sketch**: Make `cancel_run` create a "tombstone" entry with `flag = true` if the key is missing, so when `register_run` is called later it adopts the existing flag (already set). Or have `register_run_guarded` synchronously return after the lib-side insert before `execute_team` returns the run_id to the UI, and have the UI not show the cancel button until then.

## 8. Cancellation race: child PID re-registered after `cancel_execution` already passed step 4

- **Severity**: high
- **Category**: race-condition
- **File**: `src-tauri/src/engine/mod.rs:986-1010` (cancel) vs `runner/mod.rs:1174` (register_pid)
- **Scenario**: `cancel_execution` step 3 removes the PID and kills it. Step 4 enters the 5-second `tokio::time::timeout(handle)`. The spawned task, in its provider failover loop, decides to spawn a *fresh* CLI for the next provider (chain.rs / failover.rs path), gets a new PID, and calls `register_pid` — which now lives in `child_pids` while the cancel logic is awaiting the handle. After 5s the timeout fires; the fallback code at lines 1000-1007 *does* re-check and kill, but only if the lock is acquired *after* the new register; if the new PID arrives during the next 50ms after the timeout fires, it is missed.
- **Root cause**: The cancel timeout does a single point-in-time `child_pids.lock().remove(execution_id)` after the timeout — it doesn't hold the lock for the lifetime of the abort.
- **Impact**: Orphan Claude CLI processes survive cancellation when failover spawns a replacement during the grace window. Continues consuming API credits until natural exit.
- **Fix sketch**: Use a "no-respawn" flag on `cancelled` (it already exists) — the runner must check `is_cancelled` before *every* CLI spawn (failover loop too), not just at the three top-level gates. Add the gate inside the failover-retry path in runner.

## 9. Healing retry storm via concurrent multi-source spawn

- **Severity**: high
- **Category**: retry-storm
- **File**: `src-tauri/src/engine/mod.rs:1182-1257` (`schedule_healing_retry`) and `:2225-2293` (`spawn_healing_retry`)
- **Scenario**: A failure can trigger healing retry from THREE distinct callers: (a) automatic post-mortem in run_execution result handling; (b) manual `run_healing_analysis` IPC; (c) auto-rollback healing chain. None coordinate via a shared "retry pending for this exec" gate — only `MAX_RETRY_COUNT` on the DB row is the throttle, and that's read pre-spawn. If two callers fire within ~1ms, both pass the `current_retry_count < MAX_RETRY_COUNT` check, both call `spawn_delayed_retry`. Each then calls `create_retry`, which increments the count by 1 — net result: 2 simultaneous retries for the same failure, retry-counts diverge and confuse subsequent escalation logic.
- **Root cause**: No deduplication key (e.g. an in-memory `pending_retries: HashSet<exec_id>`) gates the retry spawn.
- **Impact**: Backed by the always-on diagnoser plus user-clicked manual diagnoser, transient API outages can spawn 2-3× expected retry count → API budget burned and rate-limit cascades worsen.
- **Fix sketch**: Add `Arc<Mutex<HashSet<String>>> pending_retries` to ExecutionEngine; both schedulers `try_insert(original_exec_id)` first and skip if already present; remove on retry-task completion.

## 10. Chain payload exponential blowup — source_output forwarded recursively

- **Severity**: high
- **Category**: edge-case
- **File**: `src-tauri/src/engine/chain.rs:188-221`
- **Scenario**: Chain trigger A→B has `payload_forward: true`. A produces a 10KB output. B's payload now wraps `{source_output: <10KB JSON>, _chain_visited: [...], _chain_depth: 1}`. B→C also has `payload_forward: true` and B's persona produces output that *embeds* the inbound payload (typical "echo input + add fields" pattern). C's payload now contains 30KB. With MAX_CHAIN_DEPTH=8, the worst case is a 256× blowup if every persona doubles the size.
- **Root cause**: No size cap on the forwarded `source_output` JSON. Personas commonly include a copy of their input in their output, accidentally feeding their own previous payload back into the chain.
- **Impact**: 8-hop chain hits the Claude prompt token cap, an LLM call rejects the prompt, and the post-mortem path fails to write status because the payload column may be large enough to fail the DB write. Cascade dies mid-stream with no diagnostic trail.
- **Fix sketch**: In `chain.rs:188-221`, cap the serialised payload at 32KB. If over, replace `source_output` with `{truncated: true, original_size: N}`. Log a `metrics.payloads_truncated += 1`.

## 11. Schedule timezone parse failure silently disables the schedule

- **Severity**: high
- **Category**: silent-failure
- **File**: `src-tauri/src/engine/scheduler.rs:36-46` (used by `compute_next_from_config`) and `background.rs:1597`
- **Scenario**: A user typo'd or migration-mangled `timezone: "America/Newyork"` (lowercase y). `parse::<Tz>()` fails. Code returns `None` from `compute_next_from_config`. In `background.rs:1597+`, `next` becomes `None`, `mark_triggered(pool, &trigger.id, None, ...)` is called — `next_trigger_at` becomes NULL. From now on `get_due` will never return this trigger. The schedule is effectively dead, but `enabled = true` and `status = active`. UI shows "scheduled, runs at next cron" forever.
- **Root cause**: The `tracing::warn!` at scheduler.rs:38 is the only signal. There is no DB status write to `Errored` or auto-disable; the trigger looks healthy but never fires.
- **Impact**: Critical scheduled agents (notifications, sweeps, billing) silently stop firing after a config edit. No user-facing surface alerts on this.
- **Fix sketch**: When `parse::<Tz>()` fails inside `compute_next_from_config`, surface back to caller (return `Result`); in `trigger_scheduler_tick` mark the trigger `status='errored'` and emit a `trigger.broken` notification event so the UI shows the schedule with an error badge.

## 12. Project-tracking scheduler 1h tick uses serial `interval` — overrun delays subsequent ticks indefinitely

- **Severity**: medium
- **Category**: schedule-overrun
- **File**: `src-tauri/src/engine/project_tracking/scheduler.rs:48-65`
- **Scenario**: `run_tick` iterates all subscriptions sequentially with `for sub in &subs { run_project(...).await }`. If one project's git-watcher hangs on a slow network mount for 50 minutes, the next `ticker.tick().await` (at 1h cadence) fires immediately due to default Burst behavior — but already-elapsed ticks for the *other* projects are lost. Worse, if `run_tick` exceeds 1 hour, the next two ticks run back-to-back with no work to do but reading subs fresh, then immediately again.
- **Root cause**: Same as #3 — default Burst behavior + sequential per-project execution serialised on the slowest one.
- **Impact**: One slow project blocks pulse generation for all other tracked projects. Companion's chat consumer sees stale pulses for unrelated repos. After recovery, burst execution causes a flurry of consolidator LLM calls.
- **Fix sketch**: Set `MissedTickBehavior::Skip`. Run per-project `run_project` calls inside `tokio::join_all` with a per-project timeout (e.g. 5min) so a slow watcher cannot starve the rest.

## 13. `clearExecutionOutput` fires-and-forgets cancel then immediately resets state — localStorage cleared before backend acks

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/stores/slices/agents/executionSlice.ts:512-522`
- **Scenario**: User triggers "Clear" while a backend exec is running. We call `get().cancelExecution(activeId)` (line 517) without `await`, then synchronously clear localStorage and reset state. If the cancel IPC fails (network drop, auth race), the backend run keeps running, but `localStorage.removeItem('personas:active-execution')` already fired — so a subsequent app restart will not recover/verify the still-running execution. It becomes a phantom: backend keeps spending API credits, frontend has no record.
- **Root cause**: Async fire-and-forget instead of `await`, plus state reset doesn't wait for cancel completion.
- **Impact**: API credit leak after force-clear; budgets diverge from reality. Combined with #1, the backend may take 10+ seconds to actually stop; in the meantime the frontend has already declared victory.
- **Fix sketch**: `await get().cancelExecution(activeId)` before any state reset. If cancel rejects, surface the error to the user and let them decide whether to clear anyway.

## 14. `record_tick_latency` divides by `tick_count` for rolling avg — but the avg silently overflows on long-running daemons

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/engine/background.rs:269-273`
- **Scenario**: `entry.tick_count: u64` is incremented per tick. `avg_tick_duration_ms = (entry.avg_tick_duration_ms * (n - 1) + elapsed_ms) / n`. After ~2.1 billion ticks (years for 1Hz subs, weeks for 1ms loops), this still works due to u64 — but the `record_tick_latency` per-call cost grows with `n` because `entry.avg_tick_duration_ms * (n - 1)` is constant-time but loses precision: the rolling average stops responding to new samples when n exceeds ~10^15. Silent: stats UI shows a frozen average even after a slow-tick blip.
- **Root cause**: Cumulative average without bounded window; precision degrades once `avg * n` overflows the relevant bits.
- **Impact**: After ~30 days continuous run, slow-tick anomalies don't move the displayed avg latency, masking degradation.
- **Fix sketch**: Use a fixed-size ring buffer (last 256 samples) for the avg, or EMA: `avg = avg * 0.95 + elapsed_ms * 0.05`.

## 15. Stderr collector swallows partial-read errors, returns whatever was read so far as success

- **Severity**: low
- **Category**: silent-failure
- **File**: `src-tauri/src/engine/runner/mod.rs:1376-1391`
- **Scenario**: The stderr-reader spawn at 1371 catches any `Err` from `AsyncReadExt::read` with `Err(_) => break` (line 1384). Returns whatever bytes have accumulated. On a transient pipe error mid-stream, only the first partial chunk of stderr is captured; the rest is lost. The "[stderr truncated at 100KB]" suffix is *not* appended (only on size cap), so the stderr looks complete to downstream `is_session_limit_error` classification — which may then misclassify the failure.
- **Root cause**: Read errors are conflated with EOF.
- **Impact**: Auto-classified failure category can be wrong on flaky stderr pipes, leading the healing engine down the wrong retry path.
- **Fix sketch**: On `Err(e)`, append `\n... [stderr read error: {e}]` to the captured string before returning so downstream parsers can detect partial captures.
