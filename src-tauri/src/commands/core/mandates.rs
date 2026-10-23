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
//! **The mesh mirror (WP9).** On a paired peer the reads also return the
//! mandates it MIRRORS from their home device (`MandateSummary::mirror`
//! set), and every write door on such a mandate writes nothing here: it is
//! sent home as a `charter_verdict` job (`crate::mesh::charter_mirror`) and
//! returns the home's answer. Every act a door or the sweep records here goes
//! through [`emit_act_recorded`], which is also the mirror's one wake.
//!
//! No `#[requires(auth)]`: that guard expands to an unconditional `Ok(())`
//! (census `unfalsifiable-tier-guard`), so the IPC invoke wrapper's session
//! token check is the gate, and annotating would only claim otherwise.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, EventTarget, State};

use crate::commands::blocking::run_blocking;
use crate::db::models::{
    CharterAct, CharterActFilter, CharterVerdict, GoalMetWhen, MandateActOutcome, MandateChange,
    MandateSignInput, MandateSummary,
};
use crate::db::repos::core::{charter_acts, charter_mirror, mandates};
use crate::db::DbPool;
use crate::engine::mandate_router::DecisionLanesSnapshot;
use crate::error::AppError;
use crate::AppState;

/// Announce one act recorded HERE: to the main window, and to the mandate
/// mirror (every paired peer gets the charter's new state). The one
/// chokepoint every writer of `charter_acts` in this crate calls.
pub(crate) fn emit_act_recorded(app: &AppHandle, act: &CharterAct) {
    announce_act(app, act);
    #[cfg(feature = "p2p")]
    crate::mesh::charter_mirror::note_act(&act.charter_id);
}

/// Announce one act to the main window only (a mirrored act arriving from
/// its home device, which must not be mirrored back). Same target rule as
/// the browser events: `emit_to(main)`, never `app.emit`, which also reaches
/// page webviews.
pub(crate) fn announce_act(app: &AppHandle, act: &CharterAct) {
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

/// When `charter_id` is a mandate this device only mirrors, the verdict is
/// sent home and its answer returned; nothing is written here. `None` = the
/// door runs here.
async fn sent_home(
    state: &Arc<AppState>,
    charter_id: &str,
    verdict: CharterVerdict,
) -> Option<Result<MandateActOutcome, AppError>> {
    #[cfg(feature = "p2p")]
    {
        crate::mesh::charter_mirror::forward_if_mirrored(state, charter_id, verdict).await
    }
    #[cfg(not(feature = "p2p"))]
    {
        let _ = (state, charter_id, verdict);
        None
    }
}

/// Run one envelope door off the IPC thread, then emit its act. A mandate
/// this device only mirrors never reaches `f`: `verdict` goes home instead.
async fn door<F>(
    state: &Arc<AppState>,
    app: &AppHandle,
    what: &'static str,
    route: Option<(&str, CharterVerdict)>,
    f: F,
) -> Result<MandateActOutcome, AppError>
where
    F: FnOnce(&DbPool) -> Result<CharterAct, AppError> + Send + 'static,
{
    if let Some((charter_id, verdict)) = route {
        if let Some(answer) = sent_home(state, charter_id, verdict).await {
            return answer;
        }
    }
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
        // Mirrored mandates carry the re-read their home computed.
        list.extend(charter_mirror::list(&pool)?);
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
        let Some(one) = mandates::get(&pool, &id)? else {
            return charter_mirror::get(&pool, &id)?
                .ok_or_else(|| AppError::NotFound(format!("Mandate {id}")));
        };
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
    let verdict = CharterVerdict::Sign {
        envelope: envelope.clone(),
    };
    let home = id.clone();
    door(
        state.inner(),
        &app,
        "mandate_sign",
        Some((home.as_str(), verdict)),
        move |pool| mandates::sign(pool, &id, &envelope, None),
    )
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
    let verdict = CharterVerdict::Amend {
        change: change.clone(),
    };
    let home = id.clone();
    door(
        state.inner(),
        &app,
        "mandate_amend",
        Some((home.as_str(), verdict)),
        move |pool| mandates::amend(pool, &id, &change, None),
    )
    .await
}

#[tauri::command]
pub async fn mandate_suspend(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<MandateActOutcome, AppError> {
    let home = id.clone();
    door(
        state.inner(),
        &app,
        "mandate_suspend",
        Some((home.as_str(), CharterVerdict::Suspend)),
        move |pool| mandates::suspend(pool, &id, None),
    )
    .await
}

#[tauri::command]
pub async fn mandate_resume(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<MandateActOutcome, AppError> {
    let home = id.clone();
    door(
        state.inner(),
        &app,
        "mandate_resume",
        Some((home.as_str(), CharterVerdict::Resume)),
        move |pool| mandates::resume(pool, &id, None),
    )
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
    let verdict = CharterVerdict::Drop {
        reason: reason.clone(),
    };
    let home = id.clone();
    door(
        state.inner(),
        &app,
        "mandate_drop",
        Some((home.as_str(), verdict)),
        move |pool| mandates::drop_draft(pool, &id, reason.as_deref(), None),
    )
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
    let verdict = CharterVerdict::Keep {
        reason: reason.clone(),
    };
    let home = id.clone();
    door(
        state.inner(),
        &app,
        "mandate_keep",
        Some((home.as_str(), verdict)),
        move |pool| mandates::keep(pool, &id, &reason, None),
    )
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
        // The per-scope counts are routed over the home's pending items,
        // which this device does not hold.
        if let Some(home) = charter_mirror::home_of(&pool, &id)? {
            return Err(AppError::Validation(format!(
                "This mandate's scopes are counted on its home device, \"{}\".",
                home.home_name
            )));
        }
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
    door(state.inner(), &app, "orphan_draft", None, move |pool| {
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
    // An orphan is THIS device's work; a mirrored mandate's steward lives on
    // its home device and can hold none of it (a peer never files an item
    // under a mandate it mirrors).
    let pool = state.db.clone();
    let probe = charter_id.clone();
    if let Some(home) = run_blocking("orphan_adopt", move || {
        charter_mirror::home_of(&pool, &probe)
    })
    .await?
    {
        return Err(AppError::Forbidden(format!(
            "That mandate lives on \"{}\"; it cannot hold this device's work. Draft a mandate here instead.",
            home.home_name
        )));
    }
    door(state.inner(), &app, "orphan_adopt", None, move |pool| {
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
        let filter = filter.unwrap_or_default();
        // One mirrored mandate's log, or every log (this device's own acts
        // and the mirrored ones, newest first, one page).
        if let Some(id) = filter.charter_id.as_deref() {
            if charter_mirror::home_of(&pool, id)?.is_some() {
                return charter_mirror::list_acts(&pool, &filter);
            }
            return charter_acts::list(&pool, &filter);
        }
        let mut acts = charter_acts::list(&pool, &filter)?;
        let mirrored = charter_mirror::list_acts(&pool, &filter)?;
        if mirrored.is_empty() {
            return Ok(acts);
        }
        acts.extend(mirrored);
        acts.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        acts.truncate(filter.limit.unwrap_or(100).min(500) as usize);
        Ok(acts)
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
    let pool = state.db.clone();
    let act = id.clone();
    let mirrored = run_blocking("charter_act_revert", move || {
        if charter_acts::get(&pool, &act)?.is_some() {
            return Ok(None);
        }
        Ok(charter_mirror::get_act(&pool, &act)?.map(|a| a.charter_id))
    })
    .await?;
    let verdict = CharterVerdict::Revert { act_id: id.clone() };
    let route = mirrored.as_deref().map(|charter| (charter, verdict));
    door(
        state.inner(),
        &app,
        "charter_act_revert",
        route,
        move |pool| crate::engine::mandate_sweep::revert_with_undo(pool, &id),
    )
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
