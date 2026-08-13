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

use crate::commands::infrastructure::skill_files;
use crate::db::credential_fields::classify_field_type;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::dev_tools as dev_tools_repo;
use crate::engine::persona_icon::export_safe_icon;
use crate::db::repos::core::{
    memories as memory_repo, personas as persona_repo, settings as settings_repo,
};
use crate::db::repos::execution::test_suites as suite_repo;
use crate::db::repos::resources::{
    audit_log, connectors as connector_repo, credentials as cred_repo,
    team_memories as team_memory_repo, teams as team_repo, tools as tool_repo,
    triggers as trigger_repo,
};
use crate::db::{DbPool, UserDbPool};
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

// Twin plugin caps. A twin's history is the bulkiest thing in a bundle (a
// year of chat traffic is tens of thousands of rows), so every one of these
// truncates with an explicit warning rather than silently — see
// `push_truncation_warning`.
const MAX_TWINS: usize = 10;
const MAX_TWIN_COMMUNICATIONS: usize = 5000;
const MAX_TWIN_MEMORIES: usize = 5000;
const MAX_TWIN_FACTS: usize = 2000;
const MAX_TWIN_CONTACTS: usize = 1000;
const MAX_TWIN_REFLECTIONS: usize = 500;
const MAX_TWIN_TONES: usize = 50;
const MAX_TWIN_CHANNELS: usize = 50;
/// Text-tier knowledge-base caps. Vectors NEVER travel — the target rebuilds
/// them with its own embedding model via `kb_reindex`.
const MAX_KB_DOCUMENTS: usize = 500;
const MAX_KB_CHUNKS: usize = 10_000;

// Athena (companion brain) caps. There is exactly one Athena per install, so
// unlike the twin caps these are absolute ceilings rather than per-entity ones.
// Every one of them truncates through `push_truncation_warning`.
const MAX_ATHENA_FACTS: usize = 2000;
const MAX_ATHENA_PROCEDURALS: usize = 1000;
const MAX_ATHENA_GOALS: usize = 500;
const MAX_ATHENA_BACKLOG: usize = 500;
const MAX_ATHENA_RITUALS: usize = 200;
const MAX_ATHENA_DECISIONS: usize = 2000;
/// Conversation-roster cap. The roster is titles and flags only — no
/// transcripts, no `claude_session_id` — so the rows are tiny, but an
/// unbounded list is still an unbounded list.
const MAX_ATHENA_SESSIONS: usize = 500;
/// Ceiling on ONE memory's markdown body. A fact or ritual note past a quarter
/// of a megabyte is a pasted log, not a memory; it is dropped by name rather
/// than truncated mid-sentence, because half a memory is worse than none.
const MAX_ATHENA_MD_FILE_BYTES: usize = 256 * 1024;
/// Ceiling on `identity.md`. Same reasoning; this one file is the single most
/// load-bearing document in the brain, so an oversize one is reported loudly.
const MAX_IDENTITY_BYTES: usize = 256 * 1024;

/// The node kinds that make up the `learned` tier. Deliberately does NOT
/// include `doctrine` (regenerated from `include_str!` on every boot),
/// `episode` (raw transcript), `reflection`, `cockpit` or `dashboard`.
const ATHENA_LEARNED_KINDS: [&str; 5] = ["fact", "procedural", "goal", "backlog", "ritual"];

/// The three `app_settings` keys that describe how the operator wants Athena to
/// behave, as opposed to what this machine happens to be doing. This list is a
/// SECURITY BOUNDARY, not a convenience: the import writes settings straight
/// into `app_settings`, so anything not named here must never be accepted from
/// a bundle. Enforced twice — in `validate_athena` and again at write time.
const ATHENA_PORTABLE_PREF_KEYS: [&str; 3] = [
    "companion_autonomous_mode",
    "companion_fleet_boldness",
    "companion_profile_synthesis",
];

// ----------------------------------------------------------------------------
// What Athena's section deliberately does NOT carry.
//
// Named here so the exclusion is a declared contract rather than an emergent
// property of which SELECTs happen to exist, and asserted by
// `athena_bundle_excludes_every_forbidden_name`. Four reasons, in order of how
// much they matter:
//
//  1. REGENERATED ON THE TARGET. Doctrine (~349 of 362 nodes) is rebuilt from
//     `include_str!` at boot, and `prune_orphans` deletes any doctrine node
//     outside the current allowlist — so imported doctrine would be deleted
//     anyway. `constitution.md` is a shipped template.
//  2. MACHINE-LOCAL. `claude_session_id` is a `--resume` pointer into a CLI
//     process that does not exist on the target; `companion_known_project`
//     holds absolute paths; `companion_embedding` holds vectors from this
//     machine's embedding model.
//  3. NOT MEMORY. Telemetry, budgets, live scratch queues, wake logs — state
//     about a running installation, meaningless once moved.
//  4. RAW TRANSCRIPT. Episodes and `companion_turn_sidecar` are the
//     conversation itself. What Athena LEARNED from a conversation travels;
//     the conversation does not.
// ----------------------------------------------------------------------------

/// Table and column names that must never appear as a field name anywhere in
/// the Athena section.
#[cfg(test)]
const ATHENA_FORBIDDEN_NAMES: [&str; 23] = [
    // 2 — machine-local
    "claude_session_id",
    "companion_known_project",
    "companion_embedding",
    "companion_edge",
    "athena_audit",
    // 3 — telemetry + live scratch
    "companion_turn",
    "companion_turn_sidecar",
    "companion_ux_signal",
    "companion_persona_baseline",
    "companion_proactive_budget",
    "companion_attention_budget",
    "athena_wake_log",
    "companion_approval",
    "companion_proactive_message",
    "companion_dev_op",
    "companion_dev_feedback",
    "companion_background_job",
    "companion_night_plan",
    "companion_night_event",
    "companion_daily_goal",
    "companion_active_connector",
    "companion_plugin_toggle",
    "companion_fts",
];

/// Node kinds and on-disk files that must never appear as a `kind` or
/// `file_path` value anywhere in the Athena section.
#[cfg(test)]
const ATHENA_FORBIDDEN_CONTENT: [&str; 8] = [
    "doctrine",
    "episode",
    "reflection",
    "cockpit",
    "dashboard",
    "constitution",
    "episodes-archive-",
    "identity.bak-",
];

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
    /// Digital twins (profile + tone/communication/memory/fact/contact/
    /// reflection/channel graph + the TEXT tier of a bound knowledge base).
    ///
    /// EMPTY whenever `encrypted_twins` is populated — the two are alternatives,
    /// never both. A twin is a model of a real person's voice; it does not
    /// travel in the clear.
    #[serde(default)]
    pub twins: Vec<TwinExport>,
    /// Athena's own memory. A singleton section, not a list — there is exactly
    /// one Athena per installation.
    ///
    /// `None` whenever `encrypted_athena` is populated; same either/or rule as
    /// `twins`, and for a stronger reason — `identity.md` is a dossier on the
    /// operator written by the assistant that watches them work.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub athena: Option<AthenaMemoryExport>,
    /// What the export DROPPED, in the exporter's own words. Every cap in this
    /// module truncates rather than failing; before this field existed those
    /// truncations were completely silent on both ends. The importer replays
    /// them into `PortabilityImportResult.warnings` so the person who receives
    /// a bundle learns what is missing from it. See `push_truncation_warning`.
    #[serde(default)]
    pub export_warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_credentials: Option<CredentialExportEnvelope>,
    /// AES-256-GCM envelope holding the JSON of `twins`. Present exactly when
    /// the bundle carries twins; `twins` is then empty. Same passphrase and the
    /// same PBKDF2 parameters as `encrypted_credentials`, but an independent
    /// salt/nonce and its own format marker, so each section decrypts on its
    /// own and a section pasted into the wrong slot fails loudly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_twins: Option<CredentialExportEnvelope>,
    /// AES-256-GCM envelope holding the JSON of `athena`. Same contract.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_athena: Option<CredentialExportEnvelope>,
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
        #[serde(default)]
        twin_ids: Vec<String>,
        /// Which tiers of Athena's memory to carry: `"core"` and/or
        /// `"learned"`. Athena is a singleton, so she is picked by tier rather
        /// than by id — an empty list means none of her travels.
        #[serde(default)]
        athena_tiers: Vec<String>,
    },
}

/// Which tiers of Athena's memory an export is carrying.
///
/// `core` is who she is: `identity.md`, the three portable behaviour prefs, and
/// the conversation roster. `learned` is what she worked out: facts,
/// procedurals, goals, backlog, rituals, design decisions — the markdown bodies
/// plus their sidecar rows.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AthenaTiers {
    pub core: bool,
    pub learned: bool,
}

impl AthenaTiers {
    const CORE: &'static str = "core";
    const LEARNED: &'static str = "learned";

    fn none() -> Self {
        Self::default()
    }

    fn both() -> Self {
        Self {
            core: true,
            learned: true,
        }
    }

    fn any(self) -> bool {
        self.core || self.learned
    }

    /// Parse the wire values, rejecting anything unrecognised. A typo must not
    /// degrade into "exported nothing" — the user asked for a tier and would
    /// have no way to tell it never arrived.
    fn parse(tiers: &[String]) -> Result<Self, AppError> {
        let mut out = Self::none();
        for t in tiers {
            match t.as_str() {
                Self::CORE => out.core = true,
                Self::LEARNED => out.learned = true,
                other => {
                    return Err(AppError::Validation(format!(
                        "athena_tiers: unknown tier '{other}' (expected 'core' or 'learned')"
                    )))
                }
            }
        }
        Ok(out)
    }

    /// A Full-scope export carries everything, Athena included.
    fn from_scope(scope: &ExportScope) -> Result<Self, AppError> {
        match scope {
            ExportScope::Full => Ok(Self::both()),
            ExportScope::Selective { athena_tiers, .. } => Self::parse(athena_tiers),
        }
    }
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
// Twin export types
//
// `TwinExport` mirrors `twin_profiles` BY EXCLUSION: every column travels
// except the three that are meaningless (or actively harmful) on another
// machine —
//   * `slug`             — machine-derived, UNIQUE; re-derived on import.
//   * `is_active`        — a global singleton (`set_active_profile` demotes
//                          every other row); an import must never seize it.
//   * `obsidian_subpath` — a local vault path.
// `knowledge_base_id` is not carried as a raw id either: the id addresses a
// row in ANOTHER database (the user DB) that would not exist on the target,
// so the KB itself travels as `knowledge_base` (text tier only) and the
// binding is re-established against the freshly created row.
//
// `twin_voice_profiles` is NOT exported at all — the voice milestone was
// retired 2026-07-10 and the table is dead.
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct TwinExport {
    pub id: String,
    pub name: String,
    pub bio: Option<String>,
    pub role: Option<String>,
    pub languages: Option<String>,
    pub pronouns: Option<String>,
    pub training_directives: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub tones: Vec<TwinToneExport>,
    #[serde(default)]
    pub communications: Vec<TwinCommunicationExport>,
    #[serde(default)]
    pub pending_memories: Vec<TwinPendingMemoryExport>,
    #[serde(default)]
    pub distilled_facts: Vec<TwinDistilledFactExport>,
    #[serde(default)]
    pub contacts: Vec<TwinContactExport>,
    #[serde(default)]
    pub reflections: Vec<TwinReflectionExport>,
    #[serde(default)]
    pub channels: Vec<TwinChannelExport>,
    /// Text tier of the bound knowledge base, when one is bound AND resolvable.
    /// Never contains vectors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub knowledge_base: Option<TwinKnowledgeBaseExport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TwinToneExport {
    pub id: String,
    pub channel: String,
    pub voice_directives: String,
    pub examples_json: Option<String>,
    pub constraints_json: Option<String>,
    pub length_hint: Option<String>,
    pub updated_at: String,
}

/// One logged interaction. `summary` and `key_facts_json` are MANDATORY, not
/// optional garnish: the Training Studio stores the interview QUESTION in
/// `summary` (and its extracted facts in `key_facts_json`) while `content`
/// holds only the answer. Dropping them loses half of every training pair.
#[derive(Debug, Serialize, Deserialize)]
pub struct TwinCommunicationExport {
    pub id: String,
    pub channel: String,
    pub direction: String,
    pub contact_handle: Option<String>,
    pub content: String,
    pub summary: Option<String>,
    pub key_facts_json: Option<String>,
    pub occurred_at: String,
    pub created_at: String,
}

/// A memory in the approval inbox. ALL THREE statuses travel
/// (pending / approved / rejected) along with `reviewer_notes` — a rejected
/// memory plus the reason it was rejected is training signal about the
/// operator's taste, not garbage.
#[derive(Debug, Serialize, Deserialize)]
pub struct TwinPendingMemoryExport {
    pub id: String,
    pub channel: Option<String>,
    pub content: String,
    pub title: Option<String>,
    pub importance: i32,
    pub status: String,
    pub reviewer_notes: Option<String>,
    pub source_communication_id: Option<String>,
    pub created_at: String,
    pub reviewed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TwinDistilledFactExport {
    pub id: String,
    pub contact_handle: Option<String>,
    pub content: String,
    pub importance: i32,
    /// JSON array of source `twin_communications` ids. Remapped on import;
    /// a fact whose sources all fail to remap is DROPPED, never written with
    /// an empty array (the repo rejects that shape outright).
    pub sources_json: String,
    pub created_at: String,
    pub last_seen_at: String,
}

/// A contact row read straight from `twin_contacts`. Note that
/// `repos::twin::list_contacts_with_activity` returns computed
/// `message_count` / `last_seen_at` columns that do NOT exist in the table —
/// this export queries the table directly so nothing derived travels.
#[derive(Debug, Serialize, Deserialize)]
pub struct TwinContactExport {
    pub id: String,
    pub handle: String,
    pub alias: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TwinReflectionExport {
    pub id: String,
    pub prompt_seed: String,
    pub content: String,
    pub created_at: String,
}

/// A deployment channel binding. `credential_id` / `persona_id` are LOCAL vault
/// / persona references that almost never resolve on another machine, so the
/// import keeps them verbatim, forces `is_active = 0`, and warns — auto-matching
/// a channel onto the wrong credential would post as the twin to a stranger's
/// Discord.
#[derive(Debug, Serialize, Deserialize)]
pub struct TwinChannelExport {
    pub id: String,
    pub channel_type: String,
    pub credential_id: String,
    pub persona_id: Option<String>,
    pub label: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// The TEXT tier of a twin's bound knowledge base, read from the USER database
/// (`personas_data.db`) rather than the app database the rest of this bundle
/// comes from. Vectors are deliberately absent: `kb_vec_*` virtual tables and
/// every embedding stay home, and the target regenerates them with its own
/// embedding model via `kb_reindex` after the import commits.
///
/// `credential_id`, `document_count`, `chunk_count` and `status` are omitted —
/// all four are re-derived on the target (the vault shell gets a fresh
/// `kb-cred-<id>`, the counts are recomputed from what actually landed).
#[derive(Debug, Serialize, Deserialize)]
pub struct TwinKnowledgeBaseExport {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub embedding_model: String,
    pub embedding_dims: i64,
    pub chunk_size: i64,
    pub chunk_overlap: i64,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub documents: Vec<KbDocumentExport>,
    #[serde(default)]
    pub chunks: Vec<KbChunkExport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KbDocumentExport {
    pub id: String,
    pub source_type: String,
    pub source_path: Option<String>,
    pub title: String,
    pub content_hash: String,
    pub byte_size: i64,
    pub metadata_json: Option<String>,
    pub page_count: Option<i64>,
    pub empty_pages: i64,
    pub status: String,
    pub error_message: Option<String>,
    pub indexed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KbChunkExport {
    pub id: String,
    pub document_id: String,
    pub chunk_index: i64,
    pub content: String,
    pub token_count: i64,
    pub metadata_json: Option<String>,
    pub source_page: Option<i64>,
    pub extraction_confidence: f64,
    pub created_at: String,
}

// ============================================================================
// Athena memory export types
// ============================================================================

/// Athena's memory, in two tiers.
///
/// The companion brain treats **markdown on disk as the source of truth** and
/// `companion_node` + its sidecar tables as a rebuildable index over it (see
/// the `COMPANION_SCHEMA` doc comment). This export honours that: every node
/// carries its markdown `body`, and the import writes the file before it writes
/// the row. A bundle that carried only rows would move an index over documents
/// that do not exist on the target.
///
/// What is deliberately absent is as much of the design as what is present —
/// see `ATHENA_FORBIDDEN_NAMES` / `ATHENA_FORBIDDEN_CONTENT` for the full list
/// and the reasoning.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct AthenaMemoryExport {
    // ---- core tier ----
    /// Contents of `~/.personas/companion-brain/identity.md` — Athena's model
    /// of the operator. `constitution.md` is NOT here: it is a shipped template
    /// the target already has, and its `.bak-*` siblings are local history.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_md: Option<String>,
    /// The portable slice of `app_settings` (see `ATHENA_PORTABLE_PREF_KEYS`).
    #[serde(default)]
    pub prefs: Vec<AthenaPrefExport>,
    /// The conversation roster: titles, pins, origin, status. Never
    /// `claude_session_id` — that is a `--resume` handle into a CLI process on
    /// the exporting machine and is meaningless, at best, anywhere else.
    #[serde(default)]
    pub sessions: Vec<AthenaSessionExport>,

    // ---- learned tier ----
    /// One row per memory: the `companion_node` index row plus the markdown
    /// body it indexes. Restricted to `ATHENA_LEARNED_KINDS`.
    #[serde(default)]
    pub nodes: Vec<AthenaNodeExport>,
    #[serde(default)]
    pub facts: Vec<AthenaFactExport>,
    #[serde(default)]
    pub procedurals: Vec<AthenaProceduralExport>,
    #[serde(default)]
    pub goals: Vec<AthenaGoalExport>,
    #[serde(default)]
    pub backlog: Vec<AthenaBacklogExport>,
    #[serde(default)]
    pub rituals: Vec<AthenaRitualExport>,
    /// `companion_design_decision` — the only learned table with no
    /// `companion_node` row and no markdown file behind it.
    #[serde(default)]
    pub decisions: Vec<AthenaDecisionExport>,
    /// `(fact_id, episode_id)` pairs. The episodes themselves do NOT travel, so
    /// these ids land dangling on purpose: `semantic::load_sources` and
    /// `procedural::load_sources` read the provenance table directly with no
    /// join, so a dangling id is returned verbatim and never errors. Keeping
    /// them preserves "this belief came from three separate conversations",
    /// which is the part that survives losing the conversations.
    #[serde(default)]
    pub provenance: Vec<AthenaProvenanceExport>,
}

impl AthenaMemoryExport {
    fn is_empty(&self) -> bool {
        self.identity_md.is_none()
            && self.prefs.is_empty()
            && self.sessions.is_empty()
            && self.nodes.is_empty()
            && self.decisions.is_empty()
    }

}

/// One `app_settings` row. Only keys in `ATHENA_PORTABLE_PREF_KEYS` are ever
/// produced here, and only those are ever accepted on import.
#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaPrefExport {
    pub key: String,
    pub value: String,
}

/// One conversation thread, stripped to what means anything elsewhere.
#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaSessionExport {
    pub id: String,
    pub title: Option<String>,
    pub pinned: i64,
    pub origin: String,
    pub status: String,
}

/// A `companion_node` row plus the markdown it indexes.
#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaNodeExport {
    pub id: String,
    pub kind: String,
    /// ALWAYS relative to `brain_root()`. The column is relative by convention
    /// everywhere in the brain, but the exporter re-checks and refuses to emit
    /// an absolute path: it would name a directory on the exporting machine and
    /// the importer would happily write a file there.
    pub file_path: String,
    pub content_hash: String,
    pub importance: i64,
    pub body_excerpt: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Only `kind='episode'` rows ever set this, and episodes do not travel —
    /// so it is `None` in practice. Carried anyway so the column does not
    /// silently start getting dropped if that ever changes.
    pub session_id: Option<String>,
    /// The markdown file body. `embedding_model` / `embedding_dims` are NOT
    /// exported: they describe a vector written by the exporting machine's
    /// model, and the target re-embeds with its own.
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaFactExport {
    pub id: String,
    pub scope: String,
    pub fact_key: String,
    pub confidence: f64,
    pub supersedes_id: Option<String>,
    pub contradicts_id: Option<String>,
    pub last_seen_at: String,
    pub last_decayed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaProceduralExport {
    pub id: String,
    pub scope: String,
    pub trigger_pattern: String,
    pub confidence: f64,
    pub supersedes_id: Option<String>,
    pub last_used_at: String,
    pub last_decayed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaGoalExport {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: i64,
    pub target_date: Option<String>,
    pub sources_json: String,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaBacklogExport {
    pub id: String,
    pub summary: String,
    pub kind: String,
    pub status: String,
    /// The episode she made the promise in. Dangles after import for the same
    /// reason `provenance` does, and for the same reason it is kept.
    pub source_episode_id: Option<String>,
    pub reminded_count: i64,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaRitualExport {
    pub id: String,
    pub kind: String,
    pub description: String,
    pub schedule_json: String,
    pub active: i64,
    pub sources_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaDecisionExport {
    pub id: String,
    pub session_id: String,
    pub persona_context: Option<String>,
    pub label: String,
    pub choice: String,
    pub rationale: String,
    pub decision_timestamp: Option<String>,
    pub created_at: String,
}

/// `companion_provenance`. Note that `fact_id` is overloaded by the schema: it
/// holds `fact_*` ids AND `proc_*` ids, one table for both tiers.
#[derive(Debug, Serialize, Deserialize)]
pub struct AthenaProvenanceExport {
    pub fact_id: String,
    pub episode_id: String,
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
    // Twin counters (WP1).
    #[serde(default)]
    pub twins_imported: u32,
    #[serde(default)]
    pub twins_skipped: u32,
    #[serde(default)]
    pub twin_kb_chunks_imported: u32,
    // Athena counters (WP2). There is exactly one Athena, so her section merges
    // additively instead of going through the conflict channel — the numbers
    // below are the whole story of what happened to her.
    /// Memories that landed: `companion_node` rows plus design decisions.
    /// Items that matched something already in the brain are NOT counted —
    /// they were skipped, not merged.
    #[serde(default)]
    pub athena_memory_imported: u32,
    /// True when an `identity.md` already existed and was replaced (a
    /// timestamped backup was written next to it first). False when the bundle
    /// carried no identity, or when there was nothing to replace.
    #[serde(default)]
    pub athena_identity_replaced: bool,
    /// How many imported nodes were handed to the background re-embed. A bundle
    /// carries text and never vectors, so these have no semantic index until
    /// `companion_reembed_missing` runs.
    #[serde(default)]
    pub reembed_queued: u32,
    /// Non-empty when conflicts were detected on pass 1 — the frontend shows a
    /// resolution UI and re-invokes with `resolutions_json`, whose keys
    /// are `"<kind>:<bundle_id>"` (see [`ImportConflict`]).
    #[serde(default)]
    pub import_conflicts: Vec<ImportConflict>,
    /// Path of the selected bundle file — returned alongside conflicts so the
    /// frontend can pass it back for the resolution pass (mirrors
    /// `CredentialImportResult::file_path`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_file_path: Option<String>,
    pub warnings: Vec<String>,
    pub id_mapping: std::collections::HashMap<String, String>,
    /// Knowledge bases created by this import that still need their vectors
    /// rebuilt. Internal plumbing between [`import_bundle`] and the command
    /// layer (which owns the `AppHandle` + embedder needed to run
    /// `kb_reindex`) — never crosses IPC, because a vector index is a local
    /// artifact and not part of what the user asked to see.
    #[serde(skip)]
    #[ts(skip)]
    pub pending_kb_reindex: Vec<String>,
}

/// A bundled entity that collides with one already present in this workspace.
///
/// Generic over the entity kind so a single two-pass resolution flow serves
/// every section of the bundle. The caller resolves each conflict with
/// `"replace" | "skip" | "duplicate"` in a flat map keyed
/// **`"<kind>:<bundle_id>"`** (e.g. `"project:abc"`, `"twin:def"`).
///
/// | `kind`    | matched by                          | `detail`    |
/// |-----------|-------------------------------------|-------------|
/// | `project` | `root_path` (UNIQUE), else `name`   | `root_path` |
/// | `twin`    | `name COLLATE NOCASE`               | `None`      |
///
/// Twins are matched on name, never slug: the slug is machine-derived from the
/// name at creation time and collides only by accident.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportConflict {
    /// `"project"` | `"twin"`. Kept a `String` on the Rust side (adding a kind
    /// is a one-line change at the call site), but exported to TypeScript as
    /// the literal union so the frontend can exhaustively switch on it.
    #[ts(type = "\"project\" | \"twin\"")]
    pub kind: String,
    pub bundle_id: String,
    pub name: String,
    /// Extra disambiguation for the resolution UI — the project's `root_path`,
    /// or `None` when the kind has nothing further to show.
    pub detail: Option<String>,
    pub existing_id: String,
    /// `"root_path"` | `"name"` | `"slug"`.
    pub matched_by: String,
}

/// Resolution-map key for a conflict. The map is flat and shared by every
/// entity kind, so the key has to carry the kind.
fn conflict_key(kind: &str, bundle_id: &str) -> String {
    format!("{kind}:{bundle_id}")
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
    pub twin_count: u32,
    /// Size of Athena's `core` tier — identity file + portable prefs +
    /// conversation roster. The picker hides a tier whose count is 0, so these
    /// are "is there anything here", not just cosmetics.
    #[serde(default)]
    pub athena_core_count: u32,
    /// Size of Athena's `learned` tier — memory nodes plus design decisions.
    #[serde(default)]
    pub athena_learned_count: u32,
    /// Pre-flight truncation forecast: which top-level caps this workspace
    /// already exceeds, so the export modal can say what an export would drop
    /// BEFORE the user runs it. The export commands themselves return only
    /// `bool`, so this preview is the only channel that reaches the exporting
    /// user; the actual per-site truncation records ride inside the bundle as
    /// `PortabilityBundle::export_warnings` and surface on the import side.
    #[serde(default)]
    pub warnings: Vec<String>,
}

// ============================================================================
// Commands
// ============================================================================

/// Get export statistics for the entire workspace (for UI preview).
#[tauri::command]
pub async fn get_export_stats(state: State<'_, Arc<AppState>>) -> Result<ExportStats, AppError> {
    require_auth_sync(&state)?;
    compute_export_stats(&state.db, Some(&state.user_db))
}

/// Pool-level body of [`get_export_stats`] — split out so unit tests can
/// exercise the counters without constructing a Tauri `State`.
///
/// `user_db` is the second database file. Athena's brain lives there, not in
/// the app database the rest of these counters read, so `None` simply reports
/// her tiers as empty rather than failing.
fn compute_export_stats(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
) -> Result<ExportStats, AppError> {
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
    let twin_count = scalar_count("SELECT COUNT(*) FROM twin_profiles").unwrap_or(0);

    // Athena's two tiers. Counted, never read: this is the modal's preview, so
    // it must not open a single markdown file. The picker hides a tier whose
    // count is 0, which is why "identity.md exists" is worth one point.
    let (athena_core_count, athena_learned_count) = athena_tier_counts(pool, user_db);

    // Pre-flight cap forecast. Only the workspace-wide top-level caps can be
    // checked from scalar counts; per-entity caps (a single twin's 5k-message
    // history, a project's skills) are reported by the export itself through
    // the bundle's `export_warnings`.
    //
    // The two behaviours are NOT the same and the message must not blur them:
    // projects / KPIs / twins truncate on the way out, while personas / tools /
    // teams / credentials are not capped by the exporter at all — an oversize
    // bundle writes fine and is then REJECTED by `validate_bundle` on the way
    // in. That asymmetry is pre-existing; naming it is the least this preview
    // can do.
    let mut warnings = Vec::new();
    let truncates = |w: &mut Vec<String>, label: &str, have: u32, cap: usize| {
        if have as usize > cap {
            w.push(format!(
                "{label}: this workspace has {have}, but an export carries at most {cap} — {} will be left behind.",
                have as usize - cap
            ));
        }
    };
    let rejects = |w: &mut Vec<String>, label: &str, have: u32, cap: usize| {
        if have as usize > cap {
            w.push(format!(
                "{label}: this workspace has {have}, over the {cap} an import accepts. The file will be written but refused when imported — split the selection."
            ));
        }
    };
    rejects(&mut warnings, "Personas", personas.len() as u32, MAX_PERSONAS);
    rejects(&mut warnings, "Tools", tools.len() as u32, MAX_TOOLS);
    rejects(&mut warnings, "Teams", teams.len() as u32, MAX_TEAMS);
    rejects(
        &mut warnings,
        "Credentials",
        credentials.len() as u32,
        MAX_CREDENTIALS,
    );
    truncates(&mut warnings, "KPIs", kpi_count, MAX_KPIS);
    truncates(&mut warnings, "Projects", dev_project_count, MAX_DEV_PROJECTS);
    truncates(&mut warnings, "Twins", twin_count, MAX_TWINS);

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
        twin_count,
        athena_core_count,
        athena_learned_count,
        warnings,
    })
}

/// `(core, learned)` sizes for the export preview. Never fails: a machine with
/// no companion schema (very old database, or a unit test with no user pool)
/// simply reports `(0, 0)` and the picker hides both rows.
fn athena_tier_counts(pool: &DbPool, user_db: Option<&UserDbPool>) -> (u32, u32) {
    let mut core = 0u32;
    // identity.md on disk — one point, because "she has an identity" is the
    // difference between an offerable tier and a hidden one.
    if crate::companion::disk::brain_root()
        .map(|r| r.join("identity.md").is_file())
        .unwrap_or(false)
    {
        core += 1;
    }
    for key in ATHENA_PORTABLE_PREF_KEYS {
        if matches!(settings_repo::get(pool, key), Ok(Some(_))) {
            core += 1;
        }
    }

    let Some(user_db) = user_db else {
        return (core, 0);
    };
    let Ok(conn) = user_db.get() else {
        return (core, 0);
    };
    let count = |sql: &str| -> u32 {
        conn.query_row(sql, [], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            .max(0) as u32
    };
    core += count("SELECT COUNT(*) FROM companion_session");
    let kinds = athena_kind_list();
    let learned = count(&format!(
        "SELECT COUNT(*) FROM companion_node WHERE kind IN ({kinds})"
    )) + count("SELECT COUNT(*) FROM companion_design_decision");
    (core, learned)
}

/// `'fact','procedural',…` — the learned kinds as a SQL literal list. Built
/// from the const so the query and the exporter can never disagree, and safe to
/// interpolate because every element is a compile-time literal.
fn athena_kind_list() -> String {
    ATHENA_LEARNED_KINDS
        .iter()
        .map(|k| format!("'{k}'"))
        .collect::<Vec<_>>()
        .join(",")
}

/// Record a cap-truncation in the export's warning channel. Every `.take()` /
/// `break` in this module funnels through here — before it existed the caps
/// dropped data with no signal on either end while the import side hard-
/// rejected the very same overflow.
fn push_truncation_warning(
    warnings: &mut Vec<String>,
    what: &str,
    kept: usize,
    total: usize,
    context: &str,
) {
    if total <= kept {
        return;
    }
    warnings.push(format!(
        "{context}: kept {kept} of {total} {what}; {} dropped (export cap).",
        total - kept
    ));
}

/// A KPI is part of an exportable "setup" when it is actively measured or
/// paused — not a `proposed` review-queue suggestion or an `archived` retiree.
fn is_exportable_kpi(status: &str) -> bool {
    status == "active" || status == "paused"
}

/// The minimum passphrase length every encrypted section in this module
/// agrees on. Below it, a passphrase counts as absent.
const MIN_PASSPHRASE_LEN: usize = 8;

fn usable_passphrase(passphrase: Option<&str>) -> Option<&str> {
    passphrase.filter(|p| p.len() >= MIN_PASSPHRASE_LEN)
}

/// Full export: export everything into a compressed JSON archive via save dialog.
/// When `passphrase` is provided (>= 8 chars), credential secrets — and the two
/// always-encrypted sections, twins and Athena's memory — are encrypted and
/// embedded in the bundle.
///
/// **Without a passphrase, a full export carries neither twins nor Athena.**
/// That mirrors what this command already did with credential secrets: the
/// shells travel, the secrets do not. A twin is a model of a real person's
/// voice and `identity.md` is a dossier on the operator; neither belongs in a
/// plaintext zip. The omission is recorded in `export_warnings` rather than
/// being silent.
#[tauri::command]
#[requires(privileged)]
pub async fn export_full(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    include_memories: Option<bool>,
    passphrase: Option<String>,
) -> Result<bool, AppError> {
    let pool = &state.db;
    let pp = usable_passphrase(passphrase.as_deref());
    // Full export carries the entire workspace, KPI setup included.
    let mut bundle = build_export_bundle(
        pool,
        Some(&state.user_db),
        ExportScope::Full,
        include_memories.unwrap_or(true),
        true,
        SensitiveSections::from_passphrase(pp),
    )?;

    if let Some(pp) = pp {
        let envelope = build_encrypted_credentials(pool, pp, None)?;
        bundle.encrypted_credentials = Some(envelope);
        bundle.format_version = 3;
    }
    seal_sensitive_sections(&mut bundle, pp)?;

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
    twin_ids: Vec<String>,
    athena_tiers: Vec<String>,
    include_memories: Option<bool>,
    include_kpis: Option<bool>,
    passphrase: Option<String>,
) -> Result<bool, AppError> {
    // When passphrase is provided (credential secrets involved), upgrade to privileged
    let pp = usable_passphrase(passphrase.as_deref());
    if pp.is_some() {
        require_privileged(&state, "export_selective").await?;
    } else {
        require_auth(&state).await?;
    }
    require_passphrase_for_selection(&twin_ids, &athena_tiers, pp)?;

    let pool = &state.db;
    let scope = ExportScope::Selective {
        persona_ids: persona_ids.clone(),
        team_ids: team_ids.clone(),
        credential_ids: credential_ids.clone(),
        project_ids: project_ids.clone(),
        workspace_ids: workspace_ids.clone(),
        twin_ids: twin_ids.clone(),
        athena_tiers: athena_tiers.clone(),
    };
    let mut bundle = build_export_bundle(
        pool,
        Some(&state.user_db),
        scope,
        include_memories.unwrap_or(true),
        include_kpis.unwrap_or(true),
        SensitiveSections::from_passphrase(pp),
    )?;

    if let Some(pp) = pp {
        let filter_ids = if credential_ids.is_empty() {
            None
        } else {
            Some(&credential_ids)
        };
        let envelope = build_encrypted_credentials(pool, pp, filter_ids)?;
        bundle.encrypted_credentials = Some(envelope);
        bundle.format_version = 3;
    }
    seal_sensitive_sections(&mut bundle, pp)?;

    save_bundle_to_file(&app, &bundle, "personas_selective_export").await
}

/// Refuse an export that ASKED for twins or Athena but supplied no passphrase.
///
/// The distinction against the Full-scope path matters: a full export that
/// quietly leaves them out is the same trade this command already makes for
/// credential secrets, and it is recorded in `export_warnings`. But a user who
/// ticked "Athena — learned" and got a file without it has been lied to, and
/// nothing in a `-> Result<bool>` would ever tell them. So that case fails.
///
/// The frontend gates this too (`passphraseMissing` in `useExportPicker`), but
/// the frontend is not the boundary — anything that can invoke can skip it.
fn require_passphrase_for_selection(
    twin_ids: &[String],
    athena_tiers: &[String],
    passphrase: Option<&str>,
) -> Result<(), AppError> {
    // Parse unconditionally: a typo'd tier must fail the same way whether or
    // not a passphrase was supplied, and it must not be masked by (or mask)
    // the passphrase error.
    let tiers = AthenaTiers::parse(athena_tiers)?;
    if passphrase.is_some() {
        return Ok(());
    }
    if twin_ids.is_empty() && !tiers.any() {
        return Ok(());
    }
    let mut what = Vec::new();
    if !twin_ids.is_empty() {
        what.push("digital twins");
    }
    if tiers.any() {
        what.push("Athena's memory");
    }
    Err(AppError::Validation(format!(
        "This export includes {}, which always travel encrypted. Enter a passphrase of at least {MIN_PASSPHRASE_LEN} characters, or deselect them.",
        what.join(" and ")
    )))
}

/// Import a previously exported portability bundle.
/// When `passphrase` is provided and the bundle contains `encrypted_credentials`,
/// credential secrets are decrypted and written to the imported credential shells.
///
/// Two-pass conflict flow (mirrors `import_credentials`):
/// - Pass 1 (no `resolutions_json`): all non-conflicting sections
///   import immediately; colliding entities are returned in `import_conflicts`
///   together with `bundle_file_path`.
/// - Pass 2: the caller re-invokes with `resolutions_json` (a JSON map
///   of `"<kind>:<bundle_id>"` → `"replace" | "skip" | "duplicate"`) and
///   `file_path_override` set to the returned `bundle_file_path`; only the
///   resolved entities are processed.
///
/// The parameter was `project_resolutions_json` while the flow was
/// project-only; it is `resolutions_json` (invoke key `resolutionsJson`) now
/// that the map is generic. Tauri silently drops payload keys a command does
/// not declare, so a caller still sending only the old name degrades into a
/// pass-1 re-run rather than erroring — the remaining call sites
/// (`src/api/system/dataPortability.ts`, `src/test/automation/bridge.ts`,
/// `tools/test-mcp/e2e_portability.py`) must send the new key.
#[tauri::command]
#[requires(privileged)]
pub async fn import_portability_bundle(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: Option<String>,
    resolutions_json: Option<String>,
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
        Some(&state.user_db),
        &path,
        passphrase.as_deref(),
        resolutions_json.as_deref(),
    )?;
    spawn_pending_kb_reindex(&app, &state, &result);
    spawn_pending_reembed(&state, &result);
    Ok(Some(result))
}

/// Kick the background re-embed for every knowledge base an import created.
/// Vectors never travel in a bundle, so a freshly imported KB has text but no
/// index until this runs. Fire-and-forget by design: `kb_reindex` returns a job
/// id immediately and reports through the usual `kb:ingest_*` events, and a
/// build without the `ml` feature has no embedder at all — in which case the
/// KB stays searchable by keyword (FTS) and the user can reindex later.
fn spawn_pending_kb_reindex(
    app: &AppHandle,
    state: &State<'_, Arc<AppState>>,
    result: &PortabilityImportResult,
) {
    if result.pending_kb_reindex.is_empty() {
        return;
    }
    #[cfg(feature = "ml")]
    {
        for kb_id in &result.pending_kb_reindex {
            let app = app.clone();
            let state = state.inner().clone();
            let kb_id = kb_id.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) =
                    crate::commands::credentials::vector_kb::reindex_kb_internal(app, state, kb_id.clone())
                        .await
                {
                    tracing::warn!(kb_id = %kb_id, error = %e, "Imported knowledge base could not be re-indexed");
                }
            });
        }
    }
    #[cfg(not(feature = "ml"))]
    {
        let _ = (app, state);
        tracing::info!(
            count = result.pending_kb_reindex.len(),
            "Imported knowledge base(s) left unindexed — this build has no embedder (ml feature off)"
        );
    }
}

/// Kick the background vector backfill for memory an import just landed.
///
/// A bundle carries Athena's text and never her vectors — the exporting
/// machine's embedding model is not necessarily this one's, and a vector
/// recorded under the wrong model is worse than no vector at all (the recall
/// model guard drops it). So the imported nodes arrive searchable by recency
/// and importance but not by meaning until this runs.
///
/// Fire-and-forget, same posture as `spawn_pending_kb_reindex`: the counts are
/// already reported to the user as `reembed_queued`, and a build without the
/// `ml` feature reports `available: false` instead of failing.
fn spawn_pending_reembed(state: &State<'_, Arc<AppState>>, result: &PortabilityImportResult) {
    if result.reembed_queued == 0 {
        return;
    }
    let state = state.inner().clone();
    let queued = result.reembed_queued;
    tauri::async_runtime::spawn(async move {
        match crate::commands::companion::brain::reembed_missing_internal(&state).await {
            Ok(r) if !r.available => tracing::info!(
                queued,
                "Imported Athena memory left unvectored — this build has no embedder (ml feature off)"
            ),
            Ok(r) => tracing::info!(
                queued,
                embedded = r.embedded,
                skipped = r.skipped,
                "Imported Athena memory re-embedded"
            ),
            Err(e) => {
                tracing::warn!(queued, error = %e, "Imported Athena memory could not be re-embedded")
            }
        }
    });
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
    twin_ids: Vec<String>,
    athena_tiers: Vec<String>,
    include_memories: Option<bool>,
    include_kpis: Option<bool>,
    passphrase: Option<String>,
    file_path: String,
) -> Result<bool, AppError> {
    let pp = usable_passphrase(passphrase.as_deref());
    if pp.is_some() {
        require_privileged(&state, "export_selective_to_path").await?;
    } else {
        require_auth(&state).await?;
    }
    require_passphrase_for_selection(&twin_ids, &athena_tiers, pp)?;

    let pool = &state.db;
    let scope = ExportScope::Selective {
        persona_ids: persona_ids.clone(),
        team_ids: team_ids.clone(),
        credential_ids: credential_ids.clone(),
        project_ids: project_ids.clone(),
        workspace_ids: workspace_ids.clone(),
        twin_ids: twin_ids.clone(),
        athena_tiers: athena_tiers.clone(),
    };
    let mut bundle = build_export_bundle(
        pool,
        Some(&state.user_db),
        scope,
        include_memories.unwrap_or(true),
        include_kpis.unwrap_or(true),
        SensitiveSections::from_passphrase(pp),
    )?;

    if let Some(pp) = pp {
        let filter_ids = if credential_ids.is_empty() {
            None
        } else {
            Some(&credential_ids)
        };
        let envelope = build_encrypted_credentials(pool, pp, filter_ids)?;
        bundle.encrypted_credentials = Some(envelope);
        bundle.format_version = 3;
    }
    seal_sensitive_sections(&mut bundle, pp)?;

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
    app: AppHandle,
    passphrase: Option<String>,
    file_path: String,
    resolutions_json: Option<String>,
) -> Result<Option<PortabilityImportResult>, AppError> {
    let path = std::path::PathBuf::from(&file_path);
    let result = run_bundle_import(
        &state.db,
        Some(&state.user_db),
        &path,
        passphrase.as_deref(),
        resolutions_json.as_deref(),
    )?;
    spawn_pending_kb_reindex(&app, &state, &result);
    spawn_pending_reembed(&state, &result);
    Ok(Some(result))
}

/// Shared body of [`import_portability_bundle`] and its debug from-path twin:
/// read + parse + version-gate + validate the bundle at `path`, run the DB
/// import (with optional conflict resolutions), then apply embedded encrypted
/// credentials. Keeping the two commands on one code path is what keeps them
/// in lockstep.
fn run_bundle_import(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    path: &std::path::Path,
    passphrase: Option<&str>,
    resolutions_json: Option<&str>,
) -> Result<PortabilityImportResult, AppError> {
    let content = if path.extension().is_some_and(|ext| ext == "zip") {
        read_zip_bundle(path)?
    } else {
        std::fs::read_to_string(path)
            .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?
    };

    let mut bundle: PortabilityBundle = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Invalid export file: {e}")))?;

    if bundle.format_version != 2 && bundle.format_version != 3 {
        return Err(AppError::Validation(format!(
            "Unsupported format version: {} (expected 2 or 3)",
            bundle.format_version
        )));
    }

    // Decrypt the always-encrypted sections BEFORE validation, so
    // `validate_bundle` sees the real twin / Athena content rather than an
    // opaque blob. A missing or wrong passphrase leaves the sections empty and
    // records why, matching how embedded credentials already behave: an import
    // the user can only half-complete still completes the half it can.
    let mut unseal_warnings = Vec::new();
    unseal_sensitive_sections(&mut bundle, passphrase, &mut unseal_warnings);

    validate_bundle(&bundle)?;

    let resolutions: HashMap<String, String> = resolutions_json
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let is_resolution_pass = !resolutions.is_empty();

    let mut result = import_bundle(pool, user_db, &bundle, &resolutions)?;
    if !is_resolution_pass {
        result.warnings.extend(unseal_warnings);
    }

    // Returned conflicts need the file path back so the frontend can re-invoke
    // the resolution pass against the same bundle without a second dialog.
    if !result.import_conflicts.is_empty() {
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

/// Whether this export is in a position to carry the two always-encrypted
/// sections. They are COLLECTED only when a passphrase exists to seal them —
/// reading a whole brain off disk and then discarding it would be pure waste,
/// and worse, would leave the plaintext sitting in memory for no reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SensitiveSections {
    Include,
    Omit,
}

impl SensitiveSections {
    fn from_passphrase(passphrase: Option<&str>) -> Self {
        if passphrase.is_some() {
            Self::Include
        } else {
            Self::Omit
        }
    }
}

fn build_export_bundle(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    scope: ExportScope,
    include_memories: bool,
    include_kpis: bool,
    sensitive: SensitiveSections,
) -> Result<PortabilityBundle, AppError> {
    // Everything this export DROPS gets recorded here and travels with the
    // bundle, so the machine that receives it can tell what is missing.
    let mut export_warnings: Vec<String> = Vec::new();
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

        let exportable: Vec<_> = source_kpis
            .into_iter()
            .filter(|k| is_exportable_kpi(&k.status))
            .collect();
        push_truncation_warning(
            &mut export_warnings,
            "KPIs",
            MAX_KPIS.min(exportable.len()),
            exportable.len(),
            "KPI setup",
        );
        exportable
            .into_iter()
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
    /// `None` = every row of that kind (Full scope); `Some(ids)` = exactly
    /// those, where an EMPTY slice means none.
    type IdFilter<'a> = Option<&'a [String]>;
    let (project_filter, workspace_filter, twin_filter): (IdFilter, IdFilter, IdFilter) = match
        &scope
    {
        ExportScope::Full => (None, None, None),
        ExportScope::Selective {
            project_ids,
            workspace_ids,
            twin_ids,
            ..
        } => (
            Some(project_ids.as_slice()),
            Some(workspace_ids.as_slice()),
            Some(twin_ids.as_slice()),
        ),
    };
    let dev_project_exports =
        collect_dev_project_exports(pool, project_filter, &mut export_warnings)?;
    let bundled_project_ids: Vec<String> =
        dev_project_exports.iter().map(|p| p.id.clone()).collect();
    let workspace_exports = collect_workspace_knowledge_exports(
        pool,
        workspace_filter,
        &bundled_project_ids,
        &mut export_warnings,
    )?;
    // Twins and Athena are the two always-encrypted sections. Without a
    // passphrase they are not collected at all; the omission is recorded so the
    // person who opens the bundle learns why it is thinner than they expected.
    let athena_tiers = AthenaTiers::from_scope(&scope)?;
    let (twin_exports, athena_export) = match sensitive {
        SensitiveSections::Include => (
            collect_twin_exports(pool, user_db, twin_filter, &mut export_warnings)?,
            collect_athena_export(pool, user_db, athena_tiers, &mut export_warnings)?,
        ),
        SensitiveSections::Omit => {
            let wants_twins = !twin_filter.is_some_and(|ids| ids.is_empty());
            if wants_twins || athena_tiers.any() {
                export_warnings.push(
                    "Digital twins and Athena's memory were left out: they travel encrypted only, \
                     and this export was written without a passphrase."
                        .into(),
                );
            }
            (Vec::new(), None)
        }
    };

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
        twins: twin_exports,
        athena: athena_export,
        export_warnings,
        encrypted_credentials: None,
        encrypted_twins: None,
        encrypted_athena: None,
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
    export_warnings: &mut Vec<String>,
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
            let total: usize = conn
                .query_row("SELECT COUNT(*) FROM dev_projects", [], |r| r.get::<_, i64>(0))
                .unwrap_or(0) as usize;
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
            push_truncation_warning(export_warnings, "projects", out.len(), total, "Dev projects");
            out
        }
        Some(ids) => {
            let mut unique: Vec<&String> = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for id in ids {
                if seen.insert(id.clone()) {
                    unique.push(id);
                }
            }
            push_truncation_warning(
                export_warnings,
                "selected projects",
                MAX_DEV_PROJECTS.min(unique.len()),
                unique.len(),
                "Dev projects",
            );
            let sql = format!("SELECT {PROJECT_COLS} FROM dev_projects WHERE id = ?1");
            let mut out = Vec::new();
            for id in unique.into_iter().take(MAX_DEV_PROJECTS) {
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

        let skills = collect_project_skills(&root_path, &name, export_warnings);

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
fn collect_project_skills(
    root_path: &str,
    project_name: &str,
    export_warnings: &mut Vec<String>,
) -> Vec<SkillFileExport> {
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

        // A symlinked entry resolves outside the skills dir; exporting through
        // it would put arbitrary repo/home content into a shareable bundle.
        let kind = skill_files::classify_skill_entry(&entry);
        if let skill_files::SkillEntryKind::Rejected(reason) = kind {
            export_warnings.push(format!(
                "Project '{project_name}': skill '{entry_name}' not exported ({reason})."
            ));
            continue;
        }

        let mut dropped: Vec<String> = Vec::new();
        let (name, mut files) = if matches!(kind, skill_files::SkillEntryKind::Dir) {
            let mut files = Vec::new();
            collect_skill_dir_files(&path, &path, &mut files, &mut dropped, 0);
            (entry_name.clone(), files)
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            // Single-file skill: skills/<name>.md
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();
            match read_skill_file_checked(&path) {
                Ok(content) => (
                    stem,
                    vec![SkillFileEntry {
                        rel_path: entry_name.clone(),
                        content,
                    }],
                ),
                Err(reason) => {
                    export_warnings.push(format!(
                        "Project '{project_name}': skill '{entry_name}' not exported ({reason})."
                    ));
                    continue;
                }
            }
        } else {
            continue;
        };
        for d in dropped {
            export_warnings.push(format!(
                "Project '{project_name}': skill '{entry_name}' file {d} — not exported."
            ));
        }

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
fn collect_skill_dir_files(
    base: &std::path::Path,
    dir: &std::path::Path,
    out: &mut Vec<SkillFileEntry>,
    dropped: &mut Vec<String>,
    depth: usize,
) {
    if depth >= skill_files::MAX_SKILL_DIR_DEPTH {
        dropped.push(format!(
            "'{}' (nested deeper than {})",
            dir.display(),
            skill_files::MAX_SKILL_DIR_DEPTH
        ));
        return;
    }
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let rel_of = |p: &std::path::Path| {
            p.strip_prefix(base)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| p.to_string_lossy().to_string())
        };
        match skill_files::classify_skill_entry(&entry) {
            skill_files::SkillEntryKind::Dir => {
                collect_skill_dir_files(base, &path, out, dropped, depth + 1);
                continue;
            }
            skill_files::SkillEntryKind::Rejected(reason) => {
                dropped.push(format!("'{}' ({reason})", rel_of(&path)));
                continue;
            }
            skill_files::SkillEntryKind::File => {}
        }
        if path.file_name().and_then(|n| n.to_str()) == Some(SKILL_PROVENANCE_FILE) {
            continue;
        }
        let rel_label = path
            .strip_prefix(base)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.to_string_lossy().to_string());
        let content = match read_skill_file_checked(&path) {
            Ok(c) => c,
            Err(reason) => {
                dropped.push(format!("'{rel_label}' ({reason})"));
                continue;
            }
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

/// Why a skill file did not make it into the bundle. Reported (not swallowed)
/// on the export path — a skill silently missing half its reference files is
/// indistinguishable from a skill that never had them.
enum SkillFileSkip {
    Oversize(u64),
    NotUtf8,
    Unreadable,
}

impl std::fmt::Display for SkillFileSkip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkillFileSkip::Oversize(len) => write!(
                f,
                "{len} bytes exceeds the {MAX_SKILL_FILE_BYTES}-byte per-file cap"
            ),
            SkillFileSkip::NotUtf8 => write!(f, "not valid UTF-8 text"),
            SkillFileSkip::Unreadable => write!(f, "unreadable"),
        }
    }
}

/// Read one skill file as UTF-8 text, naming the reason when it cannot travel.
fn read_skill_file_checked(path: &std::path::Path) -> Result<String, SkillFileSkip> {
    let meta = std::fs::metadata(path).map_err(|_| SkillFileSkip::Unreadable)?;
    if meta.len() > MAX_SKILL_FILE_BYTES {
        return Err(SkillFileSkip::Oversize(meta.len()));
    }
    let bytes = std::fs::read(path).map_err(|_| SkillFileSkip::Unreadable)?;
    String::from_utf8(bytes).map_err(|_| SkillFileSkip::NotUtf8)
}

/// Read one skill file as UTF-8 text, or None when it is oversize
/// (> [`MAX_SKILL_FILE_BYTES`]), unreadable, or not valid UTF-8. Used where
/// the reason does not matter (the import-side drift comparison).
fn read_skill_file(path: &std::path::Path) -> Option<String> {
    read_skill_file_checked(path).ok()
}

/// Collect workspaces with their knowledge library and adoption cells.
/// `filter_ids: None` = all workspaces; `Some(ids)` = exactly those.
/// Adoption is filtered to `bundled_project_ids` so the bundle never carries
/// cells pointing at projects that don't travel with it.
fn collect_workspace_knowledge_exports(
    pool: &DbPool,
    filter_ids: Option<&[String]>,
    bundled_project_ids: &[String],
    export_warnings: &mut Vec<String>,
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
        push_truncation_warning(
            export_warnings,
            "knowledge entries",
            MAX_KNOWLEDGE_ENTRIES.min(knowledge.len()),
            knowledge.len(),
            &format!("Workspace '{name}'"),
        );
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

// ============================================================================
// Twin export collection
// ============================================================================

/// Collect digital twins with their full child graph.
///
/// `filter_ids: None` = every twin (Full scope, capped); `Some(ids)` = exactly
/// those, silently skipping unknown ones — same posture as the persona / team /
/// project selective filters.
///
/// `user_db` is the SEPARATE user database (`personas_data.db`) that hosts the
/// vector knowledge base. It is optional because every unit test drives this
/// module with only an app-DB pool; a twin whose KB cannot be reached exports
/// without it plus a warning, never as an error.
fn collect_twin_exports(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    filter_ids: Option<&[String]>,
    export_warnings: &mut Vec<String>,
) -> Result<Vec<TwinExport>, AppError> {
    if filter_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    // Very old databases predate the twin plugin entirely — treat a missing
    // table as "no twins", exactly how the KPI / dev-tools counters do.
    if conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='twin_profiles'",
            [],
            |_| Ok(()),
        )
        .is_err()
    {
        return Ok(Vec::new());
    }

    // Deliberately NOT `SELECT *`: naming the columns is what keeps `slug`,
    // `is_active` and `obsidian_subpath` out of the bundle no matter what a
    // future migration adds to the table.
    const TWIN_COLS: &str = "id, name, bio, role, languages, pronouns, training_directives, \
         knowledge_base_id, created_at, updated_at";
    type TwinRow = (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
    );
    let map_twin = |r: &rusqlite::Row<'_>| -> rusqlite::Result<TwinRow> {
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
        ))
    };

    let twin_rows: Vec<TwinRow> = match filter_ids {
        None => {
            let total: usize = conn
                .query_row("SELECT COUNT(*) FROM twin_profiles", [], |r| r.get::<_, i64>(0))
                .unwrap_or(0) as usize;
            let sql = format!("SELECT {TWIN_COLS} FROM twin_profiles ORDER BY created_at");
            let mut stmt = conn.prepare(&sql).map_err(AppError::Database)?;
            let rows = stmt.query_map([], map_twin).map_err(AppError::Database)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::Database)?);
                if out.len() >= MAX_TWINS {
                    break;
                }
            }
            push_truncation_warning(export_warnings, "twins", out.len(), total, "Twins");
            out
        }
        Some(ids) => {
            let mut unique: Vec<&String> = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for id in ids {
                if seen.insert(id.clone()) {
                    unique.push(id);
                }
            }
            push_truncation_warning(
                export_warnings,
                "selected twins",
                MAX_TWINS.min(unique.len()),
                unique.len(),
                "Twins",
            );
            let sql = format!("SELECT {TWIN_COLS} FROM twin_profiles WHERE id = ?1");
            let mut out = Vec::new();
            for id in unique.into_iter().take(MAX_TWINS) {
                let mut stmt = conn.prepare(&sql).map_err(AppError::Database)?;
                let mut rows = stmt
                    .query_map([id.as_str()], map_twin)
                    .map_err(AppError::Database)?;
                if let Some(row) = rows.next() {
                    out.push(row.map_err(AppError::Database)?);
                }
            }
            out
        }
    };

    let mut exports = Vec::with_capacity(twin_rows.len());
    for (
        id,
        name,
        bio,
        role,
        languages,
        pronouns,
        training_directives,
        knowledge_base_id,
        created_at,
        updated_at,
    ) in twin_rows
    {
        let tid = id.as_str();

        let tones = capped(
            query_rows(
                &conn,
                "SELECT id, channel, voice_directives, examples_json, constraints_json, \
                        length_hint, updated_at \
                 FROM twin_tones WHERE twin_id = ?1 ORDER BY channel",
                tid,
                |r| {
                    Ok(TwinToneExport {
                        id: r.get(0)?,
                        channel: r.get(1)?,
                        voice_directives: r.get(2)?,
                        examples_json: r.get(3)?,
                        constraints_json: r.get(4)?,
                        length_hint: r.get(5)?,
                        updated_at: r.get(6)?,
                    })
                },
            )?,
            MAX_TWIN_TONES,
            "tone profiles",
            &name,
            export_warnings,
        );

        // `summary` + `key_facts_json` are load-bearing: the Training Studio
        // stores the interview QUESTION in `summary`, so an export without it
        // keeps only half of every training pair. Newest-first so a truncated
        // history keeps the RECENT traffic, which is what a twin reasons from.
        let communications = capped(
            query_rows(
                &conn,
                "SELECT id, channel, direction, contact_handle, content, summary, \
                        key_facts_json, occurred_at, created_at \
                 FROM twin_communications WHERE twin_id = ?1 ORDER BY occurred_at DESC",
                tid,
                |r| {
                    Ok(TwinCommunicationExport {
                        id: r.get(0)?,
                        channel: r.get(1)?,
                        direction: r.get(2)?,
                        contact_handle: r.get(3)?,
                        content: r.get(4)?,
                        summary: r.get(5)?,
                        key_facts_json: r.get(6)?,
                        occurred_at: r.get(7)?,
                        created_at: r.get(8)?,
                    })
                },
            )?,
            MAX_TWIN_COMMUNICATIONS,
            "communications",
            &name,
            export_warnings,
        );

        // ALL statuses — a rejected memory plus its reviewer note records what
        // the operator refused, which is exactly the signal a re-trained twin
        // needs in order not to re-propose it.
        let pending_memories = capped(
            query_rows(
                &conn,
                "SELECT id, channel, content, title, importance, status, reviewer_notes, \
                        source_communication_id, created_at, reviewed_at \
                 FROM twin_pending_memories WHERE twin_id = ?1 ORDER BY created_at DESC",
                tid,
                |r| {
                    Ok(TwinPendingMemoryExport {
                        id: r.get(0)?,
                        channel: r.get(1)?,
                        content: r.get(2)?,
                        title: r.get(3)?,
                        importance: r.get(4)?,
                        status: r.get(5)?,
                        reviewer_notes: r.get(6)?,
                        source_communication_id: r.get(7)?,
                        created_at: r.get(8)?,
                        reviewed_at: r.get(9)?,
                    })
                },
            )?,
            MAX_TWIN_MEMORIES,
            "pending memories",
            &name,
            export_warnings,
        );

        let distilled_facts = capped(
            query_rows(
                &conn,
                "SELECT id, contact_handle, content, importance, sources_json, created_at, \
                        last_seen_at \
                 FROM twin_distilled_facts WHERE twin_id = ?1 \
                 ORDER BY importance DESC, last_seen_at DESC",
                tid,
                |r| {
                    Ok(TwinDistilledFactExport {
                        id: r.get(0)?,
                        contact_handle: r.get(1)?,
                        content: r.get(2)?,
                        importance: r.get(3)?,
                        sources_json: r.get(4)?,
                        created_at: r.get(5)?,
                        last_seen_at: r.get(6)?,
                    })
                },
            )?,
            MAX_TWIN_FACTS,
            "distilled facts",
            &name,
            export_warnings,
        );

        // Straight from the table. `list_contacts_with_activity` would hand
        // back computed `message_count` / `last_seen_at` columns that do not
        // exist here — derived values have no business in a bundle.
        let contacts = capped(
            query_rows(
                &conn,
                "SELECT id, handle, alias, notes, created_at, updated_at \
                 FROM twin_contacts WHERE twin_id = ?1 ORDER BY handle",
                tid,
                |r| {
                    Ok(TwinContactExport {
                        id: r.get(0)?,
                        handle: r.get(1)?,
                        alias: r.get(2)?,
                        notes: r.get(3)?,
                        created_at: r.get(4)?,
                        updated_at: r.get(5)?,
                    })
                },
            )?,
            MAX_TWIN_CONTACTS,
            "contacts",
            &name,
            export_warnings,
        );

        let reflections = capped(
            query_rows(
                &conn,
                "SELECT id, prompt_seed, content, created_at \
                 FROM twin_reflections WHERE twin_id = ?1 ORDER BY created_at DESC",
                tid,
                |r| {
                    Ok(TwinReflectionExport {
                        id: r.get(0)?,
                        prompt_seed: r.get(1)?,
                        content: r.get(2)?,
                        created_at: r.get(3)?,
                    })
                },
            )?,
            MAX_TWIN_REFLECTIONS,
            "reflections",
            &name,
            export_warnings,
        );

        let channels = capped(
            query_rows(
                &conn,
                "SELECT id, channel_type, credential_id, persona_id, label, is_active, \
                        created_at, updated_at \
                 FROM twin_channels WHERE twin_id = ?1 ORDER BY channel_type",
                tid,
                |r| {
                    Ok(TwinChannelExport {
                        id: r.get(0)?,
                        channel_type: r.get(1)?,
                        credential_id: r.get(2)?,
                        persona_id: r.get(3)?,
                        label: r.get(4)?,
                        is_active: r.get::<_, i32>(5)? != 0,
                        created_at: r.get(6)?,
                        updated_at: r.get(7)?,
                    })
                },
            )?,
            MAX_TWIN_CHANNELS,
            "channels",
            &name,
            export_warnings,
        );

        let knowledge_base = match knowledge_base_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => None,
            Some(kb_id) => match user_db {
                None => {
                    export_warnings.push(format!(
                        "Twin '{name}': knowledge base '{kb_id}' not exported (the vector database is not available in this context)."
                    ));
                    None
                }
                Some(udb) => match collect_twin_knowledge_base(udb, kb_id, &name, export_warnings) {
                    Ok(kb) => kb,
                    Err(e) => {
                        export_warnings.push(format!(
                            "Twin '{name}': knowledge base '{kb_id}' not exported ({e})."
                        ));
                        None
                    }
                },
            },
        };

        exports.push(TwinExport {
            id,
            name,
            bio,
            role,
            languages,
            pronouns,
            training_directives,
            created_at,
            updated_at,
            tones,
            communications,
            pending_memories,
            distilled_facts,
            contacts,
            reflections,
            channels,
            knowledge_base,
        });
    }

    Ok(exports)
}

/// Truncate a twin child collection to `cap`, recording what was dropped.
fn capped<T>(
    rows: Vec<T>,
    cap: usize,
    what: &str,
    twin_name: &str,
    export_warnings: &mut Vec<String>,
) -> Vec<T> {
    push_truncation_warning(
        export_warnings,
        what,
        cap.min(rows.len()),
        rows.len(),
        &format!("Twin '{twin_name}'"),
    );
    rows.into_iter().take(cap).collect()
}

/// Read the TEXT tier of a knowledge base out of the user database.
///
/// Never touches `kb_vec_*` or any embedding — those are a local artifact of
/// whatever embedding model this machine happens to run, and the target
/// rebuilds them from this text with its own model. `Ok(None)` means the bound
/// id no longer resolves (the KB was deleted); that is a warning, not a failure.
fn collect_twin_knowledge_base(
    user_db: &UserDbPool,
    kb_id: &str,
    twin_name: &str,
    export_warnings: &mut Vec<String>,
) -> Result<Option<TwinKnowledgeBaseExport>, AppError> {
    let conn = user_db.get()?;

    let head = conn
        .query_row(
            "SELECT id, name, description, embedding_model, embedding_dims, chunk_size, \
                    chunk_overlap, created_at, updated_at \
             FROM knowledge_bases WHERE id = ?1",
            [kb_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                ))
            },
        )
        .ok();
    let Some((
        id,
        name,
        description,
        embedding_model,
        embedding_dims,
        chunk_size,
        chunk_overlap,
        created_at,
        updated_at,
    )) = head
    else {
        export_warnings.push(format!(
            "Twin '{twin_name}': bound knowledge base '{kb_id}' no longer exists; exported without it."
        ));
        return Ok(None);
    };

    let documents = query_rows(
        &conn,
        "SELECT id, source_type, source_path, title, content_hash, byte_size, metadata_json, \
                page_count, empty_pages, status, error_message, indexed_at, created_at \
         FROM kb_documents WHERE kb_id = ?1 ORDER BY created_at",
        kb_id,
        |r| {
            Ok(KbDocumentExport {
                id: r.get(0)?,
                source_type: r.get(1)?,
                source_path: r.get(2)?,
                title: r.get(3)?,
                content_hash: r.get(4)?,
                byte_size: r.get(5)?,
                metadata_json: r.get(6)?,
                page_count: r.get(7)?,
                empty_pages: r.get(8)?,
                status: r.get(9)?,
                error_message: r.get(10)?,
                indexed_at: r.get(11)?,
                created_at: r.get(12)?,
            })
        },
    )?;
    push_truncation_warning(
        export_warnings,
        "knowledge-base documents",
        MAX_KB_DOCUMENTS.min(documents.len()),
        documents.len(),
        &format!("Twin '{twin_name}'"),
    );
    let documents: Vec<KbDocumentExport> = documents.into_iter().take(MAX_KB_DOCUMENTS).collect();
    let kept_docs: std::collections::HashSet<&str> =
        documents.iter().map(|d| d.id.as_str()).collect();

    let chunks = query_rows(
        &conn,
        "SELECT id, document_id, chunk_index, content, token_count, metadata_json, \
                source_page, extraction_confidence, created_at \
         FROM kb_chunks WHERE kb_id = ?1 ORDER BY document_id, chunk_index",
        kb_id,
        |r| {
            Ok(KbChunkExport {
                id: r.get(0)?,
                document_id: r.get(1)?,
                chunk_index: r.get(2)?,
                content: r.get(3)?,
                token_count: r.get(4)?,
                metadata_json: r.get(5)?,
                source_page: r.get(6)?,
                extraction_confidence: r.get(7)?,
                created_at: r.get(8)?,
            })
        },
    )?;
    // A chunk whose document got truncated away would import as an orphan.
    let chunks: Vec<KbChunkExport> = chunks
        .into_iter()
        .filter(|c| kept_docs.contains(c.document_id.as_str()))
        .collect();
    push_truncation_warning(
        export_warnings,
        "knowledge-base chunks",
        MAX_KB_CHUNKS.min(chunks.len()),
        chunks.len(),
        &format!("Twin '{twin_name}'"),
    );
    let chunks: Vec<KbChunkExport> = chunks.into_iter().take(MAX_KB_CHUNKS).collect();

    Ok(Some(TwinKnowledgeBaseExport {
        id,
        name,
        description,
        embedding_model,
        embedding_dims,
        chunk_size,
        chunk_overlap,
        created_at,
        updated_at,
        documents,
        chunks,
    }))
}

// ============================================================================
// Athena memory export collection
// ============================================================================

/// Does this database have the companion schema at all? Very old installs (and
/// unit tests that only apply the knowledge-base schema) do not, and that is
/// "no Athena", not an error — same posture `collect_twin_exports` takes toward
/// a missing `twin_profiles`.
fn has_companion_schema(conn: &rusqlite::Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='companion_node'",
        [],
        |_| Ok(()),
    )
    .is_ok()
}

/// Normalise a `companion_node.file_path` to a path relative to `brain_root`.
///
/// The column is relative by convention at every write site, but "by
/// convention" is not a guarantee and this value crosses machines: an absolute
/// path in a bundle names a directory on the exporting machine, and the
/// importer would create it. So an absolute path is accepted only when it sits
/// under this machine's brain root (in which case it is de-anchored), and
/// rejected otherwise.
fn relative_brain_path(file_path: &str, root: &std::path::Path) -> Option<String> {
    let p = std::path::Path::new(file_path);
    if !p.is_absolute() {
        // Reject traversal too — `../../x` re-anchored on the target would
        // write outside the brain.
        if p.components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return None;
        }
        return Some(file_path.replace('\\', "/"));
    }
    p.strip_prefix(root)
        .ok()
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

/// Collect Athena's memory for the requested tiers.
///
/// Returns `Ok(None)` when nothing was asked for, or when this machine has no
/// companion brain to read — never an error for either. Every drop (an
/// unreadable markdown body, an oversize file, a cap) is reported through
/// `export_warnings`, because a memory silently missing from a bundle is
/// indistinguishable from a memory that never existed.
fn collect_athena_export(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    tiers: AthenaTiers,
    export_warnings: &mut Vec<String>,
) -> Result<Option<AthenaMemoryExport>, AppError> {
    if !tiers.any() {
        return Ok(None);
    }
    let root = match crate::companion::disk::brain_root() {
        Ok(r) => r,
        Err(e) => {
            export_warnings.push(format!(
                "Athena: her brain directory could not be resolved ({e}); her memory was not exported."
            ));
            return Ok(None);
        }
    };

    let mut out = AthenaMemoryExport::default();

    if tiers.core {
        collect_athena_core_disk_and_prefs(pool, &root, &mut out, export_warnings);
    }

    let Some(user_db) = user_db else {
        // Identity + prefs still made it; everything else lives in the other
        // database. Say so rather than reporting a suspiciously small brain.
        if tiers.learned || tiers.core {
            export_warnings.push(
                "Athena: the brain database was not available in this context; only her identity file and preferences were exported."
                    .into(),
            );
        }
        return Ok(if out.is_empty() { None } else { Some(out) });
    };
    let conn = user_db.get()?;
    if !has_companion_schema(&conn) {
        return Ok(if out.is_empty() { None } else { Some(out) });
    }

    if tiers.core {
        collect_athena_sessions(&conn, &mut out, export_warnings)?;
    }
    if tiers.learned {
        collect_athena_learned(&conn, &root, &mut out, export_warnings)?;
    }

    Ok(if out.is_empty() { None } else { Some(out) })
}

/// `identity.md` + the three portable prefs. Neither needs the brain database:
/// identity is a file, prefs live in the SYSTEM database (`personas.db`) while
/// every `companion_*` table lives in the USER one. The two pools are the same
/// Rust type, so this split is a thing to hold in your head, not something the
/// compiler will catch.
fn collect_athena_core_disk_and_prefs(
    pool: &DbPool,
    root: &std::path::Path,
    out: &mut AthenaMemoryExport,
    export_warnings: &mut Vec<String>,
) {
    let identity_path = root.join("identity.md");
    if identity_path.is_file() {
        match std::fs::read_to_string(&identity_path) {
            Ok(body) if body.len() > MAX_IDENTITY_BYTES => export_warnings.push(format!(
                "Athena: identity.md is {} bytes, over the {MAX_IDENTITY_BYTES}-byte cap; it was not exported.",
                body.len()
            )),
            Ok(body) => out.identity_md = Some(body),
            Err(e) => export_warnings.push(format!(
                "Athena: identity.md could not be read ({e}); it was not exported."
            )),
        }
    }

    for key in ATHENA_PORTABLE_PREF_KEYS {
        if let Ok(Some(value)) = settings_repo::get(pool, key) {
            out.prefs.push(AthenaPrefExport {
                key: key.to_string(),
                value,
            });
        }
    }
}

/// The conversation roster. `claude_session_id` is named in the SELECT's
/// absence on purpose: it is a `--resume` handle into a CLI process on the
/// exporting machine, so carrying it would at best resume nothing and at worst
/// attach a foreign conversation.
fn collect_athena_sessions(
    conn: &rusqlite::Connection,
    out: &mut AthenaMemoryExport,
    export_warnings: &mut Vec<String>,
) -> Result<(), AppError> {
    let total: usize = conn
        .query_row("SELECT COUNT(*) FROM companion_session", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0)
        .max(0) as usize;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, pinned, origin, status FROM companion_session \
             ORDER BY pinned DESC, last_active_at DESC",
        )
        .map_err(AppError::Database)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AthenaSessionExport {
                id: r.get(0)?,
                title: r.get(1)?,
                pinned: r.get(2)?,
                origin: r.get(3)?,
                status: r.get(4)?,
            })
        })
        .map_err(AppError::Database)?;
    for row in rows {
        out.sessions.push(row.map_err(AppError::Database)?);
        if out.sessions.len() >= MAX_ATHENA_SESSIONS {
            break;
        }
    }
    push_truncation_warning(
        export_warnings,
        "conversations",
        out.sessions.len(),
        total,
        "Athena",
    );
    Ok(())
}

/// Per-kind cap for a learned node kind.
fn athena_cap_for(kind: &str) -> usize {
    match kind {
        "fact" => MAX_ATHENA_FACTS,
        "procedural" => MAX_ATHENA_PROCEDURALS,
        "goal" => MAX_ATHENA_GOALS,
        "backlog" => MAX_ATHENA_BACKLOG,
        "ritual" => MAX_ATHENA_RITUALS,
        _ => 0,
    }
}

/// Nodes + markdown + every sidecar table.
///
/// The nodes are gathered FIRST and everything else is filtered to the ids that
/// survived, so a node dropped for an unreadable body cannot leave a widowed
/// `companion_fact` row behind. Order matters here in a way it does not for the
/// flatter sections of this bundle.
fn collect_athena_learned(
    conn: &rusqlite::Connection,
    root: &std::path::Path,
    out: &mut AthenaMemoryExport,
    export_warnings: &mut Vec<String>,
) -> Result<(), AppError> {
    let kinds = athena_kind_list();

    // Per-kind totals for the truncation forecast, before any filtering.
    let mut totals: HashMap<String, usize> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT kind, COUNT(*) FROM companion_node WHERE kind IN ({kinds}) GROUP BY kind"
            ))
            .map_err(AppError::Database)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(AppError::Database)?;
        for row in rows {
            let (kind, n) = row.map_err(AppError::Database)?;
            totals.insert(kind, n.max(0) as usize);
        }
    }

    // Highest-importance first, so a capped export keeps what matters most
    // rather than whatever happens to be oldest.
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, kind, file_path, content_hash, importance, body_excerpt, created_at, \
                    updated_at, session_id \
             FROM companion_node WHERE kind IN ({kinds}) \
             ORDER BY kind, importance DESC, updated_at DESC"
        ))
        .map_err(AppError::Database)?;
    type NodeRow = (
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        String,
        String,
        Option<String>,
    );
    let rows = stmt
        .query_map([], |r| {
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
            ))
        })
        .map_err(AppError::Database)?;

    let mut kept_per_kind: HashMap<String, usize> = HashMap::new();
    // Nodes dropped for a bad body, per kind. Subtracted from the cap forecast
    // below so a memory is never reported twice — once by name and again as an
    // anonymous cap casualty.
    let mut dropped_per_kind: HashMap<String, usize> = HashMap::new();
    for row in rows {
        let (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at, session_id): NodeRow =
            row.map_err(AppError::Database)?;
        let cap = athena_cap_for(&kind);
        let kept = kept_per_kind.entry(kind.clone()).or_insert(0);
        if *kept >= cap {
            continue;
        }
        let Some(rel_path) = relative_brain_path(&file_path, root) else {
            export_warnings.push(format!(
                "Athena: {kind} '{id}' points outside her brain directory ('{file_path}'); not exported."
            ));
            *dropped_per_kind.entry(kind).or_insert(0) += 1;
            continue;
        };
        let abs = root.join(&rel_path);
        let body = match std::fs::read_to_string(&abs) {
            Ok(b) if b.len() > MAX_ATHENA_MD_FILE_BYTES => {
                export_warnings.push(format!(
                    "Athena: {kind} '{id}' is {} bytes, over the {MAX_ATHENA_MD_FILE_BYTES}-byte per-memory cap; not exported.",
                    b.len()
                ));
                *dropped_per_kind.entry(kind).or_insert(0) += 1;
                continue;
            }
            Ok(b) => b,
            Err(e) => {
                // The markdown IS the memory; the row is only an index over it.
                // Exporting the row alone would move a pointer to nothing.
                export_warnings.push(format!(
                    "Athena: {kind} '{id}' has no readable body at '{rel_path}' ({e}); not exported."
                ));
                *dropped_per_kind.entry(kind).or_insert(0) += 1;
                continue;
            }
        };
        *kept += 1;
        out.nodes.push(AthenaNodeExport {
            id,
            kind,
            file_path: rel_path,
            content_hash,
            importance,
            body_excerpt,
            created_at,
            updated_at,
            session_id,
            body,
        });
    }
    drop(stmt);

    for kind in ATHENA_LEARNED_KINDS {
        let total = totals.get(kind).copied().unwrap_or(0);
        let dropped = dropped_per_kind.get(kind).copied().unwrap_or(0);
        push_truncation_warning(
            export_warnings,
            kind,
            kept_per_kind.get(kind).copied().unwrap_or(0),
            total.saturating_sub(dropped),
            "Athena",
        );
    }

    let kept_ids: std::collections::HashSet<String> =
        out.nodes.iter().map(|n| n.id.clone()).collect();

    collect_athena_sidecars(conn, &kept_ids, out)?;

    // Design decisions have no node and no file — the one learned table that is
    // pure DB. Capped on its own.
    let total_decisions: usize = conn
        .query_row("SELECT COUNT(*) FROM companion_design_decision", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0)
        .max(0) as usize;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, persona_context, label, choice, rationale, \
                    decision_timestamp, created_at \
             FROM companion_design_decision ORDER BY created_at DESC",
        )
        .map_err(AppError::Database)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AthenaDecisionExport {
                id: r.get(0)?,
                session_id: r.get(1)?,
                persona_context: r.get(2)?,
                label: r.get(3)?,
                choice: r.get(4)?,
                rationale: r.get(5)?,
                decision_timestamp: r.get(6)?,
                created_at: r.get(7)?,
            })
        })
        .map_err(AppError::Database)?;
    for row in rows {
        out.decisions.push(row.map_err(AppError::Database)?);
        if out.decisions.len() >= MAX_ATHENA_DECISIONS {
            break;
        }
    }
    push_truncation_warning(
        export_warnings,
        "design decisions",
        out.decisions.len(),
        total_decisions,
        "Athena",
    );

    Ok(())
}

/// Every sidecar table, filtered to the nodes that actually made it.
fn collect_athena_sidecars(
    conn: &rusqlite::Connection,
    kept_ids: &std::collections::HashSet<String>,
    out: &mut AthenaMemoryExport,
) -> Result<(), AppError> {
    /// `$key` names the field that has to be in `kept_ids` for the row to
    /// travel — always the owning node's id, spelled `fact_id` in the
    /// provenance table.
    macro_rules! sweep {
        ($sql:expr, $target:expr, $key:ident, $map:expr) => {{
            let mut stmt = conn.prepare($sql).map_err(AppError::Database)?;
            let rows = stmt.query_map([], $map).map_err(AppError::Database)?;
            for row in rows {
                let row = row.map_err(AppError::Database)?;
                if kept_ids.contains(row.$key.as_str()) {
                    $target.push(row);
                }
            }
        }};
    }

    sweep!(
        "SELECT id, scope, fact_key, confidence, supersedes_id, contradicts_id, last_seen_at, \
                last_decayed_at FROM companion_fact",
        out.facts,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaFactExport {
            id: r.get(0)?,
            scope: r.get(1)?,
            fact_key: r.get(2)?,
            confidence: r.get(3)?,
            supersedes_id: r.get(4)?,
            contradicts_id: r.get(5)?,
            last_seen_at: r.get(6)?,
            last_decayed_at: r.get(7)?,
        })
    );
    sweep!(
        "SELECT id, scope, trigger_pattern, confidence, supersedes_id, last_used_at, \
                last_decayed_at FROM companion_procedural",
        out.procedurals,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaProceduralExport {
            id: r.get(0)?,
            scope: r.get(1)?,
            trigger_pattern: r.get(2)?,
            confidence: r.get(3)?,
            supersedes_id: r.get(4)?,
            last_used_at: r.get(5)?,
            last_decayed_at: r.get(6)?,
        })
    );
    sweep!(
        "SELECT id, title, status, priority, target_date, sources_json, completed_at, \
                created_at, updated_at FROM companion_goal",
        out.goals,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaGoalExport {
            id: r.get(0)?,
            title: r.get(1)?,
            status: r.get(2)?,
            priority: r.get(3)?,
            target_date: r.get(4)?,
            sources_json: r.get(5)?,
            completed_at: r.get(6)?,
            created_at: r.get(7)?,
            updated_at: r.get(8)?,
        })
    );
    sweep!(
        "SELECT id, summary, kind, status, source_episode_id, reminded_count, created_at, \
                resolved_at FROM companion_backlog_item",
        out.backlog,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaBacklogExport {
            id: r.get(0)?,
            summary: r.get(1)?,
            kind: r.get(2)?,
            status: r.get(3)?,
            source_episode_id: r.get(4)?,
            reminded_count: r.get(5)?,
            created_at: r.get(6)?,
            resolved_at: r.get(7)?,
        })
    );
    sweep!(
        "SELECT id, kind, description, schedule_json, active, sources_json, created_at, \
                updated_at FROM companion_ritual",
        out.rituals,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaRitualExport {
            id: r.get(0)?,
            kind: r.get(1)?,
            description: r.get(2)?,
            schedule_json: r.get(3)?,
            active: r.get(4)?,
            sources_json: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    );
    // `fact_id` is overloaded — it holds proc_* ids too — so filtering on the
    // kept-node set covers both tiers with one sweep.
    sweep!(
        "SELECT fact_id, episode_id FROM companion_provenance",
        out.provenance,
        fact_id,
        |r: &rusqlite::Row<'_>| Ok(AthenaProvenanceExport {
            fact_id: r.get(0)?,
            episode_id: r.get(1)?,
        })
    );

    Ok(())
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
    validation::require_max_count("twins", &bundle.twins, MAX_TWINS)?;
    validate_twins(bundle)?;
    validate_athena(bundle)?;
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

/// Per-field validation of the twin section.
///
/// Deliberately NOT modelled on the count-only precedent used by
/// `dev_projects` / `workspace_knowledge`: a section that checks array sizes
/// but never string lengths is an unbounded-string import path, and a twin's
/// bundle is mostly free text (communications, memories, KB chunks). Every
/// text column that reaches the DB is bounded here.
fn validate_twins(bundle: &PortabilityBundle) -> Result<(), AppError> {
    const TWIN_STATUSES: [&str; 3] = ["pending", "approved", "rejected"];
    const TWIN_DIRECTIONS: [&str; 2] = ["in", "out"];

    for (i, tw) in bundle.twins.iter().enumerate() {
        let p = format!("twin[{i}]");
        validation::require_non_empty(&format!("{p}.name"), &tw.name)?;
        validation::require_max_len(&format!("{p}.name"), &tw.name, MAX_NAME_LEN)?;
        validation::require_optional_max_len(&format!("{p}.bio"), &tw.bio, MAX_DESIGN_CONTEXT_LEN)?;
        validation::require_optional_max_len(&format!("{p}.role"), &tw.role, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(
            &format!("{p}.languages"),
            &tw.languages,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.pronouns"),
            &tw.pronouns,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.training_directives"),
            &tw.training_directives,
            MAX_DESIGN_CONTEXT_LEN,
        )?;

        validation::require_max_count(&format!("{p}.tones"), &tw.tones, MAX_TWIN_TONES)?;
        validation::require_max_count(
            &format!("{p}.communications"),
            &tw.communications,
            MAX_TWIN_COMMUNICATIONS,
        )?;
        validation::require_max_count(
            &format!("{p}.pending_memories"),
            &tw.pending_memories,
            MAX_TWIN_MEMORIES,
        )?;
        validation::require_max_count(
            &format!("{p}.distilled_facts"),
            &tw.distilled_facts,
            MAX_TWIN_FACTS,
        )?;
        validation::require_max_count(&format!("{p}.contacts"), &tw.contacts, MAX_TWIN_CONTACTS)?;
        validation::require_max_count(
            &format!("{p}.reflections"),
            &tw.reflections,
            MAX_TWIN_REFLECTIONS,
        )?;
        validation::require_max_count(&format!("{p}.channels"), &tw.channels, MAX_TWIN_CHANNELS)?;

        for (j, t) in tw.tones.iter().enumerate() {
            let q = format!("{p}.tone[{j}]");
            validation::require_max_len(&format!("{q}.channel"), &t.channel, MAX_SHORT_FIELD_LEN)?;
            validation::require_max_len(
                &format!("{q}.voice_directives"),
                &t.voice_directives,
                MAX_DESIGN_CONTEXT_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.examples_json"),
                &t.examples_json,
                MAX_CONFIG_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.constraints_json"),
                &t.constraints_json,
                MAX_CONFIG_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.length_hint"),
                &t.length_hint,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        for (j, c) in tw.communications.iter().enumerate() {
            let q = format!("{p}.communication[{j}]");
            validation::require_max_len(&format!("{q}.channel"), &c.channel, MAX_SHORT_FIELD_LEN)?;
            if !TWIN_DIRECTIONS.contains(&c.direction.as_str()) {
                return Err(AppError::Validation(format!(
                    "{q}.direction must be one of {TWIN_DIRECTIONS:?}, got '{}'",
                    c.direction
                )));
            }
            validation::require_optional_max_len(
                &format!("{q}.contact_handle"),
                &c.contact_handle,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.content"),
                &c.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.summary"),
                &c.summary,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.key_facts_json"),
                &c.key_facts_json,
                MAX_CONFIG_LEN,
            )?;
        }

        for (j, m) in tw.pending_memories.iter().enumerate() {
            let q = format!("{p}.pending_memory[{j}]");
            validation::require_optional_max_len(
                &format!("{q}.channel"),
                &m.channel,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.content"),
                &m.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_optional_max_len(&format!("{q}.title"), &m.title, MAX_NAME_LEN)?;
            if !TWIN_STATUSES.contains(&m.status.as_str()) {
                return Err(AppError::Validation(format!(
                    "{q}.status must be one of {TWIN_STATUSES:?}, got '{}'",
                    m.status
                )));
            }
            validation::require_optional_max_len(
                &format!("{q}.reviewer_notes"),
                &m.reviewer_notes,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.source_communication_id"),
                &m.source_communication_id,
                MAX_SHORT_FIELD_LEN,
            )?;
        }

        for (j, f) in tw.distilled_facts.iter().enumerate() {
            let q = format!("{p}.distilled_fact[{j}]");
            validation::require_optional_max_len(
                &format!("{q}.contact_handle"),
                &f.contact_handle,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.content"),
                &f.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.sources_json"),
                &f.sources_json,
                MAX_CONFIG_LEN,
            )?;
        }

        for (j, c) in tw.contacts.iter().enumerate() {
            let q = format!("{p}.contact[{j}]");
            validation::require_non_empty(&format!("{q}.handle"), &c.handle)?;
            validation::require_max_len(&format!("{q}.handle"), &c.handle, MAX_SHORT_FIELD_LEN)?;
            validation::require_optional_max_len(&format!("{q}.alias"), &c.alias, MAX_NAME_LEN)?;
            validation::require_optional_max_len(
                &format!("{q}.notes"),
                &c.notes,
                MAX_MEMORY_CONTENT_LEN,
            )?;
        }

        for (j, r) in tw.reflections.iter().enumerate() {
            let q = format!("{p}.reflection[{j}]");
            validation::require_max_len(
                &format!("{q}.prompt_seed"),
                &r.prompt_seed,
                MAX_DESCRIPTION_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.content"),
                &r.content,
                MAX_MEMORY_CONTENT_LEN,
            )?;
        }

        for (j, c) in tw.channels.iter().enumerate() {
            let q = format!("{p}.channel[{j}]");
            validation::require_non_empty(&format!("{q}.channel_type"), &c.channel_type)?;
            validation::require_max_len(
                &format!("{q}.channel_type"),
                &c.channel_type,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.credential_id"),
                &c.credential_id,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(
                &format!("{q}.persona_id"),
                &c.persona_id,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_optional_max_len(&format!("{q}.label"), &c.label, MAX_NAME_LEN)?;
        }

        if let Some(kb) = &tw.knowledge_base {
            let q = format!("{p}.knowledge_base");
            validation::require_non_empty(&format!("{q}.name"), &kb.name)?;
            validation::require_max_len(&format!("{q}.name"), &kb.name, MAX_NAME_LEN)?;
            validation::require_optional_max_len(
                &format!("{q}.description"),
                &kb.description,
                MAX_DESCRIPTION_LEN,
            )?;
            validation::require_max_len(
                &format!("{q}.embedding_model"),
                &kb.embedding_model,
                MAX_SHORT_FIELD_LEN,
            )?;
            validation::require_max_count(
                &format!("{q}.documents"),
                &kb.documents,
                MAX_KB_DOCUMENTS,
            )?;
            validation::require_max_count(&format!("{q}.chunks"), &kb.chunks, MAX_KB_CHUNKS)?;

            for (j, d) in kb.documents.iter().enumerate() {
                let r = format!("{q}.document[{j}]");
                validation::require_max_len(&format!("{r}.title"), &d.title, MAX_NAME_LEN)?;
                validation::require_max_len(
                    &format!("{r}.source_type"),
                    &d.source_type,
                    MAX_SHORT_FIELD_LEN,
                )?;
                validation::require_optional_max_len(
                    &format!("{r}.source_path"),
                    &d.source_path,
                    MAX_DESCRIPTION_LEN,
                )?;
                validation::require_max_len(
                    &format!("{r}.content_hash"),
                    &d.content_hash,
                    MAX_SHORT_FIELD_LEN,
                )?;
                validation::require_optional_max_len(
                    &format!("{r}.metadata_json"),
                    &d.metadata_json,
                    MAX_CONFIG_LEN,
                )?;
                validation::require_max_len(
                    &format!("{r}.status"),
                    &d.status,
                    MAX_SHORT_FIELD_LEN,
                )?;
                validation::require_optional_max_len(
                    &format!("{r}.error_message"),
                    &d.error_message,
                    MAX_DESCRIPTION_LEN,
                )?;
            }

            for (j, c) in kb.chunks.iter().enumerate() {
                let r = format!("{q}.chunk[{j}]");
                validation::require_max_len(
                    &format!("{r}.content"),
                    &c.content,
                    MAX_MEMORY_CONTENT_LEN,
                )?;
                validation::require_optional_max_len(
                    &format!("{r}.metadata_json"),
                    &c.metadata_json,
                    MAX_CONFIG_LEN,
                )?;
            }
        }
    }

    Ok(())
}

/// Per-field validation of Athena's section.
///
/// Two things here are load-bearing rather than defensive.
///
/// **Pref keys are a whitelist.** The import writes straight into
/// `app_settings`; without this check a crafted bundle could set any setting in
/// the app. `apply_athena_prefs` re-checks, because a security boundary
/// enforced in exactly one place is a security boundary one refactor from
/// disappearing.
///
/// **Enum values are checked against the parsers that will read them.**
/// `FactScope::parse`, `ProceduralScope::parse`, `BacklogKind::parse` and
/// `RitualKind::parse` all hard-error on an unknown string, so a row with a
/// bogus scope would import cleanly and then break `list_facts` at read time —
/// a failure with no visible connection to the import that caused it.
fn validate_athena(bundle: &PortabilityBundle) -> Result<(), AppError> {
    const FACT_SCOPES: [&str; 3] = ["user", "project", "world"];
    const PROCEDURAL_SCOPES: [&str; 4] = ["chat", "action", "memory", "build"];
    const GOAL_STATUSES: [&str; 4] = ["active", "paused", "completed", "abandoned"];
    const BACKLOG_KINDS: [&str; 2] = ["self_promise", "capability_gap"];
    const BACKLOG_STATUSES: [&str; 3] = ["pending", "done", "dropped"];
    const RITUAL_KINDS: [&str; 3] = ["quiet_hours", "cadence", "focus_window"];

    let Some(a) = bundle.athena.as_ref() else {
        return Ok(());
    };

    fn one_of(field: &str, value: &str, allowed: &[&str]) -> Result<(), AppError> {
        if allowed.contains(&value) {
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "{field}: '{value}' is not one of ({})",
                allowed.join("|")
            )))
        }
    }

    validation::require_max_count("athena.facts", &a.facts, MAX_ATHENA_FACTS)?;
    validation::require_max_count("athena.procedurals", &a.procedurals, MAX_ATHENA_PROCEDURALS)?;
    validation::require_max_count("athena.goals", &a.goals, MAX_ATHENA_GOALS)?;
    validation::require_max_count("athena.backlog", &a.backlog, MAX_ATHENA_BACKLOG)?;
    validation::require_max_count("athena.rituals", &a.rituals, MAX_ATHENA_RITUALS)?;
    validation::require_max_count("athena.decisions", &a.decisions, MAX_ATHENA_DECISIONS)?;
    validation::require_max_count("athena.sessions", &a.sessions, MAX_ATHENA_SESSIONS)?;
    // One node per learned row, so the node cap is the sum of the sidecar caps.
    validation::require_max_count(
        "athena.nodes",
        &a.nodes,
        MAX_ATHENA_FACTS
            + MAX_ATHENA_PROCEDURALS
            + MAX_ATHENA_GOALS
            + MAX_ATHENA_BACKLOG
            + MAX_ATHENA_RITUALS,
    )?;
    // Provenance is many-to-one against nodes; bound it against the same
    // ceiling rather than leaving the one unbounded array in the section.
    validation::require_max_count(
        "athena.provenance",
        &a.provenance,
        (MAX_ATHENA_FACTS + MAX_ATHENA_PROCEDURALS) * 8,
    )?;

    if let Some(identity) = a.identity_md.as_deref() {
        validation::require_max_len("athena.identity_md", identity, MAX_IDENTITY_BYTES)?;
    }

    for (i, p) in a.prefs.iter().enumerate() {
        if !ATHENA_PORTABLE_PREF_KEYS.contains(&p.key.as_str()) {
            return Err(AppError::Validation(format!(
                "athena.pref[{i}]: '{}' is not a portable Athena preference. Only ({}) may be carried in a bundle.",
                p.key,
                ATHENA_PORTABLE_PREF_KEYS.join("|")
            )));
        }
        validation::require_max_len(&format!("athena.pref[{i}].value"), &p.value, MAX_CONFIG_LEN)?;
    }

    for (i, s) in a.sessions.iter().enumerate() {
        let p = format!("athena.session[{i}]");
        validation::require_non_empty(&format!("{p}.id"), &s.id)?;
        validation::require_max_len(&format!("{p}.id"), &s.id, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("{p}.title"), &s.title, MAX_NAME_LEN)?;
        validation::require_max_len(&format!("{p}.origin"), &s.origin, MAX_SHORT_FIELD_LEN)?;
        validation::require_max_len(&format!("{p}.status"), &s.status, MAX_SHORT_FIELD_LEN)?;
    }

    for (i, n) in a.nodes.iter().enumerate() {
        let p = format!("athena.node[{i}]");
        validation::require_non_empty(&format!("{p}.id"), &n.id)?;
        validation::require_max_len(&format!("{p}.id"), &n.id, MAX_SHORT_FIELD_LEN)?;
        one_of(&format!("{p}.kind"), &n.kind, &ATHENA_LEARNED_KINDS)?;
        validation::require_non_empty(&format!("{p}.file_path"), &n.file_path)?;
        validation::require_max_len(&format!("{p}.file_path"), &n.file_path, MAX_DESCRIPTION_LEN)?;
        // The import re-anchors this onto THIS machine's brain root, so an
        // absolute path or a traversal would write outside it.
        if std::path::Path::new(&n.file_path).is_absolute() || n.file_path.contains("..") {
            return Err(AppError::Validation(format!(
                "{p}.file_path: '{}' must be relative to the brain directory",
                n.file_path
            )));
        }
        validation::require_max_len(
            &format!("{p}.content_hash"),
            &n.content_hash,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_max_len(&format!("{p}.body"), &n.body, MAX_ATHENA_MD_FILE_BYTES)?;
        validation::require_optional_max_len(
            &format!("{p}.body_excerpt"),
            &n.body_excerpt,
            MAX_MEMORY_CONTENT_LEN,
        )?;
        if !(0..=5).contains(&n.importance) {
            return Err(AppError::Validation(format!(
                "{p}.importance: {} is outside 0..=5",
                n.importance
            )));
        }
    }

    for (i, f) in a.facts.iter().enumerate() {
        let p = format!("athena.fact[{i}]");
        validation::require_max_len(&format!("{p}.id"), &f.id, MAX_SHORT_FIELD_LEN)?;
        one_of(&format!("{p}.scope"), &f.scope, &FACT_SCOPES)?;
        validation::require_non_empty(&format!("{p}.fact_key"), &f.fact_key)?;
        validation::require_max_len(&format!("{p}.fact_key"), &f.fact_key, MAX_NAME_LEN)?;
        validation::require_optional_max_len(
            &format!("{p}.supersedes_id"),
            &f.supersedes_id,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.contradicts_id"),
            &f.contradicts_id,
            MAX_SHORT_FIELD_LEN,
        )?;
        if !(0.0..=1.0).contains(&f.confidence) {
            return Err(AppError::Validation(format!(
                "{p}.confidence: {} is outside 0.0..=1.0",
                f.confidence
            )));
        }
    }

    for (i, r) in a.procedurals.iter().enumerate() {
        let p = format!("athena.procedural[{i}]");
        validation::require_max_len(&format!("{p}.id"), &r.id, MAX_SHORT_FIELD_LEN)?;
        one_of(&format!("{p}.scope"), &r.scope, &PROCEDURAL_SCOPES)?;
        validation::require_non_empty(&format!("{p}.trigger_pattern"), &r.trigger_pattern)?;
        validation::require_max_len(
            &format!("{p}.trigger_pattern"),
            &r.trigger_pattern,
            MAX_MEMORY_CONTENT_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.supersedes_id"),
            &r.supersedes_id,
            MAX_SHORT_FIELD_LEN,
        )?;
        if !(0.0..=1.0).contains(&r.confidence) {
            return Err(AppError::Validation(format!(
                "{p}.confidence: {} is outside 0.0..=1.0",
                r.confidence
            )));
        }
    }

    for (i, g) in a.goals.iter().enumerate() {
        let p = format!("athena.goal[{i}]");
        validation::require_max_len(&format!("{p}.id"), &g.id, MAX_SHORT_FIELD_LEN)?;
        validation::require_non_empty(&format!("{p}.title"), &g.title)?;
        validation::require_max_len(&format!("{p}.title"), &g.title, MAX_MEMORY_CONTENT_LEN)?;
        one_of(&format!("{p}.status"), &g.status, &GOAL_STATUSES)?;
        validation::require_max_len(
            &format!("{p}.sources_json"),
            &g.sources_json,
            MAX_CONFIG_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.target_date"),
            &g.target_date,
            MAX_SHORT_FIELD_LEN,
        )?;
    }

    for (i, b) in a.backlog.iter().enumerate() {
        let p = format!("athena.backlog[{i}]");
        validation::require_max_len(&format!("{p}.id"), &b.id, MAX_SHORT_FIELD_LEN)?;
        validation::require_non_empty(&format!("{p}.summary"), &b.summary)?;
        validation::require_max_len(&format!("{p}.summary"), &b.summary, MAX_MEMORY_CONTENT_LEN)?;
        one_of(&format!("{p}.kind"), &b.kind, &BACKLOG_KINDS)?;
        one_of(&format!("{p}.status"), &b.status, &BACKLOG_STATUSES)?;
        validation::require_optional_max_len(
            &format!("{p}.source_episode_id"),
            &b.source_episode_id,
            MAX_SHORT_FIELD_LEN,
        )?;
    }

    for (i, r) in a.rituals.iter().enumerate() {
        let p = format!("athena.ritual[{i}]");
        validation::require_max_len(&format!("{p}.id"), &r.id, MAX_SHORT_FIELD_LEN)?;
        one_of(&format!("{p}.kind"), &r.kind, &RITUAL_KINDS)?;
        validation::require_non_empty(&format!("{p}.description"), &r.description)?;
        validation::require_max_len(
            &format!("{p}.description"),
            &r.description,
            MAX_MEMORY_CONTENT_LEN,
        )?;
        validation::require_max_len(
            &format!("{p}.schedule_json"),
            &r.schedule_json,
            MAX_CONFIG_LEN,
        )?;
        validation::require_max_len(
            &format!("{p}.sources_json"),
            &r.sources_json,
            MAX_CONFIG_LEN,
        )?;
    }

    for (i, d) in a.decisions.iter().enumerate() {
        let p = format!("athena.decision[{i}]");
        validation::require_max_len(&format!("{p}.id"), &d.id, MAX_SHORT_FIELD_LEN)?;
        validation::require_max_len(&format!("{p}.session_id"), &d.session_id, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(
            &format!("{p}.persona_context"),
            &d.persona_context,
            MAX_NAME_LEN,
        )?;
        validation::require_non_empty(&format!("{p}.label"), &d.label)?;
        validation::require_max_len(&format!("{p}.label"), &d.label, MAX_MEMORY_CONTENT_LEN)?;
        validation::require_max_len(&format!("{p}.choice"), &d.choice, MAX_MEMORY_CONTENT_LEN)?;
        validation::require_max_len(
            &format!("{p}.rationale"),
            &d.rationale,
            MAX_MEMORY_CONTENT_LEN,
        )?;
    }

    for (i, pr) in a.provenance.iter().enumerate() {
        let p = format!("athena.provenance[{i}]");
        validation::require_non_empty(&format!("{p}.fact_id"), &pr.fact_id)?;
        validation::require_max_len(&format!("{p}.fact_id"), &pr.fact_id, MAX_SHORT_FIELD_LEN)?;
        validation::require_non_empty(&format!("{p}.episode_id"), &pr.episode_id)?;
        validation::require_max_len(
            &format!("{p}.episode_id"),
            &pr.episode_id,
            MAX_SHORT_FIELD_LEN,
        )?;
    }

    Ok(())
}

/// `resolutions` is the flat conflict-resolution map keyed `"<kind>:<id>"`
/// (see [`ImportConflict`]). `user_db` is the separate user database that
/// hosts knowledge bases; `None` (unit tests, or a caller without one) simply
/// means a bundled KB is reported as un-importable rather than silently lost.
fn import_bundle(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    bundle: &PortabilityBundle,
    resolutions: &HashMap<String, String>,
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
        twins_imported: 0,
        twins_skipped: 0,
        twin_kb_chunks_imported: 0,
        athena_memory_imported: 0,
        athena_identity_replaced: false,
        reembed_queued: 0,
        import_conflicts: Vec::new(),
        bundle_file_path: None,
        warnings: Vec::new(),
        id_mapping: std::collections::HashMap::new(),
        pending_kb_reindex: Vec::new(),
    };

    let now = chrono::Utc::now().to_rfc3339();

    // A non-empty resolutions map marks the second (resolution) pass of the
    // two-pass conflict flow: the non-conflicting sections were already
    // imported on pass 1, so only the resolved entities (plus their adoption
    // cells / skills) are processed. The workspace-knowledge phase still runs
    // — its id/dedup checks make it idempotent — so the knowledge id map is
    // available for adoption cells of the newly resolved projects.
    let is_resolution_pass = !resolutions.is_empty();

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
        let resolution = resolutions
            .get(&conflict_key("project", &p.id))
            .map(String::as_str);
        if is_resolution_pass && resolution.is_none() {
            // Pass 2 touches only the projects the caller resolved; everything
            // else was handled (imported or conflict-listed) on pass 1.
            continue;
        }

        let conflict = find_project_conflict(&tx, p);
        let mode = match (&conflict, resolution) {
            (Some((existing_id, matched_by)), None) => {
                result.import_conflicts.push(ImportConflict {
                    kind: "project".into(),
                    bundle_id: p.id.clone(),
                    name: p.name.clone(),
                    detail: Some(p.root_path.clone()),
                    existing_id: existing_id.clone(),
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

    // Phase 10: Twins. Same two-pass conflict flow as dev projects, keyed
    // `"twin:<bundle id>"`. Everything lands under FRESH uuids (a twin id has
    // no external meaning), so the whole soft-ref graph is remapped. A twin's
    // knowledge base is NOT written here: it lives in the other database, so
    // it is queued and created after this transaction commits.
    let mut pending_twin_kbs: Vec<(String, usize)> = Vec::new(); // (target twin id, bundle index)
    for (idx, tw) in bundle.twins.iter().enumerate() {
        let resolution = resolutions
            .get(&conflict_key("twin", &tw.id))
            .map(String::as_str);
        if is_resolution_pass && resolution.is_none() {
            continue;
        }

        let conflict = find_twin_conflict(&tx, tw);
        let mode = match (&conflict, resolution) {
            (Some(existing_id), None) => {
                result.import_conflicts.push(ImportConflict {
                    kind: "twin".into(),
                    bundle_id: tw.id.clone(),
                    name: tw.name.clone(),
                    detail: None,
                    existing_id: existing_id.clone(),
                    matched_by: "name".into(),
                });
                continue;
            }
            (Some(_), Some("skip")) => {
                result.twins_skipped += 1;
                continue;
            }
            (Some(existing_id), Some("replace")) => TwinImportMode::Replace {
                existing_id: existing_id.clone(),
            },
            (Some(_), Some("duplicate")) => TwinImportMode::Duplicate,
            (None, _) => TwinImportMode::Fresh,
            (Some(_), Some(other)) => {
                result.warnings.push(format!(
                    "Twin '{}': unknown resolution '{}'; not imported",
                    tw.name, other
                ));
                continue;
            }
        };

        match import_twin(&tx, tw, &mode, &now, &mut result) {
            Some(target_id) => {
                result.twins_imported += 1;
                if tw.knowledge_base.is_some() {
                    pending_twin_kbs.push((target_id, idx));
                }
            }
            None => { /* row-level failure already surfaced as a warning */ }
        }
    }

    // Commit the transaction -- all entities are persisted atomically.
    // If anything above returned a hard error (not a warning), we would
    // have already returned Err and the transaction would roll back on drop.
    tx.commit().map_err(AppError::Database)?;

    // Phase 11 (post-commit, filesystem): write imported skills under each
    // project's `<root_path>/.claude/skills/`. Deliberately after the commit —
    // disk must never change for a rolled-back import.
    for (root_path, overwrite, idx) in pending_skills {
        write_project_skills(&root_path, &bundle.dev_projects[idx].skills, overwrite, &mut result);
    }

    // Phase 12 (post-commit, other database): recreate each imported twin's
    // knowledge base in the USER database and rebind the profile to it. Same
    // reasoning as the skills phase — a rolled-back import must not leave
    // orphan rows in a store the transaction above could not cover.
    for (twin_id, idx) in pending_twin_kbs {
        let tw = &bundle.twins[idx];
        let Some(kb) = tw.knowledge_base.as_ref() else {
            continue;
        };
        let Some(udb) = user_db else {
            result.warnings.push(format!(
                "Twin '{}': knowledge base '{}' not imported (the vector database is not available in this context).",
                tw.name, kb.name
            ));
            continue;
        };
        match import_twin_knowledge_base(pool, udb, &twin_id, kb, &now) {
            Ok(landed) => {
                result.twin_kb_chunks_imported += landed.chunks_imported;
                result.pending_kb_reindex.push(landed.kb_id);
                // A "replace" onto a twin that already had a KB rebinds it to
                // the incoming one. Say so, and name the old id: an orphaned
                // vector store can be gigabytes, and silently leaking it is
                // worse than asking the user to delete it in Connections.
                if let Some(old) = landed.replaced_kb_id {
                    result.warnings.push(format!(
                        "Twin '{}': was bound to knowledge base '{old}', now bound to the imported one. The old base is still in Connections — delete it there if you no longer need it.",
                        tw.name
                    ));
                }
            }
            Err(e) => result.warnings.push(format!(
                "Twin '{}': knowledge base '{}' could not be imported ({e}); the twin was imported without it.",
                tw.name, kb.name
            )),
        }
    }

    // Phase 13 (post-commit, other database + filesystem): Athena's memory.
    //
    // There is exactly one Athena, so this is a MERGE, not a conflict list —
    // asking a user to resolve four hundred individual facts would be a worse
    // product than any merge rule. Everything about it lands outside the
    // transaction above: the brain tables live in the user database and the
    // memories themselves are markdown files, neither of which the app-DB
    // transaction covers. Same reasoning as the skills and knowledge-base
    // phases; the ordering rule is the same too, so a rolled-back import can
    // never leave a file or a foreign-database row behind.
    if !is_resolution_pass {
        if let Some(athena) = bundle.athena.as_ref() {
            import_athena_memory(pool, user_db, athena, &now, &mut result);
        }
    }

    // The bundle records what the EXPORT dropped. Replay it here — the person
    // receiving the bundle is the one who needs to know it is incomplete, and
    // the export commands themselves have no channel back to a UI. Pass 1 only,
    // so a two-pass conflict resolution does not list them twice.
    if !is_resolution_pass {
        for w in &bundle.export_warnings {
            result.warnings.push(format!("Export note — {w}"));
        }
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
            // `updated_at` is derived, not carried: the export format predates the
            // column, so an imported task gets the same COALESCE the migration
            // backfills with rather than a NULL (invisible to the staleness
            // engine) or a fake `now` (every imported task looks freshly touched).
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, \
                 status, session_id, progress_pct, output_lines, error, depth, parent_task_id, \
                 attempt, started_at, completed_at, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,\
                 COALESCE(?16,?15,?17))",
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

// ============================================================================
// Twin import helpers (WP1)
// ============================================================================

/// How a bundled twin lands in this database. Mirrors [`ProjectImportMode`],
/// minus the `Fresh`-keeps-original-uuids nuance: a twin id addresses nothing
/// outside its own graph, so EVERY mode that creates a row creates a fresh
/// uuid. That removes a whole class of "the bundle's id happened to exist
/// here" collisions for free.
enum TwinImportMode {
    /// No conflict.
    Fresh,
    /// Keep the existing twin row (and therefore its `slug`, `is_active` and
    /// `obsidian_subpath` — the vault folder on THIS machine), overwrite its
    /// profile fields, and replace its children wholesale.
    Replace { existing_id: String },
    /// Land alongside the existing twin under a new name suffix.
    Duplicate,
}

/// A bundled twin conflicts when a twin of the same name (case-insensitive)
/// already exists. Matching on `slug` would be worse than useless: the slug is
/// derived from the name at creation time and re-derived on import, so it
/// differs by construction whenever the target already holds that name.
fn find_twin_conflict(tx: &rusqlite::Transaction<'_>, tw: &TwinExport) -> Option<String> {
    tx.query_row(
        "SELECT id FROM twin_profiles WHERE name = ?1 COLLATE NOCASE",
        [tw.name.as_str()],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// The twin child tables this import owns end to end. `twin_voice_profiles` is
/// absent on purpose (dead table, voice milestone retired 2026-07-10) — a
/// replace must not delete rows the bundle cannot restore.
const TWIN_CHILD_TABLES: [&str; 7] = [
    "twin_tones",
    "twin_communications",
    "twin_pending_memories",
    "twin_distilled_facts",
    "twin_contacts",
    "twin_reflections",
    "twin_channels",
];

/// Import one twin and its whole child graph. Returns the id the twin landed
/// under, or `None` when the profile row itself failed (already warned).
fn import_twin(
    tx: &rusqlite::Transaction<'_>,
    tw: &TwinExport,
    mode: &TwinImportMode,
    now: &str,
    result: &mut PortabilityImportResult,
) -> Option<String> {
    let warnings = &mut result.warnings;

    let (target_id, display_name) = match mode {
        TwinImportMode::Replace { existing_id } => {
            // Profile fields only — `slug`, `is_active` and `obsidian_subpath`
            // belong to THIS machine and are never overwritten by a bundle.
            if !exec_row(
                tx,
                "UPDATE twin_profiles SET name = ?2, bio = ?3, role = ?4, languages = ?5, \
                        pronouns = ?6, training_directives = ?7, updated_at = ?8 \
                 WHERE id = ?1",
                rusqlite::params![
                    existing_id,
                    tw.name,
                    tw.bio,
                    tw.role,
                    tw.languages,
                    tw.pronouns,
                    tw.training_directives,
                    now
                ],
                &format!("Twin '{}'", tw.name),
                warnings,
            ) {
                return None;
            }
            for table in TWIN_CHILD_TABLES {
                let _ = tx.execute(
                    &format!("DELETE FROM {table} WHERE twin_id = ?1"),
                    [existing_id.as_str()],
                );
            }
            (existing_id.clone(), tw.name.clone())
        }
        TwinImportMode::Fresh | TwinImportMode::Duplicate => {
            let name = match mode {
                TwinImportMode::Duplicate => format!("{} (imported)", tw.name),
                _ => tw.name.clone(),
            };
            let id = uuid::Uuid::new_v4().to_string();
            let base = crate::db::repos::twin::slugify(&name);
            let slug = match crate::db::repos::twin::unique_slug_on(tx, &base) {
                Ok(s) => s,
                Err(e) => {
                    warnings.push(format!("Twin '{name}': could not derive a slug ({e})"));
                    return None;
                }
            };
            let obsidian_subpath = format!("personas/twins/{slug}");
            // `is_active` is ALWAYS 0. The active twin is a global singleton
            // (`set_active_profile` demotes every row before promoting one);
            // importing a bundle must never silently seize it from whatever
            // the user has selected here.
            if !exec_row(
                tx,
                "INSERT INTO twin_profiles \
                    (id, name, slug, bio, role, languages, pronouns, obsidian_subpath, \
                     is_active, knowledge_base_id, training_directives, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,NULL,?9,?10,?11)",
                rusqlite::params![
                    id,
                    name,
                    slug,
                    tw.bio,
                    tw.role,
                    tw.languages,
                    tw.pronouns,
                    obsidian_subpath,
                    tw.training_directives,
                    tw.created_at,
                    now
                ],
                &format!("Twin '{name}'"),
                warnings,
            ) {
                return None;
            }
            (id, name)
        }
    };

    // --- children, all under fresh uuids ------------------------------------

    for t in &tw.tones {
        exec_row(
            tx,
            "INSERT INTO twin_tones \
                (id, twin_id, channel, voice_directives, examples_json, constraints_json, \
                 length_hint, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                t.channel,
                t.voice_directives,
                t.examples_json,
                t.constraints_json,
                t.length_hint,
                t.updated_at
            ],
            &format!("Twin '{display_name}' tone '{}'", t.channel),
            warnings,
        );
    }

    // Communications first — pending memories and distilled facts both cite
    // them, so their remap table has to exist before those run.
    let mut comm_map: HashMap<String, String> = HashMap::new();
    for c in &tw.communications {
        let id = uuid::Uuid::new_v4().to_string();
        if exec_row(
            tx,
            "INSERT INTO twin_communications \
                (id, twin_id, channel, direction, contact_handle, content, summary, \
                 key_facts_json, occurred_at, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                id,
                target_id,
                c.channel,
                c.direction,
                c.contact_handle,
                c.content,
                c.summary,
                c.key_facts_json,
                c.occurred_at,
                c.created_at
            ],
            &format!("Twin '{display_name}' communication"),
            warnings,
        ) {
            comm_map.insert(c.id.clone(), id);
        }
    }

    for m in &tw.pending_memories {
        // Provenance is a soft ref: a memory whose source communication fell
        // outside the export cap keeps the memory and drops the citation.
        let source = m
            .source_communication_id
            .as_deref()
            .and_then(|sid| comm_map.get(sid).cloned());
        exec_row(
            tx,
            "INSERT INTO twin_pending_memories \
                (id, twin_id, channel, content, title, importance, status, reviewer_notes, \
                 source_communication_id, created_at, reviewed_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                m.channel,
                m.content,
                m.title,
                m.importance,
                m.status,
                m.reviewer_notes,
                source,
                m.created_at,
                m.reviewed_at
            ],
            &format!("Twin '{display_name}' memory"),
            warnings,
        );
    }

    for f in &tw.distilled_facts {
        // `sources_json` is a hard provenance contract, not decoration:
        // `repos::twin::create_distilled_fact` rejects an empty array outright
        // because a cited fact with no citation is exactly the hallucination
        // shape the table exists to prevent. So a fact whose sources ALL fail
        // to remap is dropped with a warning — never rewritten as `[]`.
        let original: Vec<String> = serde_json::from_str(&f.sources_json).unwrap_or_default();
        let remapped: Vec<String> = original
            .iter()
            .filter_map(|sid| comm_map.get(sid).cloned())
            .collect();
        if remapped.is_empty() {
            warnings.push(format!(
                "Twin '{display_name}': fact '{}' dropped — none of its {} source communication(s) travelled with the bundle, and a fact without provenance is not storable.",
                truncate_for_warning(&f.content),
                original.len()
            ));
            continue;
        }
        if remapped.len() < original.len() {
            warnings.push(format!(
                "Twin '{display_name}': fact '{}' kept {} of {} source citations; the rest were outside the export.",
                truncate_for_warning(&f.content),
                remapped.len(),
                original.len()
            ));
        }
        let sources_json = match serde_json::to_string(&remapped) {
            Ok(s) => s,
            Err(e) => {
                warnings.push(format!("Twin '{display_name}': fact sources unencodable ({e})"));
                continue;
            }
        };
        exec_row(
            tx,
            "INSERT INTO twin_distilled_facts \
                (id, twin_id, contact_handle, content, importance, sources_json, created_at, \
                 last_seen_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                f.contact_handle,
                f.content,
                f.importance,
                sources_json,
                f.created_at,
                f.last_seen_at
            ],
            &format!("Twin '{display_name}' fact"),
            warnings,
        );
    }

    // Contacts and facts join communications by `contact_handle`, a STRING —
    // portable as-is, no remap needed.
    for c in &tw.contacts {
        exec_row(
            tx,
            "INSERT INTO twin_contacts \
                (id, twin_id, handle, alias, notes, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                c.handle,
                c.alias,
                c.notes,
                c.created_at,
                c.updated_at
            ],
            &format!("Twin '{display_name}' contact '{}'", c.handle),
            warnings,
        );
    }

    for r in &tw.reflections {
        exec_row(
            tx,
            "INSERT INTO twin_reflections (id, twin_id, prompt_seed, content, created_at) \
             VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                r.prompt_seed,
                r.content,
                r.created_at
            ],
            &format!("Twin '{display_name}' reflection"),
            warnings,
        );
    }

    for ch in &tw.channels {
        // Deliberately NOT auto-matched and NOT dropped. `credential_id` and
        // `persona_id` are kept verbatim so the user can see what the channel
        // pointed at, and `is_active` is forced to 0 so nothing can post as
        // this twin until a human re-links it. Guessing a credential here
        // would mean speaking to a stranger's Discord in the twin's voice.
        let credential_ok = row_exists(
            tx,
            "SELECT 1 FROM persona_credentials WHERE id = ?1",
            &ch.credential_id,
        );
        let persona_ok = ch
            .persona_id
            .as_deref()
            .map(|pid| row_exists(tx, "SELECT 1 FROM personas WHERE id = ?1", pid))
            .unwrap_or(true);
        if exec_row(
            tx,
            "INSERT INTO twin_channels \
                (id, twin_id, channel_type, credential_id, persona_id, label, is_active, \
                 created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,0,?7,?8)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                ch.channel_type,
                ch.credential_id,
                ch.persona_id,
                ch.label,
                ch.created_at,
                now
            ],
            &format!("Twin '{display_name}' channel '{}'", ch.channel_type),
            warnings,
        ) {
            let label = ch.label.as_deref().unwrap_or(&ch.channel_type);
            let mut missing: Vec<&str> = Vec::new();
            if !credential_ok {
                missing.push("credential");
            }
            if !persona_ok {
                missing.push("persona");
            }
            let detail = if missing.is_empty() {
                "re-link and re-enable it in the Twin plugin's Channels tab".to_string()
            } else {
                format!(
                    "its {} does not exist here — re-link and re-enable it in the Twin plugin's Channels tab",
                    missing.join(" and ")
                )
            };
            warnings.push(format!(
                "Twin '{display_name}': channel '{label}' imported disabled — {detail}."
            ));
        }
    }

    Some(target_id)
}

/// Shorten free text for a warning line so a 50KB memory cannot swamp the list.
fn truncate_for_warning(s: &str) -> String {
    const MAX: usize = 60;
    let trimmed = s.trim();
    if trimmed.chars().count() <= MAX {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(MAX).collect();
    format!("{head}…")
}

/// Recreate a twin's knowledge base in the USER database and rebind the
/// profile to it. Runs POST-COMMIT: this store is not covered by the app-DB
/// transaction, so writing during it would leave orphans behind a rollback.
///
/// Vectors are not created here — the caller queues the new KB id for a
/// background `kb_reindex`, which is what actually embeds these chunks with
/// THIS machine's model.
fn import_twin_knowledge_base(
    pool: &DbPool,
    user_db: &UserDbPool,
    twin_id: &str,
    kb: &TwinKnowledgeBaseExport,
    now: &str,
) -> Result<ImportedKb, AppError> {
    let new_kb_id = uuid::Uuid::new_v4().to_string();
    let credential_id = format!("kb-cred-{new_kb_id}");
    let name = format!("{} (imported)", kb.name);

    let mut doc_map: HashMap<&str, String> = HashMap::new();
    let mut chunks_written: u32 = 0;

    {
        let mut conn = user_db.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;
        tx.execute(
            "INSERT INTO knowledge_bases \
                (id, credential_id, name, description, embedding_model, embedding_dims, \
                 chunk_size, chunk_overlap, document_count, chunk_count, status, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,0,'ready',?9,?10)",
            rusqlite::params![
                new_kb_id,
                credential_id,
                name,
                kb.description,
                kb.embedding_model,
                kb.embedding_dims,
                kb.chunk_size,
                kb.chunk_overlap,
                kb.created_at,
                now
            ],
        )
        .map_err(AppError::Database)?;

        for d in &kb.documents {
            let doc_id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO kb_documents \
                    (id, kb_id, source_type, source_path, title, content_hash, byte_size, \
                     chunk_count, metadata_json, page_count, empty_pages, status, error_message, \
                     indexed_at, created_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8,?9,?10,?11,?12,?13,?14)",
                rusqlite::params![
                    doc_id,
                    new_kb_id,
                    d.source_type,
                    d.source_path,
                    d.title,
                    d.content_hash,
                    d.byte_size,
                    d.metadata_json,
                    d.page_count,
                    d.empty_pages,
                    d.status,
                    d.error_message,
                    d.indexed_at,
                    d.created_at
                ],
            )
            .map_err(AppError::Database)?;
            doc_map.insert(d.id.as_str(), doc_id);
        }

        for c in &kb.chunks {
            let Some(doc_id) = doc_map.get(c.document_id.as_str()) else {
                // Orphan chunk (its document did not travel) — skipped rather
                // than written against a dangling document_id.
                continue;
            };
            tx.execute(
                "INSERT INTO kb_chunks \
                    (id, kb_id, document_id, chunk_index, content, token_count, metadata_json, \
                     source_page, extraction_confidence, created_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    new_kb_id,
                    doc_id,
                    c.chunk_index,
                    c.content,
                    c.token_count,
                    c.metadata_json,
                    c.source_page,
                    c.extraction_confidence,
                    c.created_at
                ],
            )
            .map_err(AppError::Database)?;
            chunks_written += 1;
        }

        // Keep the denormalized counters honest with what actually landed.
        tx.execute(
            "UPDATE knowledge_bases SET document_count = ?2, chunk_count = ?3 WHERE id = ?1",
            rusqlite::params![new_kb_id, doc_map.len() as i64, chunks_written as i64],
        )
        .map_err(AppError::Database)?;

        tx.commit().map_err(AppError::Database)?;
    }

    // Vault shell in the app DB so the imported KB shows up in Connections,
    // mirroring `vector_kb::create_knowledge_base`.
    let replaced_kb_id = {
        let conn = pool.get()?;
        let _ = conn.execute(
            "INSERT OR IGNORE INTO persona_credentials \
                (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at) \
             VALUES (?1,?2,'personas_vector_db','{}','',?3,?4,?4)",
            rusqlite::params![
                credential_id,
                format!("KB: {name}"),
                format!(
                    r#"{{"is_builtin":false,"kb_id":"{new_kb_id}","description":"Vector knowledge base for semantic search."}}"#
                ),
                now
            ],
        );
        // Whatever this twin pointed at before (only non-NULL on a "replace"
        // onto a twin that already had a base) — reported, never deleted.
        let previous: Option<String> = conn
            .query_row(
                "SELECT knowledge_base_id FROM twin_profiles WHERE id = ?1",
                [twin_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .filter(|s| !s.trim().is_empty());
        conn.execute(
            "UPDATE twin_profiles SET knowledge_base_id = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![twin_id, new_kb_id, now],
        )
        .map_err(AppError::Database)?;
        previous
    };

    Ok(ImportedKb {
        kb_id: new_kb_id,
        chunks_imported: chunks_written,
        replaced_kb_id,
    })
}

// ============================================================================
// Athena memory import (post-commit; merge, never a conflict list)
// ============================================================================

/// Merge a bundle's Athena section into this machine's brain.
///
/// **Merge, not replace.** A workspace has many personas and one Athena, so
/// there is no "which one wins" question to put in front of the user — an
/// incoming memory either says something the brain does not already hold, in
/// which case it lands, or it duplicates something it does, in which case it is
/// dropped whole. Deliberately NOT merged field-by-field: silently raising a
/// local fact's confidence because a bundle claimed a higher one would edit the
/// operator's own brain behind their back.
///
/// Never returns `Err`. Every failure is a warning on the result, because by
/// the time this runs the app-database transaction has already committed and
/// there is nothing left to roll back — an error here would report a failed
/// import that in fact half-succeeded.
fn import_athena_memory(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    athena: &AthenaMemoryExport,
    now: &str,
    result: &mut PortabilityImportResult,
) {
    // Core, part 1 — prefs live in the SYSTEM database and need no brain.
    apply_athena_prefs(pool, athena, result);

    // Core, part 2 — identity.md is a file, likewise.
    apply_athena_identity(athena, result);

    let Some(user_db) = user_db else {
        if !athena.nodes.is_empty() || !athena.decisions.is_empty() {
            result.warnings.push(
                "Athena: her memory could not be imported — the brain database is not available in this context."
                    .into(),
            );
        }
        return;
    };
    {
        let Ok(conn) = user_db.get() else {
            result
                .warnings
                .push("Athena: her brain database could not be opened; her memory was not imported.".into());
            return;
        };
        if !has_companion_schema(&conn) {
            result.warnings.push(
                "Athena: this installation has no companion brain yet; her memory was not imported. Open the companion once and re-import."
                    .into(),
            );
            return;
        }
    }

    if let Err(e) = import_athena_sessions(user_db, athena, result) {
        result
            .warnings
            .push(format!("Athena: her conversation list could not be imported ({e})."));
    }
    if let Err(e) = import_athena_learned(user_db, athena, now, result) {
        result
            .warnings
            .push(format!("Athena: her memory could not be imported ({e})."));
    }
}

/// Write the portable prefs into `app_settings`.
///
/// The whitelist check is repeated here on purpose — `validate_athena` runs it
/// first, but this is the function that actually writes to `app_settings`, and
/// a boundary that exists in only one place is one refactor from not existing.
fn apply_athena_prefs(
    pool: &DbPool,
    athena: &AthenaMemoryExport,
    result: &mut PortabilityImportResult,
) {
    for pref in &athena.prefs {
        if !ATHENA_PORTABLE_PREF_KEYS.contains(&pref.key.as_str()) {
            result.warnings.push(format!(
                "Athena: preference '{}' is not portable and was ignored.",
                pref.key
            ));
            continue;
        }
        if let Err(e) = settings_repo::set(pool, &pref.key, &pref.value) {
            result.warnings.push(format!(
                "Athena: preference '{}' could not be applied ({e}).",
                pref.key
            ));
        }
    }
}

/// Replace `identity.md`, backing up whatever was there first.
///
/// Goes through `identity::write_full` rather than writing the file directly:
/// that is the function the rest of the app already trusts to make a
/// timestamped backup before it overwrites, and an import is the single most
/// destructive thing that can happen to this file.
fn apply_athena_identity(athena: &AthenaMemoryExport, result: &mut PortabilityImportResult) {
    let Some(identity) = athena.identity_md.as_deref() else {
        return;
    };
    match crate::companion::brain::identity::write_full(identity) {
        Ok(backup) if backup.is_empty() => {
            // Nothing was there — a first write, not a replacement.
            result
                .warnings
                .push("Athena: identity.md was written (this machine had none).".into());
        }
        Ok(backup) => {
            result.athena_identity_replaced = true;
            result.warnings.push(format!(
                "Athena: identity.md was replaced. The previous one is saved next to it as '{backup}'."
            ));
        }
        Err(e) => result
            .warnings
            .push(format!("Athena: identity.md could not be written ({e}).")),
    }
}

/// Add conversation threads that are not already here, by id.
///
/// The transcripts do not travel, so these land empty — titles, pins and
/// origin only. That is said out loud in a warning rather than left for the
/// user to discover by opening one.
fn import_athena_sessions(
    user_db: &UserDbPool,
    athena: &AthenaMemoryExport,
    result: &mut PortabilityImportResult,
) -> Result<(), AppError> {
    if athena.sessions.is_empty() {
        return Ok(());
    }
    let mut conn = user_db.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;
    let mut added = 0u32;
    for s in &athena.sessions {
        // `claude_session_id` is left NULL: the bundle never carried one, and
        // a resume pointer from another machine would attach the wrong CLI
        // process to this thread.
        let n = tx
            .execute(
                "INSERT OR IGNORE INTO companion_session \
                    (id, claude_session_id, constitution_version, last_active_at, created_at, \
                     title, status, last_read_at, pinned, origin) \
                 VALUES (?1, NULL, 1, datetime('now'), datetime('now'), ?2, ?3, NULL, ?4, ?5)",
                rusqlite::params![s.id, s.title, s.status, s.pinned, s.origin],
            )
            .map_err(AppError::Database)?;
        added += n as u32;
    }
    tx.commit().map_err(AppError::Database)?;
    if added > 0 {
        result.warnings.push(format!(
            "Athena: {added} conversation(s) were added to her list. They arrive empty — the messages themselves do not travel in a bundle."
        ));
    }
    Ok(())
}

/// Dedup identity for one incoming memory — what makes two of them "the same".
///
/// Content-shaped rather than id-shaped, because a re-import of the same bundle
/// onto a brain that has since regenerated its ids must still be a no-op, and
/// because the same fact learned twice on two machines really is one fact.
fn athena_dedup_key(athena: &AthenaMemoryExport, node_id: &str, kind: &str) -> Option<String> {
    match kind {
        "fact" => athena
            .facts
            .iter()
            .find(|f| f.id == node_id)
            .map(|f| format!("{}\u{1}{}", f.scope, f.fact_key)),
        "procedural" => athena
            .procedurals
            .iter()
            .find(|p| p.id == node_id)
            .map(|p| p.trigger_pattern.clone()),
        "goal" => athena
            .goals
            .iter()
            .find(|g| g.id == node_id)
            .map(|g| g.title.clone()),
        "backlog" => athena
            .backlog
            .iter()
            .find(|b| b.id == node_id)
            .map(|b| b.summary.clone()),
        "ritual" => athena
            .rituals
            .iter()
            .find(|r| r.id == node_id)
            .map(|r| format!("{}\u{1}{}", r.kind, r.description)),
        _ => None,
    }
}

/// The dedup keys already present in this brain, per kind.
fn existing_athena_keys(
    conn: &rusqlite::Connection,
) -> Result<HashMap<&'static str, std::collections::HashSet<String>>, AppError> {
    let mut out: HashMap<&'static str, std::collections::HashSet<String>> = HashMap::new();
    let mut collect = |kind: &'static str, sql: &str| -> Result<(), AppError> {
        let mut stmt = conn.prepare(sql).map_err(AppError::Database)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(AppError::Database)?;
        let set = out.entry(kind).or_default();
        for row in rows {
            set.insert(row.map_err(AppError::Database)?);
        }
        Ok(())
    };
    collect(
        "fact",
        "SELECT scope || char(1) || fact_key FROM companion_fact",
    )?;
    collect(
        "procedural",
        "SELECT trigger_pattern FROM companion_procedural",
    )?;
    collect("goal", "SELECT title FROM companion_goal")?;
    collect("backlog", "SELECT summary FROM companion_backlog_item")?;
    collect(
        "ritual",
        "SELECT kind || char(1) || description FROM companion_ritual",
    )?;
    Ok(out)
}

/// The learned tier: markdown to disk, then rows, then a queued re-embed.
///
/// The order is the brain's own contract — the markdown is the source of truth
/// and `companion_node` is an index over it, so writing rows first would leave
/// an index pointing at files that do not exist yet. A node whose file cannot
/// be written is dropped rather than indexed.
fn import_athena_learned(
    user_db: &UserDbPool,
    athena: &AthenaMemoryExport,
    now: &str,
    result: &mut PortabilityImportResult,
) -> Result<(), AppError> {
    if athena.nodes.is_empty() && athena.decisions.is_empty() {
        return Ok(());
    }
    let root = crate::companion::disk::brain_root()?;

    let (existing_keys, existing_ids) = {
        let conn = user_db.get()?;
        let keys = existing_athena_keys(&conn)?;
        let mut ids = std::collections::HashSet::new();
        let mut stmt = conn
            .prepare("SELECT id FROM companion_node")
            .map_err(AppError::Database)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(AppError::Database)?;
        for row in rows {
            ids.insert(row.map_err(AppError::Database)?);
        }
        (keys, ids)
    };

    // Pass 1: decide what lands, mint replacement ids for the (vanishingly
    // rare) case where an incoming id is already taken by a DIFFERENT memory,
    // and write the markdown.
    let mut taken_ids = existing_ids;
    let mut id_map: HashMap<&str, String> = HashMap::new();
    let mut planned: Vec<(&AthenaNodeExport, String, String)> = Vec::new(); // (node, new id, new rel path)
    let mut skipped_duplicates = 0u32;

    for node in &athena.nodes {
        let seen = athena_dedup_key(athena, &node.id, &node.kind);
        let Some(key) = seen else {
            result.warnings.push(format!(
                "Athena: {} '{}' arrived without its detail row and was skipped.",
                node.kind, node.id
            ));
            continue;
        };
        if existing_keys
            .get(node.kind.as_str())
            .is_some_and(|s| s.contains(&key))
        {
            skipped_duplicates += 1;
            continue;
        }

        let new_id = if taken_ids.contains(&node.id) {
            let fresh = format!(
                "{}_{}",
                node.id.split('_').next().unwrap_or("mem"),
                &uuid::Uuid::new_v4().simple().to_string()[..8]
            );
            result.warnings.push(format!(
                "Athena: {} '{}' collided with an existing id and landed as '{fresh}'.",
                node.kind, node.id
            ));
            fresh
        } else {
            node.id.clone()
        };
        // The node id is embedded in its filename; keep the two in step.
        let rel_path = if new_id == node.id {
            node.file_path.clone()
        } else {
            node.file_path.replace(&node.id, &new_id)
        };

        let abs = root.join(&rel_path);
        if let Some(parent) = abs.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                result.warnings.push(format!(
                    "Athena: {} '{}' could not be saved ({e}); skipped.",
                    node.kind, node.id
                ));
                continue;
            }
        }
        if let Err(e) = std::fs::write(&abs, &node.body) {
            result.warnings.push(format!(
                "Athena: {} '{}' could not be saved ({e}); skipped.",
                node.kind, node.id
            ));
            continue;
        }

        taken_ids.insert(new_id.clone());
        id_map.insert(node.id.as_str(), new_id.clone());
        planned.push((node, new_id, rel_path));
    }

    // Pass 2: the index rows, in one transaction over the brain database.
    let mut conn = user_db.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;
    let remap = |id: &Option<String>| -> Option<String> {
        // A superseded fact that did not travel leaves a dangling pointer;
        // NULL is the honest value for "the thing this replaced is not here".
        id.as_deref().and_then(|i| id_map.get(i).cloned())
    };

    let mut nodes_written = 0u32;
    for (node, new_id, rel_path) in &planned {
        tx.execute(
            "INSERT INTO companion_node \
                (id, kind, file_path, content_hash, importance, embedding_model, embedding_dims, \
                 body_excerpt, created_at, updated_at, session_id) \
             VALUES (?1,?2,?3,?4,?5,NULL,NULL,?6,?7,?8,?9)",
            rusqlite::params![
                new_id,
                node.kind,
                rel_path,
                node.content_hash,
                node.importance,
                node.body_excerpt,
                node.created_at,
                node.updated_at,
                node.session_id,
            ],
        )
        .map_err(AppError::Database)?;
        nodes_written += 1;

        match node.kind.as_str() {
            "fact" => {
                if let Some(f) = athena.facts.iter().find(|f| f.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_fact \
                            (id, scope, fact_key, confidence, supersedes_id, contradicts_id, \
                             last_seen_at, last_decayed_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![
                            new_id,
                            f.scope,
                            f.fact_key,
                            f.confidence,
                            remap(&f.supersedes_id),
                            remap(&f.contradicts_id),
                            f.last_seen_at,
                            f.last_decayed_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            "procedural" => {
                if let Some(p) = athena.procedurals.iter().find(|p| p.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_procedural \
                            (id, scope, trigger_pattern, confidence, supersedes_id, last_used_at, \
                             last_decayed_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        rusqlite::params![
                            new_id,
                            p.scope,
                            p.trigger_pattern,
                            p.confidence,
                            remap(&p.supersedes_id),
                            p.last_used_at,
                            p.last_decayed_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            "goal" => {
                if let Some(g) = athena.goals.iter().find(|g| g.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_goal \
                            (id, title, status, priority, target_date, sources_json, completed_at, \
                             created_at, updated_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                        rusqlite::params![
                            new_id,
                            g.title,
                            g.status,
                            g.priority,
                            g.target_date,
                            g.sources_json,
                            g.completed_at,
                            g.created_at,
                            g.updated_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            "backlog" => {
                if let Some(b) = athena.backlog.iter().find(|b| b.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_backlog_item \
                            (id, summary, kind, status, source_episode_id, reminded_count, \
                             created_at, resolved_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![
                            new_id,
                            b.summary,
                            b.kind,
                            b.status,
                            b.source_episode_id,
                            b.reminded_count,
                            b.created_at,
                            b.resolved_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            "ritual" => {
                if let Some(r) = athena.rituals.iter().find(|r| r.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_ritual \
                            (id, kind, description, schedule_json, active, sources_json, \
                             created_at, updated_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![
                            new_id,
                            r.kind,
                            r.description,
                            r.schedule_json,
                            r.active,
                            r.sources_json,
                            r.created_at,
                            r.updated_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            _ => {}
        }
    }

    // Provenance. The episode ids dangle by design — the conversations do not
    // travel — and both `semantic::load_sources` and `procedural::load_sources`
    // read this table with no join, so a dangling id comes back verbatim and
    // never errors. What survives is "she believes this for three separate
    // reasons", which is the part worth carrying.
    let mut dangling = 0u32;
    for pr in &athena.provenance {
        let Some(fact_id) = id_map.get(pr.fact_id.as_str()) else {
            continue;
        };
        tx.execute(
            "INSERT OR IGNORE INTO companion_provenance (fact_id, episode_id) VALUES (?1, ?2)",
            rusqlite::params![fact_id, pr.episode_id],
        )
        .map_err(AppError::Database)?;
        dangling += 1;
    }

    // Design decisions dedup on id — they have no content key, and unlike a
    // fact there is no natural "same decision, said twice".
    let mut decisions_written = 0u32;
    for d in &athena.decisions {
        let n = tx
            .execute(
                "INSERT OR IGNORE INTO companion_design_decision \
                    (id, session_id, persona_context, label, choice, rationale, \
                     decision_timestamp, created_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                rusqlite::params![
                    d.id,
                    d.session_id,
                    d.persona_context,
                    d.label,
                    d.choice,
                    d.rationale,
                    d.decision_timestamp,
                    d.created_at,
                ],
            )
            .map_err(AppError::Database)?;
        decisions_written += n as u32;
    }

    tx.commit().map_err(AppError::Database)?;
    let _ = now;

    result.athena_memory_imported += nodes_written + decisions_written;
    // Only nodes carry vectors; decisions are never embedded.
    result.reembed_queued += nodes_written;
    if skipped_duplicates > 0 {
        result.warnings.push(format!(
            "Athena: {skipped_duplicates} memory item(s) were already in her brain and were left alone."
        ));
    }
    if dangling > 0 {
        result.warnings.push(format!(
            "Athena: {dangling} provenance link(s) point at conversations that do not travel in a bundle. The memories keep their sourcing; the conversations themselves are not here."
        ));
    }
    Ok(())
}

/// What [`import_twin_knowledge_base`] landed.
struct ImportedKb {
    /// Id of the newly created knowledge base — queued for a background
    /// re-embed, since a bundle carries text but never vectors.
    kb_id: String,
    chunks_imported: u32,
    /// The base this twin was bound to beforehand, if any. It is left in
    /// place (deleting a user's vector store on an import would be
    /// unforgivable) and merely reported.
    replaced_kb_id: Option<String>,
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
    // Drop reasons are irrelevant here: this hash only has to match what the
    // exporter would have produced from the same directory.
    collect_skill_dir_files(dir, dir, &mut files, &mut Vec::new(), 0);
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

/// Format marker for the `encrypted_twins` envelope.
const TWINS_EXPORT_FORMAT: &str = "personas_twins_v1";
/// Format marker for the `encrypted_athena` envelope.
const ATHENA_EXPORT_FORMAT: &str = "personas_athena_v1";

/// Encrypt any serializable section into a `CredentialExportEnvelope`.
///
/// Same AES-256-GCM + PBKDF2-HMAC-SHA256 machinery the credential envelope has
/// shipped with — this is a factoring-out, not new cryptography. Each call
/// draws a fresh salt and nonce, so two sections sealed with the same
/// passphrase share no key material and either can be decrypted alone. The
/// `format` marker is what makes a section pasted into the wrong slot fail
/// loudly instead of decrypting into a confusing serde error.
fn encrypt_section<T: Serialize>(
    value: &T,
    passphrase: &str,
    format: &str,
) -> Result<CredentialExportEnvelope, AppError> {
    let plaintext = serde_json::to_vec(value)
        .map_err(|e| AppError::Internal(format!("Serialization failed: {e}")))?;

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
        format: format.into(),
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    })
}

/// Inverse of [`encrypt_section`]. A wrong passphrase surfaces as a decryption
/// failure, never as a partial read.
fn decrypt_section<T: serde::de::DeserializeOwned>(
    envelope: &CredentialExportEnvelope,
    passphrase: &str,
    format: &str,
) -> Result<T, AppError> {
    if envelope.format != format {
        return Err(AppError::Validation(format!(
            "Unexpected encrypted section format: {} (expected {format})",
            envelope.format
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
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| AppError::Validation("Wrong passphrase or corrupted data".into()))?;

    serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Validation(format!("Decrypted section is not valid JSON: {e}")))
}

/// Move `twins` and `athena` into their encrypted envelopes, leaving the
/// plaintext fields empty.
///
/// Wave-1 decision: **both sections always travel encrypted.** A twin is a
/// model of a real person's voice and Athena's `identity.md` is a dossier on
/// the operator; a zip that anyone can open is the wrong container for either.
/// The passphrase is the same one that seals credential secrets, so the user
/// types it once.
///
/// By the time this runs a passphrase-less export has already declined to
/// collect the sections (see `SensitiveSections`), so the error branch is a
/// backstop against a future caller that forgets — cheaper than discovering the
/// omission in a shipped plaintext bundle.
fn seal_sensitive_sections(
    bundle: &mut PortabilityBundle,
    passphrase: Option<&str>,
) -> Result<(), AppError> {
    let has_twins = !bundle.twins.is_empty();
    let has_athena = bundle.athena.as_ref().is_some_and(|a| !a.is_empty());
    if !has_twins && !has_athena {
        return Ok(());
    }
    let Some(pp) = usable_passphrase(passphrase) else {
        return Err(AppError::Validation(format!(
            "Digital twins and Athena's memory travel encrypted only. Enter a passphrase of at least {MIN_PASSPHRASE_LEN} characters."
        )));
    };

    if has_twins {
        bundle.encrypted_twins = Some(encrypt_section(
            &bundle.twins,
            pp,
            TWINS_EXPORT_FORMAT,
        )?);
        bundle.twins = Vec::new();
    }
    if has_athena {
        bundle.encrypted_athena = Some(encrypt_section(
            &bundle.athena,
            pp,
            ATHENA_EXPORT_FORMAT,
        )?);
        bundle.athena = None;
    }
    // Same rule the credential envelope already established: an encrypted
    // payload means format 3.
    bundle.format_version = 3;
    Ok(())
}

/// Inverse of [`seal_sensitive_sections`], run before validation so the rest of
/// the importer never has to know the sections were ever encrypted.
///
/// A missing or wrong passphrase is a WARNING, not a failure. That follows the
/// shipped credential behaviour, and the alternative is worse: refusing the
/// whole file would mean a user who wants the personas out of a bundle cannot
/// have them because they lost the passphrase for a twin they did not want.
fn unseal_sensitive_sections(
    bundle: &mut PortabilityBundle,
    passphrase: Option<&str>,
    warnings: &mut Vec<String>,
) {
    let pp = passphrase.filter(|p| !p.is_empty());

    // Each section is decrypted into a local first so the immutable borrow of
    // the envelope ends before the plaintext field is assigned.
    let twins = match (bundle.encrypted_twins.as_ref(), pp) {
        (None, _) => None,
        (Some(_), None) => {
            warnings.push(
                "This bundle contains encrypted digital twins. No passphrase was given, so they were not imported."
                    .into(),
            );
            None
        }
        (Some(env), Some(pp)) => {
            match decrypt_section::<Vec<TwinExport>>(env, pp, TWINS_EXPORT_FORMAT) {
                Ok(twins) => Some(twins),
                Err(e) => {
                    warnings.push(format!(
                        "Encrypted digital twins could not be decrypted ({e}); they were not imported."
                    ));
                    None
                }
            }
        }
    };
    if let Some(twins) = twins {
        bundle.twins = twins;
    }

    let athena = match (bundle.encrypted_athena.as_ref(), pp) {
        (None, _) => None,
        (Some(_), None) => {
            warnings.push(
                "This bundle contains Athena's encrypted memory. No passphrase was given, so it was not imported."
                    .into(),
            );
            None
        }
        (Some(env), Some(pp)) => {
            match decrypt_section::<AthenaMemoryExport>(env, pp, ATHENA_EXPORT_FORMAT) {
                Ok(athena) => Some(athena),
                Err(e) => {
                    warnings.push(format!(
                        "Athena's encrypted memory could not be decrypted ({e}); it was not imported."
                    ));
                    None
                }
            }
        }
    };
    if athena.is_some() {
        bundle.athena = athena;
    }
}

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

    encrypt_section(&bundle, passphrase, CREDENTIAL_EXPORT_FORMAT)
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
            twins: Vec::new(),
            athena: None,
            export_warnings: Vec::new(),
            encrypted_credentials: None,
            encrypted_twins: None,
            encrypted_athena: None,
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

        let result = import_bundle(&pool, None, &bundle, &HashMap::new()).expect("import must succeed");
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

        let result = import_bundle(&pool, None, &bundle, &HashMap::new()).expect("import must succeed");
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

        let result = import_bundle(&pool, None, &bundle, &HashMap::new()).expect("import must succeed");
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

        assert_eq!(import_bundle(&pool, None, &bundle, &HashMap::new()).unwrap().kpis_created, 1);
        // Second import reuses the Imported project and skips the duplicate.
        assert_eq!(import_bundle(&pool, None, &bundle, &HashMap::new()).unwrap().kpis_created, 0);

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

        let bundle = build_export_bundle(&pool, None, ExportScope::Full, true, true, SensitiveSections::Include).unwrap();
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
            twin_ids: Vec::new(),
            athena_tiers: Vec::new(),
        };
        let bundle = build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include).unwrap();
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
            twin_ids: Vec::new(),
            athena_tiers: Vec::new(),
        };
        let bundle = build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include).unwrap();
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
            twin_ids: Vec::new(),
            athena_tiers: Vec::new(),
        };
        let bundle = build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include).unwrap();
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

        let stats = compute_export_stats(&pool, None).unwrap();
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
            twins_imported: 0,
            twins_skipped: 0,
            twin_kb_chunks_imported: 0,
            athena_memory_imported: 0,
            athena_identity_replaced: false,
            reembed_queued: 0,
            import_conflicts: Vec::new(),
            bundle_file_path: None,
            warnings: Vec::new(),
            id_mapping: HashMap::new(),
            pending_kb_reindex: Vec::new(),
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
        build_export_bundle(&source, None, ExportScope::Full, true, true, SensitiveSections::Include).unwrap()
    }

    #[test]
    fn import_bundle_round_trips_projects_and_knowledge_with_original_uuids() {
        let bundle = source_bundle("/tmp/portability-rt-p1");
        let target = init_test_db().unwrap();

        let result = import_bundle(&target, None, &bundle, &HashMap::new()).expect("import");
        assert_eq!(result.projects_imported, 1);
        assert!(result.import_conflicts.is_empty());
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
        import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        // Pass 1 again: the project now conflicts by root_path and is NOT imported.
        let second = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(second.projects_imported, 0);
        assert_eq!(second.import_conflicts.len(), 1);
        let c = &second.import_conflicts[0];
        assert_eq!(c.kind, "project");
        assert_eq!(c.bundle_id, "p1");
        assert_eq!(c.existing_id, "p1");
        assert_eq!(c.matched_by, "root_path");
        // Re-run of the knowledge phase skipped everything as duplicates.
        assert_eq!(second.knowledge_imported, 0);
        assert_eq!(second.knowledge_skipped_duplicates, 3);

        // Pass 2 with skip: nothing imported, nothing duplicated.
        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "skip".to_string());
        let third = import_bundle(&target, None, &bundle, &res).unwrap();
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
        import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

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
        res.insert("project:p1".to_string(), "replace".to_string());
        let result = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(result.projects_imported, 1);
        assert!(result.import_conflicts.is_empty());

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
        import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "duplicate".to_string());
        let result = import_bundle(&target, None, &bundle, &res).unwrap();
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
        let first = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(first.knowledge_imported, 3);

        // Same entries under FRESH ids: dedup_key catches dk1, (kind, title)
        // catches the NULL-key rows.
        let mut rekeyed = source_bundle("/tmp/portability-kn2-p1");
        for k in &mut rekeyed.workspace_knowledge[0].knowledge {
            k.id = format!("fresh-{}", k.id);
        }
        rekeyed.dev_projects.clear();
        let second = import_bundle(&target, None, &rekeyed, &HashMap::new()).unwrap();
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
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
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
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
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

    // ------------------------------------------------------------------
    // Twins (WP1)
    // ------------------------------------------------------------------

    /// Seed one twin with at least one row in every EXPORTED child table,
    /// plus a `twin_voice_profiles` row that must NOT travel.
    fn seed_twin(pool: &DbPool, id: &str, name: &str, kb_id: Option<&str>) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO twin_profiles \
                (id, name, slug, bio, role, languages, pronouns, obsidian_subpath, is_active, \
                 knowledge_base_id, training_directives, created_at, updated_at) \
             VALUES (?1,?2,?3,'A bio','Founder','en,cs','they/them',?4,1,?5,'Be terse.',\
                     '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')",
            rusqlite::params![
                id,
                name,
                format!("slug-{id}"),
                format!("personas/twins/slug-{id}"),
                kb_id
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO twin_tones \
                (id, twin_id, channel, voice_directives, examples_json, constraints_json, \
                 length_hint, updated_at) \
             VALUES (?1,?2,'generic','Warm but brief','[\"hi\"]','{\"no\":1}','short',\
                     '2026-01-02T00:00:00Z')",
            rusqlite::params![format!("tone-{id}"), id],
        )
        .unwrap();

        // Two communications: the training pair (question in `summary`) and a
        // plain inbound message.
        conn.execute(
            "INSERT INTO twin_communications \
                (id, twin_id, channel, direction, contact_handle, content, summary, \
                 key_facts_json, occurred_at, created_at) \
             VALUES (?1,?2,'discord','out','alice','The answer text',\
                     'What is your pricing philosophy?','[\"round up\"]',\
                     '2026-01-03T00:00:00Z','2026-01-03T00:00:00Z')",
            rusqlite::params![format!("comm-a-{id}"), id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO twin_communications \
                (id, twin_id, channel, direction, contact_handle, content, summary, \
                 key_facts_json, occurred_at, created_at) \
             VALUES (?1,?2,'discord','in','alice','Hello there',NULL,NULL,\
                     '2026-01-04T00:00:00Z','2026-01-04T00:00:00Z')",
            rusqlite::params![format!("comm-b-{id}"), id],
        )
        .unwrap();

        for (suffix, status, notes) in [
            ("p", "pending", None::<&str>),
            ("a", "approved", Some("looks right")),
            ("r", "rejected", Some("too personal")),
        ] {
            conn.execute(
                "INSERT INTO twin_pending_memories \
                    (id, twin_id, channel, content, title, importance, status, reviewer_notes, \
                     source_communication_id, created_at, reviewed_at) \
                 VALUES (?1,?2,'discord',?3,'A memory',4,?4,?5,?6,'2026-01-05T00:00:00Z',NULL)",
                rusqlite::params![
                    format!("mem-{suffix}-{id}"),
                    id,
                    format!("memory {suffix}"),
                    status,
                    notes,
                    format!("comm-a-{id}")
                ],
            )
            .unwrap();
        }

        // One fact whose sources all travel, one whose source does not exist.
        conn.execute(
            "INSERT INTO twin_distilled_facts \
                (id, twin_id, contact_handle, content, importance, sources_json, created_at, \
                 last_seen_at) \
             VALUES (?1,?2,'alice','Prefers async',5,?3,'2026-01-06T00:00:00Z',\
                     '2026-01-06T00:00:00Z')",
            rusqlite::params![
                format!("fact-ok-{id}"),
                id,
                format!("[\"comm-a-{id}\"]")
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO twin_distilled_facts \
                (id, twin_id, contact_handle, content, importance, sources_json, created_at, \
                 last_seen_at) \
             VALUES (?1,?2,NULL,'Orphan fact',3,'[\"comm-gone\"]','2026-01-06T00:00:00Z',\
                     '2026-01-06T00:00:00Z')",
            rusqlite::params![format!("fact-orphan-{id}"), id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO twin_contacts (id, twin_id, handle, alias, notes, created_at, updated_at) \
             VALUES (?1,?2,'alice','Alice A.','Main collaborator','2026-01-01T00:00:00Z',\
                     '2026-01-07T00:00:00Z')",
            rusqlite::params![format!("contact-{id}"), id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO twin_reflections (id, twin_id, prompt_seed, content, created_at) \
             VALUES (?1,?2,'How is Alice?','A long reflection','2026-01-08T00:00:00Z')",
            rusqlite::params![format!("refl-{id}"), id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO twin_channels \
                (id, twin_id, channel_type, credential_id, persona_id, label, is_active, \
                 created_at, updated_at) \
             VALUES (?1,?2,'discord','cred-does-not-exist','persona-gone','Main server',1,\
                     '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            rusqlite::params![format!("chan-{id}"), id],
        )
        .unwrap();

        // Dead table — must never appear in a bundle.
        conn.execute(
            "INSERT INTO twin_voice_profiles (id, twin_id, provider, voice_id) \
             VALUES (?1,?2,'elevenlabs','voice-123')",
            rusqlite::params![format!("voice-{id}"), id],
        )
        .unwrap();
    }

    fn seed_twin_kb(user_db: &UserDbPool, kb_id: &str) {
        let conn = user_db.get().unwrap();
        conn.execute(
            "INSERT INTO knowledge_bases \
                (id, credential_id, name, description, embedding_model, embedding_dims, \
                 chunk_size, chunk_overlap, created_at, updated_at) \
             VALUES (?1,'kb-cred-old','Twin Brain','Notes','AllMiniLML6V2Q',384,512,50,\
                     '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            rusqlite::params![kb_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO kb_documents \
                (id, kb_id, source_type, source_path, title, content_hash, byte_size, \
                 chunk_count, status, created_at) \
             VALUES ('doc-1',?1,'file','/tmp/notes.md','Notes','deadbeef',123,2,'indexed',\
                     '2026-01-01T00:00:00Z')",
            rusqlite::params![kb_id],
        )
        .unwrap();
        for (cid, idx, text) in [("chunk-1", 0, "first chunk"), ("chunk-2", 1, "second chunk")] {
            conn.execute(
                "INSERT INTO kb_chunks \
                    (id, kb_id, document_id, chunk_index, content, token_count, created_at) \
                 VALUES (?1,?2,'doc-1',?3,?4,7,'2026-01-01T00:00:00Z')",
                rusqlite::params![cid, kb_id, idx, text],
            )
            .unwrap();
        }
    }

    fn twin_bundle(pool: &DbPool, user_db: Option<&UserDbPool>) -> PortabilityBundle {
        build_export_bundle(pool, user_db, ExportScope::Full, true, true, SensitiveSections::Include).unwrap()
    }

    /// AC1 — every exported column survives a round trip, `summary` and
    /// `key_facts_json` included.
    #[test]
    fn twin_round_trips_every_exported_table_and_column() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);

        assert_eq!(bundle.twins.len(), 1);
        let tw = &bundle.twins[0];
        assert_eq!(tw.name, "Founder Twin");
        assert_eq!(tw.bio.as_deref(), Some("A bio"));
        assert_eq!(tw.role.as_deref(), Some("Founder"));
        assert_eq!(tw.languages.as_deref(), Some("en,cs"));
        assert_eq!(tw.pronouns.as_deref(), Some("they/them"));
        assert_eq!(tw.training_directives.as_deref(), Some("Be terse."));
        assert_eq!(tw.tones.len(), 1);
        assert_eq!(tw.communications.len(), 2);
        assert_eq!(tw.pending_memories.len(), 3);
        assert_eq!(tw.distilled_facts.len(), 2);
        assert_eq!(tw.contacts.len(), 1);
        assert_eq!(tw.reflections.len(), 1);
        assert_eq!(tw.channels.len(), 1);

        // The interview QUESTION lives only in `summary`; its extracted facts
        // only in `key_facts_json`. Losing either halves every training pair.
        let training = tw
            .communications
            .iter()
            .find(|c| c.direction == "out")
            .expect("outbound communication");
        assert_eq!(
            training.summary.as_deref(),
            Some("What is your pricing philosophy?")
        );
        assert_eq!(training.key_facts_json.as_deref(), Some("[\"round up\"]"));

        // All three memory statuses + reviewer notes travel.
        let statuses: std::collections::HashSet<&str> = tw
            .pending_memories
            .iter()
            .map(|m| m.status.as_str())
            .collect();
        assert_eq!(
            statuses,
            ["pending", "approved", "rejected"].into_iter().collect()
        );
        assert!(tw
            .pending_memories
            .iter()
            .any(|m| m.reviewer_notes.as_deref() == Some("too personal")));

        // Contact aliases/notes, tone payloads, reflections, channel refs.
        assert_eq!(tw.contacts[0].alias.as_deref(), Some("Alice A."));
        assert_eq!(tw.contacts[0].notes.as_deref(), Some("Main collaborator"));
        assert_eq!(tw.tones[0].examples_json.as_deref(), Some("[\"hi\"]"));
        assert_eq!(tw.reflections[0].prompt_seed, "How is Alice?");
        assert_eq!(tw.channels[0].credential_id, "cred-does-not-exist");
        assert_eq!(tw.channels[0].persona_id.as_deref(), Some("persona-gone"));

        // Import into a fresh DB and read the rows back.
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(result.twins_imported, 1);
        assert!(result.import_conflicts.is_empty());

        let conn = target.get().unwrap();
        let (tid, slug, is_active, directives): (String, String, i32, Option<String>) = conn
            .query_row(
                "SELECT id, slug, is_active, training_directives FROM twin_profiles \
                 WHERE name = 'Founder Twin'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        // Fresh uuid, re-derived slug, never active.
        assert_ne!(tid, "t1");
        assert_eq!(slug, "founder-twin");
        assert_eq!(is_active, 0);
        assert_eq!(directives.as_deref(), Some("Be terse."));

        let child_count = |table: &str| -> i32 {
            conn.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE twin_id = ?1"),
                [tid.as_str()],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(child_count("twin_tones"), 1);
        assert_eq!(child_count("twin_communications"), 2);
        assert_eq!(child_count("twin_pending_memories"), 3);
        assert_eq!(child_count("twin_contacts"), 1);
        assert_eq!(child_count("twin_reflections"), 1);
        assert_eq!(child_count("twin_channels"), 1);
        // The orphan-sourced fact is dropped (AC3); the cited one survives.
        assert_eq!(child_count("twin_distilled_facts"), 1);

        let summary: Option<String> = conn
            .query_row(
                "SELECT summary FROM twin_communications WHERE twin_id = ?1 AND direction = 'out'",
                [tid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(summary.as_deref(), Some("What is your pricing philosophy?"));
    }

    /// AC5 — the three excluded profile columns and the dead voice table never
    /// appear anywhere in a serialized bundle, by name or by value.
    #[test]
    fn twin_bundle_never_carries_slug_is_active_subpath_or_voice() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);
        let json = serde_json::to_string(&bundle).unwrap();

        for forbidden in [
            "\"slug\"",
            "\"obsidian_subpath\"",
            "voice_profiles",
            "\"voice_id\"",
            "voice-123",
            "slug-t1",
            "personas/twins/slug-t1",
        ] {
            assert!(
                !json.contains(forbidden),
                "bundle must not contain {forbidden}"
            );
        }
        // `is_active` DOES appear on channel rows (it is a real exported column
        // there, and the import forces it to 0); the PROFILE-level one is what
        // must never travel, so assert on the twin object's shape.
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let twin = &v["twins"][0];
        assert!(twin.get("slug").is_none());
        assert!(twin.get("is_active").is_none());
        assert!(twin.get("obsidian_subpath").is_none());
        assert!(twin.get("knowledge_base_id").is_none());
    }

    /// AC3 — a fact whose sources all fail to remap is dropped with a warning,
    /// never written with an empty `sources_json` (which the repo rejects).
    #[test]
    fn twin_facts_never_import_with_empty_sources() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        let conn = target.get().unwrap();
        let mut stmt = conn
            .prepare("SELECT sources_json FROM twin_distilled_facts")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(rows.len(), 1);
        for s in &rows {
            let ids: Vec<String> = serde_json::from_str(s).unwrap();
            assert!(!ids.is_empty(), "sources_json must never be empty");
            // Remapped, not the source machine's ids.
            assert!(!ids.iter().any(|i| i.starts_with("comm-")));
        }
        assert!(result
            .warnings
            .iter()
            .any(|w| w.contains("Orphan fact") && w.contains("without provenance")));
    }

    /// AC4 — an unresolvable channel imports disabled and says what to re-link.
    #[test]
    fn twin_channel_with_dead_credential_imports_disabled_with_warning() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        let conn = target.get().unwrap();
        let (is_active, cred, persona): (i32, String, Option<String>) = conn
            .query_row(
                "SELECT is_active, credential_id, persona_id FROM twin_channels",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(is_active, 0, "an imported channel must never be live");
        // Kept verbatim — never auto-matched onto some other credential.
        assert_eq!(cred, "cred-does-not-exist");
        assert_eq!(persona.as_deref(), Some("persona-gone"));
        assert!(result.warnings.iter().any(|w| {
            w.contains("Main server") && w.contains("credential") && w.contains("persona")
        }));
    }

    /// AC2 — twin conflict detection + all three resolutions.
    #[test]
    fn twin_reimport_conflicts_then_skip_replace_duplicate() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);
        let target = init_test_db().unwrap();
        import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        let first_id: String = {
            let conn = target.get().unwrap();
            conn.query_row("SELECT id FROM twin_profiles", [], |r| r.get(0))
                .unwrap()
        };

        // Pass 1 again: matched by name (NOT slug — the slug was re-derived).
        let second = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(second.twins_imported, 0);
        assert_eq!(second.import_conflicts.len(), 1);
        let c = &second.import_conflicts[0];
        assert_eq!(c.kind, "twin");
        assert_eq!(c.bundle_id, "t1");
        assert_eq!(c.name, "Founder Twin");
        assert_eq!(c.detail, None);
        assert_eq!(c.existing_id, first_id);
        assert_eq!(c.matched_by, "name");

        // skip → nothing new.
        let mut res = HashMap::new();
        res.insert("twin:t1".to_string(), "skip".to_string());
        let third = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(third.twins_skipped, 1);
        assert_eq!(third.twins_imported, 0);
        {
            let conn = target.get().unwrap();
            let n: i32 = conn
                .query_row("SELECT COUNT(*) FROM twin_profiles", [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1);
        }

        // replace → same id survives, children rebuilt (no duplication).
        let mut res = HashMap::new();
        res.insert("twin:t1".to_string(), "replace".to_string());
        let fourth = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(fourth.twins_imported, 1);
        {
            let conn = target.get().unwrap();
            let ids: Vec<String> = conn
                .prepare("SELECT id FROM twin_profiles")
                .unwrap()
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            assert_eq!(ids, vec![first_id.clone()]);
            let comms: i32 = conn
                .query_row("SELECT COUNT(*) FROM twin_communications", [], |r| r.get(0))
                .unwrap();
            assert_eq!(comms, 2, "replace rebuilds children, it does not append");
        }

        // duplicate → a second twin, every soft ref remapped onto its own rows.
        let mut res = HashMap::new();
        res.insert("twin:t1".to_string(), "duplicate".to_string());
        let fifth = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(fifth.twins_imported, 1);

        let conn = target.get().unwrap();
        let dup_id: String = conn
            .query_row(
                "SELECT id FROM twin_profiles WHERE name = 'Founder Twin (imported)'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(dup_id, first_id);
        let dup_slug: String = conn
            .query_row("SELECT slug FROM twin_profiles WHERE id = ?1", [dup_id.as_str()], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(dup_slug, "founder-twin-imported");
        // The duplicate's fact cites the duplicate's OWN communication.
        let (fact_sources, dup_comm_ids): (String, Vec<String>) = {
            let s: String = conn
                .query_row(
                    "SELECT sources_json FROM twin_distilled_facts WHERE twin_id = ?1",
                    [dup_id.as_str()],
                    |r| r.get(0),
                )
                .unwrap();
            let ids: Vec<String> = conn
                .prepare("SELECT id FROM twin_communications WHERE twin_id = ?1")
                .unwrap()
                .query_map([dup_id.as_str()], |r| r.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            (s, ids)
        };
        let cited: Vec<String> = serde_json::from_str(&fact_sources).unwrap();
        assert_eq!(cited.len(), 1);
        assert!(dup_comm_ids.contains(&cited[0]));
        // …and the memory's provenance points at the duplicate's own row too.
        let mem_source: Option<String> = conn
            .query_row(
                "SELECT source_communication_id FROM twin_pending_memories \
                 WHERE twin_id = ?1 LIMIT 1",
                [dup_id.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert!(dup_comm_ids.contains(&mem_source.expect("memory keeps its provenance")));
    }

    /// AC6 — exceeding a cap warns, naming what was dropped and how much.
    #[test]
    fn exceeding_twin_caps_warns_instead_of_dropping_silently() {
        let pool = init_test_db().unwrap();
        seed_twin(&pool, "t1", "Founder Twin", None);
        {
            let conn = pool.get().unwrap();
            for i in 0..(MAX_TWIN_REFLECTIONS + 3) {
                conn.execute(
                    "INSERT INTO twin_reflections (id, twin_id, prompt_seed, content, created_at) \
                     VALUES (?1,'t1','seed','body','2026-01-09T00:00:00Z')",
                    rusqlite::params![format!("extra-refl-{i}")],
                )
                .unwrap();
            }
        }
        let mut warnings = Vec::new();
        let twins = collect_twin_exports(&pool, None, None, &mut warnings).unwrap();
        assert_eq!(twins[0].reflections.len(), MAX_TWIN_REFLECTIONS);
        let w = warnings
            .iter()
            .find(|w| w.contains("reflections"))
            .expect("truncation must be reported");
        assert!(w.contains("Founder Twin"), "warning names the twin: {w}");
        assert!(w.contains("dropped"), "warning says how much: {w}");
        assert!(w.contains(&format!("{}", MAX_TWIN_REFLECTIONS)));

        // …and the bundle carries the warning to whoever imports it.
        let bundle = twin_bundle(&pool, None);
        assert!(bundle
            .export_warnings
            .iter()
            .any(|w| w.contains("reflections")));
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert!(result
            .warnings
            .iter()
            .any(|w| w.starts_with("Export note —") && w.contains("reflections")));
    }

    /// The workspace-wide caps a preview CAN see are forecast on the stats
    /// call, which is the only export channel that reaches the exporting user.
    #[test]
    fn export_stats_forecasts_twin_cap_overflow() {
        let pool = init_test_db().unwrap();
        for i in 0..(MAX_TWINS + 2) {
            seed_twin(&pool, &format!("t{i}"), &format!("Twin {i}"), None);
            // Only the first twin may be active; seed_twin sets is_active=1.
            let conn = pool.get().unwrap();
            conn.execute("UPDATE twin_profiles SET is_active = 0", []).unwrap();
        }
        let stats = compute_export_stats(&pool, None).unwrap();
        assert_eq!(stats.twin_count as usize, MAX_TWINS + 2);
        assert!(stats
            .warnings
            .iter()
            .any(|w| w.contains("Twins") && w.contains("at most")));
    }

    /// Selective scope honours `twin_ids` — empty means none, like every other
    /// selective section.
    #[test]
    fn selective_scope_filters_twins() {
        let pool = init_test_db().unwrap();
        seed_twin(&pool, "t1", "Founder Twin", None);
        seed_twin(&pool, "t2", "Personal Twin", None);

        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: Vec::new(),
            workspace_ids: Vec::new(),
            twin_ids: vec!["t2".into()],
            athena_tiers: Vec::new(),
        };
        let bundle = build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include).unwrap();
        assert_eq!(bundle.twins.len(), 1);
        assert_eq!(bundle.twins[0].name, "Personal Twin");

        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: Vec::new(),
            workspace_ids: Vec::new(),
            twin_ids: Vec::new(),
            athena_tiers: Vec::new(),
        };
        let bundle = build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include).unwrap();
        assert!(bundle.twins.is_empty());
    }

    /// AC2/§2 — the knowledge base travels as TEXT only, lands under fresh
    /// ids in the user database, rebinds the twin, and queues a re-embed.
    #[test]
    fn twin_knowledge_base_round_trips_text_only_and_queues_reindex() {
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_twin_kb(&source_user, "kb-old");
        seed_twin(&source, "t1", "Founder Twin", Some("kb-old"));

        let bundle = twin_bundle(&source, Some(&source_user));
        let kb = bundle.twins[0]
            .knowledge_base
            .as_ref()
            .expect("bound KB travels");
        assert_eq!(kb.documents.len(), 1);
        assert_eq!(kb.chunks.len(), 2);
        assert_eq!(kb.embedding_dims, 384);

        // No vectors, no embeddings, no local credential ref.
        let json = serde_json::to_string(&bundle).unwrap();
        for forbidden in ["kb_vec", "embedding\"", "\"credential_id\":\"kb-cred-old\""] {
            assert!(!json.contains(forbidden), "bundle must not contain {forbidden}");
        }

        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let result = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();
        assert_eq!(result.twins_imported, 1);
        assert_eq!(result.twin_kb_chunks_imported, 2);
        assert_eq!(result.pending_kb_reindex.len(), 1);

        let new_kb_id = &result.pending_kb_reindex[0];
        assert_ne!(new_kb_id, "kb-old");

        let uconn = target_user.get().unwrap();
        let (docs, chunks): (i64, i64) = uconn
            .query_row(
                "SELECT document_count, chunk_count FROM knowledge_bases WHERE id = ?1",
                [new_kb_id.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((docs, chunks), (1, 2));
        let contents: Vec<String> = uconn
            .prepare("SELECT content FROM kb_chunks WHERE kb_id = ?1 ORDER BY chunk_index")
            .unwrap()
            .query_map([new_kb_id.as_str()], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(contents, vec!["first chunk", "second chunk"]);

        // The twin is rebound to the NEW kb, and a vault shell exists for it.
        let conn = target.get().unwrap();
        let bound: Option<String> = conn
            .query_row(
                "SELECT knowledge_base_id FROM twin_profiles WHERE name = 'Founder Twin'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bound.as_deref(), Some(new_kb_id.as_str()));
        let shells: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_credentials WHERE service_type = 'personas_vector_db'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(shells, 1);
    }

    /// An unreachable knowledge base never fails the export — the twin travels
    /// without it plus a warning.
    #[test]
    fn twin_with_unresolvable_kb_exports_with_a_warning() {
        let source = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", Some("kb-missing"));

        let mut warnings = Vec::new();
        let twins = collect_twin_exports(&source, Some(&user), None, &mut warnings).unwrap();
        assert_eq!(twins.len(), 1);
        assert!(twins[0].knowledge_base.is_none());
        assert!(warnings
            .iter()
            .any(|w| w.contains("kb-missing") && w.contains("no longer exists")));
    }

    /// Per-field length validation — NOT just count caps. A bundle with an
    /// oversize communication is rejected before it reaches the DB layer.
    #[test]
    fn validate_bundle_rejects_oversize_twin_text_and_bad_enums() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);

        let mut bundle = twin_bundle(&source, None);
        bundle.twins[0].communications[0].content = "x".repeat(MAX_MEMORY_CONTENT_LEN + 1);
        assert!(validate_bundle(&bundle).is_err());

        let mut bundle = twin_bundle(&source, None);
        bundle.twins[0].pending_memories[0].reviewer_notes =
            Some("y".repeat(MAX_MEMORY_CONTENT_LEN + 1));
        assert!(validate_bundle(&bundle).is_err());

        let mut bundle = twin_bundle(&source, None);
        bundle.twins[0].pending_memories[0].status = "bogus".into();
        assert!(validate_bundle(&bundle).is_err());

        let mut bundle = twin_bundle(&source, None);
        bundle.twins[0].communications[0].direction = "sideways".into();
        assert!(validate_bundle(&bundle).is_err());

        // The unmodified bundle still validates.
        assert!(validate_bundle(&twin_bundle(&source, None)).is_ok());
    }

    #[test]
    fn validate_bundle_rejects_too_many_twins() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let mut bundle = twin_bundle(&source, None);
        while bundle.twins.len() <= MAX_TWINS {
            let tw = &bundle.twins[0];
            bundle.twins.push(TwinExport {
                id: uuid::Uuid::new_v4().to_string(),
                name: tw.name.clone(),
                bio: None,
                role: None,
                languages: None,
                pronouns: None,
                training_directives: None,
                created_at: tw.created_at.clone(),
                updated_at: tw.updated_at.clone(),
                tones: Vec::new(),
                communications: Vec::new(),
                pending_memories: Vec::new(),
                distilled_facts: Vec::new(),
                contacts: Vec::new(),
                reflections: Vec::new(),
                channels: Vec::new(),
                knowledge_base: None,
            });
        }
        assert!(validate_bundle(&bundle).is_err());
    }

    // ------------------------------------------------------------------
    // AC7 — dev-project conflict REGRESSION guard
    //
    // The project conflict path is shipped, working code that WP1 only
    // genericized (`ProjectConflict` → `ImportConflict`, flat `"kind:id"`
    // resolution keys). This test pins the behaviour end to end so the
    // refactor can be shown not to have changed it: same detection, same
    // matched_by, same replace/skip/duplicate outcomes, same counters —
    // with the project's `root_path` now surfacing through the generic
    // `detail` field.
    // ------------------------------------------------------------------

    #[test]
    fn dev_project_conflict_path_is_unchanged_by_genericization() {
        let bundle = source_bundle("/tmp/portability-regression-p1");
        let target = init_test_db().unwrap();

        // Pass 1, fresh target: imports cleanly, no conflicts.
        let first = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(first.projects_imported, 1);
        assert_eq!(first.projects_skipped, 0);
        assert!(first.import_conflicts.is_empty());

        // Pass 1, second run: conflict by root_path, project NOT imported.
        let second = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(second.projects_imported, 0);
        assert_eq!(second.projects_skipped, 0);
        assert_eq!(second.import_conflicts.len(), 1);
        let c = &second.import_conflicts[0];
        assert_eq!(c.kind, "project");
        assert_eq!(c.bundle_id, "p1");
        assert_eq!(c.name, "Project p1");
        assert_eq!(c.existing_id, "p1");
        assert_eq!(c.matched_by, "root_path");
        // root_path moved from its own field into the generic `detail`.
        assert_eq!(c.detail.as_deref(), Some("/tmp/portability-regression-p1"));

        // A resolution keyed the OLD way (bare id) must not be honoured —
        // otherwise the two-pass flow would silently half-work.
        let mut legacy_key = HashMap::new();
        legacy_key.insert("p1".to_string(), "duplicate".to_string());
        let ignored = import_bundle(&target, None, &bundle, &legacy_key).unwrap();
        assert_eq!(ignored.projects_imported, 0);
        assert_eq!(ignored.projects_skipped, 0);

        // skip / replace / duplicate all behave exactly as before.
        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "skip".to_string());
        let skipped = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(skipped.projects_skipped, 1);
        assert_eq!(skipped.projects_imported, 0);

        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "replace".to_string());
        let replaced = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(replaced.projects_imported, 1);
        assert!(replaced.import_conflicts.is_empty());
        {
            // Scoped to the BUNDLED project: the KPI phase also materializes a
            // dormant "Imported" placeholder project, which predates this work.
            let conn = target.get().unwrap();
            let n: i32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_projects WHERE root_path = ?1",
                    ["/tmp/portability-regression-p1"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "replace keeps exactly one copy of the bundled project");
            let id: String = conn
                .query_row(
                    "SELECT id FROM dev_projects WHERE root_path = ?1",
                    ["/tmp/portability-regression-p1"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(id, "p1", "replace preserves the existing project id");
        }

        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "duplicate".to_string());
        let duplicated = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(duplicated.projects_imported, 1);
        {
            let conn = target.get().unwrap();
            let n: i32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_projects WHERE name LIKE 'Project p1%'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 2, "duplicate lands alongside the original");
        }

        // Unknown resolution: warned, not imported (unchanged behaviour).
        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "nonsense".to_string());
        let bad = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(bad.projects_imported, 0);
        assert!(bad
            .warnings
            .iter()
            .any(|w| w.contains("unknown resolution 'nonsense'")));
    }

    // ========================================================================
    // Athena memory (WP2)
    // ========================================================================

    /// A throwaway brain directory. `brain_root()` honours `PERSONAS_HOME`, so
    /// pointing it at a temp dir gives every Athena test a real filesystem to
    /// write markdown into without touching the developer's own brain.
    ///
    /// The guard restores the previous value on drop AND serialises every
    /// Athena test through one mutex: `PERSONAS_HOME` is process-global, and
    /// two tests running in parallel would each see the other's brain.
    struct BrainHome {
        dir: std::path::PathBuf,
        prev: Option<String>,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    static BRAIN_HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    impl BrainHome {
        fn new() -> Self {
            let lock = BRAIN_HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let dir = std::env::temp_dir().join(format!("personas_brain_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(dir.join("companion-brain")).unwrap();
            let prev = std::env::var("PERSONAS_HOME").ok();
            std::env::set_var("PERSONAS_HOME", &dir);
            Self {
                dir,
                prev,
                _lock: lock,
            }
        }

        fn root(&self) -> std::path::PathBuf {
            self.dir.join("companion-brain")
        }

        fn write(&self, rel: &str, body: &str) {
            let p = self.root().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
    }

    impl Drop for BrainHome {
        fn drop(&mut self) {
            match self.prev.take() {
                Some(v) => std::env::set_var("PERSONAS_HOME", v),
                None => std::env::remove_var("PERSONAS_HOME"),
            }
        }
    }

    /// Re-point `PERSONAS_HOME` at a fresh directory so an import writes onto a
    /// machine that is not the one the bundle came from. Takes no lock — the
    /// caller already holds it through its own [`BrainHome`].
    struct BrainHomeSwap {
        dir: std::path::PathBuf,
        prev: Option<String>,
    }

    impl BrainHomeSwap {
        fn to_fresh() -> Self {
            let dir = std::env::temp_dir().join(format!("personas_brain_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(dir.join("companion-brain")).unwrap();
            let prev = std::env::var("PERSONAS_HOME").ok();
            std::env::set_var("PERSONAS_HOME", &dir);
            Self { dir, prev }
        }

        fn root(&self) -> std::path::PathBuf {
            self.dir.join("companion-brain")
        }
    }

    impl Drop for BrainHomeSwap {
        fn drop(&mut self) {
            match self.prev.take() {
                Some(v) => std::env::set_var("PERSONAS_HOME", v),
                None => std::env::remove_var("PERSONAS_HOME"),
            }
        }
    }

    fn seed_node(user_db: &UserDbPool, id: &str, kind: &str, rel_path: &str, importance: i64) {
        let conn = user_db.get().unwrap();
        conn.execute(
            "INSERT INTO companion_node \
                (id, kind, file_path, content_hash, importance, embedding_model, embedding_dims, \
                 body_excerpt, created_at, updated_at) \
             VALUES (?1,?2,?3,'sha256:abc',?4,'AllMiniLML6V2Q',384,?5,\
                     '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')",
            rusqlite::params![id, kind, rel_path, importance, format!("excerpt of {id}")],
        )
        .unwrap();
    }

    /// A brain with one of every learned kind, plus every excluded neighbour a
    /// real brain would have sitting next to them. Each excluded row carries a
    /// distinctive sentinel so a leak is visible rather than inferred.
    fn seed_athena_brain(home: &BrainHome, user_db: &UserDbPool) {
        let conn = user_db.get().unwrap();

        // --- core ---
        home.write("identity.md", "# Michal\n\n- Ships on Fridays\n");
        home.write("constitution.md", "SECRET-CONSTITUTION-BODY\n");
        home.write(
            "constitution.bak-20260101T000000.md",
            "SECRET-OLD-CONSTITUTION\n",
        );
        home.write("cockpit.md", "SECRET-COCKPIT\n");
        home.write("dashboard.md", "SECRET-DASHBOARD\n");
        home.write("reflections/2026-01-01_ref_1.md", "SECRET-REFLECTION\n");
        home.write("episodes-archive-20260101T000000/old.md", "SECRET-ARCHIVE\n");

        conn.execute(
            "INSERT INTO companion_session (id, claude_session_id, title, status, pinned, origin) \
             VALUES ('default','SECRET-RESUME-POINTER','Q3 planning','active',1,'user')",
            [],
        )
        .unwrap();

        // --- learned: facts, one superseding the other ---
        home.write("semantic/user/fact_old_editor.md", "Michal used vim.\n");
        home.write("semantic/user/fact_new_editor.md", "Michal uses Zed.\n");
        seed_node(
            user_db,
            "fact_old",
            "fact",
            "semantic/user/fact_old_editor.md",
            0,
        );
        seed_node(
            user_db,
            "fact_new",
            "fact",
            "semantic/user/fact_new_editor.md",
            5,
        );
        conn.execute(
            "INSERT INTO companion_fact \
                (id, scope, fact_key, confidence, supersedes_id, contradicts_id, last_seen_at, \
                 last_decayed_at) \
             VALUES ('fact_old','user','preferred_editor',0.6,NULL,NULL,\
                     '2026-01-01T00:00:00Z',NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO companion_fact \
                (id, scope, fact_key, confidence, supersedes_id, contradicts_id, last_seen_at, \
                 last_decayed_at) \
             VALUES ('fact_new','user','editor_2026',0.93,'fact_old',NULL,\
                     '2026-02-01T00:00:00Z','2026-03-01T00:00:00Z')",
            [],
        )
        .unwrap();
        for ep in ["ep_gone_1", "ep_gone_2"] {
            conn.execute(
                "INSERT INTO companion_provenance (fact_id, episode_id) VALUES ('fact_new', ?1)",
                rusqlite::params![ep],
            )
            .unwrap();
        }

        // --- learned: procedural ---
        home.write("procedurals/chat/proc_brevity.md", "Answer in one line.\n");
        seed_node(
            user_db,
            "proc_1",
            "procedural",
            "procedurals/chat/proc_brevity.md",
            4,
        );
        conn.execute(
            "INSERT INTO companion_procedural \
                (id, scope, trigger_pattern, confidence, supersedes_id, last_used_at, \
                 last_decayed_at) \
             VALUES ('proc_1','chat','when he asks a yes/no question',0.77,NULL,\
                     '2026-02-02T00:00:00Z',NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO companion_provenance (fact_id, episode_id) VALUES ('proc_1','ep_gone_3')",
            [],
        )
        .unwrap();

        // --- learned: goal / backlog / ritual ---
        home.write("goals/goal_ship.md", "Ship the thing.\n");
        seed_node(user_db, "goal_1", "goal", "goals/goal_ship.md", 4);
        conn.execute(
            "INSERT INTO companion_goal \
                (id, title, status, priority, target_date, sources_json, completed_at, \
                 created_at, updated_at) \
             VALUES ('goal_1','Ship v1','active',4,'2026-06-01','[\"ep_gone_1\"]',NULL,\
                     '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')",
            [],
        )
        .unwrap();

        home.write(
            "backlog/self_promise/blog_1.md",
            "I said I would check the logs.\n",
        );
        seed_node(
            user_db,
            "blog_1",
            "backlog",
            "backlog/self_promise/blog_1.md",
            3,
        );
        conn.execute(
            "INSERT INTO companion_backlog_item \
                (id, summary, kind, status, source_episode_id, reminded_count, created_at, \
                 resolved_at) \
             VALUES ('blog_1','Check the deploy logs','self_promise','pending','ep_gone_1',2,\
                     '2026-01-01T00:00:00Z',NULL)",
            [],
        )
        .unwrap();

        home.write("rituals/quiet_hours/ritual_1.md", "No pings after 20:00.\n");
        seed_node(
            user_db,
            "ritual_1",
            "ritual",
            "rituals/quiet_hours/ritual_1.md",
            2,
        );
        conn.execute(
            "INSERT INTO companion_ritual \
                (id, kind, description, schedule_json, active, sources_json, created_at, \
                 updated_at) \
             VALUES ('ritual_1','quiet_hours','No pings after 20:00','{\"from\":\"20:00\"}',1,\
                     '[]','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')",
            [],
        )
        .unwrap();

        // --- learned: design decision (no node, no file) ---
        conn.execute(
            "INSERT INTO companion_design_decision \
                (id, session_id, persona_context, label, choice, rationale, decision_timestamp, \
                 created_at) \
             VALUES ('dec_1','default','Research Analyst','Model','Sonnet',\
                     'Cheaper for summarisation','2026-01-05T00:00:00Z','2026-01-05T00:00:00Z')",
            [],
        )
        .unwrap();

        // --- everything that must NOT travel ---
        home.write("episodes/2026/01/01/ep_1_user.md", "SECRET-EPISODE-BODY\n");
        seed_node(
            user_db,
            "ep_1",
            "episode",
            "episodes/2026/01/01/ep_1_user.md",
            3,
        );
        seed_node(
            user_db,
            "doc_1",
            "doctrine",
            "features/personas/01-data-model.md#capabilities",
            3,
        );
        seed_node(
            user_db,
            "ref_1",
            "reflection",
            "reflections/2026-01-01_ref_1.md",
            2,
        );
        seed_node(user_db, "cockpit", "cockpit", "cockpit.md", 3);
        seed_node(user_db, "dashboard", "dashboard", "dashboard.md", 3);
        conn.execute(
            "INSERT INTO companion_known_project (id, name, path) \
             VALUES ('kp_1','x','C:\\SECRET-ABSOLUTE-PATH')",
            [],
        )
        .unwrap();
    }

    fn seed_athena_prefs(pool: &DbPool) {
        for (k, v) in [
            ("companion_autonomous_mode", "true"),
            ("companion_fleet_boldness", "bold"),
            ("companion_profile_synthesis", "false"),
            // Not portable — must be refused by the whitelist, never carried.
            ("companion_profile_synthesis_last", "SECRET-LOCAL-TIMESTAMP"),
        ] {
            settings_repo::set(pool, k, v).unwrap();
        }
    }

    fn athena_bundle(pool: &DbPool, user_db: &UserDbPool) -> PortabilityBundle {
        build_export_bundle(
            pool,
            Some(user_db),
            ExportScope::Full,
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap()
    }

    /// AC1 — both tiers survive a round trip, sidecar fields included.
    #[test]
    fn athena_round_trips_both_tiers_with_every_sidecar_field() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&source);
        seed_athena_brain(&home, &source_user);

        let bundle = athena_bundle(&source, &source_user);
        let a = bundle.athena.as_ref().expect("Athena section travels");

        // Core.
        assert!(a
            .identity_md
            .as_deref()
            .unwrap()
            .contains("Ships on Fridays"));
        assert_eq!(a.prefs.len(), 3, "only the three portable prefs");
        assert_eq!(a.sessions.len(), 1);
        assert_eq!(a.sessions[0].title.as_deref(), Some("Q3 planning"));

        // Learned: five nodes, one per kind, and nothing else.
        assert_eq!(
            a.nodes.len(),
            6,
            "two facts (one superseded) plus one each of the other kinds — and no              doctrine, episode, reflection, cockpit or dashboard"
        );
        let mut kinds: Vec<&str> = a.nodes.iter().map(|n| n.kind.as_str()).collect();
        kinds.sort();
        assert_eq!(
            kinds,
            vec!["backlog", "fact", "fact", "goal", "procedural", "ritual"]
        );
        // Bodies, not just index rows.
        let fact_node = a.nodes.iter().find(|n| n.id == "fact_new").unwrap();
        assert_eq!(fact_node.body, "Michal uses Zed.\n");
        assert_eq!(fact_node.importance, 5);

        assert_eq!(a.facts.len(), 2, "the superseded fact is still a fact");
        assert_eq!(a.decisions.len(), 1);
        assert_eq!(a.provenance.len(), 3, "two for fact_new, one for proc_1");

        // Now import onto a clean machine with its own brain directory.
        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let target_home = BrainHomeSwap::to_fresh();
        let result = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();

        assert_eq!(
            result.athena_memory_imported, 7,
            "six nodes plus one design decision"
        );
        assert_eq!(result.reembed_queued, 6, "decisions are never embedded");

        let conn = target_user.get().unwrap();
        let (conf, sup, contra, decayed): (f64, Option<String>, Option<String>, Option<String>) =
            conn.query_row(
                "SELECT confidence, supersedes_id, contradicts_id, last_decayed_at \
                 FROM companion_fact WHERE id = 'fact_new'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert!((conf - 0.93).abs() < 1e-9, "confidence survives");
        assert_eq!(sup.as_deref(), Some("fact_old"), "supersedes_id remaps");
        assert_eq!(contra, None);
        assert_eq!(decayed.as_deref(), Some("2026-03-01T00:00:00Z"));

        let importance: i64 = conn
            .query_row(
                "SELECT importance FROM companion_node WHERE id = 'fact_new'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(importance, 5, "importance survives");

        let (label, rationale): (String, String) = conn
            .query_row(
                "SELECT label, rationale FROM companion_design_decision WHERE id = 'dec_1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(label, "Model");
        assert_eq!(rationale, "Cheaper for summarisation");

        // Procedural sidecar too — confidence is the field most likely to be
        // quietly dropped by a column-order mistake.
        let (scope, trigger, pconf): (String, String, f64) = conn
            .query_row(
                "SELECT scope, trigger_pattern, confidence FROM companion_procedural \
                 WHERE id = 'proc_1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(scope, "chat");
        assert_eq!(trigger, "when he asks a yes/no question");
        assert!((pconf - 0.77).abs() < 1e-9);

        // The markdown landed on THIS machine's brain root, re-anchored.
        let body =
            std::fs::read_to_string(target_home.root().join("semantic/user/fact_new_editor.md"))
                .expect("markdown written before the row");
        assert_eq!(body, "Michal uses Zed.\n");

        // Prefs applied to the target's app database; the non-portable one not.
        assert_eq!(
            settings_repo::get(&target, "companion_fleet_boldness").unwrap(),
            Some("bold".to_string())
        );
        assert_eq!(
            settings_repo::get(&target, "companion_profile_synthesis_last").unwrap(),
            None,
            "a non-portable pref must never be written by an import"
        );
        drop(target_home);
        drop(home);
    }

    /// AC2 — importing the same bundle twice adds nothing the second time.
    /// Dedup is by CONTENT, not id, so this holds even after ids are reissued.
    #[test]
    fn athena_second_import_creates_no_duplicates() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&source);
        seed_athena_brain(&home, &source_user);
        let bundle = athena_bundle(&source, &source_user);

        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let target_home = BrainHomeSwap::to_fresh();

        let first = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();
        assert_eq!(first.athena_memory_imported, 7);

        let second = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();
        assert_eq!(
            second.athena_memory_imported, 0,
            "second import of the same bundle adds nothing"
        );
        assert_eq!(second.reembed_queued, 0);
        assert!(second
            .warnings
            .iter()
            .any(|w| w.contains("already in her brain")));

        let conn = target_user.get().unwrap();
        for (table, expected) in [
            ("companion_fact", 2),
            ("companion_procedural", 1),
            ("companion_goal", 1),
            ("companion_backlog_item", 1),
            ("companion_ritual", 1),
            ("companion_design_decision", 1),
            ("companion_node", 6),
        ] {
            let n: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, expected, "{table} must not gain a duplicate");
        }
        drop(target_home);
        drop(home);
    }

    /// AC3 — identity.md is backed up before it is replaced.
    #[test]
    fn athena_import_backs_up_identity_before_replacing_it() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_brain(&home, &source_user);
        let bundle = athena_bundle(&source, &source_user);

        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let target_home = BrainHomeSwap::to_fresh();
        // The target already knows someone. That file must not just vanish.
        std::fs::write(
            target_home.root().join("identity.md"),
            "# Someone else\n\n- Prior beliefs\n",
        )
        .unwrap();

        let result = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();
        assert!(result.athena_identity_replaced);

        let replaced = std::fs::read_to_string(target_home.root().join("identity.md")).unwrap();
        assert!(replaced.contains("Ships on Fridays"));

        let backups: Vec<String> = std::fs::read_dir(target_home.root())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("identity.bak-"))
            .collect();
        assert_eq!(backups.len(), 1, "exactly one backup, named by identity.rs");
        let prior = std::fs::read_to_string(target_home.root().join(&backups[0])).unwrap();
        assert!(
            prior.contains("Prior beliefs"),
            "the backup holds what was there before, not the incoming file"
        );
        drop(target_home);
        drop(home);
    }

    /// AC4 — nothing excluded reaches the bundle. Asserted three ways: by
    /// field NAME (no excluded table leaks in as a key), by VALUE (no excluded
    /// node kind or on-disk file appears), and by SENTINEL (each excluded row
    /// was seeded with a distinctive string that must be absent).
    #[test]
    fn athena_bundle_excludes_every_forbidden_name() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&source);
        seed_athena_brain(&home, &source_user);

        let bundle = athena_bundle(&source, &source_user);
        let athena = bundle.athena.as_ref().expect("section present");
        let value = serde_json::to_value(athena).unwrap();

        // 1. By name — no excluded table or column appears as a JSON key.
        fn keys(v: &serde_json::Value, out: &mut Vec<String>) {
            match v {
                serde_json::Value::Object(m) => {
                    for (k, child) in m {
                        out.push(k.clone());
                        keys(child, out);
                    }
                }
                serde_json::Value::Array(items) => items.iter().for_each(|c| keys(c, out)),
                _ => {}
            }
        }
        let mut all_keys = Vec::new();
        keys(&value, &mut all_keys);
        for forbidden in ATHENA_FORBIDDEN_NAMES {
            assert!(
                !all_keys.iter().any(|k| k.contains(forbidden)),
                "bundle must not carry a `{forbidden}` field"
            );
        }

        // 2. By value — no excluded node kind or on-disk file.
        for n in &athena.nodes {
            for forbidden in ATHENA_FORBIDDEN_CONTENT {
                assert_ne!(n.kind, forbidden, "node kind `{forbidden}` must not travel");
                assert!(
                    !n.file_path.contains(forbidden),
                    "file `{forbidden}` must not travel (saw {})",
                    n.file_path
                );
            }
        }

        // 3. By sentinel — every excluded row was seeded with a marker.
        let json = serde_json::to_string(&bundle).unwrap();
        for sentinel in [
            "SECRET-RESUME-POINTER", // companion_session.claude_session_id
            "SECRET-EPISODE-BODY",   // an episode's markdown
            "SECRET-CONSTITUTION-BODY",
            "SECRET-OLD-CONSTITUTION",
            "SECRET-COCKPIT",
            "SECRET-DASHBOARD",
            "SECRET-REFLECTION",
            "SECRET-ARCHIVE",
            "SECRET-ABSOLUTE-PATH",   // companion_known_project
            "SECRET-LOCAL-TIMESTAMP", // a non-portable app_setting
        ] {
            assert!(!json.contains(sentinel), "bundle leaked {sentinel}");
        }
        drop(home);
    }

    /// AC5 — provenance whose episode never travelled degrades to a plain
    /// dangling id: `load_sources` reads `companion_provenance` with no join,
    /// so the readers return it verbatim instead of erroring. Asserted through
    /// the public readers, on state an import actually produced, rather than
    /// by reading the SQL and trusting it.
    #[test]
    fn load_sources_tolerates_provenance_whose_episode_is_absent() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_brain(&home, &source_user);
        let bundle = athena_bundle(&source, &source_user);

        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let target_home = BrainHomeSwap::to_fresh();
        import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();

        // The episodes are definitely not here.
        {
            let conn = target_user.get().unwrap();
            let episodes: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM companion_node WHERE kind = 'episode'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(episodes, 0);
        }

        let facts = crate::companion::brain::semantic::list_facts(&target_user, None, true, 50)
            .expect("list_facts must not error on dangling provenance");
        let imported = facts.iter().find(|f| f.id == "fact_new").expect("fact");
        assert_eq!(
            imported.sources,
            vec!["ep_gone_1".to_string(), "ep_gone_2".to_string()],
            "the sourcing survives even though the conversations did not"
        );

        let rules = crate::companion::brain::procedural::list_rules(&target_user, None, true, 50)
            .expect("list_rules must not error on dangling provenance");
        let rule = rules.iter().find(|r| r.id == "proc_1").expect("rule");
        assert_eq!(rule.sources, vec!["ep_gone_3".to_string()]);

        // And a memory with NO provenance at all reads as an empty list.
        {
            let conn = target_user.get().unwrap();
            conn.execute("DELETE FROM companion_provenance", []).unwrap();
        }
        let facts = crate::companion::brain::semantic::list_facts(&target_user, None, true, 50)
            .expect("no provenance is still not an error");
        assert!(facts.iter().all(|f| f.sources.is_empty()));
        drop(target_home);
        drop(home);
    }

    /// AC8 — both sections round-trip through their envelopes, the plaintext
    /// fields are empty on the wire, and `format_version` says 3.
    #[test]
    fn twins_and_athena_round_trip_encrypted_and_bump_the_format_version() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        seed_athena_brain(&home, &source_user);

        let mut bundle = athena_bundle(&source, &source_user);
        assert_eq!(bundle.format_version, 2, "an unsealed bundle is still v2");
        seal_sensitive_sections(&mut bundle, Some("correct horse battery")).unwrap();

        assert_eq!(bundle.format_version, 3);
        assert!(bundle.twins.is_empty(), "plaintext twins cleared");
        assert!(bundle.athena.is_none(), "plaintext athena cleared");
        assert!(bundle.encrypted_twins.is_some());
        assert!(bundle.encrypted_athena.is_some());

        // Nothing recognisable on the wire.
        let json = serde_json::to_string(&bundle).unwrap();
        for sentinel in ["Founder Twin", "Ships on Fridays", "Michal uses Zed"] {
            assert!(!json.contains(sentinel), "sealed bundle leaked {sentinel}");
        }

        // Wrong passphrase: a warning and empty sections, never a half-read.
        let mut wrong: PortabilityBundle = serde_json::from_str(&json).unwrap();
        let mut warnings = Vec::new();
        unseal_sensitive_sections(&mut wrong, Some("not the passphrase"), &mut warnings);
        assert!(wrong.twins.is_empty() && wrong.athena.is_none());
        assert_eq!(warnings.len(), 2, "one warning per undecryptable section");

        // No passphrase at all: same shape, different reason.
        let mut none: PortabilityBundle = serde_json::from_str(&json).unwrap();
        let mut warnings = Vec::new();
        unseal_sensitive_sections(&mut none, None, &mut warnings);
        assert_eq!(warnings.len(), 2);
        assert!(warnings.iter().all(|w| w.contains("No passphrase")));

        // Right passphrase: everything comes back, and each section decrypts
        // independently of the other.
        let mut good: PortabilityBundle = serde_json::from_str(&json).unwrap();
        let mut warnings = Vec::new();
        unseal_sensitive_sections(&mut good, Some("correct horse battery"), &mut warnings);
        assert!(warnings.is_empty());
        assert_eq!(good.twins.len(), 1);
        assert_eq!(good.twins[0].name, "Founder Twin");
        assert_eq!(good.athena.as_ref().unwrap().nodes.len(), 6);
        // And what came back is what validation will see.
        validate_bundle(&good).expect("decrypted bundle validates");
        drop(home);
    }

    /// AC8 — the backend refuses an EXPLICIT selection it cannot encrypt. The
    /// frontend gates this too, but the frontend is not the boundary.
    #[test]
    fn export_refuses_a_selected_sensitive_scope_without_a_passphrase() {
        assert!(require_passphrase_for_selection(&[], &[], None).is_ok());
        assert!(
            require_passphrase_for_selection(&["t1".into()], &[], None).is_err(),
            "selected twins with no passphrase must fail"
        );
        assert!(
            require_passphrase_for_selection(&[], &["learned".into()], None).is_err(),
            "a selected Athena tier with no passphrase must fail"
        );
        assert!(require_passphrase_for_selection(
            &["t1".into()],
            &["core".into()],
            Some("longenough")
        )
        .is_ok());
        // An unknown tier is its own error, not masked by the passphrase one.
        let err =
            require_passphrase_for_selection(&[], &["lerned".into()], Some("longenough")).unwrap_err();
        assert!(format!("{err}").contains("unknown tier"));
    }

    /// A Full-scope export with no passphrase carries neither section — the
    /// same trade this command already makes with credential secrets — and
    /// says so rather than leaving the receiver to guess.
    #[test]
    fn full_export_without_a_passphrase_omits_both_sensitive_sections() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        seed_athena_brain(&home, &source_user);

        let bundle = build_export_bundle(
            &source,
            Some(&source_user),
            ExportScope::Full,
            true,
            true,
            SensitiveSections::Omit,
        )
        .unwrap();
        assert!(bundle.twins.is_empty());
        assert!(bundle.athena.is_none());
        assert!(bundle
            .export_warnings
            .iter()
            .any(|w| w.contains("without a passphrase")));
        // Sealing a bundle with nothing sensitive in it is a no-op, not an error.
        let mut bundle = bundle;
        seal_sensitive_sections(&mut bundle, None).expect("nothing to seal");
        assert_eq!(bundle.format_version, 2);
        drop(home);
    }

    /// The export preview drives which tiers the picker offers, so an empty
    /// tier has to read as 0 rather than as "some".
    #[test]
    fn export_stats_report_both_athena_tiers() {
        let home = BrainHome::new();
        let pool = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();

        let empty = compute_export_stats(&pool, Some(&user)).unwrap();
        assert_eq!(empty.athena_core_count, 0);
        assert_eq!(empty.athena_learned_count, 0);

        seed_athena_prefs(&pool);
        seed_athena_brain(&home, &user);
        let stats = compute_export_stats(&pool, Some(&user)).unwrap();
        // identity.md + 3 portable prefs + 1 conversation.
        assert_eq!(stats.athena_core_count, 5);
        // 6 learned nodes + 1 design decision; doctrine / episode / reflection /
        // cockpit / dashboard are not learned memory.
        assert_eq!(stats.athena_learned_count, 7);
        drop(home);
    }

    /// Selective scope picks Athena by tier, not by id.
    #[test]
    fn athena_tiers_select_only_what_was_asked_for() {
        let home = BrainHome::new();
        let pool = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&pool);
        seed_athena_brain(&home, &user);

        let scope_for = |tiers: Vec<String>| ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: Vec::new(),
            workspace_ids: Vec::new(),
            twin_ids: Vec::new(),
            athena_tiers: tiers,
        };

        let core_only = build_export_bundle(
            &pool,
            Some(&user),
            scope_for(vec!["core".into()]),
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap();
        let a = core_only.athena.as_ref().unwrap();
        assert!(a.identity_md.is_some() && !a.sessions.is_empty());
        assert!(a.nodes.is_empty() && a.decisions.is_empty());

        let learned_only = build_export_bundle(
            &pool,
            Some(&user),
            scope_for(vec!["learned".into()]),
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap();
        let a = learned_only.athena.as_ref().unwrap();
        assert!(a.identity_md.is_none() && a.sessions.is_empty() && a.prefs.is_empty());
        assert_eq!(a.nodes.len(), 6);

        let neither = build_export_bundle(
            &pool,
            Some(&user),
            scope_for(Vec::new()),
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap();
        assert!(neither.athena.is_none());
        drop(home);
    }

    /// Validation is the import boundary, so the rules that matter most there
    /// get their own test: an unknown enum (which would import fine and then
    /// break `list_facts` at read time), a non-portable pref key (which would
    /// let a bundle write arbitrary app settings), and a traversal path.
    #[test]
    fn validate_athena_rejects_bad_enums_foreign_pref_keys_and_traversal() {
        let home = BrainHome::new();
        let pool = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&pool);
        seed_athena_brain(&home, &user);

        let good = athena_bundle(&pool, &user);
        validate_bundle(&good).expect("a real bundle validates");

        let mut bad = athena_bundle(&pool, &user);
        bad.athena.as_mut().unwrap().facts[0].scope = "elsewhere".into();
        assert!(validate_bundle(&bad).is_err(), "unknown fact scope refused");

        let mut bad = athena_bundle(&pool, &user);
        bad.athena.as_mut().unwrap().prefs.push(AthenaPrefExport {
            key: "anthropic_api_key".into(),
            value: "sk-leak".into(),
        });
        let err = validate_bundle(&bad).unwrap_err();
        assert!(
            format!("{err}").contains("not a portable Athena preference"),
            "app_settings is not an open write surface for a bundle"
        );

        let mut bad = athena_bundle(&pool, &user);
        bad.athena.as_mut().unwrap().nodes[0].file_path = "../../../etc/passwd".into();
        assert!(
            validate_bundle(&bad).is_err(),
            "a traversal path would escape the brain directory on import"
        );
        drop(home);
    }

    /// A memory whose markdown is gone is dropped WITH its sidecar, by name.
    /// Half a memory — an index row pointing at a file that does not exist —
    /// is worse than none.
    #[test]
    fn athena_drops_a_node_whose_body_cannot_be_read_and_says_so() {
        let home = BrainHome::new();
        let pool = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        seed_athena_brain(&home, &user);
        // Delete one memory's markdown behind the index's back.
        std::fs::remove_file(home.root().join("semantic/user/fact_new_editor.md")).unwrap();

        let mut warnings = Vec::new();
        let a = collect_athena_export(&pool, Some(&user), AthenaTiers::both(), &mut warnings)
            .unwrap()
            .unwrap();

        assert!(a.nodes.iter().all(|n| n.id != "fact_new"));
        assert!(
            a.facts.iter().all(|f| f.id != "fact_new"),
            "the sidecar row must not survive its node"
        );
        assert!(
            a.provenance.iter().all(|p| p.fact_id != "fact_new"),
            "nor its provenance"
        );
        assert!(warnings
            .iter()
            .any(|w| w.contains("fact_new") && w.contains("no readable body")));
        drop(home);
    }
}
