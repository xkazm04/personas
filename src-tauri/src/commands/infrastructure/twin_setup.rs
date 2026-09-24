//! Twin setup plan — the command surface (spark `twin-setup-plan`).
//!
//! Six adapters, each returning the whole [`SetupSessionSnapshot`] so the
//! client renders one shape and never merges partial state. None of them waits
//! on an LLM: planning and reconciling run in the background and announce
//! themselves with `twin-setup-updated` (`event_name::TWIN_SETUP_UPDATED`,
//! payload `SetupUpdatedEvent`), after which the client calls
//! [`twin_setup_get`].
//!
//! WP0 lands the CONTRACT only: every body is a stub that returns the stored
//! snapshot. The `// WP1:` note in each names what the engine will do there.

use std::sync::Arc;

use tauri::State;

use crate::db::models::{SetupOpener, SetupReadiness, SetupSessionSnapshot, SetupSteer};
use crate::db::repos::twin_setup as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Read the snapshot off the IPC thread (a sync rusqlite read would block it).
async fn snapshot_blocking(
    state: &AppState,
    twin_id: String,
    operation: &'static str,
) -> Result<SetupSessionSnapshot, AppError> {
    let db = state.db.clone();
    match tokio::task::spawn_blocking(move || repo::snapshot(&db, &twin_id)).await {
        Ok(result) => result,
        Err(e) if e.is_panic() => Err(AppError::Internal(format!("{operation} panicked: {e}"))),
        Err(e) => Err(AppError::Internal(format!("{operation}: {e}"))),
    }
}

/// The current session. Pure read.
#[tauri::command]
pub async fn twin_setup_get(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    snapshot_blocking(&state, twin_id, "twin_setup_get").await
}

/// Open (or resume) the setup session.
#[tauri::command]
pub async fn twin_setup_open(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    locale: Option<String>,
    readiness: SetupReadiness,
    opener: Option<SetupOpener>,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    // WP1: create the plan row if absent (status `building`), store locale +
    // readiness, make `opener` the live step (origin `opener`) so the first
    // question needs no LLM, and start the background planner under the lease.
    let _ = (locale, readiness, opener);
    snapshot_blocking(&state, twin_id, "twin_setup_open").await
}

/// Answer (or skip, with `answer == None`) the live step.
#[tauri::command]
pub async fn twin_setup_answer(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    step_id: String,
    answer: Option<String>,
    locale: Option<String>,
    readiness: SetupReadiness,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    // WP1: mark `step_id` answered/skipped, promote the next queued step to
    // live, bump goal counters, and queue the reconciler (offers +
    // observations) and a refill/deep re-plan when due.
    let _ = (step_id, answer, locale, readiness);
    snapshot_blocking(&state, twin_id, "twin_setup_answer").await
}

/// Apply an operator steer (drop/pin/restore a goal, ask a step next, change
/// stage/topic/focus, hand questions over, redeal the queue).
#[tauri::command]
pub async fn twin_setup_steer(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    steer: SetupSteer,
    locale: Option<String>,
    readiness: SetupReadiness,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    // WP1: apply `steer` to goals/steps in one transaction; steers that change
    // what the plan should ask (SetStage, SetTopic, FocusSlot, Redeal, DropGoal)
    // start a background re-plan.
    let _ = (steer, locale, readiness);
    snapshot_blocking(&state, twin_id, "twin_setup_steer").await
}

/// Record the operator's verdict on an offer: `accepted` | `edited` |
/// `dismissed`.
#[tauri::command]
pub async fn twin_setup_offer_verdict(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    offer_id: String,
    verdict: String,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    // WP1: validate `verdict`, set the offer's status + resolved_at. The field
    // write itself stays client-side (the existing accept path owns it).
    let _ = (offer_id, verdict);
    snapshot_blocking(&state, twin_id, "twin_setup_offer_verdict").await
}

/// Throw the plan away and build a fresh one (after a failure, or on demand).
#[tauri::command]
pub async fn twin_setup_rebuild(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    locale: Option<String>,
    readiness: SetupReadiness,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    // WP1: set the plan `building`, obsolete the queued steps, clear the error
    // and start the background planner.
    let _ = (locale, readiness);
    snapshot_blocking(&state, twin_id, "twin_setup_rebuild").await
}
