//! Ship layer commands — milestones as convergence cuts (Factory L2 → Ship
//! tab). Thin IPC wrappers over `repos::dev_tools`; all derivations (progress,
//! footprint, exit criteria) happen client-side from members + existing
//! signals, so the surface here is deliberately just decisions.
use std::sync::Arc;
use tauri::State;

use crate::db::models::{DevMilestone, DevMilestoneItem, DevProjectWallSummary};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn dev_tools_list_milestones(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<DevMilestone>, AppError> {
    require_auth_sync(&state)?;
    repo::list_milestones_by_project(&state.db, &project_id)
}

#[tauri::command]
pub fn dev_tools_create_milestone(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    name: String,
    goal: Option<String>,
    status: Option<String>,
    target_date: Option<String>,
) -> Result<DevMilestone, AppError> {
    require_auth_sync(&state)?;
    repo::create_milestone(
        &state.db,
        &project_id,
        &name,
        goal.as_deref(),
        status.as_deref(),
        target_date.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_update_milestone(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    goal: Option<String>,
    status: Option<String>,
    target_date: Option<String>,
    order_index: Option<i32>,
) -> Result<DevMilestone, AppError> {
    require_auth_sync(&state)?;
    repo::update_milestone(
        &state.db,
        &id,
        name.as_deref(),
        goal.as_deref(),
        status.as_deref(),
        target_date.as_deref(),
        order_index,
    )
}

#[tauri::command]
pub fn dev_tools_delete_milestone(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::delete_milestone(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_list_milestone_items(
    state: State<'_, Arc<AppState>>,
    milestone_id: String,
) -> Result<Vec<DevMilestoneItem>, AppError> {
    require_auth_sync(&state)?;
    repo::list_milestone_items(&state.db, &milestone_id)
}

#[tauri::command]
pub fn dev_tools_set_milestone_item(
    state: State<'_, Arc<AppState>>,
    milestone_id: String,
    item_kind: String,
    item_id: String,
    bucket: String,
) -> Result<DevMilestoneItem, AppError> {
    require_auth_sync(&state)?;
    repo::set_milestone_item(&state.db, &milestone_id, &item_kind, &item_id, &bucket)
}

#[tauri::command]
pub fn dev_tools_remove_milestone_item(
    state: State<'_, Arc<AppState>>,
    milestone_id: String,
    item_kind: String,
    item_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::remove_milestone_item(&state.db, &milestone_id, &item_kind, &item_id)
}

/// ONE call that answers the whole L1 passport wall (statband volume stats +
/// the minimized roadmap strip), replacing the three per-project fan-outs
/// (`dev_tools_list_contexts` + `dev_tools_list_kpis` +
/// `dev_tools_list_milestones`) the wall used to fire on every mount. 3N IPC
/// round trips → 1.
#[tauri::command]
pub fn dev_tools_project_wall_summary(
    state: State<'_, Arc<AppState>>,
    project_ids: Vec<String>,
) -> Result<Vec<DevProjectWallSummary>, AppError> {
    require_auth_sync(&state)?;
    repo::project_wall_summaries(&state.db, &project_ids)
}
