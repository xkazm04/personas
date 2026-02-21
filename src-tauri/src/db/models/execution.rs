use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Executions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaExecution {
    pub id: String,
    pub persona_id: String,
    pub trigger_id: Option<String>,
    pub status: String,
    pub input_data: Option<String>,
    pub output_data: Option<String>,
    pub claude_session_id: Option<String>,
    pub log_file_path: Option<String>,
    pub execution_flows: Option<String>,
    pub model_used: Option<String>,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub error_message: Option<String>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
    pub tool_steps: Option<String>,
    /// If this execution is a healing retry, links to the original execution.
    pub retry_of_execution_id: Option<String>,
    /// Number of retries attempted (0 = original execution).
    #[ts(type = "number")]
    pub retry_count: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateExecutionStatus {
    pub status: String,
    pub output_data: Option<String>,
    pub error_message: Option<String>,
    pub duration_ms: Option<i64>,
    pub log_file_path: Option<String>,
    pub execution_flows: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost_usd: Option<f64>,
    pub tool_steps: Option<String>,
}
