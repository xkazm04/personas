use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub persona_id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub execution_id: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatMessageInput {
    pub persona_id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub execution_id: Option<String>,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub session_id: String,
    pub persona_id: String,
    pub message_count: i64,
    pub last_message_at: String,
    pub created_at: String,
}
