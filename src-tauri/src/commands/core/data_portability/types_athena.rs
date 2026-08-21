//! Record shapes for Athena's memory (nodes, learned kinds, sessions,
//! decisions, provenance).
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

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
    pub(crate) fn is_empty(&self) -> bool {
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
