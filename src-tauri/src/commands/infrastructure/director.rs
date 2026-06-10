//! Tauri IPC surface for the Director meta-persona.
//!
//! See `src-tauri/src/engine/director.rs` for architecture and phasing.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::State;

use crate::engine::director::{self, DirectorPortfolio, DirectorReport, DirectorVerdictRow};
use crate::engine::director_memory::{self, MemoryCleanupReport};
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

/// Curate one persona's memories (dedup sweep + bounded LLM "won't-use" pass).
/// Archives (reversibly) — never deletes, never touches `core`. `dry_run` reports
/// the proposed counts without mutating.
///
/// Async + long-running: the LLM pass is a real Director persona run (skipped
/// when there are no candidates). The frontend invoke must use a generous timeout.
#[tauri::command]
pub async fn run_director_memory_cleanup(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    dry_run: Option<bool>,
) -> Result<MemoryCleanupReport, AppError> {
    require_auth_sync(&state)?;
    director_memory::cleanup_persona_memories(
        state.inner(),
        app,
        &persona_id,
        dry_run.unwrap_or(false),
    )
    .await
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

/// Batched Director score trends keyed by persona id (oldest→newest). Personas
/// with no scored executions get an empty array. `limit` clamps the per-persona
/// window (default 10, hard ceiling 30 to keep the SVG sparkline readable).
#[tauri::command]
pub fn list_director_score_trends(
    state: State<'_, Arc<AppState>>,
    persona_ids: Vec<String>,
    limit: Option<i64>,
) -> Result<HashMap<String, Vec<i64>>, AppError> {
    require_auth_sync(&state)?;
    let limit = limit.unwrap_or(10).clamp(2, 30);
    director::list_score_trends(&state.db, &persona_ids, limit)
}

/// Portfolio analytics for the Director command center: fleet value rollup +
/// in-scope roster + latest-score distribution + headline counts. `days` clamps
/// the value-rollup window (default 30, 1..=365).
#[tauri::command]
pub fn get_director_portfolio(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
) -> Result<DirectorPortfolio, AppError> {
    require_auth_sync(&state)?;
    director::director_portfolio(&state.db, days.unwrap_or(30))
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

/// Read the persona's most recent Director coaching notes from the Obsidian
/// Brain vault as markdown, newest-first separated by horizontal rules — or
/// `None` when Brain is off, no vault is configured, or the persona has no
/// notes yet. Lets the coaching detail modal surface the long-term memory the
/// Director writes back after each review. Best-effort, read-only.
#[tauri::command]
pub fn get_director_brain_history(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<String>, AppError> {
    require_auth_sync(&state)?;
    if !crate::engine::director_brain::brain_enabled(&state.db) {
        return Ok(None);
    }
    let persona = crate::db::repos::core::personas::get_by_id(&state.db, &persona_id)?;
    Ok(crate::engine::director_brain::read_brain_history(&state.db, &persona.name))
}
