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

// ============================================================================
// Observability: Pre-bucketed chart data (aggregated in SQL)
// ============================================================================

/// A single date-bucketed data point for time-series charts.
/// Produced by SQL GROUP BY DATE(created_at) so the frontend receives
/// chart-ready arrays instead of raw per-persona rows.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MetricsChartPoint {
    pub date: String,
    pub cost: f64,
    #[ts(type = "number")]
    pub executions: i64,
    #[ts(type = "number")]
    pub success: i64,
    #[ts(type = "number")]
    pub failed: i64,
    #[ts(type = "number")]
    pub tokens: i64,
    /// Number of distinct personas with executions on this date.
    #[ts(type = "number")]
    pub active_personas: i64,
}

/// Per-persona aggregated breakdown for pie charts.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MetricsPersonaBreakdown {
    pub persona_id: String,
    #[ts(type = "number")]
    pub executions: i64,
    pub cost: f64,
}

/// Combined chart data returned by a single IPC call.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MetricsChartData {
    pub chart_points: Vec<MetricsChartPoint>,
    pub persona_breakdown: Vec<MetricsPersonaBreakdown>,
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
    /// Version tag: "production", "experimental", or "archived"
    pub tag: String,
    pub created_at: String,
}
