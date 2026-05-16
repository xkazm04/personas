use std::sync::Arc;
use tauri::State;

use crate::db::models::ExecutionAnnotation;
use crate::db::repos::execution::annotations as repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

const DEFAULT_AUTHOR: &str = "user";

/// Upsert an annotation on an execution. Tags, note, and starred are saved
/// together — passing an empty `tags` vec + `None` note + `starred=false`
/// effectively clears the annotation (or use `delete_annotation` to remove
/// the row entirely).
#[tauri::command]
pub fn add_annotation(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
    caller_persona_id: String,
    tags: Vec<String>,
    note: Option<String>,
    starred: bool,
    author: Option<String>,
) -> Result<ExecutionAnnotation, AppError> {
    require_auth_sync(&state)?;
    // Verify the execution belongs to the caller persona before writing.
    let exec = exec_repo::get_by_id(&state.db, &execution_id)?;
    if exec.persona_id != caller_persona_id {
        return Err(AppError::Auth(
            "Execution does not belong to the specified persona".into(),
        ));
    }
    let author = author.unwrap_or_else(|| DEFAULT_AUTHOR.to_string());
    repo::upsert(
        &state.db,
        &execution_id,
        &caller_persona_id,
        &author,
        &tags,
        note.as_deref(),
        starred,
    )
}

#[tauri::command]
pub fn list_execution_annotations(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
    caller_persona_id: String,
) -> Result<Vec<ExecutionAnnotation>, AppError> {
    require_auth_sync(&state)?;
    let exec = exec_repo::get_by_id(&state.db, &execution_id)?;
    if exec.persona_id != caller_persona_id {
        return Err(AppError::Auth(
            "Execution does not belong to the specified persona".into(),
        ));
    }
    repo::list_by_execution(&state.db, &execution_id)
}

#[tauri::command]
pub fn list_persona_annotations(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<ExecutionAnnotation>, AppError> {
    require_auth_sync(&state)?;
    repo::list_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn delete_annotation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}
