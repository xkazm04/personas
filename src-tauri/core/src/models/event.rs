use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Event Status Enum
// ============================================================================

/// All valid statuses for a `PersonaEvent`.
///
/// Lifecycle: Pending → Processing → Delivered/Completed/Skipped/Failed
///            Failed → DeadLetter (after max retries) or back to Pending (retry)
///            DeadLetter → Pending (manual retry) or Discarded (manual discard)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PersonaEventStatus {
    /// Newly created, awaiting processing.
    Pending,
    /// Claimed by the event bus tick, currently being dispatched.
    Processing,
    /// Successfully dispatched to subscriber executions.
    Delivered,
    /// General-purpose success terminal state (used by mocks/tests).
    Completed,
    /// No matching subscribers — event was intentionally skipped.
    Skipped,
    /// One or more subscriber executions failed.
    Failed,
    /// Moved to the dead-letter queue after exhausting retries.
    DeadLetter,
    /// Manually discarded from the dead-letter queue.
    Discarded,
}

impl PersonaEventStatus {
    /// Parse a status string from the database. Unknown values fall back to `Pending`.
    pub fn from_db(s: &str) -> Self {
        match s {
            "pending" => Self::Pending,
            "processing" => Self::Processing,
            "delivered" => Self::Delivered,
            "completed" => Self::Completed,
            "skipped" => Self::Skipped,
            "failed" => Self::Failed,
            "dead_letter" => Self::DeadLetter,
            "discarded" => Self::Discarded,
            other => {
                tracing::warn!(
                    "Unknown PersonaEventStatus '{}', defaulting to Pending",
                    other
                );
                Self::Pending
            }
        }
    }

    /// Return the string representation stored in the database.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Processing => "processing",
            Self::Delivered => "delivered",
            Self::Completed => "completed",
            Self::Skipped => "skipped",
            Self::Failed => "failed",
            Self::DeadLetter => "dead_letter",
            Self::Discarded => "discarded",
        }
    }

    /// The statuses a retention sweep must never delete, whatever their age:
    /// rows still in flight, and the dead-letter queue (a DLQ row is a failure
    /// waiting for a human, and its age is not a verdict on it).
    ///
    /// Retention is expressed as what it PROTECTS, never as what it may delete.
    /// The sweep it replaced named `('completed','skipped','failed','discarded')`
    /// and so silently granted immortality to `Delivered` — the success state
    /// production actually writes — leaving 4,941 of 4,948 rows on the
    /// operator's database 20-73 days past a 30-day policy. With a protect-list
    /// a status added later, or a string no variant parses (the live table
    /// holds `processed`), is swept by default rather than kept forever.
    pub const RETENTION_PROTECTED: &'static [PersonaEventStatus] =
        &[Self::Pending, Self::Processing, Self::DeadLetter];

    /// Whether retention must keep a row in this status. An exhaustive match,
    /// so a new variant does not compile until someone classifies it.
    pub fn is_retention_protected(&self) -> bool {
        match self {
            Self::Pending | Self::Processing | Self::DeadLetter => true,
            Self::Delivered | Self::Completed | Self::Skipped | Self::Failed | Self::Discarded => {
                false
            }
        }
    }

    /// [`Self::RETENTION_PROTECTED`] as a SQL list literal
    /// (`'pending','processing','dead_letter'`), derived from the variants so
    /// no retention predicate types a status set by hand.
    pub fn retention_protected_sql_list() -> String {
        Self::RETENTION_PROTECTED
            .iter()
            .map(|s| format!("'{}'", s.as_str()))
            .collect::<Vec<_>>()
            .join(",")
    }

    /// Whether this status can legally transition to `target`.
    pub fn can_transition_to(&self, target: &Self) -> bool {
        matches!(
            (self, target),
            // Normal processing flow
            (Self::Pending, Self::Processing)
            // Terminal outcomes from processing
            | (Self::Processing, Self::Delivered)
            | (Self::Processing, Self::Completed)
            | (Self::Processing, Self::Skipped)
            | (Self::Processing, Self::Failed)
            // Direct terminal shortcuts (mock/seed events, instant processing)
            | (Self::Pending, Self::Delivered)
            | (Self::Pending, Self::Completed)
            | (Self::Pending, Self::Failed)
            | (Self::Pending, Self::Skipped)
            // Retry / DLQ flow
            | (Self::Failed, Self::DeadLetter)
            | (Self::Failed, Self::Pending)      // auto-retry re-queue
            | (Self::DeadLetter, Self::Pending)   // manual retry
            | (Self::DeadLetter, Self::Discarded) // manual discard
        )
    }
}

impl std::fmt::Display for PersonaEventStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ============================================================================
// Events
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaEvent {
    pub id: String,
    pub project_id: String,
    pub event_type: String,
    pub source_type: String,
    pub source_id: Option<String>,
    pub target_persona_id: Option<String>,
    pub payload: Option<String>,
    pub status: PersonaEventStatus,
    pub error_message: Option<String>,
    pub processed_at: Option<String>,
    pub created_at: String,
    pub use_case_id: Option<String>,
    pub retry_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PaginatedEvents {
    pub events: Vec<PersonaEvent>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaEventInput {
    pub event_type: String,
    pub source_type: String,
    pub project_id: Option<String>,
    pub source_id: Option<String>,
    pub target_persona_id: Option<String>,
    pub payload: Option<String>,
    pub use_case_id: Option<String>,
}

// ============================================================================
// Event Filtering / Search
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EventFilterInput {
    pub event_type: Option<String>,
    pub source_type: Option<String>,
    pub status: Option<String>,
    pub target_persona_id: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
}

// ============================================================================
// Event Subscriptions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaEventSubscription {
    pub id: String,
    pub persona_id: String,
    pub event_type: String,
    pub source_filter: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub use_case_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateEventSubscriptionInput {
    pub persona_id: String,
    pub event_type: String,
    pub source_filter: Option<String>,
    pub enabled: Option<bool>,
    pub use_case_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateEventSubscriptionInput {
    pub event_type: Option<String>,
    pub source_filter: Option<String>,
    pub enabled: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::PersonaEventStatus as S;

    /// Every variant. The match makes adding a variant a compile error here
    /// until it is listed, which is what keeps the set test below complete.
    fn all() -> Vec<S> {
        let all = vec![
            S::Pending,
            S::Processing,
            S::Delivered,
            S::Completed,
            S::Skipped,
            S::Failed,
            S::DeadLetter,
            S::Discarded,
        ];
        for s in &all {
            match s {
                S::Pending
                | S::Processing
                | S::Delivered
                | S::Completed
                | S::Skipped
                | S::Failed
                | S::DeadLetter
                | S::Discarded => {}
            }
        }
        all
    }

    #[test]
    fn retention_protected_const_matches_the_classifier() {
        let from_classifier: Vec<S> = all()
            .into_iter()
            .filter(|s| s.is_retention_protected())
            .collect();
        assert_eq!(from_classifier, S::RETENTION_PROTECTED.to_vec());
    }

    /// The production success state is sweepable; in-flight rows and the DLQ
    /// are not. This is the exact omission that kept 99.4% of a table forever.
    #[test]
    fn delivered_is_retention_eligible_and_in_flight_and_dlq_are_protected() {
        assert!(!S::Delivered.is_retention_protected());
        assert!(S::Pending.is_retention_protected());
        assert!(S::Processing.is_retention_protected());
        assert!(S::DeadLetter.is_retention_protected());
        assert_eq!(
            S::retention_protected_sql_list(),
            "'pending','processing','dead_letter'"
        );
    }
}
