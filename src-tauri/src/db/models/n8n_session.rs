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
