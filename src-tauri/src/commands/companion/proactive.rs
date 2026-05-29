//! Tauri commands for the proactive (Phase E) engine.
//!
//! Surface:
//!   - `companion_evaluate_proactive_now` — manually run a pass.
//!     Returns the count of newly-queued messages. Used by the
//!     background scheduler and by the UI's debug button.
//!   - `companion_list_proactive_messages` — drives the "Athena reached
//!     out" panel.
//!   - `companion_engage_proactive` — turn a queued nudge into a real
//!     chat turn (resolves the row + sends the message text into the
//!     existing chat pipeline).
//!   - `companion_dismiss_proactive` — silent no-thanks resolution.
//!
//! Delivery model: when `evaluate` produces new rows, we mark them
//! `delivered` and emit `companion://proactive` so the frontend can
//! react. Status flow: queued → delivered → engaged|dismissed.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::companion::proactive::{self, ProactiveMessage};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

pub const PROACTIVE_EVENT: &str = "companion://proactive";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveDelivery {
    pub messages: Vec<ProactiveMessage>,
}

/// Run a full evaluation pass and emit any newly-delivered messages
/// on `companion://proactive`. Returns the count for telemetry / UI
/// status. Idempotent — running twice in a row does nothing extra
/// because the dedupe guard prevents double-firing.
#[tauri::command]
pub async fn companion_evaluate_proactive_now(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<usize, AppError> {
    ipc_auth::require_auth(&state).await?;
    let mut new_msgs = proactive::evaluate_with_extra_candidates(
        &state.user_db,
        proactive::triggers::dev_goal_nudges(&state.db),
    )?;
    // Athena's `schedule_proactive` commitments flow through the same
    // emit + status transition as trigger-driven nudges, but their
    // candidate set comes from a time-based sweep instead of
    // [`proactive::triggers::collect_all`]. Run the sweep here so the
    // existing scheduler cadence (manual `evaluate_proactive_now` calls,
    // background tick, etc.) services both kinds with one entry point.
    let due_scheduled = proactive::deliver_due_scheduled(&state.user_db)?;
    new_msgs.extend(due_scheduled);
    for m in &new_msgs {
        if let Err(e) = proactive::mark_delivered(&state.user_db, &m.id) {
            tracing::warn!(id = %m.id, error = %e, "proactive: mark_delivered failed");
        }
    }
    if !new_msgs.is_empty() {
        // Emit so the panel can pop the "Athena reached out" card. We
        // re-fetch from the DB so the payload reflects the post-mark
        // status (delivered, not queued).
        let payload = ProactiveDelivery {
            messages: new_msgs
                .iter()
                .map(|m| ProactiveMessage {
                    status: "delivered".into(),
                    ..m.clone()
                })
                .collect(),
        };
        if let Err(e) = app.emit(PROACTIVE_EVENT, payload) {
            tracing::warn!(error = %e, "proactive: event emit failed");
        }
    }
    Ok(new_msgs.len())
}

#[tauri::command]
pub fn companion_list_proactive_messages(
    state: State<'_, Arc<AppState>>,
    only_unresolved: Option<bool>,
    limit: Option<u32>,
) -> Result<Vec<ProactiveMessage>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    proactive::list_messages(
        &state.user_db,
        only_unresolved.unwrap_or(false),
        limit.unwrap_or(50),
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngageOutcome {
    pub message_id: String,
    /// The text the UI should send through the normal chat-send path
    /// (or use as a kickoff). Mirrors the message body so the caller
    /// doesn't need to re-fetch.
    pub message: String,
}

#[tauri::command]
pub async fn companion_engage_proactive(
    state: State<'_, Arc<AppState>>,
    message_id: String,
) -> Result<EngageOutcome, AppError> {
    ipc_auth::require_auth(&state).await?;
    // Fetch the message before resolving so we can return its body to
    // the caller. The resolve step bumps backlog reminded_count for
    // backlog_aging triggers.
    let messages = proactive::list_messages(&state.user_db, false, 200)?;
    let msg = messages
        .into_iter()
        .find(|m| m.id == message_id)
        .ok_or_else(|| AppError::Internal(format!("proactive `{message_id}` not found")))?;
    proactive::resolve(&state.user_db, &message_id, true)?;
    Ok(EngageOutcome {
        message_id: msg.id,
        message: msg.message,
    })
}

#[tauri::command]
pub fn companion_dismiss_proactive(
    state: State<'_, Arc<AppState>>,
    message_id: String,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    proactive::resolve(&state.user_db, &message_id, false)
}
