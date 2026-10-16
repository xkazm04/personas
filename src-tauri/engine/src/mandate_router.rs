//! **The mandate router** (spark `mandate-lanes`, WP3): one pure function that
//! decides where a pending decision item goes - which lane the operator sees
//! it in, under which clause, and whether the deterministic router may file it
//! on its own.
//!
//! It is the prototype's `route()` law (`docs/design/mandate-lanes/prototype/model.js`)
//! ported once, here, and shipped on the payload (`decision_lanes_snapshot`):
//! the frontend never re-implements it.
//!
//! No IO. The caller resolves the item's project and that project's charter,
//! then asks [`route`]. A router act this function returns is a PROPOSAL: the
//! app-side sweep still answers at the gate (`autonomy::mandate_permits_scope_for`)
//! before it calls any door, and records the act in `charter_acts`.
//!
//! The order of the law, top to bottom (first match wins):
//!
//! 1. `message` -> `talk` (never coalesces).
//! 2. `goal` CLAIMS (a goal `awaiting_acceptance`) -> `accept` / `none`: the
//!    operator accepts what a mandate claims is met, whoever holds the project.
//!    The lens-scan cards (`build`, `evidence`, `release`; spark
//!    one-control) take their fixed row the same way: no mandate ever acts on
//!    a lens-scan item, signed or not (the keep-out).
//! 3. A **valve** (`outbound-message`, `deletion`) -> `breach` / `valve`, never
//!    coalesced: valves are never delegated and never batched (Director
//!    decision), so not even an orphaned or held one may hide in a count.
//! 4. No active charter for the item's project (or no project) -> `orphan`.
//! 5. Charter `draft` or `suspended` -> `held` (counted on the charter).
//! 6. `council` -> `accept`, always: the council never admits work.
//! 7. Unsigned envelope (`envelope_version` 0, every live charter today): the
//!    router acts on nothing. `merge` / `spend` -> `breach` / `merge` | `spend`;
//!    every other kind takes its row of [`UNSIGNED_LANE`].
//! 8. Signed envelope: `merge` follows the merge policy, `spend` the cap
//!    (neither is ever ACTED by the router - the worker or the operator acts);
//!    then the per-kind law ([`route_signed_kind`]).
//!
//! Absent-value convention: an unknown severity is NOT read as low. A review
//! or incident whose severity the router cannot name is a `risk` crossing.

use personas_db::models::{DecideScope, MandateEnvelope, MergePolicy};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Wire vocabulary (ts-rs, lowercase / kebab values)
// ---------------------------------------------------------------------------

/// Where an item reaches the operator - or does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum Lane {
    /// The item crosses the envelope: the operator decides it.
    Breach,
    /// A mandate (or a proposed intent) waits for a signature.
    Sign,
    /// Read-and-done, or a claim to accept.
    Accept,
    /// A conversation. Never coalesces.
    Talk,
    /// No active mandate holds the item's project.
    Orphan,
    /// The project's mandate is a draft or suspended: counted on it, not a card.
    Held,
    /// Inside the envelope, a judgment call: it waits for the App Master's tick.
    Steward,
    /// Filed by the router (or acted inside the envelope): the act log holds it.
    Evidence,
}

impl Lane {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Breach => "breach",
            Self::Sign => "sign",
            Self::Accept => "accept",
            Self::Talk => "talk",
            Self::Orphan => "orphan",
            Self::Held => "held",
            Self::Steward => "steward",
            Self::Evidence => "evidence",
        }
    }
}

/// Which clause of the mandate the item crossed (or `none`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum LaneClause {
    /// Stop the line: a tier-1 or high-severity incident.
    Stop,
    /// A risky review (medium and above, or a severity nobody could name).
    Risk,
    /// The kind is outside the envelope's scopes.
    Scope,
    /// A spend the cap cannot absorb (or an unsigned envelope).
    Spend,
    /// A merge the merge policy does not allow (or an unsigned envelope).
    Merge,
    /// An irreversible message or deletion: always the operator's, one at a time.
    Valve,
    /// The mandate is not signed, so nothing is delegated yet.
    Unsigned,
    None,
}

impl LaneClause {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stop => "stop",
            Self::Risk => "risk",
            Self::Scope => "scope",
            Self::Spend => "spend",
            Self::Merge => "merge",
            Self::Valve => "valve",
            Self::Unsigned => "unsigned",
            Self::None => "none",
        }
    }
}

/// What an item would do that cannot be taken back. Derived on the backend
/// only from a CLOSED source; anything else is `None` (unknown, not "safe").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum Irreversible {
    Merge,
    Spend,
    OutboundMessage,
    Deletion,
}

impl Irreversible {
    /// Outbound messages and deletions: never delegated, never batched.
    pub fn is_valve(self) -> bool {
        matches!(self, Self::OutboundMessage | Self::Deletion)
    }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/// The kind of a pending item, as the router reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RouteKind {
    Review,
    Idea,
    Question,
    /// A companion (Athena) approval.
    Approval,
    Policy,
    Evolution,
    /// A PROPOSED goal: a new intent for the mandate (signed, not decided).
    Goal,
    /// A goal `awaiting_acceptance`: the mandate claims it is met.
    GoalClaim,
    Incident,
    Report,
    Council,
    Message,
    /// Accepted work awaiting dispatch.
    Dispatch,
    /// A lens-scan product with proposals to approve or approved items to
    /// build (spark one-control). Frontend-derived; never acted by a mandate.
    LensBuild,
    /// A lens-scan product with built items awaiting triage. Never acted.
    LensEvidence,
    /// A lens-scan product with a release waiting on the operator, or
    /// accepted items no release holds. Never acted.
    LensRelease,
}

impl RouteKind {
    /// The `itemKind` the frontend's `DecisionItem` carries for this kind.
    pub fn wire(self) -> &'static str {
        match self {
            Self::Review => "review",
            Self::Idea => "idea",
            Self::Question => "question",
            Self::Approval => "approval",
            Self::Policy => "policy",
            Self::Evolution => "evolution",
            Self::Goal | Self::GoalClaim => "goal",
            Self::Incident => "incident",
            Self::Report => "report",
            Self::Council => "council",
            Self::Message => "message",
            Self::Dispatch => "dispatch",
            Self::LensBuild => "build",
            Self::LensEvidence => "evidence",
            Self::LensRelease => "release",
        }
    }

    /// A lens-scan card: decided on the blueprint sheet (or in bp), never by
    /// a mandate (the keep-out).
    pub fn is_lens_scan(self) -> bool {
        matches!(
            self,
            Self::LensBuild | Self::LensEvidence | Self::LensRelease
        )
    }
}

/// One pending item, as much of it as the law reads.
#[derive(Debug, Clone, PartialEq)]
pub struct RouteInput {
    pub kind: RouteKind,
    /// The item's own id (talk and valve items coalesce on it).
    pub item_id: String,
    /// The `dev_projects` id the item belongs to; `None` = no project.
    pub project_id: Option<String>,
    /// Lowercase severity as the source stores it (`info`, `low`, `medium`,
    /// `high`, `critical`); `None` when the source has none.
    pub severity: Option<String>,
    /// 1 = stop-the-line tier, when the source has a tier.
    pub tier: Option<u8>,
    pub irreversible: Option<Irreversible>,
    /// The verdict MOVES work beyond the item itself: a held team step, a
    /// steward's own ask, a probation packet. Such a review is never "info".
    pub binding: bool,
    /// Known cost of a `spend` item; `None` = unknown (never fits a cap).
    pub cost_usd: Option<f64>,
}

impl RouteInput {
    pub fn new(kind: RouteKind, item_id: impl Into<String>) -> Self {
        Self {
            kind,
            item_id: item_id.into(),
            project_id: None,
            severity: None,
            tier: None,
            irreversible: None,
            binding: false,
            cost_usd: None,
        }
    }
}

/// A charter's lifecycle as the router reads it. `retired` charters are not
/// mandates any more and are never passed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharterStatus {
    Draft,
    Active,
    Suspended,
}

impl CharterStatus {
    /// `None` for `retired` and anything unknown.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "draft" => Some(Self::Draft),
            "active" => Some(Self::Active),
            "suspended" => Some(Self::Suspended),
            _ => None,
        }
    }
}

/// The project's mandate, as the router reads it.
#[derive(Debug, Clone, PartialEq)]
pub struct CharterView {
    pub charter_id: String,
    pub status: CharterStatus,
    pub envelope: MandateEnvelope,
    /// Settled spend this month; `None` = unreadable (never fits a cap).
    pub spend_used_usd: Option<f64>,
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/// A filing the router may take alone, through an existing door.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RouterAct {
    /// `report.read`: mark the report read; it becomes evidence.
    MarkReportRead,
    /// `review.info`: approve an info / low review through the review door.
    ApproveReview,
    /// `incident.triage`: acknowledge a non-stop incident.
    AcknowledgeIncident,
}

impl RouterAct {
    pub fn scope(self) -> DecideScope {
        match self {
            Self::MarkReportRead => DecideScope::ReportRead,
            Self::ApproveReview => DecideScope::ReviewInfo,
            Self::AcknowledgeIncident => DecideScope::IncidentTriage,
        }
    }

    /// The `charter_acts.verdict` the act is recorded with.
    pub fn verdict(self) -> &'static str {
        match self {
            Self::MarkReportRead => "filed as evidence",
            Self::ApproveReview => "approved",
            Self::AcknowledgeIncident => "acknowledged",
        }
    }

    /// Whether an inverse door exists, i.e. whether `charter_act_revert` can
    /// restore the source row. A review has none: the review lifecycle forbids
    /// `approved -> pending` (`ManualReviewStatus::validate_transition`), so a
    /// router approval is recorded irreversible and revert refuses it.
    pub fn reversible(self) -> bool {
        match self {
            Self::MarkReportRead | Self::AcknowledgeIncident => true,
            Self::ApproveReview => false,
        }
    }

    /// `charter_acts.item_kind` of this act.
    pub fn item_kind(self) -> &'static str {
        match self {
            Self::MarkReportRead => "report",
            Self::ApproveReview => "review",
            Self::AcknowledgeIncident => "incident",
        }
    }

    pub fn from_item_kind(kind: &str) -> Option<Self> {
        [
            Self::MarkReportRead,
            Self::ApproveReview,
            Self::AcknowledgeIncident,
        ]
        .into_iter()
        .find(|a| a.item_kind() == kind)
    }
}

/// Where one item goes.
#[derive(Debug, Clone, PartialEq)]
pub struct Route {
    pub lane: Lane,
    pub clause: LaneClause,
    /// The charter the item is counted on; `None` for an orphan.
    pub charter_id: Option<String>,
    /// `{charterId}:{lane}:{clause}`; a talk or valve item uses its own id
    /// (never batched); an orphan `orphan:{projectId or "-"}` (one cluster per
    /// project, the shape the orphanage groups by).
    pub coalesce_key: String,
    /// `Some` when the router may file the item itself (the lane is then
    /// `evidence`). Never set for an irreversible item.
    pub act: Option<RouterAct>,
}

// ---------------------------------------------------------------------------
// The unsigned table
// ---------------------------------------------------------------------------

/// One row of [`UNSIGNED_LANE`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnsignedRow {
    pub kind: RouteKind,
    pub lane: Lane,
    pub clause: LaneClause,
    /// The Decision Center chip this row replaces (`decisionModel.CHIP_OF`).
    pub replaces_chip: &'static str,
}

/// The fixed lane of every kind under an UNSIGNED mandate (envelope version
/// 0 - every live charter on 2026-10-14). Nothing is delegated, so nothing is
/// acted; each kind lands where the chip it replaces used to put it in front
/// of the operator. Severity overrides (applied by [`route`], rules 6-7 of the
/// brief): a review of medium severity and above is `risk`; an incident of
/// tier 1 or high/critical severity is `stop`.
pub const UNSIGNED_LANE: &[UnsignedRow] = &[
    // `gates` chip: a person-raised review is a crossing until delegated.
    UnsignedRow {
        kind: RouteKind::Review,
        lane: Lane::Breach,
        clause: LaneClause::Unsigned,
        replaces_chip: "gates",
    },
    // `gates` chip: a CLI build question waits on the operator.
    UnsignedRow {
        kind: RouteKind::Question,
        lane: Lane::Breach,
        clause: LaneClause::Unsigned,
        replaces_chip: "gates",
    },
    // `gates` chip: Athena's approvals are never delegated by a mandate.
    UnsignedRow {
        kind: RouteKind::Approval,
        lane: Lane::Breach,
        clause: LaneClause::Unsigned,
        replaces_chip: "gates",
    },
    // `backlog` chip: accepting or rejecting an idea is a judgment call.
    UnsignedRow {
        kind: RouteKind::Idea,
        lane: Lane::Breach,
        clause: LaneClause::Unsigned,
        replaces_chip: "backlog",
    },
    // `ready` plate: dispatching accepted work.
    UnsignedRow {
        kind: RouteKind::Dispatch,
        lane: Lane::Breach,
        clause: LaneClause::Unsigned,
        replaces_chip: "ready",
    },
    // `proposals` chip: a policy change amends the mandate's world.
    UnsignedRow {
        kind: RouteKind::Policy,
        lane: Lane::Sign,
        clause: LaneClause::None,
        replaces_chip: "proposals",
    },
    // `proposals` chip: a promotion rewrites a persona.
    UnsignedRow {
        kind: RouteKind::Evolution,
        lane: Lane::Sign,
        clause: LaneClause::None,
        replaces_chip: "proposals",
    },
    // `proposals` chip: a proposed goal is a new intent to sign.
    UnsignedRow {
        kind: RouteKind::Goal,
        lane: Lane::Sign,
        clause: LaneClause::None,
        replaces_chip: "proposals",
    },
    // `proposals` chip: a met-when claim is accepted (signed or not).
    UnsignedRow {
        kind: RouteKind::GoalClaim,
        lane: Lane::Accept,
        clause: LaneClause::None,
        replaces_chip: "proposals",
    },
    // `incidents` chip.
    UnsignedRow {
        kind: RouteKind::Incident,
        lane: Lane::Breach,
        clause: LaneClause::Unsigned,
        replaces_chip: "incidents",
    },
    // `reports` chip: a report is read-and-done.
    UnsignedRow {
        kind: RouteKind::Report,
        lane: Lane::Accept,
        clause: LaneClause::None,
        replaces_chip: "reports",
    },
    // `council` chip: the council never admits; the operator decides.
    UnsignedRow {
        kind: RouteKind::Council,
        lane: Lane::Accept,
        clause: LaneClause::None,
        replaces_chip: "council",
    },
    // `chat` chip.
    UnsignedRow {
        kind: RouteKind::Message,
        lane: Lane::Talk,
        clause: LaneClause::None,
        replaces_chip: "chat",
    },
    // lens-scan (spark one-control): no chip ever carried these; the chip is
    // `decisionModel.CHIP_OF`'s light for the kind. Approving a proposal is a
    // judgment call, as an idea.
    UnsignedRow {
        kind: RouteKind::LensBuild,
        lane: Lane::Breach,
        clause: LaneClause::Unsigned,
        replaces_chip: "backlog",
    },
    // lens-scan: built work claimed done, triaged on the blueprint, as a goal claim.
    UnsignedRow {
        kind: RouteKind::LensEvidence,
        lane: Lane::Accept,
        clause: LaneClause::None,
        replaces_chip: "proposals",
    },
    // lens-scan: a release bp composes and the operator finishes.
    UnsignedRow {
        kind: RouteKind::LensRelease,
        lane: Lane::Accept,
        clause: LaneClause::None,
        replaces_chip: "proposals",
    },
];

fn unsigned_row(kind: RouteKind) -> (Lane, LaneClause) {
    UNSIGNED_LANE
        .iter()
        .find(|r| r.kind == kind)
        .map(|r| (r.lane, r.clause))
        // Every RouteKind has a row (`every_kind_has_one_unsigned_row`); a
        // missing one reaches the operator rather than vanishing.
        .unwrap_or((Lane::Breach, LaneClause::Unsigned))
}

// ---------------------------------------------------------------------------
// The law
// ---------------------------------------------------------------------------

fn severity_of(item: &RouteInput) -> Option<&str> {
    item.severity
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// A stop-the-line incident: tier 1, or high / critical severity.
fn is_stop(item: &RouteInput) -> bool {
    item.tier == Some(1)
        || matches!(
            severity_of(item).map(str::to_ascii_lowercase).as_deref(),
            Some("high" | "critical")
        )
}

/// A review the router may treat as advisory: info or low, and binding nothing.
fn is_info_review(item: &RouteInput) -> bool {
    !item.binding
        && matches!(
            severity_of(item).map(str::to_ascii_lowercase).as_deref(),
            Some("info" | "low")
        )
}

fn key(charter_id: &str, lane: Lane, clause: LaneClause) -> String {
    format!("{charter_id}:{}:{}", lane.as_str(), clause.as_str())
}

/// Route one item. `charter` is the project's mandate when one exists
/// (`draft`, `active` or `suspended`); `None` otherwise.
pub fn route(item: &RouteInput, charter: Option<&CharterView>) -> Route {
    route_with(item, charter, true)
}

/// [`route`] with router acts switched off: the lane an item takes when the
/// router must not act on it - because the operator reverted the router's act
/// (the item is never re-acted automatically; it goes back to its lane).
pub fn route_without_act(item: &RouteInput, charter: Option<&CharterView>) -> Route {
    route_with(item, charter, false)
}

fn route_with(item: &RouteInput, charter: Option<&CharterView>, may_act: bool) -> Route {
    let charter_id = charter.map(|c| c.charter_id.clone());
    let own = |lane: Lane, clause: LaneClause| Route {
        lane,
        clause,
        charter_id: charter_id.clone(),
        coalesce_key: item.item_id.clone(),
        act: None,
    };

    // 1. Talk.
    if item.kind == RouteKind::Message {
        return own(Lane::Talk, LaneClause::None);
    }
    // 2. A claim is accepted by the operator, whoever holds the project.
    if item.kind == RouteKind::GoalClaim {
        let k = match &charter_id {
            Some(c) => key(c, Lane::Accept, LaneClause::None),
            None => format!(
                "orphan:{}:accept:none",
                item.project_id.as_deref().unwrap_or("-")
            ),
        };
        return Route {
            lane: Lane::Accept,
            clause: LaneClause::None,
            charter_id: charter_id.clone(),
            coalesce_key: k,
            act: None,
        };
    }
    // 2b. The lens-scan keep-out: no mandate ever acts on a lens-scan card,
    // signed or not. Each takes its fixed row before the charter is consulted.
    if item.kind.is_lens_scan() {
        let (lane, clause) = unsigned_row(item.kind);
        let k = match &charter_id {
            Some(c) => key(c, lane, clause),
            None => format!(
                "orphan:{}:{}:{}",
                item.project_id.as_deref().unwrap_or("-"),
                lane.as_str(),
                clause.as_str()
            ),
        };
        return Route {
            lane,
            clause,
            charter_id: charter_id.clone(),
            coalesce_key: k,
            act: None,
        };
    }
    // 3. Valves: never delegated, never batched, never hidden in a count.
    if item.irreversible.is_some_and(Irreversible::is_valve) {
        return own(Lane::Breach, LaneClause::Valve);
    }
    // 4. Orphan.
    let Some(c) = charter.filter(|_| item.project_id.is_some()) else {
        return Route {
            lane: Lane::Orphan,
            clause: LaneClause::None,
            charter_id: None,
            coalesce_key: format!("orphan:{}", item.project_id.as_deref().unwrap_or("-")),
            act: None,
        };
    };
    let at = |lane: Lane, clause: LaneClause| Route {
        lane,
        clause,
        charter_id: Some(c.charter_id.clone()),
        coalesce_key: key(&c.charter_id, lane, clause),
        act: None,
    };
    // 5. Held.
    if c.status != CharterStatus::Active {
        return at(Lane::Held, LaneClause::None);
    }
    // 6. Council: evidence on the mandate, decided by the operator. Always.
    if item.kind == RouteKind::Council {
        return at(Lane::Accept, LaneClause::None);
    }
    let env = &c.envelope;
    // 7. Unsigned: the router acts on nothing.
    if !env.is_signed() {
        match item.irreversible {
            Some(Irreversible::Merge) => return at(Lane::Breach, LaneClause::Merge),
            Some(Irreversible::Spend) => return at(Lane::Breach, LaneClause::Spend),
            _ => {}
        }
        let (lane, clause) = match item.kind {
            RouteKind::Incident if is_stop(item) => (Lane::Breach, LaneClause::Stop),
            RouteKind::Review if !item.binding && !is_info_review(item) => {
                (Lane::Breach, LaneClause::Risk)
            }
            k => unsigned_row(k),
        };
        return at(lane, clause);
    }
    // 8. Signed: merge and spend first. The router never acts on either.
    match item.irreversible {
        Some(Irreversible::Merge) => {
            return match env.binding_merge_policy().unwrap_or(MergePolicy::Never) {
                MergePolicy::Never => at(Lane::Breach, LaneClause::Merge),
                // The worker merges under the signed policy; not the router.
                MergePolicy::GateGreen => at(Lane::Steward, LaneClause::Merge),
                // The council does not admit work: a council-ready merge still
                // reaches Accept (PLAN section 2, open risk).
                MergePolicy::GateGreenCouncilReady => at(Lane::Accept, LaneClause::Merge),
            };
        }
        Some(Irreversible::Spend) => {
            let fits = match (env.budget_monthly_usd, c.spend_used_usd, item.cost_usd) {
                (Some(cap), Some(used), Some(cost)) => used + cost <= cap,
                _ => false,
            };
            return if fits {
                at(Lane::Steward, LaneClause::Spend)
            } else {
                at(Lane::Breach, LaneClause::Spend)
            };
        }
        _ => {}
    }
    let (lane, clause, act) = route_signed_kind(item, env, may_act);
    let mut r = at(lane, clause);
    r.act = act;
    r
}

/// The per-kind law under a signed, active envelope (irreversible items have
/// already been routed).
fn route_signed_kind(
    item: &RouteInput,
    env: &MandateEnvelope,
    may_act: bool,
) -> (Lane, LaneClause, Option<RouterAct>) {
    let scope_or_breach = |scope: DecideScope, lane: Lane| {
        if env.permits(scope) {
            (lane, LaneClause::None, None)
        } else {
            (Lane::Breach, LaneClause::Scope, None)
        }
    };
    let act_or = |act: RouterAct, otherwise: (Lane, LaneClause)| {
        if may_act && env.permits(act.scope()) {
            (Lane::Evidence, LaneClause::None, Some(act))
        } else {
            (otherwise.0, otherwise.1, None)
        }
    };
    match item.kind {
        RouteKind::Approval | RouteKind::Policy | RouteKind::Evolution => {
            (Lane::Breach, LaneClause::Scope, None)
        }
        RouteKind::Incident if is_stop(item) => (Lane::Breach, LaneClause::Stop, None),
        RouteKind::Incident => act_or(
            RouterAct::AcknowledgeIncident,
            (Lane::Breach, LaneClause::Scope),
        ),
        RouteKind::Review if item.binding => (Lane::Breach, LaneClause::Scope, None),
        RouteKind::Review if !is_info_review(item) => (Lane::Breach, LaneClause::Risk, None),
        RouteKind::Review => act_or(RouterAct::ApproveReview, (Lane::Breach, LaneClause::Scope)),
        RouteKind::Report => act_or(RouterAct::MarkReportRead, (Lane::Accept, LaneClause::None)),
        RouteKind::Idea => scope_or_breach(DecideScope::IdeaAccept, Lane::Steward),
        RouteKind::Question => scope_or_breach(DecideScope::QuestionAnswer, Lane::Steward),
        RouteKind::Dispatch => scope_or_breach(DecideScope::Dispatch, Lane::Steward),
        // No scope delegates a NEW intent: a proposed goal is signed.
        RouteKind::Goal => (Lane::Sign, LaneClause::None, None),
        // Routed before the charter is consulted; kept total here.
        RouteKind::GoalClaim | RouteKind::Council => (Lane::Accept, LaneClause::None, None),
        RouteKind::Message => (Lane::Talk, LaneClause::None, None),
        // Routed before the charter is consulted (the keep-out); kept total
        // here, and never acted.
        RouteKind::LensBuild | RouteKind::LensEvidence | RouteKind::LensRelease => {
            let (lane, clause) = unsigned_row(item.kind);
            (lane, clause, None)
        }
    }
}

// ---------------------------------------------------------------------------
// The snapshot payload (ts-rs)
// ---------------------------------------------------------------------------

/// One pending item's routing, joined by the frontend on `itemId`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LaneEntry {
    /// EXACTLY the frontend `DecisionItem.id` (`review:<id>`, `idea:<id>`, ...).
    pub item_id: String,
    /// The `DecisionItem.kind` (`mandate` for a draft charter's Sign entry).
    pub item_kind: String,
    pub lane: Lane,
    pub clause: LaneClause,
    pub charter_id: Option<String>,
    pub coalesce_key: String,
    pub irreversible: Option<Irreversible>,
    pub project_id: Option<String>,
}

/// A mandate as the lanes count it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LaneCharter {
    pub charter_id: String,
    pub project_id: String,
    /// 'draft' | 'active' | 'suspended'.
    pub status: String,
    #[ts(type = "number")]
    pub envelope_version: i64,
    /// Items held on this charter (draft or suspended): counted, not shown.
    #[ts(type = "number")]
    pub held: u32,
}

/// Every pending item's lane, computed once on the backend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DecisionLanesSnapshot {
    pub items: Vec<LaneEntry>,
    pub charters: Vec<LaneCharter>,
    /// Sources that failed to load. A failed source is never an empty one.
    pub failed_sources: Vec<String>,
    pub generated_at: String,
}

#[cfg(test)]
mod tests;
