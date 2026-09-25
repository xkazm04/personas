//! Twin setup plan — the command surface (spark `twin-setup-plan`).
//!
//! Six adapters, each returning the whole [`SetupSessionSnapshot`] so the
//! client renders one shape and never merges partial state. None of them waits
//! on an LLM: planning and reconciling run in the background and announce
//! themselves with `twin-setup-updated` (`event_name::TWIN_SETUP_UPDATED`,
//! payload `SetupUpdatedEvent`), after which the client calls
//! [`twin_setup_get`].
//!
//! Each command is a thin adapter over `engine::twin_setup` (the operations
//! run in one transaction off the IPC thread, then schedule the background
//! plan / reconcile / refill work on the per-twin worker).

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::db::models::{SetupOpener, SetupReadiness, SetupSessionSnapshot, SetupSteer};
use crate::engine::twin_setup::{self as engine, JobCtx};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

fn ctx(app: &AppHandle, state: &AppState) -> JobCtx {
    JobCtx::for_app(app, state.db.clone())
}

/// The current session. Pure read.
#[tauri::command]
pub async fn twin_setup_get(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    engine::get(&state.db, twin_id).await
}

/// Open (or resume) the setup session: ensure a plan (the deep pass starts in
/// the background when there is none, it failed, or its lease went stale) and
/// a live step (the queue's head, else `opener`).
#[tauri::command]
pub async fn twin_setup_open(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    locale: Option<String>,
    readiness: SetupReadiness,
    opener: Option<SetupOpener>,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    engine::open(&ctx(&app, &state), twin_id, locale, readiness, opener).await
}

/// Answer (or skip, with `answer == None`) the live step. A `step_id` that is
/// not the live step is a no-op returning the snapshot unchanged.
#[tauri::command]
pub async fn twin_setup_answer(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    step_id: String,
    answer: Option<String>,
    locale: Option<String>,
    readiness: SetupReadiness,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    engine::answer(
        &ctx(&app, &state),
        twin_id,
        step_id,
        answer,
        locale,
        readiness,
    )
    .await
}

/// Apply an operator steer (drop/pin/restore a goal, ask a step next, change
/// stage/topic/focus, hand questions over, redeal the queue).
#[tauri::command]
pub async fn twin_setup_steer(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    steer: SetupSteer,
    locale: Option<String>,
    readiness: SetupReadiness,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    engine::steer(&ctx(&app, &state), twin_id, steer, locale, readiness).await
}

/// Record the operator's verdict on an offer: `accepted` | `edited` |
/// `dismissed`. The field write itself stays client-side.
#[tauri::command]
pub async fn twin_setup_offer_verdict(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    offer_id: String,
    verdict: String,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    engine::offer_verdict(&ctx(&app, &state), twin_id, offer_id, verdict).await
}

/// Build a fresh plan over everything on file. Transcript, offers and
/// observations are kept.
#[tauri::command]
pub async fn twin_setup_rebuild(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    locale: Option<String>,
    readiness: SetupReadiness,
) -> Result<SetupSessionSnapshot, AppError> {
    require_auth(&state).await?;
    engine::rebuild(&ctx(&app, &state), twin_id, locale, readiness).await
}
