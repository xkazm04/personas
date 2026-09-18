//! Task execution engine -- executes dev-tools tasks through the fleet.
//!
//! Follows the same BackgroundJobManager pattern as idea_scanner.rs for the
//! job ledger and the live panel (status + output events, DB updates). The
//! process itself is NOT this module's any more: every task is admitted as a
//! headless fleet session through the fleet's one door (`queue::admit`,
//! origin `dev_runner`, run label `dev-runner:<batch>`), so it is visible in
//! the fleet grid and counted against the global `fleet.max_parallel_sessions`
//! cap like every other session. The runner attaches to that session's
//! cooked display lines and lifecycle state and forwards them into the same
//! `TASK_EXEC_JOBS` stream the panel always read — see [`run_task_execution`].

use std::sync::Arc;

use serde_json::json;
use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

use crate::background_job::spawn_guarded;
use crate::background_job::BackgroundJobManager;
use crate::commands::fleet::queue::{self, DispatchOrigin, DispatchRequest};
use crate::commands::fleet::registry::registry;
use crate::commands::fleet::types::{FleetSessionMode, FleetSessionState};
use crate::commands::fleet::wait;
use crate::commands::infrastructure::run_checkpoints as checkpoints;
use crate::db::repos::dev_tools as repo;
use crate::engine::event_registry::event_name;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// =============================================================================
// Job state
// =============================================================================

#[derive(Clone, Default)]
struct TaskExecExtra;

static TASK_EXEC_JOBS: BackgroundJobManager<TaskExecExtra> = BackgroundJobManager::new(
    "task-executor lock poisoned",
    event_name::TASK_EXEC_STATUS,
    event_name::TASK_EXEC_OUTPUT,
);

#[derive(Clone, Default)]
struct AutoRunExtra;

static AUTO_RUN_JOBS: BackgroundJobManager<AutoRunExtra> = BackgroundJobManager::new(
    "auto-run lock poisoned",
    event_name::AUTO_RUN_STATUS,
    event_name::AUTO_RUN_STATUS, // no separate output stream; status doubles
);

// =============================================================================
// Context gathering (with warning collection)
// =============================================================================

struct TaskContext {
    idea: Option<String>,
    goal: Option<String>,
    codebase: Option<String>,
    /// What this project development loop has already learned: constraints
    /// from rejected ideas first, then settled decisions, then outcomes of
    /// earlier tasks. Before Phase 2 the executor was memory-blind, so a
    /// guardrail recorded at triage time never reached the agent that could
    /// violate it. (docs/plans/backlog-memory-loop.md Phase 2.)
    memories: Option<String>,
    warnings: Vec<String>,
}

fn gather_task_context(
    pool: &crate::db::DbPool,
    source_idea_id: Option<&str>,
    goal_id: Option<&str>,
    project_id: &str,
) -> TaskContext {
    let mut warnings = Vec::new();

    let idea = match source_idea_id {
        Some(idea_id) => match repo::get_idea_by_id(pool, idea_id) {
            Ok(idea) => {
                let mut s = String::new();
                if let Some(desc) = &idea.description {
                    s.push_str(desc);
                    s.push('\n');
                }
                if let Some(reasoning) = &idea.reasoning {
                    s.push_str(reasoning);
                    s.push('\n');
                }
                Some(s)
            }
            Err(e) => {
                tracing::warn!(idea_id, error = %e, "Failed to load linked idea context");
                warnings.push(format!("Could not load linked idea {idea_id}: {e}"));
                None
            }
        },
        None => None,
    };

    let goal = match goal_id {
        Some(gid) => match repo::get_goal_by_id(pool, gid) {
            Ok(goal) => {
                let mut s = goal.title.to_string();
                if let Some(desc) = &goal.description {
                    s.push_str(&format!(": {desc}"));
                }
                s.push('\n');
                Some(s)
            }
            Err(e) => {
                tracing::warn!(goal_id = gid, error = %e, "Failed to load linked goal context");
                warnings.push(format!("Could not load linked goal {gid}: {e}"));
                None
            }
        },
        None => None,
    };

    let codebase = match repo::list_contexts_by_project(pool, project_id, None) {
        Ok(contexts) if !contexts.is_empty() => {
            let mut s = String::new();
            for ctx in &contexts {
                s.push_str(&format!("### {}\n", ctx.name));
                if let Some(desc) = &ctx.description {
                    s.push_str(&format!("{desc}\n"));
                }
                s.push_str(&format!("Files: {}\n\n", ctx.file_paths));
            }
            Some(s)
        }
        Ok(_) => None,
        Err(e) => {
            tracing::warn!(project_id, error = %e, "Failed to load codebase contexts");
            warnings.push(format!("Could not load codebase contexts: {e}"));
            None
        }
    };

    // Budgeted so a long-lived project cannot crowd out the task itself:
    // at most 12 memories and ~1.5k characters, constraints ordered first.
    let memories = match crate::db::repos::dev_memories::get_for_injection(pool, project_id, 12) {
        Ok(rows) => crate::db::repos::dev_memories::render_for_prompt(&rows, 1_500),
        Err(e) => {
            tracing::warn!(project_id, error = %e, "Failed to load project memories");
            warnings.push(format!("Could not load project memories: {e}"));
            None
        }
    };

    TaskContext {
        idea,
        goal,
        codebase,
        memories,
        warnings,
    }
}

// =============================================================================
// Outcome memory (docs/plans/backlog-memory-loop.md Phase 2)
// =============================================================================

/// Write what a finished run taught this project into the development loop
/// memory. Goal signals already recorded that a task ENDED; this records what
/// was learned, so the next scan and the next task can read it. The project is
/// re-read from the task row rather than threaded through every spawn closure -
/// one indexed lookup at a terminal moment, and no capture plumbing to drift.
///
/// Idempotent by construction: dev_memories has a unique index on
/// (project_id, source_kind, source_id), so a retried task cannot inflate the
/// record with duplicate outcomes.
/// `pub(crate)` so the headless write-back door
/// ([`super::app_master_writeback`]) closes a task through the SAME learning
/// write-backs `finalize_task` uses. A worker-reported outcome must teach the
/// project exactly what an in-app run teaches it, and the only way to guarantee
/// that is to call this rather than to copy it.
pub(crate) fn record_task_outcome(pool: &crate::db::DbPool, task_id: &str, ok: bool, detail: &str) {
    let task = match repo::get_task_by_id(pool, task_id) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(task_id, error = %e, "outcome memory: task lookup failed");
            return;
        }
    };
    let project_id = match task.project_id.as_deref() {
        Some(p) if !p.is_empty() => p,
        // A task with no project has nowhere to remember anything.
        _ => return,
    };

    // Failures carry more forward than successes: the next attempt needs to
    // know what already did not work.
    let (importance, verb) = if ok { (5, "completed") } else { (7, "FAILED") };
    let title = format!("Task {verb}: {}", task.title);
    let mut content = format!("A dev-runner task {verb}: {}.", task.title);
    if let Some(idea_id) = task.source_idea_id.as_deref() {
        content.push_str(&format!(" Promoted from backlog idea {idea_id}."));
    }
    if !detail.trim().is_empty() {
        content.push_str(&format!(" {}", detail.trim()));
    }

    if let Err(e) = crate::db::repos::dev_memories::record(
        pool,
        project_id,
        "learned",
        &title,
        &content,
        importance,
        "task_outcome",
        Some(task_id),
    ) {
        tracing::warn!(task_id, error = %e, "outcome memory: write failed");
    }
}

// =============================================================================
// Prompt construction
// =============================================================================

#[allow(clippy::too_many_arguments)]
fn build_task_prompt(
    task_title: &str,
    task_description: Option<&str>,
    idea_context: Option<String>,
    goal_context: Option<String>,
    codebase_context: Option<String>,
    memory_context: Option<String>,
    depth: &str,
) -> String {
    let mut prompt = String::new();

    prompt.push_str("You are an expert software engineer. Execute the following task:\n\n");
    prompt.push_str(&format!("## Task: {task_title}\n"));
    if let Some(desc) = task_description {
        prompt.push_str(desc);
        prompt.push('\n');
    }
    prompt.push('\n');

    // Depth-specific instructions
    match depth {
        "campaign" => {
            prompt.push_str("## Execution Strategy: Campaign\n");
            prompt.push_str("This task has multiple deliverables. Break it into subtasks first:\n");
            prompt.push_str("1. Analyze the goal and identify 3-7 concrete subtasks\n");
            prompt.push_str("2. Execute each subtask in sequence\n");
            prompt.push_str("3. After each subtask, report progress and what was completed\n");
            prompt.push_str("4. When all subtasks are done, provide a consolidated summary\n\n");
        }
        "deep_build" => {
            prompt.push_str("## Execution Strategy: Deep Build\n");
            prompt.push_str(
                "This is a complex task requiring thorough planning before implementation:\n",
            );
            prompt.push_str("1. **Research phase**: Explore the codebase, identify all affected files and dependencies\n");
            prompt.push_str("2. **Planning phase**: Write a detailed plan with specific file changes, new files, and test strategy\n");
            prompt.push_str("3. **Implementation phase**: Execute the plan methodically, one component at a time\n");
            prompt.push_str(
                "4. **Validation phase**: Run tests, verify correctness, check for regressions\n",
            );
            prompt
                .push_str("5. **Summary**: Provide a comprehensive report of all changes made\n\n");
        }
        _ => {
            prompt.push_str("## Execution Strategy: Quick Task\n");
            prompt.push_str("Execute this task directly with minimal planning overhead.\n\n");
        }
    }

    if let Some(idea) = idea_context {
        prompt.push_str("## Background\n");
        prompt.push_str(&idea);
        prompt.push('\n');
    }

    if let Some(goal) = goal_context {
        prompt.push_str("## Goal Context\n");
        prompt.push_str(&goal);
        prompt.push('\n');
    }

    // Placed BEFORE the codebase dump so it survives any downstream
    // truncation: a constraint the team already settled is the most
    // expensive thing to relearn by violating it.
    if let Some(memories) = memory_context {
        prompt.push_str("## What This Project Has Already Learned\n");
        prompt.push_str("Settled constraints and decisions from earlier triage and runs. Honour these - do NOT re-litigate or contradict them.\n");
        prompt.push_str(&memories);
        prompt.push('\n');
    }

    if let Some(codebase) = codebase_context {
        prompt.push_str("## Codebase Context\n");
        prompt.push_str(&codebase);
        prompt.push('\n');
    }

    prompt.push_str("\nWork in the project directory. Make all necessary code changes.\n");
    prompt.push_str("When done, output a brief summary of what was accomplished.\n");

    prompt
}

// =============================================================================
// Terminal chokepoint
// =============================================================================

/// The per-path differences between the three task-execution arms. Everything
/// else about reaching a terminal state is identical and lives in
/// [`finalize_task`].
struct FinalizeOpts<'a> {
    /// `Some(project_name)` → also send a desktop notification. Only the
    /// single-task path does; batch and auto-run would spam one per task.
    notify_project: Option<&'a str>,
    /// Message attached to the `task_completed` goal signal.
    goal_success_message: &'a str,
    /// When true the success outcome memory quotes the produced line count
    /// (single-task path); otherwise it records a flat "Completed successfully.".
    outcome_quotes_line_count: bool,
}

/// THE single terminal chokepoint for a dev-task run.
///
/// Every path that can end a task — single execute, batch, auto-run — funnels
/// its result through here, so the terminal `update_task` write, the job-status
/// flip, the `TASK_EXEC_COMPLETE` emit, the outcome memory and the goal signal
/// happen exactly once and in one order. This used to be three hand-copied
/// blocks that had already drifted; anything that must happen when a task
/// finishes (completion write-back, verification arming, …) belongs HERE and
/// nowhere else.
///
/// Completion write-back to the SOURCE IDEA of a finished task (plan 1D).
///
/// One thing is owed once work ships:
///
/// **A re-check is owed.** Any idea carrying a `dedup_key` is a sensor
///    finding whose signal was measured; shipping a fix does not prove the
///    number moved. Arming `verify_state = 'pending'` is the "work shipped,
///    verdict not in yet" marker.
///
///    *Why `pending` is the right token* (the P6 open question): the sweep's
///    eligibility rule (`findings/verify.ts::isVerifiable`) is
///    `origin != null && dedup_key != null && status == 'accepted' && a linked
///    task completed` — it never reads `verify_state`, so arming cannot
///    confuse it. And `pending` is not sensor-owned: `verdictFor` itself
///    returns `pending` for "the sensor did not probe, so no verdict", and
///    `VerdictChip` renders nothing for it. Arming therefore says exactly what
///    we mean — judged: not yet — and a real verdict overwrites it on the next
///    sweep. (Contrast the alternative of leaving it NULL: indistinguishable
///    from a finding nobody ever shipped.)
///
/// Best-effort throughout: a task's terminal state must never depend on the
/// projections hanging off it.
/// `pub(crate)` for the same reason as [`record_task_outcome`] — see its note.
pub(crate) fn write_back_to_source_idea(pool: &crate::db::DbPool, task_id: &str, success: bool) {
    let task = match repo::get_task_by_id(pool, task_id) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(task_id, error = %e, "completion write-back: task unreadable");
            return;
        }
    };
    let Some(idea_id) = task.source_idea_id.as_deref() else {
        return;
    };
    let idea = match repo::get_idea_by_id(pool, idea_id) {
        Ok(i) => i,
        Err(e) => {
            tracing::warn!(task_id, idea_id, error = %e, "completion write-back: idea unreadable");
            return;
        }
    };

    if success && idea.dedup_key.is_some() {
        if let Err(e) = repo::set_finding_verify_state(pool, &idea.id, "pending", None) {
            tracing::warn!(task_id, idea_id, error = %e, "completion write-back: failed to arm verification");
        }
    }
}

/// Returns the final status (`"completed"` / `"failed"`).
fn finalize_task(
    app: &tauri::AppHandle,
    pool: &crate::db::DbPool,
    task_id: &str,
    result: Result<i32, AppError>,
    context_warnings: &[String],
    goal_id: Option<&str>,
    opts: FinalizeOpts<'_>,
) -> String {
    let completed_now = chrono::Utc::now().to_rfc3339();

    match result {
        Ok(line_count) => {
            let _ = repo::update_task(
                pool,
                task_id,
                None,
                None,
                Some("completed"),
                None,
                Some(100),
                Some(line_count),
                None,
                None,
                Some(Some(&completed_now)),
            );
            TASK_EXEC_JOBS.set_status(app, task_id, "completed", None);
            let _ = app.emit(
                event_name::TASK_EXEC_COMPLETE,
                json!({
                    "task_id": task_id,
                    "output_lines": line_count,
                    "context_warnings": context_warnings,
                }),
            );
            if let Some(project_name) = opts.notify_project {
                crate::notifications::send(
                    app,
                    "Task Complete",
                    &format!("{project_name}: task finished with {line_count} output lines."),
                );
            }

            // Learning loop: record what this run taught the project.
            let detail = if opts.outcome_quotes_line_count {
                format!("Produced {line_count} output lines.")
            } else {
                "Completed successfully.".to_string()
            };
            record_task_outcome(pool, task_id, true, &detail);
            write_back_to_source_idea(pool, task_id, true);

            if let Some(gid) = goal_id {
                let _ = repo::create_goal_signal(
                    pool,
                    gid,
                    "task_completed",
                    Some(task_id),
                    Some(10),
                    Some(opts.goal_success_message),
                );
                // A completed task that names a goal is progress on it: the
                // goal's percentage is derived from its linked tasks too, and
                // nothing else recomputes it when a task lands.
                if let Err(e) = repo::apply_resolved_goal_progress(pool, gid) {
                    tracing::warn!(task_id = %task_id, goal_id = %gid, error = %e,
                        "task executor: goal progress recompute failed");
                }
            }
            "completed".to_string()
        }
        Err(e) => {
            let msg = format!("{e}");
            let _ = repo::update_task(
                pool,
                task_id,
                None,
                None,
                Some("failed"),
                None,
                None,
                None,
                Some(Some(&msg)),
                None,
                Some(Some(&completed_now)),
            );
            TASK_EXEC_JOBS.set_status(app, task_id, "failed", Some(msg.clone()));
            TASK_EXEC_JOBS.emit_line(app, task_id, format!("[Error] {msg}"));
            if let Some(project_name) = opts.notify_project {
                crate::notifications::send(app, "Task Failed", &format!("{project_name}: {msg}"));
            }

            // Learning loop: a failure is the most instructive outcome.
            record_task_outcome(pool, task_id, false, &msg);
            write_back_to_source_idea(pool, task_id, false);

            if let Some(gid) = goal_id {
                let _ = repo::create_goal_signal(
                    pool,
                    gid,
                    "task_failed",
                    Some(task_id),
                    None,
                    Some(&msg),
                );
            }
            "failed".to_string()
        }
    }
}

// =============================================================================
// Tauri commands
// =============================================================================

#[tauri::command]
pub async fn dev_tools_execute_task(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    task_id: String,
    // Optional model override for THIS run (e.g. skill adopt/share pins
    // "claude-sonnet-5"). None keeps the dev-runner default (Sonnet). Effort
    // stays the app-wide default (medium — see prompt::cli_args::DEFAULT_EFFORT).
    model: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    let task = repo::get_task_by_id(&state.db, &task_id)?;
    let project_id = task
        .project_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("Task has no project_id".into()))?;
    let project = repo::get_project_by_id(&state.db, project_id)?;

    let ctx = gather_task_context(
        &state.db,
        task.source_idea_id.as_deref(),
        task.goal_id.as_deref(),
        project_id,
    );
    let context_warnings = ctx.warnings;

    let prompt_text = build_task_prompt(
        &task.title,
        task.description.as_deref(),
        ctx.idea,
        ctx.goal,
        ctx.codebase,
        ctx.memories,
        &task.depth,
    );

    // Mark task as running
    let now = chrono::Utc::now().to_rfc3339();
    let _ = repo::update_task(
        &state.db,
        &task_id,
        None, // title
        None, // description
        Some("running"),
        None,             // session_id
        Some(0),          // progress_pct
        None,             // output_lines
        None,             // error
        Some(Some(&now)), // started_at
        None,             // completed_at
    );

    let cancel_token = CancellationToken::new();
    TASK_EXEC_JOBS.insert_running(task_id.clone(), cancel_token.clone(), TaskExecExtra)?;
    TASK_EXEC_JOBS.set_status(&app, &task_id, "running", None);

    let app_handle = app.clone();
    let pool = state.db.clone();
    let task_id_for_spawn = task_id.clone();
    let token_for_task = cancel_token;
    let root_path = project.root_path.clone();
    let project_name = project.name.clone();
    let goal_id = task.goal_id.clone();
    let title = task.title.clone();
    let worktree_name = extract_worktree_name(task.session_id.as_deref());
    let exec_model = model.unwrap_or_else(|| DEFAULT_DEV_TASK_MODEL.to_string());

    let app_handle_for_panic = app_handle.clone();
    let pool_for_panic = pool.clone();
    let task_id_for_panic = task_id_for_spawn.clone();

    spawn_guarded(
        "dev-tools task execution",
        task_id_for_panic.clone(),
        async move {
            for w in &context_warnings {
                TASK_EXEC_JOBS.emit_line(&app_handle, &task_id_for_spawn, format!("[Warning] {w}"));
            }

            // A single execute is a batch of one: its own id is the run label.
            let result = run_task_execution(
                &app_handle,
                &task_id_for_spawn,
                &pool,
                &root_path,
                prompt_text,
                worktree_name,
                &exec_model,
                &title,
                &task_id_for_spawn,
                &token_for_task,
            )
            .await;

            finalize_task(
                &app_handle,
                &pool,
                &task_id_for_spawn,
                result,
                &context_warnings,
                goal_id.as_deref(),
                FinalizeOpts {
                    notify_project: Some(&project_name),
                    goal_success_message: "Task completed successfully",
                    outcome_quotes_line_count: true,
                },
            );
        },
        move |msg| async move {
            let completed_now = chrono::Utc::now().to_rfc3339();
            let _ = repo::update_task(
                &pool_for_panic,
                &task_id_for_panic,
                None,
                None,
                Some("failed"),
                None,
                None,
                None,
                Some(Some(&msg)),
                None,
                Some(Some(&completed_now)),
            );
            TASK_EXEC_JOBS.set_status(
                &app_handle_for_panic,
                &task_id_for_panic,
                "failed",
                Some(msg.clone()),
            );
            TASK_EXEC_JOBS.emit_line(
                &app_handle_for_panic,
                &task_id_for_panic,
                format!("[Error] {msg}"),
            );
        },
    );

    Ok(json!({ "task_id": task_id }))
}

/// Start a batch of tasks. Every task is admitted to the fleet at once — the
/// fleet's global cap decides how many run now and how many wait as `queued`
/// sessions (visible in the fleet grid, in order). `max_parallel` stays on
/// the wire for the callers that still send it and is ignored: the batch's
/// own semaphore was a second cap on top of the fleet's, and a session it
/// held back was invisible everywhere.
#[tauri::command]
pub async fn dev_tools_start_batch(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    task_ids: Vec<String>,
    max_parallel: Option<usize>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let _ = max_parallel;

    let batch_id = uuid::Uuid::new_v4().to_string();
    let started = task_ids.len();

    for tid in task_ids {
        let batch_id = batch_id.clone();
        let app_handle = app.clone();
        let pool = state.db.clone();
        let app_handle_for_panic = app_handle.clone();
        let pool_for_panic = pool.clone();
        let tid_for_panic = tid.clone();

        spawn_guarded(
            "dev-tools batch task execution",
            tid_for_panic.clone(),
            async move {
                // Read task to get project info
                let task = match repo::get_task_by_id(&pool, &tid) {
                    Ok(t) => t,
                    Err(e) => {
                        TASK_EXEC_JOBS.emit_line(
                            &app_handle,
                            &tid,
                            format!("[Error] Failed to read task: {e}"),
                        );
                        return;
                    }
                };

                let project_id = match task.project_id.as_deref() {
                    Some(pid) => pid.to_string(),
                    None => {
                        TASK_EXEC_JOBS.emit_line(
                            &app_handle,
                            &tid,
                            "[Error] Task has no project_id".to_string(),
                        );
                        return;
                    }
                };

                let project = match repo::get_project_by_id(&pool, &project_id) {
                    Ok(p) => p,
                    Err(e) => {
                        TASK_EXEC_JOBS.emit_line(
                            &app_handle,
                            &tid,
                            format!("[Error] Failed to read project: {e}"),
                        );
                        return;
                    }
                };

                let ctx = gather_task_context(
                    &pool,
                    task.source_idea_id.as_deref(),
                    task.goal_id.as_deref(),
                    &project_id,
                );
                let context_warnings = ctx.warnings;

                let prompt_text = build_task_prompt(
                    &task.title,
                    task.description.as_deref(),
                    ctx.idea,
                    ctx.goal,
                    ctx.codebase,
                    ctx.memories,
                    &task.depth,
                );

                // Mark task as running
                let now = chrono::Utc::now().to_rfc3339();
                let _ = repo::update_task(
                    &pool,
                    &tid,
                    None,
                    None,
                    Some("running"),
                    None,
                    Some(0),
                    None,
                    None,
                    Some(Some(&now)),
                    None,
                );

                let cancel_token = CancellationToken::new();
                if TASK_EXEC_JOBS
                    .insert_running(tid.clone(), cancel_token.clone(), TaskExecExtra)
                    .is_err()
                {
                    return;
                }
                TASK_EXEC_JOBS.set_status(&app_handle, &tid, "running", None);

                for w in &context_warnings {
                    TASK_EXEC_JOBS.emit_line(&app_handle, &tid, format!("[Warning] {w}"));
                }

                let batch_worktree_name = extract_worktree_name(task.session_id.as_deref());
                let result = run_task_execution(
                    &app_handle,
                    &tid,
                    &pool,
                    &project.root_path,
                    prompt_text,
                    batch_worktree_name,
                    DEFAULT_DEV_TASK_MODEL,
                    &task.title,
                    &batch_id,
                    &cancel_token,
                )
                .await;

                let goal_id = task.goal_id.clone();

                finalize_task(
                    &app_handle,
                    &pool,
                    &tid,
                    result,
                    &context_warnings,
                    goal_id.as_deref(),
                    FinalizeOpts {
                        notify_project: None,
                        goal_success_message: "Task completed successfully",
                        outcome_quotes_line_count: false,
                    },
                );
            },
            move |msg| async move {
                let completed_now = chrono::Utc::now().to_rfc3339();
                let _ = repo::update_task(
                    &pool_for_panic,
                    &tid_for_panic,
                    None,
                    None,
                    Some("failed"),
                    None,
                    None,
                    None,
                    Some(Some(&msg)),
                    None,
                    Some(Some(&completed_now)),
                );
                TASK_EXEC_JOBS.set_status(
                    &app_handle_for_panic,
                    &tid_for_panic,
                    "failed",
                    Some(msg.clone()),
                );
                TASK_EXEC_JOBS.emit_line(
                    &app_handle_for_panic,
                    &tid_for_panic,
                    format!("[Error] {msg}"),
                );
            },
        );
    }

    Ok(json!({ "batch_id": batch_id, "started": started }))
}

/// Cancel an in-flight task execution. Callable from other modules
/// (e.g. competition cancellation needs to cancel all running competitor tasks).
/// Returns true if the task was running and got cancelled, false otherwise.
pub fn cancel_running_task(
    pool: &crate::db::DbPool,
    app: &tauri::AppHandle,
    task_id: &str,
) -> Result<bool, AppError> {
    if let Some(token) = TASK_EXEC_JOBS.get_cancel_token(task_id)? {
        token.cancel();
        TASK_EXEC_JOBS.set_status(app, task_id, "cancelled", None);
        let now = chrono::Utc::now().to_rfc3339();
        let _ = repo::update_task(
            pool,
            task_id,
            None,
            None,
            Some("cancelled"),
            None,
            None,
            None,
            Some(Some("Cancelled by user")),
            None,
            Some(Some(&now)),
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn dev_tools_cancel_task_execution(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    task_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;

    if let Some(token) = TASK_EXEC_JOBS.get_cancel_token(&task_id)? {
        token.cancel();
        TASK_EXEC_JOBS.set_status(&app, &task_id, "cancelled", None);
        let now = chrono::Utc::now().to_rfc3339();
        let _ = repo::update_task(
            &state.db,
            &task_id,
            None,
            None,
            Some("cancelled"),
            None,
            None,
            None,
            Some(Some("Cancelled by user")),
            None,
            Some(Some(&now)),
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

// =============================================================================
// Core task execution logic
// =============================================================================

/// Extract a Claude Code worktree name from a task's session_id field.
/// Convention: session_id = "worktree:<name>" signals the task should run
/// in an isolated Claude Code git worktree (requires Claude Code >= v2.1.49).
fn extract_worktree_name(session_id: Option<&str>) -> Option<String> {
    session_id
        .and_then(|s| s.strip_prefix("worktree:"))
        .map(|s| s.to_string())
}

/// Dev-runner default model — the app-wide headless Sonnet. A per-run override
/// (e.g. skill adopt/share → "claude-sonnet-5") is threaded from
/// `dev_tools_execute_task`; every other caller uses this.
const DEFAULT_DEV_TASK_MODEL: &str = "claude-sonnet-4-6";

// =============================================================================
// Where a runner task executes (Grand Simulation G12)
// =============================================================================

/// The directory one runner task runs in, and what the task row records about
/// it.
///
/// Until G12 this was unconditionally `dev_projects.root_path` — the operator's
/// **live checkout**. A backlog wave dispatched through
/// [`dev_tools_start_auto_run`] therefore edited the tree its operator was
/// working in, while they were working in it. The fleet arm had already solved
/// exactly this (bench sweep #23, see
/// [`personas_engine::unattended_worktree`]); the runner arm had none of it.
struct TaskWorkspace {
    /// The CLI's `cwd`. The isolated worktree, or `root_path` on the fallback.
    /// The headless transcript is filed under a path derived from this cwd, so
    /// pointing it here moves the transcript with the work.
    exec_dir: std::path::PathBuf,
    /// `autopilot/<slug>` — `None` ⟺ the run was not isolated.
    branch: Option<String>,
    /// Why isolation was refused — `None` ⟺ it was not.
    fallback_reason: Option<String>,
}

impl TaskWorkspace {
    /// The shared checkout, with the reason we could not do better. **Never
    /// silent**: the caller logs it, emits it to the live panel, and writes it
    /// to the task row.
    fn fallback(root_path: &str, reason: String) -> Self {
        Self {
            exec_dir: std::path::PathBuf::from(root_path),
            branch: None,
            fallback_reason: Some(reason),
        }
    }
}

/// Resolve — and if necessary create — the isolated git worktree this task
/// executes in.
///
/// Reuses [`personas_engine::unattended_worktree::prepare_authoring_worktree`],
/// the helper the fleet arm already authors through, rather than growing a
/// second one: the branch namespace, the free-slot rule, the dependency borrow
/// and the "a non-repository is refused, not dispatched into" refusal are all
/// one implementation for both arms.
///
/// **Reuse before creation.** A task that already recorded a worktree whose
/// directory is still there runs in it again, so a retry lands on top of its own
/// earlier attempt instead of forking a second branch for the same work. A
/// recorded worktree the operator has since removed falls through to creation.
///
/// **The fallback is a fallback, not a refusal.** The fleet arm refuses to
/// dispatch at all when it cannot get a worktree, because an overnight worker
/// has nobody watching. The runner arm is reached from the Run Desk with a
/// person present, and a project that is not a git repository at all is a
/// legitimate thing to run a task in — so it runs in the root, and says so
/// three times over (log, live panel, task row).
/// `worktrees_root` is passed in rather than resolved here so the decision is
/// reachable from a test: the only reason this function would otherwise need a
/// `tauri::AppHandle` is
/// [`super::dev_tools::authoring_worktrees_root`], and an `AppHandle` is not
/// something a unit test can produce. The caller resolves it and hands over
/// either the root or the reason there is none.
async fn resolve_task_workspace(
    pool: &crate::db::DbPool,
    task_id: &str,
    root_path: &str,
    worktrees_root: Result<std::path::PathBuf, String>,
) -> TaskWorkspace {
    let task = match repo::get_task_by_id(pool, task_id) {
        Ok(t) => t,
        Err(e) => {
            return TaskWorkspace::fallback(root_path, format!("task row unreadable: {e}"));
        }
    };

    // Reuse: the same task, running again, in the place it ran before.
    if let (Some(path), Some(branch)) = (
        task.worktree_path
            .as_deref()
            .filter(|p| !p.trim().is_empty()),
        task.worktree_branch
            .as_deref()
            .filter(|b| !b.trim().is_empty()),
    ) {
        let dir = std::path::PathBuf::from(path);
        // A linked worktree carries a `.git` FILE pointing at the common dir;
        // a directory that merely survived is not a worktree.
        if dir.join(".git").exists() {
            return TaskWorkspace {
                exec_dir: dir,
                branch: Some(branch.to_string()),
                fallback_reason: None,
            };
        }
    }

    let Some(project_id) = task.project_id.as_deref().filter(|p| !p.trim().is_empty()) else {
        return TaskWorkspace::fallback(
            root_path,
            "task carries no project, so there is no worktree root to author under".to_string(),
        );
    };

    let worktrees_root = match worktrees_root {
        Ok(r) => r,
        Err(e) => return TaskWorkspace::fallback(root_path, e),
    };
    let main_branch = repo::get_project_by_id(pool, project_id)
        .ok()
        .and_then(|p| p.main_branch);

    match personas_engine::unattended_worktree::prepare_authoring_worktree(
        std::path::Path::new(root_path),
        &worktrees_root,
        project_id,
        &task.title,
        main_branch.as_deref(),
    )
    .await
    {
        Ok(wt) => TaskWorkspace {
            exec_dir: wt.path,
            branch: Some(wt.branch),
            fallback_reason: None,
        },
        Err(e) => TaskWorkspace::fallback(root_path, e),
    }
}

/// The dispatch a Dev-runner task becomes: ONE headless fleet session named
/// after the task, origin `dev_runner`, under the batch's `dev-runner:<batch>`
/// run label (which is what makes it a one-shot worker — its process is
/// freed the moment its single turn ends, as the runner's own child used to
/// exit by itself). The model rides as `--model`, a competition-bound task's
/// checkout as `--worktree <name>`. Pure over its inputs so a batch can be
/// checked without an app.
fn dev_runner_request(
    exec_dir: &std::path::Path,
    title: &str,
    prompt_text: String,
    model: &str,
    worktree_name: Option<&str>,
    batch_id: &str,
) -> DispatchRequest {
    let mut extra: Vec<String> = vec!["--model".to_string(), model.to_string()];
    if let Some(wt) = worktree_name {
        extra.push("--worktree".to_string());
        extra.push(wt.to_string());
    }
    DispatchRequest {
        cwd: exec_dir.to_string_lossy().into_owned(),
        name: Some(title.trim().to_string()).filter(|s| !s.is_empty()),
        title: None,
        args: queue::headless_args(&prompt_text, extra),
        mode: FleetSessionMode::Headless,
        run_label: Some(personas_engine::unattended::dev_runner_run_label(batch_id)),
        origin: DispatchOrigin::DevRunner,
        persona_id: None,
        goal_id: None,
        cycle_index: None,
        not_before_ms: None,
    }
}

/// How long a started task may run before the runner ends it — the same ten
/// minutes the runner's own child got. Counted from the moment the session
/// STARTS: time spent waiting in the fleet queue is not the task's.
const TASK_RUN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
/// Stderr lines kept for the non-zero-exit report.
const STDERR_TAIL_CAP: usize = 200;

/// What following an admitted session to its end produced.
struct Followed {
    output_lines: i32,
    stderr_tail: Vec<String>,
    state: FleetSessionState,
    exit_code: Option<i32>,
    state_reason: Option<String>,
}

/// A task's terminal state as the runner reads it. `Finished` is what a
/// one-shot worker parks in after its `result` event (declared or not);
/// `Exited` is the process dying first (crash, kill, clean exit of a resumed
/// conversation). A session gone from the registry is terminal too.
fn is_terminal(state: Option<FleetSessionState>) -> bool {
    match state {
        None => true,
        Some(s) => matches!(s, FleetSessionState::Exited | FleetSessionState::Finished),
    }
}

/// One cooked display line from the headless lane, into the runner's stream.
///
/// The headless reader renders a stream-json event to plain text: `● <tool>`
/// for a tool call, `— turn complete (…)` for the result, `! <line>` for
/// stderr, `· session started (<model>)` for init, and the assistant's own
/// prose verbatim — which is where the `[Progress] {…}` markers the task
/// prompt asks for arrive, one per line.
fn note_fleet_line(
    app: &tauri::AppHandle,
    task_id: &str,
    pool: &crate::db::DbPool,
    line: &str,
    output_lines: &mut i32,
    stderr_tail: &mut std::collections::VecDeque<String>,
) {
    if let Some(err) = line.strip_prefix("! ") {
        if stderr_tail.len() >= STDERR_TAIL_CAP {
            stderr_tail.pop_front();
        }
        stderr_tail.push_back(err.to_string());
        TASK_EXEC_JOBS.record_line(task_id, line.to_string());
        return;
    }
    if let Some(tool) = line.strip_prefix("● ") {
        TASK_EXEC_JOBS.emit_line(app, task_id, format!("[Tool] {tool}"));
        *output_lines += 1;
        return;
    }
    if line.starts_with("— turn complete") {
        TASK_EXEC_JOBS.emit_line(app, task_id, "[Milestone] Task complete.");
        return;
    }
    if line.starts_with("· session started") {
        return;
    }

    *output_lines += 1;
    // Verbose model prose → bounded ring only; the [Progress]/[Milestone]
    // markers parsed below carry the high-level state to the live panel.
    TASK_EXEC_JOBS.record_line(task_id, line.to_string());

    // Parse structured [Progress] markers for milestone tracking.
    // Format: [Progress] {"milestone": "implementing", "detail": "..."}
    if let Some(json_str) = line.strip_prefix("[Progress]").map(|s| s.trim()) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(milestone) = parsed.get("milestone").and_then(|v| v.as_str()) {
                let pct = match milestone {
                    "analyzing" => 10,
                    "planning" => 25,
                    "implementing" => 55,
                    "testing" => 80,
                    "committing" => 95,
                    "done" => 100,
                    _ => 0,
                };
                if pct > 0 {
                    let _ = repo::update_task(
                        pool,
                        task_id,
                        None,
                        None,
                        None,
                        None,
                        Some(pct),
                        Some(*output_lines),
                        None,
                        None,
                        None,
                    );
                }
            }
        }
    }

    // Fallback: estimate progress from output volume (every 10 lines)
    if *output_lines % 10 == 0 {
        // Only update if we haven't received a structured milestone
        let current = repo::get_task_by_id(pool, task_id)
            .map(|t| t.progress_pct)
            .unwrap_or(0);
        let estimated = (*output_lines).min(90);
        if estimated > current {
            let _ = repo::update_task(
                pool,
                task_id,
                None,
                None,
                None,
                None,
                Some(estimated),
                Some(*output_lines),
                None,
                None,
                None,
            );
        }
    }
}

/// Follow a STARTED fleet session to its terminal state, forwarding its
/// display lines into the task's stream. Event-driven: the session's output
/// ring and the fleet's state generation are the wakes, with a bounded
/// re-check. Ends the session itself on the run timeout or a cancel — the
/// runner used to own the child and kill it in both cases; through the fleet
/// it asks the session's own kill handle (`close_pty_handles`) instead.
async fn follow_fleet_session(
    app: &tauri::AppHandle,
    task_id: &str,
    pool: &crate::db::DbPool,
    session_id: &str,
    cancel: &CancellationToken,
) -> Result<Followed, AppError> {
    let Some((ring, _, _)) = registry().wait_handle(session_id) else {
        return Err(AppError::Internal(
            "fleet session vanished before its output could be read".into(),
        ));
    };
    let mut ring_rx = {
        let r = ring.lock().unwrap_or_else(|e| e.into_inner());
        r.subscribe()
    };
    let mut ring_closed = false;
    let mut state_rx = wait::state_changes();
    let mut cursor: u64 = 0;
    let mut pending = String::new();
    let mut output_lines = 0i32;
    let mut stderr_tail: std::collections::VecDeque<String> =
        std::collections::VecDeque::with_capacity(STDERR_TAIL_CAP);
    let deadline = tokio::time::Instant::now() + TASK_RUN_TIMEOUT;

    loop {
        ring_rx.borrow_and_update();
        state_rx.borrow_and_update();
        let (chunk, next) = {
            let r = ring.lock().unwrap_or_else(|e| e.into_inner());
            r.read_since(cursor)
        };
        cursor = next;
        pending.push_str(&chunk);
        while let Some(pos) = pending.find('\n') {
            let line = pending[..pos].trim_end_matches('\r').trim().to_string();
            pending.drain(..=pos);
            if !line.is_empty() {
                note_fleet_line(
                    app,
                    task_id,
                    pool,
                    &line,
                    &mut output_lines,
                    &mut stderr_tail,
                );
            }
        }

        let outcome = registry().session_outcome(session_id);
        if is_terminal(outcome.as_ref().map(|(s, _, _)| *s)) {
            let rest = pending.trim().to_string();
            if !rest.is_empty() {
                note_fleet_line(
                    app,
                    task_id,
                    pool,
                    &rest,
                    &mut output_lines,
                    &mut stderr_tail,
                );
            }
            let (state, exit_code, state_reason) =
                outcome.unwrap_or((FleetSessionState::Exited, None, None));
            return Ok(Followed {
                output_lines,
                stderr_tail: stderr_tail.into_iter().collect(),
                state,
                exit_code,
                state_reason,
            });
        }

        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = registry().close_pty_handles(session_id);
                return Err(AppError::Internal("Task execution cancelled by user".into()));
            }
            changed = ring_rx.changed(), if !ring_closed => {
                if changed.is_err() {
                    ring_closed = true;
                }
            }
            _ = state_rx.changed() => {}
            // Bounded re-check, not the primary wake.
            _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {}
            _ = tokio::time::sleep_until(deadline) => {
                // A hung session is ended FIRST, through its own kill handle,
                // the way the runner used to kill its own hung child.
                let _ = registry().close_pty_handles(session_id);
                return Err(AppError::Internal(
                    "Task execution timed out after 10 minutes".into(),
                ));
            }
        }
    }
}

/// Run one task: admit it to the fleet, wait for the queue, follow the
/// session to its end. This is the one place all three arms (single execute,
/// batch, auto-run) funnel through, so it is the one place the decision is
/// made — the same reason `finalize_task` is the one terminal chokepoint.
///
/// `cancel` is handled HERE (not by the caller's `select!`): a cancelled task
/// whose session is still queued is removed from the queue, and one whose
/// session runs has that session ended — dropping the future alone would
/// leave a fleet session running with nobody following it.
///
/// Returns the output line count on success, as before. Parity note: the
/// runner never turned a non-zero CLI exit into `Err` — it surfaced the stderr
/// tail and returned `Ok` — and that stands; `Err` is spawn refusal, timeout,
/// cancel, or a session that could not start.
#[allow(clippy::too_many_arguments)]
async fn run_task_execution(
    app: &tauri::AppHandle,
    task_id: &str,
    pool: &crate::db::DbPool,
    root_path: &str,
    prompt_text: String,
    worktree_name: Option<String>,
    model: &str,
    title: &str,
    batch_id: &str,
    cancel: &CancellationToken,
) -> Result<i32, AppError> {
    TASK_EXEC_JOBS.emit_line(app, task_id, "[Milestone] Starting task execution...");

    // If the task is bound to a worktree (e.g. from a competition run),
    // pass --worktree <name> so Claude Code creates an isolated checkout
    // at <repo>/.claude/worktrees/<name>/ on branch worktree-<name>.
    if let Some(ref wt) = worktree_name {
        TASK_EXEC_JOBS.emit_line(
            app,
            task_id,
            format!("[Milestone] Using Claude Code worktree: {wt}"),
        );
    }

    // G12: every runner task authors in an isolated worktree of the project's
    // repository, never in the operator's live checkout.
    let workspace = resolve_task_workspace(
        pool,
        task_id,
        root_path,
        super::dev_tools::authoring_worktrees_root(app),
    )
    .await;
    match (&workspace.branch, &workspace.fallback_reason) {
        (Some(branch), _) => {
            TASK_EXEC_JOBS.emit_line(
                app,
                task_id,
                format!(
                    "[Milestone] Authoring in isolated worktree {} (branch {branch})",
                    workspace.exec_dir.display()
                ),
            );
        }
        (None, Some(reason)) => {
            tracing::warn!(
                task_id,
                root_path,
                reason = %reason,
                "task executor: no isolated worktree — running in the project root"
            );
            TASK_EXEC_JOBS.emit_line(
                app,
                task_id,
                format!(
                    "[Warning] Not isolated: running in the project root {root_path} — {reason}"
                ),
            );
        }
        (None, None) => {}
    }
    if let Err(e) = repo::record_task_worktree(
        pool,
        task_id,
        &workspace.exec_dir.to_string_lossy(),
        workspace.branch.as_deref(),
        workspace.fallback_reason.as_deref(),
    ) {
        // Bookkeeping must never abort a run, but without it the operator has
        // no way to find the branch this task authored.
        tracing::warn!(task_id, error = %e, "task executor: could not record the run's worktree");
    }

    let exec_dir = workspace.exec_dir;
    let request = dev_runner_request(
        &exec_dir,
        title,
        prompt_text,
        model,
        worktree_name.as_deref(),
        batch_id,
    );
    let admission = queue::admit(app, request).await?;
    let session_id = admission.session_id.clone();
    // Bind the task row to its fleet session so the Run Desk can find it —
    // unless the column already carries a `worktree:<name>` binding, which is
    // the competition runner's and must survive the run.
    if worktree_name.is_none() {
        let _ = repo::update_task(
            pool,
            task_id,
            None,
            None,
            None,
            Some(Some(session_id.as_str())),
            None,
            None,
            None,
            None,
            None,
        );
    }
    let id8 = &session_id[..session_id.len().min(8)];
    match admission.rank {
        Some(rank) => TASK_EXEC_JOBS.emit_line(
            app,
            task_id,
            format!(
                "[Milestone] Queued in the fleet as session {id8} at position {rank} \
                 ({} of {} slots live) — starts when a slot frees",
                admission.running, admission.cap
            ),
        ),
        None => TASK_EXEC_JOBS.emit_line(
            app,
            task_id,
            format!("[Milestone] Admitted to the fleet as session {id8}"),
        ),
    }

    // Wait for the queue — as long as it takes; only a cancel cuts it short.
    tokio::select! {
        _ = cancel.cancelled() => {
            if let Err(e) = queue::cancel_dispatch(app, &session_id) {
                // Not queued any more (it just started): end it instead.
                tracing::debug!(task_id, error = %e, "task executor: cancel after promotion");
                let _ = registry().close_pty_handles(&session_id);
            }
            return Err(AppError::Internal("Task execution cancelled by user".into()));
        }
        _ = wait::wait_until_state(
            &session_id,
            |s| !matches!(s, Some(FleetSessionState::Queued)),
            None,
        ) => {}
    }
    if is_terminal(registry().session_state(&session_id)) {
        let reason = registry()
            .session_outcome(&session_id)
            .and_then(|(_, _, r)| r)
            .unwrap_or_else(|| "session ended before it started".into());
        return Err(AppError::ProcessSpawn(format!(
            "fleet session {id8} could not start: {reason}"
        )));
    }
    TASK_EXEC_JOBS.emit_line(app, task_id, "[Milestone] Claude CLI started. Executing...");

    let followed = follow_fleet_session(app, task_id, pool, &session_id, cancel).await?;
    let Followed {
        output_lines,
        stderr_tail,
        state,
        exit_code,
        state_reason,
    } = followed;

    // Surface up to the last 10 stderr lines when the process died non-zero.
    // Without this, a `--worktree` collision (or any other CLI-side error)
    // surfaces only as `[Complete] Task finished with 0 output lines`.
    let died_badly =
        matches!(state, FleetSessionState::Exited) && exit_code.map(|c| c != 0).unwrap_or(true);
    if died_badly {
        let tail: Vec<String> = stderr_tail.iter().rev().take(10).rev().cloned().collect();
        TASK_EXEC_JOBS.emit_line(
            app,
            task_id,
            format!(
                "[Error] Claude CLI exited with code {} ({}).{}",
                exit_code.unwrap_or(-1),
                state_reason.as_deref().unwrap_or("no reason recorded"),
                if tail.is_empty() {
                    String::new()
                } else {
                    format!(" Last stderr:\n{}", tail.join("\n"))
                }
            ),
        );
    }

    TASK_EXEC_JOBS.emit_line(
        app,
        task_id,
        format!("[Complete] Task finished with {output_lines} output lines"),
    );

    // Auto-PR hook: opt-in per project. Best-effort — failure is logged as a
    // warning so the task itself stays "complete" rather than flipping to
    // "failed" because of a downstream git/GitHub hiccup. Only fires when
    // (a) the task ran in a worktree (we have a branch to push), (b) the
    // session ended well — a one-shot worker parked `finished`, or a clean
    // exit — and (c) the project's project-level gate is on.
    let ended_well = matches!(state, FleetSessionState::Finished) || exit_code == Some(0);
    if ended_well {
        if let Some(ref wt) = worktree_name {
            // The push runs where the work is. Branches are repository-global
            // so either directory would push the same ref, but a `git` invoked
            // in the operator's checkout is exactly what G12 removed from this
            // path — the writeback follows the exec dir like everything else.
            try_auto_pr_after_success(app, task_id, pool, &exec_dir.to_string_lossy(), wt).await;
        }
    }

    Ok(output_lines)
}

/// Resolve the project's default branch via `git symbolic-ref`. Falls back
/// to "main" when the symbolic ref is missing (fresh clone, detached HEAD).
async fn detect_default_branch(root_path: &str) -> String {
    let out = tokio::process::Command::new("git")
        .args(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .current_dir(root_path)
        .output()
        .await;
    if let Ok(o) = out {
        if o.status.success() {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            // Format is "origin/<branch>"; strip the prefix.
            if let Some(stripped) = s.strip_prefix("origin/") {
                if !stripped.is_empty() {
                    return stripped.to_string();
                }
            }
        }
    }
    "main".to_string()
}

/// Parse owner/repo from a GitHub URL of either form:
///   https://github.com/{owner}/{repo}
///   git@github.com:{owner}/{repo}.git
fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim().trim_end_matches(".git");
    let after_host = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .or_else(|| trimmed.strip_prefix("git@github.com:"))?;
    let mut parts = after_host.splitn(2, '/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner, repo))
}

/// Best-effort auto-PR flow invoked from `run_task_execution` after a clean
/// CLI exit. All failure modes log a `[Warning]` line and return — the task
/// itself remains successful regardless of outcome here.
async fn try_auto_pr_after_success(
    app: &tauri::AppHandle,
    task_id: &str,
    pool: &crate::db::DbPool,
    root_path: &str,
    worktree_name: &str,
) {
    let task = match repo::get_task_by_id(pool, task_id) {
        Ok(t) => t,
        Err(e) => {
            TASK_EXEC_JOBS.emit_line(
                app,
                task_id,
                format!("[Warning] Auto-PR skipped: failed to load task: {e}"),
            );
            return;
        }
    };

    let Some(ref project_id) = task.project_id else {
        return; // tasks without a project can't have a project-level PR config
    };

    let project = match repo::get_project_by_id(pool, project_id) {
        Ok(p) => p,
        Err(e) => {
            TASK_EXEC_JOBS.emit_line(
                app,
                task_id,
                format!("[Warning] Auto-PR skipped: project lookup failed: {e}"),
            );
            return;
        }
    };

    if !project.auto_pr_on_success {
        return; // gate off — silent skip
    }

    let Some(github_url) = project.github_url.as_deref() else {
        TASK_EXEC_JOBS.emit_line(
            app,
            task_id,
            "[Warning] Auto-PR skipped: project has no github_url",
        );
        return;
    };

    let Some((owner, repo)) = parse_github_owner_repo(github_url) else {
        TASK_EXEC_JOBS.emit_line(
            app,
            task_id,
            format!("[Warning] Auto-PR skipped: could not parse owner/repo from {github_url}"),
        );
        return;
    };

    let Some(ref credential_id) = project.pr_credential_id else {
        TASK_EXEC_JOBS.emit_line(
            app,
            task_id,
            "[Warning] Auto-PR skipped: project has no pr_credential_id set",
        );
        return;
    };

    // Branch name produced by Claude Code's --worktree flag.
    let branch = format!("worktree-{worktree_name}");

    // Push the branch. If the remote rejects, surface the stderr — common
    // causes are protected branch rules or stale upstream tracking.
    let push = tokio::process::Command::new("git")
        .args(["push", "-u", "origin", &branch])
        .current_dir(root_path)
        .output()
        .await;
    match push {
        Err(e) => {
            TASK_EXEC_JOBS.emit_line(
                app,
                task_id,
                format!("[Warning] Auto-PR push failed to spawn git: {e}"),
            );
            return;
        }
        Ok(o) if !o.status.success() => {
            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
            TASK_EXEC_JOBS.emit_line(
                app,
                task_id,
                format!("[Warning] Auto-PR push failed: {stderr}"),
            );
            return;
        }
        _ => {
            TASK_EXEC_JOBS.emit_line(
                app,
                task_id,
                format!("[Milestone] Auto-PR: pushed {branch} to origin"),
            );
        }
    }

    let base = detect_default_branch(root_path).await;

    let client =
        match crate::engine::platforms::github::build_client_from_credential(pool, credential_id) {
            Ok(c) => c,
            Err(e) => {
                TASK_EXEC_JOBS.emit_line(
                    app,
                    task_id,
                    format!("[Warning] Auto-PR skipped: GitHub credential load failed: {e}"),
                );
                return;
            }
        };

    let title = task.title.clone();
    let body = task.description.clone().unwrap_or_default();
    match client
        .create_pull_request(&owner, &repo, &branch, &base, &title, Some(&body))
        .await
    {
        Ok(pr) => {
            TASK_EXEC_JOBS.emit_line(
                app,
                task_id,
                format!(
                    "[Milestone] Auto-PR created: {} (#{}, {} -> {})",
                    pr.html_url, pr.number, pr.head_branch, pr.base_branch
                ),
            );
            // Best-effort emit of the json payload for any UI that listens.
            let _ = app.emit(
                "task-auto-pr",
                json!({
                    "task_id": task_id,
                    "pr_number": pr.number,
                    "pr_url": pr.html_url,
                }),
            );
        }
        Err(e) => {
            TASK_EXEC_JOBS.emit_line(
                app,
                task_id,
                format!("[Warning] Auto-PR creation failed: {e}"),
            );
        }
    }
}

// =============================================================================
// Auto-run scheduler — drains a project's pending backlog respecting
// goal-DAG dependencies. See AUTO_RUN_DESIGN.md alongside this file.
// =============================================================================

#[derive(serde::Serialize, Clone)]
struct AutoRunCompletePayload {
    run_id: String,
    completed: u32,
    failed: u32,
    skipped: u32,
    iterations: u32,
    snapshot_size: u32,
    termination_reason: String,
}

/// Run one queued task to completion as part of an auto-run wave.
/// Mirrors `dev_tools_start_batch`'s per-task body but is called by the
/// scheduler from a `JoinSet`. Returns the final task status string.
async fn run_one_task_for_auto(
    app: tauri::AppHandle,
    pool: crate::db::DbPool,
    task_id: String,
    run_id: String,
) -> String {
    let task = match repo::get_task_by_id(&pool, &task_id) {
        Ok(t) => t,
        Err(e) => {
            TASK_EXEC_JOBS.emit_line(&app, &task_id, format!("[Error] Failed to read task: {e}"));
            return "failed".to_string();
        }
    };

    let project_id = match task.project_id.as_deref() {
        Some(pid) => pid.to_string(),
        None => {
            TASK_EXEC_JOBS.emit_line(&app, &task_id, "[Error] Task has no project_id".to_string());
            return "failed".to_string();
        }
    };

    let project = match repo::get_project_by_id(&pool, &project_id) {
        Ok(p) => p,
        Err(e) => {
            TASK_EXEC_JOBS.emit_line(
                &app,
                &task_id,
                format!("[Error] Failed to read project: {e}"),
            );
            return "failed".to_string();
        }
    };

    let ctx = gather_task_context(
        &pool,
        task.source_idea_id.as_deref(),
        task.goal_id.as_deref(),
        &project_id,
    );
    let context_warnings = ctx.warnings;

    let prompt_text = build_task_prompt(
        &task.title,
        task.description.as_deref(),
        ctx.idea,
        ctx.goal,
        ctx.codebase,
        ctx.memories,
        &task.depth,
    );

    let now = chrono::Utc::now().to_rfc3339();
    let _ = repo::update_task(
        &pool,
        &task_id,
        None,
        None,
        Some("running"),
        None,
        Some(0),
        None,
        None,
        Some(Some(&now)),
        None,
    );

    let cancel_token = CancellationToken::new();
    if TASK_EXEC_JOBS
        .insert_running(task_id.clone(), cancel_token.clone(), TaskExecExtra)
        .is_err()
    {
        return "failed".to_string();
    }
    TASK_EXEC_JOBS.set_status(&app, &task_id, "running", None);

    for w in &context_warnings {
        TASK_EXEC_JOBS.emit_line(&app, &task_id, format!("[Warning] {w}"));
    }

    let worktree_name = extract_worktree_name(task.session_id.as_deref());
    let result = run_task_execution(
        &app,
        &task_id,
        &pool,
        &project.root_path,
        prompt_text,
        worktree_name,
        DEFAULT_DEV_TASK_MODEL,
        &task.title,
        &run_id,
        &cancel_token,
    )
    .await;

    let goal_id = task.goal_id.clone();
    finalize_task(
        &app,
        &pool,
        &task_id,
        result,
        &context_warnings,
        goal_id.as_deref(),
        FinalizeOpts {
            notify_project: None,
            goal_success_message: "Task completed (auto-run)",
            outcome_quotes_line_count: false,
        },
    )
}

#[tauri::command]
pub async fn dev_tools_start_auto_run(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
    max_parallel: Option<usize>,
    max_iterations: Option<u32>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    // A wave is every task that is READY (its goal-DAG dependencies done);
    // how many of them run at once is the fleet queue's decision, not this
    // scheduler's. `max_parallel` stays on the wire and is ignored.
    let _ = max_parallel;
    let max_iterations = max_iterations.unwrap_or(50).clamp(1, 200);

    // Take a snapshot of queued task IDs that exist at start. Tasks created
    // during the run are NOT picked up — see AUTO_RUN_DESIGN.md non-goals.
    let snapshot_ids: std::collections::HashSet<String> =
        repo::list_tasks(&state.db, Some(&project_id), Some("queued"))?
            .into_iter()
            .map(|t| t.id)
            .collect();
    let snapshot_size = snapshot_ids.len();

    let run_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    AUTO_RUN_JOBS.insert_running(run_id.clone(), cancel_token.clone(), AutoRunExtra)?;
    AUTO_RUN_JOBS.set_status(&app, &run_id, "running", None);

    // Durable ledger row. Best-effort: bookkeeping must never abort the run,
    // but without it a restart mid-wave leaves no trace the wave existed.
    if let Err(e) = repo::start_auto_run(&state.db, &run_id, &project_id, snapshot_size as u32) {
        tracing::warn!(run_id = %run_id, error = %e, "auto-run: failed to record start row");
    }

    // The run's workspace, resolved once: it cannot change mid-run, and the
    // checkpoint at every wave boundary needs it. `None` is a recorded gap, not
    // a refusal to run -- a project without a readable root_path still executes.
    let workspace_root = repo::get_project_by_id(&state.db, &project_id)
        .ok()
        .map(|p| p.root_path)
        .filter(|r| !r.trim().is_empty());

    let app_handle = app.clone();
    let pool = state.db.clone();
    let project_id_for_spawn = project_id.clone();
    let run_id_for_spawn = run_id.clone();
    let cancel_for_spawn = cancel_token.clone();

    let app_handle_for_panic = app_handle.clone();
    let run_id_for_panic = run_id_for_spawn.clone();
    let pool_for_panic = pool.clone();

    spawn_guarded(
        "dev-tools auto-run",
        run_id_for_panic.clone(),
        async move {
            let mut iterations: u32 = 0;
            let mut termination_reason = "exhausted".to_string();

            if snapshot_size == 0 {
                // Nothing to do — emit complete immediately.
            } else {
                // Wave 0: the state the run started from. Without it the
                // earliest reachable point is *after* the first wave, which is
                // exactly the wave most likely to be the one you want undone.
                checkpoints::checkpoint_stage_boundary(
                    &pool,
                    &run_id_for_spawn,
                    "wave-0",
                    workspace_root.as_deref(),
                )
                .await;

                'outer: while iterations < max_iterations {
                    if cancel_for_spawn.is_cancelled() {
                        termination_reason = "cancelled".to_string();
                        break;
                    }

                    let ready = match repo::list_ready_tasks(
                        &pool,
                        &project_id_for_spawn,
                        snapshot_size.max(1),
                    ) {
                        Ok(v) => v
                            .into_iter()
                            .filter(|t| snapshot_ids.contains(&t.id))
                            .collect::<Vec<_>>(),
                        Err(e) => {
                            tracing::warn!(error = %e, "auto-run: list_ready_tasks failed");
                            break;
                        }
                    };

                    if ready.is_empty() {
                        break 'outer;
                    }

                    let mut join_set: tokio::task::JoinSet<String> = tokio::task::JoinSet::new();
                    for task in ready {
                        let app_inner = app_handle.clone();
                        let pool_inner = pool.clone();
                        let run_inner = run_id_for_spawn.clone();
                        let tid = task.id.clone();
                        join_set.spawn(async move {
                            run_one_task_for_auto(app_inner, pool_inner, tid, run_inner).await
                        });
                    }
                    while let Some(_res) = join_set.join_next().await {
                        // Per-task signals are already emitted inside run_one_task_for_auto.
                    }

                    iterations += 1;

                    // Stage boundary: the JoinSet above is drained, so no agent
                    // is mid-write and the tree is quiet. This is the only such
                    // moment in the loop. Best-effort by contract — a failed
                    // checkpoint records a typed gap and the wave continues.
                    checkpoints::checkpoint_stage_boundary(
                        &pool,
                        &run_id_for_spawn,
                        &format!("wave-{iterations}"),
                        workspace_root.as_deref(),
                    )
                    .await;
                }

                if iterations >= max_iterations && !cancel_for_spawn.is_cancelled() {
                    termination_reason = "max_iterations".to_string();
                }
                if cancel_for_spawn.is_cancelled() {
                    termination_reason = "cancelled".to_string();
                }
            }

            // Tally final state by re-reading task statuses for the snapshot set.
            let mut completed = 0u32;
            let mut failed = 0u32;
            let mut skipped = 0u32;
            for tid in &snapshot_ids {
                if let Ok(t) = repo::get_task_by_id(&pool, tid) {
                    match t.status.as_str() {
                        "completed" => completed += 1,
                        "failed" => failed += 1,
                        _ => skipped += 1,
                    }
                }
            }

            let payload = AutoRunCompletePayload {
                run_id: run_id_for_spawn.clone(),
                completed,
                failed,
                skipped,
                iterations,
                snapshot_size: snapshot_size as u32,
                termination_reason: termination_reason.clone(),
            };
            let _ = app_handle.emit(event_name::AUTO_RUN_COMPLETE, &payload);
            let terminal_status = if termination_reason == "cancelled" {
                "cancelled"
            } else {
                "completed"
            };
            if let Err(e) = repo::finish_auto_run(
                &pool,
                &run_id_for_spawn,
                terminal_status,
                completed,
                failed,
                skipped,
                iterations,
                &termination_reason,
            ) {
                tracing::warn!(run_id = %run_id_for_spawn, error = %e, "auto-run: failed to record completion row");
            }
            AUTO_RUN_JOBS.set_status(&app_handle, &run_id_for_spawn, terminal_status, None);
            crate::notifications::send(
                &app_handle,
                "Auto-Run Complete",
                &format!(
                "{completed} completed, {failed} failed, {skipped} skipped — {termination_reason}"
            ),
            );
        },
        move |msg| async move {
            AUTO_RUN_JOBS.set_status(
                &app_handle_for_panic,
                &run_id_for_panic,
                "failed",
                Some(msg),
            );
            // Never leave the durable row `running` — a stuck row is what makes
            // the rehydrated banner claim a wave is still in flight.
            if let Err(e) = repo::set_auto_run_status(&pool_for_panic, &run_id_for_panic, "failed")
            {
                tracing::warn!(run_id = %run_id_for_panic, error = %e, "auto-run: failed to mark panicked run");
            }
        },
    );

    Ok(json!({
        "run_id": run_id,
        "snapshot_size": snapshot_size,
    }))
}

/// What the Run Desk's auto-run banner rehydrates from.
///
/// `live = true` means the in-memory scheduler still owns this run (the
/// tallies are the last durable snapshot, not a live count); `live = false`
/// means this is the most recent finished run. `run_id: None` = the project
/// has never had an auto-run.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AutoRunStatus {
    pub run_id: Option<String>,
    pub project_id: Option<String>,
    /// `running` | `completed` | `cancelled` | `failed`, or `None` when there
    /// is no run to report.
    pub status: Option<String>,
    pub snapshot_size: u32,
    pub completed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub iterations: u32,
    pub termination_reason: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    /// True when the in-memory scheduler still reports this run as running.
    pub live: bool,
}

impl AutoRunStatus {
    fn from_row(row: crate::db::repos::dev_tools::DevAutoRun, live: bool) -> Self {
        Self {
            run_id: Some(row.id),
            project_id: row.project_id,
            status: Some(row.status),
            snapshot_size: row.snapshot_size,
            completed: row.completed,
            failed: row.failed,
            skipped: row.skipped,
            iterations: row.iterations,
            termination_reason: row.termination_reason,
            started_at: row.started_at,
            finished_at: row.finished_at,
            live,
        }
    }

    fn none() -> Self {
        Self {
            run_id: None,
            project_id: None,
            status: None,
            snapshot_size: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            iterations: 0,
            termination_reason: None,
            started_at: None,
            finished_at: None,
            live: false,
        }
    }
}

/// Latest auto-run for a project (or globally when `project_id` is `None`),
/// cross-checked against the live `AUTO_RUN_JOBS` map. The DB row is the
/// source of truth for identity and tallies; the in-memory map only decides
/// whether the run is still in flight, so a row left `running` by a hard kill
/// reports `live: false` rather than a banner that never clears.
#[tauri::command]
pub async fn dev_tools_get_auto_run_status(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<AutoRunStatus, AppError> {
    require_auth(&state).await?;

    let latest = repo::latest_auto_run(&state.db, project_id.as_deref())?;
    Ok(match latest {
        Some(row) => {
            let live = AUTO_RUN_JOBS
                .get_snapshot(&row.id)
                .map(|s| s.status == "running")
                .unwrap_or(false);
            AutoRunStatus::from_row(row, live)
        }
        None => AutoRunStatus::none(),
    })
}

#[tauri::command]
pub async fn dev_tools_cancel_auto_run(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    run_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;

    if let Some(token) = AUTO_RUN_JOBS.get_cancel_token(&run_id)? {
        token.cancel();
        AUTO_RUN_JOBS.set_status(&app, &run_id, "cancelled", None);
        // Mark the durable row immediately: the wave may take a whole task to
        // notice the token, and a restart in that window must not rehydrate a
        // banner for a run the user already stopped. The completion arm
        // overwrites this with the real tallies if it still gets to run.
        if let Err(e) = repo::set_auto_run_status(&state.db, &run_id, "cancelled") {
            tracing::warn!(run_id = %run_id, error = %e, "auto-run: failed to mark cancelled run");
        }
        Ok(true)
    } else {
        Ok(false)
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// A batch of N tasks is N admissions with origin `dev_runner`, headless,
    /// under ONE `dev-runner:<batch>` run label, each named after its task and
    /// carrying its model (and, for a competition-bound task, its worktree)
    /// behind the task marker.
    #[test]
    fn a_batch_of_tasks_becomes_dev_runner_dispatches_under_one_run_label() {
        let batch = "batch-42";
        let titles = ["Fix the retry test", "Rename the door", "Trim the log"];
        let requests: Vec<DispatchRequest> = titles
            .iter()
            .enumerate()
            .map(|(i, t)| {
                dev_runner_request(
                    Path::new("C:/repo/wt"),
                    t,
                    format!("do {i}"),
                    DEFAULT_DEV_TASK_MODEL,
                    (i == 2).then_some("comp-7"),
                    batch,
                )
            })
            .collect();
        assert_eq!(requests.len(), 3);
        for (i, r) in requests.iter().enumerate() {
            assert_eq!(r.origin, DispatchOrigin::DevRunner);
            assert_eq!(r.mode, FleetSessionMode::Headless);
            assert_eq!(r.run_label.as_deref(), Some("dev-runner:batch-42"));
            assert!(personas_engine::unattended::is_dev_runner_run(
                r.run_label.as_deref()
            ));
            assert_eq!(r.name.as_deref(), Some(titles[i]));
            assert_eq!(r.cwd, "C:/repo/wt");
            // The task rides behind the marker; the CLI extras follow it.
            assert_eq!(r.args[0], queue::TASK_ARG);
            assert_eq!(r.args[1], format!("do {i}"));
            assert_eq!(&r.args[2..4], ["--model", DEFAULT_DEV_TASK_MODEL]);
        }
        assert_eq!(&requests[2].args[4..6], ["--worktree", "comp-7"]);
        assert_eq!(
            requests[0].args.len(),
            4,
            "no worktree flag without a binding"
        );
        // The one-shot classification the reap relies on reads the same label.
        assert!(crate::commands::fleet::classify::is_one_shot_worker_label(
            requests[0].run_label.as_deref()
        ));
    }

    // A real throwaway repository and real `git`, the discipline
    // `personas_engine::unattended_worktree::tests` already uses: the claim
    // under test is a claim about what git does to a checkout, and a mock would
    // pin our belief about it rather than the behaviour that cost an operator
    // their working tree.
    //
    // Driven through `app_master_gates::git` — the repository's existing git
    // runner, and the one the code under test uses — rather than a third
    // hand-rolled `Command::new("git")`. That keeps the fixture honest (the
    // test and production agree on what "git said no" means) and keeps the
    // census rule `process-spawn-outside-chokepoint` from growing.
    use personas_engine::app_master_gates::git;

    async fn git_in(cwd: &Path, args: &[&str]) -> Option<String> {
        git(cwd, args).await.ok()
    }

    async fn git_available() -> bool {
        git(Path::new("."), &["--version"]).await.is_ok()
    }

    /// A git repository with one commit on `main`.
    async fn repo_at(dir: &Path) -> Option<()> {
        git_in(dir, &["init", "--initial-branch=main"]).await?;
        git_in(dir, &["config", "user.email", "t@example.com"]).await?;
        git_in(dir, &["config", "user.name", "T"]).await?;
        git_in(dir, &["config", "commit.gpgsign", "false"]).await?;
        std::fs::write(dir.join("README.md"), "hello").ok()?;
        git_in(dir, &["add", "README.md"]).await?;
        git_in(dir, &["commit", "-m", "chore: initial"]).await?;
        Some(())
    }

    /// The production schema, never a hand-built fixture.
    fn seed_task(pool: &crate::db::DbPool, root: &Path) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('p-1', 'Proj', ?1)",
            rusqlite::params![root.to_string_lossy()],
        )?;
        conn.execute(
            "INSERT INTO dev_tasks (id, project_id, title, status)
             VALUES ('t-1', 'p-1', 'Fix the retry test', 'queued')",
            [],
        )?;
        Ok(())
    }

    #[tokio::test]
    async fn a_task_in_a_git_project_authors_in_an_isolated_autopilot_worktree(
    ) -> Result<(), AppError> {
        if !git_available().await {
            return Ok(());
        }
        let project = tempfile::tempdir().unwrap();
        let Some(()) = repo_at(project.path()).await else {
            return Ok(());
        };
        let data = tempfile::tempdir().unwrap();
        let wt_root = data.path().join("worktrees");

        let pool = crate::db::init_test_db()?;
        seed_task(&pool, project.path())?;

        let head_before = git_in(project.path(), &["rev-parse", "HEAD"])
            .await
            .unwrap();
        let status_before = git_in(project.path(), &["status", "--porcelain"])
            .await
            .unwrap();

        let ws = resolve_task_workspace(
            &pool,
            "t-1",
            &project.path().to_string_lossy(),
            Ok(wt_root.clone()),
        )
        .await;

        // 1. It is isolated, on the reconciler's own branch namespace.
        assert_eq!(
            ws.branch.as_deref(),
            Some("autopilot/fix-the-retry-test"),
            "fallback_reason: {:?}",
            ws.fallback_reason
        );
        assert!(ws.fallback_reason.is_none());

        // 2. The exec dir IS that worktree — outside the project, on the branch.
        assert!(ws.exec_dir.is_dir());
        assert!(ws.exec_dir.starts_with(&wt_root));
        assert!(!ws.exec_dir.starts_with(project.path()));
        assert_eq!(
            git_in(&ws.exec_dir, &["rev-parse", "--abbrev-ref", "HEAD"])
                .await
                .unwrap(),
            "autopilot/fix-the-retry-test"
        );

        // 3. The operator's checkout did not move and gained nothing.
        assert_eq!(
            git_in(project.path(), &["rev-parse", "--abbrev-ref", "HEAD"])
                .await
                .unwrap(),
            "main"
        );
        assert_eq!(
            git_in(project.path(), &["rev-parse", "HEAD"])
                .await
                .unwrap(),
            head_before
        );
        assert_eq!(
            git_in(project.path(), &["status", "--porcelain"])
                .await
                .unwrap(),
            status_before
        );

        // 4. The row records where to look for the work — path AND branch, so
        //    a reviewer can find the branch this task authored.
        repo::record_task_worktree(
            &pool,
            "t-1",
            &ws.exec_dir.to_string_lossy(),
            ws.branch.as_deref(),
            ws.fallback_reason.as_deref(),
        )?;
        let row = repo::get_task_by_id(&pool, "t-1")?;
        assert_eq!(
            row.worktree_branch.as_deref(),
            Some("autopilot/fix-the-retry-test")
        );
        assert_eq!(
            row.worktree_path.as_deref(),
            Some(ws.exec_dir.to_string_lossy().as_ref())
        );
        assert!(row.worktree_fallback_reason.is_none());

        // 5. A second resolution of the SAME task reuses it rather than
        //    forking `autopilot/fix-the-retry-test-2` for the same work.
        let again = resolve_task_workspace(
            &pool,
            "t-1",
            &project.path().to_string_lossy(),
            Ok(wt_root.clone()),
        )
        .await;
        assert_eq!(again.exec_dir, ws.exec_dir);
        assert_eq!(again.branch, ws.branch);

        git_in(
            project.path(),
            &[
                "worktree",
                "remove",
                "--force",
                &ws.exec_dir.to_string_lossy(),
            ],
        )
        .await;
        Ok(())
    }

    #[tokio::test]
    async fn a_project_that_is_not_a_repository_falls_back_to_the_root_and_says_so(
    ) -> Result<(), AppError> {
        if !git_available().await {
            return Ok(());
        }
        // A real directory, with no `git init` — the shape a project pointed at
        // a plain folder actually has.
        let plain = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();

        let pool = crate::db::init_test_db()?;
        seed_task(&pool, plain.path())?;

        let ws = resolve_task_workspace(
            &pool,
            "t-1",
            &plain.path().to_string_lossy(),
            Ok(data.path().join("worktrees")),
        )
        .await;

        // It runs — a non-repository project is a legitimate thing to run a
        // task in — but in the root, and never silently.
        assert_eq!(ws.exec_dir, plain.path());
        assert!(ws.branch.is_none());
        let reason = ws.fallback_reason.clone().expect("a reason is mandatory");
        assert!(reason.contains("not a git work tree"), "{reason}");

        // The reason reaches the row, not only the log line.
        repo::record_task_worktree(
            &pool,
            "t-1",
            &ws.exec_dir.to_string_lossy(),
            ws.branch.as_deref(),
            ws.fallback_reason.as_deref(),
        )?;
        let row = repo::get_task_by_id(&pool, "t-1")?;
        assert!(row.worktree_branch.is_none());
        assert_eq!(row.worktree_fallback_reason.as_deref(), Some(&reason[..]));
        Ok(())
    }
}
