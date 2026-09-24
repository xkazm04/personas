//! Curator - what she knows, before anything she does.
//!
//! Curator is the companion who keeps a mapped knowledge registry world-class
//! **and applied**. This module is the vocabulary of her KNOWLEDGE: the
//! allowlist of checkouts she may look at, the projection she makes from the
//! registry's own instrument, and the queue of things she would ask a person.
//! Nothing here acts. There is no dispatch, no loop and no commit writer in
//! this package - `CuratorCommit` exists so that the package which adds one
//! cannot write a commit without a row, and for no other reason.
//!
//! Four properties are types here rather than conventions, because each has a
//! writer that would otherwise be trusted to remember:
//!
//! 1. **An unknown is never a zero.** `demand` is `None` when `demand_known`
//!    is false, `last_swept` is `None` when no sweep is recorded, and
//!    `has_applied_row` is `None` when the applied ledger could not be READ (as
//!    distinct from a ledger that exists and names nothing). A UI that draws
//!    "0 deviations" where the corpus said "nobody reported" is the failure all
//!    three exist to prevent.
//! 2. **Supersede, never rewrite.** A projection is a new
//!    [`CuratorPlanRun`]; the run it replaces is marked, not mutated, so a
//!    decision can always cite the plan a person actually saw.
//! 3. **Every closed set is an enum here and a CHECK in `e49`.** The set is
//!    spelled twice in Rust-and-SQL and never in the client.
//! 4. **The registry's `dry_streak` is an input she does not trust.** See
//!    [`CuratorPlanItem::registry_dry_streak`].
//!
//! Bindings for anything under `core/src/models` come from the CORE crate's own
//! export test - `npm run test:rust:crates -- export_bindings`. The app crate's
//! `npm run test:rust -- export_bindings` does not re-export them.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Closed sets. Each is a CHECK in `e49_curator_plan` as well; the arrays are
// what a door validates against BEFORE any write, so a refusal names the field
// rather than surfacing a SQLite constraint error.
// ---------------------------------------------------------------------------

/// `curator_project.consent_state`.
pub const CURATOR_CONSENT_STATES: [&str; 3] = ["never_asked", "granted", "refused"];
/// `curator_plan_item.engine` - which registry skill would answer the finding.
pub const CURATOR_ENGINES: [&str; 7] = [
    "conform",
    "deepen",
    "apply",
    "reconcile",
    "intake",
    "forge",
    "none",
];
/// `curator_plan_item.state`.
pub const CURATOR_PLAN_ITEM_STATES: [&str; 6] = [
    "planned",
    "dispatched",
    "landed",
    "declined",
    "idled",
    "blocked",
];
/// `curator_decision.kind`.
pub const CURATOR_DECISION_KINDS: [&str; 9] = [
    "subject_delta",
    "subject_proposal",
    "direction_proposal",
    "coverage_delta",
    "coverage_gap",
    "stale_verdicts",
    "first_commit_consent",
    "handoff",
    "decline_ratified",
];
/// `curator_decision.level`.
pub const CURATOR_DECISION_LEVELS: [&str; 4] = ["L0", "L1", "L2", "L3"];
/// `curator_decision.status`.
pub const CURATOR_DECISION_STATUSES: [&str; 5] = [
    "awaiting",
    "auto_approved",
    "approved",
    "declined",
    "superseded",
];
/// `curator_plan_item.dominant_reason` - the nine weighted clauses the
/// registry's own scan scores, plus `none`.
pub const CURATOR_REASON_CODES: [&str; 10] = [
    "citation_gone",
    "no_application",
    "expired_application",
    "deviation",
    "thin_techniques",
    "never_swept",
    "missing_use_when",
    "single_stack",
    "at_risk_application",
    "none",
];

/// Two consecutive dry passes suppress a subject. The threshold is the
/// registry's own (`librarian/SKILL.md`: "deepen's law and what stops the loop
/// burning tokens on settled ground"); only the MEASUREMENT is hers.
pub const CURATOR_SATURATION_THRESHOLD: u32 = 2;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// Whether the operator has been asked about a checkout, and what they said.
/// `NeverAsked` is not "refused": a companion that cannot tell them apart would
/// either nag or assume.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CuratorConsentState {
    NeverAsked,
    Granted,
    Refused,
}

impl CuratorConsentState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NeverAsked => "never_asked",
            Self::Granted => "granted",
            Self::Refused => "refused",
        }
    }
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "never_asked" => Some(Self::NeverAsked),
            "granted" => Some(Self::Granted),
            "refused" => Some(Self::Refused),
            _ => None,
        }
    }
}

/// Which registry skill answers a finding. `None` is reachable and meaningful:
/// it is what an item routes to when the scan reported a clause this app's
/// routing table does not know, which is a finding about the app, not the
/// corpus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CuratorEngine {
    Conform,
    Deepen,
    Apply,
    Reconcile,
    Intake,
    Forge,
    None,
}

impl CuratorEngine {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Conform => "conform",
            Self::Deepen => "deepen",
            Self::Apply => "apply",
            Self::Reconcile => "reconcile",
            Self::Intake => "intake",
            Self::Forge => "forge",
            Self::None => "none",
        }
    }
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "conform" => Some(Self::Conform),
            "deepen" => Some(Self::Deepen),
            "apply" => Some(Self::Apply),
            "reconcile" => Some(Self::Reconcile),
            "intake" => Some(Self::Intake),
            "forge" => Some(Self::Forge),
            "none" => Some(Self::None),
            _ => None,
        }
    }
}

/// Where one planned item stands. `Planned` is the only state this package
/// writes; the other five are the vocabulary the loop package fills in, and
/// three of them - `Landed`, `Declined`, `Blocked` - are what BREAK a dry
/// streak (see [`CuratorPlanItemState::is_terminal`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CuratorPlanItemState {
    Planned,
    Dispatched,
    Landed,
    Declined,
    Idled,
    Blocked,
}

impl CuratorPlanItemState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Dispatched => "dispatched",
            Self::Landed => "landed",
            Self::Declined => "declined",
            Self::Idled => "idled",
            Self::Blocked => "blocked",
        }
    }
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "planned" => Some(Self::Planned),
            "dispatched" => Some(Self::Dispatched),
            "landed" => Some(Self::Landed),
            "declined" => Some(Self::Declined),
            "idled" => Some(Self::Idled),
            "blocked" => Some(Self::Blocked),
            _ => None,
        }
    }

    /// Whether this item reached an END for its plan run. `Planned` and
    /// `Dispatched` say nothing yet, which is why the saturation walk steps
    /// OVER them rather than treating them as a break: a run that was never
    /// finished is not evidence either way.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Landed | Self::Declined | Self::Idled | Self::Blocked
        )
    }
}

/// How much authority an action carries, and therefore who answers for it.
/// `L0` is always asked; `L3` runs under a standing grant and is reported
/// after the fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum CuratorDecisionLevel {
    L0,
    L1,
    L2,
    L3,
}

impl CuratorDecisionLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::L0 => "L0",
            Self::L1 => "L1",
            Self::L2 => "L2",
            Self::L3 => "L3",
        }
    }
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "L0" => Some(Self::L0),
            "L1" => Some(Self::L1),
            "L2" => Some(Self::L2),
            "L3" => Some(Self::L3),
            _ => None,
        }
    }
}

/// The nine clauses the registry's scan scores, in the order that decides
/// which one is DOMINANT. The order is the weights' own (gone 6, no
/// application 6, expired 5, deviation 4, thin 4, never swept 3, no use_when 2,
/// single stack 2, near clock 1); equal weights are broken by this declaration
/// order, so the answer is the same on two machines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CuratorReasonCode {
    CitationGone,
    NoApplication,
    ExpiredApplication,
    Deviation,
    ThinTechniques,
    NeverSwept,
    MissingUseWhen,
    SingleStack,
    AtRiskApplication,
    /// No clause of the nine was recognised. An item carrying this is a
    /// finding about this app's matcher, not about the subject.
    None,
}

impl CuratorReasonCode {
    /// Every code in dominance order, most dominant first. `None` is absent:
    /// it is what a lookup FAILS to, never a clause that can be present.
    pub const IN_DOMINANCE_ORDER: [CuratorReasonCode; 9] = [
        Self::CitationGone,
        Self::NoApplication,
        Self::ExpiredApplication,
        Self::Deviation,
        Self::ThinTechniques,
        Self::NeverSwept,
        Self::MissingUseWhen,
        Self::SingleStack,
        Self::AtRiskApplication,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::CitationGone => "citation_gone",
            Self::NoApplication => "no_application",
            Self::ExpiredApplication => "expired_application",
            Self::Deviation => "deviation",
            Self::ThinTechniques => "thin_techniques",
            Self::NeverSwept => "never_swept",
            Self::MissingUseWhen => "missing_use_when",
            Self::SingleStack => "single_stack",
            Self::AtRiskApplication => "at_risk_application",
            Self::None => "none",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "citation_gone" => Some(Self::CitationGone),
            "no_application" => Some(Self::NoApplication),
            "expired_application" => Some(Self::ExpiredApplication),
            "deviation" => Some(Self::Deviation),
            "thin_techniques" => Some(Self::ThinTechniques),
            "never_swept" => Some(Self::NeverSwept),
            "missing_use_when" => Some(Self::MissingUseWhen),
            "single_stack" => Some(Self::SingleStack),
            "at_risk_application" => Some(Self::AtRiskApplication),
            "none" => Some(Self::None),
            _ => None,
        }
    }

    /// The registry's own per-unit weight for this clause, from the scan's
    /// `weights` block. Pinned here so the projection's arithmetic can be
    /// checked against the scan's own `points` rather than trusted.
    pub fn weight(self) -> u32 {
        match self {
            Self::CitationGone => 6,
            Self::NoApplication => 6,
            Self::ExpiredApplication => 5,
            Self::Deviation => 4,
            Self::ThinTechniques => 4,
            Self::NeverSwept => 3,
            Self::MissingUseWhen => 2,
            Self::SingleStack => 2,
            Self::AtRiskApplication => 1,
            Self::None => 0,
        }
    }

    /// Which registry skill answers this clause.
    ///
    /// Taken from the librarian's own routing table with ONE deliberate
    /// divergence, recorded here rather than left to be rediscovered: that
    /// table sends a single-stack subject to `/reconcile` ("single-source: one
    /// stack, one origin"), while this sends it to `apply`. The reason is that
    /// `reconcile` here is reserved for a CLOCK - an application that has
    /// expired or is near its refresh window - which is a different, dated
    /// finding. A subject with one stack needs a second stack tried, which is
    /// what `apply` does.
    pub fn engine(self) -> CuratorEngine {
        match self {
            Self::CitationGone => CuratorEngine::Intake,
            Self::Deviation => CuratorEngine::Conform,
            Self::NoApplication | Self::SingleStack => CuratorEngine::Apply,
            Self::ExpiredApplication | Self::AtRiskApplication => CuratorEngine::Reconcile,
            Self::ThinTechniques | Self::MissingUseWhen | Self::NeverSwept => CuratorEngine::Deepen,
            Self::None => CuratorEngine::None,
        }
    }
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

/// One checkout Curator may look at. The row exists for every project the
/// registry's fleet resolver finds on this disk; `enabled` and `consent_state`
/// are the OPERATOR'S and are never written by her.
///
/// This is the security boundary the next package enforces: no read, no
/// dispatch and no commit may reach a path that is not an enabled, granted row
/// here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorProject {
    /// The registry fleet's slug (`personas`, `ascent`, ...).
    pub slug: String,
    /// Absolute checkout path, as the fleet resolver reported it.
    pub root_path: String,
    pub enabled: bool,
    pub consent_state: CuratorConsentState,
    /// When consent was granted. `None` while it has not been.
    pub granted_at: Option<String>,
    /// When the resolver last found this checkout on disk. `None` means it has
    /// not been seen since the row was made - NOT that it is gone.
    pub last_seen_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

/// The operator's standing settings, read as one typed value.
///
/// Every field is an `app_settings` row (see `settings_keys`), so this is a
/// PROJECTION of settings, not a second store. The four caps are `Option`
/// because an unset cap is not a cap of zero: `None` means the operator has
/// declared no ceiling, and a consumer that renders it as `0` would show a
/// companion that may never run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorPolicy {
    pub level_research: CuratorDecisionLevel,
    pub level_forge: CuratorDecisionLevel,
    pub level_conform: CuratorDecisionLevel,
    pub level_sweep: CuratorDecisionLevel,
    /// Dollars per day. `None` = no ceiling declared.
    pub daily_budget_usd: Option<f64>,
    /// Dispatches per day. `None` = no cap declared.
    pub daily_run_cap: Option<u32>,
    /// Commits per day. `None` = no cap declared.
    pub daily_commit_cap: Option<u32>,
    /// Free-form window (e.g. `22:00-07:00`). `None` = none declared.
    pub quiet_hours: Option<String>,
    /// How many awaiting decisions stop her queueing more.
    pub backpressure_n: u32,
    /// Concurrent workers she may hold.
    pub worker_cap: u32,
}

impl Default for CuratorPolicy {
    /// The shipped defaults: every level at `L0` (always ask), no ceiling
    /// declared, backpressure 8, TWO workers.
    ///
    /// Two rather than one since 2026-09-24, at the operator's request: she
    /// holds two concurrent terminals. Kept in step with
    /// `settings_keys::CURATOR_WORKER_CAP_DEFAULT` by hand, because the `core`
    /// crate does not depend on `db` - the test below is what holds them
    /// together.
    ///
    /// `L0` rather than a friendlier default is deliberate and is the same
    /// call `curator_enabled` makes - an autonomy setting that has never been
    /// touched must not be read as permission.
    fn default() -> Self {
        Self {
            level_research: CuratorDecisionLevel::L0,
            level_forge: CuratorDecisionLevel::L0,
            level_conform: CuratorDecisionLevel::L0,
            level_sweep: CuratorDecisionLevel::L0,
            daily_budget_usd: None,
            daily_run_cap: None,
            daily_commit_cap: None,
            quiet_hours: None,
            backpressure_n: 8,
            worker_cap: 2,
        }
    }
}

// ---------------------------------------------------------------------------
// What the instrument read
// ---------------------------------------------------------------------------

/// The corpus side of one projection - what the registry's own scan said about
/// itself, reduced to the figures a plan is built from. Stored with the run so
/// the plan a person saw can be re-read after the corpus has moved on.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorCorpus {
    /// The scan's own `generatedAt`, not this app's clock.
    pub generated_at: String,
    /// The scan's `today`, which is what its clocks were measured against.
    pub today: String,
    pub subjects: u32,
    pub techniques: u32,
    pub applications: u32,
    pub domains: u32,
    /// False means NO bundle has a consumer reporting demand - so every
    /// subject's demand is unknown, not absent.
    pub demand_known_for_any_bundle: bool,
    /// Distinct subjects named in `librarian/applied.md`. `None` when the
    /// ledger could not be read at all; a ledger that exists and names nothing
    /// is `Some(0)`.
    pub applied_subjects: Option<u32>,
    /// From `check-currency`: applications past their refresh clock.
    pub expired_applications: u32,
    /// From `check-currency`: applications inside the warning horizon.
    pub at_risk_applications: u32,
    /// From `check-currency`: applications whose stack version could not be
    /// compared at all. Unknown drift, not zero drift.
    pub drift_unknown: u32,
    /// From `check-currency`: applications verified against a version the
    /// fleet has since moved past.
    pub drift: u32,
    /// Applications carrying no clock at all, so they cannot expire. Without it a
    /// reader cannot tell `expiredApplications: 0` (nothing has expired) from
    /// "most were never given a window". Measured 2026-09-23: 301 of 1825.
    pub no_clock_applications: u32,
    /// The bundles whose demand was actually read - five of ten today. A zero on a
    /// demand-fed channel means something different in the other five.
    pub demand_known_domains: Vec<String>,
}

/// One consumer project as the registry's map check sees it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorConsumerProject {
    pub slug: String,
    pub contexts: u32,
    pub pairs: u32,
    pub weak: u32,
    pub evaluated: u32,
    pub deviations: u32,
    pub stale_verdicts: u32,
    /// The map's own word (`STALE`, `FRESH`, ...). Not a closed set here: it
    /// is the registry's vocabulary and it may grow without this app.
    pub state: String,
    pub orphaned: u32,
}

/// The fleet-wide totals the map check reports.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorConsumerTotals {
    pub projects: u32,
    pub pairs: u32,
    pub evaluated: u32,
    pub weak: u32,
    pub stale_verdicts: u32,
    pub stale_projects: u32,
    pub orphaned: u32,
}

/// The consumer side of one projection.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorConsumers {
    pub generated_at: String,
    /// The map check exited non-zero, which means the generated maps are
    /// STALE. That is a FINDING the plan carries, never a failed read: the
    /// report it printed is complete and is what this was parsed from.
    pub maps_stale: bool,
    pub projects: Vec<CuratorConsumerProject>,
    pub totals: CuratorConsumerTotals,
    /// The check's own `problems[]`, carried verbatim.
    pub problems: Vec<String>,
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

/// One recognised clause from the scan, with the prose the scan wrote for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorReason {
    pub code: CuratorReasonCode,
    /// What this clause contributed to the subject's `points` - the per-unit
    /// weight TIMES the count the scan applied it to, which is why it is
    /// stored rather than looked up.
    pub weight: u32,
    /// The scan's own sentence, kept so a surface can show the registry's
    /// words rather than this app's paraphrase.
    pub detail: String,
}

/// A subject's demand, as reported by consumers. Present only when
/// `demand_known` is true on the item that carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorDemand {
    pub consults: u32,
    /// Deduplicated across contributors - the FLOOR.
    pub deviations: u32,
    /// Summed across contributors - the CEILING, when they disagree.
    pub deviations_summed: u32,
    pub gone: u32,
    pub gone_summed: u32,
    pub contributors: u32,
}

/// One projection of the instrument: what Curator would do, as of one read.
///
/// A new projection SUPERSEDES rather than mutates. `superseded_by` is set on
/// the OLD run when a new one lands, so the plan a decision cites can always be
/// re-read exactly as the person saw it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorPlanRun {
    pub id: String,
    pub created_at: String,
    /// The SCAN's `generatedAt`, carried up so the run can say how old the
    /// corpus reading was, independently of when the row was written.
    pub scan_generated_at: String,
    /// The registry checkout's short HEAD. `None` when git could not answer -
    /// which also means this read was NOT cacheable, because nothing else
    /// identifies the corpus version.
    pub registry_head_sha: Option<String>,
    pub corpus: CuratorCorpus,
    pub consumers: CuratorConsumers,
    /// The policy AS IT WAS when the projection was made. Stored rather than
    /// re-read, because a decision cites the plan and the plan's levels are
    /// part of what a person agreed to.
    pub policy: CuratorPolicy,
    pub item_count: u32,
    pub superseded_by: Option<String>,
}

/// One subject the projection would act on. Items exist only for subjects the
/// scan scored above zero - a subject with no finding is not work, and a plan
/// that listed all 471 would bury the 301 that are.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorPlanItem {
    pub id: String,
    pub plan_run_id: String,
    /// `<domain>/<slug>` - the scan's own id.
    pub subject_id: String,
    pub domain: String,
    /// Where the subject sits in its bundle's taxonomy.
    pub at: String,
    /// The scan's own attention points. Equal to the sum of `reasons[].weight`
    /// whenever every clause was recognised, which is the invariant the
    /// projection's test asserts over all 471 real subjects.
    pub points: u32,
    pub reasons: Vec<CuratorReason>,
    pub dominant_reason: CuratorReasonCode,
    pub engine: CuratorEngine,
    pub techniques: u32,
    pub applications: u32,
    pub stacks: Vec<String>,
    /// Whether ANY consumer reports demand for this subject. When false,
    /// `demand` is `None` and demand is UNKNOWN - never zero.
    pub demand_known: bool,
    pub demand: Option<CuratorDemand>,
    /// When the librarian last swept this subject. `None` = no sweep recorded,
    /// which the scan itself scores as the `never_swept` clause.
    pub last_swept: Option<String>,
    /// **The registry's `dry_streak`, carried as an input she does not trust,
    /// and never the basis of `suppressed_by_saturation`.**
    ///
    /// Measured 2026-09-23 against the registry: 349 of 349 subject notes
    /// carrying the field read `0`, no other value exists anywhere in that
    /// tree, and exactly two call sites mention it - the librarian's doctrine
    /// READS it (`>= 2` suppresses a saturated subject) while reconcile WRITES
    /// it, but only as `0` at note creation. **Nothing increments it**, so the
    /// predicate can never be true and a consumer cannot tell that apart from
    /// "no subject is saturated".
    ///
    /// So `0` here means UNKNOWN, not "not saturated". It is stored because
    /// the day the registry starts incrementing it, the disagreement between
    /// this column and [`Self::suppressed_by_saturation`] is the signal - and
    /// a column that was never carried could not show it.
    pub registry_dry_streak: u32,
    /// **Hers**, computed from her own recorded outcomes: the number of
    /// consecutive most-recent plan runs in which this subject reached
    /// `idled`, broken by any other terminal state, compared against
    /// [`CURATOR_SATURATION_THRESHOLD`]. A subject she has never dispatched is
    /// NOT suppressed - an absent history is not a dry one.
    pub suppressed_by_saturation: bool,
    /// Whether any row in `librarian/applied.md` names this subject. `None`
    /// when the ledger could not be READ; a ledger that exists and names
    /// nothing gives `Some(false)`.
    pub has_applied_row: Option<bool>,
    pub state: CuratorPlanItemState,
    pub declined_reason: Option<String>,
    pub dispatched_run_id: Option<String>,
    pub evidence_ref: Option<String>,
    pub updated_at: String,
}

/// One bundle's share of the subjects that score nothing.
///
/// The projection makes a plan item only for a subject that scores, so the 170
/// quiet subjects have no row anywhere. They are not noise: `table` scores 0 and
/// still holds 16 stale verdicts across 6 projects. This carries them as counts
/// so a surface can say "wanting nothing is a fact about the subject" rather
/// than leaving them out and calling the remainder the corpus.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorQuietBundle {
    pub domain: String,
    /// Subjects in this bundle scoring zero.
    pub subjects: u32,
    /// False for the five bundles whose demand was never read, where a zero on the
    /// demand-fed channels means "nobody looked", not "nothing found".
    pub demand_known: bool,
}

/// A plan run with its items - what `curator_plan_current` and
/// `curator_plan_refresh` both return.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorPlan {
    pub run: CuratorPlanRun,
    pub items: Vec<CuratorPlanItem>,
    /// The subjects that score nothing, per bundle. The projection makes an item
    /// only for a subject that scores, so these 170 have no row anywhere - and
    /// `table` scores 0 while holding 16 stale verdicts across 6 projects.
    pub quiet: Vec<CuratorQuietBundle>,
}

// ---------------------------------------------------------------------------
// The operator's lane
//
// `curator_request` is the one place a PERSON puts work INTO Curator, and it is
// deliberately not a decision: a decision is something she raises and a person
// answers, this is the opposite direction, and collapsing the two would make
// "she asked" and "she was asked" the same row.
//
// Nothing in this package drains the lane. `CuratorRequestState` carries the
// whole vocabulary anyway, because a CHECK written now is a CHECK the loop
// package cannot forget, and the states it does not yet write are the ones a
// half-built loop would otherwise invent.
// ---------------------------------------------------------------------------

/// `curator_request.state`.
pub const CURATOR_REQUEST_STATES: [&str; 6] = [
    "queued",
    "dispatched",
    "landed",
    "declined",
    "failed",
    "cancelled",
];

/// Where an operator's request stands. `queued` is the only state she may pick
/// up; everything else is settled or in flight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CuratorRequestState {
    Queued,
    Dispatched,
    Landed,
    Declined,
    Failed,
    Cancelled,
}

impl CuratorRequestState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Dispatched => "dispatched",
            Self::Landed => "landed",
            Self::Declined => "declined",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "queued" => Some(Self::Queued),
            "dispatched" => Some(Self::Dispatched),
            "landed" => Some(Self::Landed),
            "declined" => Some(Self::Declined),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
    /// Whether the row is finished with. Asked rather than matched against a
    /// hand-written list at each door, so a seventh state cannot be settled in
    /// one place and open in another.
    pub fn is_settled(self) -> bool {
        matches!(
            self,
            Self::Landed | Self::Declined | Self::Failed | Self::Cancelled
        )
    }
}

/// One request the operator put in Curator's human lane, in the order they wrote
/// it. She drains this lane before her own plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorRequest {
    pub id: String,
    /// The registry skill to run, e.g. `intake`.
    pub skill: String,
    /// What to run it on - a URL, a bundle, a domain. Null for a bare-runnable skill.
    pub argument: Option<String>,
    /// The operator's own words, carried into the worker's brief unchanged.
    pub note: Option<String>,
    pub state: CuratorRequestState,
    pub created_at: String,
    pub started_at: Option<String>,
    pub settled_at: Option<String>,
    /// The fleet session she dispatched for it, once admitted.
    pub session_id: Option<String>,
    /// The run-result outcome once the worker wrote one, else null.
    pub outcome: Option<String>,
    /// Where the worker's `result.json` landed, so the row can be traced to evidence.
    pub result_ref: Option<String>,
    pub failure_reason: Option<String>,
}

// ---------------------------------------------------------------------------
// The skills she can dispatch
//
// Discovered by READING the two lanes on disk, never from a manifest: measured
// 2026-09-24 the registry's `catalog.json` enumerates the 36 shared skills and
// NONE of the eight native ones, which exist only as prose `SKILL.md`
// directories. The reader lives in `commands/curator/instrument.rs`; only the
// vocabulary is here.
// ---------------------------------------------------------------------------

/// Which lane a registry skill lives in. `native` is the registry's own
/// maintenance set under `.claude/skills/` - the standard every registry of this
/// kind carries. `shared` is the lane it publishes to consuming repos, which
/// `catalog.json` already enumerates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CuratorSkillLane {
    Native,
    Shared,
}

impl CuratorSkillLane {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Shared => "shared",
        }
    }
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "native" => Some(Self::Native),
            "shared" => Some(Self::Shared),
            _ => None,
        }
    }
}

/// One registry skill Curator can dispatch, discovered by reading the lane on
/// disk rather than from a manifest - `catalog.json` carries the 36 shared
/// skills and none of the eight native ones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorSkill {
    pub name: String,
    pub lane: CuratorSkillLane,
    /// Repo-relative path of the SKILL.md it was read from.
    pub path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    /// Whether the file documents an invocation at all. Measured 2026-09-24:
    /// `deepen` and `forge` document NONE, so a caller inventing one is guessing.
    pub invocation_documented: bool,
    /// Whether it can be dispatched with no argument. **NULL when the invocation is
    /// undocumented** - that is unknown, not false, and the two must never collapse.
    /// Bare-runnable today: `hygiene`, `librarian`, `harvest`.
    pub runs_bare: Option<bool>,
    /// The argument line as the file states it, verbatim, or null.
    pub argument_hint: Option<String>,
}

// ---------------------------------------------------------------------------
// The runtime
//
// A READING, not a store: every field is computed at call time from the policy,
// the fleet registry and today's ledgers. There is no `curator_runtime` table
// and there must not be one - a cached copy of "how many terminals are live" is
// a second answer to a question the registry already owns.
// ---------------------------------------------------------------------------

/// What her loop is doing right now. Every cap here is a real brake: the
/// operator's standing instruction is that she never idles, so these are the
/// only things that ever stop her.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorRuntime {
    pub enabled: bool,
    /// Terminals she currently holds.
    pub running: u32,
    pub worker_cap: u32,
    /// Processes those terminals have fanned out to, when known. A dispatcher skill
    /// spawns its own pool - `librarian` and `forge` cap at 10, `harvest` at 5,
    /// `hygiene` at 6 - so a worker cap of 2 is not a cap of 2 processes. Null when
    /// she cannot see inside a worker.
    pub fanned_out: Option<u32>,
    /// Which lane she is serving: the operator's queue, her own plan, the refill
    /// research pass, or her reconcile sleep.
    pub lane: String,
    /// Why she is stopped, when she is. Null while she is working.
    pub halted_reason: Option<String>,
    pub spent_today_usd: f64,
    // The three caps below are NOT `Option` on this wire, and `0` is the
    // reading for "no ceiling declared" - the same convention
    // `monthly_cost_ceiling_usd` already ships. It is the one place in this
    // feature where an absence is spelled as a zero, and it is the wire's call
    // rather than this type's: see the freeze commit. A surface must render `0`
    // as "no ceiling", never as "may never run".
    pub daily_budget_usd: f64,
    pub runs_today: u32,
    pub daily_run_cap: u32,
    pub commits_today: u32,
    pub daily_commit_cap: u32,
    pub last_sleep_at: Option<String>,
}

/// The four lanes [`CuratorRuntime::lane`] names.
///
/// The field is a `String` on the wire rather than an enum, so a surface can
/// fall back rather than fail on a lane it does not know - but the vocabulary
/// itself is closed, and it is spelled HERE so the backend and the console do
/// not each keep their own list. This package answers with [`QUEUE`] and
/// [`PLAN`]; the loop package that owns the refill pass and the reconcile
/// sleep answers with the other two.
pub mod curator_lane {
    /// The operator's own request lane. She drains it before her plan, so a
    /// lane with open work in it is the lane she is serving.
    pub const QUEUE: &str = "queue";
    /// Her own projection, once the operator's lane is empty.
    pub const PLAN: &str = "plan";
    /// The research pass that refills the corpus's coverage gaps.
    pub const REFILL: &str = "refill";
    /// Her reconcile sleep.
    pub const SLEEP: &str = "sleep";
}

/// The `dev_llm_spend.source` every Curator dispatch is recorded under.
///
/// Spelled here rather than at the write site because the READER exists first:
/// `curator_runtime_get` reports today's spend against her daily budget, and a
/// writer that spelled the source differently would report a companion that
/// spends nothing however much she spends.
pub const CURATOR_SPEND_SOURCE: &str = "curator";

// ---------------------------------------------------------------------------
// The queue and the ledger
//
// Neither type carries `#[ts(export)]`, and that is deliberate rather than an
// omission: no command in this package returns either one, because no writer
// for either exists yet. A binding with no caller is dead surface, and the
// package that adds the writer adds the door and the binding with it.
// ---------------------------------------------------------------------------

/// One thing Curator would ask a person. Modelled on `dev_council_decisions`,
/// the strongest gate in this tree: decisions SUPERSEDE, never rewrite, and
/// `saw_digest` records what the person was actually shown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CuratorDecision {
    pub id: String,
    pub kind: String,
    pub subject_id: Option<String>,
    pub project_slug: Option<String>,
    pub plan_item_id: Option<String>,
    /// The plan this question was raised from. `ON DELETE RESTRICT` in the
    /// schema: the plan a person looked at must not be deleted out from under
    /// the decision that cites it.
    pub plan_run_id: String,
    pub title: String,
    /// Kind-specific body. Untyped here on purpose - the shape differs per
    /// `kind`, there is no door that produces one yet, and inventing a union
    /// before a writer exists is how a schema gets guessed wrong.
    pub body_json: String,
    pub level: CuratorDecisionLevel,
    pub status: String,
    pub answered_by: Option<String>,
    pub decided_at: Option<String>,
    pub decision_reason: Option<String>,
    pub saw_digest: String,
    pub supersedes_decision_id: Option<String>,
    pub created_at: String,
}

/// One commit Curator made in somebody's repository. The next package may not
/// write a commit without a row here - that is what the table is for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CuratorCommit {
    pub id: String,
    pub project_slug: String,
    pub repo_path: String,
    pub branch: String,
    pub sha: String,
    pub files_json: String,
    pub decision_id: Option<String>,
    /// The level that authorised it, recorded at the time. A later policy
    /// change must not be able to re-authorise a commit retroactively.
    pub level_that_authorised: CuratorDecisionLevel,
    pub run_id: Option<String>,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every closed set here must round-trip through the enum that mirrors it.
    /// A member added to one and not the other is the drift this catches.
    #[test]
    fn every_closed_set_round_trips_through_its_enum() {
        for raw in CURATOR_CONSENT_STATES {
            assert_eq!(CuratorConsentState::parse(raw).unwrap().as_str(), raw);
        }
        for raw in CURATOR_ENGINES {
            assert_eq!(CuratorEngine::parse(raw).unwrap().as_str(), raw);
        }
        for raw in CURATOR_PLAN_ITEM_STATES {
            assert_eq!(CuratorPlanItemState::parse(raw).unwrap().as_str(), raw);
        }
        for raw in CURATOR_DECISION_LEVELS {
            assert_eq!(CuratorDecisionLevel::parse(raw).unwrap().as_str(), raw);
        }
        for raw in CURATOR_REASON_CODES {
            assert_eq!(CuratorReasonCode::parse(raw).unwrap().as_str(), raw);
        }
        for raw in CURATOR_REQUEST_STATES {
            assert_eq!(CuratorRequestState::parse(raw).unwrap().as_str(), raw);
        }
        for raw in ["native", "shared"] {
            assert_eq!(CuratorSkillLane::parse(raw).unwrap().as_str(), raw);
        }
        assert!(CuratorConsentState::parse("maybe").is_none());
        assert!(CuratorEngine::parse("compile").is_none());
        assert!(CuratorReasonCode::parse("vibes").is_none());
        assert!(CuratorRequestState::parse("running").is_none());
        assert!(CuratorSkillLane::parse("linked").is_none());
    }

    /// `queued` is the ONLY state a claim may pick up, and every other state is
    /// settled. Asked of the enum rather than of a list at each door: a door
    /// that spells its own set is a door that can disagree with the next one.
    #[test]
    fn only_queued_is_unsettled() {
        assert!(!CuratorRequestState::Queued.is_settled());
        assert!(!CuratorRequestState::Dispatched.is_settled());
        for settled in [
            CuratorRequestState::Landed,
            CuratorRequestState::Declined,
            CuratorRequestState::Failed,
            CuratorRequestState::Cancelled,
        ] {
            assert!(settled.is_settled(), "{} is settled", settled.as_str());
        }
    }

    /// The dominance order IS the weights' descending order. If a weight ever
    /// moves without the order moving with it, "the highest-scoring clause
    /// present" would stop being what the list returns.
    #[test]
    fn dominance_order_is_the_weights_descending() {
        let weights: Vec<u32> = CuratorReasonCode::IN_DOMINANCE_ORDER
            .iter()
            .map(|c| c.weight())
            .collect();
        assert_eq!(weights, vec![6, 6, 5, 4, 4, 3, 2, 2, 1]);
        assert_eq!(CuratorReasonCode::IN_DOMINANCE_ORDER.len(), 9);
        // `None` is never a present clause.
        assert!(!CuratorReasonCode::IN_DOMINANCE_ORDER.contains(&CuratorReasonCode::None));
    }

    /// Every clause routes somewhere, and only the unrecognised one routes to
    /// `none`. A tenth clause added without a route would fail here.
    #[test]
    fn every_clause_routes_to_a_real_engine() {
        for code in CuratorReasonCode::IN_DOMINANCE_ORDER {
            assert_ne!(
                code.engine(),
                CuratorEngine::None,
                "{} must route somewhere",
                code.as_str()
            );
        }
        assert_eq!(CuratorReasonCode::None.engine(), CuratorEngine::None);
    }

    /// The two non-terminal states must not break a dry streak, and the four
    /// terminal ones must. This is the predicate the saturation walk turns on.
    #[test]
    fn only_the_four_settled_states_are_terminal() {
        assert!(!CuratorPlanItemState::Planned.is_terminal());
        assert!(!CuratorPlanItemState::Dispatched.is_terminal());
        for s in [
            CuratorPlanItemState::Landed,
            CuratorPlanItemState::Declined,
            CuratorPlanItemState::Idled,
            CuratorPlanItemState::Blocked,
        ] {
            assert!(s.is_terminal(), "{} must be terminal", s.as_str());
        }
    }

    /// An untouched policy must not read as permission.
    #[test]
    fn the_default_policy_asks_for_everything() {
        let p = CuratorPolicy::default();
        assert_eq!(p.level_research, CuratorDecisionLevel::L0);
        assert_eq!(p.level_forge, CuratorDecisionLevel::L0);
        assert_eq!(p.level_conform, CuratorDecisionLevel::L0);
        assert_eq!(p.level_sweep, CuratorDecisionLevel::L0);
        assert_eq!(p.daily_budget_usd, None);
        assert_eq!(p.daily_run_cap, None);
        assert_eq!(p.daily_commit_cap, None);
        assert_eq!(p.quiet_hours, None);
        assert_eq!(p.backpressure_n, 8);
        // Two terminals, at the operator's request. The twin of this number
        // lives in `settings_keys::CURATOR_WORKER_CAP_DEFAULT`, which has its
        // own assertion for the same value.
        assert_eq!(p.worker_cap, 2);
    }
}
