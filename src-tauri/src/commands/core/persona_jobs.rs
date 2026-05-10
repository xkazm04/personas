//! Tauri commands for the user-persona background-job framework.
//!
//! Mirrors the surface of the companion-side `companion_*` job
//! commands but operates on `persona_background_job` rows in the main
//! db pool. v1 ships one job kind: `memory_curation_run`.

use std::sync::Arc;

use tauri::State;

use crate::engine::persona_jobs::{self, BackgroundJob};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Maximum instructions length, mirrored from the IPC boundaries used
/// elsewhere (companion::consolidate, commands::core::memories) so an
/// over-length payload fails fast at enqueue time rather than at
/// worker dispatch.
const MAX_INSTRUCTIONS_CHARS: usize = 4096;

fn validate_instructions(s: Option<&str>) -> Result<(), AppError> {
    if let Some(s) = s {
        if s.chars().count() > MAX_INSTRUCTIONS_CHARS {
            return Err(AppError::Validation(format!(
                "instructions must be ≤{MAX_INSTRUCTIONS_CHARS} characters"
            )));
        }
    }
    Ok(())
}

/// Enqueue a memory-curation run for a persona (or workspace-wide if
/// `persona_id` is None). Returns the job id immediately; the worker
/// picks it up on the next ~5s tick, runs the LLM-driven review, and
/// writes a `persona_memory_review_proposal` row the user reviews via
/// `apply_persona_memory_review_proposal` /
/// `discard_persona_memory_review_proposal`.
///
/// Concept borrowed from Anthropic Managed Agents' dream pipeline —
/// async + immutable inputs + steerable + review-and-discard. Local
/// implementation: IPC + Tauri events + the `persona_background_job`
/// table.
#[tauri::command]
pub fn enqueue_persona_memory_curation(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    threshold: Option<i32>,
    instructions: Option<String>,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    validate_instructions(instructions.as_deref())?;
    let mut params = serde_json::Map::new();
    if let Some(ref pid) = persona_id {
        params.insert(
            "persona_id".to_string(),
            serde_json::Value::String(pid.clone()),
        );
    }
    if let Some(t) = threshold {
        params.insert(
            "threshold".to_string(),
            serde_json::Value::Number((t as i64).into()),
        );
    }
    if let Some(s) = instructions {
        params.insert("instructions".to_string(), serde_json::Value::String(s));
    }
    let params_value = serde_json::Value::Object(params);
    persona_jobs::enqueue(
        &state.db,
        persona_jobs::KIND_MEMORY_CURATION,
        &params_value,
        persona_id.as_deref(),
    )
}

#[tauri::command]
pub fn list_persona_jobs(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    only_unresolved: Option<bool>,
    limit: Option<u32>,
) -> Result<Vec<BackgroundJob>, AppError> {
    require_auth_sync(&state)?;
    persona_jobs::list(
        &state.db,
        persona_id.as_deref(),
        only_unresolved.unwrap_or(false),
        limit.unwrap_or(50),
    )
}

#[tauri::command]
pub fn get_persona_job(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<Option<BackgroundJob>, AppError> {
    require_auth_sync(&state)?;
    persona_jobs::get(&state.db, &job_id)
}

/// Request cancellation of a `queued` or `running` job. Returns true
/// if the job transitioned to `canceled` (queued path) or had its
/// `cancel_requested` flag set (running path). Returns false on
/// already-terminal jobs.
#[tauri::command]
pub fn cancel_persona_job(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    persona_jobs::request_cancel(&state.db, &job_id)
}
