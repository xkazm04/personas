use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── Vault Discovery ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
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
    /// Route Research Lab experiment notes through the Brain vault.
    #[serde(default)]
    pub research_lab: bool,
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
#[ts(export)]
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
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StaleNote {
    pub path: String,
    pub last_modified: String,
    pub days_stale: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BrokenWikilink {
    pub source_path: String,
    pub target: String,
    pub line: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OrphanNote {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultLintReport {
    pub vault_path: String,
    pub scanned_count: i64,
    pub stale_notes: Vec<StaleNote>,
    pub broken_wikilinks: Vec<BrokenWikilink>,
    pub orphans: Vec<OrphanNote>,
    pub generated_at: String,
}

// ── Semantic Vault Lint (LLM-assisted knowledge integrity check) ─────
//
// Extends the syntactic VaultLintReport with LLM-assisted checks:
// inconsistencies between notes, topics mentioned but not given their own
// page, and obvious-but-missing wikilinks. Inspired by Karpathy's LLM
// knowledge base setup (research run 2026-04-08, Karpathy wiki walkthrough).
//
// Unlike the syntactic lint (pure file-system walk, cheap, always safe),
// the semantic lint spawns a short Claude Code CLI call and bills tokens.
// Opt-in only; surfaced via a separate Tauri command.

/// Two or more notes that appear to contradict each other.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Inconsistency {
    /// Vault-relative paths of the notes involved in the contradiction.
    pub source_paths: Vec<String>,
    /// Human-readable description of the conflict.
    pub description: String,
}

/// A topic mentioned across several notes that doesn't have its own page yet.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MissingPageCandidate {
    /// The topic / concept that should have a dedicated page.
    pub topic: String,
    /// Vault-relative paths where the topic is mentioned without a wikilink.
    pub mentioned_in: Vec<String>,
    /// One-sentence justification for why a dedicated page would help.
    pub rationale: String,
}

/// Two notes that should be cross-linked but aren't.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProposedLink {
    /// Vault-relative path of the note that should gain the wikilink.
    pub from_path: String,
    /// Vault-relative path of the target note.
    pub to_path: String,
    /// Why the LLM believes these notes should be linked.
    pub rationale: String,
}

/// A forward-looking research suggestion: a topic where the vault is
/// incomplete and an external source or new investigation would close
/// the gap. Distinct from `MissingPageCandidate` (which surfaces topics
/// already mentioned but lacking a dedicated page) — a knowledge gap is
/// a hole in the *substance*, not the *organization*.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGap {
    /// Short title of the gap area.
    pub topic: String,
    /// Vault-relative paths of notes that touch the topic shallowly or
    /// where the gap is visible. Empty when the gap is a global
    /// observation not tied to specific notes.
    pub mentioned_in: Vec<String>,
    /// A concrete research question the user could investigate to close
    /// the gap. Phrased as a question, not a topic.
    pub suggested_question: String,
    /// One-line action suggestion (e.g. "web search for recent benchmarks",
    /// "find a primary source on technique X", "deeper read of paper Y").
    pub recommended_action: String,
}

/// LLM-assisted semantic lint report. Complementary to `VaultLintReport`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SemanticLintReport {
    pub vault_path: String,
    /// Number of notes fed to the LLM for analysis (may be less than the
    /// total vault size if truncated to stay within the prompt budget).
    pub scanned_count: i64,
    pub inconsistencies: Vec<Inconsistency>,
    pub missing_page_candidates: Vec<MissingPageCandidate>,
    pub proposed_links: Vec<ProposedLink>,
    /// Forward-looking research suggestions — gaps in vault substance the
    /// LLM thinks would benefit from external investigation.
    pub knowledge_gaps: Vec<KnowledgeGap>,
    /// Raw CLI log lines captured during the Claude call (for debugging).
    pub cli_log: Vec<String>,
    pub generated_at: String,
}
