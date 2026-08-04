use std::collections::HashMap;
use std::io::{Read as IoRead, Write as IoWrite};
use std::sync::Arc;

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use crate::db::credential_fields::classify_field_type;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::dev_tools as dev_tools_repo;
use crate::engine::persona_icon::export_safe_icon;
use crate::db::repos::core::{
    memories as memory_repo, personas as persona_repo,
};
use crate::db::repos::execution::test_suites as suite_repo;
use crate::db::repos::resources::{
    audit_log, connectors as connector_repo, credentials as cred_repo,
    team_memories as team_memory_repo, teams as team_repo, tools as tool_repo,
    triggers as trigger_repo,
};
use crate::db::DbPool;
use crate::engine::crypto;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync, require_privileged};
use crate::validation;
use crate::AppState;
use personas_macros::requires;

use super::export_types::{
    MemoryExport, SubscriptionExport, TriggerExport, MAX_CONFIG_LEN, MAX_DESCRIPTION_LEN,
    MAX_DESIGN_CONTEXT_LEN, MAX_MEMORIES, MAX_MEMORY_CONTENT_LEN, MAX_NAME_LEN,
    MAX_SHORT_FIELD_LEN, MAX_STRUCTURED_PROMPT_LEN, MAX_SUBSCRIPTIONS, MAX_SYSTEM_PROMPT_LEN,
    MAX_TRIGGERS,
};

// Additional constants specific to data_portability (not shared with import_export)
const MAX_CANVAS_DATA_LEN: usize = 500_000;
const MAX_SCHEMA_LEN: usize = 100_000;
const MAX_SCENARIOS_LEN: usize = 500_000;

/// Hard ceiling on the size of a `.enc` credential bundle accepted by
/// `import_credentials`. Mirrors the persona-import guard in
/// `import_export::MAX_IMPORT_FILE_BYTES` but tightened: a credential
/// bundle is JSON envelope + base64-encoded ciphertext, and even a
/// vault with hundreds of secrets stays well under 1 MB. Anything
/// larger is either corruption, accidental file selection (logs, DB
/// dump), or a hostile blob aimed at OOMing the read_to_string path
/// before AES decryption runs.
const MAX_CREDENTIAL_IMPORT_BYTES: u64 = 2 * 1024 * 1024;

// Array size caps specific to data_portability
const MAX_PERSONAS: usize = 200;
const MAX_TOOLS: usize = 500;
const MAX_TEAMS: usize = 50;
const MAX_CREDENTIALS: usize = 500;
const MAX_TRIGGERS_PER_PERSONA: usize = MAX_TRIGGERS;
const MAX_SUBSCRIPTIONS_PER_PERSONA: usize = MAX_SUBSCRIPTIONS;
const MAX_MEMORIES_PER_PERSONA: usize = MAX_MEMORIES;
const MAX_TEST_SUITES_PER_PERSONA: usize = 100;
const MAX_TEAM_MEMBERS: usize = 50;
const MAX_TEAM_CONNECTIONS: usize = 200;
const MAX_TEAM_MEMORIES_PER_TEAM: usize = 500;
const MAX_KPIS: usize = 200;
const MAX_KPI_MEASUREMENTS: usize = 100;
const MAX_DEV_PROJECTS: usize = 25;
const MAX_KNOWLEDGE_ENTRIES: usize = 2000;

/// Hard ceiling on a single exported skill file. Skills are markdown +
/// small reference files; anything bigger is a binary asset or generated
/// artifact that has no business travelling in a portability bundle.
const MAX_SKILL_FILE_BYTES: u64 = 256 * 1024;

/// Provenance sidecar written by skill installs — local sync bookkeeping,
/// never exported. Mirrors `PROVENANCE_FILE` in
/// `commands::infrastructure::skill_files` (private there).
const SKILL_PROVENANCE_FILE: &str = ".personas-skill-meta.json";

// ============================================================================
// Export bundle types
// ============================================================================

/// Top-level archive manifest (version 2/3 = full portability format).
/// Version 3 adds optional `encrypted_credentials` for unified export.
#[derive(Debug, Serialize, Deserialize)]
pub struct PortabilityBundle {
    pub format_version: u32,
    pub exported_at: String,
    pub app_version: String,
    pub scope: ExportScope,
    pub personas: Vec<PersonaExport>,
    pub tool_definitions: Vec<ToolDefinitionExport>,
    pub teams: Vec<TeamExport>,
    pub credentials: Vec<CredentialMetaExport>,
    // The KPI setup that travels with the selected teams (their projects' KPIs).
    // Optional + serde-default so bundles written before this field existed still
    // deserialize cleanly — no format-version bump (same precedent as team memories).
    #[serde(default)]
    pub kpis: Vec<KpiExport>,
    // Dev-tools projects (full planning/child graph + on-disk skills) and
    // workspace knowledge libraries. Optional + serde-default so bundles
    // written before these fields existed still deserialize cleanly — no
    // format-version bump (same additive precedent as `kpis`).
    #[serde(default)]
    pub dev_projects: Vec<DevProjectExport>,
    #[serde(default)]
    pub workspace_knowledge: Vec<WorkspaceKnowledgeExport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_credentials: Option<CredentialExportEnvelope>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ExportScope {
    Full,
    Selective {
        persona_ids: Vec<String>,
        team_ids: Vec<String>,
        #[serde(default)]
        credential_ids: Vec<String>,
        #[serde(default)]
        project_ids: Vec<String>,
        #[serde(default)]
        workspace_ids: Vec<String>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PersonaExport {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub structured_prompt: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub max_concurrent: i32,
    pub timeout_ms: i32,
    pub notification_channels: Option<String>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub design_context: Option<String>,
    pub triggers: Vec<TriggerExport>,
    pub subscriptions: Vec<SubscriptionExport>,
    pub memories: Vec<MemoryExport>,
    pub tool_ids: Vec<String>,
    pub test_suites: Vec<TestSuiteExport>,
}

// TriggerExport, SubscriptionExport, MemoryExport imported from super::export_types

#[derive(Debug, Serialize, Deserialize)]
pub struct TestSuiteExport {
    pub name: String,
    pub description: Option<String>,
    pub scenarios: String,
    pub scenario_count: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolDefinitionExport {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub input_schema: Option<String>,
    pub requires_credential_type: Option<String>,
    pub implementation_guide: Option<String>,
    pub is_builtin: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TeamExport {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub canvas_data: Option<String>,
    pub team_config: Option<String>,
    pub icon: Option<String>,
    pub members: Vec<TeamMemberExport>,
    pub connections: Vec<TeamConnectionExport>,
    // Team-scoped memories (sub_teamMemory feature). Optional + serde-default so
    // bundles written before this field existed still deserialize cleanly — no
    // format-version bump needed. Stripped to an empty vec when the user opts out
    // of memories at export time.
    #[serde(default)]
    pub memories: Vec<TeamMemoryExport>,
}

/// A team memory in the portability bundle. Mirrors the durable content fields
/// of `MemoryExport` (the persona equivalent). Run-specific provenance
/// (`run_id` / `member_id` / `persona_id`) is intentionally NOT exported: it
/// references rows that don't travel with the bundle, so it is nulled on import
/// and the memory lands as a manually-curated entry.
#[derive(Debug, Serialize, Deserialize)]
pub struct TeamMemoryExport {
    pub title: String,
    pub content: String,
    pub category: String,
    pub importance: i32,
    pub tags: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TeamMemberExport {
    pub persona_id: String,
    pub role: Option<String>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub config: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TeamConnectionExport {
    pub source_persona_id: String,
    pub target_persona_id: String,
    pub connection_type: Option<String>,
    pub condition: Option<String>,
    pub label: Option<String>,
}

/// Non-secret credential metadata for workspace export.
/// Secrets are NOT included — use the separate Credential Vault export for that.
#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialMetaExport {
    pub name: String,
    pub service_type: String,
    pub metadata: Option<String>,
}

/// A KPI definition in the portability bundle. KPIs are the outcome layer above
/// goals (Teams › KPIs); they are project-scoped in the source workspace and
/// "ride along" with their team. On import they land in a dedicated, dormant
/// "Imported" project (see `import_bundle`). Live-state columns that don't carry
/// cleanly across workspaces (assessment, skip-verdict, bindings, created_by/at)
/// are intentionally NOT exported — the import re-derives a clean dormant KPI.
#[derive(Debug, Serialize, Deserialize)]
pub struct KpiExport {
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
    pub cadence: String,
    /// The KPI's status in the source workspace (informational — imported KPIs
    /// are always created `paused`, since their measure config is tied to the
    /// source environment and must be reviewed before measuring).
    pub status: String,
    pub tier: String,
    pub rationale: Option<String>,
    pub needed_connector: Option<String>,
    pub metric_type: Option<String>,
    pub warn_at: Option<f64>,
    pub crit_at: Option<f64>,
    /// Measurement time series (newest-first, capped). Empty when the user
    /// exported definitions only.
    #[serde(default)]
    pub measurements: Vec<KpiMeasurementExport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KpiMeasurementExport {
    pub value: f64,
    pub measured_at: String,
    pub source: String,
    pub evidence: Option<String>,
    pub note: Option<String>,
}

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

/// A workspace and its shared knowledge library. Knowledge travels in ALL
/// statuses (the lifecycle is the data); adoption cells are filtered to the
/// projects actually bundled so the slice stays resolvable on import.
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceKnowledgeExport {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub description: Option<String>,
    pub knowledge: Vec<WorkspaceKnowledgeEntryExport>,
    pub adoption: Vec<WorkspaceAdoptionExport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceKnowledgeEntryExport {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub statement: String,
    pub detail_md: Option<String>,
    pub topic: Option<String>,
    pub abstraction: Option<String>,
    pub ftype: Option<String>,
    pub durability: Option<String>,
    pub governing_id: Option<String>,
    pub evidence_count: Option<i32>,
    pub applicability: Option<String>,
    pub status: String,
    pub origin_project_id: Option<String>,
    pub provenance: Option<String>,
    pub confidence: Option<f64>,
    pub dedup_key: Option<String>,
    pub superseded_by: Option<String>,
    pub harvest_scope: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub decided_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceAdoptionExport {
    pub practice_id: String,
    pub project_id: String,
    pub state: String,
    pub note: Option<String>,
    pub last_verified_at: Option<String>,
}

// ============================================================================
// Import result types
// ============================================================================

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PortabilityImportResult {
    pub personas_created: u32,
    pub teams_created: u32,
    pub tools_created: u32,
    pub credentials_created: u32,
    pub team_memories_created: u32,
    pub kpis_created: u32,
    // Dev-tools project + workspace-knowledge counters (WP2). Serde defaults
    // keep older serialized results (and older frontends) deserializing.
    #[serde(default)]
    pub projects_imported: u32,
    #[serde(default)]
    pub projects_skipped: u32,
    #[serde(default)]
    pub knowledge_imported: u32,
    #[serde(default)]
    pub knowledge_skipped_duplicates: u32,
    #[serde(default)]
    pub skills_written: u32,
    #[serde(default)]
    pub skills_deferred: u32,
    /// Non-empty when project conflicts were detected on pass 1 — the frontend
    /// shows a resolution UI and re-invokes with `project_resolutions_json`.
    #[serde(default)]
    pub project_conflicts: Vec<ProjectConflict>,
    /// Path of the selected bundle file — returned alongside conflicts so the
    /// frontend can pass it back for the resolution pass (mirrors
    /// `CredentialImportResult::file_path`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_file_path: Option<String>,
    pub warnings: Vec<String>,
    pub id_mapping: std::collections::HashMap<String, String>,
}

/// A bundled dev project that collides with a project already in this
/// workspace. Matched primarily by `root_path` (UNIQUE in `dev_projects`),
/// falling back to a case-insensitive name match. The caller resolves each
/// conflict with `"replace" | "skip" | "duplicate"` keyed by
/// `bundle_project_id`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConflict {
    pub bundle_project_id: String,
    pub name: String,
    pub root_path: String,
    pub existing_project_id: String,
    /// `"root_path"` or `"name"`.
    pub matched_by: String,
}

// ============================================================================
// Export stats (for UI preview)
// ============================================================================

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ExportStats {
    pub persona_count: u32,
    pub tool_count: u32,
    pub team_count: u32,
    pub credential_count: u32,
    pub memory_count: u32,
    pub team_memory_count: u32,
    pub test_suite_count: u32,
    pub kpi_count: u32,
    pub dev_project_count: u32,
    pub workspace_knowledge_count: u32,
}

// ============================================================================
// Commands
// ============================================================================

/// Get export statistics for the entire workspace (for UI preview).
#[tauri::command]
pub async fn get_export_stats(state: State<'_, Arc<AppState>>) -> Result<ExportStats, AppError> {
    require_auth_sync(&state)?;
    compute_export_stats(&state.db)
}

/// Pool-level body of [`get_export_stats`] — split out so unit tests can
/// exercise the counters without constructing a Tauri `State`.
fn compute_export_stats(pool: &DbPool) -> Result<ExportStats, AppError> {
    let personas = persona_repo::get_all(pool)?;
    let tools = tool_repo::get_all_definitions(pool)?;
    let teams = team_repo::get_all(pool)?;
    let credentials = cred_repo::get_all(pool)?;

    // Scalar COUNTs for the preview numbers. The previous per-persona loops
    // ran 2 queries per persona (200+ sequential queries on a big workspace)
    // and list_by_persona hydrated full test_suites rows — including the
    // up-to-500KB scenarios blob — just to .len() them. The stats are
    // workspace-wide, so plain aggregates are both correct and O(1) queries.
    let conn = pool.get()?;
    let scalar_count = |sql: &str| -> Result<u32, AppError> {
        Ok(conn
            .query_row(sql, [], |r| r.get::<_, i64>(0))
            .map_err(crate::error::AppError::Database)? as u32)
    };
    let memory_count = scalar_count("SELECT COUNT(*) FROM persona_memories")?;
    let test_suite_count = scalar_count("SELECT COUNT(*) FROM test_suites")?;
    let team_memory_count = scalar_count("SELECT COUNT(*) FROM team_memories")?;
    // KPIs that are part of a live "setup" — active or paused (proposed = review
    // queue, archived = retired; neither travels). Matches the export filter
    // (is_exportable_kpi).
    let kpi_count =
        scalar_count("SELECT COUNT(*) FROM dev_kpis WHERE status IN ('active', 'paused')")
            .unwrap_or(0);
    // Dev-tools tables arrive via incremental migrations — tolerate their
    // absence on very old databases the same way kpi_count does.
    let dev_project_count = scalar_count("SELECT COUNT(*) FROM dev_projects").unwrap_or(0);
    let workspace_knowledge_count =
        scalar_count("SELECT COUNT(*) FROM workspace_knowledge").unwrap_or(0);

    Ok(ExportStats {
        persona_count: personas.len() as u32,
        tool_count: tools.len() as u32,
        team_count: teams.len() as u32,
        credential_count: credentials.len() as u32,
        memory_count,
        team_memory_count,
        test_suite_count,
        kpi_count,
        dev_project_count,
        workspace_knowledge_count,
    })
}

/// A KPI is part of an exportable "setup" when it is actively measured or
/// paused — not a `proposed` review-queue suggestion or an `archived` retiree.
fn is_exportable_kpi(status: &str) -> bool {
    status == "active" || status == "paused"
}

/// Full export: export everything into a compressed JSON archive via save dialog.
/// When `passphrase` is provided (>= 8 chars), credential secrets are encrypted
/// and embedded in the bundle.
#[tauri::command]
#[requires(privileged)]
pub async fn export_full(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    include_memories: Option<bool>,
    passphrase: Option<String>,
) -> Result<bool, AppError> {
    let pool = &state.db;
    // Full export carries the entire workspace, KPI setup included.
    let mut bundle =
        build_export_bundle(pool, ExportScope::Full, include_memories.unwrap_or(true), true)?;

    if let Some(ref pp) = passphrase {
        if pp.len() >= 8 {
            let envelope = build_encrypted_credentials(pool, pp, None)?;
            bundle.encrypted_credentials = Some(envelope);
            bundle.format_version = 3;
        }
    }

    save_bundle_to_file(&app, &bundle, "personas_full_export").await
}

/// Selective export: export only specified personas and teams.
/// When `passphrase` is provided (>= 8 chars), credential secrets for the
/// selected `credential_ids` are encrypted and embedded in the bundle.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_selective(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    persona_ids: Vec<String>,
    team_ids: Vec<String>,
    credential_ids: Vec<String>,
    project_ids: Vec<String>,
    workspace_ids: Vec<String>,
    include_memories: Option<bool>,
    include_kpis: Option<bool>,
    passphrase: Option<String>,
) -> Result<bool, AppError> {
    // When passphrase is provided (credential secrets involved), upgrade to privileged
    if passphrase.as_ref().is_some_and(|pp| pp.len() >= 8) {
        require_privileged(&state, "export_selective").await?;
    } else {
        require_auth(&state).await?;
    }

    let pool = &state.db;
    let scope = ExportScope::Selective {
        persona_ids: persona_ids.clone(),
        team_ids: team_ids.clone(),
        credential_ids: credential_ids.clone(),
        project_ids: project_ids.clone(),
        workspace_ids: workspace_ids.clone(),
    };
    let mut bundle = build_export_bundle(
        pool,
        scope,
        include_memories.unwrap_or(true),
        include_kpis.unwrap_or(true),
    )?;

    if let Some(ref pp) = passphrase {
        if pp.len() >= 8 {
            let filter_ids = if credential_ids.is_empty() {
                None
            } else {
                Some(&credential_ids)
            };
            let envelope = build_encrypted_credentials(pool, pp, filter_ids)?;
            bundle.encrypted_credentials = Some(envelope);
            bundle.format_version = 3;
        }
    }

    save_bundle_to_file(&app, &bundle, "personas_selective_export").await
}

/// Import a previously exported portability bundle.
/// When `passphrase` is provided and the bundle contains `encrypted_credentials`,
/// credential secrets are decrypted and written to the imported credential shells.
///
/// Two-pass project conflict flow (mirrors `import_credentials`):
/// - Pass 1 (no `project_resolutions_json`): all non-project sections import
///   immediately; conflicting dev projects are returned in
///   `project_conflicts` together with `bundle_file_path`.
/// - Pass 2: the caller re-invokes with `project_resolutions_json` (a JSON map
///   of bundle project id → `"replace" | "skip" | "duplicate"`) and
///   `file_path_override` set to the returned `bundle_file_path`; only the
///   resolved projects are processed.
#[tauri::command]
#[requires(privileged)]
pub async fn import_portability_bundle(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: Option<String>,
    project_resolutions_json: Option<String>,
    file_path_override: Option<String>,
) -> Result<Option<PortabilityImportResult>, AppError> {
    let path = if let Some(override_path) = file_path_override {
        std::path::PathBuf::from(override_path)
    } else {
        let app_clone = app.clone();
        let file_path = tokio::task::spawn_blocking(move || {
            app_clone
                .dialog()
                .file()
                .add_filter("Personas Export", &["zip", "json"])
                .blocking_pick_file()
        })
        .await
        .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

        let Some(file_path) = file_path else {
            return Ok(None);
        };

        file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?
    };

    let result = run_bundle_import(
        &state.db,
        &path,
        passphrase.as_deref(),
        project_resolutions_json.as_deref(),
    )?;
    Ok(Some(result))
}

/// Parse a competitive workflow file (n8n, Zapier, Make) and return a preview
/// of what would be imported as persona agents.
#[tauri::command]
pub async fn preview_competitive_import(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<Option<Vec<CompetitiveImportPreview>>, AppError> {
    require_auth(&state).await?;
    let _ = &state.db; // validate state

    let app_clone = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .add_filter("Workflow Files", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?;

    let previews = parse_competitive_workflow(&content)?;
    Ok(Some(previews))
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CompetitiveImportPreview {
    pub source_platform: String,
    pub workflow_name: String,
    pub description: String,
    pub suggested_tools: Vec<String>,
    pub suggested_triggers: Vec<String>,
}

// ============================================================================
// Debug-only commands for smoke testing
//
// The production export/import commands open native file dialogs, which makes
// IPC-only round-trip testing impossible. These variants accept an explicit
// `file_path` and bypass the dialog so e2e_portability.py can drive a real
// export → import round-trip via window.__TAURI__.invoke. Compiled out of
// release builds.
// ============================================================================

#[cfg(debug_assertions)]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_selective_to_path(
    state: State<'_, Arc<AppState>>,
    persona_ids: Vec<String>,
    team_ids: Vec<String>,
    credential_ids: Vec<String>,
    project_ids: Vec<String>,
    workspace_ids: Vec<String>,
    include_memories: Option<bool>,
    include_kpis: Option<bool>,
    passphrase: Option<String>,
    file_path: String,
) -> Result<bool, AppError> {
    if passphrase.as_ref().is_some_and(|pp| pp.len() >= 8) {
        require_privileged(&state, "export_selective_to_path").await?;
    } else {
        require_auth(&state).await?;
    }

    let pool = &state.db;
    let scope = ExportScope::Selective {
        persona_ids: persona_ids.clone(),
        team_ids: team_ids.clone(),
        credential_ids: credential_ids.clone(),
        project_ids: project_ids.clone(),
        workspace_ids: workspace_ids.clone(),
    };
    let mut bundle = build_export_bundle(
        pool,
        scope,
        include_memories.unwrap_or(true),
        include_kpis.unwrap_or(true),
    )?;

    if let Some(ref pp) = passphrase {
        if pp.len() >= 8 {
            let filter_ids = if credential_ids.is_empty() {
                None
            } else {
                Some(&credential_ids)
            };
            let envelope = build_encrypted_credentials(pool, pp, filter_ids)?;
            bundle.encrypted_credentials = Some(envelope);
            bundle.format_version = 3;
        }
    }

    let json =
        serde_json::to_string_pretty(&bundle).map_err(|e| AppError::Internal(e.to_string()))?;
    let zip_bytes = create_zip_bundle(&json)?;
    tokio::fs::write(&file_path, zip_bytes)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;

    Ok(true)
}

#[cfg(debug_assertions)]
#[tauri::command]
#[requires(privileged)]
pub async fn import_portability_bundle_from_path(
    state: State<'_, Arc<AppState>>,
    passphrase: Option<String>,
    file_path: String,
    project_resolutions_json: Option<String>,
) -> Result<Option<PortabilityImportResult>, AppError> {
    let path = std::path::PathBuf::from(&file_path);
    let result = run_bundle_import(
        &state.db,
        &path,
        passphrase.as_deref(),
        project_resolutions_json.as_deref(),
    )?;
    Ok(Some(result))
}

/// Shared body of [`import_portability_bundle`] and its debug from-path twin:
/// read + parse + version-gate + validate the bundle at `path`, run the DB
/// import (with optional project conflict resolutions), then apply embedded
/// encrypted credentials. Keeping the two commands on one code path is what
/// keeps them in lockstep.
fn run_bundle_import(
    pool: &DbPool,
    path: &std::path::Path,
    passphrase: Option<&str>,
    project_resolutions_json: Option<&str>,
) -> Result<PortabilityImportResult, AppError> {
    let content = if path.extension().is_some_and(|ext| ext == "zip") {
        read_zip_bundle(path)?
    } else {
        std::fs::read_to_string(path)
            .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?
    };

    let bundle: PortabilityBundle = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Invalid export file: {e}")))?;

    if bundle.format_version != 2 && bundle.format_version != 3 {
        return Err(AppError::Validation(format!(
            "Unsupported format version: {} (expected 2 or 3)",
            bundle.format_version
        )));
    }

    validate_bundle(&bundle)?;

    let resolutions: HashMap<String, String> = project_resolutions_json
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let is_resolution_pass = !resolutions.is_empty();

    let mut result = import_bundle(pool, &bundle, &resolutions)?;

    // Returned conflicts need the file path back so the frontend can re-invoke
    // the resolution pass against the same bundle without a second dialog.
    if !result.project_conflicts.is_empty() {
        result.bundle_file_path = Some(path.to_string_lossy().to_string());
    }

    // Encrypted credentials apply on the first pass only — the resolution pass
    // re-reads the same bundle, and the shells were already populated.
    if !is_resolution_pass {
        if let (Some(envelope), Some(pp)) = (&bundle.encrypted_credentials, passphrase) {
            if !pp.is_empty() {
                match apply_encrypted_credentials(pool, envelope, pp, &bundle.credentials) {
                    Ok((count, unmatched)) => {
                        if count > 0 {
                            result.warnings.push(format!(
                                "{} credential secret(s) decrypted and applied",
                                count
                            ));
                        }
                        if !unmatched.is_empty() {
                            result.warnings.push(format!(
                                "{} credential secret(s) had no matching imported shell and were not applied: {}",
                                unmatched.len(),
                                unmatched.join(", ")
                            ));
                        }
                    }
                    Err(e) => {
                        result.warnings.push(format!(
                            "Failed to decrypt embedded credentials: {}. Credential shells were still imported without secrets.",
                            e
                        ));
                    }
                }
            }
        }
    }

    Ok(result)
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Reduce a team memory's `tags` column to a portable value. The team-memory
/// editor stores tags as a `{ "source": ..., "revisions": [...] }` object where
/// `revisions` is the local edit history (up to 20 prior full versions). That
/// blob is large, unbounded-ish, and meaningless in another workspace — so we
/// keep only the durable `source` marker and drop the revision history. Plain
/// (non-object) tags pass through unchanged.
fn portable_team_memory_tags(tags: &Option<String>) -> Option<String> {
    let raw = tags.as_deref()?;
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
        if val.get("revisions").is_some() {
            return match val.get("source").and_then(|v| v.as_str()) {
                Some(s) if !s.is_empty() => Some(s.to_string()),
                _ => None,
            };
        }
    }
    Some(raw.to_string())
}

fn build_export_bundle(
    pool: &DbPool,
    scope: ExportScope,
    include_memories: bool,
    include_kpis: bool,
) -> Result<PortabilityBundle, AppError> {
    let all_personas = persona_repo::get_all(pool)?;
    let all_tools = tool_repo::get_all_definitions(pool)?;
    let all_teams = team_repo::get_all(pool)?;
    let all_credentials = cred_repo::get_all(pool)?;

    let (selected_persona_ids, selected_team_ids) = match &scope {
        ExportScope::Full => (
            all_personas
                .iter()
                .map(|p| p.id.clone())
                .collect::<Vec<_>>(),
            all_teams.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
        ),
        ExportScope::Selective {
            persona_ids,
            team_ids,
            ..
        } => (persona_ids.clone(), team_ids.clone()),
    };

    // Batch-fetch all per-persona data in 5 queries instead of 5*N
    let all_triggers = trigger_repo::get_by_persona_ids(pool, &selected_persona_ids)?;
    let all_subscriptions =
        event_repo::get_subscriptions_by_persona_ids(pool, &selected_persona_ids)?;
    let all_memories = memory_repo::get_all_by_persona_ids(pool, &selected_persona_ids)?;
    let all_persona_tools = tool_repo::get_tools_for_personas(pool, &selected_persona_ids)?;
    let all_test_suites = suite_repo::list_by_persona_ids(pool, &selected_persona_ids)?;

    // Group by persona_id into HashMaps
    let mut triggers_map: HashMap<String, Vec<_>> = HashMap::new();
    for t in all_triggers {
        triggers_map
            .entry(t.persona_id.clone())
            .or_default()
            .push(t);
    }
    let mut subscriptions_map: HashMap<String, Vec<_>> = HashMap::new();
    for s in all_subscriptions {
        subscriptions_map
            .entry(s.persona_id.clone())
            .or_default()
            .push(s);
    }
    let mut memories_map: HashMap<String, Vec<_>> = HashMap::new();
    for m in all_memories {
        memories_map
            .entry(m.persona_id.clone())
            .or_default()
            .push(m);
    }
    let mut tools_map: HashMap<String, Vec<_>> = HashMap::new();
    for (pid, def) in all_persona_tools {
        tools_map.entry(pid).or_default().push(def);
    }
    let mut suites_map: HashMap<String, Vec<_>> = HashMap::new();
    for s in all_test_suites {
        suites_map.entry(s.persona_id.clone()).or_default().push(s);
    }

    // Build persona exports
    let mut persona_exports = Vec::new();
    for p in &all_personas {
        if !selected_persona_ids.contains(&p.id) {
            continue;
        }

        let triggers = triggers_map.remove(&p.id).unwrap_or_default();
        let subscriptions = subscriptions_map.remove(&p.id).unwrap_or_default();
        // Honor the export-time memory opt-out: drop the persona's memories
        // when the user unchecked "Include memories".
        let memories = if include_memories {
            memories_map.remove(&p.id).unwrap_or_default()
        } else {
            Vec::new()
        };
        let tools = tools_map.remove(&p.id).unwrap_or_default();
        let test_suites = suites_map.remove(&p.id).unwrap_or_default();

        persona_exports.push(PersonaExport {
            id: p.id.clone(),
            name: p.name.clone(),
            description: p.description.clone(),
            system_prompt: p.system_prompt.clone(),
            structured_prompt: p.structured_prompt.clone(),
            // Custom icons are local-only files — downgrade to a built-in so
            // the exported persona doesn't carry a dead reference.
            icon: export_safe_icon(p.icon.as_deref(), p.template_category.as_deref()),
            color: p.color.clone(),
            max_concurrent: p.max_concurrent,
            timeout_ms: p.timeout_ms,
            notification_channels: p.notification_channels.clone(),
            model_profile: p.model_profile.clone(),
            max_budget_usd: p.max_budget_usd,
            max_turns: p.max_turns,
            design_context: p.design_context.clone(),
            triggers: triggers
                .iter()
                .map(|t| TriggerExport {
                    trigger_type: t.trigger_type.clone(),
                    config: t.config.clone(),
                    enabled: t.enabled,
                    use_case_id: t.use_case_id.clone(),
                })
                .collect(),
            subscriptions: subscriptions
                .iter()
                .map(|s| SubscriptionExport {
                    event_type: s.event_type.clone(),
                    source_filter: s.source_filter.clone(),
                    enabled: s.enabled,
                    use_case_id: s.use_case_id.clone(),
                })
                .collect(),
            memories: memories
                .iter()
                .map(|m| MemoryExport {
                    title: m.title.clone(),
                    content: m.content.clone(),
                    category: m.category.clone(),
                    importance: m.importance,
                    tags: m.tags.clone(),
                })
                .collect(),
            tool_ids: tools.iter().map(|t| t.id.clone()).collect(),
            test_suites: test_suites
                .iter()
                .map(|s| TestSuiteExport {
                    name: s.name.clone(),
                    description: s.description.clone(),
                    scenarios: s.scenarios.clone(),
                    scenario_count: s.scenario_count,
                })
                .collect(),
        });
    }

    // Collect only referenced tool IDs
    let referenced_tool_ids: std::collections::HashSet<String> = persona_exports
        .iter()
        .flat_map(|p| p.tool_ids.iter().cloned())
        .collect();

    let tool_exports: Vec<ToolDefinitionExport> = all_tools
        .iter()
        .filter(|t| matches!(&scope, ExportScope::Full) || referenced_tool_ids.contains(&t.id))
        .map(|t| ToolDefinitionExport {
            id: t.id.clone(),
            name: t.name.clone(),
            category: t.category.clone(),
            description: t.description.clone(),
            input_schema: t.input_schema.clone(),
            requires_credential_type: t.requires_credential_type.clone(),
            implementation_guide: t.implementation_guide.clone(),
            is_builtin: t.is_builtin,
        })
        .collect();

    // Build team exports
    let mut team_exports = Vec::new();
    for t in &all_teams {
        if !selected_team_ids.contains(&t.id) {
            continue;
        }

        let members = team_repo::get_members(pool, &t.id)?;
        let connections = team_repo::get_connections(pool, &t.id)?;

        // Team memories ride along with their team, gated by the same
        // include_memories opt-out as persona memories.
        let team_memories = if include_memories {
            team_memory_repo::get_all(
                pool,
                &t.id,
                None,
                None,
                None,
                Some(MAX_TEAM_MEMORIES_PER_TEAM as i64),
                Some(0),
            )?
        } else {
            Vec::new()
        };

        team_exports.push(TeamExport {
            id: t.id.clone(),
            name: t.name.clone(),
            description: t.description.clone(),
            canvas_data: t.canvas_data.clone(),
            team_config: t.team_config.clone(),
            icon: export_safe_icon(t.icon.as_deref(), None),
            memories: team_memories
                .iter()
                .map(|m| TeamMemoryExport {
                    title: m.title.clone(),
                    content: m.content.clone(),
                    category: m.category.clone(),
                    importance: m.importance,
                    tags: portable_team_memory_tags(&m.tags),
                })
                .collect(),
            members: members
                .iter()
                .map(|m| TeamMemberExport {
                    persona_id: m.persona_id.clone(),
                    role: Some(m.role.clone()),
                    position_x: Some(m.position_x),
                    position_y: Some(m.position_y),
                    config: m.config.clone(),
                })
                .collect(),
            connections: connections
                .iter()
                .map(|c| TeamConnectionExport {
                    source_persona_id: c.source_member_id.clone(),
                    target_persona_id: c.target_member_id.clone(),
                    connection_type: Some(c.connection_type.clone()),
                    condition: c.condition.clone(),
                    label: c.label.clone(),
                })
                .collect(),
        });
    }

    // Credential metadata exports (no secrets — filtered in selective mode)
    let selected_credential_ids: Option<&Vec<String>> = match &scope {
        ExportScope::Full => None,
        ExportScope::Selective { credential_ids, .. } if credential_ids.is_empty() => None,
        ExportScope::Selective { credential_ids, .. } => Some(credential_ids),
    };

    let credential_exports: Vec<CredentialMetaExport> = all_credentials
        .iter()
        .filter(|c| match &selected_credential_ids {
            None => true,
            Some(ids) => ids.contains(&c.id),
        })
        .map(|c| CredentialMetaExport {
            name: c.name.clone(),
            service_type: c.service_type.clone(),
            metadata: c.metadata.clone(),
        })
        .collect();

    // KPI setup. KPIs are project-scoped; the "team's KPI setup" is the KPIs of
    // the projects its selected teams belong to. Full export takes every project's
    // KPIs. Only active/paused KPIs travel; each carries a capped, newest-first
    // slice of its measurement history.
    let kpi_exports: Vec<KpiExport> = if include_kpis {
        let source_kpis = match &scope {
            ExportScope::Full => dev_tools_repo::list_all_kpis(pool)?,
            ExportScope::Selective { .. } => {
                let mut project_ids: std::collections::HashSet<String> =
                    std::collections::HashSet::new();
                for t in &all_teams {
                    if selected_team_ids.contains(&t.id) {
                        if let Some(pid) = &t.project_id {
                            project_ids.insert(pid.clone());
                        }
                    }
                }
                let mut out = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for pid in &project_ids {
                    for k in dev_tools_repo::list_kpis(pool, pid, None)? {
                        if seen.insert(k.id.clone()) {
                            out.push(k);
                        }
                    }
                }
                out
            }
        };

        source_kpis
            .into_iter()
            .filter(|k| is_exportable_kpi(&k.status))
            .take(MAX_KPIS)
            .map(|k| {
                let measurements = dev_tools_repo::list_kpi_measurements(
                    pool,
                    &k.id,
                    Some(MAX_KPI_MEASUREMENTS as i64),
                )
                .unwrap_or_default()
                .into_iter()
                .map(|m| KpiMeasurementExport {
                    value: m.value,
                    measured_at: m.measured_at,
                    source: m.source,
                    evidence: m.evidence,
                    note: m.note,
                })
                .collect();

                KpiExport {
                    name: k.name,
                    description: k.description,
                    category: k.category,
                    measure_kind: k.measure_kind,
                    measure_config: k.measure_config,
                    unit: k.unit,
                    direction: k.direction,
                    baseline_value: k.baseline_value,
                    target_value: k.target_value,
                    target_date: k.target_date,
                    cadence: k.cadence,
                    status: k.status,
                    tier: k.tier,
                    rationale: k.rationale,
                    needed_connector: k.needed_connector,
                    metric_type: k.metric_type,
                    warn_at: k.warn_at,
                    crit_at: k.crit_at,
                    measurements,
                }
            })
            .collect()
    } else {
        Vec::new()
    };

    // Dev-tools projects + workspace knowledge. Full scope takes every
    // project and workspace; selective scope takes exactly the requested ids
    // (an empty list means none — same semantics as personas/teams above).
    let (project_filter, workspace_filter): (Option<&[String]>, Option<&[String]>) = match &scope {
        ExportScope::Full => (None, None),
        ExportScope::Selective {
            project_ids,
            workspace_ids,
            ..
        } => (Some(project_ids.as_slice()), Some(workspace_ids.as_slice())),
    };
    let dev_project_exports = collect_dev_project_exports(pool, project_filter)?;
    let bundled_project_ids: Vec<String> =
        dev_project_exports.iter().map(|p| p.id.clone()).collect();
    let workspace_exports =
        collect_workspace_knowledge_exports(pool, workspace_filter, &bundled_project_ids)?;

    Ok(PortabilityBundle {
        format_version: 2,
        exported_at: chrono::Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        scope,
        personas: persona_exports,
        tool_definitions: tool_exports,
        teams: team_exports,
        credentials: credential_exports,
        kpis: kpi_exports,
        dev_projects: dev_project_exports,
        workspace_knowledge: workspace_exports,
        encrypted_credentials: None,
    })
}

/// Run a single-parameter query and collect the mapped rows. All dev-tools
/// collection queries key off one id (project or workspace), so this keeps
/// the two dozen table sweeps below from each re-spelling the same loop.
fn query_rows<T>(
    conn: &rusqlite::Connection,
    sql: &str,
    key: &str,
    map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, AppError> {
    let mut stmt = conn.prepare(sql).map_err(AppError::Database)?;
    let rows = stmt.query_map([key], map).map_err(AppError::Database)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(AppError::Database)?);
    }
    Ok(out)
}

/// Collect dev projects (with their full child graph + on-disk skills).
/// `filter_ids: None` = all projects (Full scope, capped); `Some(ids)` =
/// exactly those ids, silently skipping unknown ones (same posture as the
/// persona/team selective filters).
fn collect_dev_project_exports(
    pool: &DbPool,
    filter_ids: Option<&[String]>,
) -> Result<Vec<DevProjectExport>, AppError> {
    if filter_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;

    const PROJECT_COLS: &str = "id, name, root_path, description, status, tech_stack, team_id, \
         auto_pr_on_success, github_url, main_branch, \
         test_env_url, test_env_branch, workspace_id, data_links, static_scan_config, \
         standards_config, monitoring_project_slug, created_at, updated_at";
    type ProjectRow = (
        String,
        String,
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        bool,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
    );
    let map_project = |r: &rusqlite::Row<'_>| -> rusqlite::Result<ProjectRow> {
        Ok((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get(4)?,
            r.get(5)?,
            r.get(6)?,
            r.get(7)?,
            r.get(8)?,
            r.get(9)?,
            r.get(10)?,
            r.get(11)?,
            r.get(12)?,
            r.get(13)?,
            r.get(14)?,
            r.get(15)?,
            r.get(16)?,
            r.get(17)?,
            r.get(18)?,
        ))
    };

    let project_rows: Vec<ProjectRow> = match filter_ids {
        None => {
            let sql = format!("SELECT {PROJECT_COLS} FROM dev_projects ORDER BY created_at");
            let mut stmt = conn.prepare(&sql).map_err(AppError::Database)?;
            let rows = stmt.query_map([], map_project).map_err(AppError::Database)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::Database)?);
                if out.len() >= MAX_DEV_PROJECTS {
                    break;
                }
            }
            out
        }
        Some(ids) => {
            let sql = format!("SELECT {PROJECT_COLS} FROM dev_projects WHERE id = ?1");
            let mut seen = std::collections::HashSet::new();
            let mut out = Vec::new();
            for id in ids.iter().take(MAX_DEV_PROJECTS) {
                if !seen.insert(id.clone()) {
                    continue;
                }
                let mut stmt = conn.prepare(&sql).map_err(AppError::Database)?;
                let mut rows = stmt.query_map([id.as_str()], map_project).map_err(AppError::Database)?;
                if let Some(row) = rows.next() {
                    out.push(row.map_err(AppError::Database)?);
                }
            }
            out
        }
    };

    let mut exports = Vec::with_capacity(project_rows.len());
    for row in project_rows {
        let (
            id,
            name,
            root_path,
            description,
            status,
            tech_stack,
            team_id,
            auto_pr_on_success,
            github_url,
            main_branch,
            test_env_url,
            test_env_branch,
            workspace_id,
            data_links,
            static_scan_config,
            standards_config,
            monitoring_project_slug,
            created_at,
            updated_at,
        ) = row;
        let pid = id.as_str();

        let goals = query_rows(
            &conn,
            "SELECT id, parent_goal_id, context_id, kpi_id, order_index, title, description, \
                    status, progress, target_date, started_at, completed_at, created_at, updated_at \
             FROM dev_goals WHERE project_id = ?1 ORDER BY order_index, created_at",
            pid,
            |r| {
                Ok(DevGoalExport {
                    id: r.get(0)?,
                    parent_goal_id: r.get(1)?,
                    context_id: r.get(2)?,
                    kpi_id: r.get(3)?,
                    order_index: r.get(4)?,
                    title: r.get(5)?,
                    description: r.get(6)?,
                    status: r.get(7)?,
                    progress: r.get(8)?,
                    target_date: r.get(9)?,
                    started_at: r.get(10)?,
                    completed_at: r.get(11)?,
                    created_at: r.get(12)?,
                    updated_at: r.get(13)?,
                })
            },
        )?;

        let goal_dependencies = query_rows(
            &conn,
            "SELECT d.id, d.goal_id, d.depends_on_id, d.dependency_type, d.created_at \
             FROM dev_goal_dependencies d JOIN dev_goals g ON g.id = d.goal_id \
             WHERE g.project_id = ?1",
            pid,
            |r| {
                Ok(DevGoalDependencyExport {
                    id: r.get(0)?,
                    goal_id: r.get(1)?,
                    depends_on_id: r.get(2)?,
                    dependency_type: r.get(3)?,
                    created_at: r.get(4)?,
                })
            },
        )?;

        let goal_signals = query_rows(
            &conn,
            "SELECT s.id, s.goal_id, s.signal_type, s.source_id, s.delta, s.message, s.created_at \
             FROM dev_goal_signals s JOIN dev_goals g ON g.id = s.goal_id \
             WHERE g.project_id = ?1",
            pid,
            |r| {
                Ok(DevGoalSignalExport {
                    id: r.get(0)?,
                    goal_id: r.get(1)?,
                    signal_type: r.get(2)?,
                    source_id: r.get(3)?,
                    delta: r.get(4)?,
                    message: r.get(5)?,
                    created_at: r.get(6)?,
                })
            },
        )?;

        let goal_items = query_rows(
            &conn,
            "SELECT i.id, i.goal_id, i.title, i.done, i.order_index, i.created_at, i.updated_at \
             FROM dev_goal_items i JOIN dev_goals g ON g.id = i.goal_id \
             WHERE g.project_id = ?1 ORDER BY i.goal_id, i.order_index",
            pid,
            |r| {
                Ok(DevGoalItemExport {
                    id: r.get(0)?,
                    goal_id: r.get(1)?,
                    title: r.get(2)?,
                    done: r.get(3)?,
                    order_index: r.get(4)?,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                })
            },
        )?;

        let context_groups = query_rows(
            &conn,
            "SELECT id, name, color, icon, group_type, position, health_score, last_scan_at, \
                    created_at, updated_at \
             FROM dev_context_groups WHERE project_id = ?1 ORDER BY position",
            pid,
            |r| {
                Ok(DevContextGroupExport {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    icon: r.get(3)?,
                    group_type: r.get(4)?,
                    position: r.get(5)?,
                    health_score: r.get(6)?,
                    last_scan_at: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            },
        )?;

        let contexts = query_rows(
            &conn,
            "SELECT id, group_id, name, description, file_paths, entry_points, db_tables, \
                    keywords, api_surface, cross_refs, tech_stack, category, business_feature, \
                    pinned, created_at, updated_at \
             FROM dev_contexts WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevContextExport {
                    id: r.get(0)?,
                    group_id: r.get(1)?,
                    name: r.get(2)?,
                    description: r.get(3)?,
                    file_paths: r.get(4)?,
                    entry_points: r.get(5)?,
                    db_tables: r.get(6)?,
                    keywords: r.get(7)?,
                    api_surface: r.get(8)?,
                    cross_refs: r.get(9)?,
                    tech_stack: r.get(10)?,
                    category: r.get(11)?,
                    business_feature: r.get(12)?,
                    pinned: r.get(13)?,
                    created_at: r.get(14)?,
                    updated_at: r.get(15)?,
                })
            },
        )?;

        let context_group_relationships = query_rows(
            &conn,
            "SELECT id, source_group_id, target_group_id, created_at \
             FROM dev_context_group_relationships WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevContextGroupRelationshipExport {
                    id: r.get(0)?,
                    source_group_id: r.get(1)?,
                    target_group_id: r.get(2)?,
                    created_at: r.get(3)?,
                })
            },
        )?;

        let context_fingerprints = query_rows(
            &conn,
            "SELECT context_id, content_hash, file_count, missing_file_count, imports, \
                    primitives, promise_all_count, join_all_count, await_count, sql_write_count, \
                    spawn_count, use_effect_count, set_state_after_await_count, \
                    exports_components, exports_hooks, exports_commands, exports_repo_fns, \
                    computed_at \
             FROM dev_context_fingerprints WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevContextFingerprintExport {
                    context_id: r.get(0)?,
                    content_hash: r.get(1)?,
                    file_count: r.get(2)?,
                    missing_file_count: r.get(3)?,
                    imports: r.get(4)?,
                    primitives: r.get(5)?,
                    promise_all_count: r.get(6)?,
                    join_all_count: r.get(7)?,
                    await_count: r.get(8)?,
                    sql_write_count: r.get(9)?,
                    spawn_count: r.get(10)?,
                    use_effect_count: r.get(11)?,
                    set_state_after_await_count: r.get(12)?,
                    exports_components: r.get(13)?,
                    exports_hooks: r.get(14)?,
                    exports_commands: r.get(15)?,
                    exports_repo_fns: r.get(16)?,
                    computed_at: r.get(17)?,
                })
            },
        )?;

        let ideas = query_rows(
            &conn,
            "SELECT id, context_id, scan_type, category, title, description, reasoning, status, \
                    effort, impact, risk, priority, provider, model, rejection_reason, origin, \
                    use_case_id, evidence, dedup_key, verify_state, verify_checked_at, \
                    verify_evidence, created_at, updated_at \
             FROM dev_ideas WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevIdeaExport {
                    id: r.get(0)?,
                    context_id: r.get(1)?,
                    scan_type: r.get(2)?,
                    category: r.get(3)?,
                    title: r.get(4)?,
                    description: r.get(5)?,
                    reasoning: r.get(6)?,
                    status: r.get(7)?,
                    effort: r.get(8)?,
                    impact: r.get(9)?,
                    risk: r.get(10)?,
                    priority: r.get(11)?,
                    provider: r.get(12)?,
                    model: r.get(13)?,
                    rejection_reason: r.get(14)?,
                    origin: r.get(15)?,
                    use_case_id: r.get(16)?,
                    evidence: r.get(17)?,
                    dedup_key: r.get(18)?,
                    verify_state: r.get(19)?,
                    verify_checked_at: r.get(20)?,
                    verify_evidence: r.get(21)?,
                    created_at: r.get(22)?,
                    updated_at: r.get(23)?,
                })
            },
        )?;

        let tasks = query_rows(
            &conn,
            "SELECT id, title, description, source_idea_id, goal_id, status, session_id, \
                    progress_pct, output_lines, error, depth, parent_task_id, attempt, \
                    started_at, completed_at, created_at \
             FROM dev_tasks WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevTaskExport {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    description: r.get(2)?,
                    source_idea_id: r.get(3)?,
                    goal_id: r.get(4)?,
                    status: r.get(5)?,
                    session_id: r.get(6)?,
                    progress_pct: r.get(7)?,
                    output_lines: r.get(8)?,
                    error: r.get(9)?,
                    depth: r.get(10)?,
                    parent_task_id: r.get(11)?,
                    attempt: r.get(12)?,
                    started_at: r.get(13)?,
                    completed_at: r.get(14)?,
                    created_at: r.get(15)?,
                })
            },
        )?;

        let competitions = query_rows(
            &conn,
            "SELECT id, task_title, task_description, source_idea_id, source_goal_id, \
                    slot_count, status, winner_task_id, winner_insight, baseline_json, \
                    reviewer_notes, worktree_base_ref, created_at, resolved_at \
             FROM dev_competitions WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevCompetitionExport {
                    id: r.get(0)?,
                    task_title: r.get(1)?,
                    task_description: r.get(2)?,
                    source_idea_id: r.get(3)?,
                    source_goal_id: r.get(4)?,
                    slot_count: r.get(5)?,
                    status: r.get(6)?,
                    winner_task_id: r.get(7)?,
                    winner_insight: r.get(8)?,
                    baseline_json: r.get(9)?,
                    reviewer_notes: r.get(10)?,
                    worktree_base_ref: r.get(11)?,
                    created_at: r.get(12)?,
                    resolved_at: r.get(13)?,
                })
            },
        )?;

        let competition_slots = query_rows(
            &conn,
            "SELECT s.id, s.competition_id, s.task_id, s.strategy_label, s.strategy_prompt, \
                    s.worktree_name, s.branch_name, s.slot_index, s.disqualified, \
                    s.disqualify_reason, s.diff_hash, s.diff_stats_json, s.diff_analyzed_at, \
                    s.created_at \
             FROM dev_competition_slots s \
             JOIN dev_competitions c ON c.id = s.competition_id \
             WHERE c.project_id = ?1 ORDER BY s.competition_id, s.slot_index",
            pid,
            |r| {
                Ok(DevCompetitionSlotExport {
                    id: r.get(0)?,
                    competition_id: r.get(1)?,
                    task_id: r.get(2)?,
                    strategy_label: r.get(3)?,
                    strategy_prompt: r.get(4)?,
                    worktree_name: r.get(5)?,
                    branch_name: r.get(6)?,
                    slot_index: r.get(7)?,
                    disqualified: r.get(8)?,
                    disqualify_reason: r.get(9)?,
                    diff_hash: r.get(10)?,
                    diff_stats_json: r.get(11)?,
                    diff_analyzed_at: r.get(12)?,
                    created_at: r.get(13)?,
                })
            },
        )?;

        let triage_rules = query_rows(
            &conn,
            "SELECT id, name, conditions, action, enabled, times_fired, created_at \
             FROM dev_triage_rules WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevTriageRuleExport {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    conditions: r.get(2)?,
                    action: r.get(3)?,
                    enabled: r.get(4)?,
                    times_fired: r.get(5)?,
                    created_at: r.get(6)?,
                })
            },
        )?;

        // dev_pipelines carries project_id with no FK — enumerate by the
        // column explicitly (same below for dev_memories).
        let pipelines = query_rows(
            &conn,
            "SELECT id, idea_id, task_id, stage, auto_execute, verify_after, \
                    verification_scan_id, error, created_at, updated_at \
             FROM dev_pipelines WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevPipelineExport {
                    id: r.get(0)?,
                    idea_id: r.get(1)?,
                    task_id: r.get(2)?,
                    stage: r.get(3)?,
                    auto_execute: r.get(4)?,
                    verify_after: r.get(5)?,
                    verification_scan_id: r.get(6)?,
                    error: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            },
        )?;

        let standards = query_rows(
            &conn,
            "SELECT id, scan_id, rule_key, category, title, status, severity, evidence, \
                    recommendation, created_at, updated_at \
             FROM dev_standards WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevStandardExport {
                    id: r.get(0)?,
                    scan_id: r.get(1)?,
                    rule_key: r.get(2)?,
                    category: r.get(3)?,
                    title: r.get(4)?,
                    status: r.get(5)?,
                    severity: r.get(6)?,
                    evidence: r.get(7)?,
                    recommendation: r.get(8)?,
                    created_at: r.get(9)?,
                    updated_at: r.get(10)?,
                })
            },
        )?;

        let use_cases = query_rows(
            &conn,
            "SELECT id, name, slug, description, kind, primary_context_id, status, created_by, \
                    pinned, rationale, created_at, updated_at \
             FROM dev_use_cases WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevUseCaseExport {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    slug: r.get(2)?,
                    description: r.get(3)?,
                    kind: r.get(4)?,
                    primary_context_id: r.get(5)?,
                    status: r.get(6)?,
                    created_by: r.get(7)?,
                    pinned: r.get(8)?,
                    rationale: r.get(9)?,
                    created_at: r.get(10)?,
                    updated_at: r.get(11)?,
                })
            },
        )?;

        let use_case_contexts = query_rows(
            &conn,
            "SELECT ucc.use_case_id, ucc.context_id \
             FROM dev_use_case_contexts ucc \
             JOIN dev_use_cases uc ON uc.id = ucc.use_case_id \
             WHERE uc.project_id = ?1",
            pid,
            |r| {
                Ok(DevUseCaseContextExport {
                    use_case_id: r.get(0)?,
                    context_id: r.get(1)?,
                })
            },
        )?;

        let milestones = query_rows(
            &conn,
            "SELECT id, name, goal, status, order_index, target_date, cut_at, shipped_at, \
                    created_at, updated_at \
             FROM dev_milestones WHERE project_id = ?1 ORDER BY order_index",
            pid,
            |r| {
                Ok(DevMilestoneExport {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    goal: r.get(2)?,
                    status: r.get(3)?,
                    order_index: r.get(4)?,
                    target_date: r.get(5)?,
                    cut_at: r.get(6)?,
                    shipped_at: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            },
        )?;

        let milestone_items = query_rows(
            &conn,
            "SELECT mi.milestone_id, mi.item_kind, mi.item_id, mi.bucket, mi.added_after_cut, \
                    mi.order_index, mi.created_at, mi.description, mi.rating \
             FROM dev_milestone_items mi \
             JOIN dev_milestones m ON m.id = mi.milestone_id \
             WHERE m.project_id = ?1 ORDER BY mi.milestone_id, mi.order_index",
            pid,
            |r| {
                Ok(DevMilestoneItemExport {
                    milestone_id: r.get(0)?,
                    item_kind: r.get(1)?,
                    item_id: r.get(2)?,
                    bucket: r.get(3)?,
                    added_after_cut: r.get(4)?,
                    order_index: r.get(5)?,
                    created_at: r.get(6)?,
                    description: r.get(7)?,
                    rating: r.get(8)?,
                })
            },
        )?;

        let kpis = query_rows(
            &conn,
            "SELECT id, context_group_id, context_id, use_case_id, name, description, category, \
                    measure_kind, measure_config, unit, direction, baseline_value, target_value, \
                    target_date, current_value, last_measured_at, cadence, status, created_by, \
                    rationale, needed_connector, metric_type, tier, warn_at, crit_at, \
                    manual_rating, assessment_pros, assessment_cons, last_skip_at, \
                    last_skip_rationale, created_at, updated_at \
             FROM dev_kpis WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevKpiExport {
                    id: r.get(0)?,
                    context_group_id: r.get(1)?,
                    context_id: r.get(2)?,
                    use_case_id: r.get(3)?,
                    name: r.get(4)?,
                    description: r.get(5)?,
                    category: r.get(6)?,
                    measure_kind: r.get(7)?,
                    measure_config: r.get(8)?,
                    unit: r.get(9)?,
                    direction: r.get(10)?,
                    baseline_value: r.get(11)?,
                    target_value: r.get(12)?,
                    target_date: r.get(13)?,
                    current_value: r.get(14)?,
                    last_measured_at: r.get(15)?,
                    cadence: r.get(16)?,
                    status: r.get(17)?,
                    created_by: r.get(18)?,
                    rationale: r.get(19)?,
                    needed_connector: r.get(20)?,
                    metric_type: r.get(21)?,
                    tier: r.get(22)?,
                    warn_at: r.get(23)?,
                    crit_at: r.get(24)?,
                    manual_rating: r.get(25)?,
                    assessment_pros: r.get(26)?,
                    assessment_cons: r.get(27)?,
                    last_skip_at: r.get(28)?,
                    last_skip_rationale: r.get(29)?,
                    created_at: r.get(30)?,
                    updated_at: r.get(31)?,
                })
            },
        )?;

        let kpi_measurements = query_rows(
            &conn,
            "SELECT m.id, m.kpi_id, m.value, m.measured_at, m.source, m.env, m.evidence, m.note \
             FROM dev_kpi_measurements m JOIN dev_kpis k ON k.id = m.kpi_id \
             WHERE k.project_id = ?1 ORDER BY m.kpi_id, m.measured_at",
            pid,
            |r| {
                Ok(DevKpiMeasurementExport {
                    id: r.get(0)?,
                    kpi_id: r.get(1)?,
                    value: r.get(2)?,
                    measured_at: r.get(3)?,
                    source: r.get(4)?,
                    env: r.get(5)?,
                    evidence: r.get(6)?,
                    note: r.get(7)?,
                })
            },
        )?;

        // credential_id intentionally not selected — see DevKpiBindingExport.
        let kpi_bindings = query_rows(
            &conn,
            "SELECT b.id, b.kpi_id, b.service_type, b.procedure, b.composed_by, b.status, \
                    b.verified_at, b.created_at \
             FROM dev_kpi_bindings b JOIN dev_kpis k ON k.id = b.kpi_id \
             WHERE k.project_id = ?1",
            pid,
            |r| {
                Ok(DevKpiBindingExport {
                    id: r.get(0)?,
                    kpi_id: r.get(1)?,
                    service_type: r.get(2)?,
                    procedure: r.get(3)?,
                    composed_by: r.get(4)?,
                    status: r.get(5)?,
                    verified_at: r.get(6)?,
                    created_at: r.get(7)?,
                })
            },
        )?;

        let memories = query_rows(
            &conn,
            "SELECT id, category, title, content, importance, source_kind, source_id, \
                    created_at, updated_at \
             FROM dev_memories WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevMemoryExport {
                    id: r.get(0)?,
                    category: r.get(1)?,
                    title: r.get(2)?,
                    content: r.get(3)?,
                    importance: r.get(4)?,
                    source_kind: r.get(5)?,
                    source_id: r.get(6)?,
                    created_at: r.get(7)?,
                    updated_at: r.get(8)?,
                })
            },
        )?;

        let memory_nodes = query_rows(
            &conn,
            "SELECT id, context_id, kind, title, body, source, status, content_hash, \
                    created_at, updated_at \
             FROM memory_nodes WHERE project_id = ?1",
            pid,
            |r| {
                Ok(MemoryNodeExport {
                    id: r.get(0)?,
                    context_id: r.get(1)?,
                    kind: r.get(2)?,
                    title: r.get(3)?,
                    body: r.get(4)?,
                    source: r.get(5)?,
                    status: r.get(6)?,
                    content_hash: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            },
        )?;

        let memory_edges = query_rows(
            &conn,
            "SELECT e.from_id, e.to_id, e.rel, e.created_at \
             FROM memory_edges e JOIN memory_nodes n ON n.id = e.from_id \
             WHERE n.project_id = ?1",
            pid,
            |r| {
                Ok(MemoryEdgeExport {
                    from_id: r.get(0)?,
                    to_id: r.get(1)?,
                    rel: r.get(2)?,
                    created_at: r.get(3)?,
                })
            },
        )?;

        let skills = collect_project_skills(&root_path);

        exports.push(DevProjectExport {
            id,
            name,
            root_path,
            description,
            status,
            tech_stack,
            team_id,
            auto_pr_on_success,
            github_url,
            main_branch,
            test_env_url,
            test_env_branch,
            workspace_id,
            data_links,
            static_scan_config,
            standards_config,
            monitoring_project_slug,
            created_at,
            updated_at,
            goals,
            goal_dependencies,
            goal_signals,
            goal_items,
            context_groups,
            contexts,
            context_group_relationships,
            context_fingerprints,
            ideas,
            tasks,
            competitions,
            competition_slots,
            triage_rules,
            pipelines,
            standards,
            use_cases,
            use_case_contexts,
            milestones,
            milestone_items,
            kpis,
            kpi_measurements,
            kpi_bindings,
            memories,
            memory_nodes,
            memory_edges,
            skills,
        });
    }

    Ok(exports)
}

/// Read a project's `.claude/skills/` library from disk. Mirrors the layout
/// scanned by `commands::infrastructure::skill_files`: each skill is a
/// directory (SKILL.md + optional reference files, possibly nested) or a
/// single `<name>.md`. Missing/unreadable dirs yield an empty vec — a
/// project whose repo isn't on this machine still exports its DB graph.
fn collect_project_skills(root_path: &str) -> Vec<SkillFileExport> {
    let skills_dir = std::path::Path::new(root_path).join(".claude").join("skills");
    let Ok(read_dir) = std::fs::read_dir(&skills_dir) else {
        return Vec::new();
    };

    let mut skills = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().to_string();
        // Same shape as skill_files::validate_skill_name — a skill is one
        // safe path segment. Anything else is skipped, never an error.
        if entry_name.is_empty()
            || entry_name.contains('/')
            || entry_name.contains('\\')
            || entry_name.contains("..")
            || entry_name.contains(':')
        {
            continue;
        }

        let (name, mut files) = if path.is_dir() {
            let mut files = Vec::new();
            collect_skill_dir_files(&path, &path, &mut files);
            (entry_name, files)
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            // Single-file skill: skills/<name>.md
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();
            match read_skill_file(&path) {
                Some(content) => (
                    stem,
                    vec![SkillFileEntry {
                        rel_path: entry_name,
                        content,
                    }],
                ),
                None => continue,
            }
        } else {
            continue;
        };

        if files.is_empty() {
            continue;
        }
        // Deterministic order → deterministic content_hash.
        files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

        use sha2::Digest as _;
        let mut hasher = sha2::Sha256::new();
        for f in &files {
            hasher.update(f.rel_path.as_bytes());
            hasher.update([0u8]);
            hasher.update(f.content.as_bytes());
            hasher.update([0u8]);
        }
        let content_hash = format!("{:x}", hasher.finalize());

        skills.push(SkillFileExport {
            name,
            files,
            content_hash,
        });
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

/// Recursively collect a skill directory's exportable files (rel paths with
/// forward slashes). Skips the provenance sidecar, oversize files, and
/// non-UTF-8 content.
fn collect_skill_dir_files(base: &std::path::Path, dir: &std::path::Path, out: &mut Vec<SkillFileEntry>) {
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_skill_dir_files(base, &path, out);
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some(SKILL_PROVENANCE_FILE) {
            continue;
        }
        let Some(content) = read_skill_file(&path) else {
            continue;
        };
        let Ok(rel) = path.strip_prefix(base) else {
            continue;
        };
        let rel_path = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        out.push(SkillFileEntry { rel_path, content });
    }
}

/// Read one skill file as UTF-8 text, or None when it is oversize
/// (> [`MAX_SKILL_FILE_BYTES`]), unreadable, or not valid UTF-8.
fn read_skill_file(path: &std::path::Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_SKILL_FILE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    String::from_utf8(bytes).ok()
}

/// Collect workspaces with their knowledge library and adoption cells.
/// `filter_ids: None` = all workspaces; `Some(ids)` = exactly those.
/// Adoption is filtered to `bundled_project_ids` so the bundle never carries
/// cells pointing at projects that don't travel with it.
fn collect_workspace_knowledge_exports(
    pool: &DbPool,
    filter_ids: Option<&[String]>,
    bundled_project_ids: &[String],
) -> Result<Vec<WorkspaceKnowledgeExport>, AppError> {
    if filter_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;

    type WorkspaceRow = (String, String, Option<String>, Option<String>);
    let map_workspace = |r: &rusqlite::Row<'_>| -> rusqlite::Result<WorkspaceRow> {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    };

    let workspace_rows: Vec<WorkspaceRow> = match filter_ids {
        None => {
            let mut stmt = conn
                .prepare("SELECT id, name, color, description FROM dev_workspaces ORDER BY created_at")
                .map_err(AppError::Database)?;
            let rows = stmt.query_map([], map_workspace).map_err(AppError::Database)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::Database)?);
            }
            out
        }
        Some(ids) => {
            let mut seen = std::collections::HashSet::new();
            let mut out = Vec::new();
            for id in ids {
                if !seen.insert(id.clone()) {
                    continue;
                }
                let mut stmt = conn
                    .prepare("SELECT id, name, color, description FROM dev_workspaces WHERE id = ?1")
                    .map_err(AppError::Database)?;
                let mut rows = stmt
                    .query_map([id.as_str()], map_workspace)
                    .map_err(AppError::Database)?;
                if let Some(row) = rows.next() {
                    out.push(row.map_err(AppError::Database)?);
                }
            }
            out
        }
    };

    let mut exports = Vec::with_capacity(workspace_rows.len());
    for (id, name, color, description) in workspace_rows {
        // ALL statuses travel — the lifecycle (observed → adopted /
        // deprecated / rejected) is itself the data being ported.
        let knowledge = query_rows(
            &conn,
            "SELECT id, kind, title, statement, detail_md, topic, abstraction, ftype, \
                    durability, governing_id, evidence_count, applicability, status, \
                    origin_project_id, provenance, confidence, dedup_key, superseded_by, \
                    harvest_scope, valid_from, valid_to, decided_at, created_at, updated_at \
             FROM workspace_knowledge WHERE workspace_id = ?1 ORDER BY created_at",
            &id,
            |r| {
                Ok(WorkspaceKnowledgeEntryExport {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    title: r.get(2)?,
                    statement: r.get(3)?,
                    detail_md: r.get(4)?,
                    topic: r.get(5)?,
                    abstraction: r.get(6)?,
                    ftype: r.get(7)?,
                    durability: r.get(8)?,
                    governing_id: r.get(9)?,
                    evidence_count: r.get(10)?,
                    applicability: r.get(11)?,
                    status: r.get(12)?,
                    origin_project_id: r.get(13)?,
                    provenance: r.get(14)?,
                    confidence: r.get(15)?,
                    dedup_key: r.get(16)?,
                    superseded_by: r.get(17)?,
                    harvest_scope: r.get(18)?,
                    valid_from: r.get(19)?,
                    valid_to: r.get(20)?,
                    decided_at: r.get(21)?,
                    created_at: r.get(22)?,
                    updated_at: r.get(23)?,
                })
            },
        )?;
        let knowledge: Vec<WorkspaceKnowledgeEntryExport> =
            knowledge.into_iter().take(MAX_KNOWLEDGE_ENTRIES).collect();

        let adoption_all = query_rows(
            &conn,
            "SELECT a.practice_id, a.project_id, a.state, a.note, a.last_verified_at \
             FROM workspace_practice_adoption a \
             JOIN workspace_knowledge k ON k.id = a.practice_id \
             WHERE k.workspace_id = ?1",
            &id,
            |r| {
                Ok(WorkspaceAdoptionExport {
                    practice_id: r.get(0)?,
                    project_id: r.get(1)?,
                    state: r.get(2)?,
                    note: r.get(3)?,
                    last_verified_at: r.get(4)?,
                })
            },
        )?;
        let adoption: Vec<WorkspaceAdoptionExport> = adoption_all
            .into_iter()
            .filter(|a| bundled_project_ids.contains(&a.project_id))
            .collect();

        exports.push(WorkspaceKnowledgeExport {
            id,
            name,
            color,
            description,
            knowledge,
            adoption,
        });
    }

    Ok(exports)
}

async fn save_bundle_to_file(
    app: &AppHandle,
    bundle: &PortabilityBundle,
    default_name: &str,
) -> Result<bool, AppError> {
    let json =
        serde_json::to_string_pretty(bundle).map_err(|e| AppError::Internal(e.to_string()))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let file_name = format!("{}_{}.zip", default_name, timestamp);
    let app_clone = app.clone();

    let save_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("Personas Export Archive", &["zip"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    if let Some(file_path) = save_path {
        let path = file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;

        // Write as ZIP containing the JSON manifest
        let zip_bytes = create_zip_bundle(&json)?;
        tokio::fs::write(&path, zip_bytes)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;

        return Ok(true);
    }

    Ok(false)
}

fn create_zip_bundle(json: &str) -> Result<Vec<u8>, AppError> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP error: {e}")))?;
        zip.write_all(json.as_bytes())
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.finish()
            .map_err(|e| AppError::Internal(format!("ZIP finish error: {e}")))?;
    }
    Ok(buf.into_inner())
}

/// Maximum decompressed size for ZIP entries (50 MB).
const MAX_DECOMPRESSED_SIZE: u64 = 50 * 1024 * 1024;

fn read_zip_bundle(path: &std::path::Path) -> Result<String, AppError> {
    let file = std::fs::File::open(path)
        .map_err(|e| AppError::Internal(format!("Failed to open ZIP: {e}")))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Internal(format!("Invalid ZIP archive: {e}")))?;
    let mut manifest = archive
        .by_name("manifest.json")
        .map_err(|_| AppError::Validation("ZIP archive does not contain manifest.json".into()))?;

    // Guard against zip bombs: reject entries whose declared size exceeds the limit
    if manifest.size() > MAX_DECOMPRESSED_SIZE {
        return Err(AppError::Validation(format!(
            "manifest.json decompressed size ({} bytes) exceeds the {} MB limit",
            manifest.size(),
            MAX_DECOMPRESSED_SIZE / (1024 * 1024)
        )));
    }

    // Read with a capped reader so even a lying size header cannot exhaust memory
    let mut limited = std::io::Read::take(&mut manifest, MAX_DECOMPRESSED_SIZE + 1);
    let mut content = String::new();
    limited
        .read_to_string(&mut content)
        .map_err(|e| AppError::Internal(format!("Failed to read manifest: {e}")))?;

    if content.len() as u64 > MAX_DECOMPRESSED_SIZE {
        return Err(AppError::Validation(format!(
            "manifest.json decompressed content exceeds the {} MB limit",
            MAX_DECOMPRESSED_SIZE / (1024 * 1024)
        )));
    }

    Ok(content)
}

fn validate_bundle(bundle: &PortabilityBundle) -> Result<(), AppError> {
    // Top-level array caps
    validation::require_max_count("personas", &bundle.personas, MAX_PERSONAS)?;
    validation::require_max_count("tool_definitions", &bundle.tool_definitions, MAX_TOOLS)?;
    validation::require_max_count("teams", &bundle.teams, MAX_TEAMS)?;
    validation::require_max_count("credentials", &bundle.credentials, MAX_CREDENTIALS)?;
    validation::require_max_count("kpis", &bundle.kpis, MAX_KPIS)?;
    validation::require_max_count("dev_projects", &bundle.dev_projects, MAX_DEV_PROJECTS)?;
    for (i, w) in bundle.workspace_knowledge.iter().enumerate() {
        validation::require_max_count(
            &format!("workspace_knowledge[{i}].knowledge"),
            &w.knowledge,
            MAX_KNOWLEDGE_ENTRIES,
        )?;
    }

    // Validate tool definitions
    for (i, t) in bundle.tool_definitions.iter().enumerate() {
        validation::require_non_empty(&format!("tool[{i}].name"), &t.name)?;
        validation::require_max_len(&format!("tool[{i}].name"), &t.name, MAX_NAME_LEN)?;
        validation::require_max_len(
            &format!("tool[{i}].category"),
            &t.category,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_max_len(
            &format!("tool[{i}].description"),
            &t.description,
            MAX_DESCRIPTION_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("tool[{i}].input_schema"),
            &t.input_schema,
            MAX_SCHEMA_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("tool[{i}].requires_credential_type"),
            &t.requires_credential_type,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("tool[{i}].implementation_guide"),
            &t.implementation_guide,
            MAX_DESIGN_CONTEXT_LEN,
        )?;
    }

    // Validate credentials
    for (i, c) in bundle.credentials.iter().enumerate() {
        validation::require_non_empty(&format!("credential[{i}].name"), &c.name)?;
        validation::require_max_len(&format!("credential[{i}].name"), &c.name, MAX_NAME_LEN)?;
        validation::require_max_len(
            &format!("credential[{i}].service_type"),
            &c.service_type,
            MAX_NAME_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("credential[{i}].metadata"),
            &c.metadata,
            MAX_SCHEMA_LEN,
        )?;
    }

    // Validate KPI setup
    for (i, k) in bundle.kpis.iter().enumerate() {
        let prefix = format!("kpi[{i}]");
        validation::require_non_empty(&format!("{prefix}.name"), &k.name)?;
        validation::require_max_len(&format!("{prefix}.name"), &k.name, MAX_NAME_LEN)?;
        validation::require_optional_max_len(
            &format!("{prefix}.description"),
            &k.description,
            MAX_DESCRIPTION_LEN,
        )?;
        validation::require_max_len(
            &format!("{prefix}.category"),
            &k.category,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_max_len(
            &format!("{prefix}.measure_kind"),
            &k.measure_kind,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_max_len(
            &format!("{prefix}.measure_config"),
            &k.measure_config,
            MAX_CONFIG_LEN,
        )?;
        validation::require_max_len(&format!("{prefix}.unit"), &k.unit, MAX_SHORT_FIELD_LEN)?;
        validation::require_max_count(
            &format!("{prefix}.measurements"),
            &k.measurements,
            MAX_KPI_MEASUREMENTS,
        )?;
    }

    // Validate personas and their sub-entities
    for (i, p) in bundle.personas.iter().enumerate() {
        let prefix = format!("persona[{i}]");

        // Core persona fields
        validation::require_non_empty(&format!("{prefix}.name"), &p.name)?;
        validation::require_max_len(&format!("{prefix}.name"), &p.name, MAX_NAME_LEN)?;
        validation::require_max_len(
            &format!("{prefix}.system_prompt"),
            &p.system_prompt,
            MAX_SYSTEM_PROMPT_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.description"),
            &p.description,
            MAX_DESCRIPTION_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.structured_prompt"),
            &p.structured_prompt,
            MAX_STRUCTURED_PROMPT_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.icon"),
            &p.icon,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.color"),
            &p.color,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.notification_channels"),
            &p.notification_channels,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.model_profile"),
            &p.model_profile,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.design_context"),
            &p.design_context,
            MAX_DESIGN_CONTEXT_LEN,
        )?;

        // Sub-entity array caps
        validation::require_max_count(
            &format!("{prefix}.triggers"),
            &p.triggers,
            MAX_TRIGGERS_PER_PERSONA,
        )?;
        validation::require_max_count(
            &format!("{prefix}.subscriptions"),
            &p.subscriptions,
            MAX_SUBSCRIPTIONS_PER_PERSONA,
        )?;
        validation::require_max_count(
            &format!("{prefix}.memories"),
            &p.memories,
            MAX_MEMORIES_PER_PERSONA,
        )?;
        validation::require_max_count(
            &format!("{prefix}.test_suites"),
            &p.test_suites,
            MAX_TEST_SUITES_PER_PERSONA,
        )?;

        // Validate triggers
        for (j, t) in p.triggers.iter().enumerate() {
            validation::require_non_empty(
                &format!("{prefix}.trigger[{j}].trigger_type"),
                &t.trigger_type,
            )?;
            validation::require_max_len(
                &format!("{prefix}.trigger[{j}].trigger_type"),
                &t.trigger_type,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.trigger[{j}].config"),
                &t.config,
                MAX_CONFIG_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.trigger[{j}].use_case_id"),
                &t.use_case_id,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        // Validate subscriptions
        for (j, s) in p.subscriptions.iter().enumerate() {
            validation::require_non_empty(
                &format!("{prefix}.subscription[{j}].event_type"),
                &s.event_type,
            )?;
            validation::require_max_len(
                &format!("{prefix}.subscription[{j}].event_type"),
                &s.event_type,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.subscription[{j}].source_filter"),
                &s.source_filter,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.subscription[{j}].use_case_id"),
                &s.use_case_id,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        // Validate memories
        for (j, m) in p.memories.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.memory[{j}].title"), &m.title)?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].title"),
                &m.title,
                MAX_NAME_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].content"),
                &m.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].category"),
                &m.category,
                MAX_SHORT_FIELD_LEN,
            )?;
            // Surface tag-serialization failures as a validation error
            // rather than collapsing them into an empty string. See the
            // matching guard in import_export::import_persona for the
            // why — silent unwrap_or_default() lets craft-able tags
            // bypass the length check and reach the DB layer raw.
            let tags_serialized = m
                .tags
                .as_ref()
                .map(|jv| serde_json::to_string(&jv.0))
                .transpose()
                .map_err(|e| {
                    AppError::Validation(format!(
                        "{prefix}.memory[{j}].tags is not serializable JSON: {e}"
                    ))
                })?;
            validation::require_optional_max_len(
                &format!("{prefix}.memory[{j}].tags"),
                &tags_serialized,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        // Validate test suites
        for (j, s) in p.test_suites.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.test_suite[{j}].name"), &s.name)?;
            validation::require_max_len(
                &format!("{prefix}.test_suite[{j}].name"),
                &s.name,
                MAX_NAME_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.test_suite[{j}].description"),
                &s.description,
                MAX_DESCRIPTION_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.test_suite[{j}].scenarios"),
                &s.scenarios,
                MAX_SCENARIOS_LEN,
            )?;
        }
    }

    // Validate teams
    for (i, t) in bundle.teams.iter().enumerate() {
        let prefix = format!("team[{i}]");

        validation::require_non_empty(&format!("{prefix}.name"), &t.name)?;
        validation::require_max_len(&format!("{prefix}.name"), &t.name, MAX_NAME_LEN)?;
        validation::require_optional_max_len(
            &format!("{prefix}.description"),
            &t.description,
            MAX_DESCRIPTION_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.canvas_data"),
            &t.canvas_data,
            MAX_CANVAS_DATA_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.team_config"),
            &t.team_config,
            MAX_CONFIG_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{prefix}.icon"),
            &t.icon,
            MAX_SHORT_FIELD_LEN,
        )?;

        validation::require_max_count(&format!("{prefix}.members"), &t.members, MAX_TEAM_MEMBERS)?;
        validation::require_max_count(
            &format!("{prefix}.connections"),
            &t.connections,
            MAX_TEAM_CONNECTIONS,
        )?;
        validation::require_max_count(
            &format!("{prefix}.memories"),
            &t.memories,
            MAX_TEAM_MEMORIES_PER_TEAM,
        )?;

        for (j, m) in t.memories.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.memory[{j}].title"), &m.title)?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].title"),
                &m.title,
                MAX_NAME_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].content"),
                &m.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_max_len(
                &format!("{prefix}.memory[{j}].category"),
                &m.category,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.memory[{j}].tags"),
                &m.tags,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        for (j, m) in t.members.iter().enumerate() {
            validation::require_optional_max_len(
                &format!("{prefix}.member[{j}].role"),
                &m.role,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.member[{j}].config"),
                &m.config,
                MAX_CONFIG_LEN,
            )?;
        }

        for (j, c) in t.connections.iter().enumerate() {
            validation::require_optional_max_len(
                &format!("{prefix}.connection[{j}].connection_type"),
                &c.connection_type,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.connection[{j}].condition"),
                &c.condition,
                MAX_CONFIG_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{prefix}.connection[{j}].label"),
                &c.label,
                MAX_NAME_LEN,
            )?;
        }
    }

    Ok(())
}

fn import_bundle(
    pool: &DbPool,
    bundle: &PortabilityBundle,
    project_resolutions: &HashMap<String, String>,
) -> Result<PortabilityImportResult, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    let mut result = PortabilityImportResult {
        personas_created: 0,
        teams_created: 0,
        tools_created: 0,
        credentials_created: 0,
        team_memories_created: 0,
        kpis_created: 0,
        projects_imported: 0,
        projects_skipped: 0,
        knowledge_imported: 0,
        knowledge_skipped_duplicates: 0,
        skills_written: 0,
        skills_deferred: 0,
        project_conflicts: Vec::new(),
        bundle_file_path: None,
        warnings: Vec::new(),
        id_mapping: std::collections::HashMap::new(),
    };

    let now = chrono::Utc::now().to_rfc3339();

    // A non-empty resolutions map marks the second (resolution) pass of the
    // two-pass project conflict flow: the non-project sections were already
    // imported on pass 1, so only the resolved projects (plus their adoption
    // cells / skills) are processed. The workspace-knowledge phase still runs
    // — its id/dedup checks make it idempotent — so the knowledge id map is
    // available for adoption cells of the newly resolved projects.
    let is_resolution_pass = !project_resolutions.is_empty();

    // Phase 2: Import tool definitions (map old IDs to new IDs, skip builtins)
    if !is_resolution_pass {
    for t in &bundle.tool_definitions {
        if t.is_builtin {
            // Builtin tools already exist -- try to find matching by name
            let found = tx
                .query_row(
                    "SELECT id FROM persona_tool_definitions WHERE name = ?1 LIMIT 1",
                    rusqlite::params![t.name],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            if let Some(existing_id) = found {
                result.id_mapping.insert(t.id.clone(), existing_id);
                continue;
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let is_builtin_i = if t.is_builtin { 1i32 } else { 0i32 };
        match tx.execute(
            "INSERT INTO persona_tool_definitions
             (id, name, category, description, script_path,
              input_schema, output_schema, requires_credential_type,
              implementation_guide, is_builtin, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            rusqlite::params![
                id,
                t.name,
                t.category,
                t.description,
                "",
                t.input_schema,
                Option::<String>::None,
                t.requires_credential_type,
                t.implementation_guide,
                is_builtin_i,
                now,
            ],
        ) {
            Ok(_) => {
                result.id_mapping.insert(t.id.clone(), id);
                result.tools_created += 1;
            }
            Err(e) => result.warnings.push(format!("Tool '{}': {}", t.name, e)),
        }
    }

    // Phase 3: Import credential metadata (no secrets — user must re-enter via Credential Vault)
    for c in &bundle.credentials {
        let imported_name = format!("{} (imported)", c.name);
        // Skip if a credential shell for this import already exists. Check
        // against the name actually stored below (the "(imported)"-suffixed
        // one) — checking the raw export name here would never match what
        // gets inserted, letting re-imports pile up duplicate shells.
        let exists = tx
            .query_row(
                "SELECT COUNT(*) FROM persona_credentials WHERE name = ?1 AND service_type = ?2",
                rusqlite::params![imported_name, c.service_type],
                |row| row.get::<_, i32>(0),
            )
            .unwrap_or(0)
            > 0;
        if exists {
            continue;
        }

        let id = uuid::Uuid::new_v4().to_string();
        // Create credential shell with empty encrypted data — secrets must be added separately
        let empty_encrypted =
            crypto::encrypt_for_db("{}").map_err(|e| AppError::Internal(e.to_string()))?;
        match tx.execute(
            "INSERT INTO persona_credentials
             (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
            rusqlite::params![
                id,
                imported_name,
                c.service_type,
                empty_encrypted.0,
                empty_encrypted.1,
                c.metadata,
                now,
            ],
        ) {
            Ok(_) => result.credentials_created += 1,
            Err(e) => result
                .warnings
                .push(format!("Credential '{}': {}", c.name, e)),
        }
    }

    // Phase 4: Import personas (map old IDs to new)
    for p in &bundle.personas {
        let new_id = uuid::Uuid::new_v4().to_string();
        let persona_name = format!("{} (imported)", p.name);
        let enabled_i = 0i32; // imported personas start disabled
        let max_concurrent = p.max_concurrent;
        let timeout_ms = p.timeout_ms;

        // Encrypt notification channel secrets before storing.
        // Never fall back to the original plaintext on failure: downstream
        // reads treat this column as ciphertext, so persisting plaintext
        // would leak webhook secrets / Slack tokens / SMTP passwords on disk
        // and break decryption on every subsequent read. If the keyring is
        // unavailable, skip this persona and surface a warning so the user
        // can re-import once it's healthy.
        let encrypted_channels = match &p.notification_channels {
            Some(json) if !json.trim().is_empty() => {
                match persona_repo::encrypt_notification_channels(json) {
                    Ok(enc) => Some(enc),
                    Err(e) => {
                        result.warnings.push(format!(
                            "Persona '{}': skipped — failed to encrypt notification channels ({}). Re-import once the keyring is available.",
                            p.name, e
                        ));
                        continue;
                    }
                }
            }
            other => other.clone(),
        };

        match tx.execute(
            "INSERT INTO personas
             (id, project_id, name, description, system_prompt, structured_prompt,
              icon, color, enabled, sensitive, max_concurrent, timeout_ms,
              model_profile, max_budget_usd, max_turns, design_context,
              notification_channels, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?12,?13,?14,?15,?16,?17,?17)",
            rusqlite::params![
                new_id,
                "default",
                persona_name,
                p.description,
                p.system_prompt,
                p.structured_prompt,
                p.icon,
                p.color,
                enabled_i,
                max_concurrent,
                timeout_ms,
                p.model_profile,
                p.max_budget_usd,
                p.max_turns,
                p.design_context,
                encrypted_channels,
                now,
            ],
        ) {
            Ok(_) => {
                result.id_mapping.insert(p.id.clone(), new_id.clone());
                result.personas_created += 1;

                // Sub-entities: triggers
                for t in &p.triggers {
                    let tid = uuid::Uuid::new_v4().to_string();
                    let enabled_i = if t.enabled { 1i32 } else { 0i32 };
                    if let Err(e) = tx.execute(
                        "INSERT INTO persona_triggers
                         (id, persona_id, trigger_type, config, enabled, use_case_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                        rusqlite::params![tid, new_id, t.trigger_type, t.config, enabled_i, t.use_case_id, now],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' trigger ({}): {}",
                            p.name, t.trigger_type, e
                        ));
                    }
                }

                // Sub-entities: subscriptions
                for s in &p.subscriptions {
                    let sid = uuid::Uuid::new_v4().to_string();
                    let enabled_i = if s.enabled { 1i32 } else { 0i32 };
                    if let Err(e) = tx.execute(
                        "INSERT OR IGNORE INTO persona_event_subscriptions
                         (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                        rusqlite::params![sid, new_id, s.event_type, s.source_filter, enabled_i, s.use_case_id, now],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' subscription ({}): {}",
                            p.name, s.event_type, e
                        ));
                    }
                }

                // Sub-entities: memories
                for m in &p.memories {
                    let mid = uuid::Uuid::new_v4().to_string();
                    let category = m.category.as_str();
                    let importance = m.importance;
                    if let Err(e) = tx.execute(
                        "INSERT INTO persona_memories
                         (id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                        rusqlite::params![mid, new_id, m.title, m.content, category, Option::<String>::None, importance, m.tags, now],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' memory ({}): {}",
                            p.name, m.title, e
                        ));
                    }
                }

                // Sub-entities: tool assignments
                for old_tool_id in &p.tool_ids {
                    if let Some(new_tool_id) = result.id_mapping.get(old_tool_id) {
                        let aid = uuid::Uuid::new_v4().to_string();
                        if let Err(e) = tx.execute(
                            "INSERT INTO persona_tools (id, persona_id, tool_id, tool_config, created_at)
                             VALUES (?1, ?2, ?3, ?4, ?5)",
                            rusqlite::params![aid, new_id, new_tool_id, Option::<String>::None, now],
                        ) {
                            result.warnings.push(format!(
                                "Persona '{}' tool assignment: {}",
                                p.name, e
                            ));
                        }
                    }
                }

                // Sub-entities: test suites
                for s in &p.test_suites {
                    let sid = uuid::Uuid::new_v4().to_string();
                    if let Err(e) = tx.execute(
                        "INSERT INTO test_suites (id, persona_id, name, description, scenarios, scenario_count, source_run_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                        rusqlite::params![sid, new_id, s.name, s.description, s.scenarios, s.scenario_count, Option::<String>::None, now],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' test suite ({}): {}",
                            p.name, s.name, e
                        ));
                    }
                }
            }
            Err(e) => result.warnings.push(format!("Persona '{}': {}", p.name, e)),
        }
    }

    // Phase 5: Import teams (remap member persona IDs)
    for t in &bundle.teams {
        let new_team_id = uuid::Uuid::new_v4().to_string();
        let team_name = format!("{} (imported)", t.name);
        let enabled_i = 0i32; // imported teams start disabled

        match tx.execute(
            "INSERT INTO persona_teams
             (id, project_id, parent_team_id, name, description, canvas_data, team_config, icon, color, enabled, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            rusqlite::params![
                new_team_id,
                Option::<String>::None,
                Option::<String>::None,
                team_name,
                t.description,
                t.canvas_data,
                t.team_config,
                t.icon,
                "#6B7280",
                enabled_i,
                now,
            ],
        ) {
            Ok(_) => {
                result.id_mapping.insert(t.id.clone(), new_team_id.clone());
                result.teams_created += 1;

                // member old ID -> new member ID mapping for connections
                let mut member_id_map: std::collections::HashMap<String, String> =
                    std::collections::HashMap::new();

                for m in &t.members {
                    // No entry in `id_mapping` means the persona was never
                    // created in this import — either it wasn't in the
                    // bundle, or Phase 4 skipped it (e.g. keyring
                    // unavailable while encrypting notification channels).
                    // Falling back to the raw exported persona_id would
                    // insert a member row pointing at an id that exists
                    // nowhere in the new DB. Skip it and say so instead.
                    let Some(new_persona_id) = result.id_mapping.get(&m.persona_id).cloned()
                    else {
                        result.warnings.push(format!(
                            "Team '{}' member skipped: persona '{}' was not imported",
                            t.name, m.persona_id
                        ));
                        continue;
                    };

                    let mid = uuid::Uuid::new_v4().to_string();
                    let role = m.role.as_deref().unwrap_or("worker");
                    let px = m.position_x.unwrap_or(0.0);
                    let py = m.position_y.unwrap_or(0.0);

                    match tx.execute(
                        "INSERT INTO persona_team_members (id, team_id, persona_id, role, position_x, position_y, config, created_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![mid, new_team_id, new_persona_id, role, px, py, m.config, now],
                    ) {
                        Ok(_) => {
                            member_id_map
                                .insert(m.persona_id.clone(), mid);
                        }
                        Err(e) => result.warnings.push(format!(
                            "Team '{}' member: {}",
                            t.name, e
                        )),
                    }
                }

                for c in &t.connections {
                    let source_id = member_id_map
                        .get(&c.source_persona_id)
                        .cloned()
                        .unwrap_or_else(|| c.source_persona_id.clone());
                    let target_id = member_id_map
                        .get(&c.target_persona_id)
                        .cloned()
                        .unwrap_or_else(|| c.target_persona_id.clone());

                    let cid = uuid::Uuid::new_v4().to_string();
                    let conn_type = c.connection_type.as_deref().unwrap_or("sequential");

                    if let Err(e) = tx.execute(
                        "INSERT INTO persona_team_connections
                         (id, team_id, source_member_id, target_member_id, connection_type, condition, label, created_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![cid, new_team_id, source_id, target_id, conn_type, c.condition, c.label, now],
                    ) {
                        result.warnings.push(format!(
                            "Team '{}' connection: {}",
                            t.name, e
                        ));
                    }
                }

                // Sub-entities: team memories. Run-specific provenance
                // (run_id / member_id / persona_id) does not survive the
                // bundle — those rows aren't exported — so import them as
                // manually-curated memories with null provenance. Importance
                // is clamped to the 1–10 range the repo enforces on create.
                for m in &t.memories {
                    let mid = uuid::Uuid::new_v4().to_string();
                    let importance = m.importance.clamp(1, 10);
                    if let Err(e) = tx.execute(
                        "INSERT INTO team_memories
                         (id, team_id, run_id, member_id, persona_id, title, content, category, importance, tags, created_at, updated_at)
                         VALUES (?1, ?2, NULL, NULL, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                        rusqlite::params![mid, new_team_id, m.title, m.content, m.category, importance, m.tags, now],
                    ) {
                        result.warnings.push(format!(
                            "Team '{}' memory ({}): {}",
                            t.name, m.title, e
                        ));
                    } else {
                        result.team_memories_created += 1;
                    }
                }
            }
            Err(e) => result
                .warnings
                .push(format!("Team '{}': {}", t.name, e)),
        }
    }

    // Phase 6: Import KPI setup. KPIs are project-scoped and FK-bound to
    // dev_projects, but neither projects nor a team's project survive the bundle.
    // So imported KPIs land in a single, deduped, dormant "Imported" project —
    // grouped, paused, and reviewable — instead of polluting a real project. The
    // measure config is tied to the source environment, so a `paused` status keeps
    // them out of autonomous measurement/derivation until the user reconfigures.
    if !bundle.kpis.is_empty() {
        let imported_project_id: Option<String> = match tx
            .query_row(
                "SELECT id FROM dev_projects WHERE name = 'Imported' LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
        {
            Some(id) => Some(id),
            None => {
                let pid = uuid::Uuid::new_v4().to_string();
                match tx.execute(
                    "INSERT INTO dev_projects (id, name, root_path, description, status, created_at, updated_at)
                     VALUES (?1, 'Imported', ?2, ?3, 'active', ?4, ?4)",
                    rusqlite::params![
                        pid,
                        format!("imported://{pid}"),
                        "Holds KPI setup brought in by workspace import. Review and reassign as needed.",
                        now,
                    ],
                ) {
                    Ok(_) => Some(pid),
                    Err(e) => {
                        result
                            .warnings
                            .push(format!("Could not create 'Imported' project for KPIs: {e}"));
                        None
                    }
                }
            }
        };

        if let Some(project_id) = imported_project_id {
            for k in bundle.kpis.iter().take(MAX_KPIS) {
                // Dedup by (project, name) so re-imports don't duplicate.
                let exists = tx
                    .query_row(
                        "SELECT COUNT(*) FROM dev_kpis WHERE project_id = ?1 AND name = ?2",
                        rusqlite::params![project_id, k.name],
                        |row| row.get::<_, i32>(0),
                    )
                    .unwrap_or(0)
                    > 0;
                if exists {
                    continue;
                }

                let kpi_id = uuid::Uuid::new_v4().to_string();
                // Measurements are exported newest-first; the head seeds current state.
                let latest = k.measurements.first();
                let current_value = latest.map(|m| m.value);
                let last_measured_at = latest.map(|m| m.measured_at.clone());

                // Base insert mirrors create_kpi's proven column set; always paused.
                match tx.execute(
                    "INSERT INTO dev_kpis (id, project_id, context_group_id, name, description,
                        category, measure_kind, measure_config, unit, direction,
                        baseline_value, target_value, target_date, cadence, status,
                        created_by, rationale, needed_connector, metric_type, context_id)
                     VALUES (?1,?2,NULL,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'paused','user',?14,?15,?16,NULL)",
                    rusqlite::params![
                        kpi_id, project_id, k.name, k.description, k.category, k.measure_kind,
                        k.measure_config, k.unit, k.direction, k.baseline_value, k.target_value,
                        k.target_date, k.cadence, k.rationale, k.needed_connector, k.metric_type,
                    ],
                ) {
                    Ok(_) => {
                        result.kpis_created += 1;

                        // Preserve tier + calibration lines + seed last-known value.
                        // These columns exist on the current schema; degrade quietly
                        // (the KPI is already imported) if an older DB lacks them.
                        let _ = tx.execute(
                            "UPDATE dev_kpis SET tier = ?1, warn_at = ?2, crit_at = ?3,
                                current_value = ?4, last_measured_at = ?5,
                                updated_at = datetime('now')
                             WHERE id = ?6",
                            rusqlite::params![
                                k.tier, k.warn_at, k.crit_at, current_value, last_measured_at, kpi_id,
                            ],
                        );

                        for m in k.measurements.iter().take(MAX_KPI_MEASUREMENTS) {
                            let mid = uuid::Uuid::new_v4().to_string();
                            // Clamp to the CHECK-constrained source set.
                            let source = match m.source.as_str() {
                                "evaluator" | "manual" | "scan" | "health_snapshot" => {
                                    m.source.as_str()
                                }
                                _ => "manual",
                            };
                            let _ = tx.execute(
                                "INSERT INTO dev_kpi_measurements
                                 (id, kpi_id, value, measured_at, source, evidence, note)
                                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                                rusqlite::params![
                                    mid, kpi_id, m.value, m.measured_at, source, m.evidence, m.note,
                                ],
                            );
                        }
                    }
                    Err(e) => result.warnings.push(format!("KPI '{}': {}", k.name, e)),
                }
            }
        }
    }

    } // end !is_resolution_pass (phases 2–6 run on pass 1 only)

    // Phase 7: Workspaces + knowledge libraries. Runs on both passes — the
    // id / dedup checks make it idempotent, and the resolution pass needs the
    // knowledge id map for adoption cells of the newly resolved projects.
    let mut workspace_id_map: HashMap<String, String> = HashMap::new();
    let mut knowledge_id_map: HashMap<String, String> = HashMap::new();
    import_workspace_knowledge(
        &tx,
        bundle,
        &now,
        &mut result,
        &mut workspace_id_map,
        &mut knowledge_id_map,
    );

    // Phase 8: Dev projects (two-pass conflict flow). `project_id_map` maps
    // bundle project id → the id the project landed under in THIS database
    // (original for fresh imports, existing for replace, fresh uuid for
    // duplicate). Skills are written to disk only after the tx commits.
    let mut project_id_map: HashMap<String, String> = HashMap::new();
    let mut pending_skills: Vec<(String, bool, usize)> = Vec::new(); // (root_path, overwrite, bundle index)
    for (idx, p) in bundle.dev_projects.iter().enumerate() {
        let resolution = project_resolutions.get(&p.id).map(String::as_str);
        if is_resolution_pass && resolution.is_none() {
            // Pass 2 touches only the projects the caller resolved; everything
            // else was handled (imported or conflict-listed) on pass 1.
            continue;
        }

        let conflict = find_project_conflict(&tx, p);
        let mode = match (&conflict, resolution) {
            (Some((existing_id, matched_by)), None) => {
                result.project_conflicts.push(ProjectConflict {
                    bundle_project_id: p.id.clone(),
                    name: p.name.clone(),
                    root_path: p.root_path.clone(),
                    existing_project_id: existing_id.clone(),
                    matched_by: (*matched_by).to_string(),
                });
                continue;
            }
            (Some(_), Some("skip")) => {
                result.projects_skipped += 1;
                continue;
            }
            (Some((existing_id, _)), Some("replace")) => {
                ProjectImportMode::Replace {
                    existing_id: existing_id.clone(),
                }
            }
            (Some(_), Some("duplicate")) => ProjectImportMode::Duplicate,
            // No conflict: import with original uuids. This also covers a
            // resolution whose conflict vanished between the two passes.
            (None, _) => ProjectImportMode::Fresh,
            (Some(_), Some(other)) => {
                result.warnings.push(format!(
                    "Project '{}': unknown resolution '{}'; not imported",
                    p.name, other
                ));
                continue;
            }
        };

        // team_id / workspace_id: remap through this bundle's imports when
        // possible, keep when the id already exists here, else NULL + warning.
        let team_id = resolve_soft_row_ref(
            &tx,
            &result.id_mapping,
            &p.team_id,
            "persona_teams",
            &mut result.warnings,
            &format!("Project '{}': team not found in this workspace; cleared", p.name),
        );
        let workspace_id = resolve_soft_row_ref(
            &tx,
            &workspace_id_map,
            &p.workspace_id,
            "dev_workspaces",
            &mut result.warnings,
            &format!(
                "Project '{}': workspace not found here; cleared",
                p.name
            ),
        );

        match import_dev_project_graph(&tx, p, &mode, team_id, workspace_id, &now, &mut result.warnings) {
            Some((target_id, final_root_path)) => {
                result.projects_imported += 1;
                project_id_map.insert(p.id.clone(), target_id);
                if !std::path::Path::new(&final_root_path).is_dir() {
                    result.warnings.push(format!(
                        "Project '{}': folder '{}' not found on this machine; edit it in Project Manager",
                        p.name, final_root_path
                    ));
                }
                pending_skills.push((
                    final_root_path,
                    matches!(mode, ProjectImportMode::Replace { .. }),
                    idx,
                ));
            }
            None => { /* row-level failure already surfaced as a warning */ }
        }
    }

    // Phase 9: Adoption cells — only when BOTH the practice and the project
    // exist post-import (INSERT OR IGNORE on the (practice, project) PK).
    for ws in &bundle.workspace_knowledge {
        for a in &ws.adoption {
            let Some(practice_id) = knowledge_id_map.get(&a.practice_id) else {
                continue;
            };
            let project_id = match project_id_map.get(&a.project_id) {
                Some(id) => Some(id.clone()),
                None => {
                    // Non-conflicting projects keep their original uuids, so a
                    // pass-2 run (or a re-import) can still resolve them by id.
                    if row_exists(&tx, "SELECT 1 FROM dev_projects WHERE id = ?1", &a.project_id) {
                        Some(a.project_id.clone())
                    } else {
                        None
                    }
                }
            };
            let Some(project_id) = project_id else {
                continue;
            };
            if let Err(e) = tx.execute(
                "INSERT OR IGNORE INTO workspace_practice_adoption
                 (practice_id, project_id, state, fleet_key, note, last_verified_at, updated_at)
                 VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)",
                rusqlite::params![practice_id, project_id, a.state, a.note, a.last_verified_at, now],
            ) {
                result
                    .warnings
                    .push(format!("Adoption cell ({practice_id} → {project_id}): {e}"));
            }
        }
    }

    // Commit the transaction -- all entities are persisted atomically.
    // If anything above returned a hard error (not a warning), we would
    // have already returned Err and the transaction would roll back on drop.
    tx.commit().map_err(AppError::Database)?;

    // Phase 10 (post-commit, filesystem): write imported skills under each
    // project's `<root_path>/.claude/skills/`. Deliberately after the commit —
    // disk must never change for a rolled-back import.
    for (root_path, overwrite, idx) in pending_skills {
        write_project_skills(&root_path, &bundle.dev_projects[idx].skills, overwrite, &mut result);
    }

    Ok(result)
}

// ============================================================================
// Dev-tools project + workspace-knowledge import helpers (WP2)
// ============================================================================

/// How a bundled dev project lands in this database.
enum ProjectImportMode {
    /// No conflict — import with the ORIGINAL uuids (nothing collides).
    Fresh,
    /// Conflict resolved as "replace": keep the existing project id, update
    /// the row in place, delete + re-insert the covered child families with
    /// their original bundle uuids. Telemetry tables are never touched.
    Replace { existing_id: String },
    /// Conflict resolved as "duplicate": fresh uuid for the project and every
    /// child row, with all internal refs remapped.
    Duplicate,
}

fn row_exists(tx: &rusqlite::Transaction<'_>, sql: &str, id: &str) -> bool {
    tx.query_row(sql, [id], |_| Ok(())).is_ok()
}

/// Warn-and-continue insert helper — the established per-row failure idiom.
fn exec_row(
    tx: &rusqlite::Transaction<'_>,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
    label: &str,
    warnings: &mut Vec<String>,
) -> bool {
    match tx.execute(sql, params) {
        Ok(_) => true,
        Err(e) => {
            warnings.push(format!("{label}: {e}"));
            false
        }
    }
}

/// Resolve an exported `team_id` / `workspace_id` style soft ref: remap when
/// the referenced row was imported in this bundle, keep when the id already
/// exists in `table`, otherwise NULL + warning.
fn resolve_soft_row_ref(
    tx: &rusqlite::Transaction<'_>,
    imported_map: &HashMap<String, String>,
    value: &Option<String>,
    table: &str,
    warnings: &mut Vec<String>,
    warn_msg: &str,
) -> Option<String> {
    let id = value.as_deref()?;
    if let Some(mapped) = imported_map.get(id) {
        return Some(mapped.clone());
    }
    let sql = format!("SELECT 1 FROM {table} WHERE id = ?1");
    if row_exists(tx, &sql, id) {
        return Some(id.to_string());
    }
    warnings.push(warn_msg.to_string());
    None
}

/// A bundled project conflicts when the target holds a project with the same
/// `root_path` (primary — the column is UNIQUE) or, failing that, the same
/// name compared case-insensitively.
fn find_project_conflict(
    tx: &rusqlite::Transaction<'_>,
    p: &DevProjectExport,
) -> Option<(String, &'static str)> {
    if let Ok(id) = tx.query_row(
        "SELECT id FROM dev_projects WHERE root_path = ?1",
        [p.root_path.as_str()],
        |r| r.get::<_, String>(0),
    ) {
        return Some((id, "root_path"));
    }
    if let Ok(id) = tx.query_row(
        "SELECT id FROM dev_projects WHERE name = ?1 COLLATE NOCASE",
        [p.name.as_str()],
        |r| r.get::<_, String>(0),
    ) {
        return Some((id, "name"));
    }
    None
}

/// Required internal ref remap (columns that always point inside the bundled
/// graph). Falls back to the original id when unmapped — the insert's own
/// FK/warning path reports anything genuinely broken.
fn remap_req(map: &HashMap<String, String>, id: &str) -> String {
    map.get(id).cloned().unwrap_or_else(|| id.to_string())
}

/// Optional soft-ref remap. In `strict` (duplicate) mode an unmappable ref is
/// cleared to NULL with a warning — keeping the original would point the fresh
/// copy at another project's rows. In identity modes the original is kept.
fn remap_soft(
    map: &HashMap<String, String>,
    v: &Option<String>,
    strict: bool,
    warnings: &mut Vec<String>,
    ctx: &str,
) -> Option<String> {
    match v.as_deref() {
        None => None,
        Some(id) => match map.get(id) {
            Some(n) => Some(n.clone()),
            None if strict => {
                warnings.push(format!("{ctx}: unresolved reference '{id}' cleared"));
                None
            }
            None => Some(id.to_string()),
        },
    }
}

/// Delete the child families the bundle covers ahead of a "replace"
/// re-insert. Explicit (no reliance on FK cascades) and intentionally NOT
/// touching telemetry / scan-cache tables (dev_llm_spend, dev_auto_runs,
/// dev_scans, dev_run_checkpoints, skill_registry, dev_context_file_hashes,
/// context_health_snapshots, workspace_harvest_coverage).
fn delete_project_children(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
) -> Result<(), rusqlite::Error> {
    const DELETES: &[&str] = &[
        "DELETE FROM dev_goal_dependencies WHERE goal_id IN (SELECT id FROM dev_goals WHERE project_id = ?1)",
        "DELETE FROM dev_goal_signals WHERE goal_id IN (SELECT id FROM dev_goals WHERE project_id = ?1)",
        "DELETE FROM dev_goal_items WHERE goal_id IN (SELECT id FROM dev_goals WHERE project_id = ?1)",
        "DELETE FROM dev_use_case_contexts WHERE use_case_id IN (SELECT id FROM dev_use_cases WHERE project_id = ?1)",
        "DELETE FROM dev_milestone_items WHERE milestone_id IN (SELECT id FROM dev_milestones WHERE project_id = ?1)",
        "DELETE FROM dev_kpi_measurements WHERE kpi_id IN (SELECT id FROM dev_kpis WHERE project_id = ?1)",
        "DELETE FROM dev_kpi_bindings WHERE kpi_id IN (SELECT id FROM dev_kpis WHERE project_id = ?1)",
        "DELETE FROM dev_competition_slots WHERE competition_id IN (SELECT id FROM dev_competitions WHERE project_id = ?1)",
        "DELETE FROM memory_edges WHERE from_id IN (SELECT id FROM memory_nodes WHERE project_id = ?1) \
             OR to_id IN (SELECT id FROM memory_nodes WHERE project_id = ?1)",
        "DELETE FROM dev_tasks WHERE project_id = ?1",
        "DELETE FROM dev_competitions WHERE project_id = ?1",
        "DELETE FROM dev_goals WHERE project_id = ?1",
        "DELETE FROM dev_kpis WHERE project_id = ?1",
        "DELETE FROM dev_use_cases WHERE project_id = ?1",
        "DELETE FROM dev_milestones WHERE project_id = ?1",
        "DELETE FROM dev_ideas WHERE project_id = ?1",
        "DELETE FROM dev_contexts WHERE project_id = ?1",
        "DELETE FROM dev_context_group_relationships WHERE project_id = ?1",
        "DELETE FROM dev_context_groups WHERE project_id = ?1",
        "DELETE FROM dev_context_fingerprints WHERE project_id = ?1",
        "DELETE FROM dev_triage_rules WHERE project_id = ?1",
        "DELETE FROM dev_pipelines WHERE project_id = ?1",
        "DELETE FROM dev_standards WHERE project_id = ?1",
        "DELETE FROM dev_memories WHERE project_id = ?1",
        "DELETE FROM memory_nodes WHERE project_id = ?1",
    ];
    for sql in DELETES {
        tx.execute(sql, [project_id])?;
    }
    Ok(())
}

/// Import one bundled dev project (row + full child graph) under `mode`.
/// Returns `Some((target_project_id, final_root_path))` on success, `None`
/// when the project row itself could not be written (already warned).
#[allow(clippy::too_many_lines)]
fn import_dev_project_graph(
    tx: &rusqlite::Transaction<'_>,
    p: &DevProjectExport,
    mode: &ProjectImportMode,
    team_id: Option<String>,
    workspace_id: Option<String>,
    now: &str,
    warnings: &mut Vec<String>,
) -> Option<(String, String)> {
    let strict = matches!(mode, ProjectImportMode::Duplicate);

    // Old id → target id for every id-bearing child row. Identity in
    // fresh/replace modes (original uuids preserved), fresh uuids in
    // duplicate mode.
    let mut map: HashMap<String, String> = HashMap::new();
    {
        let mut add = |old: &String| {
            let new = if strict {
                uuid::Uuid::new_v4().to_string()
            } else {
                old.clone()
            };
            map.insert(old.clone(), new);
        };
        for r in &p.goals { add(&r.id); }
        for r in &p.goal_dependencies { add(&r.id); }
        for r in &p.goal_signals { add(&r.id); }
        for r in &p.goal_items { add(&r.id); }
        for r in &p.context_groups { add(&r.id); }
        for r in &p.contexts { add(&r.id); }
        for r in &p.context_group_relationships { add(&r.id); }
        for r in &p.ideas { add(&r.id); }
        for r in &p.tasks { add(&r.id); }
        for r in &p.competitions { add(&r.id); }
        for r in &p.competition_slots { add(&r.id); }
        for r in &p.triage_rules { add(&r.id); }
        for r in &p.pipelines { add(&r.id); }
        for r in &p.standards { add(&r.id); }
        for r in &p.use_cases { add(&r.id); }
        for r in &p.milestones { add(&r.id); }
        for r in &p.kpis { add(&r.id); }
        for r in &p.kpi_measurements { add(&r.id); }
        for r in &p.kpi_bindings { add(&r.id); }
        for r in &p.memories { add(&r.id); }
        for r in &p.memory_nodes { add(&r.id); }
    }

    // Project row.
    let (target_id, final_name, final_root_path) = match mode {
        ProjectImportMode::Fresh => (p.id.clone(), p.name.clone(), p.root_path.clone()),
        ProjectImportMode::Replace { existing_id } => {
            (existing_id.clone(), p.name.clone(), p.root_path.clone())
        }
        ProjectImportMode::Duplicate => {
            // Dodge the UNIQUE(root_path) constraint deterministically.
            let mut root = format!("{}-imported", p.root_path);
            let mut n = 2;
            while row_exists(tx, "SELECT 1 FROM dev_projects WHERE root_path = ?1", &root) {
                root = format!("{}-imported-{n}", p.root_path);
                n += 1;
            }
            (
                uuid::Uuid::new_v4().to_string(),
                format!("{} (imported)", p.name),
                root,
            )
        }
    };

    match mode {
        ProjectImportMode::Replace { existing_id } => {
            if let Err(e) = delete_project_children(tx, existing_id) {
                warnings.push(format!(
                    "Project '{}': failed to clear existing rows for replace: {e}",
                    p.name
                ));
                return None;
            }
            // root_path only follows the bundle when it doesn't collide with a
            // DIFFERENT project (UNIQUE column).
            let root_taken_by_other = tx
                .query_row(
                    "SELECT id FROM dev_projects WHERE root_path = ?1",
                    [p.root_path.as_str()],
                    |r| r.get::<_, String>(0),
                )
                .ok()
                .is_some_and(|id| id != *existing_id);
            let (root_for_update, effective_root) = if root_taken_by_other {
                warnings.push(format!(
                    "Project '{}': root path '{}' already belongs to another project; kept the existing path",
                    p.name, p.root_path
                ));
                let existing_root: String = tx
                    .query_row(
                        "SELECT root_path FROM dev_projects WHERE id = ?1",
                        [existing_id.as_str()],
                        |r| r.get(0),
                    )
                    .unwrap_or_else(|_| p.root_path.clone());
                (None::<String>, existing_root)
            } else {
                (Some(p.root_path.clone()), p.root_path.clone())
            };
            let ok = exec_row(
                tx,
                "UPDATE dev_projects SET name = ?1, root_path = COALESCE(?2, root_path), \
                     description = ?3, status = ?4, tech_stack = ?5, team_id = ?6, \
                     auto_pr_on_success = ?7, github_url = ?8, main_branch = ?9, \
                     test_env_url = ?10, test_env_branch = ?11, workspace_id = ?12, \
                     data_links = ?13, static_scan_config = ?14, standards_config = ?15, \
                     monitoring_project_slug = ?16, updated_at = ?17 \
                 WHERE id = ?18",
                rusqlite::params![
                    final_name,
                    root_for_update,
                    p.description,
                    p.status,
                    p.tech_stack,
                    team_id,
                    p.auto_pr_on_success,
                    p.github_url,
                    p.main_branch,
                    p.test_env_url,
                    p.test_env_branch,
                    workspace_id,
                    p.data_links,
                    p.static_scan_config,
                    p.standards_config,
                    p.monitoring_project_slug,
                    now,
                    existing_id,
                ],
                &format!("Project '{}' (replace)", p.name),
                warnings,
            );
            if !ok {
                return None;
            }
            // The children below re-insert under the surviving id; the
            // effective root path drives the folder warning + skills.
            insert_project_children(tx, p, &target_id, &map, strict, warnings);
            return Some((target_id, effective_root));
        }
        ProjectImportMode::Fresh | ProjectImportMode::Duplicate => {
            let ok = exec_row(
                tx,
                "INSERT INTO dev_projects \
                     (id, name, root_path, description, status, tech_stack, team_id, \
                      auto_pr_on_success, github_url, main_branch, test_env_url, \
                      test_env_branch, workspace_id, data_links, static_scan_config, \
                      standards_config, monitoring_project_slug, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
                rusqlite::params![
                    target_id,
                    final_name,
                    final_root_path,
                    p.description,
                    p.status,
                    p.tech_stack,
                    team_id,
                    p.auto_pr_on_success,
                    p.github_url,
                    p.main_branch,
                    p.test_env_url,
                    p.test_env_branch,
                    workspace_id,
                    p.data_links,
                    p.static_scan_config,
                    p.standards_config,
                    p.monitoring_project_slug,
                    p.created_at,
                    p.updated_at,
                ],
                &format!("Project '{}'", p.name),
                warnings,
            );
            if !ok {
                return None;
            }
        }
    }

    insert_project_children(tx, p, &target_id, &map, strict, warnings);
    Some((target_id, final_root_path))
}

/// Insert a bundled project's full child graph under `project_id`, remapping
/// ids through `map`. Ordered FK-safe (groups → contexts → use cases → KPIs →
/// goals → …); every row failure degrades to a warning.
#[allow(clippy::too_many_lines)]
fn insert_project_children(
    tx: &rusqlite::Transaction<'_>,
    p: &DevProjectExport,
    project_id: &str,
    map: &HashMap<String, String>,
    strict: bool,
    warnings: &mut Vec<String>,
) {
    let pname = p.name.as_str();

    for g in &p.context_groups {
        exec_row(
            tx,
            "INSERT INTO dev_context_groups (id, project_id, name, color, icon, group_type, \
                 position, health_score, last_scan_at, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                remap_req(map, &g.id), project_id, g.name, g.color, g.icon, g.group_type,
                g.position, g.health_score, g.last_scan_at, g.created_at, g.updated_at,
            ],
            &format!("Project '{pname}' context group '{}'", g.name),
            warnings,
        );
    }

    for c in &p.contexts {
        let group_id = remap_soft(map, &c.group_id, strict, warnings, &format!("Project '{pname}' context '{}'", c.name));
        exec_row(
            tx,
            "INSERT INTO dev_contexts (id, project_id, group_id, name, description, file_paths, \
                 entry_points, db_tables, keywords, api_surface, cross_refs, tech_stack, \
                 category, business_feature, pinned, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            rusqlite::params![
                remap_req(map, &c.id), project_id, group_id, c.name, c.description, c.file_paths,
                c.entry_points, c.db_tables, c.keywords, c.api_surface, c.cross_refs,
                c.tech_stack, c.category, c.business_feature, c.pinned, c.created_at, c.updated_at,
            ],
            &format!("Project '{pname}' context '{}'", c.name),
            warnings,
        );
    }

    for r in &p.context_group_relationships {
        exec_row(
            tx,
            "INSERT INTO dev_context_group_relationships (id, project_id, source_group_id, \
                 target_group_id, created_at) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                remap_req(map, &r.id), project_id,
                remap_req(map, &r.source_group_id), remap_req(map, &r.target_group_id),
                r.created_at,
            ],
            &format!("Project '{pname}' context group relationship"),
            warnings,
        );
    }

    for f in &p.context_fingerprints {
        exec_row(
            tx,
            "INSERT INTO dev_context_fingerprints (project_id, context_id, content_hash, \
                 file_count, missing_file_count, imports, primitives, promise_all_count, \
                 join_all_count, await_count, sql_write_count, spawn_count, use_effect_count, \
                 set_state_after_await_count, exports_components, exports_hooks, \
                 exports_commands, exports_repo_fns, computed_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            rusqlite::params![
                project_id, remap_req(map, &f.context_id), f.content_hash, f.file_count,
                f.missing_file_count, f.imports, f.primitives, f.promise_all_count,
                f.join_all_count, f.await_count, f.sql_write_count, f.spawn_count,
                f.use_effect_count, f.set_state_after_await_count, f.exports_components,
                f.exports_hooks, f.exports_commands, f.exports_repo_fns, f.computed_at,
            ],
            &format!("Project '{pname}' context fingerprint"),
            warnings,
        );
    }

    for uc in &p.use_cases {
        let primary = remap_soft(map, &uc.primary_context_id, strict, warnings, &format!("Project '{pname}' use case '{}'", uc.name));
        exec_row(
            tx,
            "INSERT INTO dev_use_cases (id, project_id, name, slug, description, kind, \
                 primary_context_id, status, created_by, pinned, rationale, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            rusqlite::params![
                remap_req(map, &uc.id), project_id, uc.name, uc.slug, uc.description, uc.kind,
                primary, uc.status, uc.created_by, uc.pinned, uc.rationale,
                uc.created_at, uc.updated_at,
            ],
            &format!("Project '{pname}' use case '{}'", uc.name),
            warnings,
        );
    }

    for k in &p.kpis {
        let ctx_group = remap_soft(map, &k.context_group_id, strict, warnings, &format!("Project '{pname}' KPI '{}'", k.name));
        let ctx = remap_soft(map, &k.context_id, strict, warnings, &format!("Project '{pname}' KPI '{}'", k.name));
        let uc = remap_soft(map, &k.use_case_id, strict, warnings, &format!("Project '{pname}' KPI '{}'", k.name));
        exec_row(
            tx,
            "INSERT INTO dev_kpis (id, project_id, context_group_id, context_id, use_case_id, \
                 name, description, category, measure_kind, measure_config, unit, direction, \
                 baseline_value, target_value, target_date, current_value, last_measured_at, \
                 cadence, status, created_by, rationale, needed_connector, metric_type, tier, \
                 warn_at, crit_at, manual_rating, assessment_pros, assessment_cons, \
                 last_skip_at, last_skip_rationale, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,\
                 ?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33)",
            rusqlite::params![
                remap_req(map, &k.id), project_id, ctx_group, ctx, uc,
                k.name, k.description, k.category, k.measure_kind, k.measure_config, k.unit,
                k.direction, k.baseline_value, k.target_value, k.target_date, k.current_value,
                k.last_measured_at, k.cadence, k.status, k.created_by, k.rationale,
                k.needed_connector, k.metric_type, k.tier, k.warn_at, k.crit_at,
                k.manual_rating, k.assessment_pros, k.assessment_cons, k.last_skip_at,
                k.last_skip_rationale, k.created_at, k.updated_at,
            ],
            &format!("Project '{pname}' KPI '{}'", k.name),
            warnings,
        );
    }

    for m in &p.kpi_measurements {
        exec_row(
            tx,
            "INSERT INTO dev_kpi_measurements (id, kpi_id, value, measured_at, source, env, \
                 evidence, note) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                remap_req(map, &m.id), remap_req(map, &m.kpi_id), m.value, m.measured_at,
                m.source, m.env, m.evidence, m.note,
            ],
            &format!("Project '{pname}' KPI measurement"),
            warnings,
        );
    }

    // credential_id never travels — bindings land without a vault reference
    // only if the column allows it; a NOT NULL constraint degrades to a
    // per-row warning (the binding is a convenience, not core data).
    for b in &p.kpi_bindings {
        exec_row(
            tx,
            "INSERT INTO dev_kpi_bindings (id, kpi_id, credential_id, service_type, procedure, \
                 composed_by, status, verified_at, created_at) \
             VALUES (?1,?2,'',?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                remap_req(map, &b.id), remap_req(map, &b.kpi_id), b.service_type, b.procedure,
                b.composed_by, b.status, b.verified_at, b.created_at,
            ],
            &format!("Project '{pname}' KPI binding"),
            warnings,
        );
    }

    // Goals: parent_goal_id is a self-FK — insert parents before children.
    // A stuck pass (cycle or dangling parent) degrades to parent = NULL.
    {
        let mut remaining: Vec<&DevGoalExport> = p.goals.iter().collect();
        let mut inserted: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let goal_ids: std::collections::HashSet<&str> =
            p.goals.iter().map(|g| g.id.as_str()).collect();
        loop {
            let before = remaining.len();
            let mut next = Vec::new();
            for g in remaining {
                let ready = g
                    .parent_goal_id
                    .as_deref()
                    .is_none_or(|pg| inserted.contains(pg) || !goal_ids.contains(pg));
                if !ready {
                    next.push(g);
                    continue;
                }
                let parent = remap_soft(map, &g.parent_goal_id, strict, warnings, &format!("Project '{pname}' goal '{}'", g.title));
                insert_goal_row(tx, project_id, g, map, parent, pname, warnings);
                inserted.insert(g.id.as_str());
            }
            if next.is_empty() {
                break;
            }
            if next.len() == before {
                for g in next {
                    warnings.push(format!(
                        "Project '{pname}' goal '{}': parent chain unresolvable; imported without parent",
                        g.title
                    ));
                    insert_goal_row(tx, project_id, g, map, None, pname, warnings);
                }
                break;
            }
            remaining = next;
        }
    }

    for d in &p.goal_dependencies {
        exec_row(
            tx,
            "INSERT INTO dev_goal_dependencies (id, goal_id, depends_on_id, dependency_type, created_at) \
             VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                remap_req(map, &d.id), remap_req(map, &d.goal_id),
                remap_req(map, &d.depends_on_id), d.dependency_type, d.created_at,
            ],
            &format!("Project '{pname}' goal dependency"),
            warnings,
        );
    }

    for s in &p.goal_signals {
        exec_row(
            tx,
            "INSERT INTO dev_goal_signals (id, goal_id, signal_type, source_id, delta, message, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                remap_req(map, &s.id), remap_req(map, &s.goal_id), s.signal_type,
                // source_id points outside the bundled graph (runs/scans) —
                // always kept as-is.
                s.source_id, s.delta, s.message, s.created_at,
            ],
            &format!("Project '{pname}' goal signal"),
            warnings,
        );
    }

    for i in &p.goal_items {
        exec_row(
            tx,
            "INSERT INTO dev_goal_items (id, goal_id, title, done, order_index, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                remap_req(map, &i.id), remap_req(map, &i.goal_id), i.title, i.done,
                i.order_index, i.created_at, i.updated_at,
            ],
            &format!("Project '{pname}' goal item"),
            warnings,
        );
    }

    for i in &p.ideas {
        let ctx = remap_soft(map, &i.context_id, strict, warnings, &format!("Project '{pname}' idea '{}'", i.title));
        let uc = remap_soft(map, &i.use_case_id, strict, warnings, &format!("Project '{pname}' idea '{}'", i.title));
        exec_row(
            tx,
            "INSERT INTO dev_ideas (id, project_id, context_id, scan_type, category, title, \
                 description, reasoning, status, effort, impact, risk, priority, provider, \
                 model, rejection_reason, origin, use_case_id, evidence, dedup_key, \
                 verify_state, verify_checked_at, verify_evidence, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,\
                 ?21,?22,?23,?24,?25)",
            rusqlite::params![
                remap_req(map, &i.id), project_id, ctx, i.scan_type, i.category, i.title,
                i.description, i.reasoning, i.status, i.effort, i.impact, i.risk, i.priority,
                i.provider, i.model, i.rejection_reason, i.origin, uc, i.evidence, i.dedup_key,
                i.verify_state, i.verify_checked_at, i.verify_evidence, i.created_at, i.updated_at,
            ],
            &format!("Project '{pname}' idea '{}'", i.title),
            warnings,
        );
    }

    for t in &p.tasks {
        let src_idea = remap_soft(map, &t.source_idea_id, strict, warnings, &format!("Project '{pname}' task '{}'", t.title));
        let goal = remap_soft(map, &t.goal_id, strict, warnings, &format!("Project '{pname}' task '{}'", t.title));
        let parent = remap_soft(map, &t.parent_task_id, strict, warnings, &format!("Project '{pname}' task '{}'", t.title));
        exec_row(
            tx,
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, \
                 status, session_id, progress_pct, output_lines, error, depth, parent_task_id, \
                 attempt, started_at, completed_at, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            rusqlite::params![
                remap_req(map, &t.id), project_id, t.title, t.description, src_idea, goal,
                t.status, t.session_id, t.progress_pct, t.output_lines, t.error, t.depth,
                parent, t.attempt, t.started_at, t.completed_at, t.created_at,
            ],
            &format!("Project '{pname}' task '{}'", t.title),
            warnings,
        );
    }

    for c in &p.competitions {
        let src_idea = remap_soft(map, &c.source_idea_id, strict, warnings, &format!("Project '{pname}' competition '{}'", c.task_title));
        let src_goal = remap_soft(map, &c.source_goal_id, strict, warnings, &format!("Project '{pname}' competition '{}'", c.task_title));
        let winner = remap_soft(map, &c.winner_task_id, strict, warnings, &format!("Project '{pname}' competition '{}'", c.task_title));
        exec_row(
            tx,
            "INSERT INTO dev_competitions (id, project_id, task_title, task_description, \
                 source_idea_id, source_goal_id, slot_count, status, winner_task_id, \
                 winner_insight, baseline_json, reviewer_notes, worktree_base_ref, created_at, \
                 resolved_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            rusqlite::params![
                remap_req(map, &c.id), project_id, c.task_title, c.task_description,
                src_idea, src_goal, c.slot_count, c.status, winner, c.winner_insight,
                c.baseline_json, c.reviewer_notes, c.worktree_base_ref, c.created_at, c.resolved_at,
            ],
            &format!("Project '{pname}' competition '{}'", c.task_title),
            warnings,
        );
    }

    for s in &p.competition_slots {
        exec_row(
            tx,
            "INSERT INTO dev_competition_slots (id, competition_id, task_id, strategy_label, \
                 strategy_prompt, worktree_name, branch_name, slot_index, disqualified, \
                 disqualify_reason, diff_hash, diff_stats_json, diff_analyzed_at, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            rusqlite::params![
                remap_req(map, &s.id), remap_req(map, &s.competition_id),
                remap_req(map, &s.task_id), s.strategy_label, s.strategy_prompt,
                s.worktree_name, s.branch_name, s.slot_index, s.disqualified,
                s.disqualify_reason, s.diff_hash, s.diff_stats_json, s.diff_analyzed_at,
                s.created_at,
            ],
            &format!("Project '{pname}' competition slot"),
            warnings,
        );
    }

    for r in &p.triage_rules {
        exec_row(
            tx,
            "INSERT INTO dev_triage_rules (id, project_id, name, conditions, action, enabled, \
                 times_fired, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                remap_req(map, &r.id), project_id, r.name, r.conditions, r.action, r.enabled,
                r.times_fired, r.created_at,
            ],
            &format!("Project '{pname}' triage rule '{}'", r.name),
            warnings,
        );
    }

    for pl in &p.pipelines {
        exec_row(
            tx,
            "INSERT INTO dev_pipelines (id, project_id, idea_id, task_id, stage, auto_execute, \
                 verify_after, verification_scan_id, error, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                remap_req(map, &pl.id), project_id, remap_req(map, &pl.idea_id),
                remap_soft(map, &pl.task_id, strict, warnings, &format!("Project '{pname}' pipeline")),
                pl.stage, pl.auto_execute, pl.verify_after,
                // Scans don't travel — verification_scan_id stays as-is.
                pl.verification_scan_id, pl.error, pl.created_at, pl.updated_at,
            ],
            &format!("Project '{pname}' pipeline"),
            warnings,
        );
    }

    for s in &p.standards {
        exec_row(
            tx,
            "INSERT INTO dev_standards (id, project_id, scan_id, rule_key, category, title, \
                 status, severity, evidence, recommendation, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                remap_req(map, &s.id), project_id,
                // Scans don't travel — scan_id stays as-is.
                s.scan_id, s.rule_key, s.category, s.title, s.status, s.severity,
                s.evidence, s.recommendation, s.created_at, s.updated_at,
            ],
            &format!("Project '{pname}' standard '{}'", s.rule_key),
            warnings,
        );
    }

    for ucc in &p.use_case_contexts {
        exec_row(
            tx,
            "INSERT OR IGNORE INTO dev_use_case_contexts (use_case_id, context_id) VALUES (?1,?2)",
            rusqlite::params![
                remap_req(map, &ucc.use_case_id), remap_req(map, &ucc.context_id),
            ],
            &format!("Project '{pname}' use case context pair"),
            warnings,
        );
    }

    for m in &p.milestones {
        exec_row(
            tx,
            "INSERT INTO dev_milestones (id, project_id, name, goal, status, order_index, \
                 target_date, cut_at, shipped_at, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                remap_req(map, &m.id), project_id, m.name, m.goal, m.status, m.order_index,
                m.target_date, m.cut_at, m.shipped_at, m.created_at, m.updated_at,
            ],
            &format!("Project '{pname}' milestone '{}'", m.name),
            warnings,
        );
    }

    for mi in &p.milestone_items {
        // item_id is polymorphic (use_case | goal) and NOT NULL: remap when
        // mappable, otherwise keep the original id (orphans are swept at read
        // time by design) with a warning in duplicate mode.
        let item_id = match map.get(&mi.item_id) {
            Some(n) => n.clone(),
            None => {
                if strict {
                    warnings.push(format!(
                        "Project '{pname}' milestone item ({} '{}'): unresolved reference kept as-is",
                        mi.item_kind, mi.item_id
                    ));
                }
                mi.item_id.clone()
            }
        };
        exec_row(
            tx,
            "INSERT OR IGNORE INTO dev_milestone_items (milestone_id, item_kind, item_id, \
                 bucket, added_after_cut, order_index, created_at, description, rating) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            rusqlite::params![
                remap_req(map, &mi.milestone_id), mi.item_kind, item_id, mi.bucket,
                mi.added_after_cut, mi.order_index, mi.created_at, mi.description, mi.rating,
            ],
            &format!("Project '{pname}' milestone item"),
            warnings,
        );
    }

    for m in &p.memories {
        exec_row(
            tx,
            "INSERT INTO dev_memories (id, project_id, category, title, content, importance, \
                 source_kind, source_id, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                remap_req(map, &m.id), project_id, m.category, m.title, m.content, m.importance,
                // source_id points at runs/tasks in the source workspace —
                // advisory, kept as-is.
                m.source_kind, m.source_id, m.created_at, m.updated_at,
            ],
            &format!("Project '{pname}' memory '{}'", m.title),
            warnings,
        );
    }

    for n in &p.memory_nodes {
        let ctx = remap_soft(map, &n.context_id, strict, warnings, &format!("Project '{pname}' memory node '{}'", n.title));
        exec_row(
            tx,
            "INSERT INTO memory_nodes (id, project_id, context_id, kind, title, body, source, \
                 status, content_hash, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                remap_req(map, &n.id), project_id, ctx, n.kind, n.title, n.body, n.source,
                n.status, n.content_hash, n.created_at, n.updated_at,
            ],
            &format!("Project '{pname}' memory node '{}'", n.title),
            warnings,
        );
    }

    for e in &p.memory_edges {
        exec_row(
            tx,
            "INSERT OR IGNORE INTO memory_edges (from_id, to_id, rel, created_at) VALUES (?1,?2,?3,?4)",
            rusqlite::params![
                remap_req(map, &e.from_id), remap_req(map, &e.to_id), e.rel, e.created_at,
            ],
            &format!("Project '{pname}' memory edge"),
            warnings,
        );
    }
}

fn insert_goal_row(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
    g: &DevGoalExport,
    map: &HashMap<String, String>,
    parent: Option<String>,
    pname: &str,
    warnings: &mut Vec<String>,
) {
    // context_id / kpi_id are soft TEXT columns (no FK): remap when possible,
    // keep as-is otherwise (identity modes) — the strict handling happened at
    // the call site for parent; these two follow remap_req-with-keep semantics
    // because they always ride inside the same bundle.
    let context_id = g.context_id.as_deref().map(|id| remap_req(map, id));
    let kpi_id = g.kpi_id.as_deref().map(|id| remap_req(map, id));
    exec_row(
        tx,
        "INSERT INTO dev_goals (id, project_id, parent_goal_id, context_id, kpi_id, order_index, \
             title, description, status, progress, target_date, started_at, completed_at, \
             created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        rusqlite::params![
            remap_req(map, &g.id), project_id, parent, context_id, kpi_id, g.order_index,
            g.title, g.description, g.status, g.progress, g.target_date, g.started_at,
            g.completed_at, g.created_at, g.updated_at,
        ],
        &format!("Project '{pname}' goal '{}'", g.title),
        warnings,
    );
}

/// Import workspaces + their knowledge libraries. Faithful: ALL statuses
/// (including `rejected`) and every lifecycle column travel. Target workspace
/// matched by id first, then name (case-insensitive); created with the
/// original uuid when absent. Entries dedup by `dedup_key` within the target
/// workspace; NULL-key rows dedup by (kind, title).
fn import_workspace_knowledge(
    tx: &rusqlite::Transaction<'_>,
    bundle: &PortabilityBundle,
    now: &str,
    result: &mut PortabilityImportResult,
    workspace_id_map: &mut HashMap<String, String>,
    knowledge_id_map: &mut HashMap<String, String>,
) {
    for ws in &bundle.workspace_knowledge {
        let target_ws: Option<String> = if row_exists(tx, "SELECT 1 FROM dev_workspaces WHERE id = ?1", &ws.id) {
            Some(ws.id.clone())
        } else if let Ok(id) = tx.query_row(
            "SELECT id FROM dev_workspaces WHERE name = ?1 COLLATE NOCASE",
            [ws.name.as_str()],
            |r| r.get::<_, String>(0),
        ) {
            Some(id)
        } else {
            match tx.execute(
                "INSERT INTO dev_workspaces (id, name, color, description, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?5)",
                rusqlite::params![ws.id, ws.name, ws.color, ws.description, now],
            ) {
                Ok(_) => Some(ws.id.clone()),
                Err(e) => {
                    result.warnings.push(format!("Workspace '{}': {e}", ws.name));
                    None
                }
            }
        };
        let Some(target_ws) = target_ws else { continue };
        workspace_id_map.insert(ws.id.clone(), target_ws.clone());

        for k in &ws.knowledge {
            // Same row already present (re-import / resolution pass).
            if row_exists(tx, "SELECT 1 FROM workspace_knowledge WHERE id = ?1", &k.id) {
                knowledge_id_map.insert(k.id.clone(), k.id.clone());
                result.knowledge_skipped_duplicates += 1;
                continue;
            }
            // Dedup within the target workspace.
            let existing: Option<String> = if let Some(dk) = &k.dedup_key {
                tx.query_row(
                    "SELECT id FROM workspace_knowledge WHERE workspace_id = ?1 AND dedup_key = ?2",
                    rusqlite::params![target_ws, dk],
                    |r| r.get(0),
                )
                .ok()
            } else {
                tx.query_row(
                    "SELECT id FROM workspace_knowledge WHERE workspace_id = ?1 AND kind = ?2 \
                         AND title = ?3 COLLATE NOCASE",
                    rusqlite::params![target_ws, k.kind, k.title],
                    |r| r.get(0),
                )
                .ok()
            };
            if let Some(existing_id) = existing {
                knowledge_id_map.insert(k.id.clone(), existing_id);
                result.knowledge_skipped_duplicates += 1;
                continue;
            }

            // origin_project_id / governing_id / superseded_by are advisory
            // soft refs — kept as exported whether or not they resolve here.
            match tx.execute(
                "INSERT INTO workspace_knowledge (id, workspace_id, kind, title, statement, \
                     detail_md, topic, abstraction, ftype, durability, governing_id, \
                     evidence_count, applicability, status, origin_project_id, provenance, \
                     confidence, dedup_key, superseded_by, harvest_scope, valid_from, valid_to, \
                     decided_at, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,\
                     ?20,?21,?22,?23,?24,?25)",
                rusqlite::params![
                    k.id, target_ws, k.kind, k.title, k.statement, k.detail_md, k.topic,
                    k.abstraction, k.ftype, k.durability, k.governing_id, k.evidence_count,
                    k.applicability, k.status, k.origin_project_id, k.provenance, k.confidence,
                    k.dedup_key, k.superseded_by, k.harvest_scope, k.valid_from, k.valid_to,
                    k.decided_at, k.created_at, k.updated_at,
                ],
            ) {
                Ok(_) => {
                    knowledge_id_map.insert(k.id.clone(), k.id.clone());
                    result.knowledge_imported += 1;
                }
                Err(e) => result
                    .warnings
                    .push(format!("Knowledge '{}': {e}", k.title)),
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Skills-to-disk (post-commit)
// ----------------------------------------------------------------------------

/// One safe path segment — same shape as the export-side skill-name guard.
fn is_safe_skill_segment(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains("..")
        && !s.contains(':')
}

/// A skill file's rel path: forward-slash separated safe segments, never
/// absolute, never escaping the skill directory, never the provenance sidecar.
fn is_safe_skill_rel_path(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.starts_with('/')
        && rel.split('/').all(is_safe_skill_segment)
        && rel.split('/').next_back() != Some(SKILL_PROVENANCE_FILE)
}

/// Hash a set of skill files exactly like the export side does (sorted
/// rel_path/content pairs, NUL-separated) so import can detect drift against
/// `SkillFileExport::content_hash`.
fn hash_skill_entries(files: &[SkillFileEntry]) -> String {
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    for f in files {
        hasher.update(f.rel_path.as_bytes());
        hasher.update([0u8]);
        hasher.update(f.content.as_bytes());
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())
}

/// Export-equivalent hash of an on-disk skill directory (None when missing or
/// empty). Used to decide whether a local skill differs from the incoming one.
fn hash_existing_skill_dir(dir: &std::path::Path) -> Option<String> {
    if !dir.is_dir() {
        return None;
    }
    let mut files = Vec::new();
    collect_skill_dir_files(dir, dir, &mut files);
    if files.is_empty() {
        return None;
    }
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Some(hash_skill_entries(&files))
}

/// Write a project's bundled skills under `<root_path>/.claude/skills/`.
/// `overwrite` is true only under the "replace" resolution; in every other
/// mode an existing skill with different content wins and the incoming copy
/// is skipped with a warning. A missing project folder defers the whole set.
fn write_project_skills(
    root_path: &str,
    skills: &[SkillFileExport],
    overwrite: bool,
    result: &mut PortabilityImportResult,
) {
    if skills.is_empty() {
        return;
    }
    let root = std::path::Path::new(root_path);
    if !root.is_dir() {
        result.skills_deferred += skills.len() as u32;
        result.warnings.push(format!(
            "Project folder '{}' not found; {} skill(s) were not written to disk (fix the path in Project Manager and re-import)",
            root_path,
            skills.len()
        ));
        return;
    }
    let skills_dir = root.join(".claude").join("skills");

    'skills: for skill in skills {
        if !is_safe_skill_segment(&skill.name) {
            result
                .warnings
                .push(format!("Skill '{}': unsafe name; skipped", skill.name));
            continue;
        }
        let files: Vec<&SkillFileEntry> = skill
            .files
            .iter()
            .filter(|f| {
                let ok = is_safe_skill_rel_path(&f.rel_path);
                if !ok {
                    result.warnings.push(format!(
                        "Skill '{}': unsafe file path '{}'; file skipped",
                        skill.name, f.rel_path
                    ));
                }
                ok
            })
            .collect();
        if files.is_empty() {
            continue;
        }

        let single_file =
            files.len() == 1 && files[0].rel_path == format!("{}.md", skill.name);

        if single_file {
            let target = skills_dir.join(format!("{}.md", skill.name));
            let existing = read_skill_file(&target);
            let differs = target.exists() && existing.as_deref() != Some(files[0].content.as_str());
            if target.exists() && !differs {
                continue; // identical — nothing to do
            }
            if differs && !overwrite {
                result.warnings.push(format!(
                    "Skill '{}': a local copy with different content exists; incoming copy skipped",
                    skill.name
                ));
                continue;
            }
            if let Err(e) = std::fs::create_dir_all(&skills_dir)
                .and_then(|()| std::fs::write(&target, files[0].content.as_bytes()))
            {
                result
                    .warnings
                    .push(format!("Skill '{}': write failed: {e}", skill.name));
                continue;
            }
            if differs {
                result.warnings.push(format!(
                    "Skill '{}': local copy overwritten (replace)",
                    skill.name
                ));
            }
            result.skills_written += 1;
            continue;
        }

        // Directory-form skill.
        let target_dir = skills_dir.join(&skill.name);
        let existing_hash = hash_existing_skill_dir(&target_dir);
        let differs = existing_hash
            .as_deref()
            .is_some_and(|h| h != skill.content_hash);
        if existing_hash.is_some() && !differs {
            continue; // identical — nothing to do
        }
        if differs && !overwrite {
            result.warnings.push(format!(
                "Skill '{}': a local copy with different content exists; incoming copy skipped",
                skill.name
            ));
            continue;
        }
        for f in &files {
            let mut target = target_dir.clone();
            for seg in f.rel_path.split('/') {
                target.push(seg);
            }
            let write = target
                .parent()
                .map_or(Ok(()), std::fs::create_dir_all)
                .and_then(|()| std::fs::write(&target, f.content.as_bytes()));
            if let Err(e) = write {
                result.warnings.push(format!(
                    "Skill '{}' file '{}': write failed: {e}",
                    skill.name, f.rel_path
                ));
                continue 'skills;
            }
        }
        if differs {
            result.warnings.push(format!(
                "Skill '{}': local copy overwritten (replace)",
                skill.name
            ));
        }

        // Provenance sidecar — same JSON shape as skill_files::write_provenance,
        // with source_kind "bundle", NO absolute source path, and a hash
        // recomputed over the just-written directory.
        let content_hash =
            crate::commands::infrastructure::skill_files::hash_skill_dir(&target_dir)
                .unwrap_or_default();
        let prov = serde_json::json!({
            "source_kind": "bundle",
            "source_project_id": null,
            "source_path": "",
            "content_hash": content_hash,
            "installed_at": chrono::Utc::now().to_rfc3339(),
        });
        if let Err(e) = std::fs::write(
            target_dir.join(SKILL_PROVENANCE_FILE),
            serde_json::to_string_pretty(&prov).unwrap_or_default(),
        ) {
            result.warnings.push(format!(
                "Skill '{}': provenance sidecar write failed: {e}",
                skill.name
            ));
        }
        result.skills_written += 1;
    }
}

/// Parse competitive workflow file and return previews.
fn parse_competitive_workflow(content: &str) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| AppError::Validation(format!("Invalid JSON: {e}")))?;

    // Detect platform from structure
    if is_n8n_workflow(&value) {
        return parse_n8n_preview(&value);
    }
    if is_zapier_workflow(&value) {
        return parse_zapier_preview(&value);
    }
    if is_make_workflow(&value) {
        return parse_make_preview(&value);
    }

    Err(AppError::Validation(
        "Unrecognized workflow format. Supported: n8n, Zapier, Make/Integromat".into(),
    ))
}

fn is_n8n_workflow(v: &serde_json::Value) -> bool {
    v.get("nodes").is_some() && v.get("connections").is_some()
}

fn is_zapier_workflow(v: &serde_json::Value) -> bool {
    // Zapier exports have "steps" array and often a "title" field
    v.get("steps").is_some_and(|s| s.is_array()) && v.get("title").is_some()
}

fn is_make_workflow(v: &serde_json::Value) -> bool {
    // Make/Integromat exports have "modules" array
    v.get("modules").is_some_and(|s| s.is_array()) || v.get("scenario").is_some()
}

fn parse_n8n_preview(v: &serde_json::Value) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled n8n Workflow")
        .to_string();

    let nodes = v
        .get("nodes")
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();

    let tools: Vec<String> = nodes
        .iter()
        .filter_map(|n| n.get("type").and_then(|t| t.as_str()))
        .filter(|t| !t.starts_with("n8n-nodes-base."))
        .map(|t| t.to_string())
        .collect();

    let triggers: Vec<String> = nodes
        .iter()
        .filter_map(|n| {
            let node_type = n.get("type")?.as_str()?;
            if node_type.contains("Trigger") || node_type.contains("trigger") {
                Some(node_type.to_string())
            } else {
                None
            }
        })
        .collect();

    let desc = format!(
        "n8n workflow with {} nodes. Use the n8n Transform wizard for full AI-assisted conversion.",
        nodes.len()
    );

    Ok(vec![CompetitiveImportPreview {
        source_platform: "n8n".into(),
        workflow_name: name,
        description: desc,
        suggested_tools: tools,
        suggested_triggers: triggers,
    }])
}

fn parse_zapier_preview(v: &serde_json::Value) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let name = v
        .get("title")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled Zap")
        .to_string();

    let steps = v
        .get("steps")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    let apps: Vec<String> = steps
        .iter()
        .filter_map(|s| s.get("app").and_then(|a| a.as_str()).map(|a| a.to_string()))
        .collect();

    let triggers: Vec<String> = steps
        .first()
        .and_then(|s| s.get("action"))
        .and_then(|a| a.as_str())
        .map(|a| vec![a.to_string()])
        .unwrap_or_default();

    let desc = format!(
        "Zapier Zap with {} steps connecting: {}",
        steps.len(),
        apps.join(", ")
    );

    Ok(vec![CompetitiveImportPreview {
        source_platform: "zapier".into(),
        workflow_name: name,
        description: desc,
        suggested_tools: apps,
        suggested_triggers: triggers,
    }])
}

fn parse_make_preview(v: &serde_json::Value) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let scenario = v.get("scenario").unwrap_or(v);
    let name = scenario
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled Make Scenario")
        .to_string();

    let modules = scenario
        .get("modules")
        .or_else(|| v.get("modules"))
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();

    let tools: Vec<String> = modules
        .iter()
        .filter_map(|m| {
            m.get("module")
                .and_then(|a| a.as_str())
                .map(|a| a.to_string())
        })
        .collect();

    let desc = format!(
        "Make scenario with {} modules: {}",
        modules.len(),
        tools.join(", ")
    );

    Ok(vec![CompetitiveImportPreview {
        source_platform: "make".into(),
        workflow_name: name,
        description: desc,
        suggested_tools: tools,
        suggested_triggers: vec![],
    }])
}

// ============================================================================
// Unified credential encryption helpers (shared by export_full / export_selective)
// ============================================================================

/// Build an encrypted `CredentialExportEnvelope` for embedding in a portability bundle.
/// When `filter_ids` is Some, only credentials matching those IDs are included.
/// When None, all credentials are included.
fn build_encrypted_credentials(
    pool: &DbPool,
    passphrase: &str,
    filter_ids: Option<&Vec<String>>,
) -> Result<CredentialExportEnvelope, AppError> {
    let all_creds = cred_repo::get_all(pool)?;

    let mut entries = Vec::new();
    for cred in &all_creds {
        if let Some(ids) = filter_ids {
            if !ids.contains(&cred.id) {
                continue;
            }
        }

        let fields = cred_repo::get_decrypted_fields(pool, cred).unwrap_or_default();
        if let Err(e) = audit_log::log_decrypt(
            pool,
            &cred.id,
            &cred.name,
            "data_portability:unified_export",
            None,
            None,
        ) {
            tracing::warn!(
                credential_id = %cred.id,
                error = %e,
                "Failed to write audit log for credential decrypt"
            );
        }
        entries.push(CredentialExportEntry {
            name: cred.name.clone(),
            service_type: cred.service_type.clone(),
            metadata: cred.metadata.clone(),
            fields,
        });
    }

    let bundle = CredentialExportBundle {
        format_version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        credentials: entries,
    };

    let plaintext = serde_json::to_vec(&bundle)
        .map_err(|e| AppError::Internal(format!("Serialization failed: {e}")))?;

    // Generate random salt and nonce
    use aes_gcm::aead::rand_core::RngCore;
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| AppError::Internal(format!("Encryption failed: {e}")))?;

    Ok(CredentialExportEnvelope {
        format: CREDENTIAL_EXPORT_FORMAT.into(),
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    })
}

/// Decrypt embedded credentials from a portability bundle and write the fields
/// to the matching imported credential shells.
/// Returns `(applied, unmatched_names)` — the count of credentials whose
/// secrets were successfully applied, and the names of any entries that had
/// no matching imported shell (e.g. Phase 3 skipped creating one because a
/// same-name credential already existed) so the caller can surface an
/// explicit warning instead of the failure being invisible.
fn apply_encrypted_credentials(
    pool: &DbPool,
    envelope: &CredentialExportEnvelope,
    passphrase: &str,
    _credential_metas: &[CredentialMetaExport],
) -> Result<(u32, Vec<String>), AppError> {
    if envelope.format != CREDENTIAL_EXPORT_FORMAT {
        return Err(AppError::Validation(format!(
            "Unsupported embedded credential format: {} (expected {})",
            envelope.format, CREDENTIAL_EXPORT_FORMAT
        )));
    }

    let salt = B64
        .decode(&envelope.salt)
        .map_err(|e| AppError::Validation(format!("Invalid salt: {e}")))?;
    let nonce_bytes = B64
        .decode(&envelope.nonce)
        .map_err(|e| AppError::Validation(format!("Invalid nonce: {e}")))?;
    let ciphertext = B64
        .decode(&envelope.ciphertext)
        .map_err(|e| AppError::Validation(format!("Invalid ciphertext: {e}")))?;

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
        AppError::Validation("Decryption failed -- wrong passphrase or corrupted data".into())
    })?;

    let cred_bundle: CredentialExportBundle = serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Validation(format!("Invalid inner credential data: {e}")))?;

    // Find matching imported credential shells by name + service_type
    // The import_bundle creates credentials with " (imported)" suffix
    let existing = cred_repo::get_all(pool).unwrap_or_default();

    let mut applied = 0u32;
    let mut unmatched: Vec<String> = Vec::new();
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    for entry in &cred_bundle.credentials {
        // The imported credential shell has name "{name} (imported)" and same service_type
        let imported_name = format!("{} (imported)", entry.name);
        let matching_cred = existing
            .iter()
            .find(|c| c.name == imported_name && c.service_type == entry.service_type);

        let Some(cred) = matching_cred else {
            unmatched.push(entry.name.clone());
            continue;
        };

        // Derive field sensitivity from connector schema
        let sens_map = cred_repo::sensitivity_map_for_connector(pool, &entry.service_type);

        for (key, value) in &entry.fields {
            let is_sensitive = cred_repo::is_field_sensitive(sens_map.as_ref(), key);
            let (enc_val, field_iv) = crypto::encrypt_field(value, is_sensitive)
                .map_err(|e| AppError::Internal(format!("Field encryption failed: {}", e)))?;

            let field_type = classify_field_type(key);
            let field_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            // Insert or replace (the shell may have empty fields from import_bundle)
            tx.execute(
                "INSERT OR REPLACE INTO credential_fields
                 (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                rusqlite::params![
                    field_id,
                    cred.id,
                    key,
                    enc_val,
                    field_iv,
                    field_type,
                    is_sensitive as i32,
                    now,
                ],
            )?;
        }

        applied += 1;
    }

    tx.commit().map_err(AppError::Database)?;
    Ok((applied, unmatched))
}

// ============================================================================
// Encrypted credential export / import (standalone)
// ============================================================================

const PBKDF2_ITERATIONS: u32 = 600_000;
const CREDENTIAL_EXPORT_FORMAT: &str = "personas_credentials_v1";

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialExportBundle {
    pub format_version: u32,
    pub exported_at: String,
    pub credentials: Vec<CredentialExportEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialExportEntry {
    pub name: String,
    pub service_type: String,
    pub metadata: Option<String>,
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialExportEnvelope {
    pub format: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CredentialImportResult {
    pub created: u32,
    pub skipped: u32,
    pub replaced: u32,
    pub warnings: Vec<String>,
    /// Non-empty when conflicts detected — frontend should show resolution UI
    pub conflicts: Vec<CredentialConflict>,
    /// Path of the selected file — returned so the frontend can pass it back for resolution
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export)]
pub struct CredentialConflict {
    pub name: String,
    pub service_type: String,
    pub existing_id: String,
}

/// Derive a 32-byte key from a passphrase using PBKDF2-HMAC-SHA256.
fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

/// Export all credential secrets to a password-protected encrypted file.
#[tauri::command]
#[requires(privileged)]
pub async fn export_credentials(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: String,
) -> Result<bool, AppError> {

    if passphrase.len() < 8 {
        return Err(AppError::Validation(
            "Passphrase must be at least 8 characters".into(),
        ));
    }

    let pool = &state.db;
    let all_creds = cred_repo::get_all(pool)?;

    // Collect built-in connector names so we can skip their credentials
    let builtin_names: std::collections::HashSet<String> = connector_repo::get_all(pool)
        .unwrap_or_default()
        .into_iter()
        .filter(|c| c.is_builtin)
        .map(|c| c.name.to_lowercase())
        .collect();

    let mut entries = Vec::with_capacity(all_creds.len());
    for cred in &all_creds {
        // Skip credentials belonging to built-in connectors
        if builtin_names.contains(&cred.service_type.to_lowercase()) {
            continue;
        }
        let fields = cred_repo::get_decrypted_fields(pool, cred).unwrap_or_default();
        if let Err(e) = audit_log::log_decrypt(
            pool,
            &cred.id,
            &cred.name,
            "data_portability:export",
            None,
            None,
        ) {
            tracing::warn!(credential_id = %cred.id, error = %e, "Failed to write audit log for credential decrypt");
        }
        entries.push(CredentialExportEntry {
            name: cred.name.clone(),
            service_type: cred.service_type.clone(),
            metadata: cred.metadata.clone(),
            fields,
        });
    }

    let bundle = CredentialExportBundle {
        format_version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        credentials: entries,
    };

    let plaintext = serde_json::to_vec(&bundle)
        .map_err(|e| AppError::Internal(format!("Serialization failed: {e}")))?;

    // Generate random salt and nonce
    use aes_gcm::aead::rand_core::RngCore;
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(&passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| AppError::Internal(format!("Encryption failed: {e}")))?;

    let envelope = CredentialExportEnvelope {
        format: CREDENTIAL_EXPORT_FORMAT.into(),
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    };

    let envelope_json = serde_json::to_string_pretty(&envelope)
        .map_err(|e| AppError::Internal(format!("Envelope serialization failed: {e}")))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let file_name = format!("personas_credentials_{}.cred.enc", timestamp);
    let app_clone = app.clone();

    let save_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("Encrypted Credentials", &["enc"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    if let Some(file_path) = save_path {
        let path = file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;
        tokio::fs::write(&path, envelope_json)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;
        return Ok(true);
    }

    Ok(false)
}

/// Import credentials from a password-protected encrypted file.
#[tauri::command]
#[requires(privileged)]
pub async fn import_credentials(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: String,
    resolutions_json: Option<String>,
    file_path_override: Option<String>,
) -> Result<Option<CredentialImportResult>, AppError> {

    let path = if let Some(override_path) = file_path_override {
        std::path::PathBuf::from(override_path)
    } else {
        let app_clone = app.clone();
        let file_path = tokio::task::spawn_blocking(move || {
            app_clone
                .dialog()
                .file()
                .add_filter("Encrypted Credentials", &["enc"])
                .blocking_pick_file()
        })
        .await
        .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

        let Some(file_path) = file_path else {
            return Ok(None);
        };

        file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?
    };

    // Cap the file size before read_to_string so a multi-GB pick (accidental
    // or socially engineered) cannot OOM the process. Mirrors the guard in
    // `import_persona`, with a tighter ceiling because credential bundles
    // are tiny (JSON envelope + base64 ciphertext).
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file metadata: {e}")))?;
    if metadata.len() > MAX_CREDENTIAL_IMPORT_BYTES {
        return Err(AppError::Validation(format!(
            "Credential import file too large ({:.1} MB). Maximum is {} MB.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_CREDENTIAL_IMPORT_BYTES / (1024 * 1024)
        )));
    }

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?;

    let envelope: CredentialExportEnvelope = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Invalid credential export file: {e}")))?;

    if envelope.format != CREDENTIAL_EXPORT_FORMAT {
        return Err(AppError::Validation(format!(
            "Unsupported format: {} (expected {})",
            envelope.format, CREDENTIAL_EXPORT_FORMAT
        )));
    }

    let salt = B64
        .decode(&envelope.salt)
        .map_err(|e| AppError::Validation(format!("Invalid salt: {e}")))?;
    let nonce_bytes = B64
        .decode(&envelope.nonce)
        .map_err(|e| AppError::Validation(format!("Invalid nonce: {e}")))?;
    let ciphertext = B64
        .decode(&envelope.ciphertext)
        .map_err(|e| AppError::Validation(format!("Invalid ciphertext: {e}")))?;

    let key = derive_key(&passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
        AppError::Validation("Decryption failed -- wrong passphrase or corrupted file".into())
    })?;

    let bundle: CredentialExportBundle = serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Validation(format!("Invalid inner data: {e}")))?;

    let pool = &state.db;

    // Parse resolutions from frontend (second pass after conflict detection)
    let resolutions: std::collections::HashMap<String, String> = resolutions_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let has_resolutions = !resolutions.is_empty();

    // Load existing credentials for conflict detection
    let existing = cred_repo::get_all(pool).unwrap_or_default();
    let existing_names: std::collections::HashMap<String, String> = existing
        .iter()
        .map(|c| (c.name.to_lowercase(), c.id.clone()))
        .collect();

    let path_str = path.to_string_lossy().to_string();

    let mut result = CredentialImportResult {
        created: 0,
        skipped: 0,
        replaced: 0,
        warnings: Vec::new(),
        conflicts: Vec::new(),
        file_path: None,
    };

    // First pass: if conflicts exist and no resolutions provided, return conflicts for UI
    if !has_resolutions {
        for entry in &bundle.credentials {
            let conflict_key = entry.name.to_lowercase();
            if existing_names.contains_key(&conflict_key) {
                result.conflicts.push(CredentialConflict {
                    name: entry.name.clone(),
                    service_type: entry.service_type.clone(),
                    existing_id: existing_names
                        .get(&conflict_key)
                        .cloned()
                        .unwrap_or_default(),
                });
            }
        }
        if !result.conflicts.is_empty() {
            // Include file path so frontend can re-use it for resolution pass
            result.file_path = Some(path_str);
            return Ok(Some(result));
        }
    }

    // Wrap the entire import in a single transaction so that a failed create
    // after a delete does not permanently lose the original credential.
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    use crate::db::repos::resources::credentials as cred_repo;

    for entry in &bundle.credentials {
        let conflict_key = entry.name.to_lowercase();

        // Determine action based on resolution
        let resolution = resolutions.get(&entry.name);
        match resolution.map(|s| s.as_str()) {
            Some("skip") => {
                result.skipped += 1;
                continue;
            }
            Some("replace") => {
                // Delete existing credential and dependents within the transaction
                if let Some(existing_id) = existing_names.get(&conflict_key) {
                    tx.execute(
                        "DELETE FROM credential_fields WHERE credential_id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                    tx.execute(
                        "DELETE FROM credential_rotation_history WHERE credential_id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                    tx.execute(
                        "DELETE FROM credential_rotation_policies WHERE credential_id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                    tx.execute(
                        "DELETE FROM credential_events WHERE credential_id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                    tx.execute(
                        "DELETE FROM persona_credentials WHERE id = ?1",
                        rusqlite::params![existing_id],
                    )?;
                }
                result.replaced += 1;
            }
            Some("keep_both") => {
                // Import with "(imported)" suffix — fall through to create with modified name
            }
            _ => {
                // No conflict or no resolution needed — use original name
            }
        }

        let final_name = if resolution == Some(&"keep_both".to_string()) {
            format!("{} (imported)", entry.name)
        } else {
            entry.name.clone()
        };

        let cred_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Insert credential row within the transaction
        match tx.execute(
            "INSERT INTO persona_credentials
             (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            rusqlite::params![
                cred_id,
                final_name,
                entry.service_type,
                "",
                "",
                entry.metadata,
                now,
            ],
        ) {
            Ok(_) => {}
            Err(e) => {
                // Roll back the entire transaction on failure
                return Err(AppError::Internal(format!(
                    "Credential '{}': insert failed: {}",
                    entry.name, e
                )));
            }
        }

        // Derive field sensitivity from connector schema
        let sens_map = cred_repo::sensitivity_map_for_connector(pool, &entry.service_type);

        // Insert encrypted fields within the same transaction
        for (key, value) in &entry.fields {
            let is_sensitive = cred_repo::is_field_sensitive(sens_map.as_ref(), key);
            let (enc_val, field_iv) = crypto::encrypt_field(value, is_sensitive)
                .map_err(|e| AppError::Internal(format!("Field encryption failed: {}", e)))?;

            let field_type = classify_field_type(key);
            let field_id = uuid::Uuid::new_v4().to_string();

            tx.execute(
                "INSERT INTO credential_fields
                 (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                rusqlite::params![
                    field_id,
                    cred_id,
                    key,
                    enc_val,
                    field_iv,
                    field_type,
                    is_sensitive as i32,
                    now,
                ],
            )?;
        }

        result.created += 1;
    }

    tx.commit().map_err(AppError::Database)?;
    Ok(Some(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    fn empty_bundle() -> PortabilityBundle {
        PortabilityBundle {
            format_version: 2,
            exported_at: "2026-05-28T00:00:00Z".into(),
            app_version: "test".into(),
            scope: ExportScope::Full,
            personas: Vec::new(),
            tool_definitions: Vec::new(),
            teams: Vec::new(),
            credentials: Vec::new(),
            kpis: Vec::new(),
            dev_projects: Vec::new(),
            workspace_knowledge: Vec::new(),
            encrypted_credentials: None,
        }
    }

    fn team_with_memories(memories: Vec<TeamMemoryExport>) -> TeamExport {
        TeamExport {
            id: "old-team-1".into(),
            name: "Squad".into(),
            description: None,
            canvas_data: None,
            team_config: None,
            icon: None,
            members: Vec::new(),
            connections: Vec::new(),
            memories,
        }
    }

    #[test]
    fn import_bundle_recreates_team_memories_under_new_team_id() {
        let pool = init_test_db().unwrap();
        let mut bundle = empty_bundle();
        bundle.teams.push(team_with_memories(vec![
            TeamMemoryExport {
                title: "Pricing rule".into(),
                content: "Always round up".into(),
                category: "decision".into(),
                importance: 7,
                tags: Some("manual".into()),
            },
            TeamMemoryExport {
                title: "Customer note".into(),
                content: "VIP threshold $1k".into(),
                category: "observation".into(),
                importance: 4,
                tags: None,
            },
        ]));

        let result = import_bundle(&pool, &bundle, &HashMap::new()).expect("import must succeed");
        assert_eq!(result.teams_created, 1);
        assert_eq!(result.team_memories_created, 2);

        let new_team_id = result
            .id_mapping
            .get("old-team-1")
            .expect("team id should be remapped");
        let count =
            team_memory_repo::get_total_count(&pool, new_team_id, None, None, None).unwrap();
        assert_eq!(count, 2);

        let rows =
            team_memory_repo::get_all(&pool, new_team_id, None, None, None, Some(50), Some(0))
                .unwrap();
        // Provenance is intentionally nulled — imported memories are manual.
        assert!(rows
            .iter()
            .all(|m| m.run_id.is_none() && m.member_id.is_none() && m.persona_id.is_none()));
        assert!(rows.iter().any(|m| m.importance == 7));
    }

    #[test]
    fn import_bundle_with_empty_team_memories_creates_none() {
        let pool = init_test_db().unwrap();
        let mut bundle = empty_bundle();
        bundle.teams.push(team_with_memories(Vec::new()));

        let result = import_bundle(&pool, &bundle, &HashMap::new()).expect("import must succeed");
        assert_eq!(result.teams_created, 1);
        assert_eq!(result.team_memories_created, 0);
    }

    #[test]
    fn validate_bundle_rejects_too_many_team_memories() {
        let mut bundle = empty_bundle();
        let memories = (0..=MAX_TEAM_MEMORIES_PER_TEAM)
            .map(|i| TeamMemoryExport {
                title: format!("m{i}"),
                content: "c".into(),
                category: "observation".into(),
                importance: 3,
                tags: None,
            })
            .collect();
        bundle.teams.push(team_with_memories(memories));
        assert!(validate_bundle(&bundle).is_err());
    }

    #[test]
    fn validate_bundle_rejects_empty_team_memory_title() {
        let mut bundle = empty_bundle();
        bundle.teams.push(team_with_memories(vec![TeamMemoryExport {
            title: "   ".into(),
            content: "c".into(),
            category: "observation".into(),
            importance: 3,
            tags: None,
        }]));
        assert!(validate_bundle(&bundle).is_err());
    }

    #[test]
    fn portable_team_memory_tags_strips_revision_history() {
        let with_revisions =
            Some(r#"{"source":"auto","revisions":[{"title":"old"}]}"#.to_string());
        assert_eq!(portable_team_memory_tags(&with_revisions), Some("auto".into()));

        let empty_source = Some(r#"{"source":"","revisions":[]}"#.to_string());
        assert_eq!(portable_team_memory_tags(&empty_source), None);

        let plain = Some("manual".to_string());
        assert_eq!(portable_team_memory_tags(&plain), Some("manual".into()));

        assert_eq!(portable_team_memory_tags(&None), None);
    }

    fn kpi_export(name: &str, measurements: Vec<KpiMeasurementExport>) -> KpiExport {
        KpiExport {
            name: name.into(),
            description: Some("desc".into()),
            category: "quality".into(),
            measure_kind: "manual".into(),
            measure_config: "{}".into(),
            unit: "pct".into(),
            direction: "up".into(),
            baseline_value: Some(10.0),
            target_value: Some(90.0),
            target_date: None,
            cadence: "weekly".into(),
            status: "active".into(),
            tier: "primary".into(),
            rationale: Some("why".into()),
            needed_connector: None,
            metric_type: None,
            warn_at: Some(40.0),
            crit_at: Some(20.0),
            measurements,
        }
    }

    #[test]
    fn import_bundle_lands_kpis_paused_in_imported_project_with_history() {
        let pool = init_test_db().unwrap();
        let mut bundle = empty_bundle();
        // Measurements are exported newest-first; the head seeds current state.
        bundle.kpis.push(kpi_export(
            "Coverage",
            vec![
                KpiMeasurementExport {
                    value: 72.0,
                    measured_at: "2026-06-19T10:00:00Z".into(),
                    source: "manual".into(),
                    evidence: None,
                    note: None,
                },
                KpiMeasurementExport {
                    value: 65.0,
                    measured_at: "2026-06-12T10:00:00Z".into(),
                    source: "evaluator".into(),
                    evidence: None,
                    note: None,
                },
            ],
        ));

        let result = import_bundle(&pool, &bundle, &HashMap::new()).expect("import must succeed");
        assert_eq!(result.kpis_created, 1);

        let conn = pool.get().unwrap();
        let project_id: String = conn
            .query_row("SELECT id FROM dev_projects WHERE name = 'Imported'", [], |r| {
                r.get(0)
            })
            .expect("dedicated Imported project should exist");

        let kpis = dev_tools_repo::list_kpis(&pool, &project_id, None).unwrap();
        assert_eq!(kpis.len(), 1);
        let k = &kpis[0];
        assert_eq!(k.name, "Coverage");
        // Always dormant on import, regardless of the source 'active' status.
        assert_eq!(k.status, "paused");
        assert_eq!(k.tier, "primary");
        assert_eq!(k.warn_at, Some(40.0));
        assert_eq!(k.crit_at, Some(20.0));
        // Newest measurement seeds current_value/last_measured_at.
        assert_eq!(k.current_value, Some(72.0));
        assert_eq!(k.last_measured_at.as_deref(), Some("2026-06-19T10:00:00Z"));

        let measurements = dev_tools_repo::list_kpi_measurements(&pool, &k.id, Some(100)).unwrap();
        assert_eq!(measurements.len(), 2);
    }

    #[test]
    fn import_bundle_dedups_kpis_by_name_on_reimport() {
        let pool = init_test_db().unwrap();
        let mut bundle = empty_bundle();
        bundle.kpis.push(kpi_export("Coverage", Vec::new()));

        assert_eq!(import_bundle(&pool, &bundle, &HashMap::new()).unwrap().kpis_created, 1);
        // Second import reuses the Imported project and skips the duplicate.
        assert_eq!(import_bundle(&pool, &bundle, &HashMap::new()).unwrap().kpis_created, 0);

        let conn = pool.get().unwrap();
        let kpi_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM dev_kpis", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kpi_count, 1);
        let project_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dev_projects WHERE name = 'Imported'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(project_count, 1);
    }

    #[test]
    fn validate_bundle_rejects_too_many_kpi_measurements() {
        let mut bundle = empty_bundle();
        let measurements = (0..=MAX_KPI_MEASUREMENTS)
            .map(|i| KpiMeasurementExport {
                value: i as f64,
                measured_at: "2026-06-19T10:00:00Z".into(),
                source: "manual".into(),
                evidence: None,
                note: None,
            })
            .collect();
        bundle.kpis.push(kpi_export("Coverage", measurements));
        assert!(validate_bundle(&bundle).is_err());
    }

    // ------------------------------------------------------------------
    // Dev-tools export (WP1 — export side)
    // ------------------------------------------------------------------

    /// Insert a dev project row with every credential-id column populated so
    /// the stripping assertion below has something real to strip.
    fn seed_dev_project(pool: &DbPool, id: &str, root_path: &str) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, description, status, tech_stack, \
                 team_id, auto_pr_on_success, github_url, \
                 main_branch, monitoring_credential_id, llm_tracking_credential_id, \
                 support_credential_id, pr_credential_id, monitoring_project_slug) \
             VALUES (?1, ?2, ?3, 'a project', 'paused', 'rust+react', 'team-x', 1, \
                 'https://github.com/x/y', 'main', \
                 'cred-mon', 'cred-llm', 'cred-sup', 'cred-pr', 'proj-slug')",
            rusqlite::params![id, format!("Project {id}"), root_path],
        )
        .unwrap();
    }

    fn seed_dev_project_graph(pool: &DbPool, pid: &str) {
        let conn = pool.get().unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO dev_goals (id, project_id, title, status) VALUES ('g1-{pid}', '{pid}', 'Goal one', 'open');
             INSERT INTO dev_goals (id, project_id, title, status) VALUES ('g2-{pid}', '{pid}', 'Goal two', 'open');
             INSERT INTO dev_goal_dependencies (id, goal_id, depends_on_id) VALUES ('gd1-{pid}', 'g2-{pid}', 'g1-{pid}');
             INSERT INTO dev_goal_items (id, goal_id, title, done) VALUES ('gi1-{pid}', 'g1-{pid}', 'todo', 1);
             INSERT INTO dev_context_groups (id, project_id, name) VALUES ('cg1-{pid}', '{pid}', 'Core');
             INSERT INTO dev_contexts (id, project_id, group_id, name, file_paths) VALUES ('c1-{pid}', '{pid}', 'cg1-{pid}', 'Auth', '[\"src/a.ts\"]');
             INSERT INTO dev_ideas (id, project_id, context_id, scan_type, title, status) VALUES ('i1-{pid}', '{pid}', 'c1-{pid}', 'feature', 'An idea', 'pending');
             INSERT INTO dev_tasks (id, project_id, title, status) VALUES ('t1-{pid}', '{pid}', 'A task', 'queued');
             INSERT INTO dev_use_cases (id, project_id, name, slug) VALUES ('uc1-{pid}', '{pid}', 'Login', 'login');
             INSERT INTO dev_use_case_contexts (use_case_id, context_id) VALUES ('uc1-{pid}', 'c1-{pid}');
             INSERT INTO dev_milestones (id, project_id, name, status) VALUES ('m1-{pid}', '{pid}', 'M1', 'active');
             INSERT INTO dev_milestone_items (milestone_id, item_kind, item_id, description, rating) VALUES ('m1-{pid}', 'use_case', 'uc1-{pid}', 'why it is core', 4);
             INSERT INTO dev_kpis (id, project_id, name, status) VALUES ('k1-{pid}', '{pid}', 'Coverage', 'active');
             INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env) VALUES ('km1-{pid}', 'k1-{pid}', 42.0, 'manual', 'local');
             INSERT INTO dev_kpi_bindings (id, kpi_id, credential_id, service_type, procedure) VALUES ('kb1-{pid}', 'k1-{pid}', 'cred-bind', 'sentry', 'count errors');
             INSERT INTO dev_memories (id, project_id, title, content) VALUES ('dm1-{pid}', '{pid}', 'Learned', 'a fact');
             INSERT INTO memory_nodes (id, project_id, title) VALUES ('n1-{pid}', '{pid}', 'Node one');
             INSERT INTO memory_nodes (id, project_id, title) VALUES ('n2-{pid}', '{pid}', 'Node two');
             INSERT INTO memory_edges (from_id, to_id, rel) VALUES ('n1-{pid}', 'n2-{pid}', 'relates');"
        ))
        .unwrap();
    }

    fn seed_workspace_with_knowledge(pool: &DbPool, wid: &str) {
        let conn = pool.get().unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO dev_workspaces (id, name, color, created_at, updated_at)
                VALUES ('{wid}', 'Shared WS', '#fff', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO workspace_knowledge (id, workspace_id, kind, title, statement, status, dedup_key, confidence, created_at, updated_at)
                VALUES ('kn-obs-{wid}', '{wid}', 'pattern', 'Observed one', 'Do X', 'observed', 'dk1', 0.7, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO workspace_knowledge (id, workspace_id, kind, title, statement, status, created_at, updated_at)
                VALUES ('kn-ado-{wid}', '{wid}', 'pitfall', 'Adopted one', 'Never Y', 'adopted', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO workspace_knowledge (id, workspace_id, kind, title, statement, status, created_at, updated_at)
                VALUES ('kn-rej-{wid}', '{wid}', 'fact', 'Rejected one', 'Z is true', 'rejected', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
        ))
        .unwrap();
    }

    #[test]
    fn export_full_includes_dev_project_graph_and_skills() {
        let pool = init_test_db().unwrap();

        // Real skills dir: a directory skill (SKILL.md + provenance sidecar +
        // an oversize file, both of which must NOT travel) and a single-file
        // skill.
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join(".claude").join("skills").join("foo");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Foo skill\nbody").unwrap();
        std::fs::write(skill_dir.join(SKILL_PROVENANCE_FILE), "{\"local\":true}").unwrap();
        std::fs::write(skill_dir.join("huge.md"), "a".repeat(300 * 1024)).unwrap();
        std::fs::write(
            tmp.path().join(".claude").join("skills").join("bar.md"),
            "# Bar skill",
        )
        .unwrap();

        seed_dev_project(&pool, "p1", &tmp.path().to_string_lossy());
        seed_dev_project_graph(&pool, "p1");

        let bundle = build_export_bundle(&pool, ExportScope::Full, true, true).unwrap();
        assert_eq!(bundle.dev_projects.len(), 1);
        let p = &bundle.dev_projects[0];
        assert_eq!(p.id, "p1");
        assert_eq!(p.monitoring_project_slug.as_deref(), Some("proj-slug"));
        assert_eq!(p.status, "paused");
        assert_eq!(p.tech_stack.as_deref(), Some("rust+react"));
        assert_eq!(p.team_id.as_deref(), Some("team-x"));
        assert!(p.auto_pr_on_success);
        assert_eq!(p.goals.len(), 2);
        assert_eq!(p.goal_dependencies.len(), 1);
        assert_eq!(p.goal_items.len(), 1);
        assert!(p.goal_items[0].done);
        assert_eq!(p.context_groups.len(), 1);
        assert_eq!(p.contexts.len(), 1);
        assert_eq!(p.ideas.len(), 1);
        assert_eq!(p.tasks.len(), 1);
        assert_eq!(p.use_cases.len(), 1);
        assert_eq!(p.use_case_contexts.len(), 1);
        assert_eq!(p.milestones.len(), 1);
        assert_eq!(p.milestone_items.len(), 1);
        assert_eq!(p.kpis.len(), 1);
        assert_eq!(p.kpi_measurements.len(), 1);
        assert_eq!(p.kpi_bindings.len(), 1);
        assert_eq!(p.memories.len(), 1);
        assert_eq!(p.memory_nodes.len(), 2);
        assert_eq!(p.memory_edges.len(), 1);

        // Skills: sorted by name; provenance sidecar + oversize file skipped.
        assert_eq!(p.skills.len(), 2);
        assert_eq!(p.skills[0].name, "bar");
        assert_eq!(p.skills[1].name, "foo");
        let foo = &p.skills[1];
        assert_eq!(foo.files.len(), 1);
        assert_eq!(foo.files[0].rel_path, "SKILL.md");
        assert!(!foo.content_hash.is_empty());

        // Credential ids never travel — neither the project's four columns
        // nor the KPI binding's vault reference.
        let json = serde_json::to_string(&bundle).unwrap();
        assert!(!json.contains("cred-mon"));
        assert!(!json.contains("cred-llm"));
        assert!(!json.contains("cred-sup"));
        assert!(!json.contains("cred-pr"));
        assert!(!json.contains("cred-bind"));
        assert!(!json.contains("credential_id"));

        // Round-trip: the bundle re-parses with the dev sections intact, and
        // a legacy bundle without them still deserializes (serde defaults).
        let reparsed: PortabilityBundle = serde_json::from_str(&json).unwrap();
        assert_eq!(reparsed.dev_projects.len(), 1);
        assert_eq!(reparsed.dev_projects[0].kpi_bindings.len(), 1);
        assert_eq!(reparsed.dev_projects[0].status, "paused");
        assert_eq!(reparsed.dev_projects[0].tech_stack.as_deref(), Some("rust+react"));
        assert_eq!(reparsed.dev_projects[0].team_id.as_deref(), Some("team-x"));
        assert!(reparsed.dev_projects[0].auto_pr_on_success);
        let legacy: PortabilityBundle = serde_json::from_str(
            r#"{"format_version":2,"exported_at":"x","app_version":"x","scope":"full",
                "personas":[],"tool_definitions":[],"teams":[],"credentials":[]}"#,
        )
        .unwrap();
        assert!(legacy.dev_projects.is_empty());
        assert!(legacy.workspace_knowledge.is_empty());
    }

    #[test]
    fn export_selective_scopes_dev_projects_and_workspaces() {
        let pool = init_test_db().unwrap();
        seed_dev_project(&pool, "p1", "/tmp/portability-p1");
        seed_dev_project(&pool, "p2", "/tmp/portability-p2");
        seed_workspace_with_knowledge(&pool, "w1");

        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: vec!["p1".into()],
            workspace_ids: Vec::new(),
        };
        let bundle = build_export_bundle(&pool, scope, true, true).unwrap();
        assert_eq!(bundle.dev_projects.len(), 1);
        assert_eq!(bundle.dev_projects[0].id, "p1");
        // Empty workspace selection means none travel.
        assert!(bundle.workspace_knowledge.is_empty());

        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: Vec::new(),
            workspace_ids: vec!["w1".into()],
        };
        let bundle = build_export_bundle(&pool, scope, true, true).unwrap();
        assert!(bundle.dev_projects.is_empty());
        assert_eq!(bundle.workspace_knowledge.len(), 1);
        assert_eq!(bundle.workspace_knowledge[0].id, "w1");
    }

    #[test]
    fn workspace_knowledge_keeps_statuses_and_filters_adoption_to_bundled_projects() {
        let pool = init_test_db().unwrap();
        seed_dev_project(&pool, "p1", "/tmp/portability-wp1");
        seed_dev_project(&pool, "p2", "/tmp/portability-wp2");
        seed_workspace_with_knowledge(&pool, "w1");
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO workspace_practice_adoption (practice_id, project_id, state, note, updated_at)
                    VALUES ('kn-ado-w1', 'p1', 'adopted', 'in use', '2026-01-01T00:00:00Z');
                 INSERT INTO workspace_practice_adoption (practice_id, project_id, state, updated_at)
                    VALUES ('kn-ado-w1', 'p2', 'proposed', '2026-01-01T00:00:00Z');",
            )
            .unwrap();
        }

        // Only p1 travels — the p2 adoption cell must be filtered out.
        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: vec!["p1".into()],
            workspace_ids: vec!["w1".into()],
        };
        let bundle = build_export_bundle(&pool, scope, true, true).unwrap();
        assert_eq!(bundle.workspace_knowledge.len(), 1);
        let w = &bundle.workspace_knowledge[0];
        assert_eq!(w.knowledge.len(), 3);
        let statuses: std::collections::HashSet<&str> =
            w.knowledge.iter().map(|k| k.status.as_str()).collect();
        assert_eq!(
            statuses,
            ["observed", "adopted", "rejected"].into_iter().collect()
        );
        // Lifecycle columns survive.
        let observed = w.knowledge.iter().find(|k| k.status == "observed").unwrap();
        assert_eq!(observed.dedup_key.as_deref(), Some("dk1"));
        assert_eq!(observed.confidence, Some(0.7));

        assert_eq!(w.adoption.len(), 1);
        assert_eq!(w.adoption[0].project_id, "p1");
        assert_eq!(w.adoption[0].state, "adopted");
        assert_eq!(w.adoption[0].note.as_deref(), Some("in use"));
    }

    #[test]
    fn compute_export_stats_counts_dev_projects_and_knowledge() {
        let pool = init_test_db().unwrap();
        seed_dev_project(&pool, "p1", "/tmp/portability-sp1");
        seed_dev_project(&pool, "p2", "/tmp/portability-sp2");
        seed_workspace_with_knowledge(&pool, "w1");

        let stats = compute_export_stats(&pool).unwrap();
        assert_eq!(stats.dev_project_count, 2);
        assert_eq!(stats.workspace_knowledge_count, 3);
    }

    fn minimal_dev_project(id: &str) -> DevProjectExport {
        DevProjectExport {
            id: id.into(),
            name: format!("P {id}"),
            root_path: format!("/tmp/{id}"),
            description: None,
            status: "active".into(),
            tech_stack: None,
            team_id: None,
            auto_pr_on_success: false,
            github_url: None,
            main_branch: None,
            test_env_url: None,
            test_env_branch: None,
            workspace_id: None,
            data_links: None,
            static_scan_config: None,
            standards_config: None,
            monitoring_project_slug: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            goals: Vec::new(),
            goal_dependencies: Vec::new(),
            goal_signals: Vec::new(),
            goal_items: Vec::new(),
            context_groups: Vec::new(),
            contexts: Vec::new(),
            context_group_relationships: Vec::new(),
            context_fingerprints: Vec::new(),
            ideas: Vec::new(),
            tasks: Vec::new(),
            competitions: Vec::new(),
            competition_slots: Vec::new(),
            triage_rules: Vec::new(),
            pipelines: Vec::new(),
            standards: Vec::new(),
            use_cases: Vec::new(),
            use_case_contexts: Vec::new(),
            milestones: Vec::new(),
            milestone_items: Vec::new(),
            kpis: Vec::new(),
            kpi_measurements: Vec::new(),
            kpi_bindings: Vec::new(),
            memories: Vec::new(),
            memory_nodes: Vec::new(),
            memory_edges: Vec::new(),
            skills: Vec::new(),
        }
    }

    #[test]
    fn validate_bundle_rejects_too_many_dev_projects() {
        let mut bundle = empty_bundle();
        for i in 0..=MAX_DEV_PROJECTS {
            bundle.dev_projects.push(minimal_dev_project(&format!("p{i}")));
        }
        assert!(validate_bundle(&bundle).is_err());
    }

    // ------------------------------------------------------------------
    // Dev-tools import (WP2 — import side)
    // ------------------------------------------------------------------

    fn empty_import_result() -> PortabilityImportResult {
        PortabilityImportResult {
            personas_created: 0,
            teams_created: 0,
            tools_created: 0,
            credentials_created: 0,
            team_memories_created: 0,
            kpis_created: 0,
            projects_imported: 0,
            projects_skipped: 0,
            knowledge_imported: 0,
            knowledge_skipped_duplicates: 0,
            skills_written: 0,
            skills_deferred: 0,
            project_conflicts: Vec::new(),
            bundle_file_path: None,
            warnings: Vec::new(),
            id_mapping: HashMap::new(),
        }
    }

    /// Export a seeded source DB (project graph + workspace + adoption) into a
    /// bundle for the import tests.
    fn source_bundle(root_path: &str) -> PortabilityBundle {
        let source = init_test_db().unwrap();
        seed_dev_project(&source, "p1", root_path);
        seed_dev_project_graph(&source, "p1");
        seed_workspace_with_knowledge(&source, "w1");
        {
            let conn = source.get().unwrap();
            conn.execute_batch(
                "INSERT INTO workspace_practice_adoption (practice_id, project_id, state, note, updated_at)
                    VALUES ('kn-ado-w1', 'p1', 'adopted', 'in use', '2026-01-01T00:00:00Z');",
            )
            .unwrap();
        }
        build_export_bundle(&source, ExportScope::Full, true, true).unwrap()
    }

    #[test]
    fn import_bundle_round_trips_projects_and_knowledge_with_original_uuids() {
        let bundle = source_bundle("/tmp/portability-rt-p1");
        let target = init_test_db().unwrap();

        let result = import_bundle(&target, &bundle, &HashMap::new()).expect("import");
        assert_eq!(result.projects_imported, 1);
        assert!(result.project_conflicts.is_empty());
        assert_eq!(result.projects_skipped, 0);
        assert_eq!(result.knowledge_imported, 3);
        assert_eq!(result.knowledge_skipped_duplicates, 0);

        let conn = target.get().unwrap();
        // Original uuids preserved across the graph.
        let pid: String = conn
            .query_row("SELECT project_id FROM dev_goals WHERE id = 'g1-p1'", [], |r| r.get(0))
            .expect("goal with original uuid");
        assert_eq!(pid, "p1");
        let goal_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM dev_goals WHERE project_id = 'p1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(goal_count, 2);
        let item_id: String = conn
            .query_row(
                "SELECT item_id FROM dev_milestone_items WHERE milestone_id = 'm1-p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(item_id, "uc1-p1");
        // A column the export SELECT forgets is silently dropped from every
        // bundle, so assert the annotations survived the whole trip.
        let (desc, rating): (Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT description, rating FROM dev_milestone_items WHERE milestone_id = 'm1-p1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(desc.as_deref(), Some("why it is core"));
        assert_eq!(rating, Some(4), "milestone item rating round-trips");
        let edge_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM memory_edges WHERE from_id = 'n1-p1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(edge_count, 1);
        // The stripped vault ref lands as an empty placeholder.
        let cred: String = conn
            .query_row("SELECT credential_id FROM dev_kpi_bindings WHERE id = 'kb1-p1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cred, "");
        // team-x does not exist in the target — nulled with a warning.
        let team: Option<String> = conn
            .query_row("SELECT team_id FROM dev_projects WHERE id = 'p1'", [], |r| r.get(0))
            .unwrap();
        assert!(team.is_none());
        assert!(result.warnings.iter().any(|w| w.contains("team not found")));
        // Folder does not exist on this machine — advisory warning, never a failure.
        assert!(result.warnings.iter().any(|w| w.contains("Project Manager")));

        // Knowledge statuses survive faithfully, including rejected.
        let rejected: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspace_knowledge WHERE status = 'rejected'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rejected, 1);
        // Adoption cell landed because both the practice and project exist.
        let adoption: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspace_practice_adoption WHERE practice_id = 'kn-ado-w1' AND project_id = 'p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(adoption, 1);
    }

    #[test]
    fn reimport_returns_conflicts_then_skip_resolution_imports_nothing() {
        let bundle = source_bundle("/tmp/portability-cf-p1");
        let target = init_test_db().unwrap();
        import_bundle(&target, &bundle, &HashMap::new()).unwrap();

        // Pass 1 again: the project now conflicts by root_path and is NOT imported.
        let second = import_bundle(&target, &bundle, &HashMap::new()).unwrap();
        assert_eq!(second.projects_imported, 0);
        assert_eq!(second.project_conflicts.len(), 1);
        let c = &second.project_conflicts[0];
        assert_eq!(c.bundle_project_id, "p1");
        assert_eq!(c.existing_project_id, "p1");
        assert_eq!(c.matched_by, "root_path");
        // Re-run of the knowledge phase skipped everything as duplicates.
        assert_eq!(second.knowledge_imported, 0);
        assert_eq!(second.knowledge_skipped_duplicates, 3);

        // Pass 2 with skip: nothing imported, nothing duplicated.
        let mut res = HashMap::new();
        res.insert("p1".to_string(), "skip".to_string());
        let third = import_bundle(&target, &bundle, &res).unwrap();
        assert_eq!(third.projects_skipped, 1);
        assert_eq!(third.projects_imported, 0);

        let conn = target.get().unwrap();
        let projects: i32 = conn
            .query_row("SELECT COUNT(*) FROM dev_projects WHERE id = 'p1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(projects, 1);
        let goals: i32 = conn
            .query_row("SELECT COUNT(*) FROM dev_goals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(goals, 2);
    }

    #[test]
    fn replace_resolution_keeps_id_replaces_children_and_spares_telemetry() {
        let bundle = source_bundle("/tmp/portability-rp-p1");
        let target = init_test_db().unwrap();
        import_bundle(&target, &bundle, &HashMap::new()).unwrap();

        {
            let conn = target.get().unwrap();
            // Telemetry row (not a covered family) must survive the replace.
            conn.execute(
                "INSERT INTO dev_scans (id, project_id, scan_type) VALUES ('scan1', 'p1', 'feature')",
                [],
            )
            .unwrap();
            // Local drift the replace must undo…
            conn.execute("UPDATE dev_goals SET title = 'mutated' WHERE id = 'g1-p1'", [])
                .unwrap();
            // …and a local extra child the replace must clear.
            conn.execute(
                "INSERT INTO dev_goals (id, project_id, title, status) VALUES ('local-extra', 'p1', 'local', 'open')",
                [],
            )
            .unwrap();
        }

        let mut res = HashMap::new();
        res.insert("p1".to_string(), "replace".to_string());
        let result = import_bundle(&target, &bundle, &res).unwrap();
        assert_eq!(result.projects_imported, 1);
        assert!(result.project_conflicts.is_empty());

        let conn = target.get().unwrap();
        // Project id is stable, children carry their original uuids again.
        let title: String = conn
            .query_row("SELECT title FROM dev_goals WHERE id = 'g1-p1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Goal one");
        let extra: i32 = conn
            .query_row("SELECT COUNT(*) FROM dev_goals WHERE id = 'local-extra'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(extra, 0);
        let scans: i32 = conn
            .query_row("SELECT COUNT(*) FROM dev_scans WHERE id = 'scan1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(scans, 1);
        let goals: i32 = conn
            .query_row("SELECT COUNT(*) FROM dev_goals WHERE project_id = 'p1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(goals, 2);
    }

    #[test]
    fn duplicate_resolution_remaps_milestone_items_and_task_parent_chains() {
        let mut bundle = source_bundle("/tmp/portability-dup-p1");
        // A child task so the parent chain remap is observable.
        bundle.dev_projects[0].tasks.push(DevTaskExport {
            id: "t2-p1".into(),
            title: "Child task".into(),
            description: None,
            source_idea_id: None,
            goal_id: None,
            status: "queued".into(),
            session_id: None,
            progress_pct: None,
            output_lines: None,
            error: None,
            depth: "quick".into(),
            parent_task_id: Some("t1-p1".into()),
            attempt: 2,
            started_at: None,
            completed_at: None,
            created_at: "2026-01-01T00:00:00Z".into(),
        });

        let target = init_test_db().unwrap();
        import_bundle(&target, &bundle, &HashMap::new()).unwrap();

        let mut res = HashMap::new();
        res.insert("p1".to_string(), "duplicate".to_string());
        let result = import_bundle(&target, &bundle, &res).unwrap();
        assert_eq!(result.projects_imported, 1);

        let conn = target.get().unwrap();
        let (new_pid, new_name, new_root): (String, String, String) = conn
            .query_row(
                "SELECT id, name, root_path FROM dev_projects WHERE id != 'p1' AND name LIKE '%(imported)'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("duplicated project");
        assert_ne!(new_pid, "p1");
        assert_eq!(new_name, "Project p1 (imported)");
        assert!(new_root.starts_with("/tmp/portability-dup-p1-imported"));

        // Every child got a fresh uuid.
        let old_id_children: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dev_goals WHERE project_id = ?1 AND id LIKE '%-p1'",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old_id_children, 0);

        // Milestone item (kind use_case) points at the duplicated use case.
        let new_uc: String = conn
            .query_row(
                "SELECT id FROM dev_use_cases WHERE project_id = ?1",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(new_uc, "uc1-p1");
        let item_id: String = conn
            .query_row(
                "SELECT mi.item_id FROM dev_milestone_items mi \
                 JOIN dev_milestones m ON m.id = mi.milestone_id WHERE m.project_id = ?1",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(item_id, new_uc);

        // Task parent chain remapped onto the duplicated parent.
        let new_parent: String = conn
            .query_row(
                "SELECT id FROM dev_tasks WHERE project_id = ?1 AND title = 'A task'",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(new_parent, "t1-p1");
        let child_parent: Option<String> = conn
            .query_row(
                "SELECT parent_task_id FROM dev_tasks WHERE project_id = ?1 AND title = 'Child task'",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(child_parent.as_deref(), Some(new_parent.as_str()));
    }

    #[test]
    fn knowledge_dedups_by_dedup_key_and_kind_title_across_fresh_ids() {
        let bundle = source_bundle("/tmp/portability-kn-p1");
        let target = init_test_db().unwrap();
        let first = import_bundle(&target, &bundle, &HashMap::new()).unwrap();
        assert_eq!(first.knowledge_imported, 3);

        // Same entries under FRESH ids: dedup_key catches dk1, (kind, title)
        // catches the NULL-key rows.
        let mut rekeyed = source_bundle("/tmp/portability-kn2-p1");
        for k in &mut rekeyed.workspace_knowledge[0].knowledge {
            k.id = format!("fresh-{}", k.id);
        }
        rekeyed.dev_projects.clear();
        let second = import_bundle(&target, &rekeyed, &HashMap::new()).unwrap();
        assert_eq!(second.knowledge_imported, 0);
        assert_eq!(second.knowledge_skipped_duplicates, 3);

        let conn = target.get().unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM workspace_knowledge", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn adoption_cells_skip_pairs_whose_project_is_absent() {
        let mut bundle = source_bundle("/tmp/portability-ad-p1");
        // The adoption cell references p1 — which never lands because the
        // projects section is emptied out.
        bundle.dev_projects.clear();
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, &bundle, &HashMap::new()).unwrap();
        assert_eq!(result.knowledge_imported, 3);

        let conn = target.get().unwrap();
        let adoption: i32 = conn
            .query_row("SELECT COUNT(*) FROM workspace_practice_adoption", [], |r| r.get(0))
            .unwrap();
        assert_eq!(adoption, 0);
    }

    #[test]
    fn skills_written_to_existing_root_and_deferred_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_string_lossy().to_string();

        let dir_files = vec![
            SkillFileEntry {
                rel_path: "SKILL.md".into(),
                content: "# Foo skill".into(),
            },
            SkillFileEntry {
                rel_path: "references/notes.md".into(),
                content: "notes".into(),
            },
        ];
        let single = vec![SkillFileEntry {
            rel_path: "bar.md".into(),
            content: "# Bar".into(),
        }];
        let evil = vec![SkillFileEntry {
            rel_path: "../escape.md".into(),
            content: "nope".into(),
        }];

        let mut bundle = empty_bundle();
        let mut p = minimal_dev_project("ps1");
        p.root_path = root.clone();
        p.skills = vec![
            SkillFileExport {
                name: "foo".into(),
                content_hash: hash_skill_entries(&dir_files),
                files: dir_files,
            },
            SkillFileExport {
                name: "bar".into(),
                content_hash: hash_skill_entries(&single),
                files: single,
            },
            SkillFileExport {
                name: "evil".into(),
                content_hash: hash_skill_entries(&evil),
                files: evil,
            },
        ];
        let mut p2 = minimal_dev_project("ps2");
        p2.root_path = format!("{root}/definitely/missing/subdir");
        p2.skills = vec![SkillFileExport {
            name: "lonely".into(),
            content_hash: "x".into(),
            files: vec![SkillFileEntry {
                rel_path: "SKILL.md".into(),
                content: "body".into(),
            }],
        }];
        bundle.dev_projects = vec![p, p2];

        let target = init_test_db().unwrap();
        let result = import_bundle(&target, &bundle, &HashMap::new()).unwrap();
        assert_eq!(result.projects_imported, 2);
        assert_eq!(result.skills_written, 2, "warnings: {:?}", result.warnings);
        assert_eq!(result.skills_deferred, 1);
        assert!(result
            .warnings
            .iter()
            .any(|w| w.contains("unsafe file path")));

        let skills = tmp.path().join(".claude").join("skills");
        assert_eq!(
            std::fs::read_to_string(skills.join("foo").join("SKILL.md")).unwrap(),
            "# Foo skill"
        );
        assert_eq!(
            std::fs::read_to_string(skills.join("foo").join("references").join("notes.md")).unwrap(),
            "notes"
        );
        assert_eq!(std::fs::read_to_string(skills.join("bar.md")).unwrap(), "# Bar");
        // Provenance sidecar: bundle-kind, no absolute source path, real hash.
        let prov =
            std::fs::read_to_string(skills.join("foo").join(SKILL_PROVENANCE_FILE)).unwrap();
        let prov: serde_json::Value = serde_json::from_str(&prov).unwrap();
        assert_eq!(prov["source_kind"], "bundle");
        assert_eq!(prov["source_path"], "");
        assert!(!prov["content_hash"].as_str().unwrap().is_empty());
        // The escape attempt never materialized anywhere.
        assert!(!tmp.path().join("escape.md").exists());
        assert!(!skills.join("evil").exists());
    }

    #[test]
    fn write_project_skills_respects_local_divergence_unless_replacing() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        let foo_dir = tmp.path().join(".claude").join("skills").join("foo");
        std::fs::create_dir_all(&foo_dir).unwrap();
        std::fs::write(foo_dir.join("SKILL.md"), "local content").unwrap();

        let files = vec![SkillFileEntry {
            rel_path: "SKILL.md".into(),
            content: "incoming content".into(),
        }];
        let skill = SkillFileExport {
            name: "foo".into(),
            content_hash: hash_skill_entries(&files),
            files,
        };

        // Non-replace: the local copy wins.
        let mut result = empty_import_result();
        write_project_skills(&root, std::slice::from_ref(&skill), false, &mut result);
        assert_eq!(result.skills_written, 0);
        assert!(result.warnings.iter().any(|w| w.contains("incoming copy skipped")));
        assert_eq!(
            std::fs::read_to_string(foo_dir.join("SKILL.md")).unwrap(),
            "local content"
        );

        // Replace: overwritten, with a warning saying so.
        let mut result = empty_import_result();
        write_project_skills(&root, std::slice::from_ref(&skill), true, &mut result);
        assert_eq!(result.skills_written, 1);
        assert!(result.warnings.iter().any(|w| w.contains("overwritten")));
        assert_eq!(
            std::fs::read_to_string(foo_dir.join("SKILL.md")).unwrap(),
            "incoming content"
        );
        assert!(foo_dir.join(SKILL_PROVENANCE_FILE).exists());
    }
}
