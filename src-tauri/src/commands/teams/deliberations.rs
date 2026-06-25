//! Design D — deliberation commands (D4). The user-facing entry points: open a
//! deliberation, read deliberations + their agenda, and the decision gate
//! (approve / dismiss a resolved proposal — always gated, decision 8). Approval
//! hands the proposal's objective to the team-assignment engine via
//! `companion_assign_team` (the existing create + decompose + run path), so the
//! deliberation plane FEEDS the deterministic engine.

use std::sync::Arc;

use tauri::State;

use crate::commands::teams::assignments::{companion_assign_team, CompanionAssignTeamResult};
use crate::db::models::{
    CreateDeliberationInput, DeliberationAgendaItem, ProposalSpec, TeamChannelMessage,
    TeamDeliberation,
};
use crate::db::repos::resources::{deliberation as repo, team_channel as channel_repo};
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

/// Open a deliberation on a team (user or Athena — decision 4). The DB
/// partial-unique index enforces one active deliberation per team.
#[tauri::command]
pub fn create_team_deliberation(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    topic: String,
    goal: Option<String>,
    created_by: Option<String>,
) -> Result<TeamDeliberation, AppError> {
    require_auth_sync(&state)?;
    repo::create(
        &state.db,
        CreateDeliberationInput {
            team_id,
            topic,
            goal,
            created_by: created_by.or_else(|| Some("user".into())),
            cost_budget_usd: None,
            idle_deadline: None,
        },
    )
}

/// All deliberations for a team (newest-first) — the board/channel read.
#[tauri::command]
pub fn list_team_deliberations(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<Vec<TeamDeliberation>, AppError> {
    require_auth_sync(&state)?;
    repo::list_for_team(&state.db, &team_id)
}

#[tauri::command]
pub fn get_team_deliberation(
    state: State<'_, Arc<AppState>>,
    deliberation_id: String,
) -> Result<TeamDeliberation, AppError> {
    require_auth_sync(&state)?;
    repo::get(&state.db, &deliberation_id)
}

#[tauri::command]
pub fn list_deliberation_agenda(
    state: State<'_, Arc<AppState>>,
    deliberation_id: String,
) -> Result<Vec<DeliberationAgendaItem>, AppError> {
    require_auth_sync(&state)?;
    repo::list_agenda(&state.db, &deliberation_id)
}

/// The deliberation's turns (persona/system messages), oldest-first — the turn
/// stream the UI renders. Reuses the channel's `deliberation_id` link.
#[tauri::command]
pub fn list_deliberation_turns(
    state: State<'_, Arc<AppState>>,
    deliberation_id: String,
    limit: Option<i64>,
) -> Result<Vec<TeamChannelMessage>, AppError> {
    require_auth_sync(&state)?;
    let mut turns =
        channel_repo::list_for_deliberation(&state.db, &deliberation_id, limit.unwrap_or(200))?;
    turns.reverse(); // list_for_deliberation is newest-first; the stream reads oldest-first
    Ok(turns)
}

/// The decision gate (decision 8 — always gated in v1): approve a resolved
/// deliberation's proposal, handing its objective to the team-assignment engine
/// (`companion_assign_team`). Records the spawned assignment + posts a channel
/// note; returns the assignment id.
#[tauri::command]
pub async fn approve_deliberation_proposal(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    deliberation_id: String,
) -> Result<CompanionAssignTeamResult, AppError> {
    require_auth(&state).await?;
    let pool = state.db.clone();
    let delib = repo::get(&pool, &deliberation_id)?;

    // Parse the stored (pending) proposal out of the resolution JSON.
    let resolution = delib
        .resolution
        .as_deref()
        .ok_or_else(|| AppError::Validation("Deliberation has no proposal to approve".into()))?;
    let val: serde_json::Value = serde_json::from_str(resolution)
        .map_err(|_| AppError::Validation("Invalid deliberation resolution".into()))?;
    let proposal: ProposalSpec = val
        .get("proposal")
        .filter(|p| !p.is_null())
        .and_then(|p| serde_json::from_value(p.clone()).ok())
        .ok_or_else(|| AppError::Validation("Deliberation has no proposal to approve".into()))?;

    let team_id = delib.team_id.clone();
    // Hand the objective to the team-assignment engine (consumes `state`).
    let result = companion_assign_team(
        state,
        app,
        team_id.clone(),
        proposal.objective.clone(),
        Some(proposal.title.clone()),
    )
    .await?;

    // Record the approval + the spawned assignment on the deliberation.
    let approved_json = serde_json::json!({
        "kind": "proposal",
        "status": "approved",
        "proposal": proposal,
        "assignment_id": result.assignment_id,
    })
    .to_string();
    repo::finalize(
        &pool,
        &deliberation_id,
        "resolved",
        Some(&approved_json),
        Some(&result.assignment_id),
    )?;
    let _ = channel_repo::post_deliberation_turn(
        &pool,
        &deliberation_id,
        &team_id,
        "system",
        None,
        &format!(
            "Approved — spawned assignment {} for “{}”.",
            result.assignment_id, proposal.title
        ),
    );
    Ok(result)
}

/// Dismiss a resolved deliberation's proposal without spawning work.
#[tauri::command]
pub fn dismiss_deliberation_proposal(
    state: State<'_, Arc<AppState>>,
    deliberation_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let delib = repo::get(&state.db, &deliberation_id)?;
    let dismissed = serde_json::json!({"kind": "proposal", "status": "dismissed"}).to_string();
    repo::finalize(&state.db, &deliberation_id, "aborted", Some(&dismissed), None)?;
    let _ = channel_repo::post_deliberation_turn(
        &state.db,
        &deliberation_id,
        &delib.team_id,
        "system",
        None,
        "Proposal dismissed by the user.",
    );
    Ok(())
}
