//! Tauri IPC surface for the Director meta-persona.
//!
//! See `src-tauri/src/engine/director.rs` for architecture and phasing.

use std::sync::Arc;

use tauri::State;

use crate::engine::director::{
    self, DirectorReport, DirectorVerdictRow,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Returns the id of the system-owned Director persona. Frontend uses this
/// to hide the Director row from coaching target lists.
#[tauri::command]
pub fn get_director_persona_id(
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    director::get_director_persona_id(&state.db)
}

/// Evaluate a single target persona. Returns the number of verdicts emitted
/// (0 is the healthy outcome; verdicts land in `persona_manual_reviews`).
#[tauri::command]
pub fn run_director_on_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    director::run_director_cycle_for(&state.db, &persona_id)
}

/// Evaluate every enabled persona (except the Director itself). Returns an
/// aggregate report. `max_personas` caps the batch size — unset means "all".
#[tauri::command]
pub fn run_director_batch(
    state: State<'_, Arc<AppState>>,
    max_personas: Option<i64>,
) -> Result<DirectorReport, AppError> {
    require_auth_sync(&state)?;
    director::run_director_cycle_batch(&state.db, max_personas)
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
