use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreateTemplateFeedbackInput, TemplateFeedback, TemplatePerformance};
use crate::db::repos::communication::template_feedback as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn create_template_feedback(
    state: State<'_, Arc<AppState>>,
    review_id: String,
    persona_id: String,
    execution_id: Option<String>,
    rating: String,
    labels: Vec<String>,
    comment: Option<String>,
    source: Option<String>,
) -> Result<TemplateFeedback, AppError> {
    require_auth_sync(&state)?;
    repo::create(
        &state.db,
        CreateTemplateFeedbackInput {
            review_id,
            persona_id,
            execution_id,
            rating,
            labels,
            comment,
            source: source.unwrap_or_else(|| "user".to_string()),
        },
    )
}

#[tauri::command]
pub fn list_template_feedback(
    state: State<'_, Arc<AppState>>,
    review_id: String,
    limit: Option<i64>,
) -> Result<Vec<TemplateFeedback>, AppError> {
    require_auth_sync(&state)?;
    repo::list_for_review(&state.db, &review_id, limit)
}

#[tauri::command]
pub fn get_template_performance(
    state: State<'_, Arc<AppState>>,
    review_id: String,
) -> Result<TemplatePerformance, AppError> {
    require_auth_sync(&state)?;
    repo::get_performance(&state.db, &review_id)
}
