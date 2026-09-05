//! Notepad commands — the pad's IPC surface.
//!
//! Adapters, in the repo's sense: validate, make one repo call, map the result.
//! The one piece of policy that lives HERE rather than in the repo is the
//! ten-note cap, because the repo is also the door a fork and a restore come
//! through and each of those spends a slot for a different reason.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::commands::infrastructure::notepad_ingest::sweep_notepad_runs_core;
use crate::db::models::{DevNote, NoteStatus, NotepadIngestReport};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;
use personas_core::events::event_name;
use personas_core::models::serde_util::double_option;
use tauri::Emitter;

/// Patch body for `notepad_update_note`. ONE object rather than bare optional
/// args because `project_id` needs three states — leave alone / clear / set —
/// and serde collapses an explicit JSON `null` on a bare `Option<Option<T>>`
/// arg into "absent". `double_option` keeps them apart (same fix as
/// `KnowledgeStructurePatch`).
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body_md: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub project_id: Option<Option<String>>,
    #[serde(default)]
    pub order_index: Option<i64>,
}

/// Refuse when the pad already holds [`repo::NOTE_CAP`] non-archived notes.
///
/// The cap is a working-set bound, and it is checked at every door that ADDS
/// one: create, fork, and restore-from-archive. Archiving is never blocked.
fn guard_cap(state: &AppState) -> Result<(), AppError> {
    if repo::count_active_notes(&state.db)? >= repo::NOTE_CAP {
        return Err(AppError::Validation("note cap reached".into()));
    }
    Ok(())
}

#[tauri::command]
pub fn notepad_list_notes(
    state: State<'_, Arc<AppState>>,
    include_archived: bool,
) -> Result<Vec<DevNote>, AppError> {
    require_auth_sync(&state)?;
    repo::list_notes(&state.db, include_archived)
}

#[tauri::command]
pub fn notepad_create_note(
    state: State<'_, Arc<AppState>>,
    title: String,
    project_id: Option<String>,
) -> Result<DevNote, AppError> {
    require_auth_sync(&state)?;
    guard_cap(&state)?;
    repo::create_note(&state.db, &title, project_id.as_deref())
}

#[tauri::command]
pub fn notepad_update_note(
    state: State<'_, Arc<AppState>>,
    id: String,
    patch: NotePatch,
) -> Result<DevNote, AppError> {
    require_auth_sync(&state)?;
    repo::update_note(
        &state.db,
        &id,
        patch.title.as_deref(),
        patch.body_md.as_deref(),
        patch.project_id.as_ref().map(|o| o.as_deref()),
        patch.order_index,
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn notepad_set_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: NoteStatus,
    dispatch_target: Option<String>,
    dispatch_key: Option<String>,
    fleet_session_id: Option<String>,
    result_json: Option<String>,
) -> Result<DevNote, AppError> {
    require_auth_sync(&state)?;
    // Restoring an archived note puts it back ON the pad, so it spends a slot
    // exactly the way a create does. Without this the cap is trivially defeated
    // by archiving ten notes and restoring them.
    if status == NoteStatus::Draft {
        guard_cap(&state)?;
    }
    repo::set_status(
        &state.db,
        &id,
        status,
        dispatch_target.as_deref(),
        dispatch_key.as_deref(),
        fleet_session_id.as_deref(),
        result_json.as_deref(),
    )
}

#[tauri::command]
pub fn notepad_delete_note(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::delete_note(&state.db, &id)
}

#[tauri::command]
pub fn notepad_fork_note(state: State<'_, Arc<AppState>>, id: String) -> Result<DevNote, AppError> {
    require_auth_sync(&state)?;
    guard_cap(&state)?;
    repo::fork_note(&state.db, &id)
}

/// Run the run-ingest sweeper once, on demand.
///
/// The fleet stale ticker already calls the same door every 30 s; this exists
/// so the pad can ask "is it back yet?" the moment the operator looks at it,
/// instead of the answer depending on where in the tick they landed. Both paths
/// go through the same idempotent core.
#[tauri::command]
pub fn notepad_ingest_runs(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<NotepadIngestReport, AppError> {
    require_auth_sync(&state)?;
    let mut emit = |note_id: &str, status: NoteStatus| {
        if let Err(e) = app.emit(
            event_name::NOTEPAD_NOTE_CHANGED,
            serde_json::json!({ "noteId": note_id, "status": status.as_str() }),
        ) {
            tracing::warn!(event = event_name::NOTEPAD_NOTE_CHANGED, error = %e, "notepad: note-changed emit failed");
        }
    };
    Ok(sweep_notepad_runs_core(&state.db, &mut emit))
}
