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
    /// Total input + output tokens for this date.
    #[ts(type = "number")]
    pub total_tokens: i64,
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
    #[ts(type = "number")]
    pub successful_executions: i64,
    #[ts(type = "number")]
    pub failed_executions: i64,
    pub total_cost: f64,
    pub overall_success_rate: f64,
    pub avg_latency_ms: f64,
    #[ts(type = "number")]
    pub active_personas: i64,
    pub projected_monthly_cost: Option<f64>,
    pub burn_rate: Option<f64>,
}

// ============================================================================
// Observability: Alert Rules (backend-persisted)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AlertRule {
    pub id: String,
    pub name: String,
    pub metric: String,
    pub operator: String,
    pub threshold: f64,
    pub severity: String,
    pub persona_id: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FiredAlert {
    pub id: String,
    pub rule_id: String,
    pub rule_name: String,
    pub metric: String,
    pub severity: String,
    pub message: String,
    pub value: f64,
    pub threshold: f64,
    pub persona_id: Option<String>,
    pub fired_at: String,
    pub dismissed: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateAlertRuleInput {
    pub name: String,
    pub metric: String,
    pub operator: String,
    pub threshold: f64,
    pub severity: String,
    pub persona_id: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateAlertRuleInput {
    pub name: Option<String>,
    pub metric: Option<String>,
    pub operator: Option<String>,
    pub threshold: Option<f64>,
    pub severity: Option<String>,
    pub persona_id: Option<String>,
    pub enabled: Option<bool>,
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
    // Full persona snapshot fields (added for unified matrix versioning)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub design_context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_design_result: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_cells: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

// ============================================================================
// Observability: Anomaly Drill-Down
// ============================================================================

/// A correlated event found near an anomaly timestamp.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CorrelatedEvent {
    pub timestamp: String,
    pub event_type: String,
    pub label: String,
    pub detail: Option<String>,
    pub persona_id: Option<String>,
    /// Seconds between this event and the anomaly date (negative = before).
    pub offset_seconds: f64,
    /// 0.0–1.0 relevance score (closer in time + matching persona = higher).
    pub relevance: f64,
}

/// A suggested root cause derived from correlated events.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RootCauseSuggestion {
    pub rank: i32,
    pub title: String,
    pub description: String,
    pub confidence: f64,
    pub event_type: String,
    pub related_event_timestamp: Option<String>,
}

/// Combined drill-down response for a single anomaly.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AnomalyDrilldownData {
    pub anomaly_date: String,
    pub anomaly_metric: String,
    pub anomaly_value: f64,
    pub anomaly_baseline: f64,
    pub anomaly_deviation_pct: f64,
    pub correlated_events: Vec<CorrelatedEvent>,
    pub root_cause_suggestions: Vec<RootCauseSuggestion>,
}
