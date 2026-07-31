//! Self-Wiring Fabric v1 — models for mined automation suggestions.
//!
//! The pattern miner (`engine::pattern_miner`) scans `persona_events` ×
//! `persona_executions` for "event E was followed by a MANUAL run of persona P
//! within window W, ≥N times" and persists candidates to the
//! `automation_suggestions` table (see `db::migrations::incremental`,
//! migration id `automation_suggestions`). The Studio patchbay renders
//! `proposed` rows as ghost cables; accept commits a real `event_listener`
//! trigger through the existing Studio commit path (dry-run first) and stamps
//! `committed_trigger_id` — the mined-route tag that excludes the committed
//! trigger's own traffic from ever feeding future evidence.
//!
//! Learning grammar (batch-3): every suggestion carries its raw evidence
//! (`evidence`), is proposed-not-imposed (nothing auto-commits in v1),
//! provenance-stamped on accept (`committed_trigger_id` + `decided_at`), and
//! reversible (delete/disable the created trigger; rejected rows are kept as
//! a do-not-renag memory).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One historical co-occurrence backing a suggestion: event E happened, then
/// the user manually ran persona P `gap_seconds` later. Rendered verbatim in
/// the Studio evidence drawer — the drawer IS the trust mechanism, so this
/// carries real row ids the user could audit, not aggregates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSuggestionEvidence {
    /// `persona_events.id` of the observed event.
    pub event_id: String,
    /// When the event was recorded (RFC-3339).
    pub event_at: String,
    /// `persona_executions.id` of the manual run that followed.
    pub execution_id: String,
    /// When the manual run was created (RFC-3339).
    pub executed_at: String,
    /// Seconds between the event and the manual run (0 ≤ gap ≤ window).
    pub gap_seconds: u32,
}

/// Lifecycle status of a suggestion. Strings on the wire so the table
/// CHECK constraint can lock the value space (mirrors `RecipeSuggestionEventType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AutomationSuggestionStatus {
    /// Mined and waiting for the user's decision — renders as a ghost cable.
    Proposed,
    /// User accepted; `committed_trigger_id` points at the created trigger.
    Accepted,
    /// User dismissed. Kept as a memory so the miner never re-proposes the
    /// same (event, persona) pair — rejection is training signal, not noise.
    Rejected,
}

impl AutomationSuggestionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
        }
    }

    /// Parse a DB value. Unknown values fall back to `Rejected` (the most
    /// inert state) so a corrupt row can never resurface as a live proposal.
    pub fn from_db(s: &str) -> Self {
        match s {
            "proposed" => Self::Proposed,
            "accepted" => Self::Accepted,
            _ => Self::Rejected,
        }
    }
}

/// A mined automation-suggestion row (`automation_suggestions` table).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSuggestion {
    pub id: String,
    /// The observed upstream event type (E in "E → run P").
    pub event_type: String,
    /// The persona the user keeps running manually after E.
    pub persona_id: String,
    pub status: AutomationSuggestionStatus,
    /// How many distinct manual runs co-occurred with E inside the window.
    pub occurrence_count: u32,
    /// Total manual runs of this persona in the lookback — the denominator
    /// behind `support`, kept so the UI can show "9 of 12 manual runs".
    pub manual_run_count: u32,
    /// `occurrence_count / manual_run_count` (0 when no manual runs).
    pub support: f32,
    /// Co-occurrence window the miner used (seconds).
    pub window_seconds: u32,
    /// Mining lookback horizon (days).
    pub lookback_days: u32,
    /// The N historical co-occurrences (newest last, capped — see miner).
    pub evidence: Vec<AutomationSuggestionEvidence>,
    /// Set on accept: the `persona_triggers.id` this suggestion became. THE
    /// mined-route tag — the miner excludes this trigger's events and
    /// executions from all future evidence (no self-feeding loops).
    pub committed_trigger_id: Option<String>,
    /// Oldest co-occurrence backing the current evidence set (RFC-3339).
    pub first_seen_at: Option<String>,
    /// Newest co-occurrence backing the current evidence set (RFC-3339).
    pub last_seen_at: Option<String>,
    /// When the user accepted/rejected (RFC-3339); NULL while proposed.
    pub decided_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
