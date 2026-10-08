//! Lifecycle v2 - the command surface. Adapters over `crate::lifecycle`.
//!
//! Every read and write returns the whole [`LifecycleSnapshot`] so the client
//! renders one shape. Writes land in `dev_lifecycle_versions`, whose CDC arm
//! emits `dev-tools-lifecycle-changed` (`event_name::DEV_TOOLS_LIFECYCLE_CHANGED`).
//! The snapshot reads repo files and git, so it runs off the IPC thread.

use std::sync::Arc;

use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::db::models::{
    LifecycleMeasureStarted, LifecyclePreset, LifecycleSendResult, LifecycleSnapshot,
    LifecycleStepDetail, LifecycleStepParams, LifecycleWatchedPipeline,
};
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

// ---------------------------------------------------------------------------
// Measured health + Overseer (spark lifecycle-health). Contract frozen in WP0;
// WP1 built measure, step_detail and set_step_params; the WP2 bodies
// (set_watch, send_to_overseer, watched_pipelines) are still stubs.
// ---------------------------------------------------------------------------

fn not_built(what: &str) -> AppError {
    AppError::Internal(format!("lifecycle: {what} is not built yet"))
}

/// Run the project's gate/test/coverage commands on the base-branch tip in a
/// throwaway worktree, timed, appending `dev_lifecycle_runs`. Returns at once;
/// rows land via `DEV_TOOLS_LIFECYCLE_CHANGED`. Refused (`validation`) while
/// any Measure runs - one at a time, process-wide.
#[tauri::command]
pub async fn dev_tools_lifecycle_measure(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<LifecycleMeasureStarted, AppError> {
    require_auth(&state).await?;
    let notify = lifecycle::measure::emitter(app);
    lifecycle::measure::start(state.db.clone(), project_id, notify).await
}

/// Layer-2 data for one step: run history (newest first, <= 30) and doc rows.
#[tauri::command]
pub async fn dev_tools_lifecycle_step_detail(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    step_id: String,
) -> Result<LifecycleStepDetail, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    run_blocking("dev_tools_lifecycle_step_detail", move || {
        lifecycle::step_detail(&db, &project_id, &step_id)
    })
    .await
}

/// Replace one step's params (commands, thresholds); appends a version
/// authored `operator`.
#[tauri::command]
pub async fn dev_tools_lifecycle_set_step_params(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    step_id: String,
    params: LifecycleStepParams,
) -> Result<LifecycleSnapshot, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    run_blocking("dev_tools_lifecycle_set_step_params", move || {
        lifecycle::set_step_params(&db, &project_id, &step_id, params)?;
        lifecycle::snapshot(&db, &project_id)
    })
    .await
}

/// Star / unstar the project for the Overseer. Returns the new state.
#[tauri::command]
pub async fn dev_tools_lifecycle_set_watch(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    watched: bool,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    let _ = (project_id, watched);
    Err(not_built("watch"))
}

/// Hand the pipeline to the Overseer: open (or reuse) the "All steps green"
/// goal and file one accepted backlog item per non-green measurable step.
#[tauri::command]
pub async fn dev_tools_lifecycle_send_to_overseer(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<LifecycleSendResult, AppError> {
    require_auth(&state).await?;
    let _ = project_id;
    Err(not_built("send to overseer"))
}

/// Every Overseer-watched project with its goal progress and last measure.
#[tauri::command]
pub async fn dev_tools_overseer_watched_pipelines(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<LifecycleWatchedPipeline>, AppError> {
    require_auth(&state).await?;
    Err(not_built("watched pipelines"))
}
