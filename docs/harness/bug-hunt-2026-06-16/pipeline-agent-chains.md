# Bug Hunter — Pipeline & Agent Chains

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: pipeline-agent-chains | Group: Teams & Fleet Orchestration

## 1. Fan-in nodes silently drop all but one predecessor's output
- **Severity**: Critical
- **Category**: 💀 Silent failure / lost intermediate output
- **File**: `src-tauri/src/engine/pipeline_executor.rs:961` (`resolve_node_input`)
- **Scenario**: A diamond/fan-in topology — `A→C`, `B→C` — is a first-class case the topo sort and `build_predecessor_map` (which pushes *multiple* sources into a `Vec`) explicitly support. When C runs, `resolve_node_input` does `preds.iter().rev().find_map(|pid| node_outputs.get(pid)...)` and returns the **first non-empty output it finds** (i.e. the last-listed predecessor), discarding every other upstream output.
- **Root cause**: The resolver collapses an N-predecessor set to a single `Option<String>`. There is no merge/concatenation of multiple predecessor outputs; `find_map` short-circuits on the first `Some`. The aggregation node therefore never sees the data it was wired to aggregate.
- **Impact**: Aggregator/synthesizer/reviewer roles (the entire point of a multi-input team) operate on one arbitrary branch's output. The pipeline reports `completed` with green node statuses, so the loss is invisible — classic success theater. Auto-created team memories then persist the partial result as authoritative, poisoning future runs (`create_node_memory`).
- **Fix sketch**: When `preds.len() > 1`, collect all present outputs and merge them into a structured payload (e.g. `{ "inputs": { member_id: output, ... } }`) rather than `find_map`-ing one. At minimum, log a warning when multiple predecessor outputs exist and only one is forwarded so the truncation is visible.

## 2. Approval pre-arm race: approve/reject before the gate registers is lost forever
- **Severity**: High
- **Category**: ⚡ Race condition / 🔮 latent hang
- **File**: `src-tauri/src/engine/pipeline_executor.rs:651` (`poll_for_approval`), `src-tauri/src/commands/teams/teams.rs:380` (`approve_pipeline_node`)
- **Scenario**: `run_pipeline` emits `PIPELINE_APPROVAL_NEEDED` (line 788) and sets node status to `awaiting_approval` **before** `poll_for_approval` calls `registry.register_run("pipeline_approval", key)` (line 658). The frontend receives the event, the user clicks Approve, and `approve_pipeline_node` calls `cancel_run("pipeline_approval", key)`. But `cancel_run` is a no-op when the key isn't registered yet (`lib.rs:285` — `if let Some(entry) = self.runs.get(&key)`). If the click lands in that window, the flag set is dropped.
- **Root cause**: The approval flag is created lazily inside the poll loop, after the UI is already told the gate is open. The arm-then-signal ordering is inverted, and `cancel_run` silently swallows signals to unregistered keys.
- **Impact**: The node waits indefinitely (the loop has no timeout — that cap was intentionally removed) for an approval that already happened. The whole pipeline hangs until someone notices and clicks again. Reject has the same hole.
- **Fix sketch**: Register the approval key (arm the flag) *before* emitting `PIPELINE_APPROVAL_NEEDED`, then enter the poll loop. Alternatively have `approve_pipeline_node` create-or-set the entry so an early signal is latched for the poller to observe.

## 3. Persona-node timeout leaves the CLI process running (zombie spawn + budget leak)
- **Severity**: High
- **Category**: 🔮 Latent failure / recovery gap
- **File**: `src-tauri/src/engine/pipeline_executor.rs:472` (`run_persona_node` timeout branch)
- **Scenario**: A persona node polls `exec_repo::get_by_id` once per second for 600 iterations. If the execution never reaches a terminal status (hung CLI, lost completion event, stuck streaming), the loop exits and the node is marked `failed: "Execution timed out"`. Unlike the cancellation branch (line 418-419) and the command-node path (which `child.kill()`s), the timeout branch never calls `engine.cancel_execution(&exec.id, ...)`.
- **Root cause**: The 600s timeout only abandons the *poll*, not the *work*. The orphaned execution + its underlying CLI subprocess keep running, keep streaming events for an execution the pipeline has already written off, and keep spending against the per-spawn budget.
- **Impact**: Resource/token leak (a wedged Claude CLI can run far past 600s), plus the run finalizes `failed` while a ghost execution mutates state / emits events for a node the user believes is dead. Repeated pipeline runs accumulate zombies.
- **Fix sketch**: On timeout, call `engine.cancel_execution(&exec.id, db, Some(&member.persona_id))` (same as the cancellation branch) before marking the node failed, so the abandoned execution and its process are torn down.

## 4. Conditional edge with stale/empty predecessor output silently skips downstream nodes
- **Severity**: Medium
- **Category**: 🕳️ Edge case / 💀 silent failure
- **File**: `src-tauri/src/engine/pipeline_executor.rs:190` (`should_skip_node`) + `:139` (`evaluate_condition`)
- **Scenario**: Node C has a `conditional` incoming edge from B. If B was itself skipped (its own condition failed) or produced no output, `node_outputs.get(B)` is `None`. `evaluate_condition` then evaluates `equals`/`not_equals`/`contains` against an absent value: `equals`/`contains` → `false` (skip C), while `not_equals` → `true` (run C with no input). The skip silently cascades — every node gated on C is also skipped, with no aggregate "branch died" signal.
- **Root cause**: A missing predecessor output is treated as a legitimate "condition not met" rather than an exceptional "upstream never ran" state. `should_skip_node` makes no distinction between "B ran and disagreed" and "B never produced a value." Mixed with the fail-open behavior for malformed conditions, the semantics are inconsistent.
- **Impact**: Whole branches of a pipeline can be silently pruned because an upstream node was skipped/empty, while the run still reports `completed`. The user sees `skipped`/`condition_not_met` on individual nodes but gets no signal that an entire downstream subtree was abandoned due to an unmet *upstream availability* assumption, not an actual data decision.
- **Fix sketch**: Distinguish "predecessor produced no output" (skip with reason `predecessor_no_output`, or fail) from "condition evaluated false on real output." Surface a run-level diagnostic when a conditional skip transitively prunes additional reachable nodes.

## 5. Per-node DB status write failure is swallowed; UI keeps last-known-good while the node really ran
- **Severity**: Low
- **Category**: 💀 Silent failure / success theater
- **File**: `src-tauri/src/engine/pipeline_executor.rs:71` (`StatusEmitter::emit`)
- **Scenario**: `emit` serializes `node_statuses` and writes them with `let _ = team_repo::update_pipeline_run(...)` — the DB result is discarded. If the write fails (lock contention, disk full, transient SQLite busy), the in-memory `statuses` advance and a Tauri event still fires, but the persisted `pipeline_runs` row is now behind. Only a serialization error is logged (line 75); a DB write error is dropped entirely.
- **Root cause**: The persisted run record and the emitted event are two independent sinks with no consistency check; the DB sink's error is intentionally ignored (`let _ =`). A client that reloads via `get_pipeline_run` (after a refresh, or another window) reads the stale row.
- **Impact**: Divergence between the live event stream and the persisted run — a node shows `completed` in the open canvas but `running`/`idle` on reload, or a finalized run never records its terminal status if the last `emit(final_status, …)` write fails. Low because the live stream usually masks it, but it erodes trust and corrupts pipeline analytics derived from the persisted rows.
- **Fix sketch**: Log DB write failures in `emit` (mirror the serialization-error branch), and consider a best-effort retry on the terminal `emit(final_status, …)` so the run's final state is durably recorded even if mid-run updates are lossy.
