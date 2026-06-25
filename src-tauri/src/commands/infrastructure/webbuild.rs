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

/// Register an EXISTING project directory as a Dev Tools project (no scaffold) so
/// it can be opened + built in Studio — e.g. an existing repo like the mk
/// showcase. Same `dev_projects` registration as scaffold, minus create-next-app.
#[tauri::command]
pub async fn webbuild_register_existing(
    state: State<'_, Arc<AppState>>,
    name: String,
    path: String,
) -> Result<DevProject, AppError> {
    require_auth(&state).await?;
    if !std::path::Path::new(&path).is_dir() {
        return Err(AppError::Validation(format!("path does not exist: {path}")));
    }
    // Idempotent: re-registering the same repo returns the existing project row
    // instead of hitting the UNIQUE(root_path) constraint.
    if let Some(existing) = repo::get_project_by_path(&state.db, &path)? {
        return Ok(existing);
    }
    repo::create_project(
        &state.db,
        &name,
        &path,
        None,
        Some("active"),
        Some("Next.js/TypeScript/Tailwind"),
        None,
        None,
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
    // Inject the dev-only preview agent so the precise orb pointer (A3) can locate
    // elements in the cross-origin preview. Idempotent + best-effort.
    crate::webbuild::preview_agent::ensure(&dir);
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

/// Interrupt the in-flight build turn for a project — the Studio Stop button.
/// Kills the running Claude CLI turn (same path as the main chat's Stop); the
/// partial reply still returns to the pending `webbuild_session_send`. Returns
/// whether a turn was actually running.
#[tauri::command]
pub fn webbuild_session_stop(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    Ok(crate::companion::session::request_build_interrupt(&format!(
        "webbuild:{project_id}"
    )))
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

/// List a generated project's app-router routes (for the Studio preview's
/// cross-page navigation bar — click a route to jump the preview to it).
#[tauri::command]
pub fn webbuild_list_routes(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<String>, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    crate::webbuild::routes::list_routes(std::path::Path::new(&project.root_path))
}

/// List recent build-turn snapshots (C7 version history), newest first.
#[tauri::command]
pub fn webbuild_list_versions(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<crate::webbuild::versions::BuildVersion>, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    crate::webbuild::versions::list_versions(std::path::Path::new(&project.root_path))
}

/// Restore the project's files to a prior snapshot (C7). Keeps git history.
#[tauri::command]
pub fn webbuild_restore_version(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    sha: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    crate::webbuild::versions::restore(std::path::Path::new(&project.root_path), &sha)
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
    // Per-turn build controls: C1 effort knob (low|medium|high|xhigh) + C4
    // voice/style (concise|balanced|teaching). Both optional → engine defaults.
    effort: Option<String>,
    style: Option<String>,
    // C8 — per-project MCP connectors the user toggled on.
    mcp: Option<Vec<String>>,
) -> Result<crate::webbuild::plan::BuildTurnResult, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let dir = std::path::PathBuf::from(&project.root_path);
    if !dir.is_dir() {
        return Err(AppError::Validation(format!(
            "project path does not exist: {}",
            project.root_path
        )));
    }
    crate::companion::session::run_build_turn(
        &app,
        &state.user_db,
        &project_id,
        &dir,
        &message,
        effort.as_deref(),
        style.as_deref(),
        mcp.as_deref().unwrap_or(&[]),
    )
    .await
}
