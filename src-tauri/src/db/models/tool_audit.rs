use serde::Serialize;
use ts_rs::TS;

/// A single tool execution audit log entry.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecutionAuditEntry {
    pub id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub tool_type: String,
    pub persona_id: Option<String>,
    pub persona_name: Option<String>,
    pub credential_id: Option<String>,
    pub result_status: String,
    pub duration_ms: Option<i64>,
    pub error_message: Option<String>,
    pub created_at: String,
}
