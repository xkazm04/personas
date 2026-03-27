use std::sync::Arc;

use tauri::State;

use serde::Deserialize;
use ts_rs::TS;

use crate::db::models::{CreateN8nSessionInput, N8nSessionSummary, N8nTransformSession, SessionStatus, UpdateN8nSessionInput};
use crate::db::repos::resources::n8n_sessions as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Single-struct parameter for the `update_n8n_session` command,
/// replacing 11 individual arguments.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdateN8nSessionParams {
    pub id: String,
    pub workflow_name: Option<String>,
    pub status: Option<SessionStatus>,
    pub parser_result: Option<Option<String>>,
    pub draft_json: Option<Option<String>>,
    pub user_answers: Option<Option<String>>,
    pub step: Option<String>,
    pub error: Option<Option<String>>,
    pub persona_id: Option<Option<String>>,
    pub transform_id: Option<Option<String>>,
    pub questions_json: Option<Option<String>>,
}

/// Maximum raw workflow JSON size allowed in session storage (10 MB),
/// consistent with the transform payload limit in cli_runner.rs.
const MAX_WORKFLOW_JSON_BYTES: usize = 10 * 1024 * 1024;

#[tauri::command]
pub async fn create_n8n_session(
    state: State<'_, Arc<AppState>>,
    workflow_name: String,
    raw_workflow_json: String,
    step: String,
    status: SessionStatus,
) -> Result<N8nTransformSession, AppError> {
    require_auth(&state).await?;
    if raw_workflow_json.len() > MAX_WORKFLOW_JSON_BYTES {
        return Err(AppError::Validation(
            "Workflow JSON too large (>10 MB). Use a smaller workflow export.".into(),
        ));
    }

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
    require_auth(&state).await?;
    repo::get(&state.db, &id)
}

#[tauri::command]
pub async fn list_n8n_sessions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<N8nTransformSession>, AppError> {
    require_auth(&state).await?;
    repo::list(&state.db)
}

#[tauri::command]
pub async fn list_n8n_session_summaries(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<N8nSessionSummary>, AppError> {
    require_auth(&state).await?;
    repo::list_summaries(&state.db)
}

#[tauri::command]
pub async fn update_n8n_session(
    state: State<'_, Arc<AppState>>,
    params: UpdateN8nSessionParams,
) -> Result<N8nTransformSession, AppError> {
    require_auth(&state).await?;
    repo::update(
        &state.db,
        &params.id,
        &UpdateN8nSessionInput {
            workflow_name: params.workflow_name,
            status: params.status,
            parser_result: params.parser_result,
            draft_json: params.draft_json,
            user_answers: params.user_answers,
            step: params.step,
            error: params.error,
            persona_id: params.persona_id,
            transform_id: params.transform_id,
            questions_json: params.questions_json,
        },
    )
}

#[tauri::command]
pub async fn delete_n8n_session(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    repo::delete(&state.db, &id)
}
