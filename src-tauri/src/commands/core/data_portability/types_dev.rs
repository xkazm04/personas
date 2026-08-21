//! Record shapes for the dev-project graph (goals, contexts, ideas,
//! tasks, competitions, pipelines, milestones, KPIs, memory, skills).
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

// ============================================================================
// Dev-tools export types (export side; import lands in a follow-up)
//
// A dev project travels as its row plus the full planning graph (goals,
// contexts, ideas, tasks, use cases, milestones, KPIs, memories) and the
// on-disk `.claude/skills/` library. Rows mirror their tables with original
// uuids and timestamps so a future import can rebuild relationships; the
// only stripped cells are credential ids (unresolvable soft refs into the
// source vault). Telemetry / scan-cache tables (dev_llm_spend, dev_auto_runs,
// dev_run_checkpoints, skill_registry / skill_usage_events,
// dev_context_file_hashes, context_health_snapshots, dev_scans,
// workspace_harvest_coverage) intentionally do NOT travel.
// ============================================================================

/// A dev project in the portability bundle. The four credential-id columns
/// (`monitoring_credential_id`, `llm_tracking_credential_id`,
/// `support_credential_id`, `pr_credential_id`) are intentionally NOT
/// exported — they point into the source workspace's vault.
#[derive(Debug, Serialize, Deserialize)]
pub struct DevProjectExport {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub description: Option<String>,
    pub status: String,
    pub tech_stack: Option<String>,
    /// Soft ref into the bundle's teams — orphan-tolerant by design. The
    /// import side remaps it via id_mapping when the team travels in the
    /// same bundle, else keeps it as-is.
    pub team_id: Option<String>,
    pub auto_pr_on_success: bool,
    pub github_url: Option<String>,
    pub main_branch: Option<String>,
    pub test_env_url: Option<String>,
    pub test_env_branch: Option<String>,
    pub workspace_id: Option<String>,
    pub data_links: Option<String>,
    pub static_scan_config: Option<String>,
    pub standards_config: Option<String>,
    pub monitoring_project_slug: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub goals: Vec<DevGoalExport>,
    pub goal_dependencies: Vec<DevGoalDependencyExport>,
    pub goal_signals: Vec<DevGoalSignalExport>,
    pub goal_items: Vec<DevGoalItemExport>,
    pub context_groups: Vec<DevContextGroupExport>,
    pub contexts: Vec<DevContextExport>,
    pub context_group_relationships: Vec<DevContextGroupRelationshipExport>,
    pub context_fingerprints: Vec<DevContextFingerprintExport>,
    pub ideas: Vec<DevIdeaExport>,
    pub tasks: Vec<DevTaskExport>,
    pub competitions: Vec<DevCompetitionExport>,
    pub competition_slots: Vec<DevCompetitionSlotExport>,
    pub triage_rules: Vec<DevTriageRuleExport>,
    pub pipelines: Vec<DevPipelineExport>,
    pub standards: Vec<DevStandardExport>,
    pub use_cases: Vec<DevUseCaseExport>,
    pub use_case_contexts: Vec<DevUseCaseContextExport>,
    pub milestones: Vec<DevMilestoneExport>,
    pub milestone_items: Vec<DevMilestoneItemExport>,
    pub kpis: Vec<DevKpiExport>,
    pub kpi_measurements: Vec<DevKpiMeasurementExport>,
    pub kpi_bindings: Vec<DevKpiBindingExport>,
    pub memories: Vec<DevMemoryExport>,
    pub memory_nodes: Vec<MemoryNodeExport>,
    pub memory_edges: Vec<MemoryEdgeExport>,
    pub skills: Vec<SkillFileExport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevGoalExport {
    pub id: String,
    pub parent_goal_id: Option<String>,
    pub context_id: Option<String>,
    pub kpi_id: Option<String>,
    pub order_index: i32,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub progress: Option<i32>,
    pub target_date: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevGoalDependencyExport {
    pub id: String,
    pub goal_id: String,
    pub depends_on_id: String,
    pub dependency_type: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevGoalSignalExport {
    pub id: String,
    pub goal_id: String,
    pub signal_type: String,
    pub source_id: Option<String>,
    pub delta: Option<i32>,
    pub message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevGoalItemExport {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub done: bool,
    pub order_index: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevContextGroupExport {
    pub id: String,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct DevContextExport {
    pub id: String,
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
    pub category: Option<String>,
    pub business_feature: Option<String>,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevContextGroupRelationshipExport {
    pub id: String,
    pub source_group_id: String,
    pub target_group_id: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevContextFingerprintExport {
    pub context_id: String,
    pub content_hash: String,
    pub file_count: i32,
    pub missing_file_count: i32,
    pub imports: Option<String>,
    pub primitives: Option<String>,
    pub promise_all_count: i32,
    pub join_all_count: i32,
    pub await_count: i32,
    pub sql_write_count: i32,
    pub spawn_count: i32,
    pub use_effect_count: i32,
    pub set_state_after_await_count: i32,
    pub exports_components: i32,
    pub exports_hooks: i32,
    pub exports_commands: i32,
    pub exports_repo_fns: i32,
    pub computed_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevIdeaExport {
    pub id: String,
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
    pub priority: Option<i32>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub rejection_reason: Option<String>,
    pub origin: Option<String>,
    pub use_case_id: Option<String>,
    pub evidence: Option<String>,
    pub dedup_key: Option<String>,
    pub verify_state: Option<String>,
    pub verify_checked_at: Option<String>,
    pub verify_evidence: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevTaskExport {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub source_idea_id: Option<String>,
    pub goal_id: Option<String>,
    pub status: String,
    pub session_id: Option<String>,
    pub progress_pct: Option<i32>,
    pub output_lines: Option<i32>,
    pub error: Option<String>,
    pub depth: String,
    pub parent_task_id: Option<String>,
    pub attempt: i32,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevCompetitionExport {
    pub id: String,
    pub task_title: String,
    pub task_description: Option<String>,
    pub source_idea_id: Option<String>,
    pub source_goal_id: Option<String>,
    pub slot_count: i32,
    pub status: String,
    pub winner_task_id: Option<String>,
    pub winner_insight: Option<String>,
    pub baseline_json: Option<String>,
    pub reviewer_notes: Option<String>,
    pub worktree_base_ref: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevCompetitionSlotExport {
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

#[derive(Debug, Serialize, Deserialize)]
pub struct DevTriageRuleExport {
    pub id: String,
    pub name: String,
    pub conditions: String,
    pub action: String,
    pub enabled: Option<bool>,
    pub times_fired: Option<i32>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevPipelineExport {
    pub id: String,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct DevStandardExport {
    pub id: String,
    pub scan_id: Option<String>,
    pub rule_key: String,
    pub category: String,
    pub title: String,
    pub status: String,
    pub severity: String,
    pub evidence: Option<String>,
    pub recommendation: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevUseCaseExport {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub kind: String,
    pub primary_context_id: Option<String>,
    pub status: String,
    pub created_by: String,
    pub pinned: bool,
    pub rationale: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevUseCaseContextExport {
    pub use_case_id: String,
    pub context_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevMilestoneExport {
    pub id: String,
    pub name: String,
    pub goal: Option<String>,
    pub status: String,
    pub order_index: i32,
    pub target_date: Option<String>,
    pub cut_at: Option<String>,
    pub shipped_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevMilestoneItemExport {
    pub milestone_id: String,
    pub item_kind: String,
    pub item_id: String,
    pub bucket: String,
    pub added_after_cut: bool,
    pub order_index: i32,
    pub created_at: String,
    /// Why the member sits in its bucket. `default` so bundles written before
    /// the column existed still import.
    #[serde(default)]
    pub description: Option<String>,
    /// Operator rating 1..5; NULL = unrated.
    #[serde(default)]
    pub rating: Option<i32>,
}

/// Full-fidelity KPI row for a bundled dev project. Unlike the team-scoped
/// [`KpiExport`] (which re-derives a clean dormant KPI), this mirrors the
/// table so the project graph round-trips intact.
#[derive(Debug, Serialize, Deserialize)]
pub struct DevKpiExport {
    pub id: String,
    pub context_group_id: Option<String>,
    pub context_id: Option<String>,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub measure_kind: String,
    pub measure_config: String,
    pub unit: String,
    pub direction: String,
    pub baseline_value: Option<f64>,
    pub target_value: Option<f64>,
    pub target_date: Option<String>,
    pub current_value: Option<f64>,
    pub last_measured_at: Option<String>,
    pub cadence: String,
    pub status: String,
    pub created_by: String,
    pub rationale: Option<String>,
    pub needed_connector: Option<String>,
    pub metric_type: Option<String>,
    pub tier: String,
    pub warn_at: Option<f64>,
    pub crit_at: Option<f64>,
    pub manual_rating: Option<i32>,
    pub assessment_pros: Option<String>,
    pub assessment_cons: Option<String>,
    pub last_skip_at: Option<String>,
    pub last_skip_rationale: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevKpiMeasurementExport {
    pub id: String,
    pub kpi_id: String,
    pub value: f64,
    pub measured_at: String,
    pub source: String,
    pub env: String,
    pub evidence: Option<String>,
    pub note: Option<String>,
}

/// KPI measurement binding minus `credential_id` — the binding's procedure
/// and service type travel, but the vault reference cannot resolve in the
/// destination workspace.
#[derive(Debug, Serialize, Deserialize)]
pub struct DevKpiBindingExport {
    pub id: String,
    pub kpi_id: String,
    pub service_type: String,
    pub procedure: String,
    pub composed_by: String,
    pub status: String,
    pub verified_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevMemoryExport {
    pub id: String,
    pub category: String,
    pub title: String,
    pub content: String,
    pub importance: i32,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryNodeExport {
    pub id: String,
    pub context_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
    pub source: String,
    pub status: String,
    pub content_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryEdgeExport {
    pub from_id: String,
    pub to_id: String,
    pub rel: String,
    pub created_at: String,
}

/// One file inside an exported skill, relative to the skill's directory
/// (forward-slash separators). UTF-8 text only.
#[derive(Debug, Serialize, Deserialize)]
pub struct SkillFileEntry {
    pub rel_path: String,
    pub content: String,
}

/// A skill read from `<root_path>/.claude/skills/` — either a directory
/// containing `SKILL.md` (+ optional reference files) or a single
/// `<name>.md`. Non-UTF-8 files, files over [`MAX_SKILL_FILE_BYTES`], and
/// the provenance sidecar are skipped. `content_hash` is a sha256 over the
/// sorted (rel_path, content) pairs so the import side can detect drift.
#[derive(Debug, Serialize, Deserialize)]
pub struct SkillFileExport {
    pub name: String,
    pub files: Vec<SkillFileEntry>,
    pub content_hash: String,
}
