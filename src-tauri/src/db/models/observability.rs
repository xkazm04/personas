use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Observability: Alert Enums (shared contract between frontend & backend)
// ============================================================================

/// Supported alert metrics.  Must mirror `ALERT_METRIC_OPTIONS` on the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AlertMetric {
    ErrorRate,
    SuccessRate,
    Cost,
    CostSpike,
    Executions,
}

impl fmt::Display for AlertMetric {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ErrorRate => write!(f, "error_rate"),
            Self::SuccessRate => write!(f, "success_rate"),
            Self::Cost => write!(f, "cost"),
            Self::CostSpike => write!(f, "cost_spike"),
            Self::Executions => write!(f, "executions"),
        }
    }
}

impl FromStr for AlertMetric {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "error_rate" => Ok(Self::ErrorRate),
            "success_rate" => Ok(Self::SuccessRate),
            "cost" => Ok(Self::Cost),
            "cost_spike" => Ok(Self::CostSpike),
            "executions" => Ok(Self::Executions),
            other => Err(format!("unknown AlertMetric: {other:?}")),
        }
    }
}

/// Supported alert comparison operators.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AlertOperator {
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = ">=")]
    Gte,
    #[serde(rename = "<=")]
    Lte,
}

impl fmt::Display for AlertOperator {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Gt => write!(f, ">"),
            Self::Lt => write!(f, "<"),
            Self::Gte => write!(f, ">="),
            Self::Lte => write!(f, "<="),
        }
    }
}

impl FromStr for AlertOperator {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            ">" => Ok(Self::Gt),
            "<" => Ok(Self::Lt),
            ">=" => Ok(Self::Gte),
            "<=" => Ok(Self::Lte),
            other => Err(format!("unknown AlertOperator: {other:?}")),
        }
    }
}

/// Supported alert severity levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

impl fmt::Display for AlertSeverity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Info => write!(f, "info"),
            Self::Warning => write!(f, "warning"),
            Self::Critical => write!(f, "critical"),
        }
    }
}

impl FromStr for AlertSeverity {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "info" => Ok(Self::Info),
            "warning" => Ok(Self::Warning),
            "critical" => Ok(Self::Critical),
            other => Err(format!("unknown AlertSeverity: {other:?}")),
        }
    }
}

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
    #[ts(type = "number")]
    pub events_emitted: i64,
    #[ts(type = "number")]
    pub events_consumed: i64,
    #[ts(type = "number")]
    pub messages_sent: i64,
    pub created_at: String,
}

// ============================================================================
// Observability: Metrics Summary
// ============================================================================

/// Typed summary returned by `get_metrics_summary`.
/// Replaces the previous `serde_json::Value` return, enabling compile-time
/// checking and automatic ts-rs TypeScript binding generation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSummary {
    #[ts(type = "number")]
    pub total_executions: i64,
    #[ts(type = "number")]
    pub successful_executions: i64,
    #[ts(type = "number")]
    pub failed_executions: i64,
    pub total_cost_usd: f64,
    #[ts(type = "number")]
    pub active_personas: i64,
    #[ts(type = "number")]
    pub period_days: i64,
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
    pub anomalies: Vec<MetricAnomaly>,
}

// ============================================================================
// Observability: Business-value rollup
// ============================================================================

/// Business-value + efficiency rollup over a window of executions.
///
/// Aggregates the per-execution `business_outcome` self-assessment into a
/// value-delivered rate and a cost-per-value-delivered figure, plus a
/// per-model breakdown so model-tier efficiency is legible. Simulations are
/// excluded (their delivery is stubbed, so their outcome is not a real value
/// signal). Consumed by the activity dashboard's value tile and by the
/// Director's evaluation context.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ValueRollup {
    /// Window length in days.
    #[ts(type = "number")]
    pub period_days: i64,
    /// Non-simulation executions in the window (the population base).
    #[ts(type = "number")]
    pub total_executions: i64,
    /// Executions carrying a real (non-`unknown`) business_outcome — the
    /// denominator for `value_delivered_rate`.
    #[ts(type = "number")]
    pub assessed_executions: i64,
    #[ts(type = "number")]
    pub value_delivered: i64,
    #[ts(type = "number")]
    pub partial: i64,
    #[ts(type = "number")]
    pub precondition_failed: i64,
    #[ts(type = "number")]
    pub no_input_available: i64,
    /// Executions with no assessable outcome (old runs, crashes, non-completing).
    #[ts(type = "number")]
    pub unknown: i64,
    /// `value_delivered / assessed_executions` (0.0 when none assessed).
    pub value_delivered_rate: f64,
    /// Total non-simulation cost in the window.
    pub total_cost_usd: f64,
    /// `total_cost_usd / value_delivered`. `None` when nothing delivered value
    /// (dividing by zero is meaningless — the UI shows an em dash).
    pub cost_per_value_delivered: Option<f64>,
    /// Per-model efficiency breakdown, descending by cost.
    pub models: Vec<ModelValueShare>,
}

/// One model's slice of the value rollup — how much it ran, what it cost, and
/// how often it actually delivered value. Lets the Director (and the user) see
/// whether an expensive tier is earning its keep.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ModelValueShare {
    pub model: String,
    #[ts(type = "number")]
    pub executions: i64,
    pub cost_usd: f64,
    #[ts(type = "number")]
    pub value_delivered: i64,
}

// ============================================================================
// Observability: Execution Heatmap (GitHub-style contribution graph)
// ============================================================================

/// One day in the 365-day execution heatmap. `date` is YYYY-MM-DD (UTC).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HeatmapDay {
    pub date: String,
    #[ts(type = "number")]
    pub count: i64,
    pub cost: f64,
}

/// Derived insights summarising the heatmap window.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HeatmapInsights {
    /// Longest consecutive run of days with at least one execution.
    #[ts(type = "number")]
    pub longest_streak_days: i64,
    /// Days since the most recent execution. None if there have been no executions in the window.
    #[ts(type = "number | null")]
    pub dormant_days: Option<i64>,
    /// ISO date (YYYY-MM-DD) of the day with the highest execution count. None if window is empty.
    pub peak_day_date: Option<String>,
    #[ts(type = "number")]
    pub peak_day_count: i64,
    /// Executions in the most recent 7 days.
    #[ts(type = "number")]
    pub current_week_executions: i64,
    /// Executions in the previous 7 days (days 8..=14 ago).
    #[ts(type = "number")]
    pub previous_week_executions: i64,
    /// (current - previous) / previous as a percentage. None when previous_week is 0.
    pub week_over_week_pct: Option<f64>,
    #[ts(type = "number")]
    pub total_executions: i64,
    pub total_cost: f64,
    /// Quartile thresholds [q1, q2, q3, q4] for non-zero days. Used to colour cells.
    #[ts(type = "[number, number, number, number]")]
    pub intensity_thresholds: [i64; 4],
}

/// Result returned by `get_execution_heatmap`. Cached per (persona_id, days) for 1h.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionHeatmapData {
    /// Daily buckets, sorted by date ascending. May contain fewer than `days` entries
    /// (zero-count days are filled in by the frontend).
    pub days: Vec<HeatmapDay>,
    pub insights: HeatmapInsights,
    /// Window length in days that the response covers. Echoed for the frontend.
    #[ts(type = "number")]
    pub window_days: i64,
    /// ISO-8601 timestamp the response was generated. Used for cache freshness.
    pub generated_at: String,
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
    pub metric: AlertMetric,
    pub operator: AlertOperator,
    pub threshold: f64,
    pub severity: AlertSeverity,
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
    pub metric: AlertMetric,
    pub severity: AlertSeverity,
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
    pub metric: AlertMetric,
    pub operator: AlertOperator,
    pub threshold: f64,
    pub severity: AlertSeverity,
    pub persona_id: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateAlertRuleInput {
    pub name: Option<String>,
    pub metric: Option<AlertMetric>,
    pub operator: Option<AlertOperator>,
    pub threshold: Option<f64>,
    pub severity: Option<AlertSeverity>,
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
