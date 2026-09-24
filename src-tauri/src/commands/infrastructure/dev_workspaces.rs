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

/// Record which workspace the operator is standing in, or clear it.
///
/// The selection itself is a per-device UI preference and lives in the
/// client's `localStorage`; this is the one-way mirror of it that the BACKEND
/// reads, because a door with no project in its payload has no other way to
/// learn which organisation a new persona belongs to
/// (`approval_exec_core::active_workspace_group` files Athena's context-free
/// hires into the active workspace's cross-project group).
///
/// Deliberately a command rather than a client-side `setAppSetting`, for the
/// reason `dev_tools_set_knowledge_root` gives: the settings KEY NAME then
/// lives only in Rust, so there is no second spelling of it on the client to
/// drift out of step with the registry that owns it.
///
/// `None` — or a blank id — DELETES the row rather than writing an empty
/// string: "no workspace selected" is the absence of the row, and the doors
/// that read it then file the persona nowhere instead of guessing. The id is
/// deliberately not validated here, because a workspace can be deleted long
/// after it was mirrored; the check that matters happens at read time.
#[tauri::command]
pub fn dev_tools_workspace_set_active(
    state: State<'_, Arc<AppState>>,
    workspace_id: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let key = crate::db::settings_keys::DEVTOOLS_ACTIVE_WORKSPACE;
    match workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(id) => crate::db::repos::core::settings::set(&state.db, key, id),
        None => crate::db::repos::core::settings::delete(&state.db, key).map(|_| ()),
    }
}

#[tauri::command]
pub fn dev_tools_workspace_import_local(
    state: State<'_, Arc<AppState>>,
    items: Vec<WorkspaceImportItem>,
) -> Result<Vec<DevWorkspace>, AppError> {
    require_auth_sync(&state)?;
    repo::import_local(&state.db, &items)
}
