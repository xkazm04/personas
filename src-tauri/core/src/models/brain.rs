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
    /// i64 because SQLite INTEGER is 64-bit; a char count stays far under
    /// 2^53, so the JS `number` pin is lossless (persisted-model-struct).
    #[ts(type = "number")]
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

/// Fleet-wide aggregate of the attention loop's ledger for the Overview
/// status tile: the newest row overall plus today's (UTC) verdict counts.
/// Produced by `attention_ledger::summary_today`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AttentionLoopSummary {
    /// The newest ledger row across all personas — `None` only while the
    /// ledger has never recorded a pass ("no activity yet", not zero).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub latest: Option<AttentionLedgerEntry>,
    /// Attention lanes dispatched today (verdict 'dispatched').
    /// The four counts below are SQL `COUNT(*)` aggregates (rusqlite reads
    /// i64); one day's passes stay far under 2^53, so the JS `number` pins
    /// are lossless (persisted-model-struct).
    #[ts(type = "number")]
    pub dispatched_today: i64,
    /// Passes refused today (rate caps, quiet hours, budget).
    #[ts(type = "number")]
    pub refused_today: i64,
    /// Sleep-consolidation jobs enqueued today (kind 'consolidation',
    /// verdict 'enqueued').
    #[ts(type = "number")]
    pub consolidations_today: i64,
    /// Distinct personas with a non-refused pass today.
    #[ts(type = "number")]
    pub personas_served_today: i64,
}

/// The `get_attention_loop_status` command payload: the global
/// `autonomous_attention_loop` switch plus today's ledger aggregate.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AttentionLoopStatus {
    pub enabled: bool,
    pub summary: AttentionLoopSummary,
}
