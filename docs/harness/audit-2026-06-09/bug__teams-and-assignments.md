# Bug Hunter — teams-and-assignments
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

Scope note: the in-scope command/repo/model/slice files are thin wrappers over `engine::team_assignment_orchestrator`. The highest-value reliability bugs live where the in-scope command layer's stated invariants ("idempotent", "guarded", "aborted") are not actually enforced. All findings are reachable from in-scope entry points; orchestrator line refs are given for the failing mechanism the in-scope code relies on.

## 1. No single-live-task guard → concurrent tick loops duplicate-execute the same step
- **Severity**: critical
- **Category**: race-condition
- **File**: src-tauri/src/commands/teams/assignments.rs:135 (start), :187 (resume), :202-226 (review resolutions)
- **Scenario**: User double-clicks "Start" (or auto-resume fires while the user clicks Resume; or two `resolve_*` review actions land within ~1s). Each path calls `orchestrator::run_assignment` / `resume_assignment`, which `tokio::spawn`s a brand-new tick task. Two (or more) tick loops now run for the same `assignment_id`. Each loop holds its OWN local `in_flight` map (orchestrator team_assignment_orchestrator.rs:400), so neither sees the other's launches. Both read the same `pending` steps, both compute `budget = max_parallel - running_count`, and both launch the SAME step → two `start_execution` calls, two PRs, double LLM spend.
- **Root cause**: `start_team_assignment`'s comment claims "Idempotent — multiple starts collapse into a single live task," but nothing enforces it. The DB `queued→running` transition is NOT a mutex (an already-`running` assignment passes the `matches!(status, ... | "running")` startable check at assignments.rs:125-133 and spawns again). Contrast `execute_team` (teams.rs:317), which uses `process_registry.register_run_guarded` + `has_running_pipeline` to guarantee one runner per team.
- **Impact**: corruption / data loss (duplicate side-effecting executions), runaway cost.
- **Fix sketch**: Register the orchestrator task in a per-`assignment_id` registry (like `ActiveProcessRegistry`); `run_assignment` becomes a no-op if a live task already owns the id. Make this CLASS impossible by gating spawn on an atomic insert into a "live orchestrators" set keyed by assignment id.

## 2. Abort/pause never cancel in-flight executions → success/failure theater + orphaned agent work
- **Severity**: critical
- **Category**: silent-failure
- **File**: src-tauri/src/commands/teams/assignments.rs:146-166 (abort/pause)
- **Scenario**: An assignment has a step actively running an LLM execution. User clicks Abort. `abort_team_assignment` → `resolve_review_abort` only sets assignment status `aborted` (orchestrator.rs:196) and emits progress. The tick loop exits on next tick (orchestrator.rs:413), but the in-flight step is a DETACHED `tokio::spawn` (orchestrator.rs:562) that keeps polling its execution for up to 600 ticks; on completion it calls `update_step_status(..., "done"/"failed", ...)` — mutating a step under an already-terminal `aborted` assignment, and the agent keeps spending tokens / opening a PR after the user "stopped" it. Pause has the same gap.
- **Root cause**: Unlike `cancel_pipeline` (teams.rs:358-362) which calls `process_registry.cancel_run`, the assignment abort path has no cancellation token threaded into `start_execution`, and detached step tasks aren't joined/aborted. "Aborted" is a status flip, not a stop.
- **Impact**: UX degradation + cost + state corruption (post-terminal step writes; a step can flip to `done` after abort, i.e. success theater).
- **Fix sketch**: Thread a cancellation flag (per assignment) into `run_step`'s execution and the poll loop; on abort/pause, signal it and cancel the underlying execution via the process registry. Make the poll loop bail immediately when the parent assignment is terminal.

## 3. delete_team cascades away a live assignment → orphaned execution + orchestrator loop error
- **Severity**: high
- **Category**: recovery-gap
- **File**: src-tauri/src/commands/teams/teams.rs:69-85 (delete_team)
- **Scenario**: A team has a `running` team_assignment. User deletes the team. `delete_team` checks only `has_running_pipeline` and `is_linked_to_dev_project` — it does NOT check for active team_assignments. The DELETE succeeds; `team_assignments.team_id ... ON DELETE CASCADE` (migrations/incremental.rs:4065) cascades the assignment + steps away. The live orchestrator tick then calls `get_by_id` (orchestrator.rs:412) → `NotFound` → `tick_loop` returns Err → `run_assignment` tries `update_assignment_status(... "failed")` on a row that no longer exists (silent no-op). The in-flight persona execution is orphaned with nothing tracking it.
- **Root cause**: `delete_team_assignment` carefully guards active assignments (assignments.rs:253-278, with a doc comment warning this exact orphaning), but the parent `delete_team` path bypasses that guard entirely.
- **Impact**: data loss / orphaned background work / loop crash.
- **Fix sketch**: In `delete_team`, refuse deletion when `team_assignments` has any row in (`queued`,`running`,`awaiting_review`) for the team — mirror the `assignment_is_active` guard the assignment-delete path already uses.

## 4. Member removed mid-assignment leaves a dangling/misrouted step
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/commands/teams/teams.rs:141-144 (remove_team_member)
- **Scenario**: An assignment is running. User removes a team member whose persona is `assigned_persona_id` on a pending step. `remove_team_member` deletes the `persona_team_members` row with no reconciliation against live assignment steps. Two failure modes: (a) the step's pre-bound persona id is still honored by `resolve_assignee` (orchestrator.rs:1221) and `check_persona_eligible` still passes (only team membership was removed, not the persona) → a NON-member silently executes team work; (b) for auto-match steps, the removed persona is excluded from candidates (orchestrator.rs:1229-1242) — if it was the sole match, the step fails → assignment wedges in `awaiting_review` with no clear cause.
- **Root cause**: Team membership and live assignment routing are independent; membership mutation has no "is this persona currently routed in a live step?" check.
- **Impact**: corruption (work executed by a removed member) or stuck assignment.
- **Fix sketch**: Block member removal (or warn + auto-reassign/skip its steps) when the persona is referenced by a non-terminal step of an active assignment on that team.

## 5. evict_excess TOCTOU under concurrent step memory writes overshoots the cap
- **Severity**: high
- **Category**: race-condition
- **File**: src-tauri/src/db/repos/resources/team_memories.rs:438-495 (evict_excess), :142-178 (create)
- **Scenario**: Multiple steps run concurrently (max_parallel up to 16) and each can write a shared team-memory lesson (QA bounce → `team_memories::create`, orchestrator.rs:1065). `evict_excess` runs three SEPARATE statements on a plain (non-IMMEDIATE) connection: COUNT auto, COUNT manual, then DELETE `LIMIT excess`. Concurrent `create`s landing between the COUNTs and the DELETE mean `excess` is computed from a stale total — the cap is overshot (memories accumulate past `max_memories`) or, if eviction is triggered from several members at once, more rows are deleted than intended. `create` itself is a bare insert with no surrounding transaction, so the read-then-evict pair is not serialized against it.
- **Root cause**: The count-then-delete is not atomic; only `team_memories::update` uses `TransactionBehavior::Immediate` (line 204). Eviction and creation race on the shared team ledger.
- **Impact**: shared team-memory cap violated / unintended lost rows in the cross-member shared context.
- **Fix sketch**: Do eviction in a single `BEGIN IMMEDIATE` transaction (or a single `DELETE ... WHERE id IN (SELECT ... LIMIT (SELECT COUNT...)-cap)` statement) so count and delete observe one consistent snapshot under the write lock.

## 6. Step failure is swallowed as Ok → assignment can complete "done" while a step never really ran
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/db/repos/orchestration/team_assignments.rs:430-481 (update_step_status COALESCE) ; reached via assignments.rs:218 (Skip) and orchestrator skip/restore paths
- **Scenario**: `resolve_review_skip` (assignments.rs:218) marks a step `skipped`; the orchestrator's terminal check treats `skipped` as terminal and computes `final_status = done` unless a step is literally `failed` (orchestrator.rs:478-483). A user (or cascade) skipping the one step that mattered yields an assignment marked `done` even though that work never executed — and for goal-linked assignments the close-loop then checks off the goal to-do by title match (orchestrator.rs:502-519). Compounding it: `update_step_status` uses `error_message = COALESCE(?2, error_message)` (repo line 443), so transitioning a step `failed→skipped→pending` with `None` preserves a STALE prior error_message; `build_step_input`'s `REWORK_MARKER` detection keys off `error_message` (orchestrator.rs:1183), so a stale marker can mis-trigger rework-feedback on an unrelated re-run.
- **Root cause**: "all steps terminal and none `failed`" conflates `skipped` (work intentionally not done) with `done` (work succeeded); and COALESCE-preserved error_message blurs per-attempt state.
- **Impact**: success theater (assignment/goal marked complete with required work skipped) + occasional mis-routed rework context.
- **Fix sketch**: Distinguish "completed with skips" from "fully done" in the terminal status (or require explicit user acknowledgement to finalize when any required, non-user-skipped step is `skipped`); clear (not COALESCE) `error_message` on every transition to `pending`.
