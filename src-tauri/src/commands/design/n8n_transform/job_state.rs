use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::background_job::BackgroundJobManager;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

use super::types::N8nPersonaOutput;

// -- N8n transform extra state ----------------------------------

#[derive(Clone, Default)]
pub struct N8nTransformExtra {
    pub draft: Option<serde_json::Value>,
    pub claude_session_id: Option<String>,
    pub questions: Option<serde_json::Value>,
    /// Streaming sections accumulated during section-by-section transform.
    pub sections: Vec<serde_json::Value>,
    /// The session ID this transform belongs to (for concurrency guard).
    pub session_id: Option<String>,
}

/// N8n transform-specific extras flattened into BackgroundTaskSnapshot.
#[derive(Clone, Serialize)]
pub struct N8nTransformSnapshotExtras {
    transform_id: String,
    draft: Option<serde_json::Value>,
    questions: Option<serde_json::Value>,
    /// Streaming sections accumulated during section-by-section transform.
    sections: Vec<serde_json::Value>,
}

/// Full snapshot type alias for convenience.
pub type N8nTransformSnapshot = crate::background_job::BackgroundTaskSnapshot<N8nTransformSnapshotExtras>;

static N8N_JOBS: BackgroundJobManager<N8nTransformExtra> = BackgroundJobManager::new(
    "n8n transform job lock poisoned",
    "n8n-transform-status",
    "n8n-transform-output",
);

/// Access the underlying manager (used by cli_runner for insert_running, etc.)
pub fn manager() -> &'static BackgroundJobManager<N8nTransformExtra> {
    &N8N_JOBS
}

// -- Public helpers (thin wrappers preserving existing API) ------

pub fn set_n8n_transform_status(
    app: &tauri::AppHandle,
    transform_id: &str,
    status: &str,
    error: Option<String>,
) {
    N8N_JOBS.set_status(app, transform_id, status, error);
}

pub fn emit_n8n_transform_line(app: &tauri::AppHandle, transform_id: &str, line: impl Into<String>) {
    N8N_JOBS.emit_line(app, transform_id, line);
}

pub fn set_n8n_transform_draft(transform_id: &str, draft: &N8nPersonaOutput) {
    match serde_json::to_value(draft) {
        Ok(serialized) => {
            N8N_JOBS.update_extra(transform_id, |extra| {
                extra.draft = Some(serialized);
            });
        }
        Err(e) => {
            tracing::error!(transform_id = %transform_id, error = %e, "Failed to serialize n8n draft");
        }
    }
}

pub fn get_n8n_transform_snapshot_internal(transform_id: &str) -> Option<N8nTransformSnapshot> {
    N8N_JOBS.get_task_snapshot(transform_id, |extra| N8nTransformSnapshotExtras {
        transform_id: transform_id.to_string(),
        draft: extra.draft.clone(),
        questions: extra.questions.clone(),
        sections: extra.sections.clone(),
    })
}

/// Store a streaming section in the job state.
/// (The frontend retrieves sections via snapshot polling, not direct events.)
pub fn store_n8n_transform_section(
    transform_id: &str,
    section: serde_json::Value,
) {
    N8N_JOBS.update_extra(transform_id, |extra| {
        extra.sections.push(section);
    });
}

/// Clear streaming sections (called at start of new sectioned transform).
pub fn clear_n8n_transform_sections(transform_id: &str) {
    N8N_JOBS.update_extra(transform_id, |extra| {
        extra.sections.clear();
    });
}

pub fn set_n8n_transform_questions(transform_id: &str, questions: serde_json::Value) {
    N8N_JOBS.update_extra(transform_id, |extra| {
        extra.questions = Some(questions);
    });
}

pub fn set_n8n_transform_claude_session(transform_id: &str, session_id: String) {
    N8N_JOBS.update_extra(transform_id, |extra| {
        extra.claude_session_id = Some(session_id);
    });
}

pub fn get_n8n_transform_claude_session(transform_id: &str) -> Option<String> {
    N8N_JOBS.read_extra(transform_id, |extra| extra.claude_session_id.clone())?
}

/// List all n8n transform job snapshots (for unified workflows view).
pub fn list_n8n_transform_jobs() -> Vec<crate::background_job::JobSnapshot> {
    N8N_JOBS.list_snapshots()
}

// -- Tauri commands for job state --------------------------------

#[tauri::command]
pub fn get_n8n_transform_snapshot(
    state: State<'_, Arc<AppState>>,
    transform_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let snapshot = get_n8n_transform_snapshot_internal(&transform_id)
        .ok_or_else(|| AppError::NotFound("n8n transform not found".into()))?;
    Ok(serde_json::to_value(snapshot).unwrap_or_else(|_| serde_json::json!({})))
}

#[tauri::command]
pub fn clear_n8n_transform_snapshot(
    state: State<'_, Arc<AppState>>,
    transform_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    N8N_JOBS.remove(&transform_id)
}

#[tauri::command]
pub fn cancel_n8n_transform(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    transform_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    N8N_JOBS.cancel_or_preempt(&app, &transform_id, N8nTransformExtra::default())
}
