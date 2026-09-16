//! Tauri command surface for Workspaces — a named grouping of dev projects.
//! Thin `require_auth_sync` + repo-delegation wrappers, mirroring
//! `dev_tools.rs` conventions — kept as its own module (like `kpi_sim`)
//! instead of growing that 3.9k-line file.
//!
//! This module used to carry the Workspace Knowledge Center as well (a
//! DB-backed practice library with adoption matrix, playbooks, harvest,
//! divergence, verification and projection). That library was retired: the
//! external ai-registry is the knowledge authority now, and the app reads it
//! rather than ingesting it.
//!
//! NOT related to `dev_tools/workspace.rs` (git-worktree isolation engine)
//! or `engine/workspace_sync` (cross-device DB sync).

use std::sync::Arc;
use tauri::State;

use crate::db::models::{DevProject, DevWorkspace, WorkspaceImportItem};
use crate::db::repos::dev_workspaces as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn dev_tools_workspace_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DevWorkspace>, AppError> {
    require_auth_sync(&state)?;
    repo::list_workspaces(&state.db)
}

#[tauri::command]
pub fn dev_tools_workspace_create(
    state: State<'_, Arc<AppState>>,
    name: String,
    color: Option<String>,
    description: Option<String>,
    adopt_default_skills: Option<bool>,
) -> Result<DevWorkspace, AppError> {
    require_auth_sync(&state)?;
    repo::create_workspace(
        &state.db,
        &name,
        color.as_deref(),
        description.as_deref(),
        adopt_default_skills.unwrap_or(false),
    )
}

#[tauri::command]
pub fn dev_tools_workspace_update(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    color: Option<Option<String>>,
    description: Option<Option<String>>,
) -> Result<DevWorkspace, AppError> {
    require_auth_sync(&state)?;
    repo::update_workspace(
        &state.db,
        &id,
        name.as_deref(),
        color.as_ref().map(|o| o.as_deref()),
        description.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_workspace_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_workspace(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_workspace_assign_project(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    workspace_id: Option<String>,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::assign_project(&state.db, &project_id, workspace_id.as_deref())
}

#[tauri::command]
pub fn dev_tools_workspace_import_local(
    state: State<'_, Arc<AppState>>,
    items: Vec<WorkspaceImportItem>,
) -> Result<Vec<DevWorkspace>, AppError> {
    require_auth_sync(&state)?;
    repo::import_local(&state.db, &items)
}
