//! Tauri command surface for the web-build runtime — P0 of the Athena web-dev
//! companion (`docs/plans/athena-webdev-companion-v0.md`). Scaffold a from-zero
//! project, register it, and manage its Bun dev server. Project rows reuse the
//! existing `dev_projects` registry; dev servers live in `AppState.webbuild_servers`.

use std::sync::Arc;

use tauri::State;

use crate::db::models::DevProject;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::webbuild::{self, DevServerStatus};
use crate::AppState;

/// Scaffold a blank Next.js + TS + Tailwind app from a human project name and
/// register it as a Dev Tools project. Returns the created project row.
#[tauri::command]
pub async fn webbuild_scaffold(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<DevProject, AppError> {
    require_auth(&state).await?;
    let slug = webbuild::project::slugify(&name)?;
    let dir = webbuild::project::scaffold_next_app(&slug).await?;
    let root_path = dir.to_string_lossy().to_string();
    repo::create_project(
        &state.db,
        &name,
        &root_path,
        None,                                 // description
        Some("active"),                       // status
        Some("Next.js/TypeScript/Tailwind"),  // tech_stack
        None,                                 // github_url
        None,                                 // team_id
    )
}

/// Start (or restart) the Bun dev server for a registered project. Returns its
/// status immediately; the server may still be booting (`healthy: false`) — the
/// caller polls [`webbuild_status`] until healthy.
#[tauri::command]
pub async fn webbuild_dev_start(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<DevServerStatus, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let dir = std::path::PathBuf::from(&project.root_path);
    if !dir.is_dir() {
        return Err(AppError::Validation(format!(
            "project path does not exist: {}",
            project.root_path
        )));
    }
    let port = webbuild::devserver::alloc_port()?;
    state.webbuild_servers.start(&project_id, &dir, port).await
}

/// Stop a project's Bun dev server (kills the whole process tree). Idempotent.
#[tauri::command]
pub fn webbuild_dev_stop(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    state.webbuild_servers.stop(&project_id);
    Ok(())
}

/// Live status of a project's dev server, or `None` when not running.
#[tauri::command]
pub fn webbuild_status(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Option<DevServerStatus>, AppError> {
    require_auth_sync(&state)?;
    Ok(state.webbuild_servers.status(&project_id))
}

/// Status of every running dev server.
#[tauri::command]
pub fn webbuild_list_servers(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DevServerStatus>, AppError> {
    require_auth_sync(&state)?;
    Ok(state.webbuild_servers.list())
}

/// Send a build instruction to a project's build session — a project-rooted
/// Claude Code turn (Athena) that edits the project's code. Streams progress on
/// `companion://stream` keyed by session id `webbuild:<project_id>`; returns
/// Athena's short summary of what changed. P2 of the web-dev companion.
#[tauri::command]
pub async fn webbuild_session_send(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
    message: String,
) -> Result<String, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let dir = std::path::PathBuf::from(&project.root_path);
    if !dir.is_dir() {
        return Err(AppError::Validation(format!(
            "project path does not exist: {}",
            project.root_path
        )));
    }
    crate::companion::session::run_build_turn(&app, &state.user_db, &project_id, &dir, &message).await
}
