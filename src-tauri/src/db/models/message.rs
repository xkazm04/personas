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
    pub thread_id: Option<String>,
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
    pub thread_id: Option<String>,
}

/// Summary of a message thread: the parent message plus reply count and latest reply timestamp.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MessageThreadSummary {
    pub thread_id: String,
    pub parent: PersonaMessage,
    pub reply_count: i64,
    pub latest_reply_at: Option<String>,
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
