//! Tauri commands for memory consolidation + reflection.
//!
//! Two pipelines:
//!   1. **Consolidation** — read recent episodes, propose semantic-fact
//!      diffs, persist as `companion_consolidation_item` rows. User
//!      reviews each item before it lands.
//!   2. **Reflection** — short prose journal entry summarizing recent
//!      themes/patterns. Lower stakes than consolidation; just writes a
//!      markdown file under `reflections/`.
//!
//! Both share the one-shot Claude CLI invocation pattern: spawn a fresh
//! `claude --print` (no `--resume`) so neither contaminates Athena's
//! main chat session.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::companion::brain::{consolidation, dashboard, reflection};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

// ── Consolidation ───────────────────────────────────────────────────────

/// Run a consolidation pass synchronously (the command awaits the CLI
/// call). On success returns the new run id; the UI follows up with
/// `companion_get_consolidation_items` to render the diff.
///
/// Long-running — the user's UI shows a spinner. A timeout of 5 minutes
/// is enforced inside the brain module.
#[tauri::command]
pub async fn companion_run_consolidation(
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    ipc_auth::require_auth(&state).await?;
    consolidation::run_consolidation(&state.user_db).await
}

#[tauri::command]
pub fn companion_list_consolidation_runs(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<consolidation::ConsolidationSummary>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    consolidation::list_runs(&state.user_db, limit.unwrap_or(20))
}

#[tauri::command]
pub fn companion_get_consolidation_items(
    state: State<'_, Arc<AppState>>,
    consolidation_id: String,
) -> Result<Vec<consolidation::ConsolidationItem>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    consolidation::list_items(&state.user_db, &consolidation_id)
}

/// Optional edit overrides — UI sends only the fields the user changed.
/// Unset fields fall back to the original proposal.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyEdits {
    pub value: Option<String>,
    pub key: Option<String>,
    pub scope: Option<String>,
    pub importance: Option<i32>,
    pub confidence: Option<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    pub item_id: String,
    pub fact_id: String,
}

#[tauri::command]
pub async fn companion_apply_consolidation_item(
    state: State<'_, Arc<AppState>>,
    item_id: String,
    edits: Option<ApplyEdits>,
) -> Result<ApplyOutcome, AppError> {
    ipc_auth::require_auth(&state).await?;
    let edits = edits.unwrap_or_default();
    let edits = consolidation::ItemEdits {
        value: edits.value,
        key: edits.key,
        scope: edits.scope,
        importance: edits.importance,
        confidence: edits.confidence,
    };
    let fact_id = {
        #[cfg(feature = "ml")]
        {
            consolidation::apply_item(
                &state.user_db,
                state.embedding_manager.as_ref(),
                &item_id,
                &edits,
            )
            .await?
        }
        #[cfg(not(feature = "ml"))]
        {
            consolidation::apply_item(&state.user_db, &item_id, &edits).await?
        }
    };
    Ok(ApplyOutcome { item_id, fact_id })
}

#[tauri::command]
pub fn companion_reject_consolidation_item(
    state: State<'_, Arc<AppState>>,
    item_id: String,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    consolidation::reject_item(&state.user_db, &item_id)
}

/// Apply importance decay to facts that haven't been recalled in a
/// while. Returns the number of facts that lost importance. The UI
/// surfaces this from the bulk-actions toolbar.
#[tauri::command]
pub fn companion_decay_unused_facts(state: State<'_, Arc<AppState>>) -> Result<i64, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    consolidation::decay_unused_facts(&state.user_db)
}

// ── Reflection ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionRow {
    pub id: String,
    pub preview: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionDetail {
    pub id: String,
    pub body: String,
    pub created_at: String,
}

/// Generate and persist a reflection. Returns the new node id; the UI
/// switches to the detail view immediately to show the result.
#[tauri::command]
pub async fn companion_run_reflection(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    ipc_auth::require_auth(&state).await?;
    reflection::run_reflection(&state.user_db).await
}

#[tauri::command]
pub fn companion_list_reflections(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<ReflectionRow>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let rows = reflection::list_reflections(&state.user_db, limit.unwrap_or(50))?;
    Ok(rows
        .into_iter()
        .map(|r| ReflectionRow {
            id: r.id,
            preview: r.preview,
            created_at: r.created_at,
        })
        .collect())
}

#[tauri::command]
pub fn companion_get_reflection(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<ReflectionDetail, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let r = reflection::read_reflection(&state.user_db, &id)?;
    Ok(ReflectionDetail {
        id: r.id,
        body: r.body,
        created_at: r.created_at,
    })
}

// ── Dashboard (Phase F) ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSpec {
    /// JSON spec the frontend parses into widgets. Stored verbatim so
    /// composition shape can evolve without a backend migration.
    pub spec_json: String,
    pub updated_at: String,
}

/// Read the current dashboard composition (singleton). Returns null
/// when Athena hasn't composed one yet — the UI shows an empty state.
#[tauri::command]
pub fn companion_get_dashboard(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<DashboardSpec>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let d = dashboard::load_dashboard(&state.user_db)?;
    Ok(d.map(|d| DashboardSpec {
        spec_json: d.spec_json,
        updated_at: d.updated_at,
    }))
}
