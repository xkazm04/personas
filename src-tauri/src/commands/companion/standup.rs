//! Tauri commands for the standup (spark app-standup). WP1 owns this file.
//!
//! WP0 froze the signatures (the wire arguments and return types); WP1 filled
//! the bodies. Every command is an adapter: auth, one call into
//! `companion::standup::service`, the result. The terminal client's HTTP doors
//! (`local_http::standup`) call the same service functions. The forecast
//! command lives in `commands/fleet/host_utilization.rs` (WP2's file).
//!
//! The `AppHandle` argument is injected by Tauri, not sent by the caller, so
//! the TS wrappers in `src/api/companion/standup.ts` are unchanged.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::companion::standup::{
    service, AwayRules, Standup, StandupEvent, StandupItemPatch, StandupSummary,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The live standup (the newest `draft` or `armed` revision), if any.
#[tauri::command]
pub async fn standup_current(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<Option<Standup>, AppError> {
    require_auth(&state).await?;
    service::current(&app).await
}

/// Open a standup: a fresh revision 1, or revision n+1 copied from the armed
/// plan when one is live.
#[tauri::command]
pub async fn standup_open(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    service::open(&app).await
}

/// Run the proposal job over the revision's projects. Returns at once; the
/// cards fill in as `standup://updated` events arrive.
#[tauri::command]
pub async fn standup_propose(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    standup_id: String,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    service::propose(&app, &standup_id).await
}

/// Apply one item patch (pick / edit / skip / window / priority / time).
#[tauri::command]
pub async fn standup_update_item(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    standup_id: String,
    patch: StandupItemPatch,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    service::update_item(&app, &standup_id, patch).await
}

/// Replace the revision's away rules.
#[tauri::command]
pub async fn standup_set_away_rules(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    standup_id: String,
    rules: AwayRules,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    service::set_away_rules(&app, &standup_id, rules).await
}

/// Pass the go-gate: arm the revision (idempotent per revision).
#[tauri::command]
pub async fn standup_arm(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    standup_id: String,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    service::arm(&app, &standup_id).await
}

/// End the standup; its report becomes final.
#[tauri::command]
pub async fn standup_end(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    standup_id: String,
) -> Result<Standup, AppError> {
    require_auth(&state).await?;
    service::end(&app, &standup_id).await
}

/// The standup's away acts, newest first, at most `limit`.
#[tauri::command]
pub async fn standup_events(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    standup_id: String,
    limit: i32,
) -> Result<Vec<StandupEvent>, AppError> {
    require_auth(&state).await?;
    service::events(&app, &standup_id, limit).await
}

/// Past revisions, newest first, at most `limit`.
#[tauri::command]
pub async fn standup_history(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    limit: i32,
) -> Result<Vec<StandupSummary>, AppError> {
    require_auth(&state).await?;
    service::history(&app, limit).await
}

/// Open (or reuse) an Athena conversation bound to one item's project and
/// return its id ("Talk it through").
#[tauri::command]
pub async fn standup_discuss(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    standup_id: String,
    item_id: String,
) -> Result<String, AppError> {
    require_auth(&state).await?;
    service::discuss(&app, &standup_id, &item_id).await
}
