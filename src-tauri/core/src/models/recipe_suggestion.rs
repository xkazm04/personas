//! Stage D Phase 4 — telemetry models for the Glyph composer recipe suggestion.
//!
//! `RecipeSuggestionEvent` records a single user-observable interaction with
//! the suggestion chip; `RecipeSuggestionStats` aggregates the last N events
//! into the rate metrics that gate Phase 5 mode-2 ("skip build").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Discrete user actions on the suggestion chip. Strings on the wire so the
/// table check-constraint can lock the value space without a separate enum
/// table — see the `recipe_suggestion_events.event_type` CHECK in
/// `db::migrations::incremental`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RecipeSuggestionEventType {
    /// Chip became visible to the user (above-threshold match was rendered).
    Impression,
    /// User clicked "Use this recipe".
    Accept,
    /// User clicked the dismiss (X) button.
    Dismiss,
}

impl RecipeSuggestionEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            RecipeSuggestionEventType::Impression => "impression",
            RecipeSuggestionEventType::Accept => "accept",
            RecipeSuggestionEventType::Dismiss => "dismiss",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeSuggestionEvent {
    pub id: i64,
    pub recipe_id: String,
    pub event_type: RecipeSuggestionEventType,
    pub score: f32,
    pub created_at: String,
}

/// Aggregated stats over the most recent `sample_size` events. `accept_rate`
/// is computed across decisive events only (accepts + dismisses); silent
/// impressions are excluded from the denominator because most users don't
/// explicitly act on a chip they ignore.
///
/// `mode_2_eligible` is the gate Phase 5 reads to decide whether the
/// "skip build" shortcut is available. The thresholds (minimum sample,
/// minimum accept rate) live in `commands::recipes::recipe_suggestion_log`
/// so they can be tuned without touching this binding.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecipeSuggestionStats {
    pub impressions: i64,
    pub accepts: i64,
    pub dismisses: i64,
    /// `accepts / (accepts + dismisses)` over the windowed sample. NaN-free:
    /// returns 0.0 when there are no decisive events.
    pub accept_rate: f32,
    /// Total decisive events (accepts + dismisses) in the windowed sample.
    /// Acts as the n in any "is the rate stable yet" judgement.
    pub decisive_count: i64,
    pub sample_size: i64,
    pub mode_2_eligible: bool,
}
