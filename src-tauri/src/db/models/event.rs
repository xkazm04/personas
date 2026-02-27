use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
    pub status: String,
    pub error_message: Option<String>,
    pub processed_at: Option<String>,
    pub created_at: String,
    pub use_case_id: Option<String>,
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
