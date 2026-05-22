//! Tauri command surface for filesystem-shipped team presets.
//!
//! The `list_team_presets` / `get_team_preset` pair powers the Presets
//! gallery and the preview modal; `adopt_team_preset` will live next to
//! these once the adopter module lands. Loading is delegated entirely to
//! `engine::team_preset_loader` — these commands are auth-gated thin
//! wrappers.

use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::db::models::{AdoptedTeamPresetResult, TeamPreset};
use crate::engine::{team_preset_adopter, team_preset_loader};
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

/// Run a preset's full adoption flow: create optional group, create team
/// shell, adopt each member template, bind to group, add to team, wire
/// connections. See `engine::team_preset_adopter` for the full step
/// sequence and partial-success semantics.
///
/// Emits `team-preset-adopt-progress` events per member transition so
/// the preview modal can render a per-row status table. Returns
/// `AdoptedTeamPresetResult` with the new team_id, optional group_id,
/// successfully-adopted members, and any per-template failures.
#[tauri::command]
pub fn adopt_team_preset(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<AdoptedTeamPresetResult, AppError> {
    require_auth_sync(&state)?;
    team_preset_adopter::adopt_preset(&state, Some(app), &id)
}

/// Retry the specified failed roles of a previously-adopted preset.
/// Surfaces as the "Retry N failed" button in `PresetPreviewModal` —
/// reuses the same `team-preset-adopt-progress` event stream so the
/// existing per-row status badges animate identically. Idempotent on
/// roles already adopted (silently skipped), so double-clicking is
/// safe.
///
/// Returns the FULL member list (existing + newly-retried) so the
/// modal can swap state in one assignment.
#[tauri::command]
pub fn retry_team_preset_members(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    preset_id: String,
    team_id: String,
    group_id: Option<String>,
    roles: Vec<String>,
) -> Result<AdoptedTeamPresetResult, AppError> {
    require_auth_sync(&state)?;
    team_preset_adopter::retry_failed_members(
        &state,
        Some(app),
        &preset_id,
        &team_id,
        group_id.as_deref(),
        &roles,
    )
}
