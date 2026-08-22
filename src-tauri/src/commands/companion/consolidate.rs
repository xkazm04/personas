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

use crate::companion::brain::{
    cockpit, consolidation, cycle_report, dashboard, reflection, sleep_cycle,
};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

// ── Consolidation ───────────────────────────────────────────────────────

/// Maximum instructions length in characters. Mirrors Anthropic Managed
/// Agents' dream `instructions` cap; large enough for a paragraph of
/// guidance, small enough to prevent operators from stuffing whole
/// prompts into the steering field.
pub(crate) const MAX_INSTRUCTIONS_CHARS: usize = 4096;

/// Validate optional instructions length at the IPC boundary. Returns
/// `AppError::Validation` if `Some` and exceeds `MAX_INSTRUCTIONS_CHARS`.
/// Empty/whitespace strings are accepted (the prompt-assembly layer
/// trims and skips empties).
pub(crate) fn validate_instructions(s: Option<&str>) -> Result<(), AppError> {
    if let Some(s) = s {
        if s.chars().count() > MAX_INSTRUCTIONS_CHARS {
            return Err(AppError::Validation(format!(
                "instructions must be ≤{MAX_INSTRUCTIONS_CHARS} characters"
            )));
        }
    }
    Ok(())
}

/// Run a consolidation pass synchronously (the command awaits the CLI
/// call). On success returns the new run id; the UI follows up with
/// `companion_get_consolidation_items` to render the diff.
///
/// Long-running — the user's UI shows a spinner. A timeout of 5 minutes
/// is enforced inside the brain module.
///
/// `instructions` is optional natural-language steering (≤4096 chars)
/// folded into the consolidation prompt. Concept borrowed from
/// Anthropic Managed Agents' dream `instructions` field, applied to
/// personas's existing curation pipeline.
#[tauri::command]
pub async fn companion_run_consolidation(
    state: State<'_, Arc<AppState>>,
    instructions: Option<String>,
) -> Result<String, AppError> {
    ipc_auth::require_auth(&state).await?;
    validate_instructions(instructions.as_deref())?;
    consolidation::run_consolidation(&state.user_db, instructions.as_deref()).await
}

#[tauri::command]
pub fn companion_list_consolidation_runs(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<consolidation::ConsolidationSummary>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    consolidation::list_runs(&state.user_db, limit.unwrap_or(20))
}

/// Run a sleep cycle now, without waiting for the pressure to build.
///
/// **Fire-and-forget.** A cycle is minutes of headless LLM work; blocking an
/// IPC call on it would hold a webview promise open for the duration and lose
/// the result to any reload. So this admits the cycle — which opens the
/// `companion_cycle` row and takes the single-flight lock synchronously — and
/// returns immediately with the id. Progress and outcome are read back through
/// `companion_list_cycle_reports`, the same journal the scheduled cycles land
/// in; there is no second, trigger-only status surface to drift from it.
///
/// The answer is a shape, not a sentence: `status` is `started` or `skipped`,
/// with the cycle id or the reason beside it. Callers branch on the field.
/// Skipping is a normal outcome (another cycle in flight, or not enough new
/// conversation to be worth compressing), never an error — and the reason
/// carries the actual numbers, because it is shown to a human in a toast.
///
/// `force` (default false, so pre-L1c callers keep working unchanged) bypasses
/// sleep pressure, the interval floor and staleness. It does NOT bypass the
/// single-flight guard — nothing does. The dev-gated button in the Athena chat
/// header is the caller that sets it, so the operator can enforce a milestone
/// cycle and gather data for the next waves.
#[tauri::command]
pub fn companion_run_sleep_cycle(
    state: State<'_, Arc<AppState>>,
    force: Option<bool>,
) -> Result<sleep_cycle::SleepCycleTrigger, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let (answer, admitted) = sleep_cycle::trigger(&state.user_db, force.unwrap_or(false))?;
    if let Some(admitted) = admitted {
        let pool = state.user_db.clone();
        tauri::async_runtime::spawn(async move {
            // A cycle records its own failure as a `failed` row with the reason
            // in stats; reaching this arm means even that write did not land.
            if let Err(e) = sleep_cycle::run_admitted(&pool, admitted).await {
                tracing::warn!(
                    error = %e,
                    "companion: manually triggered sleep cycle could not be closed out"
                );
            }
        });
    }
    Ok(answer)
}

/// The sleep-pressure gauge: how much new conversation is waiting, whether a
/// cycle would start right now, and why.
///
/// Read-only and lock-free — asking never perturbs a running cycle. It is the
/// same [`sleep_cycle::measure`] + verdict the admission runs, not a parallel
/// estimate, so the number in the tooltip and the number in the gate cannot
/// disagree.
#[tauri::command]
pub fn companion_get_sleep_pressure(
    state: State<'_, Arc<AppState>>,
) -> Result<sleep_cycle::SleepPressure, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    sleep_cycle::sleep_pressure(&state.user_db)
}

/// Recent sleep cycles, newest first — the journal the Memory page v2 renders
/// and the audit trail for everything a cycle changed.
#[tauri::command]
pub fn companion_list_cycle_reports(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<cycle_report::CycleSummary>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    cycle_report::list_recent(&state.user_db, limit.unwrap_or(20))
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
///
/// `instructions` is optional natural-language steering (≤4096 chars)
/// folded into the reflection prompt — same shape as
/// `companion_run_consolidation`'s instructions.
#[tauri::command]
pub async fn companion_run_reflection(
    state: State<'_, Arc<AppState>>,
    instructions: Option<String>,
) -> Result<String, AppError> {
    ipc_auth::require_auth(&state).await?;
    validate_instructions(instructions.as_deref())?;
    reflection::run_reflection(&state.user_db, instructions.as_deref()).await
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

// ── Curation runs (job-shaped async curation) ──────────────────────────

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

// ── Cockpit ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CockpitSpec {
    /// JSON spec the frontend parses into widgets. Stored verbatim so
    /// composition shape can evolve without a backend migration.
    pub spec_json: String,
    pub updated_at: String,
}

/// Read the current cockpit composition (singleton). Returns null when
/// Athena hasn't composed one yet — the Cockpit page shows an empty state.
#[tauri::command]
pub fn companion_get_cockpit(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<CockpitSpec>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let c = cockpit::load_cockpit(&state.user_db)?;
    Ok(c.map(|c| CockpitSpec {
        spec_json: c.spec_json,
        updated_at: c.updated_at,
    }))
}

/// Append a single widget to the user's cockpit. The frontend's "Pin to
/// cockpit" button on `InlineChatCard` calls this with the chat-card's
/// `{kind, title?, config?}`. Loads the current cockpit spec (or seeds
/// a fresh `{title:"Cockpit", widgets:[]}` when none exists), generates
/// a stable id for the new widget, defaults `span=4` (a third of the
/// 12-col grid), and saves. Idempotent on a no-op pin (same kind + same
/// config) so accidental double-clicks don't duplicate the widget.
#[tauri::command]
pub fn companion_pin_widget_to_cockpit(
    state: State<'_, Arc<AppState>>,
    kind: String,
    title: Option<String>,
    config: Option<serde_json::Value>,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    // Hold the cockpit write lock across the whole load-modify-save cycle
    // so this doesn't race a concurrent pin or an Athena `compose_cockpit`
    // (both do their own load-modify-save over the same JSON blob).
    let _guard = cockpit::COCKPIT_WRITE_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let now = chrono::Utc::now().to_rfc3339();
    let mut spec: serde_json::Value = match cockpit::load_cockpit(&state.user_db)? {
        Some(c) => serde_json::from_str(&c.spec_json)
            .unwrap_or_else(|_| serde_json::json!({ "title": "Cockpit", "widgets": [] })),
        None => serde_json::json!({ "title": "Cockpit", "widgets": [] }),
    };
    let widgets = spec
        .get_mut("widgets")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| AppError::Internal("cockpit spec missing `widgets` array".into()))?;

    let new_config = config.clone().unwrap_or_else(|| serde_json::json!({}));
    // Idempotency guard with durability promotion. Three cases:
    //
    // 1. Matching widget already exists AND is pinned — no-op. Pin is
    //    already durable; user accidentally double-clicked.
    // 2. Matching widget exists but is NOT pinned (Athena composed it
    //    in the same spec) — promote it to pinned and save. Otherwise
    //    Athena's next compose would silently evict the user's intent.
    // 3. No match — fall through to the normal insert below.
    //
    // Equality is on (kind, config). Stringify-via-JSON-Value compares
    // structurally; canonical-form differences (key order, whitespace)
    // are normalized by serde_json's PartialEq.
    let mut promoted = false;
    for w in widgets.iter_mut() {
        let kind_match = w.get("kind").and_then(|v| v.as_str()) == Some(kind.as_str());
        let config_match = w.get("config").unwrap_or(&serde_json::Value::Null) == &new_config;
        if kind_match && config_match {
            let already_pinned = w.get("pinned").and_then(|p| p.as_bool()).unwrap_or(false);
            if already_pinned {
                return Ok(());
            }
            if let Some(obj) = w.as_object_mut() {
                obj.insert("pinned".into(), serde_json::Value::Bool(true));
            }
            promoted = true;
            break;
        }
    }
    if promoted {
        if let Some(spec_obj) = spec.as_object_mut() {
            spec_obj.insert("updated_at".into(), serde_json::Value::String(now));
        }
        let spec_json = spec.to_string();
        cockpit::save_cockpit(&state.user_db, &spec_json)?;
        return Ok(());
    }

    let id = format!("pin_{}", chrono::Utc::now().timestamp_millis());
    let mut widget = serde_json::json!({
        "id": id,
        "kind": kind,
        "span": 4,
        "config": new_config,
        // `pinned: true` is the durability flag. Athena's next
        // compose_cockpit calls save_cockpit_preserving_pinned which
        // looks for this and carries the widget through. Without it,
        // user pins would evaporate on every Athena compose.
        "pinned": true,
    });
    if let Some(t) = title {
        widget["title"] = serde_json::Value::String(t);
    }
    widgets.push(widget);

    if let Some(spec_obj) = spec.as_object_mut() {
        spec_obj.insert("updated_at".into(), serde_json::Value::String(now));
    }

    let spec_json = spec.to_string();
    cockpit::save_cockpit(&state.user_db, &spec_json)?;
    Ok(())
}

/// Remove a widget from the cockpit by id. Used by the cockpit UI's
/// per-widget "remove" / "unpin" affordance.
///
/// Idempotent: removing a non-existent id (already unpinned, or never
/// existed) is a no-op success, not an error. The user pressed "remove"
/// expecting "this widget should no longer be on my cockpit" — that's
/// the post-state either way.
#[tauri::command]
pub fn companion_unpin_widget_from_cockpit(
    state: State<'_, Arc<AppState>>,
    widget_id: String,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let _guard = cockpit::COCKPIT_WRITE_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let now = chrono::Utc::now().to_rfc3339();
    let mut spec: serde_json::Value = match cockpit::load_cockpit(&state.user_db)? {
        Some(c) => match serde_json::from_str(&c.spec_json) {
            Ok(v) => v,
            Err(_) => return Ok(()),
        },
        None => return Ok(()),
    };
    let widgets = match spec.get_mut("widgets").and_then(|v| v.as_array_mut()) {
        Some(arr) => arr,
        None => return Ok(()),
    };
    let before = widgets.len();
    widgets.retain(|w| w.get("id").and_then(|v| v.as_str()) != Some(widget_id.as_str()));
    if widgets.len() == before {
        return Ok(());
    }
    if let Some(spec_obj) = spec.as_object_mut() {
        spec_obj.insert("updated_at".into(), serde_json::Value::String(now));
    }
    let spec_json = spec.to_string();
    cockpit::save_cockpit(&state.user_db, &spec_json)?;
    Ok(())
}
