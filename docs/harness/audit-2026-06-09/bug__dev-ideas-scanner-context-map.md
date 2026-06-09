# Bug Hunter — dev-ideas-scanner-context-map
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

## 1. Context-map rescan deletes the hand-edited map before the LLM produces anything
- **Severity**: critical
- **Category**: state-corruption / data-loss
- **File**: src-tauri/src/commands/infrastructure/context_generation.rs:668-692 (clear) → 757-766 (spawn)
- **Scenario**: User has a curated, hand-edited context map. They trigger a normal (non-delta) rescan. `run_context_generation` runs `clear_project_context_map` (a committed `DELETE FROM dev_contexts` + `DELETE FROM dev_context_groups`, repo dev_tools.rs:1796-1821) FIRST, then spawns the Claude CLI. If the CLI is missing (NotFound, line 757-766), exits non-zero immediately, the user cancels, or the LLM emits zero/garbage protocol lines, the function returns having created 0 groups/0 contexts. The map is now permanently empty.
- **Root cause**: Destructive "clear then regenerate" with no transactional staging. The clear is committed independently of whether regeneration ever succeeds; there is no snapshot/restore and no "only swap in the new map if N>0 contexts were produced" guard. The fast-fail path at line 988-1005 only fires `if groups_created == 0 && contexts_created == 0` — but by then the old map is already gone, so the error is reported over an emptied table.
- **Impact**: data loss — irreplaceable hand-curated context map destroyed on any rescan that fails to regenerate.
- **Fix sketch**: Generate into a staging set (or an in-memory accumulator) and only `clear + insert` atomically inside one transaction once the run has produced ≥1 valid context. On any failure/cancel/zero-output, leave the existing map untouched. Make "clear" impossible to commit without a successful replacement.

## 2. Timed-out task execution never kills the child and blocks on wait() forever
- **Severity**: critical
- **Category**: recovery-gap / orphaned-process
- **File**: src-tauri/src/commands/infrastructure/task_executor.rs:862-870
- **Scenario**: A task's Claude CLI hangs (network stall, stuck tool loop). The 10-minute `tokio::time::timeout` around the stdout loop (line 762) elapses. Control falls to line 863 `let exit_status = child.wait().await.ok();` — which awaits the child's natural exit — and ONLY THEN (line 866) checks `stream_result.is_err()`. Because the child is hung, `wait()` never returns, so the "timed out after 10 minutes" error is never emitted and the task stays `running` indefinitely; the executor future is parked on a dead process.
- **Root cause**: Ordering inversion plus a missing kill. The sibling scanners do it correctly — idea_scanner.rs:776-779 and context_generation.rs:934-936 both call `child.kill().await` immediately when `stream_result.is_err()`. task_executor relies solely on `kill_on_drop(true)` (line 687), but `wait()` borrows `child` and blocks before the drop can ever run.
- **Impact**: crash-equivalent hang — orphaned Claude CLI process, task stuck `running` (only rescued ~10.5 min later by the BackgroundJobManager stale sweep, which cancels the token but the DB task row is never reconciled to failed by this path), wasted tokens.
- **Fix sketch**: On timeout, `child.kill().await` first (mirror the scanners), then bounded `tokio::time::timeout(5s, child.wait())`, then return the timeout error. Never call an unbounded `wait()` on a process you already decided to abandon.

## 3. Auto-run re-spawns the same task every iteration when insert_running loses a race
- **Severity**: high
- **Category**: race-condition / livelock
- **File**: src-tauri/src/commands/infrastructure/task_executor.rs:1193-1199 (run_one_task_for_auto) + 1338-1368 (scheduler loop)
- **Scenario**: Auto-run selects a `queued` task that is ALSO running from a manual `dev_tools_execute_task` (or a competition). `run_one_task_for_auto` marks it `running` in the DB (line 1179), then `insert_running` returns `Err("already running")` (background_job.rs:214-217), so the function `return "failed"` at line 1198 WITHOUT writing a terminal DB status and WITHOUT clearing the `running` it just wrote. The other executor finishes and (depending on interleaving) the row can be left back at... but critically `list_ready_tasks` filters on `status = 'queued'` (repo dev_tools.rs:2729): any task this branch leaves non-terminal-but-not-`queued` is silently dropped from future waves, OR if it races back to queued it is re-selected and re-spawned every iteration up to max_iterations (50). Each wasted spawn marks it `running` then bails.
- **Root cause**: The lost-race branch is treated as a real "failed" return but performs no state reconciliation; the scheduler has no per-task attempt accounting, so a task that can never be inserted is retried for the whole budget.
- **Impact**: UX degradation + success theater — auto-run burns its iteration budget, the task is reported as "skipped" in the final tally (line 1382-1388) even though it was repeatedly attempted, and the DB `running`/`queued` state is inconsistent.
- **Fix sketch**: On `insert_running` Err, leave the DB row exactly as it was found (don't pre-mark `running` before the insert succeeds — reorder so insert is the gate), and track attempted IDs in the scheduler so a task that fails to acquire the slot is excluded from the snapshot for the remainder of the run.

## 4. dev_tools_execute_task marks the task running before claiming the job slot — orphan on race
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/commands/infrastructure/task_executor.rs:248-265
- **Scenario**: Two near-simultaneous `dev_tools_execute_task` calls for the same `task_id` (double-click, or manual start colliding with an in-flight run). Both reach line 250 and write `status = "running"`. The second then hits `insert_running` (line 265) which returns `Err` via `?` and the command aborts — but the DB row is already `running` with no live executor backing it.
- **Root cause**: Side-effecting DB write (`update_task → running`, started_at) happens before the atomic ownership check. The "running" flag is set optimistically rather than only after the job slot is successfully claimed.
- **Impact**: state corruption — task stranded `running`, UI shows it executing forever; only the 10.5-min stale sweep (background_job.rs:164-191) eventually cancels the (nonexistent) token, and even then the DB row isn't driven to a terminal status by this command path.
- **Fix sketch**: Claim the job slot (`insert_running`) FIRST; only after it succeeds write `status = running`. Make the DB transition a consequence of, not a precondition for, owning the execution.

## 5. Static scan buffers full subprocess output with no timeout, cancel, or size cap
- **Severity**: high
- **Category**: edge-case / recovery-gap (OOM, unbounded blocking)
- **File**: src-tauri/src/commands/infrastructure/static_scan.rs:98-112
- **Scenario**: `dev_tools_run_static_scan` runs the configured tool via `Command::new(exe).args(args).output().await`. `.output()` reads ALL of stdout/stderr into memory with no cap. A tool like `jscpd`/`knip` on a large monorepo (or a misconfigured `--reporter` that streams MBs of JSON, or an interactive tool that never exits) will either (a) balloon process memory until OOM, or (b) block the IPC handler forever — there is NO timeout, NO CancellationToken, and the scan is never registered with any BackgroundJobManager, so there is no way to cancel it or detect it as stale.
- **Root cause**: Unlike the three CLI-streaming surfaces, the static-scan runner is a synchronous fire-and-collect with zero bounding. It trusts the user-supplied argv to terminate promptly and to produce bounded output.
- **Impact**: crash (OOM) / hung IPC worker / no cancellation path. A stuck scan also leaves the freshly-created `dev_scans` row (line 115) in `running` with no sweeper, since this surface bypasses the job manager.
- **Fix sketch**: Spawn with piped stdout, read into a bounded buffer (truncate past N MB), wrap in `tokio::time::timeout`, register a CancellationToken/job entry so it can be cancelled and stale-swept, and drive the `dev_scans` row to a terminal status on every exit path including timeout.

## 6. Idea scan reports timeout/partial output as a clean "complete" with a possibly-truncated idea
- **Severity**: medium
- **Category**: silent-failure / success-theater
- **File**: src-tauri/src/commands/infrastructure/idea_scanner.rs:776-806 (timeout) + 652-657 (multi-line parse)
- **Scenario**: The 20-minute timeout fires mid-stream while the LLM is still emitting. If `ideas_created > 0`, line 782-790 returns `Ok(ideas_created)`, which marks the `dev_scans` row `complete` (run_scan_core line 446-455) with no indication the run was cut off. Separately, the protocol parser consumes already-assembled assistant text and splits on `.lines()` (line 655); a `scan_idea` JSON object that was streamed across a chunk/line boundary is silently un-parseable and dropped (parse_idea_protocol returns None on `serde_json::from_str` failure, line 211), so a partial scan is recorded as a fully successful one.
- **Root cause**: "Any ideas at all ⇒ success" conflates partial and complete. The terminal status doesn't distinguish "finished cleanly" from "killed at the deadline", unlike context_generation which has a dedicated `completed_with_warning` status (context_generation.rs:944-965).
- **Impact**: UX degradation — users see a green "complete" scan that is actually a fraction of the intended output; downstream triage/replenish logic treats the backlog as exhaustively scanned.
- **Fix sketch**: Adopt the context_generation pattern — return a partial-success marker on the timeout-with-ideas branch and persist `dev_scans.status = 'completed_with_warning'` (or similar) with the count/reason, so partial scans are visibly distinct from clean ones.
