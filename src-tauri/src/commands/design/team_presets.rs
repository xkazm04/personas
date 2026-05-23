//! Tauri command surface for filesystem-shipped team presets.
//!
//! The `list_team_presets` / `get_team_preset` pair powers the Presets
//! gallery and the preview modal; `adopt_team_preset` will live next to
//! these once the adopter module lands. Loading is delegated entirely to
//! `engine::team_preset_loader` — these commands are auth-gated thin
//! wrappers.

use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::db::models::{AdoptedTeamPresetResult, PresetAdoptionSchema, TeamPreset};
use crate::engine::{team_preset_adopter, team_preset_loader};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Return every valid preset manifest under
/// `scripts/templates/_team_presets/`. Invalid manifests are skipped
/// silently (logged via `tracing::warn` in the loader). Result is sorted
/// by `name` for stable gallery ordering.
///
/// `language` (e.g. `"zh"`, `"de"`) selects per-preset locale overlay
/// siblings (`<id>.<lang>.json`) when present. `None` returns canonical
/// English. Overlays are partial — fields absent from the overlay fall
/// through to canonical, so a translation team can ship name +
/// description first and add member-level translations later.
#[tauri::command]
pub fn list_team_presets(
    state: State<'_, Arc<AppState>>,
    language: Option<String>,
) -> Result<Vec<TeamPreset>, AppError> {
    require_auth_sync(&state)?;
    Ok(team_preset_loader::list_presets(language.as_deref()))
}

/// Return one preset by id (the on-disk filename minus `.json`). Returns
/// `NotFound` for an unknown id, `Validation` for parse/schema/role
/// failures.
///
/// `language` applies the matching `<id>.<lang>.json` overlay — same
/// rules as `list_team_presets`.
#[tauri::command]
pub fn get_team_preset(
    state: State<'_, Arc<AppState>>,
    id: String,
    language: Option<String>,
) -> Result<TeamPreset, AppError> {
    require_auth_sync(&state)?;
    team_preset_loader::get_preset(&id, language.as_deref())
}

/// Aggregate every member template's `payload.adoption_questions[]`
/// into one combined questionnaire schema for the Presets preview
/// modal. Members whose template files are missing or unparseable are
/// skipped from the schema view (the adopter surfaces those failures
/// at adopt time); members with no adoption_questions appear with an
/// empty `questions` array so the UI can render the full member list
/// rather than silently dropping rows.
///
/// `language` flows through to the preset-level metadata
/// (preset_name). Template-level translation of question labels is
/// applied frontend-side via the same template-overlay path the
/// single-template adoption flow uses, so callers don't need to
/// thread it twice.
#[tauri::command]
pub fn get_preset_adoption_schema(
    state: State<'_, Arc<AppState>>,
    preset_id: String,
    language: Option<String>,
) -> Result<PresetAdoptionSchema, AppError> {
    require_auth_sync(&state)?;
    team_preset_loader::get_adoption_schema(&preset_id, language.as_deref())
}

/// Run a preset's full adoption flow: create optional group, create team
/// shell, adopt each member template, bind to group, add to team, wire
/// connections. See `engine::team_preset_adopter` for the full step
/// sequence and partial-success semantics.
///
/// `language` is the user's current locale at the moment the adopt
/// button was clicked — passed straight through to the loader so the
/// persisted team + group names match what the user saw in the preview
/// modal. Switching language AFTER adoption does not retranslate
/// existing teams (they're frozen at the adopted locale).
///
/// `parameter_overrides` carries the combined questionnaire answers
/// from the preview modal: outer key is the preset-manifest role,
/// inner key is the question id, value is the answer (any JSON
/// type; downstream code coerces per the question's declared
/// `type`). Omit / pass `None` to adopt with template defaults.
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
    language: Option<String>,
    parameter_overrides: Option<
        std::collections::HashMap<
            String,
            std::collections::HashMap<String, serde_json::Value>,
        >,
    >,
) -> Result<AdoptedTeamPresetResult, AppError> {
    require_auth_sync(&state)?;
    team_preset_adopter::adopt_preset(
        &state,
        Some(app),
        &id,
        language.as_deref(),
        parameter_overrides.as_ref(),
    )
}

/// Retry the specified failed roles of a previously-adopted preset.
/// Surfaces as the "Retry N failed" button in `PresetPreviewModal` —
/// reuses the same `team-preset-adopt-progress` event stream so the
/// existing per-row status badges animate identically. Idempotent on
/// roles already adopted (silently skipped), so double-clicking is
/// safe.
///
/// `language` should match the locale used for the original adoption
/// so the retried members' persisted names stay consistent with the
/// rest of the team. (The frontend keeps the locale from the initial
/// adopt-click and passes the same value back here.)
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
    language: Option<String>,
    parameter_overrides: Option<
        std::collections::HashMap<
            String,
            std::collections::HashMap<String, serde_json::Value>,
        >,
    >,
) -> Result<AdoptedTeamPresetResult, AppError> {
    require_auth_sync(&state)?;
    team_preset_adopter::retry_failed_members(
        &state,
        Some(app),
        &preset_id,
        &team_id,
        group_id.as_deref(),
        &roles,
        language.as_deref(),
        parameter_overrides.as_ref(),
    )
}
