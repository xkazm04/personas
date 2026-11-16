//! The standup wire contract (spark app-standup, WP0 contract freeze).
//!
//! FROZEN: WP1 (core), WP2 (resources), WP3 (supervisor) and the UI builder
//! all compile against these shapes in parallel. Change a field only through
//! the Director, and diff the regenerated binding against the frozen one.
//!
//! Persistence: one `companion_standup` row per revision (user DB,
//! `COMPANION_SCHEMA`), with [`StandupPlan`], [`AwayRules`] and
//! [`StandupReport`] stored as JSON columns; one `companion_standup_event` row
//! per away act ([`StandupEvent`]).
//!
//! Absent-value rule: an `Option` field is omitted from the payload (TS
//! optional), never sent as `null`. Millisecond timestamps are `i64` pinned to
//! TS `number`; counts and priorities are `i32`. Enum values serialize as the
//! snake_case strings listed on each variant, which are also the SQL CHECK
//! sets in `COMPANION_SCHEMA`.
//!
//! `device_id` on [`Standup`] and on every [`StandupItem`] is the Phase 2
//! multi-device hook: v1 always writes this device's id.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Lifecycle of one standup revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StandupStatus {
    /// Being interviewed / edited; nothing runs.
    Draft,
    /// Passed the go-gate; drives the in-app machinery.
    Armed,
    /// A later revision (re-open) replaced it; its running sessions continue.
    Superseded,
    /// Closed by the operator; its report is final.
    Ended,
}

/// What a plan item asks the machinery to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StandupItemKind {
    /// A project direction (charter amendment + attention loop + dispatch).
    Direction,
    /// Create a persona ([`CreateAgentSpec`]).
    CreateAgent,
    /// Retune an existing persona ([`RetuneAgentSpec`]).
    RetuneAgent,
    /// Backfill work queued for a dead spot.
    Filler,
}

/// The operator's resolution of a plan item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StandupItemState {
    Proposed,
    Accepted,
    Edited,
    Skipped,
}

/// When in the day an item may run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StandupWindow {
    Day,
    Night,
    Any,
}

/// A class of away decision: either delegated to Athena or parked for the
/// operator by [`AwayRules`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AwayRuleClass {
    Scope,
    Goals,
    DependencyBump,
    Retune,
    CreateAgent,
    Money,
    Data,
    Schema,
    Secrets,
    Push,
}

/// What one away act was. Also the SQL CHECK set of
/// `companion_standup_event.kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StandupEventKind {
    Sweep,
    Drift,
    AskDelegated,
    AskParked,
    Dispatch,
    Backfill,
    AgentCreated,
    AgentRetuned,
    Push,
    Stop,
}

/// One standup revision: the plan, the away rules and (once anything moved)
/// the report.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Standup {
    pub id: String,
    /// 1 for a fresh standup; n+1 when re-opened on an armed plan.
    pub revision: i32,
    /// The revision this one was copied from.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub parent_id: Option<String>,
    pub status: StandupStatus,
    pub device_id: String,
    #[ts(type = "number")]
    pub opened_at: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional, type = "number")]
    pub armed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional, type = "number")]
    pub ended_at: Option<i64>,
    pub plan: StandupPlan,
    pub away_rules: AwayRules,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub report: Option<StandupReport>,
}

/// The work items of one revision.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StandupPlan {
    pub items: Vec<StandupItem>,
}

/// One card on the standup page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StandupItem {
    pub id: String,
    pub kind: StandupItemKind,
    /// The registered project the item concerns; absent for a project-less
    /// agent change.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub project_id: Option<String>,
    pub device_id: String,
    pub state: StandupItemState,
    /// Athena's 2-4 candidate directions (empty for agent changes and filler,
    /// and when proposing failed - the operator then writes `chosen`).
    pub proposals: Vec<DirectionProposal>,
    /// The agreed direction text: a proposal's text, or the operator's edit.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub chosen: Option<String>,
    /// The persona the item runs as / retunes.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub persona_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub create_spec: Option<CreateAgentSpec>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub retune_spec: Option<RetuneAgentSpec>,
    pub window: StandupWindow,
    /// Earliest dispatch time, epoch ms (`DispatchRequest.not_before_ms`).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional, type = "number")]
    pub not_before_ms: Option<i64>,
    /// Lower runs first.
    pub priority: i32,
    /// One line of what moved / what is blocked, from status, merges, asks
    /// and git ahead-behind.
    pub evidence: String,
}

/// One candidate direction Athena proposes for a project.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirectionProposal {
    pub id: String,
    pub text: String,
    pub rationale: String,
    /// Athena's pick among the proposals (at most one per item).
    pub recommended: bool,
}

/// What a `create_agent` item creates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentSpec {
    pub name: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub project_id: Option<String>,
    /// The persona's charter text.
    pub charter: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub model: Option<String>,
}

/// What a `retune_agent` item changes on an existing persona.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RetuneAgentSpec {
    pub persona_id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub pacing_minutes: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub note: Option<String>,
}

/// Which away decisions Athena may take herself and which she parks.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AwayRules {
    pub delegate: Vec<AwayRuleClass>,
    pub park: Vec<AwayRuleClass>,
    /// The only pushes allowed while away; any other push parks.
    pub push_targets: Vec<PushTarget>,
}

/// One allowed push destination.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PushTarget {
    pub project_id: String,
    pub remote: String,
    pub branch: String,
}

/// One away act, as written to `companion_standup_event`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StandupEvent {
    pub id: String,
    pub standup_id: String,
    #[ts(type = "number")]
    pub at: i64,
    pub kind: StandupEventKind,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub project_id: Option<String>,
    pub summary: String,
    /// Kind-specific detail (`detail_json`): a parked ask's options, a
    /// dispatch's session id, a push's SHA. Always a JSON object.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional, type = "Record<string, unknown>")]
    pub detail: Option<serde_json::Value>,
}

/// "Since last standup": what moved per project while the plan was armed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StandupReport {
    #[ts(type = "number")]
    pub since_ms: i64,
    pub projects: Vec<StandupProjectReport>,
    /// Personas created during the window (away creates carry
    /// `origin = standup-away`).
    pub created_agents: Vec<CreatedAgentRef>,
}

/// One project's slice of the report.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StandupProjectReport {
    pub project_id: String,
    pub moved: Vec<MovedCommit>,
    /// Sessions still running for the project at report time.
    pub running: i32,
    /// Asks parked for the operator, with their options.
    pub parked: Vec<ParkedAsk>,
    /// The next decision the operator owns on this project, if any.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub next_decide: Option<String>,
}

/// One commit that landed during the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MovedCommit {
    pub sha: String,
    pub summary: String,
}

/// One ask parked by an away rule, waiting for the operator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ParkedAsk {
    /// The `ask_parked` [`StandupEvent`] that recorded it.
    pub event_id: String,
    pub summary: String,
    pub options: Vec<String>,
}

/// A persona created under the standup (at arm, or while away).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreatedAgentRef {
    pub persona_id: String,
    pub name: String,
    /// True when Athena created it while away (not at the go-gate).
    pub away: bool,
}

/// A partial edit of one plan item (`standup_update_item`). Absent fields
/// are left unchanged.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StandupItemPatch {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub state: Option<StandupItemState>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub chosen: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub window: Option<StandupWindow>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub priority: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional, type = "number")]
    pub not_before_ms: Option<i64>,
}

/// One row of the standup history list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StandupSummary {
    pub id: String,
    pub revision: i32,
    pub status: StandupStatus,
    #[ts(type = "number")]
    pub opened_at: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional, type = "number")]
    pub armed_at: Option<i64>,
    /// Number of plan items in the revision.
    pub item_count: i32,
}
