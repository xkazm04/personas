//! The mandate envelope and its act log (spark `mandate-lanes`, WP2).
//!
//! A project's **mandate** is its App Master charter (a `persona_responsibilities`
//! row with `domain = 'software_engineering'` and a project id). The envelope is
//! what the operator signs on top of the rung ladder that already exists:
//!
//! * [`DecideScope`] - the kinds of decision the steward may take alone;
//! * [`MergePolicy`] - when a rung-3 worker may merge instead of asking;
//! * the existing `budget_monthly_usd` cap;
//! * `envelope_version` - 0 while unsigned, bumped on every sign or amend.
//!
//! Every decision taken inside the envelope, and every change to the envelope
//! itself, is one append-only [`CharterAct`] (`charter_acts`, migration
//! `e67_mandate_envelope`). A decision record says who decided (`actor`), what
//! (`verdict` on `item_kind`/`item_id`), when (`created_at`), under which
//! envelope (`envelope_version`) and what was shown at the time (`shown_json`).
//!
//! Absent-value convention: a field that does not apply is `None` (TS `null`),
//! never `0` or `""`; lists default to empty.

use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/// One kind of decision a steward may take alone. The wire spelling is the
/// prototype's, verbatim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DecideScope {
    #[serde(rename = "idea.accept")]
    IdeaAccept,
    #[serde(rename = "idea.reject")]
    IdeaReject,
    #[serde(rename = "review.info")]
    ReviewInfo,
    #[serde(rename = "incident.triage")]
    IncidentTriage,
    #[serde(rename = "question.answer")]
    QuestionAnswer,
    #[serde(rename = "dispatch")]
    Dispatch,
    #[serde(rename = "report.read")]
    ReportRead,
    #[serde(rename = "council.attach")]
    CouncilAttach,
}

/// Every scope, in the prototype's order.
pub const ALL_DECIDE_SCOPES: [DecideScope; 8] = [
    DecideScope::IdeaAccept,
    DecideScope::IdeaReject,
    DecideScope::ReviewInfo,
    DecideScope::IncidentTriage,
    DecideScope::QuestionAnswer,
    DecideScope::Dispatch,
    DecideScope::ReportRead,
    DecideScope::CouncilAttach,
];

impl DecideScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::IdeaAccept => "idea.accept",
            Self::IdeaReject => "idea.reject",
            Self::ReviewInfo => "review.info",
            Self::IncidentTriage => "incident.triage",
            Self::QuestionAnswer => "question.answer",
            Self::Dispatch => "dispatch",
            Self::ReportRead => "report.read",
            Self::CouncilAttach => "council.attach",
        }
    }

    /// `None` for anything outside the closed vocabulary.
    pub fn parse(s: &str) -> Option<Self> {
        ALL_DECIDE_SCOPES
            .into_iter()
            .find(|c| c.as_str() == s.trim())
    }
}

impl fmt::Display for DecideScope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// When a rung-3 worker may merge its own branch. Rungs below 3 never merge,
/// so for them the policy is inert.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum MergePolicy {
    /// Open the branch and ask (the default for every charter).
    #[default]
    #[serde(rename = "never")]
    Never,
    /// Merge when the project's gates are green.
    #[serde(rename = "gate-green")]
    GateGreen,
    /// Merge when the gates are green and the council says ready.
    #[serde(rename = "gate-green+council-ready")]
    GateGreenCouncilReady,
}

impl MergePolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::GateGreen => "gate-green",
            Self::GateGreenCouncilReady => "gate-green+council-ready",
        }
    }

    /// `None` for anything outside the DB CHECK's three values.
    pub fn parse(s: &str) -> Option<Self> {
        [Self::Never, Self::GateGreen, Self::GateGreenCouncilReady]
            .into_iter()
            .find(|p| p.as_str() == s.trim())
    }
}

/// Who took a recorded act.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum CharterActor {
    /// The deterministic router filing an item at arrival.
    Router,
    /// The charter's App Master deciding inside its envelope.
    Steward,
    /// The human.
    Operator,
}

impl CharterActor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Router => "router",
            Self::Steward => "steward",
            Self::Operator => "operator",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        [Self::Router, Self::Steward, Self::Operator]
            .into_iter()
            .find(|a| a.as_str() == s.trim())
    }
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

/// The signed part of a mandate, as stored on its charter row.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MandateEnvelope {
    /// The kinds the steward may decide alone. Empty until signed or widened.
    pub decide_scopes: Vec<DecideScope>,
    pub merge_policy: MergePolicy,
    /// The charter's existing monthly cap (`budget_monthly_usd`); `None` = no cap.
    pub budget_monthly_usd: Option<f64>,
    /// 0 = never signed (draft envelope); bumped on every sign and amend.
    #[ts(type = "number")]
    pub envelope_version: i64,
    /// The re-read marker ("you kept it at N acts"); `None` = never re-read.
    #[ts(type = "number | null")]
    pub kept_at_acts: Option<i64>,
}

impl MandateEnvelope {
    pub fn is_signed(&self) -> bool {
        self.envelope_version > 0
    }

    pub fn permits(&self, scope: DecideScope) -> bool {
        self.decide_scopes.contains(&scope)
    }

    /// The merge policy that BINDS this charter: `Some` only once the envelope
    /// is signed. An unsigned envelope's `merge_policy` is the column default
    /// (`never`), not a choice anyone made, so it binds nothing and the charter
    /// ships exactly as its rung says. Signing is the moment the operator picks
    /// a merge policy.
    pub fn binding_merge_policy(&self) -> Option<MergePolicy> {
        self.is_signed().then_some(self.merge_policy)
    }
}

/// What the operator signs: the whole envelope at once.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MandateSignInput {
    #[serde(default)]
    pub decide_scopes: Vec<DecideScope>,
    #[serde(default)]
    pub merge_policy: MergePolicy,
    /// `None` = no cap.
    #[serde(default)]
    pub budget_monthly_usd: Option<f64>,
}

/// One amendment to a signed envelope. Each one bumps `envelope_version` and
/// writes one act carrying the before/after.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MandateChange {
    /// Add these scopes (at least one must be new).
    WidenScope {
        scopes: Vec<DecideScope>,
    },
    /// Remove these scopes (at least one must be present).
    NarrowScope {
        scopes: Vec<DecideScope>,
    },
    SetMergePolicy {
        policy: MergePolicy,
    },
    /// `None` removes the cap.
    SetBudget {
        usd: Option<f64>,
    },
}

/// The envelope plus the charter status, as it stood before or after one act.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeSnapshot {
    pub decide_scopes: Vec<DecideScope>,
    pub merge_policy: MergePolicy,
    pub budget_monthly_usd: Option<f64>,
    /// `persona_responsibilities.status` ('draft' | 'active' | 'suspended').
    pub status: String,
}

/// Which envelope door an act went through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum EnvelopeOp {
    Sign,
    Amend,
    Suspend,
    Resume,
    /// An earlier envelope act undone by `charter_act_revert`.
    Revert,
    /// A draft mandate dropped by the operator (retired, with the reason in
    /// the act's `shown_json`). Final: a drop is undone by drafting again.
    Drop,
    /// A signed mandate re-read and kept as signed (the re-read marker
    /// `kept_at_acts` set). Changes nothing in the envelope.
    Keep,
    /// A mandate drafted from a cluster of orphans.
    Draft,
    /// An orphaned project adopted into an existing mandate (a new charter
    /// carrying that mandate's steward and envelope).
    Adopt,
}

impl EnvelopeOp {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sign => "sign",
            Self::Amend => "amend",
            Self::Suspend => "suspend",
            Self::Resume => "resume",
            Self::Revert => "revert",
            Self::Drop => "drop",
            Self::Keep => "keep",
            Self::Draft => "draft",
            Self::Adopt => "adopt",
        }
    }
}

/// `charter_acts.env_change_json` for an envelope act.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeChange {
    pub op: EnvelopeOp,
    /// The amendment, for `op = amend`; `None` for the other doors.
    #[serde(default)]
    pub change: Option<MandateChange>,
    pub before: EnvelopeSnapshot,
    pub after: EnvelopeSnapshot,
}

// ---------------------------------------------------------------------------
// The act log
// ---------------------------------------------------------------------------

/// `charter_acts.item_kind` for an act that changed the envelope itself; its
/// `item_id` is the charter id.
pub const ACT_KIND_MANDATE: &str = "mandate";
/// `charter_acts.item_kind` for the act that records a revert; its `item_id`
/// is the reverted act's id.
pub const ACT_KIND_REVERT: &str = "act.revert";

/// One row of `charter_acts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CharterAct {
    pub id: String,
    pub charter_id: String,
    /// The envelope in force when the act was taken (for an envelope act: the
    /// version it produced).
    #[ts(type = "number")]
    pub envelope_version: i64,
    /// `mandate`, `act.revert`, or the decided item's kind (`idea`, `review`, ...).
    pub item_kind: String,
    pub item_id: String,
    pub verdict: String,
    pub actor: CharterActor,
    /// The [`DecideScope`] the act was taken under; `None` for envelope acts
    /// and operator acts that need no scope.
    pub scope: Option<String>,
    pub reversible: bool,
    pub cost_usd: Option<f64>,
    /// What the decider was shown, as the JSON text that was stored.
    pub shown_json: Option<String>,
    /// The before/after of an envelope act; `None` for every other act.
    pub env_change: Option<EnvelopeChange>,
    pub reverted_at: Option<String>,
    /// The act that recorded the revert.
    pub revert_act_id: Option<String>,
    /// The device the act was taken on; `None` = this (home) device.
    pub origin_device: Option<String>,
    pub created_at: String,
}

/// Input for appending a decision act. `envelope_version` is not a field: the
/// store stamps the version the charter holds at insert time, so a caller
/// cannot claim an envelope it did not decide under.
#[derive(Debug, Clone, PartialEq)]
pub struct NewCharterAct {
    pub charter_id: String,
    pub item_kind: String,
    pub item_id: String,
    pub verdict: String,
    pub actor: CharterActor,
    pub scope: Option<DecideScope>,
    pub reversible: bool,
    pub cost_usd: Option<f64>,
    pub shown_json: Option<String>,
    pub origin_device: Option<String>,
}

/// Filter for `charter_acts_list`. Every field is optional; `None` = any.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CharterActFilter {
    #[serde(default)]
    pub charter_id: Option<String>,
    #[serde(default)]
    pub actor: Option<CharterActor>,
    #[serde(default)]
    pub reversible: Option<bool>,
    /// `Some(true)` = only reverted acts, `Some(false)` = only standing ones.
    #[serde(default)]
    pub reverted: Option<bool>,
    #[serde(default)]
    pub item_kind: Option<String>,
    #[serde(default)]
    pub item_id: Option<String>,
    /// Newest-first page size; defaults to 100, capped at 500.
    #[serde(default)]
    pub limit: Option<u32>,
}

/// Why `charter_act_revert` refused. Typed so the caller can say which.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CharterActRevertRefusal {
    NotFound {
        act_id: String,
    },
    /// The act was recorded as irreversible (a merge, a spend, an outbound
    /// message, a deletion); nothing can take it back.
    Irreversible {
        act_id: String,
        item_kind: String,
    },
    AlreadyReverted {
        act_id: String,
        reverted_at: String,
    },
    /// An envelope act whose result a later change has already replaced:
    /// restoring its `before` would silently undo the later change too.
    Superseded {
        act_id: String,
    },
}

impl fmt::Display for CharterActRevertRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound { act_id } => write!(f, "Charter act {act_id} not found"),
            Self::Irreversible { act_id, item_kind } => write!(
                f,
                "Charter act {act_id} ({item_kind}) is irreversible and cannot be reverted"
            ),
            Self::AlreadyReverted {
                act_id,
                reverted_at,
            } => write!(
                f,
                "Charter act {act_id} was already reverted at {reverted_at}"
            ),
            Self::Superseded { act_id } => write!(
                f,
                "Charter act {act_id} was superseded by a later envelope change; amend the \
                 mandate instead of reverting it"
            ),
        }
    }
}

/// A revert either refused for a stated reason or failed in the store.
#[derive(Debug)]
pub enum CharterActRevertError {
    Refused(CharterActRevertRefusal),
    Store(AppError),
}

impl From<AppError> for CharterActRevertError {
    fn from(e: AppError) -> Self {
        Self::Store(e)
    }
}

impl From<rusqlite::Error> for CharterActRevertError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Store(AppError::Database(e))
    }
}

impl From<CharterActRevertError> for AppError {
    fn from(e: CharterActRevertError) -> Self {
        match e {
            CharterActRevertError::Store(e) => e,
            CharterActRevertError::Refused(r) => match &r {
                CharterActRevertRefusal::NotFound { .. } => AppError::NotFound(r.to_string()),
                CharterActRevertRefusal::Irreversible { .. } => AppError::Forbidden(r.to_string()),
                CharterActRevertRefusal::AlreadyReverted { .. }
                | CharterActRevertRefusal::Superseded { .. } => AppError::Validation(r.to_string()),
            },
        }
    }
}

// ---------------------------------------------------------------------------
// A mandate intent's "met when" (dev_goals.met_when)
// ---------------------------------------------------------------------------

/// How deep a council round must go before a claim may be accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum CouncilDepth {
    Full,
    Lite,
}

/// The conditions a goal names for "met" (`dev_goals.met_when`, JSON). Each
/// field is `None` when the goal does not name that condition.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MetWhen {
    /// The acceptance test the operator runs by hand. `Some("")` when the
    /// goal only says a UAT is required, without naming it.
    pub uat: Option<String>,
    /// The KPI whose target must be reached.
    pub kpi_id: Option<String>,
    /// The council round the claim needs.
    pub council: Option<CouncilDepth>,
}

impl MetWhen {
    pub fn is_empty(&self) -> bool {
        self.uat.is_none() && self.kpi_id.is_none() && self.council.is_none()
    }
}

/// What the Accept card reads for one goal claim.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GoalMetWhen {
    pub goal_id: String,
    /// The mandate the goal is an intent of; `None` = the project's active one.
    pub charter_id: Option<String>,
    /// `None` = the goal names no condition (NULL, `{}`, or every field empty).
    pub met_when: Option<MetWhen>,
    /// The stored JSON could not be read; `met_when` is then `None` and the
    /// card must say so rather than say "no conditions".
    pub unreadable: bool,
}

// ---------------------------------------------------------------------------
// The re-read (the law is `personas_engine::mandate_reread`)
// ---------------------------------------------------------------------------

/// Which trigger fired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum RereadCode {
    Cap,
    Asks,
    Merges,
    Dominant,
}

impl RereadCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cap => "cap",
            Self::Asks => "asks",
            Self::Merges => "merges",
            Self::Dominant => "dominant",
        }
    }
}

/// Widen or narrow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum RereadMove {
    Widen,
    Narrow,
}

/// What the re-read suggests. `scope: None` is the merge policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RereadSuggestion {
    pub action: RereadMove,
    pub scope: Option<DecideScope>,
}

/// Why a mandate asks to be re-read, with the figures that fired it. Codes
/// and numbers only: the words are the frontend's. Computed by the app layer
/// (it needs the routed items) and attached to [`MandateSummary::reread`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MandateReread {
    pub code: RereadCode,
    /// Items on this mandate reaching the operator now (Breach, not valves).
    pub asks: u32,
    /// Standing decision acts (router and steward).
    #[ts(type = "number")]
    pub acts: i64,
    /// Spend as a whole percent of the cap; `None` when either is unknown.
    pub spend_pct: Option<u32>,
    #[ts(type = "number")]
    pub merges_since_read: i64,
    /// The scope that would absorb the most asks, and how many.
    pub lead_scope: Option<DecideScope>,
    pub lead_absorbs: u32,
    /// The marker a keep left, for "you kept it at N acts".
    #[ts(type = "number | null")]
    pub kept_at_acts: Option<i64>,
    pub suggest: Option<RereadSuggestion>,
}

// ---------------------------------------------------------------------------
// Where a mandate came from (orphans, WP6)
// ---------------------------------------------------------------------------

/// How a mandate that did not come from a hire or the operator's own charter
/// form was made.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum MandateOriginKind {
    /// Drafted from a cluster of orphans (by the sweep or the operator).
    OrphanDraft,
    /// Made by adopting an orphaned project into an existing mandate: the
    /// mandate's steward and envelope now cover that project too.
    Adopted,
}

/// `persona_responsibilities.spec.mandateOrigin`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MandateOrigin {
    pub kind: MandateOriginKind,
    /// Orphans the project held when the mandate was made.
    #[serde(default)]
    pub orphans: Option<u32>,
    /// The orphan law's code that fired (`large` | `growing`); `None` when the
    /// operator drafted or adopted without it firing.
    #[serde(default)]
    pub why: Option<String>,
    /// The mandate an adoption copied its steward and envelope from.
    #[serde(default)]
    pub from_charter_id: Option<String>,
    /// The steward also stewards another project's mandate. Routing then maps
    /// that persona's own items (reports, incidents) by its HOME mandate, and
    /// this one never makes them ambiguous.
    #[serde(default)]
    pub borrowed_steward: bool,
    /// The sweep drafted it (`true`) or the operator did (`false`).
    #[serde(default)]
    pub automatic: bool,
}

// ---------------------------------------------------------------------------
// The list view
// ---------------------------------------------------------------------------

/// How loaded a mandate is right now. Each figure names its source; a figure
/// the store could not read is `None`, never `0`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MandateLoad {
    /// The steward persona's settled spend this calendar month:
    /// `persona_executions.cost_usd` under the shared monthly-spend predicate,
    /// the same denominator the overnight budget governor checks the cap
    /// against. Headless CLI calls (`dev_llm_spend`) are NOT in it.
    pub spend_used_usd: Option<f64>,
    /// The cap, repeated from the envelope so a row reads used / cap.
    pub budget_usd: Option<f64>,
    /// Rows in `charter_acts` for this charter, all time.
    #[ts(type = "number | null")]
    pub acts_count: Option<i64>,
    /// Pending `persona_manual_reviews` of the steward whose
    /// `context_data.source = 'app_master_ask'` (and whose `projectId` is this
    /// mandate's project, when the row names one).
    #[ts(type = "number | null")]
    pub open_asks: Option<i64>,
}

/// One mandate as the Stewards plate and the mandate page read it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MandateSummary {
    /// The charter id (`persona_responsibilities.id`).
    pub charter_id: String,
    pub title: String,
    pub project_id: String,
    /// `dev_projects.name`; `None` when the project row is gone.
    pub project_name: Option<String>,
    pub steward_persona_id: String,
    /// `personas.name`; `None` when the persona row is gone.
    pub steward_name: Option<String>,
    /// 'draft' | 'active' | 'suspended'.
    pub status: String,
    pub scope_rung: u8,
    pub source: String,
    pub envelope: MandateEnvelope,
    pub load: MandateLoad,
    pub updated_at: String,
    /// Why this signed mandate asks to be read again, when it does. Filled by
    /// the app layer's `mandate_list` / `mandate_get` (the law needs the
    /// routed items); `None` from the store alone.
    pub reread: Option<MandateReread>,
    /// How the mandate was made, when it came from the orphanage.
    pub origin: Option<MandateOrigin>,
    /// `Some` when this device only MIRRORS the mandate (WP9): its home is
    /// another paired device, this device never writes it, and every verdict
    /// taken here is sent home. `None` on the home device.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub mirror: Option<super::charter_mirror::MandateMirror>,
}

/// What every envelope door returns: the refreshed mandate and the act it wrote.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MandateActOutcome {
    pub mandate: MandateSummary,
    pub act: CharterAct,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_wire_spelling_round_trips() {
        for s in ALL_DECIDE_SCOPES {
            let json = serde_json::to_string(&s).unwrap();
            assert_eq!(json, format!("\"{}\"", s.as_str()));
            assert_eq!(DecideScope::parse(s.as_str()), Some(s));
        }
        assert_eq!(DecideScope::parse("idea.merge"), None);
    }

    #[test]
    fn merge_policy_matches_the_db_check() {
        for p in [
            MergePolicy::Never,
            MergePolicy::GateGreen,
            MergePolicy::GateGreenCouncilReady,
        ] {
            assert_eq!(
                serde_json::to_string(&p).unwrap(),
                format!("\"{}\"", p.as_str())
            );
            assert_eq!(MergePolicy::parse(p.as_str()), Some(p));
        }
        assert_eq!(MergePolicy::default(), MergePolicy::Never);
    }

    #[test]
    fn only_a_signed_envelope_binds_its_merge_policy() {
        let unsigned = MandateEnvelope::default();
        assert_eq!(unsigned.merge_policy, MergePolicy::Never);
        assert_eq!(unsigned.binding_merge_policy(), None);
        for p in [
            MergePolicy::Never,
            MergePolicy::GateGreen,
            MergePolicy::GateGreenCouncilReady,
        ] {
            let signed = MandateEnvelope {
                merge_policy: p,
                envelope_version: 1,
                ..Default::default()
            };
            assert_eq!(signed.binding_merge_policy(), Some(p));
        }
    }

    #[test]
    fn a_change_is_tagged_by_kind() {
        let c = MandateChange::WidenScope {
            scopes: vec![DecideScope::Dispatch],
        };
        assert_eq!(
            serde_json::to_string(&c).unwrap(),
            r#"{"kind":"widenScope","scopes":["dispatch"]}"#
        );
        let b: MandateChange = serde_json::from_str(r#"{"kind":"setBudget","usd":null}"#).unwrap();
        assert_eq!(b, MandateChange::SetBudget { usd: None });
    }

    #[test]
    fn an_irreversible_refusal_is_forbidden_at_the_boundary() {
        let e: AppError = CharterActRevertError::Refused(CharterActRevertRefusal::Irreversible {
            act_id: "a".into(),
            item_kind: "merge".into(),
        })
        .into();
        assert!(matches!(e, AppError::Forbidden(_)), "{e:?}");
    }
}
