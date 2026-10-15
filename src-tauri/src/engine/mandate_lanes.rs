//! **`decision_lanes_snapshot`** (spark `mandate-lanes`, WP3): every pending
//! item the Decision Center shows, with the lane the router gives it - so the
//! frontend joins on `itemId` and never routes anything itself.
//!
//! Item ids are EXACTLY the frontend `DecisionItem.id` schemes
//! (`roster/decisionAdapters.ts`, `quick-answer/triage/triageAdapters.ts`):
//! `review:<id>`, `idea:<id>`, `incident:<id>`, `report:<id>`,
//! `council:<subjectId>`, `approval:<id>`, `policy:<id>`, `evolution:<id>`,
//! `goal:<goal_id>`, plus `mandate:<charterId>` for a draft charter's Sign entry
//! and `mandate-reread:<charterId>` for a signed mandate whose use asks to be
//! read again (WP6, `engine::mandate_reread_view`).
//!
//! The routing itself is [`routed`]: every pending item read and routed ONCE,
//! which the snapshot, the re-read, the Scopes section and the orphanage all
//! build on, so they never disagree about where an item went. Items archived
//! from the Orphans lane (`orphan_archive`, WP6) are left out of it while they
//! are still orphans.
//!
//! **Not in the snapshot, by design:** build-session questions
//! (`question:<sessionId>:<keys>`) and chat threads (`message`) are derived on
//! the frontend from live session and channel state the backend does not hold
//! as rows; their lane is the kind's fixed one (`question` -> breach,
//! `message` -> talk) and WP4 applies it there. Cloud reviews (`source:
//! 'cloud'`) live in the cloud relay, not in `persona_manual_reviews`.
//!
//! A source that fails to load is named in `failedSources`; its items are
//! absent, which the frontend must render as FAILED, never as zero
//! (triage-queues standard). The mandates themselves are not optional: without
//! them no lane can be computed, so their failure fails the whole command.

use std::collections::HashMap;

use personas_engine::mandate_router::{
    DecisionLanesSnapshot, Lane, LaneCharter, LaneClause, LaneEntry, Route, RouteInput, RouteKind,
    RouterAct,
};

use crate::db::models::{IncidentFilters, MandateReread, MandateSummary};
use crate::db::repos::communication::{manual_reviews, reports};
use crate::db::repos::core::charter_acts::{self, ItemActState};
use crate::db::repos::core::orphan_archive;
use crate::db::repos::dev::council;
use crate::db::repos::dev_tools;
use crate::db::repos::execution::{audit_incidents, policy_proposals};
use crate::db::repos::lab::evolution_proposals;
use crate::db::{DbPool, UserDbPool};
use crate::engine::mandate_sweep::{
    approval_irreversible, incident_input, report_input, review_input, LaneBook,
};
use crate::error::AppError;

/// The same working sets the Decision Center reads.
const REVIEW_LIMIT: i64 = 100; // MONITOR_REVIEW_LIMIT
const REPORT_LIMIT: i64 = 50; // useDecisionSources REPORT_LIMIT
const INCIDENT_LIMIT: i64 = 100; // useDecisionSources INCIDENT_LIMIT
const PROPOSAL_LIMIT: u32 = 50; // useUnifiedTriage PROPOSAL_PAGE_SIZE
/// The triage deck pages ideas; the lanes count every pending one up to this.
const IDEA_LIMIT: i64 = 500;
/// `incident:` items are open while in one of these (`OPEN_INCIDENT_STATUSES`).
const OPEN_INCIDENT_STATUSES: [&str; 3] = ["open", "acknowledged", "in_progress"];

/// Source names as `failedSources` reports them.
pub(crate) mod source {
    pub const REVIEWS: &str = "reviews";
    pub const IDEAS: &str = "ideas";
    pub const POLICY: &str = "policy";
    pub const EVOLUTION: &str = "evolution";
    pub const GOALS: &str = "goals";
    pub const INCIDENTS: &str = "incidents";
    pub const REPORTS: &str = "reports";
    pub const COUNCIL: &str = "council";
    pub const APPROVALS: &str = "approvals";
    /// The act log: without it, filed items cannot be told from fresh ones.
    pub const ACTS: &str = "acts";
    /// The orphan archive: without it, archived orphans would reappear.
    pub const ARCHIVE: &str = "archive";
}

/// Whether a council subject waits on the operator NOW. A Rust copy of the
/// frontend gate rule `decidable()` (`curator/council/councilRules.ts`):
/// `ready`, a MAJOR use case or an architecture subject, from a full round.
/// Tethered by `council_gate_matches_the_frontend_rule`, which reads the TS.
pub(crate) fn council_decidable(
    state: &str,
    tier: Option<&str>,
    kind: &str,
    mode: Option<&str>,
) -> bool {
    state == "ready" && (tier == Some("major") || kind == "architecture") && mode != Some("lite")
}

/// One item before routing: its frontend id, what the router reads, and
/// what a reader of the orphanage and the Scopes section is shown.
struct Pending {
    id: String,
    input: RouteInput,
    title: Option<String>,
    created_at: Option<String>,
    /// The persona that raised it, where the source names one.
    persona_id: Option<String>,
}

impl Pending {
    fn new(id: String, input: RouteInput) -> Self {
        Self {
            id,
            input,
            title: None,
            created_at: None,
            persona_id: None,
        }
    }

    fn by(mut self, persona_id: &str) -> Self {
        self.persona_id = Some(persona_id.to_string());
        self
    }

    fn shown(mut self, title: Option<&str>, created_at: Option<&str>) -> Self {
        self.title = title
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string);
        self.created_at = created_at.map(str::to_string);
        self
    }
}

fn project_input(kind: RouteKind, id: &str, project_id: Option<&str>) -> RouteInput {
    let mut i = RouteInput::new(kind, id);
    i.project_id = project_id
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string);
    i
}

/// Read every source into `out`, naming each one that failed.
fn collect(
    pool: &DbPool,
    user_db: &UserDbPool,
    book: &LaneBook,
    out: &mut Vec<Pending>,
    failed: &mut Vec<String>,
) {
    let mut fail = |name: &str, e: AppError| {
        tracing::warn!(source = name, error = %e, "decision_lanes_snapshot: source failed");
        failed.push(name.to_string());
    };

    match manual_reviews::list_page(pool, None, Some("pending"), None, REVIEW_LIMIT) {
        Ok((rows, _)) => out.extend(rows.iter().map(|r| {
            Pending::new(format!("review:{}", r.id), review_input(r, book))
                .shown(Some(&r.title), Some(&r.created_at))
                .by(&r.persona_id)
        })),
        Err(e) => fail(source::REVIEWS, e),
    }
    match dev_tools::list_ideas(pool, None, Some("pending"), None, Some(IDEA_LIMIT), None) {
        Ok(rows) => out.extend(rows.iter().map(|r| {
            Pending::new(
                format!("idea:{}", r.id),
                project_input(RouteKind::Idea, &r.id, r.project_id.as_deref()),
            )
            .shown(Some(&r.title), Some(&r.created_at))
        })),
        Err(e) => fail(source::IDEAS, e),
    }
    match policy_proposals::list(pool, true, PROPOSAL_LIMIT) {
        // A policy proposal is fleet-wide: it belongs to no project.
        Ok(rows) => out.extend(rows.iter().map(|r| {
            Pending::new(
                format!("policy:{}", r.id),
                RouteInput::new(RouteKind::Policy, r.id.clone()),
            )
            .shown(None, Some(&r.created_at))
        })),
        Err(e) => fail(source::POLICY, e),
    }
    match evolution_proposals::list(pool, None, Some("pending"), i64::from(PROPOSAL_LIMIT)) {
        Ok(rows) => out.extend(rows.iter().map(|r| {
            let mut input = RouteInput::new(RouteKind::Evolution, r.id.clone());
            input.project_id = book.project_of_persona(&r.persona_id);
            Pending::new(format!("evolution:{}", r.id), input).by(&r.persona_id)
        })),
        Err(e) => fail(source::EVOLUTION, e),
    }
    match dev_tools::list_pending_acceptance(pool) {
        Ok(rows) => out.extend(rows.iter().map(|r| {
            Pending::new(
                format!("goal:{}", r.goal_id),
                project_input(RouteKind::GoalClaim, &r.goal_id, Some(&r.project_id)),
            )
            .shown(Some(&r.title), r.completed_at.as_deref())
        })),
        Err(e) => fail(source::GOALS, e),
    }
    let incident_filters = IncidentFilters {
        statuses: Some(
            OPEN_INCIDENT_STATUSES
                .iter()
                .map(|s| s.to_string())
                .collect(),
        ),
        severities: None,
        source_tables: None,
        persona_id: None,
        since: None,
    };
    match audit_incidents::list(pool, &incident_filters, INCIDENT_LIMIT, 0) {
        Ok(rows) => out.extend(rows.iter().map(|r| {
            Pending::new(format!("incident:{}", r.id), incident_input(r, book))
                .shown(Some(&r.title), Some(&r.created_at))
        })),
        Err(e) => fail(source::INCIDENTS, e),
    }
    match reports::list_unread(pool, None, Some(REPORT_LIMIT)) {
        Ok(rows) => out.extend(rows.iter().map(|r| {
            Pending::new(format!("report:{}", r.id), report_input(r, book))
                .shown(r.title.as_deref(), Some(&r.created_at))
        })),
        Err(e) => fail(source::REPORTS, e),
    }
    match council::list_subject_states(pool, None) {
        Ok(rows) => out.extend(
            rows.iter()
                .filter(|s| {
                    council_decidable(&s.state, s.tier.as_deref(), &s.kind, s.mode.as_deref())
                })
                .map(|s| {
                    Pending::new(
                        format!("council:{}", s.id),
                        project_input(RouteKind::Council, &s.id, Some(&s.project_id)),
                    )
                    .shown(Some(&s.title), None)
                }),
        ),
        Err(e) => fail(source::COUNCIL, e),
    }
    match crate::commands::companion::approvals::pending_approval_rows(user_db) {
        // Athena's approvals belong to no project; a valve among them still
        // reaches the operator one at a time (the router's rule 3).
        Ok(rows) => out.extend(rows.iter().map(|r| {
            let mut input = RouteInput::new(RouteKind::Approval, r.id.clone());
            input.irreversible = approval_irreversible(&r.action);
            Pending::new(format!("approval:{}", r.id), input)
        })),
        Err(e) => fail(source::APPROVALS, e),
    }
}

/// The lane of one item given what the act log says about it.
fn lane_of(book: &LaneBook, input: &RouteInput, acted: Option<&ItemActState>) -> Route {
    match acted {
        // Filed (by the router or inside the envelope): it is evidence now,
        // even when its source still lists it (an acknowledged incident).
        Some(ItemActState::Standing { .. }) => {
            let r = book.route_without_act(input);
            let key = match &r.charter_id {
                Some(c) => format!("{c}:evidence:none"),
                None => r.coalesce_key.clone(),
            };
            Route {
                lane: Lane::Evidence,
                clause: LaneClause::None,
                charter_id: r.charter_id,
                coalesce_key: key,
                act: None,
            }
        }
        // The operator took the router's act back: never re-acted.
        Some(ItemActState::Reverted) => book.route_without_act(input),
        None => book.route(input),
    }
}

/// One pending item with the lane the router (and the act log) gave it.
pub(crate) struct RoutedItem {
    /// EXACTLY the frontend `DecisionItem.id`.
    pub(crate) id: String,
    pub(crate) input: RouteInput,
    pub(crate) route: Route,
    pub(crate) title: Option<String>,
    pub(crate) created_at: Option<String>,
    pub(crate) persona_id: Option<String>,
}

/// Every pending item routed once, with the book it was routed against.
pub(crate) struct Routed {
    pub(crate) book: LaneBook,
    pub(crate) items: Vec<RoutedItem>,
    pub(crate) failed: Vec<String>,
}

/// Read and route every pending item. `Err` only when the mandates cannot be read.
pub(crate) fn routed(pool: &DbPool, user_db: &UserDbPool) -> Result<Routed, AppError> {
    let book = LaneBook::load(pool)?;
    let mut pending = Vec::new();
    let mut failed = Vec::new();
    collect(pool, user_db, &book, &mut pending, &mut failed);

    // The act log, read once per kind the router files.
    let mut acts: HashMap<&'static str, HashMap<String, ItemActState>> = HashMap::new();
    for act in [
        RouterAct::MarkReportRead,
        RouterAct::ApproveReview,
        RouterAct::AcknowledgeIncident,
    ] {
        let kind = act.item_kind();
        let ids: Vec<String> = pending
            .iter()
            .filter(|p| p.input.kind.wire() == kind)
            .map(|p| p.input.item_id.clone())
            .collect();
        match charter_acts::item_act_states(pool, kind, &ids) {
            Ok(m) => {
                acts.insert(kind, m);
            }
            Err(e) => {
                tracing::warn!(kind, error = %e, "decision_lanes_snapshot: act log unreadable");
                if !failed.iter().any(|f| f == source::ACTS) {
                    failed.push(source::ACTS.to_string());
                }
            }
        }
    }

    let archived = orphan_archive::archived_ids(pool).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "decision_lanes_snapshot: orphan archive unreadable");
        failed.push(source::ARCHIVE.to_string());
        Default::default()
    });

    let items = pending
        .into_iter()
        .filter_map(|p| {
            let acted = acts
                .get(p.input.kind.wire())
                .and_then(|m| m.get(&p.input.item_id));
            let route = lane_of(&book, &p.input, acted);
            // Archived from the Orphans lane: out of every lane while it is
            // still an orphan. Once a mandate holds its project it routes again.
            if route.lane == Lane::Orphan && archived.contains(&p.id) {
                return None;
            }
            Some(RoutedItem {
                id: p.id,
                input: p.input,
                route,
                title: p.title,
                created_at: p.created_at,
                persona_id: p.persona_id,
            })
        })
        .collect();
    Ok(Routed {
        book,
        items,
        failed,
    })
}

/// `mandate-reread:<charterId>`: a signed mandate asking to be read again.
pub(crate) const REREAD_PREFIX: &str = "mandate-reread:";

/// Build the snapshot. `Err` only when the mandates cannot be read.
pub(crate) fn build_snapshot(
    pool: &DbPool,
    user_db: &UserDbPool,
) -> Result<DecisionLanesSnapshot, AppError> {
    let r = routed(pool, user_db)?;
    let rereads = crate::engine::mandate_reread_view::rereads(pool, &r);
    let mut snapshot = snapshot_of(r, &rereads);
    // Mandates mirrored from their home device (WP9) are never routed here:
    // this device holds none of their items. Only their Sign entries join,
    // so a draft or a re-read waiting on the home shows in this device's
    // lanes too, and a verdict on it is sent home.
    match crate::db::repos::core::charter_mirror::list(pool) {
        Ok(mirrored) => add_mirrored(&mut snapshot, &mirrored),
        Err(e) => {
            tracing::warn!(error = %e, "lanes: mirrored mandates unreadable");
            snapshot.failed_sources.push("mirrored_mandates".into());
        }
    }
    Ok(snapshot)
}

/// The Sign entries of mirrored mandates: a draft, or a signed one whose home
/// asked for a re-read. Their charters count nothing held (their items are on
/// the home device). A charter id the snapshot already holds is left alone:
/// a home never takes a mirror of its own charter.
pub(crate) fn add_mirrored(snapshot: &mut DecisionLanesSnapshot, mirrored: &[MandateSummary]) {
    for s in mirrored {
        if snapshot
            .charters
            .iter()
            .any(|c| c.charter_id == s.charter_id)
        {
            continue;
        }
        let sign = |item_id: String, why: &str| LaneEntry {
            item_id,
            item_kind: "mandate".to_string(),
            lane: Lane::Sign,
            clause: LaneClause::None,
            charter_id: Some(s.charter_id.clone()),
            coalesce_key: format!("{}:sign:{why}", s.charter_id),
            irreversible: None,
            project_id: Some(s.project_id.clone()),
        };
        if s.status == "draft" {
            snapshot
                .items
                .push(sign(format!("mandate:{}", s.charter_id), "none"));
        } else if s.reread.is_some() {
            snapshot
                .items
                .push(sign(format!("{REREAD_PREFIX}{}", s.charter_id), "reread"));
        }
        snapshot.charters.push(LaneCharter {
            charter_id: s.charter_id.clone(),
            project_id: s.project_id.clone(),
            status: s.status.clone(),
            envelope_version: s.envelope.envelope_version,
            held: 0,
        });
    }
}

fn snapshot_of(r: Routed, rereads: &HashMap<String, MandateReread>) -> DecisionLanesSnapshot {
    let Routed {
        book,
        items: routed,
        failed,
    } = r;
    let mut held: HashMap<String, u32> = HashMap::new();
    let mut items: Vec<LaneEntry> = Vec::with_capacity(routed.len());
    for p in routed {
        let r = p.route;
        if r.lane == Lane::Held {
            if let Some(c) = &r.charter_id {
                *held.entry(c.clone()).or_default() += 1;
            }
        }
        items.push(LaneEntry {
            item_id: p.id,
            item_kind: p.input.kind.wire().to_string(),
            lane: r.lane,
            clause: r.clause,
            charter_id: r.charter_id,
            coalesce_key: r.coalesce_key,
            irreversible: p.input.irreversible,
            project_id: p.input.project_id,
        });
    }

    // A draft mandate waits for its signature.
    for s in book.summaries.iter().filter(|s| s.status == "draft") {
        items.push(LaneEntry {
            item_id: format!("mandate:{}", s.charter_id),
            item_kind: "mandate".to_string(),
            lane: Lane::Sign,
            clause: LaneClause::None,
            charter_id: Some(s.charter_id.clone()),
            coalesce_key: format!("{}:sign:none", s.charter_id),
            irreversible: None,
            project_id: Some(s.project_id.clone()),
        });
    }
    // A signed mandate whose use asks for a second reading (WP6).
    for s in book
        .summaries
        .iter()
        .filter(|s| rereads.contains_key(&s.charter_id))
    {
        items.push(LaneEntry {
            item_id: format!("{REREAD_PREFIX}{}", s.charter_id),
            item_kind: "mandate".to_string(),
            lane: Lane::Sign,
            clause: LaneClause::None,
            charter_id: Some(s.charter_id.clone()),
            coalesce_key: format!("{}:sign:reread", s.charter_id),
            irreversible: None,
            project_id: Some(s.project_id.clone()),
        });
    }

    let charters = book
        .summaries
        .iter()
        .map(|s| LaneCharter {
            charter_id: s.charter_id.clone(),
            project_id: s.project_id.clone(),
            status: s.status.clone(),
            envelope_version: s.envelope.envelope_version,
            held: held.get(&s.charter_id).copied().unwrap_or(0),
        })
        .collect();

    DecisionLanesSnapshot {
        items,
        charters,
        failed_sources: failed,
        generated_at: chrono::Utc::now().to_rfc3339(),
    }
}

#[cfg(test)]
mod tests;
