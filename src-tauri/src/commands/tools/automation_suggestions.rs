//! Self-Wiring Fabric v1 — IPC surface for mined automation suggestions.
//!
//! Three commands: list (feed + miner status envelope), accept (stamp the
//! mined-route tag after the FRONTEND has walked the existing Studio commit
//! path: create-disabled → dry-run → enable), reject (log the dismissal).
//! Nothing here creates triggers — trigger creation stays on the existing
//! `create_trigger`/`dry_run_trigger`/`update_trigger` commands so the
//! suggestion path can never drift from the hand-wired path.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::AutomationSuggestion;
use crate::db::repos::resources::automation_suggestions as repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::engine::pattern_miner;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// The suggestions feed plus the miner's honesty context: whether mining is
/// even enabled (autopilot `suggest`+ on some project) and the thresholds,
/// so the empty state can say exactly WHY there is nothing to show instead
/// of a generic shrug.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSuggestionFeed {
    pub suggestions: Vec<AutomationSuggestion>,
    /// False = no project grants `Capability::AutomationSuggestion`; the
    /// miner is a no-op and the UI should say so, not "no signal yet".
    pub miner_enabled: bool,
    pub min_co_occurrences: u32,
    pub window_seconds: u32,
    pub lookback_days: u32,
}

#[tauri::command]
pub fn list_automation_suggestions(
    state: State<'_, Arc<AppState>>,
) -> Result<AutomationSuggestionFeed, AppError> {
    require_auth_sync(&state)?;
    Ok(AutomationSuggestionFeed {
        suggestions: repo::list(&state.db)?,
        miner_enabled: pattern_miner::mining_enabled(&state.db),
        min_co_occurrences: pattern_miner::MIN_CO_OCCURRENCES,
        window_seconds: pattern_miner::CO_OCCURRENCE_WINDOW_SECONDS,
        lookback_days: pattern_miner::LOOKBACK_DAYS,
    })
}

/// Accept a suggestion AFTER the frontend committed the trigger through the
/// existing Studio path (dry-run first). Verifies the trigger actually exists
/// and targets the suggested persona before stamping the mined-route tag —
/// the tag is the feedback-loop exclusion, so it must never point at air.
#[tauri::command]
pub fn accept_automation_suggestion(
    state: State<'_, Arc<AppState>>,
    id: String,
    trigger_id: String,
) -> Result<AutomationSuggestion, AppError> {
    require_auth_sync(&state)?;
    let suggestion = repo::get_by_id(&state.db, &id)?;
    let trigger = trigger_repo::get_by_id(&state.db, &trigger_id)?;
    if trigger.persona_id != suggestion.persona_id {
        return Err(AppError::Validation(format!(
            "trigger {trigger_id} targets persona {} but the suggestion proposes {}",
            trigger.persona_id, suggestion.persona_id
        )));
    }
    repo::mark_accepted(&state.db, &id, &trigger_id)?;
    repo::get_by_id(&state.db, &id)
}

/// Reject (dismiss) a suggestion. The row is kept as a rejected record so
/// the miner never re-proposes the same (event, persona) pair — the decision
/// itself is the logged training signal.
#[tauri::command]
pub fn reject_automation_suggestion(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<AutomationSuggestion, AppError> {
    require_auth_sync(&state)?;
    repo::mark_rejected(&state.db, &id)?;
    repo::get_by_id(&state.db, &id)
}
