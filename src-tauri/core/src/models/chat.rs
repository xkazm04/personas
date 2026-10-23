use std::fmt;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Valid roles for chat messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
    System,
    Tool,
}

impl fmt::Display for ChatRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChatRole::User => write!(f, "user"),
            ChatRole::Assistant => write!(f, "assistant"),
            ChatRole::System => write!(f, "system"),
            ChatRole::Tool => write!(f, "tool"),
        }
    }
}

impl ChatRole {
    pub fn from_str_checked(s: &str) -> Result<Self, String> {
        match s {
            "user" => Ok(ChatRole::User),
            "assistant" => Ok(ChatRole::Assistant),
            "system" => Ok(ChatRole::System),
            "tool" => Ok(ChatRole::Tool),
            other => Err(format!("invalid chat role: '{other}'")),
        }
    }
}

impl ToSql for ChatRole {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.to_string()))
    }
}

impl FromSql for ChatRole {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        ChatRole::from_str_checked(s).map_err(|e| {
            FromSqlError::Other(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                e,
            )))
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub persona_id: String,
    pub session_id: String,
    pub role: ChatRole,
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
    pub role: ChatRole,
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

#[cfg(test)]
mod chat_role_tests {
    use super::ChatRole;

    /// `ToSql` writes `Display`, the frontend reads serde, and `FromSql` parses
    /// with `from_str_checked`: three spellings of one vocabulary.
    #[test]
    fn chat_role_tokens_agree_with_serde_and_round_trip() {
        for v in [
            ChatRole::User,
            ChatRole::Assistant,
            ChatRole::System,
            ChatRole::Tool,
        ] {
            match v {
                ChatRole::User | ChatRole::Assistant | ChatRole::System | ChatRole::Tool => {}
            }
            let wire = serde_json::to_value(v).unwrap();
            assert_eq!(wire.as_str(), Some(v.to_string().as_str()), "{v:?}");
            assert_eq!(ChatRole::from_str_checked(&v.to_string()), Ok(v));
        }
        assert!(ChatRole::from_str_checked("User").is_err());
    }
}
