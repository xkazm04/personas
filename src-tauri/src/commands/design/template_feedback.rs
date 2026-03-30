use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreateTemplateFeedbackInput, FeedbackLabel, FeedbackRating, TemplateFeedback, TemplatePerformance};
use crate::db::repos::communication::template_feedback as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

const MAX_LABELS: usize = 10;
const MAX_COMMENT_LEN: usize = 2000;
const MAX_LIST_LIMIT: i64 = 200;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_template_feedback(
    state: State<'_, Arc<AppState>>,
    review_id: String,
    persona_id: String,
    execution_id: Option<String>,
    rating: FeedbackRating,
    labels: Vec<FeedbackLabel>,
    comment: Option<String>,
    source: Option<String>,
) -> Result<TemplateFeedback, AppError> {
    require_auth_sync(&state)?;

    // Rating and label validity is enforced by enum deserialization —
    // invalid values from the frontend will fail before reaching this point.

    if labels.len() > MAX_LABELS {
        return Err(AppError::Validation(format!(
            "Too many labels ({}). Maximum is {}",
            labels.len(),
            MAX_LABELS
        )));
    }

    if let Some(ref c) = comment {
        if c.len() > MAX_COMMENT_LEN {
            return Err(AppError::Validation(format!(
                "Comment exceeds maximum length of {} characters",
                MAX_COMMENT_LEN
            )));
        }
    }

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
    let limit = limit.map(|l| l.clamp(1, MAX_LIST_LIMIT));
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
