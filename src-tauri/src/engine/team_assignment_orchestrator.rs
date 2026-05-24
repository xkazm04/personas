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
use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

use crate::db::models::{Persona, PersonaTrustLevel, TeamAssignmentStep};
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

/// Spawn the orchestrator's tick task for `assignment_id`. The task owns the
/// assignment's lifecycle until it reaches a terminal status. Does NOT block
/// the caller — Tauri commands return immediately and the frontend follows
/// progress via TEAM_ASSIGNMENT_PROGRESS events.
///
/// Idempotency: if the assignment is already terminal or already running
/// (status check), this is a no-op. The DB transition `queued → running`
/// is the gate.
pub fn run_assignment(
    pool: Arc<DbPool>,
    app: AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
    assignment_id: String,
) {
    let deps = OrchestratorDeps {
        pool,
        app,
        engine,
        embedding_manager,
    };
    tokio::spawn(async move {
        if let Err(e) = tick_loop(&deps, &assignment_id).await {
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

/// Resume an assignment from `awaiting_review`. Restarts the tick task.
fn resume_assignment(
    pool: Arc<DbPool>,
    app: AppHandle,
    engine: Arc<ExecutionEngine>,
    embedding_manager: Option<Arc<EmbeddingManager>>,
    assignment_id: String,
) {
    let _ = assignment_repo::update_assignment_status(&pool, &assignment_id, "running", None);
    run_assignment(pool, app, engine, embedding_manager, assignment_id);
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

                let handle = tokio::spawn(async move {
                    let result = run_step(&deps_clone, &strategy, step_clone).await;
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

    let persona = persona_repo::get_by_id(pool, &persona_id)?;
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
    let input_payload = build_step_input(&step, use_case_id.as_deref());
    let tools = tools_repo::get_tools_for_persona(pool, &persona_id).unwrap_or_default();

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
    emit_progress(app, &step.assignment_id, "running", Some(&step.id));

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
                let summary = execution
                    .output_data
                    .as_deref()
                    .map(|s| s.chars().take(2000).collect::<String>());
                assignment_repo::update_step_status(pool, &step.id, "done", None, summary.as_deref())?;
                emit_progress(app, &step.assignment_id, "running", Some(&step.id));
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
    if persona.setup_status != "ready" {
        return Err(format!("setup_status={}", persona.setup_status));
    }
    if matches!(persona.trust_level, PersonaTrustLevel::Revoked) {
        return Err("trust_revoked".into());
    }
    Ok(())
}

fn build_step_input(step: &TeamAssignmentStep, use_case_id: Option<&str>) -> serde_json::Value {
    json!({
        "assignment_id": step.assignment_id,
        "step_id": step.id,
        "use_case_id": use_case_id,
        "step_title": step.title,
        "step_description": step.description,
    })
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
async fn resolve_assignee(
    deps: &OrchestratorDeps,
    strategy: &str,
    step: &TeamAssignmentStep,
) -> Result<(String, Option<String>), AppError> {
    // Pre-bound path — manual matching, or a re-queued step that retains
    // its previous (or just-overridden) persona pick.
    if let Some(pid) = step.assigned_persona_id.as_ref() {
        return Ok((pid.clone(), step.assigned_use_case_id.clone()));
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
