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
    CharterAct, CharterActFilter, GoalMetWhen, MandateActOutcome, MandateChange, MandateSignInput,
    MandateSummary,
};
use crate::db::repos::core::{charter_acts, mandates};
use crate::db::DbPool;
use crate::engine::mandate_router::DecisionLanesSnapshot;
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

/// Every mandate that is not retired, with its envelope, its load and the
/// re-read its use asks for (WP6), when it asks one.
#[tauri::command]
pub async fn mandate_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<MandateSummary>, AppError> {
    let pool = state.db.clone();
    let user_db = state.user_db.clone();
    run_blocking("mandate_list", move || {
        let mut list = mandates::list(&pool)?;
        crate::engine::mandate_reread_view::annotate(&pool, &user_db, &mut list);
        Ok(list)
    })
    .await
}

/// One mandate (any status), with its re-read. `NotFound` when no such
/// charter exists.
#[tauri::command]
pub async fn mandate_get(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<MandateSummary, AppError> {
    let pool = state.db.clone();
    let user_db = state.user_db.clone();
    run_blocking("mandate_get", move || {
        let one = mandates::get(&pool, &id)?
            .ok_or_else(|| AppError::NotFound(format!("Mandate {id}")))?;
        let mut list = [one];
        crate::engine::mandate_reread_view::annotate(&pool, &user_db, &mut list);
        let [one] = list;
        Ok(one)
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

/// Drop a DRAFT mandate with the operator's reason: the charter is retired
/// and one final act records the reason. Anything but a draft is refused as
/// `Validation`.
#[tauri::command]
pub async fn mandate_drop(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
    reason: Option<String>,
) -> Result<MandateActOutcome, AppError> {
    door(state.inner(), &app, "mandate_drop", move |pool| {
        mandates::drop_draft(pool, &id, reason.as_deref(), None)
    })
    .await
}

/// Keep a signed, active mandate as signed after a re-read: the re-read
/// marker moves to the decision acts it holds now, and one act records which
/// re-read `reason` was answered.
#[tauri::command]
pub async fn mandate_keep(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
    reason: String,
) -> Result<MandateActOutcome, AppError> {
    door(state.inner(), &app, "mandate_keep", move |pool| {
        mandates::keep(pool, &id, &reason, None)
    })
    .await
}

/// The conditions a goal names for "met" (`dev_goals.met_when`), for the
/// Accept card. `NotFound` when no such goal exists.
#[tauri::command]
pub async fn goal_met_when(
    state: State<'_, Arc<AppState>>,
    goal_id: String,
) -> Result<GoalMetWhen, AppError> {
    let pool = state.db.clone();
    run_blocking("goal_met_when", move || {
        crate::db::repos::dev::goal_met_when::get(&pool, &goal_id)?
            .ok_or_else(|| AppError::NotFound(format!("Goal {goal_id}")))
    })
    .await
}

/// One mandate's Scopes section (WP6): per scope its acts, or the asks it
/// would absorb (counted through the router), plus the merge and spend rows.
/// Widen and narrow go through `mandate_amend`.
#[tauri::command]
pub async fn mandate_scopes(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<crate::engine::mandate_scopes::MandateScopes, AppError> {
    let pool = state.db.clone();
    let user_db = state.user_db.clone();
    run_blocking("mandate_scopes", move || {
        crate::engine::mandate_scopes::scopes_of(&pool, &user_db, &id)
    })
    .await
}

/// The orphanage (WP6): pending items no mandate holds, grouped by project
/// and measured against the fleet's flow.
#[tauri::command]
pub async fn orphan_clusters(
    state: State<'_, Arc<AppState>>,
) -> Result<personas_engine::mandate_orphans::OrphanClusters, AppError> {
    let pool = state.db.clone();
    let user_db = state.user_db.clone();
    run_blocking("orphan_clusters", move || {
        crate::engine::mandate_orphanage::clusters(&pool, &user_db)
    })
    .await
}

/// Draft a mandate for an orphaned project (`source = 'athena'`, a draft with
/// an empty envelope): it reaches the operator as a Sign card. `steward`
/// names the persona when the orphanage found none. Refused when the project
/// already has a live mandate.
#[tauri::command]
pub async fn orphan_draft(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
    steward: Option<String>,
) -> Result<MandateActOutcome, AppError> {
    let user_db = state.user_db.clone();
    door(state.inner(), &app, "orphan_draft", move |pool| {
        crate::engine::mandate_orphanage::draft(pool, &user_db, &project_id, steward.as_deref())
    })
    .await
}

/// Adopt an orphaned project into an existing mandate: a new charter carrying
/// that mandate's steward and envelope now holds the project.
#[tauri::command]
pub async fn orphan_adopt(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    project_id: String,
    charter_id: String,
) -> Result<MandateActOutcome, AppError> {
    let user_db = state.user_db.clone();
    door(state.inner(), &app, "orphan_adopt", move |pool| {
        crate::engine::mandate_orphanage::adopt(pool, &user_db, &project_id, &charter_id)
    })
    .await
}

/// Archive every orphan of one project from the Orphans lane (archived, not
/// deleted: the items stay in their own lists). Returns how many were newly
/// archived.
#[tauri::command]
pub async fn orphan_archive(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<u32, AppError> {
    let pool = state.db.clone();
    let user_db = state.user_db.clone();
    run_blocking("orphan_archive", move || {
        crate::engine::mandate_orphanage::archive(&pool, &user_db, &project_id)
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
/// reverted or superseded one as `Validation`. A router act's inverse door runs
/// first (a filed report goes back to unread, an acknowledged incident is
/// reopened; an incident something else moved since is refused as
/// `Validation`). Returns the refreshed mandate and the `act.revert` act.
#[tauri::command]
pub async fn charter_act_revert(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<MandateActOutcome, AppError> {
    door(state.inner(), &app, "charter_act_revert", move |pool| {
        crate::engine::mandate_sweep::revert_with_undo(pool, &id)
    })
    .await
}

/// Every pending item the Decision Center shows, with the lane, clause,
/// charter and coalesce key the router gives it (WP3). `failedSources` names
/// every source that did not load; its items are absent, never zero.
#[tauri::command]
pub async fn decision_lanes_snapshot(
    state: State<'_, Arc<AppState>>,
) -> Result<DecisionLanesSnapshot, AppError> {
    let pool = state.db.clone();
    let user_db = state.user_db.clone();
    run_blocking("decision_lanes_snapshot", move || {
        crate::engine::mandate_lanes::build_snapshot(&pool, &user_db)
    })
    .await
}
