use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Dev Ideas: canonical category vocabulary
// ============================================================================
//
// The `dev_ideas.category` column historically carried two clashing
// vocabularies depending on the row's origin:
//
//   - LLM scanner (`commands/infrastructure/idea_scanner.rs`) emits
//     {technical, user, business, mastermind} keyed off scan-agent groups.
//   - DB default + early-prototype frontend constants used
//     {functionality, performance, maintenance, ui, code_quality, user_benefit}.
//
// `IdeaTriagePage` filters on the first set, so a row with
// `category='functionality'` was silently dropped from every category facet.
// `IdeaCategory` below is the single canonical vocabulary going forward; the
// scanner prompt is pinned to it, the DB default is migrated to it (see
// `helpers::reconcile_idea_category_vocabulary`), and ts-rs exports it for
// the frontend triage UI.
//
// Mapping legacy → canonical (one-shot, idempotent):
//   functionality → technical
//   performance   → technical
//   maintenance   → technical
//   code_quality  → technical
//   ui            → user
//   user_benefit  → user
//
// Anything outside both vocabularies is left untouched and logged at startup
// for forensic review.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum IdeaCategory {
    Technical,
    User,
    Business,
    Mastermind,
}

impl IdeaCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Technical => "technical",
            Self::User => "user",
            Self::Business => "business",
            Self::Mastermind => "mastermind",
        }
    }

    /// Parse a token from any vocabulary. Legacy values map to the canonical
    /// equivalent; canonical values pass through; anything else returns None.
    pub fn from_token(s: &str) -> Option<Self> {
        match s {
            // Canonical
            "technical" => Some(Self::Technical),
            "user" => Some(Self::User),
            "business" => Some(Self::Business),
            "mastermind" => Some(Self::Mastermind),
            // Legacy → canonical (one-way, written down here so future readers
            // see the mapping without diffing migrations).
            "functionality" | "performance" | "maintenance" | "code_quality" => {
                Some(Self::Technical)
            }
            "ui" | "user_benefit" => Some(Self::User),
            _ => None,
        }
    }
}

/// Default canonical category for ideas with no explicit category. Mirrors
/// the DB column default: keeps generic ideas in the "technical" bucket
/// so they remain visible in the triage UI's default filter.
pub const DEFAULT_IDEA_CATEGORY: IdeaCategory = IdeaCategory::Technical;

// ============================================================================
// Dev Projects
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevProject {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub description: Option<String>,
    pub status: String,
    pub tech_stack: Option<String>,
    pub github_url: Option<String>,
    pub monitoring_credential_id: Option<String>,
    pub monitoring_project_slug: Option<String>,
    /// JSON envelope `{ tool, command }` configuring the static-analysis CLI
    /// the `static_scan` runner spawns for this project. None disables the
    /// per-project sweep; the runner falls back to package-manager detection.
    pub static_scan_config: Option<String>,
    /// When true and the task ran inside a worktree, `task_executor` pushes
    /// the worktree branch and opens a PR after the task succeeds. Failures
    /// are surfaced in the task log but do NOT mark the task as failed.
    pub auto_pr_on_success: bool,
    /// GitHub credential row id used to authorise the auto-PR call. Nullable;
    /// when None and `auto_pr_on_success` is true the wiring emits a warning
    /// and skips PR creation.
    pub pr_credential_id: Option<String>,
    /// Optional binding to a `PersonaTeam` (PipelineTeam). When set, the
    /// project's surface in `ProjectManagerPage` shows the bound team's name
    /// inline so the developer can see at a glance which pipeline owns the
    /// work. No FK constraint by design — deleting a team leaves the project
    /// orphan-bound; UI treats unresolved team_ids as "(team removed)" and
    /// the user can re-bind. Added 2026-05-22.
    pub team_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DirectoryScanResult {
    pub root_path: String,
    pub file_count: i32,
    pub dir_count: i32,
    pub detected_tech: String,
    pub has_git: bool,
}

// ============================================================================
// Dev Goals
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevGoal {
    pub id: String,
    pub project_id: String,
    pub parent_goal_id: Option<String>,
    pub context_id: Option<String>,
    pub order_index: i32,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub progress: i32,
    pub target_date: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Goal Dependencies
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevGoalDependency {
    pub id: String,
    pub goal_id: String,
    pub depends_on_id: String,
    pub dependency_type: String,
    pub created_at: String,
}

// ============================================================================
// Dev Goal Signals
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevGoalSignal {
    pub id: String,
    pub goal_id: String,
    pub signal_type: String,
    pub source_id: Option<String>,
    pub delta: Option<i32>,
    pub message: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Dev Context Groups
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevContextGroup {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub group_type: Option<String>,
    pub position: i32,
    pub health_score: Option<i32>,
    pub last_scan_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Contexts
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevContext {
    pub id: String,
    pub project_id: String,
    pub group_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub file_paths: String,
    pub entry_points: Option<String>,
    pub db_tables: Option<String>,
    pub keywords: Option<String>,
    pub api_surface: Option<String>,
    pub cross_refs: Option<String>,
    pub tech_stack: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Context Group Relationships
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevContextGroupRelationship {
    pub id: String,
    pub project_id: String,
    pub source_group_id: String,
    pub target_group_id: String,
    pub created_at: String,
}

// ============================================================================
// Dev Ideas
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevIdea {
    pub id: String,
    pub project_id: Option<String>,
    pub context_id: Option<String>,
    pub scan_type: String,
    pub category: String,
    pub title: String,
    pub description: Option<String>,
    pub reasoning: Option<String>,
    pub status: String,
    pub effort: Option<i32>,
    pub impact: Option<i32>,
    pub risk: Option<i32>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub rejection_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dev Scans
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevScan {
    pub id: String,
    pub project_id: Option<String>,
    pub scan_type: String,
    pub status: String,
    pub idea_count: i32,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub duration_ms: Option<i64>,
    pub error: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Dev Tasks
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevTask {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub source_idea_id: Option<String>,
    pub goal_id: Option<String>,
    pub status: String,
    pub session_id: Option<String>,
    pub progress_pct: i32,
    pub output_lines: i32,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    /// Task depth: "quick" (immediate execution), "campaign" (subtask breakdown),
    /// or "deep_build" (full planning + implementation phases).
    pub depth: String,
}

// ============================================================================
// Dev Competitions (multi-clone parallel task execution)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevCompetition {
    pub id: String,
    pub project_id: String,
    pub task_title: String,
    pub task_description: Option<String>,
    pub source_idea_id: Option<String>,
    pub source_goal_id: Option<String>,
    pub slot_count: i32,
    pub status: String, // 'running' | 'awaiting_review' | 'resolved' | 'cancelled'
    pub winner_task_id: Option<String>,
    pub winner_insight: Option<String>,
    pub baseline_json: Option<String>,
    pub reviewer_notes: Option<String>,
    pub worktree_base_ref: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevCompetitionSlot {
    pub id: String,
    pub competition_id: String,
    pub task_id: String,
    pub strategy_label: String,
    pub strategy_prompt: Option<String>,
    pub worktree_name: String,
    pub branch_name: Option<String>,
    pub slot_index: i32,
    pub disqualified: bool,
    pub disqualify_reason: Option<String>,
    pub diff_hash: Option<String>,
    pub diff_stats_json: Option<String>,
    pub diff_analyzed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevStrategyStats {
    pub label: String,
    pub wins: i32,
    pub total: i32,
    pub disqualified_count: i32,
    pub win_rate: f64,
    pub last_win_at: Option<String>,
}

// ============================================================================
// Scan Agent Meta
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScanAgentMeta {
    pub key: String,
    pub label: String,
    pub emoji: String,
    pub abbreviation: String,
    pub color: String,
    pub category_group: String,
    pub description: String,
    pub examples: String,
}

// ============================================================================
// Triage Rules
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TriageRule {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub conditions: String,
    pub action: String,
    pub enabled: bool,
    pub times_fired: i32,
    pub created_at: String,
}

// ============================================================================
// Dev Pipelines (Idea-to-Execution)
// ============================================================================

/// Pipeline stages: triaged -> task_created -> executing -> verifying -> completed | failed
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevPipeline {
    pub id: String,
    pub project_id: String,
    pub idea_id: String,
    pub task_id: Option<String>,
    pub stage: String,
    pub auto_execute: bool,
    pub verify_after: bool,
    pub verification_scan_id: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Cross-Project Relationships (Codebases connector)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CrossProjectRelation {
    pub id: String,
    pub source_project_id: String,
    pub target_project_id: String,
    pub relation_type: String, // "shared_dependency" | "api_consumer" | "shared_types" | "monorepo_sibling"
    pub details: Option<String>, // JSON: extra data about the relation
    pub created_at: String,
    pub updated_at: String,
}

/// Summary returned by the portfolio health tool.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PortfolioHealthSummary {
    pub total_projects: i32,
    pub active_projects: i32,
    pub total_ideas: i32,
    pub pending_ideas: i32,
    pub total_tasks: i32,
    pub running_tasks: i32,
    pub avg_health_score: Option<f64>,
    pub projects: Vec<ProjectHealthEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectHealthEntry {
    pub project_id: String,
    pub project_name: String,
    pub status: String,
    pub tech_stack: Option<String>,
    pub context_count: i32,
    pub idea_count: i32,
    pub task_count: i32,
    pub latest_health_score: Option<i32>,
    pub open_risk_count: i32,
}

/// Entry in the tech radar aggregation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TechRadarEntry {
    pub technology: String,
    pub category: String, // "language" | "framework" | "database" | "tool" | "library"
    pub project_count: i32,
    pub project_names: Vec<String>,
    pub status: String, // "adopt" | "trial" | "assess" | "hold"
}

/// Entry in the risk matrix aggregation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RiskMatrixEntry {
    pub project_id: String,
    pub project_name: String,
    pub risk_category: String, // "dependency_drift" | "stale_project" | "no_tests" | "security" | "single_maintainer" | "tech_debt"
    pub severity: String,      // "low" | "medium" | "high" | "critical"
    pub description: String,
    pub affected_contexts: Vec<String>,
}

/// Result from running tests on a project.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TestRunResult {
    pub project_id: String,
    pub success: bool,
    pub total_tests: i32,
    pub passed: i32,
    pub failed: i32,
    pub skipped: i32,
    pub duration_ms: i64,
    pub output: String,
    pub error: Option<String>,
}

/// Result from a git operation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GitOperationResult {
    pub success: bool,
    pub message: String,
    pub branch_name: Option<String>,
    pub commit_hash: Option<String>,
    pub files_changed: Option<i32>,
}

// ============================================================================
// Context Health Snapshots
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ContextHealthSnapshot {
    pub id: String,
    pub project_id: String,
    pub group_id: Option<String>,
    pub group_name: String,
    pub overall_score: i32,
    pub security_score: Option<i32>,
    pub quality_score: Option<i32>,
    pub coverage_score: Option<i32>,
    pub debt_score: Option<i32>,
    pub issues_found: i32,
    pub issues_json: Option<String>,
    pub recommendations: Option<String>,
    pub scanned_at: String,
}
