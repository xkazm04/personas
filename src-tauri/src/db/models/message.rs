use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Messages
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMessage {
    pub id: String,
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub content_type: String,
    pub priority: String,
    pub is_read: bool,
    pub metadata: Option<String>,
    pub created_at: String,
    pub read_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateMessageInput {
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub content_type: Option<String>,
    pub priority: Option<String>,
    pub metadata: Option<String>,
}

// ============================================================================
// Message Deliveries
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMessageDelivery {
    pub id: String,
    pub message_id: String,
    pub channel_type: String,
    pub status: String,
    pub error_message: Option<String>,
    pub external_id: Option<String>,
    pub delivered_at: Option<String>,
    pub created_at: String,
}
