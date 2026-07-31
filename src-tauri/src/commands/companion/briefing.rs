//! Tauri commands for the Morning Director briefing.
//!
//! `companion_compose_briefing` — the session-open composition entry.
//! The frontend computes the since-left [`SessionDelta`] and calls this
//! ONLY when the delta is non-trivial (the brain re-checks the gate).
//! Returns `None` when composition failed or was gated — the frontend
//! then renders its deterministic fallback briefing (the
//! `composeDefaultCockpit` model) instead of surfacing an error at the
//! worst possible moment (app open).
//!
//! `companion_record_briefing_action` — every action taken from a
//! briefing widget is written to the `companion_design_decision` audit
//! ledger, so the decisions panel shows "what you did about it" and the
//! trail is bidirectional (Athena proposes → user acts → both recorded).

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::companion::brain::briefing::{self, SessionDelta};
use crate::companion::brain::decisions::{self, DecisionInput};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

/// Session id stamped on briefing-action decision rows — groups them in
/// the audit trail without needing a chat session.
const BRIEFING_SESSION_ID: &str = "morning_briefing";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefingSpec {
    /// Serialized cockpit-spec body (`{title, widgets, updated_at}`),
    /// same shape as `compose_cockpit` output; the frontend renders it
    /// as a contextual overlay.
    pub spec_json: String,
    /// Provenance: `"athena"` (LLM-composed, sanitized). The frontend's
    /// deterministic fallback never round-trips through here.
    pub composed_by: String,
    pub generated_at: String,
}

/// Compose the morning briefing from the frontend's session delta.
/// `Ok(None)` = gated or composition failed → deterministic fallback
/// client-side. Never surfaces the LLM error to the user.
#[tauri::command]
pub async fn companion_compose_briefing(
    state: State<'_, Arc<AppState>>,
    delta: SessionDelta,
) -> Result<Option<BriefingSpec>, AppError> {
    ipc_auth::require_auth(&state).await?;
    if briefing::delta_is_trivial(&delta) {
        return Ok(None);
    }
    match briefing::compose_briefing(&delta).await {
        Ok(spec_json) => Ok(Some(BriefingSpec {
            spec_json,
            composed_by: "athena".into(),
            generated_at: chrono::Utc::now().to_rfc3339(),
        })),
        Err(e) => {
            tracing::warn!(error = %e, "briefing compose failed; frontend falls back deterministically");
            Ok(None)
        }
    }
}

/// Record one briefing action into the decision audit ledger.
/// `label` = what was acted on ("Rerun failed persona"), `choice` = the
/// enum action kind taken, `rationale` = why (Athena's framing or the
/// deterministic fallback's), `persona_context` = target persona id /
/// approval id for `list_by_context` retrieval.
#[tauri::command]
pub async fn companion_record_briefing_action(
    state: State<'_, Arc<AppState>>,
    label: String,
    choice: String,
    rationale: String,
    persona_context: Option<String>,
) -> Result<(), AppError> {
    ipc_auth::require_auth(&state).await?;
    let input = DecisionInput {
        label: &label,
        choice: &choice,
        rationale: &rationale,
        decision_timestamp: None,
    };
    decisions::save_batch(
        &state.user_db,
        BRIEFING_SESSION_ID,
        persona_context.as_deref(),
        &[input],
    )?;
    Ok(())
}
