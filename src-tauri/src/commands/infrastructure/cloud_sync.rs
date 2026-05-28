//! Tauri commands for the desktop → cloud sync writer.

use std::sync::Arc;

use personas_macros::requires;
use tauri::State;

use crate::cloud::sync;
use crate::error::AppError;
use crate::AppState;

/// Enable or disable cloud sync (persisted; default off). Enabling kicks an
/// immediate pass via the loop's wake channel.
#[tauri::command]
#[requires(privileged)]
pub async fn cloud_sync_set_enabled(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<(), AppError> {
    sync::set_enabled(&state.db, enabled)
}

/// Read the current sync status (enabled flag + last-run telemetry).
#[tauri::command]
#[requires(privileged)]
pub async fn cloud_sync_status(
    state: State<'_, Arc<AppState>>,
) -> Result<sync::CloudSyncStatus, AppError> {
    Ok(sync::status(&state.db).await)
}

/// Trigger one sync pass now. Requires a live Google-OAuth session (cloud tier)
/// since it pushes to Supabase. No-op if sync is disabled.
#[tauri::command]
#[requires(cloud)]
pub async fn cloud_sync_now(state: State<'_, Arc<AppState>>) -> Result<u64, AppError> {
    sync::run_sync_once(state.inner()).await
}
