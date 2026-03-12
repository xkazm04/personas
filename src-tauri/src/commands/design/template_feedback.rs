use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreateTemplateFeedbackInput, TemplateFeedback, TemplatePerformance};
use crate::db::repos::communication::template_feedback as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

const ALLOWED_LABELS: &[&str] = &[
    "accurate_prompt",
    "good_tool_selection",
    "reliable",
    "cost_efficient",
    "wrong_tools",
    "poor_instructions",
    "missing_context",
    "over_engineered",
    "under_specified",
    "wrong_triggers",
    "credential_issues",
];

const ALLOWED_RATINGS: &[&str] = &["positive", "negative", "neutral"];

const MAX_LABELS: usize = 10;
const MAX_LABEL_LEN: usize = 50;
const MAX_COMMENT_LEN: usize = 2000;

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

    if !ALLOWED_RATINGS.contains(&rating.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid rating '{}'. Allowed: {}",
            rating,
            ALLOWED_RATINGS.join(", ")
        )));
    }

    if labels.len() > MAX_LABELS {
        return Err(AppError::Validation(format!(
            "Too many labels ({}). Maximum is {}",
            labels.len(),
            MAX_LABELS
        )));
    }

    for label in &labels {
        if label.len() > MAX_LABEL_LEN {
            return Err(AppError::Validation(format!(
                "Label '{}...' exceeds maximum length of {} characters",
                &label[..MAX_LABEL_LEN.min(label.len())],
                MAX_LABEL_LEN
            )));
        }
        if !ALLOWED_LABELS.contains(&label.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid label '{}'. Allowed: {}",
                label,
                ALLOWED_LABELS.join(", ")
            )));
        }
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
