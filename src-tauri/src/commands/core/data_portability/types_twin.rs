//! Record shapes for digital twins and their knowledge bases.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

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
