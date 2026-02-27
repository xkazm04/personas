use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::engine::types::ExecutionState;

// ============================================================================
// Executions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaExecution {
    pub id: String,
    pub persona_id: String,
    pub trigger_id: Option<String>,
    pub use_case_id: Option<String>,
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

impl PersonaExecution {
    /// Parse the status string into the canonical ExecutionState enum.
    pub fn state(&self) -> ExecutionState {
        self.status.parse().unwrap_or(ExecutionState::Failed)
    }
}

#[derive(Debug, Clone)]
pub struct UpdateExecutionStatus {
    pub status: ExecutionState,
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

impl Default for UpdateExecutionStatus {
    fn default() -> Self {
        Self {
            status: ExecutionState::Queued,
            output_data: None,
            error_message: None,
            duration_ms: None,
            log_file_path: None,
            execution_flows: None,
            input_tokens: None,
            output_tokens: None,
            cost_usd: None,
            tool_steps: None,
        }
    }
}
