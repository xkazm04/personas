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
// Observability: Prompt Performance Dashboard
// ============================================================================

/// Daily-bucketed performance data point for the Prompt Performance Dashboard.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PromptPerformancePoint {
    pub date: String,
    pub avg_cost_usd: f64,
    pub avg_duration_ms: f64,
    pub avg_input_tokens: f64,
    pub avg_output_tokens: f64,
    #[ts(type = "number")]
    pub total_executions: i64,
    #[ts(type = "number")]
    pub success_count: i64,
    #[ts(type = "number")]
    pub failed_count: i64,
    pub error_rate: f64,
    /// Percentile latencies computed from raw durations
    pub p50_duration_ms: f64,
    pub p95_duration_ms: f64,
    pub p99_duration_ms: f64,
}

/// Marker for a prompt version creation event shown on charts.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VersionMarker {
    pub version_id: String,
    pub version_number: i32,
    pub tag: String,
    pub created_at: String,
    pub change_summary: Option<String>,
}

/// A metric anomaly (spike/drop) detected via rolling-average deviation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MetricAnomaly {
    pub date: String,
    pub metric: String,
    pub value: f64,
    pub baseline: f64,
    pub deviation_pct: f64,
    pub execution_id: Option<String>,
}

/// Combined response for the prompt performance dashboard.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PromptPerformanceData {
    pub daily_points: Vec<PromptPerformancePoint>,
    pub version_markers: Vec<VersionMarker>,
    pub anomalies: Vec<MetricAnomaly>,
}

// ============================================================================
// Observability: Execution Metrics Dashboard (global, cross-persona)
// ============================================================================

/// Daily-bucketed data point for the global execution metrics dashboard.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DashboardDailyPoint {
    pub date: String,
    pub total_cost: f64,
    #[ts(type = "number")]
    pub total_executions: i64,
    #[ts(type = "number")]
    pub completed: i64,
    #[ts(type = "number")]
    pub failed: i64,
    pub success_rate: f64,
    pub p50_duration_ms: f64,
    pub p95_duration_ms: f64,
    pub p99_duration_ms: f64,
    /// Per-persona cost breakdown for this date.
    pub persona_costs: Vec<PersonaCostEntry>,
}

/// A single persona's cost contribution on a given date.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaCostEntry {
    pub persona_id: String,
    pub persona_name: String,
    pub cost: f64,
}

/// A cost anomaly detected via rolling-average deviation (>2 std deviations).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DashboardCostAnomaly {
    pub date: String,
    pub cost: f64,
    pub moving_avg: f64,
    pub std_dev: f64,
    pub deviation_sigma: f64,
    /// IDs of the costliest executions that drove the spike.
    pub execution_ids: Vec<String>,
}

/// Top-N persona ranked by total spend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DashboardTopPersona {
    pub persona_id: String,
    pub persona_name: String,
    pub total_cost: f64,
    #[ts(type = "number")]
    pub total_executions: i64,
    pub avg_cost_per_exec: f64,
}

/// Combined response for the execution metrics dashboard.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionDashboardData {
    pub daily_points: Vec<DashboardDailyPoint>,
    pub top_personas: Vec<DashboardTopPersona>,
    pub cost_anomalies: Vec<DashboardCostAnomaly>,
    #[ts(type = "number")]
    pub total_executions: i64,
    pub total_cost: f64,
    pub overall_success_rate: f64,
    pub avg_latency_ms: f64,
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
