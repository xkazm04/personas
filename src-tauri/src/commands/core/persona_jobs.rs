//! Tauri commands for the user-persona background-job framework.
//!
//! Mirrors the surface of the companion-side `companion_*` job
//! commands but operates on `persona_background_job` rows in the main
//! db pool. v1 ships one job kind: `memory_curation_run`.

use std::sync::Arc;

use tauri::State;

use crate::engine::persona_jobs::{self};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Instructions-length validation reuses the shared cap + check from
/// `commands::core::memories` (the same IPC boundary used by
/// review/reflect/team-reflect) so the limit can't drift out of sync
/// between enqueue-time and run-time.
use super::memories::validate_instructions;

/// Enqueue a memory-reflection run for a persona (Memory Engine v2 —
/// consolidate related/contradicting memories into durable insights with
/// provenance). Same async proposal-mode contract as curation: the worker
/// writes a `persona_memory_review_proposal` row the user applies or
/// discards. Unlike curation, reflection is strictly per-persona.
#[tauri::command]
pub fn enqueue_persona_memory_reflection(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    instructions: Option<String>,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    validate_instructions(instructions.as_deref())?;
    let mut params = serde_json::Map::new();
    params.insert(
        "persona_id".to_string(),
        serde_json::Value::String(persona_id.clone()),
    );
    if let Some(s) = instructions {
        params.insert("instructions".to_string(), serde_json::Value::String(s));
    }
    persona_jobs::enqueue(
        &state.db,
        persona_jobs::KIND_MEMORY_REFLECTION,
        &serde_json::Value::Object(params),
        Some(&persona_id),
    )
}

/// Enqueue a TEAM memory-reflection run: consolidate lessons held by
/// ≥2 members into team-shared insights (proposal-gated, same flow as
/// persona reflection). Returns the job id.
#[tauri::command]
pub fn enqueue_team_memory_reflection(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    instructions: Option<String>,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    validate_instructions(instructions.as_deref())?;
    let mut params = serde_json::Map::new();
    params.insert(
        "team_id".to_string(),
        serde_json::Value::String(team_id.clone()),
    );
    if let Some(s) = instructions {
        params.insert("instructions".to_string(), serde_json::Value::String(s));
    }
    persona_jobs::enqueue(
        &state.db,
        persona_jobs::KIND_TEAM_MEMORY_REFLECTION,
        &serde_json::Value::Object(params),
        None,
    )
}

// ── Curation schedule (F-CRON) ─────────────────────────────────────────

/// Set or update the per-persona curation schedule. cron_expr is a
/// 5-field cron expression (`minutes hours dom month dow`); parsed and
/// validated via `engine::cron::parse_cron` before persisting. The
/// scheduler tick (`engine::curation_scheduler::tick`) reads this
/// table every 60 seconds and enqueues a memory_curation_run job when
/// a persona is due to fire.
///
/// Pass an empty/whitespace cron_expr to delete the schedule (curation
/// disabled for this persona).
#[tauri::command]
pub fn set_persona_curation_schedule(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    cron_expr: String,
) -> Result<Option<crate::db::repos::core::curation_schedule::PersonaCurationSchedule>, AppError> {
    require_auth_sync(&state)?;
    let trimmed = cron_expr.trim();
    if trimmed.is_empty() {
        crate::db::repos::core::curation_schedule::delete(&state.db, &persona_id)?;
        return Ok(None);
    }
    crate::engine::cron::parse_cron(trimmed)
        .map_err(|e| AppError::Validation(format!("invalid cron expression: {e}")))?;
    let row = crate::db::repos::core::curation_schedule::upsert(&state.db, &persona_id, trimmed)?;
    Ok(Some(row))
}

/// Read the current curation schedule for a persona. Returns `None`
/// when no schedule is set (curation disabled for this persona).
#[tauri::command]
pub fn get_persona_curation_schedule(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<crate::db::repos::core::curation_schedule::PersonaCurationSchedule>, AppError> {
    require_auth_sync(&state)?;
    crate::db::repos::core::curation_schedule::get(&state.db, &persona_id)
}
