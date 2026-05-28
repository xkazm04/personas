//! Tauri IPC surface for the Director meta-persona.
//!
//! See `src-tauri/src/engine/director.rs` for architecture and phasing.

use std::sync::Arc;

use tauri::State;

use crate::engine::director::{self, DirectorReport, DirectorVerdictRow};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Returns the id of the system-owned Director persona. Frontend uses this
/// to hide the Director row from coaching target lists.
#[tauri::command]
pub fn get_director_persona_id(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    director::get_director_persona_id(&state.db)
}

/// Evaluate a single target persona. Returns the number of verdicts emitted
/// (0 is the healthy outcome; verdicts land in `persona_manual_reviews`).
///
/// Async + long-running: Phase 2 runs the Director persona through the
/// execution runner and polls it to completion, so this can take up to a few
/// minutes. The frontend invoke must use a generous timeout.
#[tauri::command]
pub async fn run_director_on_persona(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    director::run_director_cycle_for(state.inner(), app, &persona_id).await
}

/// Evaluate every enabled persona (except the Director itself). Returns an
/// aggregate report. `max_personas` caps the batch size — unset means "all".
///
/// Async + long-running: each target is a sequential Director persona run.
#[tauri::command]
pub async fn run_director_batch(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    max_personas: Option<i64>,
) -> Result<DirectorReport, AppError> {
    require_auth_sync(&state)?;
    director::run_director_cycle_batch(state.inner(), app, max_personas).await
}

/// Read Director verdicts (manual reviews with `context_data.source=director`).
#[tauri::command]
pub fn list_director_verdicts(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<Vec<DirectorVerdictRow>, AppError> {
    require_auth_sync(&state)?;
    director::list_verdicts(&state.db, persona_id.as_deref())
}

/// Whether the Director may use the Obsidian Brain vault as long-term memory.
#[tauri::command]
pub fn get_director_brain_enabled(state: State<'_, Arc<AppState>>) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    Ok(matches!(
        crate::db::repos::core::settings::get(&state.db, crate::db::settings_keys::DIRECTOR_BRAIN_ENABLED),
        Ok(Some(v)) if v == "true"
    ))
}

/// Toggle the Director's Brain long-term memory. Takes effect on the next review
/// (also gated on a vault being configured).
#[tauri::command]
pub fn set_director_brain_enabled(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    crate::db::repos::core::settings::set(
        &state.db,
        crate::db::settings_keys::DIRECTOR_BRAIN_ENABLED,
        if enabled { "true" } else { "false" },
    )
}
