//! Lifecycle v2 - the command surface. Adapters over `crate::lifecycle`.
//!
//! Every read and write returns the whole [`LifecycleSnapshot`] so the client
//! renders one shape. Writes land in `dev_lifecycle_versions`, whose CDC arm
//! emits `dev-tools-lifecycle-changed` (`event_name::DEV_TOOLS_LIFECYCLE_CHANGED`).
//! The snapshot reads repo files and git, so it runs off the IPC thread.

use std::sync::Arc;

use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::db::models::{LifecyclePreset, LifecycleSnapshot};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::lifecycle;
use crate::AppState;

/// The project's lifecycle: preset, version (0 = implicit Solo default), steps
/// with binding states and evidence tallies, install task, newest evidence.
#[tauri::command]
pub async fn dev_tools_get_lifecycle(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<LifecycleSnapshot, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    run_blocking("dev_tools_get_lifecycle", move || {
        lifecycle::snapshot(&db, &project_id)
    })
    .await
}

/// Switch the project to a built-in preset (author `operator`). A no-op
/// returning the current snapshot when the latest version already is it.
#[tauri::command]
pub async fn dev_tools_set_lifecycle_preset(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    preset: LifecyclePreset,
) -> Result<LifecycleSnapshot, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    run_blocking("dev_tools_set_lifecycle_preset", move || {
        lifecycle::set_preset(&db, &project_id, preset)?;
        lifecycle::snapshot(&db, &project_id)
    })
    .await
}

/// "Install into repo": dispatch a Run Desk task that writes the missing repo
/// bindings for the latest version. Returns the task id, or `null` when no repo
/// binding is missing.
#[tauri::command]
pub async fn dev_tools_lifecycle_install(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Option<String>, AppError> {
    require_auth(&state).await?;
    lifecycle::install::dispatch_install(state.inner(), &app, &project_id).await
}
