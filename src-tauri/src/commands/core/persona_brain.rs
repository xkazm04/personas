//! Tauri commands for the living-agent persona brain (spark WP4): episodic
//! record reads, the self-model surface, and the consolidation trigger.
//!
//! Thin adapters by doctrine — auth, one engine/repo call, map. The apply
//! path for `self_model_diff` proposals deliberately does NOT live here: it
//! is a branch inside the existing `apply_persona_memory_review_proposal`
//! command (`commands::core::memories`), so every proposal family shares one
//! human gate.

use std::sync::Arc;

use tauri::State;

use crate::companion::brain::identity::IdentityDiff;
use crate::db::models::PersonaEpisode;
use crate::db::repos::core::episodes as episodes_repo;
use crate::engine::persona_brain::identity;
use crate::engine::persona_jobs;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Enqueue a FORCED sleep-consolidation job for one persona. Force bypasses
/// pressure/floor/staleness — never the per-persona single-flight guard.
/// Returns the background-job id; progress and verdicts land in
/// `persona_attention_ledger`.
#[tauri::command]
pub fn run_persona_consolidation_now(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    // Validates the persona exists before parking a job that would fail late.
    crate::db::repos::core::personas::get_by_id(&state.db, &persona_id)?;
    persona_jobs::enqueue(
        &state.db,
        persona_jobs::KIND_SLEEP_CONSOLIDATION,
        &serde_json::json!({ "personaId": persona_id, "force": true }),
        Some(&persona_id),
    )
}

/// A persona's episodic record, newest first, keyset-paginated: pass BOTH
/// `before_created_at` and `before_id` (the last row of the prior page) to
/// continue; omit both for the first page.
#[tauri::command]
pub fn list_persona_episodes(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    before_created_at: Option<String>,
    before_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<PersonaEpisode>, AppError> {
    require_auth_sync(&state)?;
    let limit = limit.unwrap_or(50).clamp(1, 200) as u32;
    match (before_created_at.as_deref(), before_id.as_deref()) {
        (Some(created_at), Some(id)) => {
            episodes_repo::list_before(&state.db, &persona_id, created_at, id, limit)
        }
        (None, None) => episodes_repo::list_recent(&state.db, &persona_id, limit),
        _ => Err(AppError::Validation(
            "keyset cursor needs BOTH before_created_at and before_id (or neither)".into(),
        )),
    }
}

/// The persona's current self-model (`identity.md`), or `None` when it has
/// never been seeded.
#[tauri::command]
pub fn get_persona_identity(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<String>, AppError> {
    require_auth_sync(&state)?;
    Ok(identity::read(&persona_id))
}

/// File anchored self-model diffs as a `self_model_diff` proposal (NEVER
/// applies — a human decides through `apply_persona_memory_review_proposal`).
/// `diffs_json` is a JSON array of `{section, op, anchor_text?, new_text?}`.
/// Returns the proposal id.
#[tauri::command]
pub fn propose_persona_identity_diffs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    diffs_json: String,
    rationale: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    crate::db::repos::core::personas::get_by_id(&state.db, &persona_id)?;
    let raw: Vec<serde_json::Value> = serde_json::from_str(&diffs_json)
        .map_err(|e| AppError::Validation(format!("diffs_json is not a JSON array: {e}")))?;
    let diffs = raw
        .iter()
        .map(IdentityDiff::from_json)
        .collect::<Result<Vec<_>, _>>()?;
    identity::propose_diffs(&state.db, &persona_id, diffs, &rationale)
}
