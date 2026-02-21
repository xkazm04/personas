use std::sync::Arc;

use tauri::State;

use crate::db::models::{CreateN8nSessionInput, N8nTransformSession, UpdateN8nSessionInput};
use crate::db::repos::resources::n8n_sessions as repo;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub async fn create_n8n_session(
    state: State<'_, Arc<AppState>>,
    workflow_name: String,
    raw_workflow_json: String,
    step: String,
    status: String,
) -> Result<N8nTransformSession, AppError> {
    repo::create(
        &state.db,
        &CreateN8nSessionInput {
            workflow_name,
            raw_workflow_json,
            step,
            status,
        },
    )
}

#[tauri::command]
pub async fn get_n8n_session(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<N8nTransformSession, AppError> {
    repo::get(&state.db, &id)
}

#[tauri::command]
pub async fn list_n8n_sessions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<N8nTransformSession>, AppError> {
    repo::list(&state.db)
}

#[tauri::command]
pub async fn update_n8n_session(
    state: State<'_, Arc<AppState>>,
    id: String,
    workflow_name: Option<String>,
    status: Option<String>,
    parser_result: Option<Option<String>>,
    draft_json: Option<Option<String>>,
    user_answers: Option<Option<String>>,
    step: Option<String>,
    error: Option<Option<String>>,
    persona_id: Option<Option<String>>,
) -> Result<N8nTransformSession, AppError> {
    repo::update(
        &state.db,
        &id,
        &UpdateN8nSessionInput {
            workflow_name,
            status,
            parser_result,
            draft_json,
            user_answers,
            step,
            error,
            persona_id,
        },
    )
}

#[tauri::command]
pub async fn delete_n8n_session(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}
