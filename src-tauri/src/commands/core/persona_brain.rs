//! Tauri commands for the living-agent persona brain (spark WP4; manifest
//! rebase WP1): episodic record reads, the manifest surface, the Brain
//! dashboard, and the consolidation trigger.
//!
//! Thin adapters by doctrine — auth, one engine/repo call, map. The apply
//! path for `self_model_diff` proposals deliberately does NOT live here: it
//! is a branch inside the existing `apply_persona_memory_review_proposal`
//! command (`commands::core::memories`), so every proposal family shares one
//! human gate.
//!
//! The manifest and dashboard commands touch rusqlite AND the filesystem, so
//! they are async over `spawn_blocking` rather than sync on the IPC worker.

use std::sync::Arc;

use tauri::State;

use crate::companion::brain::identity::IdentityDiff;
use crate::db::models::{
    AttentionLoopStatus, PersonaBrainDashboard, PersonaEpisode, PersonaManifestView,
};
use crate::db::repos::core::attention_ledger;
use crate::db::repos::core::episodes as episodes_repo;
use crate::engine::autonomy;
use crate::engine::persona_brain::{dashboard, manifest};
use crate::engine::persona_jobs;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

/// Run a blocking brain read/write off the IPC worker.
async fn blocking<T, F>(what: &'static str, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("{what}: task failed: {e}")))?
}

/// A manifest write changed `personas.core_profile` (the mirror): drop the
/// cached engine session so the next run assembles against the new text —
/// the same invalidation `update_persona` performs.
fn invalidate_session(state: &Arc<AppState>, persona_id: &str) {
    let pool = state.session_pool.clone();
    let pid = persona_id.to_string();
    tauri::async_runtime::spawn(async move {
        pool.invalidate(&pid).await;
    });
}

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

/// The attention loop's global switch (`autonomous_attention_loop`) plus a
/// fleet-wide ledger aggregate for the Overview status tile: the newest pass
/// overall and today's dispatched / refused / consolidation counts.
#[tauri::command]
pub fn get_attention_loop_status(
    state: State<'_, Arc<AppState>>,
) -> Result<AttentionLoopStatus, AppError> {
    require_auth_sync(&state)?;
    let enabled = autonomy::global_enabled(&state.db, autonomy::Action::AttentionLoop);
    let summary = attention_ledger::summary_today(&state.db)?;
    Ok(AttentionLoopStatus { enabled, summary })
}

/// The persona's current manifest text (`manifest.md`), or `None` when it has
/// never been seeded. Legacy name kept for the Life tab's read-only panel;
/// [`get_persona_manifest`] is the editor's door and seeds on first access.
#[tauri::command]
pub fn get_persona_identity(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<String>, AppError> {
    require_auth_sync(&state)?;
    Ok(manifest::read(&persona_id))
}

/// The persona's manifest, seeded (or migrated from `identity.md`) on first
/// access, with the law / self-model section map and the count of
/// `self_model_diff` proposals awaiting review.
#[tauri::command]
pub async fn get_persona_manifest(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<PersonaManifestView, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let pid = persona_id.clone();
    let view = blocking("get_persona_manifest", move || manifest::view(&db, &pid)).await?;
    // A first access seeds → mirrors → the prompt changed.
    invalidate_session(&state, &persona_id);
    Ok(view)
}

/// Operator door for the LAW sections: replace one section's body
/// (`Mandate` | `Boundaries` | `Operation defaults`) on disk and refresh the
/// `core_profile` mirror. Any other heading is a typed validation refusal.
#[tauri::command]
pub async fn update_persona_manifest_law(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    section: String,
    content: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let pid = persona_id.clone();
    blocking("update_persona_manifest_law", move || {
        manifest::update_law(&db, &pid, &section, &content)
    })
    .await?;
    invalidate_session(&state, &persona_id);
    Ok(())
}

/// The Brain dashboard: memory tiers and categories, 30 days of episode
/// activity, the consolidation history, the pressure gauge and the anomaly
/// strip, plus per-charter coverage.
#[tauri::command]
pub async fn get_persona_brain_dashboard(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<PersonaBrainDashboard, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    blocking("get_persona_brain_dashboard", move || {
        dashboard::build(&db, &persona_id)
    })
    .await
}

/// File anchored self-model diffs as a `self_model_diff` proposal (NEVER
/// applies — a human decides through `apply_persona_memory_review_proposal`).
/// `diffs_json` is a JSON array of `{section, op, anchor_text?, new_text?}`;
/// a diff aimed at a law section is refused. Returns the proposal id.
#[tauri::command]
pub fn propose_persona_manifest_diffs(
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
    manifest::propose_diffs(&state.db, &persona_id, diffs, &rationale)
}
