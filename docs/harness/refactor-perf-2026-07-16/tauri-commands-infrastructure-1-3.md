# tauri:commands/infrastructure [1/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 3 high / 3 medium / 0 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. Headless Claude CLI spawn envelope duplicated ~7× — copies have already drifted on subscription-auth forcing
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/infrastructure/idea_scanner.rs:625 (also task_executor.rs:666, twin.rs:694 and twin.rs:1503, context_generation.rs:840, kpi_scan.rs:508, kpi_compose.rs:400, use_case_scan.rs:368)
- **Scenario**: Every headless scan/compose path hand-rolls the same ~50-line envelope: `build_cli_args` + `--model claude-sonnet-4-6`, Windows `creation_flags(0x08000000)`, env_removals/env_overrides loops, spawn with the identical NotFound error message, and a detached stdin-writer task. The copies have drifted: `context_generation.rs:870`, `kpi_scan.rs:536`, `kpi_compose.rs:427` and `use_case_scan.rs:393` call `crate::engine::cli_process::force_subscription_auth(&mut cmd)` (comment: "parity with every other headless Claude spawn"), but `idea_scanner::run_idea_scan`, `task_executor::run_task_execution`, `twin::spawn_claude_with_prompt` and `twin_generate_bio` do NOT.
- **Root cause**: Each new scanner was "cloned from idea_scanner.rs / kpi_scan.rs" (the module comments say so) instead of extracting a shared spawn helper; twin.rs even factored out `spawn_claude_with_prompt` but left `twin_generate_bio`'s inlined copy of the exact same code in the same file.
- **Impact**: A behavior fix applied to one copy silently misses six others — the subscription-auth divergence means idea scans, task executions and all twin generations may fall back to pay-as-you-go API billing, the precise failure mode the other four spawns explicitly guard against (verify whether `build_cli_args`'s env_removals already covers ANTHROPIC_API_KEY; if it does, the four explicit calls are the redundant side of the drift). ~350 duplicated LOC.
- **Fix sketch**: Extend `engine::cli_process` with one `spawn_headless_claude(prompt: String, cwd: Option<&Path>, model: &str) -> Result<Child>` (or a builder) that owns the creation_flags/env/subscription-auth/stdin-task boilerplate; convert all eight call sites. Make `twin_generate_bio` call `spawn_claude_with_prompt` immediately as a first zero-risk step. Decide once whether `force_subscription_auth` is mandatory and apply it in the helper.

## 2. Per-task execution lifecycle copy-pasted three times in task_executor.rs
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/infrastructure/task_executor.rs:277 (also 405-575 and 1146-1308)
- **Scenario**: The full task lifecycle — load task/project, `gather_task_context`, `build_task_prompt`, mark running, `insert_running`, run with cancel-select, then the completed/failed branches (update_task, set_status, TASK_EXEC_COMPLETE emit, goal signal) — appears verbatim in `dev_tools_execute_task`, in `dev_tools_start_batch`'s per-task closure, and in `run_one_task_for_auto` (whose doc comment admits it "mirrors dev_tools_start_batch's per-task body"). `dev_tools_cancel_task_execution` additionally duplicates `cancel_running_task` line-for-line instead of calling it.
- **Root cause**: Batch and auto-run were built by cloning the single-task body rather than extracting it.
- **Impact**: ~350 LOC of triplication in a hot orchestration file; the copies already differ subtly (single-task path sends OS notifications and emits warnings, batch path doesn't notify) and any lifecycle change (e.g. new status, spend tracking) must be applied three times or the paths diverge.
- **Fix sketch**: Extract `async fn execute_one_task(app, pool, task_id, notify: bool) -> String` containing the shared body (essentially `run_one_task_for_auto` plus an opt-in notification flag) and have all three call sites use it. Replace `dev_tools_cancel_task_execution`'s body with `cancel_running_task(&state.db, &app, &task_id)`.

## 3. research_lab.rs is the only command module in the context with no auth guards
- **Severity**: High
- **Lens**: code-refactor
- **Category**: consistency
- **File**: src-tauri/src/commands/infrastructure/research_lab.rs:22
- **Scenario**: All 25 `research_lab_*` commands (CRUD on projects/sources/hypotheses/experiments/reports, plus `research_lab_sync_to_obsidian` / `research_lab_sync_daily_note`, which write files into the user's Obsidian vault) take `State` and touch the DB/filesystem with no `require_auth`/`require_auth_sync` call. Every other file in this context gates every command, and a grep of `ipc_auth.rs` shows no `research_lab` entries in the privileged-command set either.
- **Root cause**: The module predates (or skipped) the IPC-session hardening pass that added `require_auth_sync` to the rest of `commands/infrastructure`; it doesn't even import `ipc_auth`.
- **Impact**: If the invoke-layer gate really is driven by `is_privileged_command` (PRIVILEGED/CLOUD sets), these commands are callable without the IPC session token — including two that write arbitrary markdown into the vault path. At minimum it is a maintenance hazard: the file silently violates the module-wide convention. Needs verification against the frontend invoke bridge before treating as exploitable.
- **Fix sketch**: Add `require_auth_sync(&state)?` as the first line of every `research_lab_*` command (matching dev_tools.rs style), or add the command names to `PRIVILEGED_COMMANDS`. A unit/CI check that every `#[tauri::command]` under `commands/` either calls `require_auth*` or is explicitly allow-listed would prevent recurrence.

## 4. dev_tools_start_competition runs `tsc --noEmit` and `cargo check` synchronously inside the IPC command
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: blocking-ipc
- **File**: src-tauri/src/commands/infrastructure/dev_tools/competitions.rs:27 (called at 146)
- **Scenario**: Starting a competition calls `capture_project_baseline`, which spawns `npx tsc --noEmit` and (for Rust projects) `cargo check` with blocking `std::process::Command::output()` — inside a synchronous `#[tauri::command]`. On a real project these take tens of seconds to minutes (cargo check on this very repo compiles the workspace), during which the frontend's invoke never resolves and a Tauri worker thread is pinned.
- **Root cause**: Baseline capture was bolted onto the create-competition command instead of being deferred to the background job that runs the competitors anyway.
- **Impact**: "Start competition" appears frozen for the whole typecheck/build; on Windows a concurrent `cargo check` can also contend the target-dir lock with the user's own build. This is the entry-point click of the whole competition feature, i.e. a hot user path.
- **Fix sketch**: Create the competition row immediately and move `capture_project_baseline` into a `tokio::task::spawn_blocking` (or the competitor-spawn task) that updates `baseline_json` when done — the baseline is only read at review time, so it does not need to exist before the command returns. Alternatively make the command async and offload with `spawn_blocking`, emitting a "baseline captured" event.

## 5. dev_tools_run_triage_rules: unbounded fetch, 2 UPDATEs per match, and a lost-update on times_fired
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/infrastructure/dev_tools.rs:1567 (loop at 1579-1613)
- **Scenario**: The command loads ALL pending ideas (no limit), then for every idea×rule match issues two separate statements — a full `update_idea` and a full `update_triage_rule` — with no transaction. Worse, the `times_fired` write uses `rule.times_fired + 1` from the Vec fetched before the loop, so a rule that fires 50 times in one run ends the run with `times_fired = initial + 1`.
- **Root cause**: Row-at-a-time updates against stale in-memory rule structs instead of batched/accumulated writes.
- **Impact**: On a saturated backlog (the idea cap is enforced elsewhere at IDEA_BACKLOG_CAP) this is up to ~2×cap sequential UPDATEs per run, and the rule-effectiveness counter — the only feedback signal the triage-rules UI has — permanently under-counts, so "times fired" is wrong whenever a rule matches more than one idea per run.
- **Fix sketch**: Accumulate per-rule fire counts in a `HashMap<rule_id, i32>` during the loop and write each rule once at the end with `times_fired = times_fired + ?` in SQL (or the accumulated total). Wrap the idea-status updates in one transaction, and pass a `limit` to the pending-ideas fetch matching the backlog cap.

## 6. dev_tools_get_project_summary loads every idea/task/goal row just to count statuses
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src-tauri/src/commands/infrastructure/dev_tools.rs:2727-2737
- **Scenario**: The project-summary command (used by both the Codebase and Codebases connectors, i.e. called by agents evaluating projects) does `list_ideas(..., None, None)`, `list_tasks(...)` and `list_goals_by_project(...)` with no limits, materializes full model structs for every row, then reduces them to five integers (`pending`, `accepted`, `running`, `active`, totals) plus 10 goal titles.
- **Root cause**: Counting in Rust over full-table fetches instead of SQL `COUNT(...) GROUP BY status`.
- **Impact**: On long-lived projects `dev_ideas` grows into the thousands (scans generate 3-8 ideas per agent per run); every connector summary call deserializes all of them — including description/reasoning text blobs — to produce three counts. Same pattern repeats in `aggregate_project_metadata` (line 1965) which is run per-project in `dev_tools_generate_cross_project_metadata`, multiplying the cost by the project count.
- **Fix sketch**: Add small repo helpers, e.g. `count_ideas_by_status(pool, project_id) -> HashMap<String, i64>` (single `SELECT status, COUNT(*) ... GROUP BY status`), and equivalents for tasks/goals; keep the existing `take(10)` titles query as a `SELECT title ... LIMIT 10`. Reuse the same counters in `aggregate_project_metadata`'s `active_goal_count`.
