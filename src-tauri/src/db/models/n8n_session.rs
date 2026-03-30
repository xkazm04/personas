use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Session Status Enum
// ============================================================================

/// Valid session statuses for an n8n transform session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Draft,
    Analyzing,
    Transforming,
    AwaitingAnswers,
    Editing,
    Confirmed,
    Failed,
    Interrupted,
}

impl SessionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Analyzing => "analyzing",
            Self::Transforming => "transforming",
            Self::AwaitingAnswers => "awaiting_answers",
            Self::Editing => "editing",
            Self::Confirmed => "confirmed",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
        }
    }
}

impl std::fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromSql for SessionStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "draft" => Ok(Self::Draft),
            "analyzing" => Ok(Self::Analyzing),
            "transforming" => Ok(Self::Transforming),
            "awaiting_answers" => Ok(Self::AwaitingAnswers),
            "editing" => Ok(Self::Editing),
            "confirmed" => Ok(Self::Confirmed),
            "failed" => Ok(Self::Failed),
            "interrupted" => Ok(Self::Interrupted),
            other => Err(FromSqlError::Other(
                format!("invalid SessionStatus: {other}").into(),
            )),
        }
    }
}

impl ToSql for SessionStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Borrowed(ValueRef::Text(self.as_str().as_bytes())))
    }
}

// ============================================================================
// N8n Transform Sessions (persisted import wizard state)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct N8nTransformSession {
    pub id: String,
    pub workflow_name: String,
    pub status: SessionStatus,
    pub raw_workflow_json: String,
    pub parser_result: Option<String>,
    pub draft_json: Option<String>,
    pub user_answers: Option<String>,
    pub step: String,
    pub error: Option<String>,
    pub persona_id: Option<String>,
    pub transform_id: Option<String>,
    pub questions_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// IPC response struct with JSON fields pre-deserialized.
///
/// Eliminates double-serialization: the DB stores JSON as text, this struct
/// deserializes it once in the command layer so the frontend receives typed
/// objects instead of raw strings that need `JSON.parse`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct N8nSessionResponse {
    pub id: String,
    pub workflow_name: String,
    pub status: SessionStatus,
    pub raw_workflow_json: String,
    pub parser_result: Option<serde_json::Value>,
    pub draft_json: Option<serde_json::Value>,
    pub user_answers: Option<serde_json::Value>,
    pub step: String,
    pub error: Option<String>,
    pub persona_id: Option<String>,
    pub transform_id: Option<String>,
    pub questions_json: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<N8nTransformSession> for N8nSessionResponse {
    fn from(s: N8nTransformSession) -> Self {
        fn parse_json_field(raw: Option<String>, field: &str, session_id: &str) -> Option<serde_json::Value> {
            raw.and_then(|text| {
                serde_json::from_str(&text).unwrap_or_else(|err| {
                    tracing::warn!(
                        session_id,
                        field,
                        %err,
                        "N8nSessionResponse: malformed JSON in column — returning null; data may be corrupt"
                    );
                    None
                })
            })
        }
        let id = &s.id;
        Self {
            parser_result: parse_json_field(s.parser_result, "parser_result", id),
            draft_json: parse_json_field(s.draft_json, "draft_json", id),
            user_answers: parse_json_field(s.user_answers, "user_answers", id),
            questions_json: parse_json_field(s.questions_json, "questions_json", id),
            id: s.id,
            workflow_name: s.workflow_name,
            status: s.status,
            raw_workflow_json: s.raw_workflow_json,
            step: s.step,
            error: s.error,
            persona_id: s.persona_id,
            transform_id: s.transform_id,
            created_at: s.created_at,
            updated_at: s.updated_at,
        }
    }
}

/// Lightweight summary for the session list — excludes heavy JSON columns.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct N8nSessionSummary {
    pub id: String,
    pub workflow_name: String,
    pub status: SessionStatus,
    pub step: String,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateN8nSessionInput {
    pub workflow_name: String,
    pub raw_workflow_json: String,
    pub step: String,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateN8nSessionInput {
    pub workflow_name: Option<String>,
    pub status: Option<SessionStatus>,
    pub parser_result: Option<Option<String>>,
    pub draft_json: Option<Option<String>>,
    pub user_answers: Option<Option<String>>,
    pub step: Option<String>,
    pub error: Option<Option<String>>,
    pub persona_id: Option<Option<String>>,
    pub transform_id: Option<Option<String>>,
    pub questions_json: Option<Option<String>>,
}
