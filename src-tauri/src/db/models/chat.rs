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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionContext {
    pub session_id: String,
    pub persona_id: String,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub system_prompt_hash: Option<String>,
    pub working_memory: Option<String>,
    pub chat_mode: String,
    /// Claude CLI session ID for --resume continuity across chat messages.
    pub claude_session_id: Option<String>,
    pub updated_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSessionContextInput {
    pub session_id: String,
    pub persona_id: String,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub system_prompt_hash: Option<String>,
    pub working_memory: Option<String>,
    pub chat_mode: Option<String>,
    /// Claude CLI session ID captured from execution SystemInit event.
    pub claude_session_id: Option<String>,
}
