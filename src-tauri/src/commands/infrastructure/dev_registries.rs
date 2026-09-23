//! Tauri command surface for knowledge registries — the workspace's link to an
//! ai-registry checkout.
//!
//! Thin `require_auth_sync` + repo-delegation wrappers, the
//! `dev_workspaces.rs` shape. Everything that decides anything lives in
//! `repos::dev_registries`: the knowledge-root rule, the one-registry-per-
//! workspace hold, the delete-with-the-last-holder rule, and the registration
//! of the clone as a dispatchable project.
//!
//! **Why every mutator emits the companions status.** Curator's `eligible` is
//! computed from this wiring (`commands::companions::status_snapshot`), so a
//! link or an unlink changes a fact three surfaces are showing. Emitting here
//! is the same discipline the starred-agent doors follow: the write has already
//! committed, so a failed emit costs a stale panel until the next read, never a
//! lost change.
//!
//! The read side is ONE command. The client keeps the whole wiring in memory
//! and derives `registryFor` / `workspacesOn` from it, exactly as it did from
//! the browser blob, so a per-question command would be IPC nobody calls.

use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::db::models::{
    DevRegistry, DevRegistryInput, RegistryLinkSnapshot, WorkspaceRegistryLink,
};
use crate::db::repos::dev_registries as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Every registry, every workspace's hold, and the knowledge root derived from
/// them — the client store's whole load.
#[tauri::command]
pub fn dev_tools_registry_snapshot(
    state: State<'_, Arc<AppState>>,
) -> Result<RegistryLinkSnapshot, AppError> {
    require_auth_sync(&state)?;
    repo::snapshot(&state.db)
}

/// Write a registry. Insert or full update — the client merges and sends the
/// whole row, so there is no second, field-wise way to say the same thing.
#[tauri::command]
pub fn dev_tools_registry_upsert(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    registry: DevRegistryInput,
) -> Result<DevRegistry, AppError> {
    require_auth_sync(&state)?;
    let stored = repo::upsert(&state.db, &registry)?;
    crate::commands::companions::emit_status(&app, state.inner());
    Ok(stored)
}

/// Give a workspace a registry to hold, replacing whatever it held.
#[tauri::command]
pub fn dev_tools_registry_link(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    workspace_id: String,
    registry_id: String,
) -> Result<DevRegistry, AppError> {
    require_auth_sync(&state)?;
    let registry = repo::link_workspace(&state.db, &workspace_id, &registry_id)?;
    crate::commands::companions::emit_status(&app, state.inner());
    Ok(registry)
}

/// Detach a workspace. `false` means it held nothing. The registry survives
/// while any other workspace holds it.
#[tauri::command]
pub fn dev_tools_registry_unlink(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    workspace_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let removed = repo::unlink_workspace(&state.db, &workspace_id)?;
    crate::commands::companions::emit_status(&app, state.inner());
    Ok(removed)
}

/// One-time adoption of the browser blob (`devtools.registryLinks.v1`).
/// Idempotent, and lands what it can rather than failing whole.
#[tauri::command]
pub fn dev_tools_registry_import(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    registries: Vec<DevRegistryInput>,
    links: Vec<WorkspaceRegistryLink>,
) -> Result<RegistryLinkSnapshot, AppError> {
    require_auth_sync(&state)?;
    let snapshot = repo::import(&state.db, &registries, &links)?;
    crate::commands::companions::emit_status(&app, state.inner());
    Ok(snapshot)
}
