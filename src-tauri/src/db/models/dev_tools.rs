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
    /// URL of the living test environment this team delivers into (e.g. a
    /// staging/preview deployment). Nullable; set once the env exists.
    pub test_env_url: Option<String>,
    /// Branch deployed to the living test environment (e.g. `staging`). Nullable.
    pub test_env_branch: Option<String>,
    /// The project's primary/default branch (e.g. `main` or `master`). The
    /// source-control pipeline stage's baseline; nullable, auto-prefilled from
    /// the repo's default branch when known. Added 2026-05-31.
    pub main_branch: Option<String>,
    /// Standards & branching policy (Pipeline Stage 3). Opaque JSON envelope
    /// `{ precommit:{lint,docs_required,code_quality}, branching:{pr_base,automerge} }`
    /// the connected team's personas must respect (injected into member
    /// executions via team_context + CODEBASE_* env). Set via
    /// `dev_tools_set_standards_config`. Added 2026-05-31.
    pub standards_config: Option<String>,
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
    /// KPI this goal was derived from / serves (outcome layer, P4).
    pub kpi_id: Option<String>,
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
// Dev Goal Items (lightweight ad-hoc checklist on a goal)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevGoalItem {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub done: bool,
    pub order_index: i32,
    /// Verification-gate kind. `None` = ordinary manual to-do. `Some("browser_test")`
    /// = a UAT gate ticked only by a passing browser test (never manually).
    pub verify_kind: Option<String>,
    /// JSON config for a verification gate (`{scenario, url?}`); `None` for to-dos.
    pub verify_config: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// KPIs (outcome layer above goals — docs/plans/kpi-driven-orchestration.md)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevKpi {
    pub id: String,
    pub project_id: String,
    /// NULL = project-level KPI; otherwise attached to a context group.
    pub context_group_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    /// 'technical' | 'traffic' | 'value' | 'quality'
    pub category: String,
    /// 'codebase' | 'connector' | 'manual' | 'derived'
    pub measure_kind: String,
    /// JSON measurement procedure, shape per measure_kind.
    pub measure_config: String,
    pub unit: String,
    /// 'up' | 'down' — which way is better.
    pub direction: String,
    pub baseline_value: Option<f64>,
    pub target_value: Option<f64>,
    pub target_date: Option<String>,
    pub current_value: Option<f64>,
    pub last_measured_at: Option<String>,
    /// 'manual' | 'daily' | 'weekly'
    pub cadence: String,
    /// 'proposed' | 'active' | 'paused' | 'archived'
    pub status: String,
    /// 'user' | 'scan'
    pub created_by: String,
    pub rationale: Option<String>,
    /// Connector this KPI needs to be measurable — drives the
    /// "Connect <service>" vault-catalog CTA on parked KPIs.
    pub needed_connector: Option<String>,
    /// Semantic measurement capability (P6 type-bound connectors) — e.g.
    /// `unique_visitors`, `llm_tokens`. The tool is a swappable binding.
    pub metric_type: Option<String>,
    /// `north_star` | `primary` | `supporting` — derivation precedence
    /// ("0 users beats 100% coverage").
    pub tier: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevKpiBinding {
    pub id: String,
    pub kpi_id: String,
    pub credential_id: String,
    pub service_type: String,
    /// Frozen retrieval procedure JSON (engine::kpi_binding::Procedure).
    pub procedure: String,
    /// 'recipe' | 'llm'
    pub composed_by: String,
    /// 'active' | 'archived' | 'degraded'
    pub status: String,
    pub verified_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevKpiMeasurement {
    pub id: String,
    pub kpi_id: String,
    pub value: f64,
    pub measured_at: String,
    /// 'evaluator' | 'manual' | 'scan' | 'health_snapshot'
    pub source: String,
    pub evidence: Option<String>,
    pub note: Option<String>,
}

// ============================================================================
// Goal progress suggestion (hybrid auto-suggest, computed on read)
// ============================================================================

/// Result of `resolve_goal_progress` — the goal's stored progress alongside a
/// progress value DERIVED from its composed checklist (ad-hoc items + sub-goals
/// + linked team-assignment steps). The UI surfaces `suggested != current` as an
/// accept/edit nudge; a manual override always wins (we never silently write).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GoalProgressSuggestion {
    pub goal_id: String,
    pub current: i32,
    pub suggested: i32,
    pub done_count: i32,
    pub total_count: i32,
    pub reason: String,
}

// ============================================================================
// Goals v2 — cross-project rollups (Portfolio) + needs-action queue (Attention)
// ============================================================================

/// Per-project health rollup for the Portfolio surface. Counts use the canonical
/// goal-status buckets (see `normalize_goal_status`); `at_risk` = ongoing goals
/// that are overdue or stalled. Computed in one pass over all goals — no N+1.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioProjectSummary {
    pub project_id: String,
    pub project_name: String,
    pub team_id: Option<String>,
    pub total: i32,
    pub open: i32,
    pub in_progress: i32,
    pub blocked: i32,
    pub done: i32,
    /// Ongoing (not done) goals that are overdue or stalled.
    pub at_risk: i32,
    /// Ongoing goals whose target_date is in the past.
    pub overdue: i32,
    /// Mean progress (0-100) across the project's goals (0 when none).
    pub avg_progress: i32,
}

/// The whole portfolio: per-project rollups + a grand total row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSummary {
    pub projects: Vec<PortfolioProjectSummary>,
    pub total_goals: i32,
    pub total_open: i32,
    pub total_in_progress: i32,
    pub total_blocked: i32,
    pub total_done: i32,
    pub total_at_risk: i32,
    pub avg_progress: i32,
}

/// One row in the cross-project Attention queue — a goal (or team step) that
/// needs the user. `kind` ∈ awaiting_review | overdue | stalled | unstaffed.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AttentionItem {
    pub kind: String,
    pub goal_id: String,
    pub goal_title: String,
    pub project_id: String,
    pub project_name: String,
    pub status: String,
    pub progress: i32,
    /// Human-meaningful context: e.g. "8 days overdue", "stalled 11d", step title.
    pub detail: String,
    /// Present for `awaiting_review` rows so the UI can resolve the step inline.
    pub assignment_id: Option<String>,
    pub step_id: Option<String>,
    /// 0 = highest urgency; drives ranking in the queue.
    pub rank: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AttentionQueue {
    pub items: Vec<AttentionItem>,
    pub awaiting_review: i32,
    pub overdue: i32,
    pub stalled: i32,
    pub unstaffed: i32,
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
    /// Strategist triage rank (1 = do next). Set by the backlog-triage job;
    /// promotion prefers ranked ideas. None = unranked.
    pub priority: Option<i32>,
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
// Dev Standards (Pipeline Stage 3 — golden-standard scan findings)
// ============================================================================

/// One per-rule compliance finding from the golden-standard LLM scan
/// (`standards_scan.rs`). The scan adapts the shipped golden ruleset to the
/// repo's character and reports each rule's status to this table.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DevStandard {
    pub id: String,
    pub project_id: String,
    pub scan_id: Option<String>,
    /// Stable rule identifier, e.g. `lint.config`, `docs.readme`, `tests.coverage`, `branching.naming`.
    pub rule_key: String,
    /// `precommit` | `docs` | `code_quality` | `branching` | `testing`.
    pub category: String,
    pub title: String,
    /// `present` | `partial` | `missing`.
    pub status: String,
    /// `info` | `warn` | `critical`.
    pub severity: String,
    pub evidence: Option<String>,
    pub recommendation: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
