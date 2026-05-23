//! Tauri commands for team assignments (Phase A2).
//!
//! Thin wrappers over `db::repos::orchestration::team_assignments` and
//! `engine::team_assignment_orchestrator`. The commands stay synchronous
//! where possible (DB-only paths) and spawn the orchestrator from the
//! `start_team_assignment` entry point. Notification emission and live
//! event subscription are handled inside the orchestrator + the event
//! registry — commands here are pure I/O.

use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    CreateTeamAssignmentInput, Persona, ResolveStepReviewAction, TeamAssignment,
    TeamAssignmentDetail, TeamAssignmentEvent, TeamAssignmentStep,
};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::orchestration::team_assignments as repo;
use crate::db::repos::resources::teams as team_repo;
use crate::engine::team_assignment_matching::{self as matching, DecomposedStep};
use crate::engine::team_assignment_orchestrator as orchestrator;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

/// Auto-decompose timeout — Sonnet usually returns in 5-20s for a small
/// goal; 120s covers tail latency.
const DECOMPOSE_TIMEOUT_SECS: u64 = 120;

#[tauri::command]
pub fn create_team_assignment(
    state: State<'_, Arc<AppState>>,
    input: CreateTeamAssignmentInput,
) -> Result<TeamAssignment, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn list_team_assignments(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<Vec<TeamAssignment>, AppError> {
    require_auth_sync(&state)?;
    repo::list_for_team(&state.db, &team_id)
}

#[tauri::command]
pub fn get_team_assignment_detail(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<TeamAssignmentDetail, AppError> {
    require_auth_sync(&state)?;
    let assignment = repo::get_by_id(&state.db, &id)?;
    let steps = repo::list_steps(&state.db, &id)?;
    let recent_events = repo::list_events(&state.db, &id, Some(100))?;
    Ok(TeamAssignmentDetail {
        assignment,
        steps,
        recent_events,
    })
}

#[tauri::command]
pub fn list_team_assignment_events(
    state: State<'_, Arc<AppState>>,
    assignment_id: String,
    limit: Option<i64>,
) -> Result<Vec<TeamAssignmentEvent>, AppError> {
    require_auth_sync(&state)?;
    repo::list_events(&state.db, &assignment_id, limit)
}

#[tauri::command]
pub fn list_team_assignment_steps(
    state: State<'_, Arc<AppState>>,
    assignment_id: String,
) -> Result<Vec<TeamAssignmentStep>, AppError> {
    require_auth_sync(&state)?;
    repo::list_steps(&state.db, &assignment_id)
}

#[tauri::command]
pub async fn start_team_assignment(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    // Validate assignment exists + is in a startable state.
    let assignment = repo::get_by_id(&state.db, &id)?;
    if !matches!(
        assignment.status.as_str(),
        "queued" | "awaiting_review" | "running"
    ) {
        return Err(AppError::Validation(format!(
            "Assignment cannot be started from status '{}'",
            assignment.status
        )));
    }

    // Spawn the orchestrator. Idempotent — the tick loop checks status on
    // entry, so multiple starts collapse into a single live task. The
    // request returns immediately; progress flows via TEAM_ASSIGNMENT_PROGRESS.
    let pool = Arc::new(state.db.clone());
    let engine = state.engine.clone();
    let embedding_manager = embedding_manager_for_state(&state);
    orchestrator::run_assignment(pool, app, engine, embedding_manager, id);
    Ok(())
}

#[tauri::command]
pub async fn abort_team_assignment(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    reason: Option<String>,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    orchestrator::resolve_review_abort(Arc::new(state.db.clone()), app, id, reason)
}

#[tauri::command]
pub async fn resolve_team_assignment_review(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    step_id: String,
    action: ResolveStepReviewAction,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let pool = Arc::new(state.db.clone());
    let engine = state.engine.clone();
    let embedding_manager = embedding_manager_for_state(&state);
    match action {
        ResolveStepReviewAction::EditRequirement { description } => {
            orchestrator::resolve_review_edit(pool, app, engine, embedding_manager, step_id, description)
        }
        ResolveStepReviewAction::Reassign {
            persona_id,
            use_case_id,
        } => orchestrator::resolve_review_reassign(
            pool,
            app,
            engine,
            embedding_manager,
            step_id,
            persona_id,
            use_case_id,
        ),
        ResolveStepReviewAction::Skip => {
            orchestrator::resolve_review_skip(pool, app, engine, embedding_manager, step_id)
        }
        ResolveStepReviewAction::Abort => {
            // Resolve assignment_id from step before aborting the parent.
            let step = repo::get_step(&state.db, &step_id)?;
            orchestrator::resolve_review_abort(pool, app, step.assignment_id, None)
        }
    }
}

/// Wire the optional ml-feature EmbeddingManager from AppState into the
/// orchestrator. Lite builds compile a no-op stub type so the signature
/// stays the same; the orchestrator falls back to llm_eval when the
/// option is None.
#[cfg(feature = "ml")]
fn embedding_manager_for_state(
    state: &State<'_, Arc<AppState>>,
) -> Option<Arc<crate::engine::embedder::EmbeddingManager>> {
    state.embedding_manager.clone()
}

#[cfg(not(feature = "ml"))]
fn embedding_manager_for_state(
    _state: &State<'_, Arc<AppState>>,
) -> Option<Arc<crate::engine::team_assignment_matching::EmbeddingManager>> {
    None
}

#[tauri::command]
pub fn delete_team_assignment(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

/// Phase B3 — Auto-decompose a natural-language goal into ordered steps
/// via the existing Claude (subscription) provider. The composer calls
/// this, lets the user edit the proposal, then submits through the
/// regular `create_team_assignment` path.
///
/// One Sonnet call per invocation; no DB writes. Errors surface as a
/// toast on the frontend.
#[tauri::command]
pub async fn decompose_team_assignment_goal(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    goal: String,
) -> Result<Vec<DecomposedStep>, AppError> {
    require_auth(&state).await?;
    let goal = goal.trim();
    if goal.is_empty() {
        return Err(AppError::Validation("Goal cannot be empty".into()));
    }

    let members = team_repo::get_members(&state.db, &team_id)?;
    if members.is_empty() {
        return Err(AppError::Validation(
            "Team has no members — add personas before auto-decomposing".into(),
        ));
    }
    let mut personas: Vec<Persona> = Vec::with_capacity(members.len());
    for m in &members {
        if let Ok(p) = persona_repo::get_by_id(&state.db, &m.persona_id) {
            // Same eligibility filter the orchestrator applies at run time;
            // proposing steps that won't run is wasted Sonnet tokens.
            if p.enabled
                && p.setup_status == "ready"
                && !matches!(p.trust_level, crate::db::models::PersonaTrustLevel::Revoked)
            {
                personas.push(p);
            }
        }
    }
    if personas.is_empty() {
        return Err(AppError::Validation(
            "No eligible personas on team — every member is disabled, needs setup, or has revoked trust".into(),
        ));
    }

    let candidates = matching::extract_candidates(&personas);
    matching::decompose_goal(goal, &candidates, DECOMPOSE_TIMEOUT_SECS).await
}
