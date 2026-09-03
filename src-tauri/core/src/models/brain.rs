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

// ── Brain dashboard (spark `agent-manifest-rebase`, WP1) ───────────────────

/// How many memories a persona holds in each tier.
///
/// One row per tier is the whole point: `core` is the always-included budget,
/// `active` is the recall workhorse, `working` is the raw capture lane and
/// `archive` never reaches a prompt. A single total would hide the only
/// distinction that matters. Serialized to kp's roster as `memory` on the App
/// master rollup (`engine::kp_reporter`) and to the Brain dashboard.
///
/// `archived` (not `archive`) on the wire: kp's field is an adjective about the
/// rows, and the tier name is an internal enum value. Counts are SQL
/// `COUNT(*)` aggregates (rusqlite reads i64); a persona's memory rows stay far
/// under 2^53, so the JS `number` pins are lossless (persisted-model-struct).
///
/// Lives in `personas-core` (moved from `personas_db::repos::core::memories`,
/// which re-exports it) so the ts-exported dashboard type below can embed it
/// without the core crate reaching up into the db crate.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTierCounts {
    #[ts(type = "number")]
    pub core: i64,
    #[ts(type = "number")]
    pub active: i64,
    #[ts(type = "number")]
    pub working: i64,
    #[ts(type = "number")]
    pub archived: i64,
}

impl MemoryTierCounts {
    /// True when the persona holds nothing at all — the caller's cue to send
    /// *nothing* rather than four zeros, since "no memory yet" and "four tiers
    /// measured at zero" are the same number and different findings.
    pub fn is_empty(&self) -> bool {
        self.core == 0 && self.active == 0 && self.working == 0 && self.archived == 0
    }
}

/// Memories per category for one persona (a `GROUP BY category` row).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCount {
    pub category: String,
    #[ts(type = "number")]
    pub count: i64,
}

/// Episodes recorded on one UTC day for one role (a `GROUP BY date, role`
/// row): how many, and how many ORIGINAL-body characters they carried.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeDayCount {
    /// `YYYY-MM-DD` (UTC).
    pub day: String,
    pub role: String,
    #[ts(type = "number")]
    pub count: i64,
    #[ts(type = "number")]
    pub chars: i64,
}

/// One completed consolidation pass, decoded from the attention ledger's
/// `stats_json` (`engine::persona_brain::sleep_cycle` writes the keys).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidationPoint {
    pub completed_at: String,
    #[ts(type = "number")]
    pub episodes_fed: i64,
    #[ts(type = "number")]
    pub created: i64,
    #[ts(type = "number")]
    pub updated: i64,
    #[ts(type = "number")]
    pub rejected: i64,
    #[ts(type = "number")]
    pub skipped_tombstoned: i64,
    /// Absent when the pass reported no cost (subscription lane) — not zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cost_usd: Option<f64>,
    /// 'acted' | 'noop' | 'failed' | ...
    pub verdict: String,
}

/// How much unconsolidated material is waiting against the admission
/// threshold, and when the last consolidation finished.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PressureGauge {
    /// ORIGINAL-body characters recorded after the last consumed watermark.
    #[ts(type = "number")]
    pub chars_waiting: i64,
    /// `personas_core::cycle::PRESSURE_CHARS` — the auto-admission bar.
    #[ts(type = "number")]
    pub threshold: i64,
    /// `None` while no consolidation has ever completed — honest absence,
    /// not an epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_cycle_at: Option<String>,
}

/// The things that should make an operator look: consecutive failed passes,
/// today's refusals, disputed memories, drafts the human threw out this week.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AnomalyStrip {
    /// Consecutive most-recent ledger rows with `verdict = 'failed'`.
    #[ts(type = "number")]
    pub failed_streak: i64,
    #[ts(type = "number")]
    pub refused_today: i64,
    /// Memories with at least one open negative claim.
    #[ts(type = "number")]
    pub open_disputes: i64,
    /// Review proposals discarded in the last 7 days (any kind).
    #[ts(type = "number")]
    pub rejected_drafts_7d: i64,
}

/// One cell of the coverage strip: how many episodes landed under `key` of
/// `kind` (`responsibility` → a charter id, or `unassigned`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CoverageCell {
    pub key: String,
    pub kind: String,
    #[ts(type = "number")]
    pub count: i64,
}

/// The `get_persona_brain_dashboard` payload — every series is an empty vec
/// when the persona has recorded nothing (the query ran), while the
/// `Option` fields stay `None` when the thing has never happened.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaBrainDashboard {
    pub tier_counts: MemoryTierCounts,
    pub category_counts: Vec<CategoryCount>,
    pub episode_series: Vec<EpisodeDayCount>,
    pub consolidation_series: Vec<ConsolidationPoint>,
    pub pressure: PressureGauge,
    pub anomaly: AnomalyStrip,
    pub coverage: Vec<CoverageCell>,
}

/// The `get_persona_manifest` payload: the on-disk manifest verbatim plus the
/// section map the editor needs to know which headings are law (operator)
/// and which are self-model (agent, diff-gated).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaManifestView {
    pub content: String,
    /// `# ` headings only the operator may write (`update_persona_manifest_law`).
    pub law_sections: Vec<String>,
    /// `# ` headings only anchored `self_model_diff` proposals may change.
    pub self_sections: Vec<String>,
    /// The frontmatter `updated:` stamp, when the file carries one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub updated_at: Option<String>,
    /// `self_model_diff` proposals still `pending_review` for this persona.
    #[ts(type = "number")]
    pub pending_proposals: i64,
}
