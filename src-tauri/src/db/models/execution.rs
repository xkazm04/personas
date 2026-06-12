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
    // ts-rs doesn't resolve the `serde_json/JsonValue` subdir import when the
    // type is wrapped in `Json<T>` (transparent TS impl visits the dep but
    // import-path resolution misses it). Pin the TS type to `unknown | null`
    // for now — the field is a JSON blob in practice, so the type relaxation
    // is honest. Revisit if ts-rs ever fixes nested-path imports for wrapper
    // generics.
    #[ts(type = "unknown")]
    pub execution_flows: Option<Json<serde_json::Value>>,
    pub model_used: Option<String>,
    /// Resolved Claude CLI `--effort` level the run was spawned with
    /// (low/medium/high) — the "thinking" dial for cost observability.
    pub thinking_level: Option<String>,
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
    /// LLM's self-assessment of business value delivery for this run.
    /// One of `value_delivered`, `no_input_available`, `precondition_failed`,
    /// `partial`, `unknown`. See `EXECUTION_MODE_DIRECTIVE` for semantics.
    #[serde(default = "default_business_outcome")]
    pub business_outcome: String,
    /// The Director's overall 0-5 score for this run, set when the Director
    /// reviews it. `None` ⇒ not reviewed (the Verdict column shows "—").
    #[serde(default)]
    #[ts(type = "number | null")]
    pub director_score: Option<i64>,
    /// Rendered markdown of the Director's full assessment for this run (score +
    /// summary + coaching verdicts). Backs the "Director" tab in the execution
    /// detail modal. `None` until the Director reviews this execution.
    #[serde(default)]
    pub director_review_md: Option<String>,
}

fn default_business_outcome() -> String {
    "unknown".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionListItem {
    pub id: String,
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub status: String,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub error_message: Option<String>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
    pub retry_of_execution_id: Option<String>,
    #[ts(type = "number")]
    pub retry_count: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub is_simulation: bool,
    #[serde(default = "default_business_outcome")]
    pub business_outcome: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionSearchResult {
    pub id: String,
    pub persona_id: String,
    pub persona_name: Option<String>,
    pub persona_icon: Option<String>,
    pub persona_color: Option<String>,
    pub use_case_id: Option<String>,
    pub status: String,
    pub excerpt: String,
    pub created_at: String,
    pub completed_at: Option<String>,
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
    // ts-rs doesn't resolve the `serde_json/JsonValue` subdir import when the
    // type is wrapped in `Json<T>` (transparent TS impl visits the dep but
    // import-path resolution misses it). Pin the TS type to `unknown | null`
    // for now — the field is a JSON blob in practice, so the type relaxation
    // is honest. Revisit if ts-rs ever fixes nested-path imports for wrapper
    // generics.
    #[ts(type = "unknown")]
    pub execution_flows: Option<Json<serde_json::Value>>,
    pub model_used: Option<String>,
    /// Resolved Claude CLI `--effort` level the run was spawned with
    /// (low/medium/high) — the "thinking" dial for cost observability.
    pub thinking_level: Option<String>,
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
    #[serde(default = "default_business_outcome")]
    pub business_outcome: String,
    // Persona metadata from JOIN
    pub persona_name: Option<String>,
    pub persona_icon: Option<String>,
    pub persona_color: Option<String>,
}

/// Aggregate counts across all executions grouped by the high-level status
/// categories surfaced in the Activity filter bar. Used to render precise
/// filter badges independently from the paginated row list.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionCounts {
    #[ts(type = "number")]
    pub total: i64,
    /// Includes both `running` and `pending` — the UI bucket is "Running".
    #[ts(type = "number")]
    pub running: i64,
    #[ts(type = "number")]
    pub completed: i64,
    #[ts(type = "number")]
    pub failed: i64,
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
    /// LLM's self-assessment of whether the run delivered business value.
    /// One of: `value_delivered`, `no_input_available`, `precondition_failed`,
    /// `partial`. `None` here means "leave the column untouched" (COALESCE
    /// keeps any previous write); the column itself defaults to `'unknown'`
    /// on row creation.
    pub business_outcome: Option<String>,
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
            business_outcome: None,
        }
    }
}
