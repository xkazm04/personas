use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single message in a design conversation thread.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DesignConversationMessage {
    /// Role of the message author: "user", "assistant", or "system"
    pub role: String,
    /// Message content (instruction, feedback, question, result JSON, etc.)
    pub content: String,
    /// Optional message sub-type for UI rendering hints:
    /// "instruction", "feedback", "question", "answer", "result", "error"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_type: Option<String>,
    /// ISO 8601 timestamp
    pub timestamp: String,
}

/// A persistent design conversation that accumulates multi-turn context.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DesignConversation {
    pub id: String,
    pub persona_id: String,
    /// Short label for the conversation (auto-generated from first instruction)
    pub title: String,
    /// Current conversation status: "active", "completed", "abandoned"
    pub status: String,
    /// JSON array of DesignConversationMessage
    pub messages: String,
    /// The latest design result JSON (cached for quick access)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_result: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
