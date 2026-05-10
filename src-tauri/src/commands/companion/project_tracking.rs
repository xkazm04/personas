//! Tauri commands for the project_tracking subscription editor and the
//! master enable toggle. Owned by the Dev Tools UI per the
//! locked design decision; Companion's plugin setup only flips the
//! global enable gate.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::engine::project_tracking::scheduler;
use crate::engine::project_tracking::subscription::{
    self, SubscriptionUpdate, SubscriptionWithProject,
};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

/// List all known projects with their subscription state. Disabled
/// projects appear too, so the editor can show the master list.
#[tauri::command]
pub fn project_tracking_list_subscriptions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SubscriptionWithProject>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    subscription::list_with_projects(&state.user_db)
}

/// Upsert one project's subscription. Used by the Dev Tools edit form
/// when the user toggles a watch flag or sets the obsidian vault path.
#[tauri::command]
pub fn project_tracking_set_subscription(
    state: State<'_, Arc<AppState>>,
    update: SubscriptionUpdate,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    subscription::upsert(&state.user_db, &update)
}

/// Master enable for the entire engine project_tracking subsystem.
/// Wired to the "Track development activity" toggle in Companion's
/// plugin setup. When true, the scheduler ticks; when false, ticks
/// short-circuit immediately.
#[tauri::command]
pub fn project_tracking_set_master_enabled(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    state.project_tracking.set_enabled(enabled);
    Ok(())
}

/// Read the master enable flag. The Companion plugin setup hydrates
/// the toggle UI from this on mount.
#[tauri::command]
pub fn project_tracking_is_master_enabled(
    state: State<'_, Arc<AppState>>,
) -> Result<bool, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    Ok(state.project_tracking.is_enabled())
}

/// Fire a single tick out-of-cadence. Used by the master toggle on its
/// "first enable" path so the user gets an immediate pulse instead of
/// waiting an hour. Per the locked first-run experience: backfill
/// consumes the last 24h and produces one initial pulse.
#[tauri::command]
pub async fn project_tracking_run_now(
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), AppError> {
    ipc_auth::require_auth(&state).await?;
    scheduler::run_tick(&state.user_db, &app_handle).await
}
