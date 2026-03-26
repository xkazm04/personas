use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
    pub severity: String, // "low" | "medium" | "high" | "critical"
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
