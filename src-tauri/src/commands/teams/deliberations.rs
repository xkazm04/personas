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
    CreateDeliberationInput, DeliberationAgendaItem, PendingAction, ProposalSpec,
    TeamChannelMessage, TeamDeliberation,
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
    cost_budget_usd: Option<f64>,
) -> Result<TeamDeliberation, AppError> {
    require_auth_sync(&state)?;
    repo::create(
        &state.db,
        CreateDeliberationInput {
            team_id,
            topic,
            goal,
            created_by: created_by.or_else(|| Some("user".into())),
            // The hard cost floor + the "Run to budget" stop. None ⇒ unbounded
            // (the loop then ends on convergence / round cap instead).
            cost_budget_usd: cost_budget_usd.filter(|b| *b > 0.0),
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

/// Advance a deliberation by ONE moderated round on demand (user-initiated, so
/// NOT gated by the `autonomous_deliberation` flag — that gate is for unattended
/// background running). The moderator routes, the chosen personas speak, the
/// agenda + status update. Returns the updated deliberation; the UI refetches
/// the agenda + turns. Spends tokens (one Haiku moderator + a few Sonnet turns).
#[tauri::command]
pub async fn advance_team_deliberation(
    state: State<'_, Arc<AppState>>,
    deliberation_id: String,
) -> Result<TeamDeliberation, AppError> {
    require_auth(&state).await?;
    let delib = repo::get(&state.db, &deliberation_id)?;
    if delib.status == "resolved" || delib.status == "aborted" {
        return Ok(delib); // terminal — nothing to advance
    }
    crate::engine::deliberation::advance_one_deliberation(&state.db, &state.user_db, &delib).await?;
    repo::get(&state.db, &deliberation_id)
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

/// Approve a gated mid-deliberation capability action (decision 8 — always
/// gated). Runs the persona's requested capability FOR REAL (full tools /
/// connectors, the approval is the gate for any side effect), waits for its
/// output, posts that output back into the deliberation as a turn the team can
/// build on, rolls its cost into the deliberation meter, and resumes discussion.
#[tauri::command]
pub async fn approve_deliberation_action(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    deliberation_id: String,
) -> Result<TeamDeliberation, AppError> {
    require_auth(&state).await?;
    let pool = state.db.clone();
    let delib = repo::get(&pool, &deliberation_id)?;
    if delib.status != "awaiting_action" {
        return Ok(delib); // already resolved/skipped by another caller
    }
    let action: PendingAction = delib
        .pending_action
        .as_deref()
        .and_then(|j| serde_json::from_str(j).ok())
        .ok_or_else(|| AppError::Validation("No pending action to approve".into()))?;

    // Context for the capability so it acts on the deliberation, not in a vacuum.
    let input = serde_json::json!({
        "source": "team_deliberation",
        "deliberationId": delib.id,
        "topic": delib.topic,
        "goal": delib.goal,
        "request": action.rationale,
        "instruction": format!(
            "You are running this capability inside a live team deliberation on \"{}\". {} Produce a concrete, self-contained result the team can read and build the discussion on.",
            delib.topic, action.rationale
        ),
    })
    .to_string();

    let exec = match crate::commands::execution::executions::execute_persona_inner(
        &state,
        app,
        action.persona_id.clone(),
        None,
        Some(input),
        Some(action.use_case_id.clone()),
        None,
        None,
        /* is_simulation */ false,
    )
    .await
    {
        Ok(e) => e,
        Err(e) => {
            let _ = channel_repo::post_deliberation_turn(
                &pool,
                &deliberation_id,
                &delib.team_id,
                "system",
                None,
                &format!(
                    "⚠ Couldn't run “{}”: {}. Continuing discussion.",
                    action.use_case_title, e
                ),
            );
            let _ = repo::clear_pending_action(&pool, &deliberation_id, "open");
            return repo::get(&pool, &deliberation_id);
        }
    };

    // The runner fills output_data async — poll until terminal (~4 min ceiling).
    let mut status = exec.status.clone();
    let mut output = exec.output_data.clone();
    let mut cost = exec.cost_usd;
    for _ in 0..120 {
        if status == "completed" || status == "failed" || status == "cancelled" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let row = {
            let conn = pool.get()?;
            conn.query_row(
                "SELECT status, output_data, cost_usd FROM persona_executions WHERE id = ?1",
                rusqlite::params![exec.id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, f64>(2)?,
                    ))
                },
            )
            .map_err(AppError::Database)?
        };
        status = row.0;
        output = row.1;
        cost = row.2;
    }

    if cost > 0.0 {
        let _ = repo::add_cost(&pool, &deliberation_id, cost);
    }

    let body = match (status.as_str(), output.as_deref()) {
        ("completed", Some(out)) if !out.trim().is_empty() => {
            format!("🛠 Ran “{}”:\n\n{}", action.use_case_title, out.trim())
        }
        ("completed", _) => {
            format!("🛠 Ran “{}” — it produced no output.", action.use_case_title)
        }
        ("failed", _) | ("cancelled", _) => format!(
            "⚠ “{}” did not complete ({status}). Continuing discussion.",
            action.use_case_title
        ),
        _ => format!(
            "⏳ “{}” is still running — its result will land in the execution log. Continuing discussion.",
            action.use_case_title
        ),
    };
    let _ = channel_repo::post_deliberation_turn(
        &pool,
        &deliberation_id,
        &delib.team_id,
        "persona",
        Some(&action.persona_id),
        &body,
    );

    let _ = repo::clear_pending_action(&pool, &deliberation_id, "open");
    repo::get(&pool, &deliberation_id)
}

/// Skip a gated capability action — decline it and resume the discussion.
#[tauri::command]
pub fn skip_deliberation_action(
    state: State<'_, Arc<AppState>>,
    deliberation_id: String,
) -> Result<TeamDeliberation, AppError> {
    require_auth_sync(&state)?;
    let delib = repo::get(&state.db, &deliberation_id)?;
    let label = delib
        .pending_action
        .as_deref()
        .and_then(|j| serde_json::from_str::<PendingAction>(j).ok())
        .map(|a| a.use_case_title)
        .unwrap_or_else(|| "the action".into());
    let _ = channel_repo::post_deliberation_turn(
        &state.db,
        &deliberation_id,
        &delib.team_id,
        "system",
        None,
        &format!("Skipped “{label}” — continuing discussion."),
    );
    repo::clear_pending_action(&state.db, &deliberation_id, "open")?;
    repo::get(&state.db, &deliberation_id)
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
