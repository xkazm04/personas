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
                tracing::warn!("Unknown PersonaEventStatus '{}', defaulting to Pending", other);
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
