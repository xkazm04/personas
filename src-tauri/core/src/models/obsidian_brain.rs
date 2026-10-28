use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── Vault Discovery ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DetectedVault {
    pub name: String,
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultConnectionResult {
    pub valid: bool,
    pub note_count: i64,
    pub vault_name: String,
    pub error: Option<String>,
}

// ── Vault Config ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FolderMapping {
    pub memories_folder: String,
    pub personas_folder: String,
    pub connectors_folder: String,
    // Knowledge-mirror folders. Serde defaults keep older stored configs
    // (written before these existed) deserializing cleanly.
    #[serde(default = "default_research_folder")]
    pub research_folder: String,
    #[serde(default = "default_knowledge_folder")]
    pub knowledge_folder: String,
    #[serde(default = "default_athena_folder")]
    pub athena_folder: String,
}

fn default_research_folder() -> String {
    "Research".into()
}
fn default_knowledge_folder() -> String {
    "Knowledge".into()
}
fn default_athena_folder() -> String {
    "Athena".into()
}

impl Default for FolderMapping {
    fn default() -> Self {
        Self {
            memories_folder: "memories".into(),
            personas_folder: "Personas".into(),
            connectors_folder: "Connectors".into(),
            research_folder: default_research_folder(),
            knowledge_folder: default_knowledge_folder(),
            athena_folder: default_athena_folder(),
        }
    }
}

// ── Knowledge Mirror (opt-in, off by default) ────────────────────────
//
// Per-feature flags for mirroring internal knowledge/memory stores into the
// vault. All default OFF: the app is fully functional with no Obsidian, and
// these take effect only once the user opts in AND a vault is configured.
// See docs/features/plugins/brain/knowledge-mirror.md.

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianMirrorConfig {
    /// Athena may consult the vault as an on-demand tool (read) + selective writes.
    #[serde(default)]
    pub athena: bool,
    /// Mirror the execution-knowledge graph into the vault.
    #[serde(default)]
    pub execution_knowledge: bool,
    /// User dismissed the one-time "we noticed Obsidian" offer.
    #[serde(default)]
    pub offer_dismissed: bool,
}

/// Result of the `obsidian_available` resolver — whether the integration can
/// be offered/enabled, and which presence signals fired.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianAvailability {
    /// Obsidian desktop app binary detected on the machine.
    pub binary_installed: bool,
    /// A vault is configured in the Brain plugin.
    pub vault_configured: bool,
    /// Either signal is enough to surface/enable the integration.
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianVaultConfig {
    pub vault_path: String,
    pub vault_name: String,
    pub sync_memories: bool,
    pub sync_personas: bool,
    pub sync_connectors: bool,
    pub auto_sync: bool,
    pub folder_mapping: FolderMapping,
}

impl Default for ObsidianVaultConfig {
    fn default() -> Self {
        Self {
            vault_path: String::new(),
            vault_name: String::new(),
            sync_memories: true,
            sync_personas: true,
            sync_connectors: false,
            auto_sync: false,
            folder_mapping: FolderMapping::default(),
        }
    }
}

// ── Sync State ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub vault_file_path: String,
    pub content_hash: String,
    pub sync_direction: String,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SyncLogEntry {
    pub id: String,
    pub sync_type: String,
    pub entity_type: String,
    pub entity_id: Option<String>,
    pub vault_file_path: Option<String>,
    pub action: String,
    pub details: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub file_path: String,
    pub app_content: String,
    pub vault_content: String,
    pub app_hash: String,
    pub vault_hash: String,
    pub base_hash: String,
    pub detected_at: String,
}

// ── Revitalize run history ───────────────────────────────────────────

/// One finished Revitalize pass (completed or failed). Persisted in
/// `obsidian_revitalize_runs` so the panel's "Recent passes" table survives
/// the in-memory job store's TTL and app restarts.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RevitalizeRunRecord {
    /// Job id (`revitalize-<uuid>`).
    pub id: String,
    pub vault_name: String,
    pub vault_path: String,
    /// `completed` | `failed` (cancellation lands as failed).
    pub status: String,
    pub error: Option<String>,
    pub files_deleted: i64,
    pub files_merged: i64,
    pub files_updated: i64,
    pub files_reviewed: i64,
    pub notes_before: i64,
    pub notes_after: i64,
    pub est_tokens_before: i64,
    pub est_tokens_after: i64,
    pub duration_secs: i64,
    pub started_at: String,
    pub created_at: String,
}

// ── Sync Results ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PushSyncResult {
    pub created: i64,
    pub updated: i64,
    pub skipped: i64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PullSyncResult {
    pub created: i64,
    pub updated: i64,
    pub conflicts: Vec<SyncConflict>,
    /// Count of entities where both app and vault sides edited independently
    /// but ended up identical (lucky convergence). Distinct from a no-op:
    /// surfaces in the UI as a confirmation toast so the user can see the
    /// audit trail of avoided conflicts.
    #[serde(default)]
    pub converged: i64,
    pub errors: Vec<String>,
}

// ── Vault Browser ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<VaultTreeNode>,
    pub note_count: i64,
}

// ── Vault Lint (knowledge integrity check) ───────────────────────────
//
// Inspired by Karpathy-style LLM knowledge bases (research run 2026-04-08):
// the wiki is treated like source code, with a "test suite" that detects
// stale notes, broken wikilinks, and orphan pages so the data stays
// trustworthy as it grows.

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StaleNote {
    pub path: String,
    pub last_modified: String,
    pub days_stale: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BrokenWikilink {
    pub source_path: String,
    pub target: String,
    pub line: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OrphanNote {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct VaultLintReport {
    pub vault_path: String,
    pub scanned_count: i64,
    pub stale_notes: Vec<StaleNote>,
    pub broken_wikilinks: Vec<BrokenWikilink>,
    pub orphans: Vec<OrphanNote>,
    pub generated_at: String,
}
