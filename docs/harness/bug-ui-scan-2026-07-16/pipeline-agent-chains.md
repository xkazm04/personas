# Pipeline & Agent Chains — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 1, High: 2, Medium: 2, Low: 0)

## 1. Pipeline run stuck in 'running' after app crash/quit permanently bricks the team — no startup recovery, and cancel is an in-memory no-op
- **Severity**: Critical
- **Category**: bug
- **File**: src-tauri/src/commands/teams/teams.rs:235 (guard), src-tauri/src/db/repos/resources/teams.rs:702-709 (`has_running_pipeline`), src-tauri/src/commands/teams/teams.rs:368-373 (`cancel_pipeline`)
- **Scenario**: If the user quits the app (or it crashes / the machine sleeps through a hard kill) while a team pipeline is executing, the `pipeline_runs` row stays at `status='running'` forever. `run_pipeline` is a plain tokio task — nothing on startup sweeps `pipeline_runs` for interrupted runs (grep confirms the only writers are `create_pipeline_run`/`update_pipeline_run`; there is no sweep like the execution queued-zombie reaper). After restart: `execute_team` refuses ("This team already has a pipeline running"), `delete_team` refuses ("Cannot delete team while a pipeline is running", teams.rs:71-74), and `cancel_pipeline` only flips a flag in the in-memory `ActiveProcessRegistry` — the key no longer exists after restart and nothing ever writes a terminal status to the DB.
- **Root cause**: The design assumes the async pipeline task always lives long enough to write a terminal status. The DB `running` state has no owner-liveness check and no crash-recovery path, while two hard guards key off it.
- **Impact**: One unclean shutdown mid-run leaves the team permanently unable to run pipelines or be deleted, with no in-app remedy (requires manual SQLite surgery).
- **Fix sketch**: On startup, mark all `pipeline_runs` with `status IN ('running','awaiting_approval')` as `failed` with error "interrupted by app restart" (mirroring the panic handler at teams.rs:350-360). Alternatively make `cancel_pipeline` also write the terminal DB status when the registry key is absent.

## 2. Command nodes never capture stdout/stderr — output is always empty, silently breaking handoff, conditions, and error messages
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/pipeline_executor.rs:597-703 (`run_command_node`; spawn at 613, `wait_with_output` at 633)
- **Scenario**: User adds a command node (`nodeType:"command"`, e.g. `command:"git status"`) feeding a persona node or a conditional edge. The node runs and reports "completed", but its output is `""`.
- **Root cause**: `tokio::process::Command` inherits stdin/stdout/stderr by default; `run_command_node` calls `command.spawn()` without `.stdout(Stdio::piped()).stderr(Stdio::piped())`. `child.wait_with_output()` only fills `Output.stdout/stderr` from pipes it can read — with inherited handles both buffers come back empty (on a windowed Tauri app the text goes nowhere at all).
- **Impact**: Success theater across the whole feature: downstream nodes receive `""` instead of the command's output (so `resolve_node_input` falls back or hands over an empty string), conditional edges evaluating raw command output (`contains`/`exists`, explicitly documented at pipeline_executor.rs:148-151) can never match, auto team memories store empty content, and on failure the user sees `Exit code 1: ` with the stderr blank — undiagnosable.
- **Fix sketch**: Configure `command.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())` (and `stdin(Stdio::null())`) before `spawn()`. The existing `wait_with_output` then works as intended.

## 3. Approval gates have no UI surface — `PIPELINE_APPROVAL_NEEDED` has zero listeners and approve/reject/cancel APIs are never called, so a gated pipeline hangs forever
- **Severity**: High
- **Category**: ui
- **File**: src/api/pipeline/teams.ts:138-145 (`cancelPipeline`/`approvePipelineNode`/`rejectPipelineNode`, all unreferenced), src-tauri/src/engine/pipeline_executor.rs:724-749 (`poll_for_approval` waits indefinitely by design)
- **Scenario**: A user sets `approvalGate: true` in a node's config and runs the pipeline. The backend pauses at the gate, emits `PIPELINE_APPROVAL_NEEDED`, and polls forever for a human decision. Grep of `src/` shows no component subscribes to `EventName.PIPELINE_APPROVAL_NEEDED`, and `approvePipelineNode` / `rejectPipelineNode` / `cancelPipeline` are exported but never imported anywhere. `PipelineControls.tsx` deliberately shows "runs until completion" and offers no cancel.
- **Root cause**: The backend approval loop was hardened (armed flag, infinite wait — the 1-hour cap was removed precisely because approvals are human-paced) on the assumption a frontend approval surface exists; it was never wired.
- **Impact**: The run sits at `awaiting_approval` forever with a gray, unexplained node dot (see finding 5); the only exits (approve or cancel) are unreachable from the product. The user must restart the app — which then triggers finding 1's stale-run family of problems.
- **Fix sketch**: Add a listener for `PIPELINE_APPROVAL_NEEDED` in the team canvas (toast/banner with the predecessor output preview) wired to `approvePipelineNode`/`rejectPipelineNode`, plus a cancel affordance in `PipelineControls` while a run is active or awaiting approval.

## 4. Single-pipeline-per-team invariant bypassed while a run is paused at an approval gate ('awaiting_approval' ≠ 'running')
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/resources/teams.rs:706 (`... AND status = 'running'`), src-tauri/src/engine/pipeline_executor.rs:932 (persists `awaiting_approval`)
- **Scenario**: Pipeline A reaches an approval-gated node; `StatusEmitter` persists the run's status as `awaiting_approval`. The user (or a trigger/automation) invokes `execute_team` for the same team. Both the fast-path pre-check and the authoritative `BEGIN IMMEDIATE` re-check in `create_pipeline_run` (teams.rs:750) count only `status = 'running'` rows, so the guard passes and a second pipeline starts while the first is merely paused. When A is later approved it resumes, giving two concurrent runs on one team.
- **Root cause**: The guard predicate enumerates a single literal status, but the run lifecycle later grew a second non-terminal DB state (`awaiting_approval`) that still means "this run will resume".
- **Impact**: Two concurrent runs interleave `PIPELINE_STATUS` events keyed to the same team (the canvas shows whichever emitted last), double-write auto team memories, and each injects the other's fresh memories into its `load_memory_context` — cross-contaminated node inputs. Also inconsistent with the delete-team guard, which likewise ignores paused runs.
- **Fix sketch**: Change both `has_running_pipeline` queries to `status IN ('running','awaiting_approval')` (or, more robustly, `completed_at IS NULL`).

## 5. Command node timeout leaks the child process — future dropped without `kill_on_drop`, and the UI has no state for it
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/pipeline_executor.rs:612-676 (timeout `Err(_)` branch at 663; `Command` built at 597-605 without `kill_on_drop(true)`)
- **Scenario**: A command node runs a long/hung command (e.g. a script waiting on input — likelier still because stdin is inherited, finding 2). After 300s, `tokio::time::timeout` fires: the async block owning `child` is dropped. `tokio::process::Child` does not kill on drop unless `kill_on_drop(true)` was set, so the shell (`cmd /C ...` and its whole child tree) keeps running detached — invisible to cancellation, the ActiveProcessRegistry, and app shutdown. Note the persona-node path explicitly fixed this same class of leak (comment at lines 539-542), but the command path was missed. The cancellation path is fine (`child.kill()` at 620); only the timeout path leaks.
- **Root cause**: Assumption that dropping the timed-out future tears down the process; tokio children are detached by default.
- **Impact**: Orphaned processes accumulate per timed-out node (holding files/ports, consuming CPU), while the node status claims the work stopped ("Command timed out after 300 seconds"). Meanwhile `PipelineControls.tsx` `STATUS_COLORS` (lines 23-29) has no entry for `cancelled`/`skipped`/`awaiting_approval`, so post-timeout/cancel node dots regress to gray "idle" and `getProgressText` reports "Ready to execute" — compounding the false-stopped impression.
- **Fix sketch**: Set `command.kill_on_drop(true)` when building the command (one line, covers the timeout drop); optionally `start_kill()` explicitly in the timeout branch. Add the three missing statuses to `STATUS_COLORS`/progress text.
