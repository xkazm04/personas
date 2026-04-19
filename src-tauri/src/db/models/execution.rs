use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Json;
use crate::engine::types::{ExecutionState, ToolCallStep};

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
    pub execution_flows: Option<Json<serde_json::Value>>,
    pub model_used: Option<String>,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub error_message: Option<String>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
    pub tool_steps: Option<Json<Vec<ToolCallStep>>>,
    /// If this execution is a healing retry, links to the original execution.
    pub retry_of_execution_id: Option<String>,
    /// Number of retries attempted (0 = original execution).
    #[ts(type = "number")]
    pub retry_count: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    /// Frozen ExecutionConfig JSON snapshot assembled at execution start.
    pub execution_config: Option<String>,
    /// `true` when the execution log file may be incomplete due to I/O errors.
    #[serde(default)]
    pub log_truncated: bool,
    /// Phase C3 — `true` when this execution was started via
    /// `simulate_use_case`. Simulations skip real notification dispatch and
    /// are filtered out of the default activity feed.
    #[serde(default)]
    pub is_simulation: bool,
}

/// Execution row with persona metadata included via SQL JOIN.
/// Eliminates N+1 queries when listing executions across all personas.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GlobalExecutionRow {
    pub id: String,
    pub persona_id: String,
    pub trigger_id: Option<String>,
    pub use_case_id: Option<String>,
    pub status: String,
    pub input_data: Option<String>,
    pub output_data: Option<String>,
    pub claude_session_id: Option<String>,
    pub log_file_path: Option<String>,
    pub execution_flows: Option<Json<serde_json::Value>>,
    pub model_used: Option<String>,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub error_message: Option<String>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
    pub tool_steps: Option<Json<Vec<ToolCallStep>>>,
    pub retry_of_execution_id: Option<String>,
    #[ts(type = "number")]
    pub retry_count: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub execution_config: Option<String>,
    /// `true` when the execution log file may be incomplete due to I/O errors.
    #[serde(default)]
    pub log_truncated: bool,
    /// Phase C3 — simulation runs are excluded from the default activity feed.
    #[serde(default)]
    pub is_simulation: bool,
    // Persona metadata from JOIN
    pub persona_name: Option<String>,
    pub persona_icon: Option<String>,
    pub persona_color: Option<String>,
}

impl PersonaExecution {
    /// Parse the status string into the canonical ExecutionState enum.
    /// Logs an error if the stored status is unrecognised so data corruption
    /// is immediately visible instead of silently mapping to `Failed`.
    pub fn state(&self) -> ExecutionState {
        match self.status.parse() {
            Ok(s) => s,
            Err(_) => {
                tracing::error!(
                    execution_id = %self.id,
                    raw_status = %self.status,
                    "Unknown execution status in DB — treating as Failed"
                );
                ExecutionState::Failed
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct UpdateExecutionStatus {
    pub status: ExecutionState,
    pub output_data: Option<String>,
    pub error_message: Option<String>,
    pub duration_ms: Option<i64>,
    pub log_file_path: Option<String>,
    pub execution_flows: Option<Json<serde_json::Value>>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost_usd: Option<f64>,
    pub tool_steps: Option<Json<Vec<ToolCallStep>>>,
    pub claude_session_id: Option<String>,
    pub execution_config: Option<String>,
    /// When `true`, the execution log file may be incomplete due to I/O errors.
    pub log_truncated: bool,
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
            claude_session_id: None,
            execution_config: None,
            log_truncated: false,
        }
    }
}
