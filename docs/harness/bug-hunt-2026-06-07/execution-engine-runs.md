# Bug Hunter — execution-engine-runs
> Total: 6
> Critical: 1 · High: 3 · Medium: 2 · Low: 0

This audit covered the detached tokio runner (`engine/runner/mod.rs`), the
spawn/persist/cancel orchestration (`engine/mod.rs`, `engine/execution_engine/persist.rs`),
the DB status state machine (`db/repos/execution/executions.rs`), the scheduler
math (`engine/scheduler.rs`), the event matcher (`engine/bus.rs`), the command
layer (`commands/execution/executions.rs`, `scheduler.rs`), and the React store +
hooks (`stores/slices/agents/executionSlice.ts`, `runLifecycle.ts`,
`features/agents/sub_executions/libs/useRunnerExecution.ts`, `useRunnerState.ts`,
`hooks/execution/usePersonaExecution.ts`).

The highest-risk surface is the single `Arc<AtomicBool>` cancellation flag that is
overloaded with two incompatible meanings, plus the result-persistence path that
relies on the in-memory tracker for the concurrency-slot release.

---

## 1. Single `cancelled` flag conflates "user cancel" and "persona deletion" → silent loss of tool-usage + output report on every user cancel
- **Severity**: High
- **Category**: silent-failure / state-corruption
- **File**: `src-tauri/src/engine/runner/mod.rs:2387` (and the dual setters at `src-tauri/src/engine/mod.rs:1188` and `src-tauri/src/engine/mod.rs:1263`)
- **Scenario**: A user clicks **Stop** on a long-running execution that has already made 12 tool calls and produced a partial report. `cancel_execution` sets the shared `cancelled` flag (`engine/mod.rs:1188`). The runner is mid-finalize; at `runner/mod.rs:2388` it reads `let persona_being_deleted = cancelled.load(Acquire)` — which is now `true` — so it **skips** recording tool usage (`runner/mod.rs:2389-2394`) AND skips the `persona_messages` output INSERT (`runner/mod.rs:2600-2603`, also gated on `!cancelled`). The work happened and the user paid for it, but the tool-usage metrics and the produced report are silently discarded.
- **Root cause**: The design assumption is that `cancelled == true` means "the persona row is about to be CASCADE-deleted, so don't write child rows." But the *same* `Arc<AtomicBool>` is also flipped by ordinary user cancel (`cancel_execution`). There is exactly one flag (`cancelled: Arc<AtomicBool>` at `runner/mod.rs:77`) registered per execution (`engine/mod.rs:978`) and reused by both `cancel_execution` and `force_cancel_all_for_persona`. The two intents — "stop billing but keep my partial data" vs. "the parent is gone, drop children" — were collapsed into one bit.
- **Impact**: data loss (every user-cancelled run loses tool-usage attribution and its partial output message). Degrades cost analytics, the Activity feed, and the Resume flow, which relies on `last_tool`/output context.
- **Fix sketch**: Make the class impossible by separating the two signals. Introduce a distinct `persona_deleting: Arc<AtomicBool>` (set only by `force_cancel_all_for_persona`) and gate the "skip child writes" branches on *that*, leaving `cancelled` to mean only "stop work." Or pass an explicit `CancelReason { UserCancel, PersonaDeletion }` enum into the runner so the finalize block can choose to persist partial metrics on user cancel while still skipping writes on deletion.

---

## 2. Concurrency-slot + queue drain runs only inside the spawned task; an aborted task (deletion / cancel grace timeout) leaks the slot and stalls the global queue
- **Severity**: Critical
- **Category**: resource-leak / state-corruption
- **File**: `src-tauri/src/engine/mod.rs:1117` (cleanup block) vs `src-tauri/src/engine/mod.rs:1279` and `src-tauri/src/engine/mod.rs:1393` (`handle.abort()`)
- **Scenario**: Multiple executions are running at the concurrency cap with others `queued`. The user deletes a persona (or a cancel exceeds its 5 s grace window). `force_cancel_all_for_persona` calls `handle.abort()` (`engine/mod.rs:1279`); `cancel_execution` step 4 also drops/aborts the JoinHandle after the grace timeout (`engine/mod.rs:1212-1236`). Aborting a tokio task drops the future at the next await point, so the cleanup tail at `engine/mod.rs:1117-1144` — which calls `tracker.remove_running(...)`, removes the task handle, signals completion waiters, and crucially calls `drain_and_start_next(...)` — **never runs**. The global running counter stays inflated by one and no queued execution is promoted.
- **Root cause**: The slot-release and queue-drain are placed *inside* the spawned task body rather than in a drop-guard / `finally` that survives cancellation. The code's own comment (`engine/mod.rs:1014-1018`) shows awareness that a *panic* must not skip cleanup (hence `catch_unwind`), but `catch_unwind` does **not** catch a tokio `abort()` — the future is simply dropped, bypassing both the `catch_unwind` arm and the cleanup tail. `force_cancel_all_for_persona` manually does `tracker.remove_running` for the persona it deletes, but it does **not** call `drain_and_start_next`, so queued work for *other* personas is never promoted and the engine wedges until restart.
- **Impact**: crash-equivalent service stall — after enough aborts the engine reports itself permanently at capacity; all subsequent scheduled/event-triggered/manual runs stay `queued` forever with no operator-visible cause. Completion waiters also never fire, hanging any caller awaiting the execution.
- **Fix sketch**: Move slot release + queue drain into a `Drop`-based guard (RAII) or a `tokio::select!` that always runs a cleanup branch, so the invariant "task end ⇒ slot freed ⇒ queue drained" holds regardless of normal completion, panic, *or* abort. At minimum, have `force_cancel_all_for_persona` and the cancel-grace-abort path explicitly invoke `drain_and_start_next` after aborting, and clear the tracker/task/waiter maps.

---

## 3. Cancel grace-period window re-kills only the *original* execution_id; a chain/healing retry that re-registers under the SAME id can orphan a billing child
- **Severity**: High
- **Category**: race-condition / resource-leak
- **File**: `src-tauri/src/engine/mod.rs:1206` and `src-tauri/src/engine/mod.rs:1226`
- **Scenario**: A user cancels execution `E`. Step 3 (`engine/mod.rs:1206`) removes and kills `E`'s PID. During the 5 s grace window the spawned task is finalizing and, on a failure path, spawns a *new* child (healing retry / chain continuation) and registers its PID back into `child_pids` under a key (`engine/mod.rs:3001`, `3031`, `3337` show re-registration patterns). Step 4's fallback re-reads `child_pids` for `execution_id` and kills it (`engine/mod.rs:1226`) — but only if the new child registered under the *same* `execution_id`. If the retry registers under a *different* id (a new execution row), that child is never reaped by this cancel path, and `child_pids` no longer holds the original id, so the orphan keeps streaming and billing the API account.
- **Root cause**: Cancellation assumes a 1:1, stable `execution_id → PID` mapping for the lifetime of the cancel. But the runner can spawn descendant executions under new ids during the grace window, and `kill_process(pid)` (line 1208/1232) kills only the immediate process, not the descendant tree (the ceiling path at `engine/mod.rs:388-391` documents that `kill_on_drop` is immediate-process-only — the same limitation applies here).
- **Impact**: orphaned/zombie CLI process consuming LLM credits indefinitely after a "successful" cancel; UX shows the run as cancelled while spend continues.
- **Fix sketch**: Kill by *process tree* (PID-group / job object on Windows) rather than single PID, and have the runner check `cancelled` before spawning any retry/chain child so it never starts new billing work after a cancel. Track all child PIDs spawned under an execution in a set, and reap the whole set on cancel.

---

## 4. Startup `recover_stale_executions` blindly fails ALL `running` rows — clobbers executions legitimately claimed by another live instance
- **Severity**: Medium
- **Category**: state-corruption / edge-case
- **File**: `src-tauri/src/engine/mod.rs:665` (called at `src-tauri/src/lib.rs:748`); claim model at `src-tauri/src/db/repos/execution/executions.rs:691`
- **Scenario**: The multi-driver orchestration (ADR 2026-05-26, `claim_for_instance` at `executions.rs:691`) lets a non-leader driver mark a row `running` with `claimed_by_instance` + a `claim_expires_at` TTL. If a second app instance (or a quick restart while a sibling MCP/REST driver is mid-run) starts up, `recover_stale_executions` runs `get_running_only` (`executions.rs:854` — `WHERE status='running'`, no instance filter) and force-writes every one of them to `failed` (`engine/mod.rs:675-683`), ignoring `claimed_by_instance` and `claim_expires_at`.
- **Root cause**: The recovery routine predates / ignores the claim model. It assumes "any `running` row at startup is an orphan of *this* process," but the claim TTL was specifically introduced so a row can be validly owned by *another* instance whose claim has not yet expired.
- **Impact**: silent corruption — a healthy in-flight execution owned by another instance is yanked to `failed` mid-run; its result write later loses the `if_running`/`if_not_final` CAS (status no longer `running`/`cancelled`) and is dropped, so the user sees a spurious failure for a run that actually succeeded.
- **Fix sketch**: Scope startup recovery to rows this instance owns or whose claim has expired: `WHERE status='running' AND (claimed_by_instance IS NULL OR claimed_by_instance = ?self OR claim_expires_at < now)`. Rows with a live foreign claim must be left untouched.

---

## 5. `handleStatusEvent` finishes the focused execution on the FIRST terminal event with no execution-id correlation — a stale/duplicated terminal status from a prior run resets the live run
- **Severity**: Medium
- **Category**: race-condition / state-corruption
- **File**: `src/hooks/execution/usePersonaExecution.ts:51` (`handleStatusEvent`) and `src/stores/slices/agents/executionSlice.ts:387` (`finishExecution`)
- **Scenario**: User runs execution `A`, it completes; the correlated stream fires a terminal `execution-status`. Before the React tree settles, the user immediately starts execution `B` for the same persona (so `executionPersonaId` is unchanged and `isOwnerAligned()` still returns true). A late/duplicated terminal `execution-status` event for `A` (the backend emits terminal status from several paths — runner finalize, cancel safety-net, ceiling, dead-letter) is delivered. `handleStatusEvent` does **not** compare the event's `execution_id` to the store's `activeExecutionId`; it only checks owner alignment and `isTerminalState`, then calls `store.finishExecution(status, …)` (`usePersonaExecution.ts:100`), which unconditionally clears `activeExecutionId`, sets `isExecuting=false`, and removes the recovery localStorage key — terminating the UI of the *live* run `B`.
- **Root cause**: The focused-execution status handler trusts owner-alignment as a sufficient correlation key, but the correlated-stream `idField` filters by the id it was `start()`-ed with, and there is a window where `start(B)` has not yet re-bound while an `A` terminal event is in flight. `finishExecution` itself reads `get().activeExecutionId` at call time and acts on whatever is current, with no guard that the terminal event belongs to the currently-active id. (The *background* listener at `usePersonaExecution.ts:256` correctly guards with `activeExecutionId === execId`; the focused path does not.)
- **Impact**: UX degradation / wrong result — the live run's terminal UI is torn down, output stops piping, and the run continues headless in the backend while the user believes it ended. The shared `executionOutput` buffer may also be snapshotted under the wrong id.
- **Fix sketch**: Make the class impossible by correlating on id end-to-end: have `finishExecution` accept the terminating `executionId` and no-op if it != `activeExecutionId`; in `handleStatusEvent`, drop terminal events whose `execution_id` does not equal the store's `activeExecutionId`.

---

## 6. `appendExecutionOutput` writes to the shared `executionOutput` buffer with only persona-level alignment — concurrent focused-vs-background runs of the same persona interleave output
- **Severity**: Medium
- **Category**: race-condition / state-corruption
- **File**: `src/hooks/execution/usePersonaExecution.ts:36` (`handleOutputLine` → `appendExecutionOutput`) and `src/stores/slices/agents/executionSlice.ts:530`
- **Scenario**: A persona has a focused run `A` in the terminal. The user (or a trigger) starts a second run `B` for the *same* persona; `executePersona` sees `isExecuting === true` and routes `B` to background (`executionSlice.ts:256`). Both `A` and `B` emit `execution-output` events. `handleOutputLine` gates only on `isOwnerAligned()` (persona match), not on `execution_id`, so any output line whose persona matches the focused persona is appended to the single shared `executionOutput` array — even when it actually belongs to background run `B`.
- **Root cause**: The output sink is keyed by *persona*, not by *execution*. `isOwnerAligned()` compares `executionPersonaId === selectedPersonaId`; it cannot distinguish two concurrent executions of the same persona. The correlated stream's id filter helps for the focused subscription, but background runs of the same persona share the persona identity the alignment check uses.
- **Impact**: silent corruption of the displayed transcript — interleaved lines from two runs, wrong `[SUMMARY]`/cost attribution, and `executionSummary` (derived by scanning `outputLines` for the last summary line, `useRunnerState.ts:67-76`) reading the wrong run's totals. Also corrupts the on-cancel/Resume `last_tool` heuristic (`useRunnerExecution.ts:78`).
- **Fix sketch**: Tag each `execution-output` event with its `execution_id` and have `handleOutputLine`/`appendExecutionOutput` accept and verify it against `activeExecutionId` before appending; buffer background output under its own per-execution key (the slice already has the `backgroundExecutions` structure to hang it on) so the focused transcript only ever contains the focused run's lines.
