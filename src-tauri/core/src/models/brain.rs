//! Living-agent brain types — the episodic record and the attention ledger.
//!
//! Typed mirrors of `persona_episodes` and `persona_attention_ledger`
//! (migration `e16_living_agent`). Episodes are append-only excerpts of what
//! the persona actually said/did; the attention ledger records every
//! attention/consolidation pass with its verdict and consumed watermark.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One row of `persona_episodes` — an append-only episodic record entry.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaEpisode {
    pub id: String,
    pub persona_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub execution_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub responsibility_id: Option<String>,
    /// Who spoke/acted: 'user' | 'assistant' | 'system' | 'tool' | ...
    pub role: String,
    /// Where the episode came from ('execution', 'channel', 'chat', ...).
    pub source: String,
    /// The stored excerpt (bounded; `chars` counts the ORIGINAL body).
    pub body_excerpt: String,
    /// Full body on disk, when the excerpt was truncated from a file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file_path: Option<String>,
    /// Content hash of the original body — the dedupe/provenance key.
    pub content_hash: String,
    /// Character count of the ORIGINAL body (consolidation budget input).
    pub chars: i64,
    pub created_at: String,
}

/// Compact episode projection for prompt assembly and list surfaces.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeExcerpt {
    pub id: String,
    pub role: String,
    pub source: String,
    pub body_excerpt: String,
    pub created_at: String,
}

/// One row of `persona_attention_ledger` — an attention/consolidation pass.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AttentionLedgerEntry {
    pub id: String,
    pub persona_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub responsibility_id: Option<String>,
    /// 'attention' | 'consolidation' (DB CHECK-enforced).
    pub kind: String,
    /// Optional sub-lane within the kind (e.g. an attention trigger class).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lane: Option<String>,
    /// 'started' while running; then 'acted' | 'noop' | 'refused' | 'failed'.
    pub verdict: String,
    pub reason: String,
    /// Watermark: episodes with `created_at` <= this were consumed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub consumed_through: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stats_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cost_usd: Option<f64>,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub completed_at: Option<String>,
}
