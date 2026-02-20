use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Observability: Metrics Snapshots
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMetricsSnapshot {
    pub id: String,
    pub persona_id: String,
    pub snapshot_date: String,
    #[ts(type = "number")]
    pub total_executions: i64,
    #[ts(type = "number")]
    pub successful_executions: i64,
    #[ts(type = "number")]
    pub failed_executions: i64,
    pub total_cost_usd: f64,
    #[ts(type = "number")]
    pub total_input_tokens: i64,
    #[ts(type = "number")]
    pub total_output_tokens: i64,
    pub avg_duration_ms: f64,
    pub tools_used: Option<String>,
    #[ts(type = "number")]
    pub events_emitted: i64,
    #[ts(type = "number")]
    pub events_consumed: i64,
    #[ts(type = "number")]
    pub messages_sent: i64,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateMetricsSnapshotInput {
    pub persona_id: String,
    pub snapshot_date: String,
    pub total_executions: i64,
    pub successful_executions: i64,
    pub failed_executions: i64,
    pub total_cost_usd: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub avg_duration_ms: f64,
    pub tools_used: Option<String>,
    pub events_emitted: i64,
    pub events_consumed: i64,
    pub messages_sent: i64,
}

// ============================================================================
// Observability: Prompt Versions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaPromptVersion {
    pub id: String,
    pub persona_id: String,
    pub version_number: i32,
    pub structured_prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub change_summary: Option<String>,
    pub created_at: String,
}
