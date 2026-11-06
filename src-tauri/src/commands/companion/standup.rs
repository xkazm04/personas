//! Tauri commands for the standup (spark app-standup). WP1 owns this file.
//!
//! WP0 froze the signatures; the bodies are stubs until WP1 lands the repo
//! and engine calls (`companion::standup::{plan, arm, propose}`). Each stub
//! takes its real arguments so the TS wrappers in
//! `src/api/companion/standup.ts` and `check:contracts` see the final wire
//! shape now. The forecast command lives in `commands/fleet/host_utilization.rs`
//! (WP2's file) so builders never share a file.
//!
//! Every command is an adapter: auth, one call, map the result.

use std::sync::Arc;

use tauri::State;

use crate::companion::standup::{
    AwayRules, Standup, StandupEvent, StandupItemPatch, StandupSummary,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The refusal every stub returns until its owner lands the body.
fn not_implemented(command: &str, owner: &str) -> AppError {
    AppError::Execution(format!("{command}: not implemented: {owner}"))
}

/// The live standup (the newest `draft` or `armed` revision), if any.
#[tauri::command]
pub async fn standup_current(state: State<'_, Arc<AppState>>) -> Result<Option<Standup>, AppError> {
    require_auth(&state).await?;
    Ok(None)
}

/// Open a standup: a fresh revision 1, or revision n+1 copied from the armed
/// plan when one is live.
#[tauri::command]
pub async fn standup_open(state: State<'_, Arc<AppState>>) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    Err(not_implemented("standup_open", "WP1"))
}

/// Run the proposal job over the revision's projects.
#[tauri::command]
pub async fn standup_propose(
    state: State<'_, Arc<AppState>>,
    standup_id: String,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    let _ = standup_id;
    Err(not_implemented("standup_propose", "WP1"))
}

/// Apply one item patch (pick / edit / skip / window / priority / time).
#[tauri::command]
pub async fn standup_update_item(
    state: State<'_, Arc<AppState>>,
    standup_id: String,
    patch: StandupItemPatch,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    let _ = (standup_id, patch);
    Err(not_implemented("standup_update_item", "WP1"))
}

/// Replace the revision's away rules.
#[tauri::command]
pub async fn standup_set_away_rules(
    state: State<'_, Arc<AppState>>,
    standup_id: String,
    rules: AwayRules,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    let _ = (standup_id, rules);
    Err(not_implemented("standup_set_away_rules", "WP1"))
}

/// Pass the go-gate: arm the revision (idempotent per revision).
#[tauri::command]
pub async fn standup_arm(
    state: State<'_, Arc<AppState>>,
    standup_id: String,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    let _ = standup_id;
    Err(not_implemented("standup_arm", "WP1"))
}

/// End the standup; its report becomes final.
#[tauri::command]
pub async fn standup_end(
    state: State<'_, Arc<AppState>>,
    standup_id: String,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    let _ = standup_id;
    Err(not_implemented("standup_end", "WP1"))
}

/// The standup's away acts, newest first, at most `limit`.
#[tauri::command]
pub async fn standup_events(
    state: State<'_, Arc<AppState>>,
    standup_id: String,
    limit: i32,
) -> Result<Vec<StandupEvent>, AppError> {
    require_auth(&state).await?;
    let _ = (standup_id, limit);
    Err(not_implemented("standup_events", "WP1"))
}

/// Past revisions, newest first, at most `limit`.
#[tauri::command]
pub async fn standup_history(
    state: State<'_, Arc<AppState>>,
    limit: i32,
) -> Result<Vec<StandupSummary>, AppError> {
    require_auth(&state).await?;
    let _ = limit;
    Ok(Vec::new())
}

/// Open (or reuse) an Athena conversation bound to one item's project and
/// return its id ("Talk it through").
#[tauri::command]
pub async fn standup_discuss(
    state: State<'_, Arc<AppState>>,
    standup_id: String,
    item_id: String,
) -> Result<String, AppError> {
    require_auth(&state).await?;
    let _ = (standup_id, item_id);
    Err(not_implemented("standup_discuss", "WP1"))
}
