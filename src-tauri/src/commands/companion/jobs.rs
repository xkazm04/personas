//! Tauri commands for projects + background jobs (Phase G).

use std::sync::Arc;

use tauri::State;

use crate::companion::jobs::{self, BackgroundJob};
use crate::companion::projects::{self, KnownProject};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

// ── Project registry ────────────────────────────────────────────────────

#[tauri::command]
pub fn companion_list_projects(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<KnownProject>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    projects::list(&state.user_db)
}

#[tauri::command]
pub fn companion_register_project(
    state: State<'_, Arc<AppState>>,
    name: String,
    path: String,
    description: Option<String>,
) -> Result<String, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    projects::register(&state.user_db, &name, &path, description.as_deref())
}

// ── Background jobs ─────────────────────────────────────────────────────

#[tauri::command]
pub fn companion_list_jobs(
    state: State<'_, Arc<AppState>>,
    only_unresolved: Option<bool>,
    limit: Option<u32>,
) -> Result<Vec<BackgroundJob>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    jobs::list(
        &state.user_db,
        only_unresolved.unwrap_or(false),
        limit.unwrap_or(50),
    )
}

#[tauri::command]
pub fn companion_get_job(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Option<BackgroundJob>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    jobs::get(&state.user_db, &id)
}

#[tauri::command]
pub fn companion_enqueue_job(
    state: State<'_, Arc<AppState>>,
    kind: String,
    params: Option<serde_json::Value>,
    project_id: Option<String>,
) -> Result<String, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let p = params.unwrap_or(serde_json::json!({}));
    jobs::enqueue(&state.user_db, &kind, &p, project_id.as_deref())
}
