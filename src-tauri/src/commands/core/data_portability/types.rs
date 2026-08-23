//! The bundle envelope plus the persona / team / credential / KPI
//! record shapes, and the import result surface.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

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
    pub(crate) const CORE: &'static str = "core";
    pub(crate) const LEARNED: &'static str = "learned";

    pub(crate) fn none() -> Self {
        Self::default()
    }

    pub(crate) fn both() -> Self {
        Self {
            core: true,
            learned: true,
        }
    }

    pub(crate) fn any(self) -> bool {
        self.core || self.learned
    }

    /// Parse the wire values, rejecting anything unrecognised. A typo must not
    /// degrade into "exported nothing" — the user asked for a tier and would
    /// have no way to tell it never arrived.
    pub(crate) fn parse(tiers: &[String]) -> Result<Self, AppError> {
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
    pub(crate) fn from_scope(scope: &ExportScope) -> Result<Self, AppError> {
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
pub(crate) fn conflict_key(kind: &str, bundle_id: &str) -> String {
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
