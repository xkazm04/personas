//! **The steward sweep** (spark `mandate-lanes`, WP3): the deterministic half
//! of "who decides inside the envelope". It reads the pending items the
//! Decision Center reads, asks the pure router
//! ([`personas_engine::mandate_router::route`]) where each one goes, and files
//! the ones the router may file alone - mark a report read, approve an info
//! review, acknowledge a non-stop incident - through the SAME doors the UI
//! uses, recording each as a `router` act on the charter that granted it.
//!
//! * **The grant answers at the gate.** Before any door, the sweep asks
//!   `autonomy::mandate_permits_scope_for` (opt-in: no mandate, an unsigned
//!   envelope or a missing scope all refuse). The act carries the charter and
//!   envelope version that granted it.
//! * **Runs regardless of the attention loop.** It is hosted on the App Master
//!   probation tick (`AppMasterProbationSubscription`, 15 min) and runs once at
//!   boot - neither reads `autonomous_attention_loop`.
//! * **Idempotent.** An item with ANY act of its kind (standing or reverted) is
//!   never acted again: a reverted act means the operator took it back.
//! * **Bounded.** At most [`SCAN_CAP`] rows per source per charter and
//!   [`MAX_ACTS_PER_SWEEP`] acts per run; one item's failure never stops it.
//! * **On this machine today it acts on nothing**: every live charter is
//!   unsigned (envelope version 0), and an unsigned envelope grants nothing.
//!
//! The router's act and the door are not one transaction (the doors own their
//! connections). The door goes first; if the act then fails to record, the
//! sweep calls the inverse door (report unread, incident reopen). A review
//! has no inverse door, so that one case is logged loudly instead.
//!
//! The [`LaneBook`] and the item mappers here are shared with the snapshot
//! (`engine::mandate_lanes`), so the sweep and the lanes route identically.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use personas_engine::mandate_router::{
    self, CharterStatus, CharterView, Irreversible, Route, RouteInput, RouteKind, RouterAct,
};

use crate::db::models::{
    AuditIncident, CharterAct, CharterActor, DecideScope, IncidentFilters, MandateSummary,
    ManualReviewStatus, NewCharterAct, PersonaManualReview, PersonaReport,
};
use crate::db::repos::communication::{manual_reviews, reports};
use crate::db::repos::core::{charter_acts, mandates};
use crate::db::repos::execution::audit_incidents;
use crate::db::DbPool;
use crate::error::AppError;

/// Rows read per source per charter in one sweep.
pub(crate) const SCAN_CAP: i64 = 200;
/// Page size inside [`SCAN_CAP`].
const PAGE: i64 = 50;
/// Acts one sweep may record.
pub(crate) const MAX_ACTS_PER_SWEEP: usize = 100;

/// `context_data.source` values whose review verdict MOVES work: an App
/// Master's own ask (`attention_decide::ASK_SOURCE`) and a Director packet
/// (`app_master_probation::PACKET_SOURCE`, Director coaching).
const BINDING_REVIEW_SOURCES: [&str; 2] = [
    crate::engine::subscription::ASK_SOURCE,
    crate::engine::app_master_probation::PACKET_SOURCE,
];

// ---------------------------------------------------------------------------
// The book: every mandate, indexed the ways routing needs
// ---------------------------------------------------------------------------

/// Every non-retired mandate, indexed by project and by steward.
pub(crate) struct LaneBook {
    pub(crate) summaries: Vec<MandateSummary>,
    by_project: HashMap<String, CharterView>,
    /// Steward persona -> its project, `None` when it stewards several.
    steward_project: HashMap<String, Option<String>>,
}

impl LaneBook {
    pub(crate) fn load(pool: &DbPool) -> Result<Self, AppError> {
        Ok(Self::from_summaries(mandates::list(pool)?))
    }

    pub(crate) fn from_summaries(summaries: Vec<MandateSummary>) -> Self {
        let mut by_project: HashMap<String, CharterView> = HashMap::new();
        let mut steward_project: HashMap<String, Option<String>> = HashMap::new();
        for s in &summaries {
            let Some(status) = CharterStatus::parse(&s.status) else {
                continue;
            };
            let view = CharterView {
                charter_id: s.charter_id.clone(),
                status,
                envelope: s.envelope.clone(),
                spend_used_usd: s.load.spend_used_usd,
            };
            // One project, one mandate: the active one wins; else the newest
            // (`mandates::list` orders newest first within a project).
            match by_project.get(&s.project_id) {
                Some(existing) if existing.status == CharterStatus::Active => {}
                Some(_) if status != CharterStatus::Active => {}
                _ => {
                    by_project.insert(s.project_id.clone(), view);
                }
            }
            steward_project
                .entry(s.steward_persona_id.clone())
                .and_modify(|p| {
                    if p.as_deref() != Some(s.project_id.as_str()) {
                        *p = None;
                    }
                })
                .or_insert_with(|| Some(s.project_id.clone()));
        }
        Self {
            summaries,
            by_project,
            steward_project,
        }
    }

    pub(crate) fn charter(&self, project_id: Option<&str>) -> Option<&CharterView> {
        project_id.and_then(|p| self.by_project.get(p))
    }

    /// The project a persona's item belongs to: the one it stewards, when it
    /// stewards exactly one. Any other persona's item has no project here.
    pub(crate) fn project_of_persona(&self, persona_id: &str) -> Option<String> {
        self.steward_project.get(persona_id).cloned().flatten()
    }

    pub(crate) fn route(&self, item: &RouteInput) -> Route {
        mandate_router::route(item, self.charter(item.project_id.as_deref()))
    }

    pub(crate) fn route_without_act(&self, item: &RouteInput) -> Route {
        mandate_router::route_without_act(item, self.charter(item.project_id.as_deref()))
    }

    /// Signed, active charters whose envelope holds at least one scope the
    /// router files under. Empty on a machine where nothing is signed.
    fn filing_charters(&self) -> Vec<(&MandateSummary, &CharterView)> {
        self.summaries
            .iter()
            .filter_map(|s| {
                let v = self.by_project.get(&s.project_id)?;
                (v.charter_id == s.charter_id
                    && v.status == CharterStatus::Active
                    && v.envelope.is_signed()
                    && ROUTER_SCOPES.iter().any(|sc| v.envelope.permits(*sc)))
                .then_some((s, v))
            })
            .collect()
    }
}

const ROUTER_SCOPES: [DecideScope; 3] = [
    DecideScope::ReportRead,
    DecideScope::ReviewInfo,
    DecideScope::IncidentTriage,
];

// ---------------------------------------------------------------------------
// Item mappers (shared with the snapshot)
// ---------------------------------------------------------------------------

fn context_json(raw: Option<&str>) -> Option<serde_json::Value> {
    raw.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
}

fn lower(s: &str) -> Option<String> {
    let t = s.trim().to_ascii_lowercase();
    (!t.is_empty()).then_some(t)
}

pub(crate) fn review_input(r: &PersonaManualReview, book: &LaneBook) -> RouteInput {
    let ctx = context_json(r.context_data.as_deref());
    let ctx_str = |k: &str| {
        ctx.as_ref()
            .and_then(|v| v.get(k))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let source = ctx_str("source");
    let mut i = RouteInput::new(RouteKind::Review, r.id.clone());
    i.project_id = ctx_str("projectId").or_else(|| book.project_of_persona(&r.persona_id));
    i.severity = lower(&r.severity);
    i.binding = r.assignment_id.is_some()
        || r.step_id.is_some()
        || source
            .as_deref()
            .is_some_and(|s| BINDING_REVIEW_SOURCES.contains(&s));
    i
}

pub(crate) fn report_input(r: &PersonaReport, book: &LaneBook) -> RouteInput {
    let mut i = RouteInput::new(RouteKind::Report, r.id.clone());
    i.project_id = book.project_of_persona(&r.persona_id);
    i
}

pub(crate) fn incident_input(r: &AuditIncident, book: &LaneBook) -> RouteInput {
    let mut i = RouteInput::new(RouteKind::Incident, r.id.clone());
    i.project_id = r
        .persona_id
        .as_deref()
        .and_then(|p| book.project_of_persona(p));
    i.severity = lower(&r.severity);
    i
}

/// What a companion approval would do that cannot be taken back, read from
/// its action - a member of the dispatcher's CLOSED op catalog
/// (`companion::dispatcher::catalog::ALLOWED_ACTIONS`). Only ops whose
/// meaning IS the class are mapped; every other op, and any op outside the
/// catalog, is `None` (unknown, not safe).
///
/// Deliberately unmapped: `use_connector` (its capability is a free slug,
/// not a closed type, so a send cannot be told from a read here),
/// `browser_act` (a page write is not necessarily a message), `fleet_kill`
/// (ends a process, deletes no record), and every cost-bearing op
/// (`run_persona`, `assign_team`, `fleet_spawn`, ...): none is a `spend`
/// against the mandate's cap.
pub(crate) fn approval_irreversible(action: &str) -> Option<Irreversible> {
    match action.trim() {
        "delete_fact" | "delete_procedural" | "delete_goal" | "delete_ritual" => {
            Some(Irreversible::Deletion)
        }
        // Applies a backend run's branch to the live checkout.
        "dev_merge" => Some(Irreversible::Merge),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

/// The review door the sweep approves through. Production goes through the
/// full resolution (`commands::design::reviews::resolve_manual_review`: the
/// status CAS, its learned memory, the events, the team-step resume); tests
/// use the pool-level chokepoint the full door also calls first.
pub(crate) trait ReviewDoor: Send + Sync {
    fn approve(&self, review_id: &str, notes: String) -> Result<(), AppError>;
}

/// The chokepoint write alone (`manual_reviews::update_status`).
pub(crate) struct PoolReviewDoor<'a>(pub(crate) &'a DbPool);

impl ReviewDoor for PoolReviewDoor<'_> {
    fn approve(&self, review_id: &str, notes: String) -> Result<(), AppError> {
        manual_reviews::update_status(self.0, review_id, ManualReviewStatus::Approved, Some(notes))
            .map(|_| ())
    }
}

/// The desk's own Approve, with every side effect.
pub(crate) struct AppReviewDoor(pub(crate) tauri::AppHandle);

impl ReviewDoor for AppReviewDoor {
    fn approve(&self, review_id: &str, notes: String) -> Result<(), AppError> {
        use tauri::Manager;
        let state = self.0.state::<std::sync::Arc<crate::AppState>>();
        crate::commands::design::reviews::resolve_manual_review(
            &state,
            &self.0,
            review_id,
            ManualReviewStatus::Approved,
            Some(notes),
        )
        .map(|_| ())
    }
}

/// Apply one router act through its door. `Ok(false)` = the door found
/// nothing to do (someone acted first): no act is recorded.
fn apply_door(
    pool: &DbPool,
    reviews: &dyn ReviewDoor,
    act: RouterAct,
    item_id: &str,
    notes: &str,
) -> Result<bool, AppError> {
    match act {
        RouterAct::MarkReportRead => reports::mark_as_read(pool, item_id).map(|_| true),
        RouterAct::AcknowledgeIncident => audit_incidents::acknowledge(pool, item_id),
        RouterAct::ApproveReview => reviews.approve(item_id, notes.to_string()).map(|_| true),
    }
}

/// The inverse door, where one exists. `Ok(false)` = nothing to undo.
fn undo_door(pool: &DbPool, act: RouterAct, item_id: &str) -> Result<bool, AppError> {
    match act {
        RouterAct::MarkReportRead => reports::mark_as_unread(pool, item_id),
        RouterAct::AcknowledgeIncident => {
            let inc = audit_incidents::get_by_id(pool, item_id)?;
            if inc.status != "acknowledged" {
                return Err(AppError::Validation(format!(
                    "Incident {item_id} is {} now, not acknowledged: something acted on it \
                     after the router, so reopening it would undo that too",
                    inc.status
                )));
            }
            audit_incidents::reopen(pool, item_id)
        }
        RouterAct::ApproveReview => Err(AppError::Forbidden(format!(
            "Review {item_id} cannot return to pending: no door reverses an approval"
        ))),
    }
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/// What one sweep did.
#[derive(Debug, Default)]
pub(crate) struct SweepReport {
    /// The acts recorded (the caller emits each).
    pub acts: Vec<CharterAct>,
    /// Items routed.
    pub considered: usize,
    /// Items skipped because an act (standing or reverted) already exists.
    pub already_acted: usize,
    /// Items whose gate refused, whose door failed or whose act failed.
    pub failed: usize,
}

/// One sweep at a time per process (the boot run and the tick may overlap).
static SWEEPING: AtomicBool = AtomicBool::new(false);

/// Run the sweep once. Returns an empty report when another sweep is running
/// or the mandates cannot be read (logged).
pub(crate) fn sweep(pool: &DbPool, reviews: &dyn ReviewDoor) -> SweepReport {
    if SWEEPING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        tracing::debug!("mandate sweep: another sweep is running; skipped");
        return SweepReport::default();
    }
    // Released on every exit, a panic included, or the sweep would never run
    // again in this process.
    struct Release;
    impl Drop for Release {
        fn drop(&mut self) {
            SWEEPING.store(false, Ordering::SeqCst);
        }
    }
    let _release = Release;
    sweep_unlatched(pool, reviews)
}

/// One candidate: what the router saw, and the source row's label.
struct Candidate {
    input: RouteInput,
    title: String,
}

/// The sweep body without the process latch. Production goes through
/// [`sweep`]; tests call this so parallel test threads do not skip each other.
pub(crate) fn sweep_unlatched(pool: &DbPool, reviews: &dyn ReviewDoor) -> SweepReport {
    let mut out = SweepReport::default();
    let book = match LaneBook::load(pool) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = %e, "mandate sweep: mandates unreadable; nothing filed");
            return out;
        }
    };
    let filing = book.filing_charters();
    if filing.is_empty() {
        return out;
    }

    let mut candidates: Vec<Candidate> = Vec::new();
    for (s, v) in &filing {
        let steward = s.steward_persona_id.as_str();
        if v.envelope.permits(DecideScope::ReportRead) {
            match reports::list_unread(pool, Some(steward), Some(SCAN_CAP)) {
                Ok(rows) => candidates.extend(rows.iter().map(|r| Candidate {
                    input: report_input(r, &book),
                    title: r.title.clone().unwrap_or_default(),
                })),
                Err(e) => tracing::warn!(charter_id = %s.charter_id, error = %e,
                    "mandate sweep: reports unreadable"),
            }
        }
        if v.envelope.permits(DecideScope::IncidentTriage) {
            match open_incidents(pool, steward) {
                Ok(rows) => candidates.extend(rows.iter().map(|r| Candidate {
                    input: incident_input(r, &book),
                    title: r.title.clone(),
                })),
                Err(e) => tracing::warn!(charter_id = %s.charter_id, error = %e,
                    "mandate sweep: incidents unreadable"),
            }
        }
        if v.envelope.permits(DecideScope::ReviewInfo) {
            match pending_reviews(pool, steward) {
                Ok(rows) => candidates.extend(rows.iter().map(|r| Candidate {
                    input: review_input(r, &book),
                    title: r.title.clone(),
                })),
                Err(e) => tracing::warn!(charter_id = %s.charter_id, error = %e,
                    "mandate sweep: reviews unreadable"),
            }
        }
    }

    // Idempotency, one read per kind.
    let mut acted: HashMap<&'static str, HashMap<String, charter_acts::ItemActState>> =
        HashMap::new();
    for act in [
        RouterAct::MarkReportRead,
        RouterAct::ApproveReview,
        RouterAct::AcknowledgeIncident,
    ] {
        let ids: Vec<String> = candidates
            .iter()
            .filter(|c| c.input.kind.wire() == act.item_kind())
            .map(|c| c.input.item_id.clone())
            .collect();
        match charter_acts::item_act_states(pool, act.item_kind(), &ids) {
            Ok(m) => {
                acted.insert(act.item_kind(), m);
            }
            Err(e) => {
                // Without the log the sweep cannot prove an item is fresh:
                // it files nothing of this kind rather than file twice.
                tracing::warn!(kind = act.item_kind(), error = %e,
                    "mandate sweep: act log unreadable; this kind is skipped");
                out.failed += ids.len();
                acted.insert(
                    act.item_kind(),
                    ids.into_iter()
                        .map(|id| (id, charter_acts::ItemActState::Reverted))
                        .collect(),
                );
            }
        }
    }

    for c in candidates {
        if out.acts.len() >= MAX_ACTS_PER_SWEEP {
            break;
        }
        out.considered += 1;
        let route = book.route(&c.input);
        let Some(act) = route.act else {
            continue;
        };
        if acted
            .get(act.item_kind())
            .is_some_and(|m| m.contains_key(&c.input.item_id))
        {
            out.already_acted += 1;
            continue;
        }
        match file_one(pool, reviews, &c, &route, act) {
            Ok(Some(recorded)) => {
                acted.entry(act.item_kind()).or_default().insert(
                    c.input.item_id.clone(),
                    charter_acts::ItemActState::Standing {
                        act_id: recorded.id.clone(),
                    },
                );
                out.acts.push(recorded);
            }
            Ok(None) => {}
            Err(e) => {
                out.failed += 1;
                tracing::warn!(item_kind = act.item_kind(), item_id = %c.input.item_id,
                    error = %e, "mandate sweep: item not filed");
            }
        }
    }
    if !out.acts.is_empty() || out.failed > 0 {
        tracing::info!(
            filed = out.acts.len(),
            considered = out.considered,
            already_acted = out.already_acted,
            failed = out.failed,
            "mandate sweep: pass complete"
        );
    }
    out
}

fn open_incidents(pool: &DbPool, persona_id: &str) -> Result<Vec<AuditIncident>, AppError> {
    let filters = IncidentFilters {
        statuses: Some(vec!["open".to_string()]),
        severities: None,
        source_tables: None,
        persona_id: Some(persona_id.to_string()),
        since: None,
    };
    let mut out = Vec::new();
    let mut offset = 0;
    while offset < SCAN_CAP {
        let page = audit_incidents::list(pool, &filters, PAGE, offset)?;
        let n = page.len() as i64;
        out.extend(page);
        if n < PAGE {
            break;
        }
        offset += PAGE;
    }
    Ok(out)
}

fn pending_reviews(pool: &DbPool, persona_id: &str) -> Result<Vec<PersonaManualReview>, AppError> {
    let mut out: Vec<PersonaManualReview> = Vec::new();
    while (out.len() as i64) < SCAN_CAP {
        let cursor = out.last().map(|r| (r.created_at.clone(), r.id.clone()));
        let (page, more) = manual_reviews::list_page(
            pool,
            Some(persona_id),
            Some(ManualReviewStatus::Pending.as_str()),
            cursor.as_ref().map(|(c, i)| (c.as_str(), i.as_str())),
            PAGE,
        )?;
        out.extend(page);
        if !more {
            break;
        }
    }
    Ok(out)
}

/// What the router decided on, as the act's `shown_json`.
fn shown(c: &Candidate, route: &Route) -> String {
    serde_json::json!({
        "itemKind": c.input.kind.wire(),
        "itemId": c.input.item_id,
        "title": c.title,
        "projectId": c.input.project_id,
        "severity": c.input.severity,
        "binding": c.input.binding,
        "irreversible": c.input.irreversible,
        "lane": route.lane,
        "clause": route.clause,
    })
    .to_string()
}

/// Gate, door, act. `Ok(None)` when the door found nothing to do.
fn file_one(
    pool: &DbPool,
    reviews: &dyn ReviewDoor,
    c: &Candidate,
    route: &Route,
    act: RouterAct,
) -> Result<Option<CharterAct>, AppError> {
    // Belt and braces: the router never proposes an act for these.
    if c.input.irreversible.is_some() {
        return Ok(None);
    }
    let project = c.input.project_id.as_deref().unwrap_or_default();
    let grant = personas_engine::autonomy::mandate_permits_scope_for(pool, project, act.scope())
        .map_err(|r| AppError::Forbidden(format!("mandate gate refused: {r:?}")))?;
    if route.charter_id.as_deref() != Some(grant.charter_id.as_str()) {
        return Err(AppError::Validation(format!(
            "router charter {:?} is not the granting charter {}",
            route.charter_id, grant.charter_id
        )));
    }
    let notes = format!(
        "Filed by the router under mandate {} (envelope v{}, scope {})",
        grant.charter_id,
        grant.envelope_version,
        act.scope().as_str()
    );
    if !apply_door(pool, reviews, act, &c.input.item_id, &notes)? {
        return Ok(None);
    }
    let record = NewCharterAct {
        charter_id: grant.charter_id.clone(),
        item_kind: act.item_kind().to_string(),
        item_id: c.input.item_id.clone(),
        verdict: act.verdict().to_string(),
        actor: CharterActor::Router,
        scope: Some(act.scope()),
        reversible: act.reversible(),
        cost_usd: None,
        shown_json: Some(shown(c, route)),
        origin_device: None,
    };
    match charter_acts::append(pool, &record) {
        Ok(created) => {
            if created.envelope_version != grant.envelope_version {
                tracing::warn!(act_id = %created.id, granted = grant.envelope_version,
                    recorded = created.envelope_version,
                    "mandate sweep: the envelope moved between the grant and the act");
            }
            Ok(Some(created))
        }
        Err(e) => {
            // Compensate: the door acted but no act records it.
            match undo_door(pool, act, &c.input.item_id) {
                Ok(_) => tracing::warn!(item_id = %c.input.item_id, error = %e,
                    "mandate sweep: act not recorded; the door was undone"),
                Err(undo) => tracing::error!(item_id = %c.input.item_id, error = %e,
                    undo_error = %undo,
                    "mandate sweep: act not recorded AND the door could not be undone"),
            }
            Err(e)
        }
    }
}

// ---------------------------------------------------------------------------
// Revert: the inverse door, then the record
// ---------------------------------------------------------------------------

/// `charter_act_revert`'s body. For a standing, reversible ROUTER act the
/// inverse door runs first (report back to unread, incident reopened); then
/// `mandates::revert` records the revert. If recording fails, the forward door
/// is re-applied so the source row and the log agree again. Every other act
/// (envelope acts, steward and operator acts, an irreversible router act) goes
/// straight to `mandates::revert`, which owns the typed refusals.
pub(crate) fn revert_with_undo(pool: &DbPool, act_id: &str) -> Result<CharterAct, AppError> {
    let undone = match charter_acts::get(pool, act_id)? {
        Some(a) if a.actor == CharterActor::Router && a.reverted_at.is_none() && a.reversible => {
            match RouterAct::from_item_kind(&a.item_kind) {
                Some(kind) => {
                    undo_door(pool, kind, &a.item_id)?;
                    Some((kind, a.item_id))
                }
                None => None,
            }
        }
        _ => None,
    };
    match mandates::revert(pool, act_id, None) {
        Ok(created) => Ok(created),
        Err(e) => {
            if let Some((kind, item_id)) = undone {
                if let Err(redo) = apply_door(pool, &PoolReviewDoor(pool), kind, &item_id, "") {
                    tracing::error!(act_id, item_id = %item_id, error = %redo,
                        "mandate revert: refused after the undo, and the redo failed");
                }
            }
            Err(e.into())
        }
    }
}

/// Run one sweep on the blocking pool and announce every act it recorded.
/// The hosting tick and the boot run both come through here.
pub(crate) async fn sweep_and_emit(pool: DbPool, app: tauri::AppHandle) {
    let door_app = app.clone();
    let joined = tokio::task::spawn_blocking(move || sweep(&pool, &AppReviewDoor(door_app))).await;
    match joined {
        Ok(report) => {
            for act in &report.acts {
                crate::commands::core::mandates::emit_act_recorded(&app, act);
            }
        }
        Err(e) => tracing::warn!(error = %e, "mandate sweep: task failed"),
    }
}

#[cfg(test)]
mod tests;
