//! Team assignment + orchestration models — Phase A of the team-assignment
//! redesign. An assignment is a goal-driven, persona-matched workflow that runs
//! on top of a `PersonaTeam`. Each assignment owns an ordered (DAG) list of
//! steps; the orchestrator (`engine::team_assignment_orchestrator`) walks the
//! DAG, kicks off persona executions, and surfaces failures through the
//! existing notification center for human review.
//!
//! Three tables, all additive — no changes to existing schemas:
//! - `team_assignments`         — one row per goal
//! - `team_assignment_steps`    — one row per checklist item
//! - `team_assignment_events`   — audit trail (created / matched / done / failed)
//!
//! `capability_tags` deliberately does NOT exist on personas. The capability
//! matching corpus (Phase B) reuses the existing `DesignUseCase[]` array on
//! `persona.design_context`. See `team_assignment_orchestrator` for the
//! resolution flow.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Status enums (snake_case on the wire, matches the rest of the codebase)
// ============================================================================

/// Lifecycle states for a `TeamAssignment`. Terminal: `done`, `failed`, `aborted`.
/// `awaiting_review` is a soft pause — the orchestrator stops the tick loop
/// only for THIS assignment; other assignments on the same team continue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum TeamAssignmentStatus {
    Queued,
    Running,
    AwaitingReview,
    Done,
    Failed,
    Aborted,
}

impl TeamAssignmentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::AwaitingReview => "awaiting_review",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Aborted => "aborted",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Done | Self::Failed | Self::Aborted)
    }
}

/// Lifecycle states for a `TeamAssignmentStep`. Terminal: `done`, `skipped`,
/// `failed`. `matching` is short-lived (the orchestrator resolves persona+UC
/// then immediately transitions to `running` once execution is created).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum TeamAssignmentStepStatus {
    Pending,
    Matching,
    Running,
    AwaitingReview,
    Done,
    Skipped,
    Failed,
}

impl TeamAssignmentStepStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Matching => "matching",
            Self::Running => "running",
            Self::AwaitingReview => "awaiting_review",
            Self::Done => "done",
            Self::Skipped => "skipped",
            Self::Failed => "failed",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Done | Self::Skipped | Self::Failed)
    }
}

/// How the orchestrator resolves persona+use_case for each step.
///
/// Phase A ships `Manual` only — the user picks `assigned_persona_id` +
/// `assigned_use_case_id` at composer time. Phase B adds `Embedding` (cosine
/// match via existing fastembed) and `LlmEval` (Sonnet via the existing
/// `ClaudeProvider` subscription path).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum TeamAssignmentMatchStrategy {
    Manual,
    Embedding,
    LlmEval,
}

impl TeamAssignmentMatchStrategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Embedding => "embedding",
            Self::LlmEval => "llm_eval",
        }
    }
}

/// Where the assignment was created. Drives analytics + behaviour: when
/// `source = Athena`, `companion_op_id` is set and the orchestrator forwards
/// progress events to companion `OperativeMemory` (Phase C wiring).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum TeamAssignmentSource {
    TeamUi,
    Athena,
    Api,
}

impl TeamAssignmentSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TeamUi => "team_ui",
            Self::Athena => "athena",
            Self::Api => "api",
        }
    }
}

// ============================================================================
// Row types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamAssignment {
    pub id: String,
    pub team_id: String,
    pub title: String,
    pub goal: String,
    pub status: String,
    pub match_strategy: String,
    pub max_parallel_steps: i32,
    pub source: String,
    pub companion_op_id: Option<String>,
    /// Goals hub: the `dev_goals` row this assignment advances (soft link, no FK).
    /// Terminal/step transitions write `dev_goal_signals` for the linked goal.
    pub goal_id: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamAssignmentStep {
    pub id: String,
    pub assignment_id: String,
    pub step_order: i32,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub assigned_persona_id: Option<String>,
    pub assigned_use_case_id: Option<String>,
    pub match_confidence: Option<f64>,
    pub match_rationale: Option<String>,
    pub execution_id: Option<String>,
    /// JSON array of step ids — `depends_on` for DAG-style ordering.
    /// Empty array (or null) = no prerequisites, eligible from the start.
    pub depends_on: Option<String>,
    pub output_summary: Option<String>,
    pub retry_count: i32,
    pub error_message: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamAssignmentEvent {
    pub id: String,
    pub assignment_id: String,
    pub step_id: Option<String>,
    pub kind: String,
    pub payload: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Input / payload types (composer + orchestrator)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamAssignmentInput {
    pub team_id: String,
    pub title: String,
    pub goal: String,
    /// Phase A defaults to `"manual"`. Phase B will accept `"embedding"` and
    /// `"llm_eval"`.
    #[serde(default)]
    pub match_strategy: Option<String>,
    #[serde(default)]
    pub max_parallel_steps: Option<i32>,
    /// Defaults to `"team_ui"`.
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub companion_op_id: Option<String>,
    /// Goals hub: optionally link this assignment to a `dev_goals` row.
    #[serde(default)]
    pub goal_id: Option<String>,
    /// Pre-decomposed step list. Phase A REQUIRES this to be non-empty (manual
    /// matching means the user has already chosen personas at composer time).
    /// Phase B will allow `steps = []` + auto-decompose via Sonnet.
    pub steps: Vec<CreateTeamAssignmentStepInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamAssignmentStepInput {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Manual-match: the persona this step will run against. Required in
    /// Phase A (manual strategy is the only one available). For embedding /
    /// llm_eval strategies (Phase B) this is optional — the orchestrator
    /// resolves it at match time.
    #[serde(default)]
    pub assigned_persona_id: Option<String>,
    /// Which `DesignUseCase` on the assigned persona drives this step.
    /// Optional even in manual mode — when absent, the orchestrator runs the
    /// persona without a use-case scope.
    #[serde(default)]
    pub assigned_use_case_id: Option<String>,
    /// Indices into the surrounding `steps` array (NOT step ids — ids are
    /// generated at insert time). The repo translates indices → ids before
    /// persisting. Empty / absent = no dependencies, eligible from start.
    #[serde(default)]
    pub depends_on_indices: Option<Vec<i32>>,
}

/// Wire-format detail view returned by `get_team_assignment_detail` —
/// the assignment header + its full step list + the most recent audit
/// events. The frontend uses this as the single payload backing the
/// checklist view + review modal (Phase A3 / A4).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamAssignmentDetail {
    pub assignment: TeamAssignment,
    pub steps: Vec<TeamAssignmentStep>,
    pub recent_events: Vec<TeamAssignmentEvent>,
}

// ============================================================================
// Templates (Phase C4) — reusable assignment shapes
// ============================================================================

/// A saved assignment template. Stamps out a fresh `team_assignments` row
/// (plus its steps) on instantiation. `steps_json` is a serialized
/// `Vec<CreateTeamAssignmentStepInput>` — the same shape the composer
/// submits — so instantiation is a straight clone into the create path.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamAssignmentTemplate {
    pub id: String,
    pub team_id: String,
    pub title: String,
    pub goal: String,
    pub match_strategy: String,
    pub max_parallel_steps: i32,
    /// JSON array of `CreateTeamAssignmentStepInput`. Parsed on instantiate.
    pub steps_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamAssignmentTemplateInput {
    pub team_id: String,
    pub title: String,
    pub goal: String,
    #[serde(default)]
    pub match_strategy: Option<String>,
    #[serde(default)]
    pub max_parallel_steps: Option<i32>,
    pub steps: Vec<CreateTeamAssignmentStepInput>,
}

/// Action taken by a user resolving an `awaiting_review` step.
/// Maps 1:1 to the four buttons in the AssignmentReviewModal (Phase A4).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "action", content = "data")]
pub enum ResolveStepReviewAction {
    /// Rewrite the step's description, reset status to `pending`, requeue
    /// for matching. Use when the original requirement was wrong.
    EditRequirement { description: String },
    /// Override the persona/use-case pick and requeue the step. Use when
    /// the original assignee couldn't handle it and a different team
    /// member can.
    Reassign {
        persona_id: String,
        #[serde(default)]
        use_case_id: Option<String>,
    },
    /// Mark this step as skipped. Cascade-skip semantics apply to all
    /// steps whose `depends_on` includes this step.
    Skip,
    /// Terminal: mark the entire assignment as `aborted`.
    Abort,
}
