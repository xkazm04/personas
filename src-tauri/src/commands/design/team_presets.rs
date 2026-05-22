//! Tauri command surface for filesystem-shipped team presets.
//!
//! The `list_team_presets` / `get_team_preset` pair powers the Presets
//! gallery and the preview modal; `adopt_team_preset` will live next to
//! these once the adopter module lands. Loading is delegated entirely to
//! `engine::team_preset_loader` — these commands are auth-gated thin
//! wrappers.

use std::sync::Arc;
use tauri::State;

use crate::db::models::TeamPreset;
use crate::engine::team_preset_loader;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Return every valid preset manifest under
/// `scripts/templates/_team_presets/`. Invalid manifests are skipped
/// silently (logged via `tracing::warn` in the loader). Result is sorted
/// by `name` for stable gallery ordering.
#[tauri::command]
pub fn list_team_presets(state: State<'_, Arc<AppState>>) -> Result<Vec<TeamPreset>, AppError> {
    require_auth_sync(&state)?;
    Ok(team_preset_loader::list_presets())
}

/// Return one preset by id (the on-disk filename minus `.json`). Returns
/// `NotFound` for an unknown id, `Validation` for parse/schema/role
/// failures.
#[tauri::command]
pub fn get_team_preset(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<TeamPreset, AppError> {
    require_auth_sync(&state)?;
    team_preset_loader::get_preset(&id)
}
