//! Tauri command surface for living-agent responsibilities (spark
//! `living-agent-core`, WP3). Thin `require_auth_sync` + delegation wrappers,
//! mirroring `dev_workspaces.rs` conventions: validation and merge logic live
//! in `personas_engine::responsibility`, storage in
//! `db::repos::core::{responsibilities, attention_ledger}`.
//!
//! The attention LOOP lands in WP5; `list_attention_ledger` is the read door
//! that ships now so the UI can render the ledger from day one.

use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    AttentionLedgerEntry, CreatePersonaResponsibilityInput, PersonaResponsibility,
    ResponsibilityStatus, UpdatePersonaResponsibilityInput,
};
use crate::db::repos::core::attention_ledger;
use crate::db::repos::core::responsibilities as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// A persona's charters, newest first; retired ones only when asked for.
#[tauri::command]
pub fn list_persona_responsibilities(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    include_retired: Option<bool>,
) -> Result<Vec<PersonaResponsibility>, AppError> {
    require_auth_sync(&state)?;
    repo::list_by_persona(&state.db, &persona_id, include_retired.unwrap_or(false))
}

/// Operator create door — validates (rung ceiling, refusal-class library,
/// status vocabulary) and stamps `source = 'operator'`.
#[tauri::command]
pub fn create_persona_responsibility(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaResponsibilityInput,
) -> Result<PersonaResponsibility, AppError> {
    require_auth_sync(&state)?;
    personas_engine::responsibility::create_from_input(&state.db, &input)
}

/// Operator partial-update door — the MERGED charter is re-validated, so a
/// patch cannot sneak a rung-3 grant or an unknown refusal class past intake.
#[tauri::command]
pub fn update_persona_responsibility(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdatePersonaResponsibilityInput,
) -> Result<PersonaResponsibility, AppError> {
    require_auth_sync(&state)?;
    personas_engine::responsibility::update_from_input(&state.db, &id, input)
}

/// Retire a charter. Returns the refreshed row; retiring what does not exist
/// is a `NotFound`, not a silent no-op.
#[tauri::command]
pub fn retire_persona_responsibility(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaResponsibility, AppError> {
    require_auth_sync(&state)?;
    if !repo::set_status(&state.db, &id, ResponsibilityStatus::Retired)? {
        return Err(AppError::NotFound(format!("Responsibility {id}")));
    }
    repo::get_by_id(&state.db, &id)?
        .ok_or_else(|| AppError::NotFound(format!("Responsibility {id}")))
}

/// A persona's attention/consolidation passes, newest first (read-only;
/// the loop that writes them lands in WP5).
#[tauri::command]
pub fn list_attention_ledger(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<u32>,
) -> Result<Vec<AttentionLedgerEntry>, AppError> {
    require_auth_sync(&state)?;
    attention_ledger::list_by_persona(&state.db, &persona_id, limit.unwrap_or(50).min(500))
}
