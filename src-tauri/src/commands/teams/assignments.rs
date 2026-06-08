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
    CreateTeamAssignmentInput, CreateTeamAssignmentStepInput, CreateTeamAssignmentTemplateInput,
    Persona, ResolveStepReviewAction, TeamAssignment, TeamAssignmentDetail, TeamAssignmentEvent,
    TeamAssignmentStep, TeamAssignmentTemplate,
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

/// Athena post-run reconciliation (Phase 4). When an Athena-dispatched
/// assignment (`companion_op_id` set) reaches a terminal status, record a
/// compact outcome digest onto its OperativeMemory operation so Athena's chat
/// can reason about what the team accomplished. No-op (returns `false`) for
/// team-UI assignments with no operation to reconcile into — those surface via
/// the live checklist + assignment board instead. Sonnet still does the
/// up-front decompose; this is reflection, not orchestration.
#[tauri::command]
pub fn companion_record_assignment_outcome(
    state: State<'_, Arc<AppState>>,
    assignment_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let assignment = repo::get_by_id(&state.db, &assignment_id)?;
    let Some(op_id) = assignment.companion_op_id.clone() else {
        return Ok(false); // not Athena-dispatched — nothing to reconcile
    };
    let steps = repo::list_steps(&state.db, &assignment_id)?;

    let mut lines = vec![format!("Team assignment \"{}\" — {}", assignment.title, assignment.status)];
    lines.push(format!("Goal: {}", assignment.goal));
    for (i, s) in steps.iter().enumerate() {
        lines.push(format!("{}. [{}] {}", i + 1, s.status, s.title));
    }
    let failed = assignment.status == "failed";
    let recorded = crate::companion::orchestration::operative_memory::memory()
        .complete_operation_with_summary(&op_id, lines.join("\n"), failed);
    Ok(recorded)
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

/// C4 soft-pause: stop launching new steps on a running/queued assignment.
/// In-flight steps finish; the mission idles until `resume_team_assignment`.
#[tauri::command]
pub async fn pause_team_assignment(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    orchestrator::pause_assignment(&Arc::new(state.db.clone()), &app, &id)
}

/// Resume a soft-paused assignment — restarts the orchestrator tick loop from
/// the current step states.
#[tauri::command]
pub async fn resume_team_assignment(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let assignment = repo::get_by_id(&state.db, &id)?;
    if assignment.status != "paused" {
        return Err(AppError::Validation(format!(
            "Assignment cannot be resumed from status '{}'",
            assignment.status
        )));
    }
    let pool = Arc::new(state.db.clone());
    let engine = state.engine.clone();
    let embedding_manager = embedding_manager_for_state(&state);
    orchestrator::resume_assignment(pool, app, engine, embedding_manager, id);
    Ok(())
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
pub(crate) fn embedding_manager_for_state(
    state: &State<'_, Arc<AppState>>,
) -> Option<Arc<crate::engine::embedder::EmbeddingManager>> {
    state.embedding_manager.clone()
}

#[cfg(not(feature = "ml"))]
pub(crate) fn embedding_manager_for_state(
    _state: &State<'_, Arc<AppState>>,
) -> Option<Arc<crate::engine::team_assignment_matching::EmbeddingManager>> {
    None
}

/// Assignment statuses where the orchestrator may still be live: queued to
/// start, actively ticking, or paused awaiting review (resumable back into
/// `running`). Deleting in any of these states orphans the in-flight persona
/// execution and makes the next orchestrator tick's `get_by_id` return
/// `NotFound`, crashing the loop. Terminal states (`done`/`failed`/`aborted`)
/// are safe to delete; their step + event rows cascade away via FK.
fn assignment_is_active(status: &str) -> bool {
    matches!(status, "queued" | "running" | "awaiting_review")
}

#[tauri::command]
pub fn delete_team_assignment(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    // Guard against deleting a live assignment — mirrors `delete_team`'s
    // `has_running_pipeline` check. Without it, a delete mid-run silently
    // orphans the underlying LLM execution and can crash the orchestrator.
    match repo::get_by_id(&state.db, &id) {
        Ok(assignment) if assignment_is_active(&assignment.status) => {
            return Err(AppError::Validation(
                "Cannot delete an assignment while it is running. Wait for it to finish, or abort it from the review panel first.".into(),
            ));
        }
        Ok(_) => {}
        // Already gone — treat the delete as an idempotent no-op rather than
        // surfacing a NotFound error to the caller.
        Err(AppError::NotFound(_)) => return Ok(false),
        Err(e) => return Err(e),
    }
    repo::delete(&state.db, &id)
}

/// Goals hub: link or unlink an assignment to a `dev_goals` row.
/// `goalId = null` unlinks. A linked assignment advances the goal: its step
/// transitions write `dev_goal_signals` and feed the goal's progress resolver.
#[tauri::command]
pub fn set_team_assignment_goal(
    state: State<'_, Arc<AppState>>,
    assignment_id: String,
    goal_id: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::set_goal_link(&state.db, &assignment_id, goal_id.as_deref())
}

/// Goals hub: every assignment linked to a given dev goal.
#[tauri::command]
pub fn list_team_assignments_for_goal(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
) -> Result<Vec<TeamAssignment>, AppError> {
    require_auth_sync(&state)?;
    repo::list_for_goal(&state.db, &goal_id)
}

/// Phase C1 — Companion bridge. Athena's dispatcher calls this when the
/// user says "have the X team do Y" in chat. Does end-to-end:
///   1. Resolves eligible candidates from the team roster
///   2. Auto-decomposes the goal via Sonnet
///   3. Creates the TeamAssignment with source='athena' + companion_op_id
///   4. Begins a dispatched OperativeMemory operation tied to the assignment
///   5. Starts the orchestrator
///
/// Returns both ids so the chat layer can attach the assignment to the
/// companion operation in its episodic memory + render progress cards
/// against the right op.
#[tauri::command]
pub async fn companion_assign_team(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    team_id: String,
    goal: String,
    title: Option<String>,
) -> Result<CompanionAssignTeamResult, AppError> {
    require_auth(&state).await?;
    companion_assign_team_inner(&state, app, team_id, goal, title).await
}

/// Shared inner implementation of `companion_assign_team`. Used by both
/// the Tauri command (above) and the Phase C3 approval executor
/// (`execute_assign_team` in commands/companion/approvals.rs). The inner
/// fn intentionally skips the auth check — both callers have already
/// run their own.
pub async fn companion_assign_team_inner(
    state: &State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    team_id: String,
    goal: String,
    title: Option<String>,
) -> Result<CompanionAssignTeamResult, AppError> {
    let goal_trimmed = goal.trim().to_string();
    if goal_trimmed.is_empty() {
        return Err(AppError::Validation("Goal cannot be empty".into()));
    }

    // Resolve candidates first — fail fast if the team can't accept work.
    let members = team_repo::get_members(&state.db, &team_id)?;
    let mut personas: Vec<Persona> = Vec::with_capacity(members.len());
    for m in &members {
        if let Ok(p) = persona_repo::get_by_id(&state.db, &m.persona_id) {
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
            "Team has no eligible personas to receive an assignment".into(),
        ));
    }
    let candidates = matching::extract_candidates(&personas);

    // Decompose via Sonnet.
    let proposed = matching::decompose_goal(&goal_trimmed, &candidates, DECOMPOSE_TIMEOUT_SECS).await?;
    if proposed.is_empty() {
        return Err(AppError::Internal(
            "Auto-decompose returned zero steps".into(),
        ));
    }

    // Open the companion OperativeMemory operation. The chat side will
    // attach session events / cards under this op_id.
    let op_id = crate::companion::orchestration::operative_memory::memory()
        .begin_dispatched_operation(goal_trimmed.clone());

    // Create the assignment in one transaction (via repo::create).
    let title_final = title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| derive_title_from_goal(&goal_trimmed));

    let input = CreateTeamAssignmentInput {
        team_id: team_id.clone(),
        title: title_final,
        goal: goal_trimmed,
        match_strategy: Some("llm_eval".into()),
        max_parallel_steps: Some(3),
        source: Some("athena".into()),
        companion_op_id: Some(op_id.clone()),
        goal_id: None,
        steps: proposed
            .into_iter()
            .map(|p| crate::db::models::CreateTeamAssignmentStepInput {
                title: p.title,
                description: if p.description.trim().is_empty() {
                    None
                } else {
                    Some(p.description)
                },
                assigned_persona_id: p.suggested_persona_id,
                assigned_use_case_id: p.suggested_use_case_id,
                depends_on_indices: None,
            })
            .collect(),
    };
    let assignment = repo::create(&state.db, input)?;

    // Spawn the orchestrator just like start_team_assignment does.
    let pool = Arc::new(state.db.clone());
    let engine = state.engine.clone();
    let embedding_manager = embedding_manager_for_state(state);
    orchestrator::run_assignment(pool, app, engine, embedding_manager, assignment.id.clone());

    Ok(CompanionAssignTeamResult {
        assignment_id: assignment.id,
        companion_op_id: op_id,
    })
}

/// Wire-format payload from `companion_assign_team`. Two ids the chat
/// layer needs in tandem: the assignment for the panel + the operation
/// id for episodic memory + Athena's reconciliation loop.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompanionAssignTeamResult {
    pub assignment_id: String,
    pub companion_op_id: String,
}

/// Generate a short title from a goal text. Trim to ~60 chars and take
/// the first clause; keeps assignment-list rows readable when Athena
/// creates an assignment without an explicit title.
fn derive_title_from_goal(goal: &str) -> String {
    let trimmed = goal.trim();
    let first_clause = trimmed
        .split(|c: char| c == '.' || c == '\n' || c == ';')
        .next()
        .unwrap_or(trimmed)
        .trim();
    if first_clause.len() <= 60 {
        first_clause.to_string()
    } else {
        let truncated: String = first_clause.chars().take(57).collect();
        format!("{truncated}…")
    }
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

/// Advance a team's linked `dev_goal`: build a **goal-linked** assignment (from
/// the goal's open to-dos, else LLM-decomposed) and run it on the orchestrator.
/// This is what flips a goal from "has-goal / NOT-advancing" to actively worked
/// — the orchestrator's terminal hook then checks off the worked to-dos and
/// writes the goal's progress. Returns the new assignment id, or `None` when an
/// assignment already advances this goal (no double-spawn). The Goals UI button
/// and the default-OFF autonomous tick both funnel through the same
/// `engine::goal_advance::advance_goal`.
#[tauri::command]
pub async fn advance_team_goal(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    team_id: String,
    goal_id: String,
) -> Result<Option<String>, AppError> {
    require_auth(&state).await?;
    let embedding_manager = embedding_manager_for_state(&state);
    match crate::engine::goal_advance::advance_goal(
        &state.db,
        &app,
        state.engine.clone(),
        embedding_manager,
        &team_id,
        &goal_id,
    )
    .await?
    {
        crate::engine::goal_advance::AdvanceResult::Started(id) => Ok(Some(id)),
        crate::engine::goal_advance::AdvanceResult::AlreadyAdvancing => Ok(None),
    }
}

// ----------------------------------------------------------------------------
// Templates (Phase C4) — save / list / delete / instantiate
// ----------------------------------------------------------------------------

#[tauri::command]
pub fn create_assignment_template(
    state: State<'_, Arc<AppState>>,
    input: CreateTeamAssignmentTemplateInput,
) -> Result<TeamAssignmentTemplate, AppError> {
    require_auth_sync(&state)?;
    repo::create_template(&state.db, input)
}

#[tauri::command]
pub fn list_assignment_templates(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<Vec<TeamAssignmentTemplate>, AppError> {
    require_auth_sync(&state)?;
    repo::list_templates(&state.db, &team_id)
}

#[tauri::command]
pub fn delete_assignment_template(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_template(&state.db, &id)
}

/// Instantiate a template into a fresh assignment. Clones the saved
/// title/goal/strategy/steps into the regular `create` path. Does NOT
/// auto-start — the caller decides (the frontend offers a "create &
/// start" affordance the same as the composer). Returns the new
/// assignment so the UI can expand it immediately.
#[tauri::command]
pub fn instantiate_assignment_template(
    state: State<'_, Arc<AppState>>,
    template_id: String,
) -> Result<TeamAssignment, AppError> {
    require_auth_sync(&state)?;
    let tpl = repo::get_template(&state.db, &template_id)?;
    let steps: Vec<CreateTeamAssignmentStepInput> = serde_json::from_str(&tpl.steps_json)
        .map_err(|e| AppError::Internal(format!("Template steps are corrupt: {e}")))?;
    if steps.is_empty() {
        return Err(AppError::Validation(
            "Template has no steps to instantiate".into(),
        ));
    }
    let input = CreateTeamAssignmentInput {
        team_id: tpl.team_id,
        title: tpl.title,
        goal: tpl.goal,
        match_strategy: Some(tpl.match_strategy),
        max_parallel_steps: Some(tpl.max_parallel_steps),
        source: Some("team_ui".into()),
        companion_op_id: None,
        goal_id: None,
        steps,
    };
    repo::create(&state.db, input)
}
