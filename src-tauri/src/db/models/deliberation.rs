//! Design D — Team Channel Deliberation Engine (data shapes).
//!
//! The autonomous *deliberation* plane: a bounded, moderated team conversation
//! that produces decisions/work which feed the deterministic execution engine
//! (`run_assignment`). See docs/plans/team-deliberation-engine.md.
//!
//! D1 lands the schema + types only — nothing is wired into the engine yet and
//! the whole feature sits behind a default-OFF flag (added in D2). The doctrine
//! preserved: the LLM never enters the execution tick loop; this is a separate,
//! budgeted, moderated loop that *emits* into the existing orchestrator.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One deliberation: a bounded conversation with a topic and a live agenda.
/// Length is bounded by **progress** — the agenda backbone plus
/// `consecutive_stall_rounds` — NOT by a turn count (see the plan §6). Cost and
/// idle deadlines are the hard floors.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamDeliberation {
    pub id: String,
    pub team_id: String,
    /// The question the team is deliberating.
    pub topic: String,
    /// Optional prose: what a good outcome looks like.
    pub goal: Option<String>,
    /// 'open' | 'converging' | 'resolved' | 'escalated' | 'paused' | 'aborted'
    /// | 'awaiting_action' (a persona requested a capability — parked until the
    /// user approves/skips it; see `pending_action`).
    pub status: String,
    /// Moderator rounds so far (escalation cadence).
    pub round: i32,
    /// Consecutive non-productive rounds — the circularity bound that replaces
    /// the turn budget. Reset to 0 on a `progressed` round.
    pub consecutive_stall_rounds: i32,
    /// Hard cost floor (USD): pause + escalate when `cost_spent_usd` exceeds it.
    pub cost_budget_usd: Option<f64>,
    /// Rolled-up CLI spend for this deliberation (USD).
    pub cost_spent_usd: f64,
    /// Hard wall-clock floor: auto-pause if no progress / no user activity by then.
    pub idle_deadline: Option<String>,
    /// JSON `{kind:'proposal'|'assignment'|'none', ...}` once resolved.
    pub resolution: Option<String>,
    /// Set when a proposal feeds the DAG.
    pub spawned_assignment_id: Option<String>,
    /// JSON [`PendingAction`] when `status` is 'awaiting_action' — a persona
    /// requested a capability mid-deliberation and it is gated on user approval
    /// (decision 8). `None` otherwise.
    pub pending_action: Option<String>,
    /// 'user' | 'athena' — who opened it.
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

/// One agenda item — the backbone that defines termination. A deliberation ends
/// when every item is `resolved`/`spawned` (or the user closes it).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeliberationAgendaItem {
    pub id: String,
    pub deliberation_id: String,
    /// An open question / sub-goal under discussion.
    pub item: String,
    /// 'open' | 'resolved' | 'spawned'
    pub status: String,
    /// Decision text, or the spawned assignment id.
    pub resolution: Option<String>,
    /// 'moderator' | persona id | 'user'
    pub opened_by: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

/// Typed shape of the `personas.core_profile` JSON column — a persona's
/// deliberation identity: a distinct, motivated point of view. Authored at the
/// template level (D5); the moderator reasons over the dials to pick the *key*
/// personas for an agenda item (decision 7). Dials are 0.0..1.0.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaCore {
    /// Authored prose: why this persona cares.
    pub motivation: String,
    /// Authored prose: its distinctive point of view.
    pub stance: String,
    /// How IT believes the team reaches #1 — the route, not the shared goal.
    pub north_star_commitment: String,
    /// 0 = risk-averse, 1 = risk-seeking.
    pub risk_tolerance: f64,
    /// 0 = quality-max, 1 = speed-max.
    pub speed_vs_quality: f64,
    /// 'challenger' | 'harmonizer' | 'analyst' | 'pragmatist'
    pub conflict_style: String,
    /// 0 = holds its ground, 1 = yields readily to stronger arguments.
    pub deference: f64,
}

/// Typed shape of the `persona_teams.north_star` JSON column — the shared
/// motivation every member imprints ("be #1 in category"). Authored at the
/// team-preset level (D5). Each member shares the `aim` but reaches it via its
/// own `PersonaCore.north_star_commitment` (distinct routes).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamNorthStar {
    /// e.g. "Become the #1 <category> product".
    pub aim: String,
    /// The category the team competes in.
    pub category: String,
    /// What winning looks like (≤5 signals).
    pub success_signals: Vec<String>,
}

/// The synthesized output of a resolved deliberation — a concrete assignment the
/// team can execute. Stored in `team_deliberations.resolution` (as `proposal`)
/// and, once approved (decision 8 — always gated in v1), handed to the
/// team-assignment engine as the goal (D4).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProposalSpec {
    /// Short human title for the approval surface.
    pub title: String,
    /// The objective handed to the assignment engine as the goal text.
    pub objective: String,
    /// 2-3 sentences: what was decided and why.
    pub summary: String,
}

/// A persona's mid-deliberation capability request, parked for user approval
/// (decision 8 — always gated). Serialized as JSON into
/// `team_deliberations.pending_action`; the UI renders an Approve/Skip card.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PendingAction {
    /// The persona that wants to act.
    pub persona_id: String,
    pub persona_name: String,
    /// The capability (use case) it wants to run.
    pub use_case_id: String,
    pub use_case_title: String,
    /// The persona's one-line rationale for acting now.
    pub rationale: String,
}

/// Input for opening a deliberation (user or Athena — decision 4).
#[derive(Debug, Clone, Deserialize)]
pub struct CreateDeliberationInput {
    pub team_id: String,
    pub topic: String,
    pub goal: Option<String>,
    /// 'user' | 'athena'. Defaults to 'user' when None.
    pub created_by: Option<String>,
    pub cost_budget_usd: Option<f64>,
    pub idle_deadline: Option<String>,
}
