use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::Serialize;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

use super::types::N8nPersonaOutput;

// ── Event payloads ──────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct N8nTransformOutputEvent {
    transform_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct N8nTransformStatusEvent {
    transform_id: String,
    status: String,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct N8nTransformSnapshot {
    transform_id: String,
    status: String,
    error: Option<String>,
    lines: Vec<String>,
    draft: Option<serde_json::Value>,
    questions: Option<serde_json::Value>,
}

const JOB_TTL_SECS: u64 = 30 * 60; // 30 minutes

#[derive(Clone)]
pub struct N8nTransformJobState {
    pub status: String,
    pub error: Option<String>,
    pub lines: Vec<String>,
    pub draft: Option<serde_json::Value>,
    pub cancel_token: Option<CancellationToken>,
    pub claude_session_id: Option<String>,
    pub questions: Option<serde_json::Value>,
    pub created_at: Instant,
}

impl Default for N8nTransformJobState {
    fn default() -> Self {
        Self {
            status: String::new(),
            error: None,
            lines: Vec::new(),
            draft: None,
            cancel_token: None,
            claude_session_id: None,
            questions: None,
            created_at: Instant::now(),
        }
    }
}

static N8N_TRANSFORM_JOBS: OnceLock<Mutex<HashMap<String, N8nTransformJobState>>> = OnceLock::new();

fn n8n_transform_jobs() -> &'static Mutex<HashMap<String, N8nTransformJobState>> {
    N8N_TRANSFORM_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn lock_jobs() -> Result<std::sync::MutexGuard<'static, HashMap<String, N8nTransformJobState>>, AppError> {
    n8n_transform_jobs()
        .lock()
        .map_err(|_| AppError::Internal("n8n transform job lock poisoned".into()))
}

/// Remove non-running job entries older than `JOB_TTL_SECS`.
/// Called on each new job insert to prevent unbounded memory growth.
pub fn evict_stale_n8n_jobs(jobs: &mut HashMap<String, N8nTransformJobState>) {
    let cutoff = std::time::Duration::from_secs(JOB_TTL_SECS);
    jobs.retain(|_, job| job.status == "running" || job.created_at.elapsed() < cutoff);
}

pub fn set_n8n_transform_status(
    app: &tauri::AppHandle,
    transform_id: &str,
    status: &str,
    error: Option<String>,
) {
    if let Ok(mut jobs) = lock_jobs() {
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        entry.status = status.to_string();
        entry.error = error.clone();
    }

    let _ = app.emit(
        "n8n-transform-status",
        N8nTransformStatusEvent {
            transform_id: transform_id.to_string(),
            status: status.to_string(),
            error,
        },
    );
}

pub fn emit_n8n_transform_line(app: &tauri::AppHandle, transform_id: &str, line: impl Into<String>) {
    let line = line.into();
    if let Ok(mut jobs) = lock_jobs() {
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        // Cap stored lines at 500 to prevent unbounded memory growth
        if entry.lines.len() < 500 {
            entry.lines.push(line.clone());
        }
    }

    let _ = app.emit(
        "n8n-transform-output",
        N8nTransformOutputEvent {
            transform_id: transform_id.to_string(),
            line,
        },
    );
}

pub fn set_n8n_transform_draft(transform_id: &str, draft: &N8nPersonaOutput) {
    match serde_json::to_value(draft) {
        Ok(serialized) => {
            if let Ok(mut jobs) = lock_jobs() {
                let entry = jobs
                    .entry(transform_id.to_string())
                    .or_insert_with(N8nTransformJobState::default);
                entry.draft = Some(serialized);
            }
        }
        Err(e) => {
            tracing::error!(transform_id = %transform_id, error = %e, "Failed to serialize n8n draft");
        }
    }
}

pub fn get_n8n_transform_snapshot_internal(transform_id: &str) -> Option<N8nTransformSnapshot> {
    let jobs = lock_jobs().ok()?;
    jobs.get(transform_id).map(|job| N8nTransformSnapshot {
        transform_id: transform_id.to_string(),
        status: if job.status.is_empty() {
            "idle".to_string()
        } else {
            job.status.clone()
        },
        error: job.error.clone(),
        lines: job.lines.clone(),
        draft: job.draft.clone(),
        questions: job.questions.clone(),
    })
}

pub fn set_n8n_transform_questions(transform_id: &str, questions: serde_json::Value) {
    if let Ok(mut jobs) = lock_jobs() {
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        entry.questions = Some(questions);
    }
}

pub fn set_n8n_transform_claude_session(transform_id: &str, session_id: String) {
    if let Ok(mut jobs) = lock_jobs() {
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        entry.claude_session_id = Some(session_id);
    }
}

pub fn get_n8n_transform_claude_session(transform_id: &str) -> Option<String> {
    let jobs = lock_jobs().ok()?;
    jobs.get(transform_id)?.claude_session_id.clone()
}

// ── Tauri commands for job state ────────────────────────────────

#[tauri::command]
pub fn get_n8n_transform_snapshot(transform_id: String) -> Result<serde_json::Value, AppError> {
    let snapshot = get_n8n_transform_snapshot_internal(&transform_id)
        .ok_or_else(|| AppError::NotFound("n8n transform not found".into()))?;
    Ok(serde_json::to_value(snapshot).unwrap_or_else(|_| serde_json::json!({})))
}

#[tauri::command]
pub fn clear_n8n_transform_snapshot(transform_id: String) -> Result<(), AppError> {
    let mut jobs = lock_jobs()?;
    jobs.remove(&transform_id);
    Ok(())
}

#[tauri::command]
pub fn cancel_n8n_transform(
    app: tauri::AppHandle,
    transform_id: String,
) -> Result<(), AppError> {
    let token = {
        let mut jobs = lock_jobs()?;
        if let Some(job) = jobs.get_mut(&transform_id) {
            job.cancel_token.clone()
        } else {
            // Job doesn't exist yet. Create a cancelled token and insert it
            // to prevent a race condition where start_n8n_transform_background
            // hasn't inserted the job yet.
            let token = tokio_util::sync::CancellationToken::new();
            token.cancel();
            jobs.insert(
                transform_id.clone(),
                N8nTransformJobState {
                    status: "failed".into(),
                    error: Some("Cancelled by user".into()),
                    lines: Vec::new(),
                    draft: None,
                    cancel_token: Some(token.clone()),
                    claude_session_id: None,
                    questions: None,
                    created_at: std::time::Instant::now(),
                },
            );
            Some(token)
        }
    };

    if let Some(token) = token {
        token.cancel();
    }

    set_n8n_transform_status(&app, &transform_id, "failed", Some("Cancelled by user".into()));
    Ok(())
}
