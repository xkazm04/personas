//! Tauri command surface for the mandate envelope and its act log (spark
//! `mandate-lanes`, WP2). Thin adapters: every door is one call into
//! `db::repos::core::{mandates, charter_acts}`, which owns the transaction
//! that changes the charter and appends its act together.
//!
//! The app layer's one job beyond that is the push: every act a command writes
//! is announced on `charter-act-recorded` (main window only) after its
//! transaction commits. Any other writer of `charter_acts` in this crate (the
//! router, WP3) must call [`emit_act_recorded`] the same way.
//!
//! No `#[requires(auth)]`: that guard expands to an unconditional `Ok(())`
//! (census `unfalsifiable-tier-guard`), so the IPC invoke wrapper's session
//! token check is the gate, and annotating would only claim otherwise.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, EventTarget, State};

use crate::commands::blocking::run_blocking;
use crate::db::models::{
    CharterAct, CharterActFilter, MandateActOutcome, MandateChange, MandateSignInput,
    MandateSummary,
};
use crate::db::repos::core::{charter_acts, mandates};
use crate::db::DbPool;
use crate::error::AppError;
use crate::AppState;

/// Announce one recorded act to the main window. Same target rule as the
/// browser events: `emit_to(main)`, never `app.emit`, which also reaches page
/// webviews.
pub(crate) fn emit_act_recorded(app: &AppHandle, act: &CharterAct) {
    if let Err(e) = app.emit_to(
        EventTarget::AnyLabel {
            label: crate::browser_bridge::webview::layout::MAIN_WINDOW.to_string(),
        },
        personas_core::events::event_name::CHARTER_ACT_RECORDED,
        act,
    ) {
        tracing::warn!(error = %e, act_id = %act.id, "mandates: charter-act-recorded was not delivered");
    }
}

/// The refreshed mandate beside the act that changed it.
fn outcome(pool: &DbPool, act: CharterAct) -> Result<MandateActOutcome, AppError> {
    let mandate = mandates::get(pool, &act.charter_id)?
        .ok_or_else(|| AppError::NotFound(format!("Mandate {}", act.charter_id)))?;
    Ok(MandateActOutcome { mandate, act })
}

/// Run one envelope door off the IPC thread, then emit its act.
async fn door<F>(
    state: &Arc<AppState>,
    app: &AppHandle,
    what: &'static str,
    f: F,
) -> Result<MandateActOutcome, AppError>
where
    F: FnOnce(&DbPool) -> Result<CharterAct, AppError> + Send + 'static,
{
    let pool = state.db.clone();
    let done = run_blocking(what, move || {
        let act = f(&pool)?;
        outcome(&pool, act)
    })
    .await?;
    emit_act_recorded(app, &done.act);
    Ok(done)
}

/// Every mandate that is not retired, with its envelope and load.
#[tauri::command]
pub async fn mandate_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<MandateSummary>, AppError> {
    let pool = state.db.clone();
    run_blocking("mandate_list", move || mandates::list(&pool)).await
}

/// One mandate (any status). `NotFound` when no such charter exists.
#[tauri::command]
pub async fn mandate_get(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<MandateSummary, AppError> {
    let pool = state.db.clone();
    run_blocking("mandate_get", move || {
        mandates::get(&pool, &id)?.ok_or_else(|| AppError::NotFound(format!("Mandate {id}")))
    })
    .await
}

/// Sign the whole envelope (activates a draft). Bumps the envelope version.
#[tauri::command]
pub async fn mandate_sign(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
    envelope: MandateSignInput,
) -> Result<MandateActOutcome, AppError> {
    door(state.inner(), &app, "mandate_sign", move |pool| {
        mandates::sign(pool, &id, &envelope, None)
    })
    .await
}

/// Widen, narrow, set the merge policy or set the budget of a signed envelope.
#[tauri::command]
pub async fn mandate_amend(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
    change: MandateChange,
) -> Result<MandateActOutcome, AppError> {
    door(state.inner(), &app, "mandate_amend", move |pool| {
        mandates::amend(pool, &id, &change, None)
    })
    .await
}

#[tauri::command]
pub async fn mandate_suspend(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<MandateActOutcome, AppError> {
    door(state.inner(), &app, "mandate_suspend", move |pool| {
        mandates::suspend(pool, &id, None)
    })
    .await
}

#[tauri::command]
pub async fn mandate_resume(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<MandateActOutcome, AppError> {
    door(state.inner(), &app, "mandate_resume", move |pool| {
        mandates::resume(pool, &id, None)
    })
    .await
}

/// Acts matching the filter, newest first.
#[tauri::command]
pub async fn charter_acts_list(
    state: State<'_, Arc<AppState>>,
    filter: Option<CharterActFilter>,
) -> Result<Vec<CharterAct>, AppError> {
    let pool = state.db.clone();
    run_blocking("charter_acts_list", move || {
        charter_acts::list(&pool, &filter.unwrap_or_default())
    })
    .await
}

/// Revert one act. An irreversible act is refused as `Forbidden`; an already
/// reverted or superseded one as `Validation`. Returns the refreshed mandate
/// and the `act.revert` act.
#[tauri::command]
pub async fn charter_act_revert(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<MandateActOutcome, AppError> {
    door(state.inner(), &app, "charter_act_revert", move |pool| {
        mandates::revert(pool, &id, None).map_err(AppError::from)
    })
    .await
}
