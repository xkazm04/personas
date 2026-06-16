//! Team-assignment orchestrator — Phase A.
//!
//! Walks the step DAG of a `TeamAssignment` and drives each step through:
//!   `pending → matching → running → done | failed`
//! plus the terminal `skipped` (cascade-skip on dependent failure) and the
//! soft pause `awaiting_review` (sets on assignment when any step fails).
//!
//! ## Concurrency
//!
//! Each running assignment owns a tokio task spawned by `run_assignment`. The
//! task tick-loops every second: it finds all pending steps whose `depends_on`
//! references are satisfied, then launches up to `max_parallel_steps`
//! concurrent persona executions. Persona-level `max_concurrent` continues
//! to gate per-persona parallelism because each step routes through the same
//! `ExecutionEngine::start_execution` path the pipeline executor uses.
//!
//! ## Manual matching (Phase A)
//!
//! The composer requires `assigned_persona_id` on every step. The orchestrator
//! only validates that the persona is still eligible (enabled + setup_status
//! == "ready" + trust_level != "revoked") at run time. Phase B layers in
//! embedding-cosine + Sonnet llm_eval strategies on top of this same
//! resolve_step_assignee hook.
//!
//! ## Human review
//!
//! When a step fails (or has no eligible persona), the orchestrator transitions
//! the step to `awaiting_review` AND the assignment to `awaiting_review`,
//! emits a `step_failed` event with the error message, and stops ticking that
//! assignment. Sibling assignments on the same team continue. The frontend
//! review modal (Phase A4) calls back through `resolve_review_*` helpers to
//! either edit the requirement, reassign the persona, skip the step (with
//! cascade-skip), or abort the assignment. Each resolution either requeues
//! the step or terminates the assignment, then re-tickles the loop.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

use crate::db::models::{Persona, PersonaTrustLevel, TeamAssignmentStep};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::orchestration::team_assignments as assignment_repo;
use crate::db::repos::resources::teams as team_repo;
use crate::db::repos::resources::tools as tools_repo;
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use crate::engine::team_assignment_matching::{
    self as matching, MatchResult, EMBEDDING_FALLBACK_CONFIDENCE,
};
use crate::engine::ExecutionEngine;
use crate::error::AppError;

#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
#[cfg(not(feature = "ml"))]
use crate::engine::team_assignment_matching::EmbeddingManager;

/// Bundle of dependencies the orchestrator threads down to per-step work.
/// Phase B added the optional embedding manager (only present in builds
/// compiled with the `ml` feature); Phase C will add the companion bridge.
#[derive(Clone)]
pub struct OrchestratorDeps {
    pub pool: Arc<DbPool>,
    pub app: AppHandle,
    pub engine: Arc<ExecutionEngine>,
    pub embedding_manager: Option<Arc<EmbeddingManager>>,
}

/// Per-step LLM match timeout. Sonnet usually returns in 5-15s for a short
/// roster; 90s covers tail latency without blocking the tick loop forever.
const MATCH_LLM_TIMEOUT_SECS: u64 = 90;

// ----------------------------------------------------------------------------
// Tunables
// ----------------------------------------------------------------------------

/// Tick interval — how often the loop re-scans for newly-eligible steps.
const TICK_INTERVAL: Duration = Duration::from_secs(1);

/// Per-step execution poll timeout. Matches pipeline_executor's 600s ceiling
/// for individual node runs.
const STEP_EXECUTION_TIMEOUT_TICKS: u64 = 600;

/// Maximum lifetime of an assignment's outer tick loop. Defensive cap — the
/// loop already exits on terminal status; this protects against pathological
/// no-progress hangs (e.g. a step stuck in 'matching' forever due to a bug).
const ASSIGNMENT_MAX_TICKS: u64 = 7200; // 2 hours

// ----------------------------------------------------------------------------
// Public entry — kick off an assignment
// ----------------------------------------------------------------------------

/// Process-wide set of assignment ids that currently own a live tick task.
/// `run_assignment` is reached from `start_team_assignment` AND from every
/// `resume_assignment` caller (review edit/reassign/skip, auto-resume,
/// orphan-recovery), any of which can fire while a loop is already running.
/// Without a single-flight guard each call `tokio::spawn`s an independent
/// `tick_loop` that re-scans the same step DAG and launches the same pending
/// step again — two persona executions, two PRs, doubled token spend. The
/// per-loop `in_flight` map only dedupes within one loop instance, not across
/// instances. Mirrors the singleton-registry pattern used elsewhere.
fn live_assignments() -> &'static Mutex<HashSet<String>> {
    static LIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    LIVE.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Spawn the orchestrator's tick task for `assignment_id`. The task owns the
/// assignment's lifecycle until it reaches a terminal status. Does NOT block
/// the caller — Tauri commands return immediately and the frontend follows
/// progress via TEAM_ASSIGNMENT_PROGRESS events.
///
/// Idempotency: single-flight on `assignment_id` via `live_assignments()`. If a
/// tick task is already live for this assignment, this is a no-op — a resume
/// that arrives while the loop still runs is absorbed by the running loop
/// (which re-reads status each tick), instead of forking a second loop.
pub fn run_assignment(
    pool: Arc<DbPool>,
    app: AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
    assignment_id: String,
) {
    // Claim the single-flight slot before spawning. `insert` returns false if
    // the id was already present → another tick task owns this assignment.
    {
        let mut live = live_assignments()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !live.insert(assignment_id.clone()) {
            tracing::debug!(
                assignment_id = %assignment_id,
                "run_assignment: tick task already live, skipping duplicate spawn",
            );
            return;
        }
    }

    let deps = OrchestratorDeps {
        pool,
        app,
        engine,
        embedding_manager,
    };
    tokio::spawn(async move {
        let result = tick_loop(&deps, &assignment_id).await;
        // Release the single-flight slot as soon as the loop exits — before the
        // error branch — so a failed/terminated assignment can be resumed and
        // re-acquire the slot.
        live_assignments()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&assignment_id);
        if let Err(e) = result {
            tracing::error!(
                assignment_id = %assignment_id,
                error = %e,
                "Team-assignment orchestrator loop failed",
            );
            let _ = assignment_repo::update_assignment_status(
                &deps.pool,
                &assignment_id,
                "failed",
                Some(&e.to_string()),
            );
            emit_progress(&deps.app, &assignment_id, "failed", None);
        }
    });
}

// ----------------------------------------------------------------------------
// Resolution helpers — called by Tauri commands for review actions
// ----------------------------------------------------------------------------

/// User chose "Edit requirement" in the review modal. Rewrites the step's
/// description, resets it to `pending`, lifts the assignment's pause, and
/// kicks the tick loop again.
pub fn resolve_review_edit(
    pool: Arc<DbPool>,
    app: AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
    step_id: String,
    description: String,
) -> Result<(), AppError> {
    assignment_repo::edit_step_description(&pool, &step_id, &description)?;
    let step = assignment_repo::get_step(&pool, &step_id)?;
    resume_assignment(pool, app, engine, embedding_manager, step.assignment_id);
    Ok(())
}

/// User chose "Reassign" in the review modal.
pub fn resolve_review_reassign(
    pool: Arc<DbPool>,
    app: AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
    step_id: String,
    persona_id: String,
    use_case_id: Option<String>,
) -> Result<(), AppError> {
    assignment_repo::override_step_assignment(&pool, &step_id, &persona_id, use_case_id.as_deref())?;
    let step = assignment_repo::get_step(&pool, &step_id)?;
    resume_assignment(pool, app, engine, embedding_manager, step.assignment_id);
    Ok(())
}

/// User chose "Skip step". Marks the step `skipped`; the next tick will
/// cascade-skip every step whose `depends_on` references this one.
pub fn resolve_review_skip(
    pool: Arc<DbPool>,
    app: AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
    step_id: String,
) -> Result<(), AppError> {
    assignment_repo::update_step_status(&pool, &step_id, "skipped", None, None)?;
    let step = assignment_repo::get_step(&pool, &step_id)?;
    resume_assignment(pool, app, engine, embedding_manager, step.assignment_id);
    Ok(())
}

/// User chose "Abort assignment".
pub fn resolve_review_abort(
    pool: Arc<DbPool>,
    app: AppHandle,
    assignment_id: String,
    reason: Option<String>,
) -> Result<(), AppError> {
    assignment_repo::update_assignment_status(&pool, &assignment_id, "aborted", reason.as_deref())?;
    emit_progress(&app, &assignment_id, "aborted", None);
    Ok(())
}

/// Autonomous, unattended resume of an assignment soft-paused at
/// `awaiting_review` because one or more steps failed for a RETRYABLE reason
/// (Claude session/usage limit or rate limit). The caller
/// (`AssignmentAutoResumeSubscription`) has already classified which failed
/// steps are retryable, under the per-step retry cap, past the backoff, and
/// gated by the persona's `repeat_on_failure` setting — this performs the
/// mechanical reset + resume. For each step: reset `failed` → `pending` (so the
/// tick loop re-runs it instead of immediately re-pausing) and bump its
/// `retry_count`, then resume the assignment's tick task exactly once.
pub fn auto_resume_retryable_steps(
    pool: Arc<DbPool>,
    app: AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
    assignment_id: &str,
    step_ids: &[String],
) -> Result<(), AppError> {
    if step_ids.is_empty() {
        return Ok(());
    }
    for sid in step_ids {
        // error_message/completed_at are preserved (COALESCE) so the failure
        // history + last-failure timestamp survive for the next backoff check.
        assignment_repo::update_step_status(&pool, sid, "pending", None, None)?;
        assignment_repo::increment_step_retry(&pool, sid)?;
    }
    // F1: the failed step's dependents were cascade-skipped at failure time —
    // resuming only the failed step would leave the pipeline tail (review /
    // QA-merge) permanently skipped, so the assignment completes WITHOUT its
    // merge gate (observed: implement retried fine, QA never ran). Restore the
    // skipped subtree too (cascade-skips only — user skips are never touched).
    let roots: HashSet<String> = step_ids.iter().cloned().collect();
    match restore_cascade_skipped_dependents(&pool, assignment_id, &roots) {
        Ok(n) if n > 0 => {
            tracing::info!(assignment_id, restored = n, "auto-resume: restored cascade-skipped dependents");
        }
        Err(e) => {
            tracing::warn!(assignment_id, error = %e, "auto-resume: failed to restore skipped dependents");
        }
        _ => {}
    }
    resume_assignment(pool, app, engine, embedding_manager, assignment_id.to_string());
    Ok(())
}

/// Restore CASCADE-skipped dependents of the given root steps, transitively.
/// Cascade-skips carry the marker error_message "Dependency was skipped or
/// failed" — user-intervention skips don't and are never touched. Returns how
/// many steps went back to `pending`.
fn restore_cascade_skipped_dependents(
    pool: &DbPool,
    assignment_id: &str,
    roots: &HashSet<String>,
) -> Result<usize, AppError> {
    let steps = assignment_repo::list_steps(pool, assignment_id)?;
    let mut restored_ids: HashSet<String> = roots.clone();
    let mut restored = 0usize;
    loop {
        let mut changed = false;
        for s in &steps {
            if restored_ids.contains(&s.id) || s.status != "skipped" {
                continue;
            }
            if s.error_message.as_deref() != Some("Dependency was skipped or failed") {
                continue;
            }
            if parse_depends_on(s.depends_on.as_deref())
                .iter()
                .any(|d| restored_ids.contains(d))
            {
                assignment_repo::update_step_status(pool, &s.id, "pending", None, None)?;
                restored_ids.insert(s.id.clone());
                restored += 1;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    Ok(restored)
}

/// Startup orphan-recovery (V8): re-attach orchestrator tick tasks to
/// assignments that were `running`/`queued` when the app last exited. Their
/// tokio tasks died with the process, leaving `matching`/`running` steps
/// pointing at executions the startup recovery already failed — without
/// re-attachment the assignment wedges forever. The orphaned steps' work never
/// produced a result, so they simply go back to `pending` (with a note), any
/// cascade-skipped dependents are restored, and `run_assignment` is re-spawned
/// (an assignment whose steps are all terminal just gets finalized by its
/// first tick).
pub fn recover_orphaned_assignments(
    pool: Arc<DbPool>,
    app: AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
) {
    let stale = match assignment_repo::list_active(&pool) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "assignment orphan-recovery: query failed");
            return;
        }
    };
    if stale.is_empty() {
        return;
    }
    for a in stale {
        let mut roots: HashSet<String> = HashSet::new();
        if let Ok(steps) = assignment_repo::list_steps(&pool, &a.id) {
            for s in steps
                .iter()
                .filter(|s| matches!(s.status.as_str(), "matching" | "running"))
            {
                if assignment_repo::update_step_status(
                    &pool,
                    &s.id,
                    "pending",
                    Some("App restarted while step was running — re-queued"),
                    None,
                )
                .is_ok()
                {
                    roots.insert(s.id.clone());
                }
            }
        }
        let restored = restore_cascade_skipped_dependents(&pool, &a.id, &roots).unwrap_or(0);
        tracing::info!(
            assignment_id = %a.id,
            title = %a.title,
            requeued_steps = roots.len(),
            restored_skipped = restored,
            "assignment orphan-recovery: re-attaching tick task"
        );
        run_assignment(
            pool.clone(),
            app.clone(),
            engine.clone(),
            embedding_manager.clone(),
            a.id,
        );
    }
}

/// Resume an assignment from `awaiting_review` or `paused`. Restarts the tick
/// task (the tick loop is idempotent — a fresh task picks up from the current
/// step states).
pub fn resume_assignment(
    pool: Arc<DbPool>,
    app: AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
    assignment_id: String,
) {
    let _ = assignment_repo::update_assignment_status(&pool, &assignment_id, "running", None);
    run_assignment(pool, app, engine, embedding_manager, assignment_id);
}

/// C4 soft-pause: request a running/queued assignment stop launching new steps.
/// The live tick loop sees the `paused` status on its next tick and exits;
/// in-flight step tasks are detached and finish on their own. `resume_assignment`
/// restarts it. Errors if the assignment isn't in a pausable state.
pub fn pause_assignment(
    pool: &Arc<DbPool>,
    app: &AppHandle,
    assignment_id: &str,
) -> Result<(), AppError> {
    let assignment = assignment_repo::get_by_id(pool, assignment_id)?;
    if !matches!(assignment.status.as_str(), "running" | "queued") {
        return Err(AppError::Validation(format!(
            "Assignment cannot be paused from status '{}'",
            assignment.status
        )));
    }
    assignment_repo::update_assignment_status(pool, assignment_id, "paused", None)?;
    emit_progress(app, assignment_id, "paused", None);
    Ok(())
}

// ----------------------------------------------------------------------------
// Tick loop — heart of the orchestrator
// ----------------------------------------------------------------------------

async fn tick_loop(
    deps: &OrchestratorDeps,
    assignment_id: &str,
) -> Result<(), AppError> {
    let pool = &deps.pool;
    let app = &deps.app;
    // Transition queued → running on first entry. If already running (resumed),
    // this is a no-op except for emitting the event.
    let assignment = assignment_repo::get_by_id(pool, assignment_id)?;
    if assignment.status == "queued" {
        assignment_repo::update_assignment_status(pool, assignment_id, "running", None)?;
    }
    emit_progress(app, assignment_id, "running", None);

    let mut in_flight: HashMap<String, tokio::task::JoinHandle<()>> = HashMap::new();
    let mut ticks: u64 = 0;

    loop {
        ticks += 1;
        if ticks > ASSIGNMENT_MAX_TICKS {
            return Err(AppError::Internal(format!(
                "Assignment {assignment_id} exceeded max tick budget"
            )));
        }

        // Refresh assignment + steps.
        let assignment = assignment_repo::get_by_id(pool, assignment_id)?;
        if assignment.status == "aborted" {
            return Ok(()); // user abort — exit cleanly
        }
        if assignment.status == "paused" {
            // C4 soft-pause: stop launching new steps and exit the loop. Any
            // in-flight step tasks are detached tokio tasks and finish on their
            // own (writing their results); `resume_assignment` re-spawns the
            // loop, which picks up from the updated step states.
            return Ok(());
        }
        let steps = assignment_repo::list_steps(pool, assignment_id)?;

        // Cascade-skip: every pending step whose depends_on includes a skipped
        // step becomes skipped itself. Idempotent across ticks.
        let skipped_ids: HashSet<String> = steps
            .iter()
            .filter(|s| s.status == "skipped" || s.status == "failed")
            .map(|s| s.id.clone())
            .collect();
        for step in &steps {
            if step.status != "pending" {
                continue;
            }
            let step_deps = parse_depends_on(step.depends_on.as_deref());
            if step_deps.iter().any(|d| skipped_ids.contains(d)) {
                assignment_repo::update_step_status(
                    pool,
                    &step.id,
                    "skipped",
                    Some("Dependency was skipped or failed"),
                    None,
                )?;
            }
        }

        // Reap finished in-flight tasks so the running-count is accurate.
        in_flight.retain(|_, handle| !handle.is_finished());

        // Check terminal: every step done/skipped/failed (and assignment isn't
        // awaiting_review because of a recent fail).
        let steps = assignment_repo::list_steps(pool, assignment_id)?;
        let any_failed = steps.iter().any(|s| s.status == "failed");
        let all_terminal = steps.iter().all(|s| terminal_step_status(&s.status));
        let any_pending_or_running = steps.iter().any(|s| {
            matches!(s.status.as_str(), "pending" | "matching" | "running")
        });

        if any_failed && !any_pending_or_running && in_flight.is_empty() {
            // Stop the loop; user must resolve via review modal.
            assignment_repo::update_assignment_status(
                pool,
                assignment_id,
                "awaiting_review",
                None,
            )?;
            emit_progress(app, assignment_id, "awaiting_review", None);
            record_assignment_goal_signal(
                pool,
                assignment.goal_id.as_deref(),
                assignment_id,
                "team_awaiting_review",
                Some(&assignment.title),
            );
            return Ok(());
        }
        if all_terminal && in_flight.is_empty() {
            let final_status = if steps.iter().any(|s| s.status == "failed") {
                "failed"
            } else {
                "done"
            };
            assignment_repo::update_assignment_status(pool, assignment_id, final_status, None)?;
            emit_progress(app, assignment_id, final_status, None);
            record_assignment_goal_signal(
                pool,
                assignment.goal_id.as_deref(),
                assignment_id,
                if final_status == "failed" {
                    "team_failed"
                } else {
                    "team_done"
                },
                Some(&assignment.title),
            );
            // Close the progress loop: a goal-linked assignment that finished
            // successfully checks off the to-dos it worked (steps built from
            // dev_goal_items carry the to-do's title verbatim) and recomputes +
            // writes the goal's progress — signals alone never move it, so an
            // unattended team would otherwise stay at 0%. Best-effort.
            if final_status == "done" {
                if let Some(gid) = assignment.goal_id.as_deref() {
                    let done_titles: HashSet<&str> = steps
                        .iter()
                        .filter(|s| s.status == "done")
                        .map(|s| s.title.as_str())
                        .collect();
                    if let Ok(items) = crate::db::repos::dev_tools::list_goal_items(pool, gid) {
                        for it in items.iter().filter(|i| !i.done) {
                            if done_titles.contains(it.title.as_str()) {
                                let _ = crate::db::repos::dev_tools::update_goal_item(
                                    pool,
                                    &it.id,
                                    None,
                                    Some(true),
                                );
                            }
                        }
                    }
                    if let Err(e) =
                        crate::db::repos::dev_tools::apply_resolved_goal_progress(pool, gid)
                    {
                        tracing::warn!(goal_id = %gid, error = %e, "auto goal-progress close failed");
                    }
                }
            }
            return Ok(());
        }

        // Find eligible-to-launch steps (deps satisfied + concurrency budget).
        let done_ids: HashSet<String> = steps
            .iter()
            .filter(|s| s.status == "done")
            .map(|s| s.id.clone())
            .collect();
        let running_count = in_flight.len() as i32;
        let budget = (assignment.max_parallel_steps - running_count).max(0);

        if budget > 0 {
            let mut launched = 0i32;
            for step in steps.iter() {
                if launched >= budget {
                    break;
                }
                if step.status != "pending" {
                    continue;
                }
                let step_deps = parse_depends_on(step.depends_on.as_deref());
                if !step_deps.iter().all(|d| done_ids.contains(d)) {
                    continue;
                }

                // Launch this step.
                let deps_clone = deps.clone();
                let step_id = step.id.clone();
                let step_clone = step.clone();
                let strategy = assignment.match_strategy.clone();
                let assignment_id_owned = assignment_id.to_string();
                let goal_id = assignment.goal_id.clone();

                let handle = tokio::spawn(async move {
                    let result = run_step(&deps_clone, &strategy, step_clone, goal_id).await;
                    if let Err(e) = result {
                        tracing::error!(
                            step_id = %step_id,
                            assignment_id = %assignment_id_owned,
                            error = %e,
                            "Step task failed",
                        );
                        let _ = assignment_repo::update_step_status(
                            &deps_clone.pool,
                            &step_id,
                            "failed",
                            Some(&e.to_string()),
                            None,
                        );
                        emit_progress(&deps_clone.app, &assignment_id_owned, "running", Some(&step_id));
                    }
                });
                in_flight.insert(step.id.clone(), handle);
                launched += 1;
            }
        }

        sleep(TICK_INTERVAL).await;
    }
}

// ----------------------------------------------------------------------------
// Per-step execution
// ----------------------------------------------------------------------------

async fn run_step(
    deps: &OrchestratorDeps,
    strategy: &str,
    step: TeamAssignmentStep,
    goal_id: Option<String>,
) -> Result<(), AppError> {
    let pool = &deps.pool;
    let app = &deps.app;
    let engine = &deps.engine;

    assignment_repo::update_step_status(pool, &step.id, "matching", None, None)?;
    emit_progress(app, &step.assignment_id, "running", Some(&step.id));

    // Phase B: resolve (persona, use_case) when the step doesn't already
    // carry an assignment from the composer (manual mode) OR the user
    // re-queued via an Edit-requirement (which clears persona+use_case).
    let (persona_id, use_case_id) = resolve_assignee(deps, strategy, &step).await?;

    let mut persona = persona_repo::get_by_id(pool, &persona_id)?;
    let preflight = check_persona_eligible(&persona);
    if let Err(reason) = preflight {
        assignment_repo::update_step_status(
            pool,
            &step.id,
            "failed",
            Some(&format!("Persona not eligible: {reason}")),
            None,
        )?;
        assignment_repo::insert_event(
            pool,
            &step.assignment_id,
            Some(&step.id),
            "step_unmatched",
            Some(&json!({"reason": reason}).to_string()),
        )?;
        return Ok(());
    }

    // Resolve description into input_data so the persona gets meaningful context.
    // T2 (context flow): `depends_on` gives ORDERING only — without forwarding
    // what the predecessors actually produced, a reviewer/QA step must
    // rediscover the implementer's work from repo state and can pick the wrong
    // PR. Forward each direct predecessor's output_summary (capped).
    let predecessor_outputs = collect_predecessor_outputs(pool, &step);
    // C1 (multi-author channel): channel messages addressed to THIS persona
    // (or the whole team) with consumer='inject' are delivered at STEP
    // BOUNDARIES — each step launch injects the recent ones and records a
    // read-receipt the Collab UI renders. Supersedes Design B's directive-only
    // injection; the same hook now carries user directives + (C2/C3) Athena
    // and Director posts.
    let directives = team_assignment_team_id(pool, &step.assignment_id)
        .and_then(|tid| {
            crate::db::repos::resources::team_channel::list_injectable_for_persona(
                pool,
                &tid,
                &persona_id,
                5,
            )
            .ok()
        })
        .unwrap_or_default();
    let directive_values: Vec<serde_json::Value> = directives
        .iter()
        .map(|d| {
            json!({
                "from": d.author_kind,
                "content": d.body,
                "posted_at": d.created_at,
            })
        })
        .collect();
    let input_payload = build_step_input(
        &step,
        use_case_id.as_deref(),
        &predecessor_outputs,
        &directive_values,
    );
    let tools = tools_repo::get_tools_for_persona(pool, &persona_id).unwrap_or_default();

    // Per-capability model tier (user doctrine: capabilities carry the model
    // decision, not the team). Resolution chain: the step's use case
    // `model_override` (tier slug from the recipe bake or a ModelProfile
    // object from the capability UI) → the persona's own `model_profile` →
    // DEFAULT_CAPABILITY_MODEL (sonnet). This path previously bypassed
    // model resolution entirely (it skips execute_persona_inner), so every
    // team step rode the CLI account default — opus-4-8[1m] live.
    if let Some(uc_id) = use_case_id.as_deref() {
        let uc_override = persona
            .design_context
            .as_deref()
            .and_then(|dc| serde_json::from_str::<serde_json::Value>(dc).ok())
            .and_then(|dc| {
                crate::engine::design_context::pick_use_cases_array(&dc).and_then(|ucs| {
                    ucs.iter()
                        .find(|uc| uc.get("id").and_then(|v| v.as_str()) == Some(uc_id))
                        .and_then(|uc| uc.get("model_override").cloned())
                })
            });
        if let Some(profile) = uc_override
            .as_ref()
            .and_then(crate::engine::prompt::resolve_use_case_model_override)
        {
            if let Ok(json) = serde_json::to_string(&profile) {
                persona.model_profile = Some(json);
            }
        }
    }
    if persona.model_profile.is_none() {
        persona.model_profile = Some(format!(
            "{{\"model\":\"{}\"}}",
            crate::engine::prompt::DEFAULT_CAPABILITY_MODEL
        ));
    }

    let exec = exec_repo::create(
        pool,
        &persona_id,
        None,
        Some(input_payload.to_string()),
        None,
        use_case_id.clone(),
    )?;

    assignment_repo::set_step_execution(pool, &step.id, &exec.id)?;
    assignment_repo::update_step_status(pool, &step.id, "running", None, None)?;
    for d in &directives {
        let _ = crate::db::repos::resources::team_channel::record_delivery(
            pool, &d.id, &step.id, &persona_id,
        );
    }
    emit_progress(app, &step.assignment_id, "running", Some(&step.id));
    // First sign of work on a goal-linked assignment: flip the goal
    // open→in-progress so it reflects activity before any step finishes.
    if let Some(gid) = goal_id.as_deref() {
        let _ = crate::db::repos::dev_tools::mark_goal_in_progress(pool, gid);
    }

    engine
        .start_execution(
            app.clone(),
            (**pool).clone(),
            exec.id.clone(),
            persona,
            tools,
            Some(input_payload),
            None,
        )
        .await
        .map_err(|e| AppError::Internal(format!("start_execution failed: {e}")))?;

    // Poll the execution until terminal.
    for _ in 0..STEP_EXECUTION_TIMEOUT_TICKS {
        sleep(TICK_INTERVAL).await;
        let execution = exec_repo::get_by_id(pool, &exec.id)?;
        match execution.status.as_str() {
            "completed" => {
                // Tail, not head: the execution's verdict / business outcome
                // lands at the END of the output stream — the head is the
                // narrative opening ("I'll start by orienting…"), which made
                // forwarded predecessor context and the goal drawer's step
                // output near-useless.
                let summary = execution.output_data.as_deref().map(|s| {
                    let chars: Vec<char> = s.chars().collect();
                    let start = chars.len().saturating_sub(2000);
                    chars[start..].iter().collect::<String>()
                });

                // V1/V2 (QA fix loop): a "completed" QA execution that emitted
                // `qa.pr.changes_requested` is NOT a done step — it's a bounce.
                // Re-queue the implementer + QA for another round (capped),
                // so the assignment can only complete on a clean QA pass and
                // a goal never counts "done" with its PR stranded open.
                if step_emitted_changes_requested(pool, &persona_id, &execution.created_at) {
                    if step.retry_count < MAX_QA_FIX_ROUNDS {
                        if trigger_qa_rework(pool, &step, summary.as_deref()).is_ok() {
                            emit_progress(app, &step.assignment_id, "running", Some(&step.id));
                            return Ok(());
                        }
                        // fall through to plain done when rework wasn't possible
                    } else {
                        let msg = format!(
                            "QA requested changes {} times — fix-loop cap reached; human review required",
                            step.retry_count
                        );
                        // W7: the costliest bounce (the one that reaches a
                        // human) must also teach the team — previously only
                        // rework rounds wrote the lesson.
                        record_bounce_lesson(pool, &step, summary.as_deref(), step.retry_count, true);
                        assignment_repo::update_step_status(
                            pool,
                            &step.id,
                            "failed",
                            Some(&msg),
                            summary.as_deref(),
                        )?;
                        emit_progress(app, &step.assignment_id, "running", Some(&step.id));
                        return Ok(());
                    }
                }

                assignment_repo::update_step_status(pool, &step.id, "done", None, summary.as_deref())?;
                emit_progress(app, &step.assignment_id, "running", Some(&step.id));
                // C1 (multi-author channel): gated roles (Implementer/QA/
                // Architect) may broadcast ONE short message to the team channel
                // from their output. Best-effort; scans the full output, not the
                // tail summary.
                maybe_post_channel_message(
                    pool,
                    &step,
                    &persona_id,
                    execution.output_data.as_deref(),
                );
                // Activity feed gets the agent's readable outcome sentence,
                // not the raw protocol-JSON tail (which rendered as garbage).
                let signal_text = summary
                    .as_deref()
                    .and_then(extract_readable_outcome)
                    .unwrap_or_else(|| step.title.clone());
                record_assignment_goal_signal(
                    pool,
                    goal_id.as_deref(),
                    &step.assignment_id,
                    "team_step",
                    Some(&signal_text),
                );
                // T4 (live progress): a goal-linked step that finishes checks
                // its matching to-do off NOW and recomputes the goal's progress
                // incrementally — Board/Portfolio no longer sit at 0% until the
                // whole assignment completes. Same title-match + resolver the
                // assignment-done close-loop uses; manual overrides still win
                // (the resolver never silently regresses). Best-effort.
                if let Some(gid) = goal_id.as_deref() {
                    if let Ok(items) = crate::db::repos::dev_tools::list_goal_items(pool, gid) {
                        if let Some(it) =
                            items.iter().find(|i| !i.done && i.title == step.title)
                        {
                            let _ = crate::db::repos::dev_tools::update_goal_item(
                                pool,
                                &it.id,
                                None,
                                Some(true),
                            );
                        }
                    }
                    if let Err(e) =
                        crate::db::repos::dev_tools::apply_resolved_goal_progress(pool, gid)
                    {
                        tracing::debug!(goal_id = %gid, error = %e, "per-step goal-progress update failed");
                    }
                }
                return Ok(());
            }
            "failed" | "cancelled" => {
                let err = execution
                    .error_message
                    .unwrap_or_else(|| "Execution failed".into());
                assignment_repo::update_step_status(pool, &step.id, "failed", Some(&err), None)?;
                return Ok(());
            }
            _ => {}
        }
    }

    // Timed out.
    assignment_repo::update_step_status(
        pool,
        &step.id,
        "failed",
        Some("Step execution timed out"),
        None,
    )?;
    Ok(())
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

fn terminal_step_status(s: &str) -> bool {
    matches!(s, "done" | "skipped" | "failed")
}

fn parse_depends_on(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
}

fn check_persona_eligible(persona: &Persona) -> Result<(), String> {
    if !persona.enabled {
        return Err("disabled".into());
    }
    // `needs_credentials` is ADVISORY, not a hard block: the runtime resolves a
    // credential by service-type at execution (G3 proved Dev Clone opens real PRs
    // despite the badge). Rejecting it here failed every assignment-driven Dev
    // Clone / QA / Release step pre-flight (cascade-skipping the rest) — mirror of
    // the goal_advance candidate filter. Treat ready + needs_credentials as usable.
    if !matches!(persona.setup_status.as_str(), "ready" | "needs_credentials") {
        return Err(format!("setup_status={}", persona.setup_status));
    }
    if matches!(persona.trust_level, PersonaTrustLevel::Revoked) {
        return Err("trust_revoked".into());
    }
    Ok(())
}

/// Max chars of a single predecessor output forwarded into a step's input.
/// Summaries are typically 0.5–2KB; the cap keeps a long chain from bloating
/// the prompt while preserving PR URLs/branches and the gist of the work.
const PREDECESSOR_OUTPUT_MAX_CHARS: usize = 1500;

/// V1/V2 (QA fix loop): how many `qa.pr.changes_requested` rounds a step pair
/// gets before the loop escalates to a human. Round counting lives on the QA
/// step's `retry_count`.
const MAX_QA_FIX_ROUNDS: i32 = 2;

/// Marker prefix written into a step's `error_message` when it is reset for
/// rework; `build_step_input` forwards anything carrying it as
/// `rework_feedback` so the re-run acts on the QA verdict instead of starting
/// blind.
const REWORK_MARKER: &str = "REWORK — QA requested changes: ";

/// V1/V2: did this step's execution emit `qa.pr.changes_requested` during its
/// run window? `persona_events.source_id` stores the EMITTING persona, so the
/// window is bounded by the execution's `created_at` (per-run precise — a
/// step's `started_at` survives resets and would leak prior rounds' events).
fn step_emitted_changes_requested(pool: &DbPool, persona_id: &str, exec_created_at: &str) -> bool {
    event_repo::count_by_type_and_source_since(
        pool,
        "qa.pr.changes_requested",
        persona_id,
        exec_created_at,
    )
    .map(|n| n > 0)
    .unwrap_or(false)
}

/// V1 (the fix loop): a QA step bounced the PR. Reset the work for another
/// round instead of letting "done" swallow the verdict:
/// - every DIRECT `depends_on` predecessor that already ran goes back to
///   `pending`, carrying the QA verdict as a `REWORK` marker (forwarded into
///   its re-run input as `rework_feedback`);
/// - the QA step itself goes back to `pending` too — the DAG's ordering
///   re-runs implementer first, QA after, automatically;
/// - the QA step's `retry_count` counts the rounds (capped by the caller).
///
/// Before this, all 13 `qa.pr.changes_requested` events across the campaign
/// produced ZERO re-works (nothing subscribes to the event and feedback edges
/// are never handoff-wired) — every bounced PR stranded open while the goal
/// was still marked done.
fn trigger_qa_rework(
    pool: &DbPool,
    qa_step: &TeamAssignmentStep,
    qa_summary: Option<&str>,
) -> Result<(), AppError> {
    let dep_ids = parse_depends_on(qa_step.depends_on.as_deref());
    let steps = assignment_repo::list_steps(pool, &qa_step.assignment_id)?;

    let verdict: String = qa_summary
        .unwrap_or("(no QA summary captured)")
        .chars()
        .take(1200)
        .collect();
    let rework_msg = format!("{REWORK_MARKER}{verdict}");

    let mut reset = 0usize;
    for pred in steps
        .iter()
        .filter(|s| dep_ids.iter().any(|d| d == &s.id) && s.status == "done")
    {
        assignment_repo::update_step_status(pool, &pred.id, "pending", Some(&rework_msg), None)?;
        reset += 1;
    }
    // No predecessor to redo (shouldn't happen in a chained pipeline) — leave
    // the step done rather than wedging the assignment on an unrunnable loop.
    if reset == 0 {
        tracing::warn!(
            step_id = %qa_step.id,
            assignment_id = %qa_step.assignment_id,
            "qa rework: changes_requested but no done predecessor to reset — leaving step done"
        );
        return Err(AppError::Internal("no predecessor to rework".into()));
    }

    // Re-queue the QA step itself (keeps its verdict as output_summary) and
    // count the round on its retry counter.
    assignment_repo::update_step_status(pool, &qa_step.id, "pending", None, qa_summary)?;
    assignment_repo::increment_step_retry(pool, &qa_step.id)?;

    // T6/W7 (learning loop): every bounce is a durable lesson.
    record_bounce_lesson(pool, qa_step, Some(&verdict), qa_step.retry_count + 1, false);
    assignment_repo::insert_event(
        pool,
        &qa_step.assignment_id,
        Some(&qa_step.id),
        "qa_changes_requested_rework",
        Some(
            &json!({
                "round": qa_step.retry_count + 1,
                "predecessors_reset": reset,
            })
            .to_string(),
        ),
    )?;
    tracing::info!(
        step_id = %qa_step.id,
        assignment_id = %qa_step.assignment_id,
        round = qa_step.retry_count + 1,
        predecessors_reset = reset,
        "qa rework: changes_requested — reset implementer + QA step for another round"
    );
    Ok(())
}

/// Load the outputs of the steps this step `depends_on` (direct predecessors
/// only), in step order, for forwarding into the step input. Best-effort: a
/// repo error or a predecessor without an output simply contributes nothing.
fn collect_predecessor_outputs(
    pool: &DbPool,
    step: &TeamAssignmentStep,
) -> Vec<serde_json::Value> {
    let dep_ids = parse_depends_on(step.depends_on.as_deref());
    if dep_ids.is_empty() {
        return Vec::new();
    }
    let steps = match assignment_repo::list_steps(pool, &step.assignment_id) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    steps
        .into_iter()
        .filter(|s| dep_ids.iter().any(|d| d == &s.id))
        .filter_map(|s| {
            let summary = s
                .output_summary
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())?
                .to_string();
            let total_chars = summary.chars().count();
            let mut forwarded: String =
                summary.chars().take(PREDECESSOR_OUTPUT_MAX_CHARS).collect();
            if total_chars > PREDECESSOR_OUTPUT_MAX_CHARS {
                forwarded.push_str(" …[truncated]");
            }
            Some(json!({
                "step_title": s.title,
                "status": s.status,
                "output_summary": forwarded,
            }))
        })
        .collect()
}

/// T6/W7: write a QA bounce to the shared team ledger as a directive
/// `constraint` lesson. Fires on EVERY bounce — rework rounds AND the cap-out
/// (the cap path previously skipped it, so the costliest failures taught the
/// team nothing and Dev Clone repeated the same blocker across increments —
/// observed: the identical NODE_ENV tsc error bounced three different PRs).
/// The content leads with a do-not-repeat directive and carries QA's verdict
/// tail (which includes the exact fix); importance 8 (9 when capped) keeps it
/// inside the top-N prompt injection every member reads.
fn record_bounce_lesson(
    pool: &DbPool,
    qa_step: &TeamAssignmentStep,
    qa_summary: Option<&str>,
    round: i32,
    capped: bool,
) {
    let Ok(assignment) = assignment_repo::get_by_id(pool, &qa_step.assignment_id) else {
        return;
    };
    let lesson: String = qa_summary
        .unwrap_or("(no QA summary captured)")
        .chars()
        .take(900)
        .collect();
    let title = if capped {
        format!("QA bounce CAP — human gate reached: {}", assignment.title)
    } else {
        format!("QA bounce (round {round}): {}", assignment.title)
    };
    let tm = crate::db::models::CreateTeamMemoryInput {
        team_id: assignment.team_id.clone(),
        run_id: None,
        member_id: None,
        persona_id: qa_step.assigned_persona_id.clone(),
        title,
        content: format!(
            "RECURRING-RISK CONSTRAINT — do NOT repeat this failure in ANY future increment. \
             QA bounced this increment's PR{}. The verdict below names the blocker and the \
             exact fix; apply the fix pattern proactively before opening future PRs. \
             Verdict: {lesson}",
            if capped {
                " twice and the fix loop CAPPED OUT to a human"
            } else {
                ""
            },
        ),
        category: Some("constraint".to_string()),
        importance: Some(if capped { 9 } else { 8 }),
        tags: Some(if capped {
            "qa,changes_requested,capped".to_string()
        } else {
            "qa,changes_requested".to_string()
        }),
    };
    if let Err(e) = crate::db::repos::resources::team_memories::create(pool, tm) {
        tracing::warn!(step_id = %qa_step.id, error = %e, "bounce lesson: failed to write to team ledger");
    }
}

/// Team id for an assignment (Design B directive delivery).
fn team_assignment_team_id(pool: &Arc<DbPool>, assignment_id: &str) -> Option<String> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT team_id FROM team_assignments WHERE id = ?1",
        rusqlite::params![assignment_id],
        |r| r.get(0),
    )
    .ok()
}

/// A persona's role within a team (`persona_team_members.role`).
fn persona_team_role(pool: &Arc<DbPool>, team_id: &str, persona_id: &str) -> Option<String> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT role FROM persona_team_members WHERE team_id = ?1 AND persona_id = ?2",
        rusqlite::params![team_id, persona_id],
        |r| r.get(0),
    )
    .ok()
}

/// C1 first wave: only these roles may post to the channel (the ones whose
/// acknowledgments / questions carry the most coordination signal). Decided
/// in docs/architecture/team-channel-orchestration.md §8.
const CHANNEL_POST_ROLES: &[&str] = &["engineer", "qa", "architect"];
const CHANNEL_POST_MAX_CHARS: usize = 400;

/// Parse the persona `channel_post` protocol from a step's output and, if the
/// persona's role is gated-in, post ONE message to the team channel.
///
/// Protocol (robust to prose output — a line prefix, not JSON-from-prose):
/// the agent may emit a single line `CHANNEL_POST: <text>` to broadcast a
/// short status / question / acknowledgment to the team channel. The FIRST
/// such line wins (1-per-step cap). Posts land as `author_kind='persona'`,
/// `consumer='display'` — visible in Collab but NOT injected into other
/// personas' steps, so persona traffic can't feed a persona→persona prompt
/// loop (the G4 governance lesson). Best-effort; silently no-ops for
/// non-gated roles or when no marker is present.
fn maybe_post_channel_message(
    pool: &Arc<DbPool>,
    step: &TeamAssignmentStep,
    persona_id: &str,
    output: Option<&str>,
) {
    let Some(output) = output else {
        return;
    };
    let Some(team_id) = team_assignment_team_id(pool, &step.assignment_id) else {
        return;
    };
    let role = persona_team_role(pool, &team_id, persona_id).unwrap_or_default();
    if !CHANNEL_POST_ROLES.contains(&role.as_str()) {
        return;
    }
    let body = output.lines().find_map(|line| {
        let t = line.trim();
        let rest = t
            .strip_prefix("CHANNEL_POST:")
            .or_else(|| t.strip_prefix("CHANNEL POST:"))?
            .trim();
        if rest.is_empty() {
            None
        } else {
            Some(rest.to_string())
        }
    });
    let Some(mut body) = body else {
        return;
    };
    if body.chars().count() > CHANNEL_POST_MAX_CHARS {
        body = body.chars().take(CHANNEL_POST_MAX_CHARS).collect::<String>() + "…";
    }
    let _ = crate::db::repos::resources::team_channel::create(
        pool,
        crate::db::models::CreateChannelMessageInput {
            team_id,
            author_kind: "persona".into(),
            author_id: Some(persona_id.to_string()),
            body,
            addressed_to: None,
            reply_to: None,
            assignment_id: Some(step.assignment_id.clone()),
            consumer: Some("display".into()),
        },
    );
}

fn build_step_input(
    step: &TeamAssignmentStep,
    use_case_id: Option<&str>,
    predecessor_outputs: &[serde_json::Value],
    user_directives: &[serde_json::Value],
) -> serde_json::Value {
    let mut input = json!({
        "assignment_id": step.assignment_id,
        "step_id": step.id,
        "use_case_id": use_case_id,
        "step_title": step.title,
        "step_description": step.description,
    });
    // What the steps this one depends_on produced — the reviewer/QA/docs step
    // acts on THIS work (PR URL, branch, what was done), not a fresh discovery.
    if !predecessor_outputs.is_empty() {
        input["predecessor_outputs"] = serde_json::Value::Array(predecessor_outputs.to_vec());
    }
    // Design B: the user's channel directives — binding guidance for this step.
    if !user_directives.is_empty() {
        input["user_directives"] = serde_json::Value::Array(user_directives.to_vec());
    }
    // V1 (QA fix loop): a step reset for rework carries the QA verdict in its
    // error_message — surface it so the re-run FIXES the bounced PR (push to
    // the same branch) instead of starting a fresh implementation.
    if let Some(feedback) = step
        .error_message
        .as_deref()
        .filter(|m| m.starts_with(REWORK_MARKER))
    {
        input["rework_feedback"] = serde_json::Value::String(feedback.to_string());
        input["rework_instruction"] = serde_json::Value::String(
            "A previous round of this step opened a PR that QA bounced (changes requested). \
             Address the QA feedback above by FIXING the existing PR branch (push amendments \
             to the same branch / PR) — do NOT open a new PR or re-implement from scratch."
                .into(),
        );
    }
    input
}

// ----------------------------------------------------------------------------
// Phase B — assignee resolution
// ----------------------------------------------------------------------------

/// Resolve the (persona_id, use_case_id) for a step. Used by `run_step`.
///
/// Routing:
/// - If the step already carries `assigned_persona_id` (manual mode, or
///   the user just reassigned via the review modal), that wins — we still
///   honour the user's explicit choice over any embedding/LLM score.
/// - Otherwise the assignment's `match_strategy` decides. `embedding`
///   needs the ml-feature embedder; without it, falls back to `llm_eval`.
///   `llm_eval` is always available (subscription path).
/// - On success, persists the match to the step (assigned_persona_id +
///   use_case_id + match_confidence + match_rationale + step_matched event).
/// Resolve a pre-bound persona's capability when the step left it unscoped.
/// Returns the persona's sole enabled use-case id, or — for a multi-capability
/// persona on an implement-shaped step — the implementation capability. `None`
/// when the persona has no enabled capabilities or the choice is ambiguous
/// (multiple capabilities, not implement-shaped) — the caller leaves it NULL
/// and the runner's sonnet floor still applies.
fn scope_sole_or_impl_use_case(persona: &Persona, step_title: &str) -> Option<String> {
    let dc: serde_json::Value =
        serde_json::from_str(persona.design_context.as_deref().unwrap_or("")).ok()?;
    let ucs = crate::engine::design_context::pick_use_cases_array(&dc)?;
    let enabled: Vec<&serde_json::Value> = ucs
        .iter()
        .filter(|uc| uc.get("enabled").and_then(|v| v.as_bool()) != Some(false))
        .collect();
    let id_of = |uc: &serde_json::Value| uc.get("id").and_then(|v| v.as_str()).map(String::from);
    match enabled.len() {
        0 => None,
        1 => id_of(enabled[0]),
        _ => {
            // Ambiguous — only resolve the common implement case deterministically.
            if step_title.to_ascii_lowercase().contains("implement") {
                enabled
                    .iter()
                    .find(|uc| {
                        let id = uc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let cat = uc.get("category").and_then(|v| v.as_str()).unwrap_or("");
                        id.contains("impl") || cat.eq_ignore_ascii_case("implementation")
                    })
                    .and_then(|uc| id_of(uc))
            } else {
                None
            }
        }
    }
}

async fn resolve_assignee(
    deps: &OrchestratorDeps,
    strategy: &str,
    step: &TeamAssignmentStep,
) -> Result<(String, Option<String>), AppError> {
    // Pre-bound path — manual matching, or a re-queued step that retains
    // its previous (or just-overridden) persona pick.
    if let Some(pid) = step.assigned_persona_id.as_ref() {
        // If the capability is already bound, use it verbatim.
        if step.assigned_use_case_id.is_some() {
            return Ok((pid.clone(), step.assigned_use_case_id.clone()));
        }
        // Persona pinned but capability unscoped — the decompose path leaves
        // `use_case` None when the LLM suggests a persona only, and the
        // implement-step pin clears it deliberately. That dropped per-capability
        // ATTRIBUTION and (post-tiering) per-capability MODEL SELECTION for
        // every such step (use_case_id NULL → the runner can't resolve the
        // capability's model_override, so it floors to sonnet even for an
        // opus-tiered capability). Recover the capability deterministically:
        // a persona with exactly ONE enabled capability IS the answer; for a
        // multi-capability engineer, scope an implement-shaped step to its
        // implementation capability. No LLM, no extra latency.
        let resolved_uc = persona_repo::get_by_id(&deps.pool, pid)
            .ok()
            .and_then(|p| scope_sole_or_impl_use_case(&p, &step.title));
        if let Some(ref uc) = resolved_uc {
            let _ = assignment_repo::set_step_match_result(
                &deps.pool,
                &step.id,
                pid,
                Some(uc),
                None,
                Some("scoped pre-bound persona to its capability"),
            );
        }
        return Ok((pid.clone(), resolved_uc));
    }

    // Auto-match needs the team's roster. Fetch members + personas + filter
    // for eligibility (enabled + setup_ready + non-revoked) before handing
    // to the matching module.
    let assignment = assignment_repo::get_by_id(&deps.pool, &step.assignment_id)?;
    let members = team_repo::get_members(&deps.pool, &assignment.team_id)?;
    let mut personas: Vec<Persona> = Vec::with_capacity(members.len());
    for m in &members {
        if let Ok(p) = persona_repo::get_by_id(&deps.pool, &m.persona_id) {
            if check_persona_eligible(&p).is_ok() {
                personas.push(p);
            }
        }
    }
    if personas.is_empty() {
        return Err(AppError::Validation(
            "No eligible personas on team for auto-matching".into(),
        ));
    }

    let candidates = matching::extract_candidates(&personas);
    if candidates.is_empty() {
        return Err(AppError::Validation(
            "No matchable capabilities on team — every persona has zero enabled use cases and no description".into(),
        ));
    }

    let step_text = step
        .description
        .clone()
        .unwrap_or_else(|| step.title.clone());

    let result = match strategy {
        "embedding" => match deps.embedding_manager.as_ref() {
            Some(embedder) => {
                let primary = matching::match_via_embedding(embedder, &step_text, &candidates).await;
                // Auto-fallback to llm_eval if embedding's confidence is too
                // low AND there's more than one candidate (otherwise the
                // single candidate IS the answer regardless of confidence).
                match primary {
                    Ok(r) if r.confidence.unwrap_or(0.0) < EMBEDDING_FALLBACK_CONFIDENCE
                        && candidates.len() > 1 =>
                    {
                        tracing::info!(
                            step_id = %step.id,
                            confidence = ?r.confidence,
                            "Embedding match below fallback threshold — escalating to llm_eval",
                        );
                        matching::match_via_llm_eval(
                            &step.title,
                            &step_text,
                            &candidates,
                            MATCH_LLM_TIMEOUT_SECS,
                        )
                        .await
                    }
                    other => other,
                }
            }
            None => {
                // No embedder compiled (lite build) — silently degrade to
                // llm_eval. Phase B2 wires this path; for B1 it still
                // returns a meaningful error if llm_eval also fails.
                tracing::info!(
                    step_id = %step.id,
                    "Embedding strategy unavailable (ml feature off) — falling back to llm_eval",
                );
                matching::match_via_llm_eval(
                    &step.title,
                    &step_text,
                    &candidates,
                    MATCH_LLM_TIMEOUT_SECS,
                )
                .await
            }
        },
        "llm_eval" => {
            matching::match_via_llm_eval(
                &step.title,
                &step_text,
                &candidates,
                MATCH_LLM_TIMEOUT_SECS,
            )
            .await
        }
        // "manual" or unknown — the manual path was taken above when
        // assigned_persona_id was set; reaching here means manual mode
        // with a missing persona (composer bug). Surface as validation.
        _ => Err(AppError::Validation(format!(
            "Step has no assigned persona and assignment.match_strategy='{strategy}' cannot resolve one",
        ))),
    }?;

    // Persist the match.
    let MatchResult {
        persona_id,
        use_case_id,
        confidence,
        rationale,
    } = result;
    assignment_repo::set_step_match_result(
        &deps.pool,
        &step.id,
        &persona_id,
        use_case_id.as_deref(),
        confidence,
        rationale.as_deref(),
    )?;
    Ok((persona_id, use_case_id))
}

fn emit_progress(app: &AppHandle, assignment_id: &str, status: &str, step_id: Option<&str>) {
    let payload = json!({
        "assignment_id": assignment_id,
        "status": status,
        "step_id": step_id,
    });
    let _ = app.emit(event_name::TEAM_ASSIGNMENT_PROGRESS, payload);
}

/// Goals hub: when a linked assignment (its `goal_id` is set) makes progress,
/// write a `dev_goal_signal` so the goal surfaces live team activity and the
/// progress resolver can derive a suggestion. No-op for unlinked assignments;
/// best-effort (a signal-write failure must never stall orchestration).
/// Extract the human-readable outcome sentence from an execution-output tail.
/// The tail is agent-protocol JSON; the goal Activity feed previously rendered
/// it raw (truncated-JSON garbage). Preference: `outcome_assessment.summary`
/// (the agent's own one-paragraph wrap) → `task_completed`'s `action` line.
/// Tolerant of truncated fragments — scans for the key + quoted string instead
/// of parsing whole JSON.
fn extract_readable_outcome(raw: &str) -> Option<String> {
    fn grab(raw: &str, key: &str) -> Option<String> {
        let kpos = raw.rfind(&format!("\"{key}\""))?;
        let after = &raw[kpos + key.len() + 2..];
        let colon = after.find(':')?;
        let after = after[colon + 1..].trim_start();
        let mut out = String::new();
        let mut chars = after.strip_prefix('"')?.chars();
        while let Some(c) = chars.next() {
            match c {
                '\\' => match chars.next() {
                    Some('n') => out.push(' '),
                    Some(other) => out.push(other),
                    None => break,
                },
                '"' => break,
                _ => out.push(c),
            }
        }
        let cleaned = out.split_whitespace().collect::<Vec<_>>().join(" ");
        (cleaned.len() > 8).then_some(cleaned)
    }
    grab(raw, "summary").or_else(|| grab(raw, "action"))
}

fn record_assignment_goal_signal(
    pool: &DbPool,
    goal_id: Option<&str>,
    assignment_id: &str,
    signal_type: &str,
    message: Option<&str>,
) {
    let Some(goal_id) = goal_id else { return };
    if let Err(e) = crate::db::repos::dev_tools::create_goal_signal(
        pool,
        goal_id,
        signal_type,
        Some(assignment_id),
        None,
        message,
    ) {
        tracing::warn!(
            goal_id,
            assignment_id,
            error = %e,
            "Failed to record team→goal signal",
        );
    }
}
