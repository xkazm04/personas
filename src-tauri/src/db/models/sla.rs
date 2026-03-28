use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SlaDashboardData {
    /// Per-persona reliability stats, sorted by total executions descending.
    pub persona_stats: Vec<PersonaSlaStats>,
    /// Global aggregate across all personas.
    pub global: GlobalSlaStats,
    /// Fleet-wide healing summary.
    pub healing_summary: HealingSummary,
    /// Daily success-rate trend for the requested period.
    pub daily_trend: Vec<SlaDailyPoint>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PersonaSlaStats {
    pub persona_id: String,
    pub persona_name: String,
    pub total_executions: i64,
    pub successful: i64,
    pub failed: i64,
    pub cancelled: i64,
    /// Success rate as 0.0--1.0.
    pub success_rate: f64,
    pub avg_duration_ms: f64,
    pub p95_duration_ms: f64,
    pub total_cost_usd: f64,
    /// Mean time between failures in seconds (null if < 2 failures).
    #[ts(type = "number | null")]
    pub mtbf_seconds: Option<f64>,
    /// Count of consecutive recent failures (0 = healthy).
    pub consecutive_failures: i64,
    /// Number of healing issues auto-fixed for this persona.
    pub auto_healed_count: i64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GlobalSlaStats {
    pub total_executions: i64,
    pub successful: i64,
    pub failed: i64,
    pub cancelled: i64,
    /// Success rate as 0.0--1.0.  Denominator is successful + failed only;
    /// cancelled executions are excluded because they are user-initiated and
    /// do not reflect system reliability.
    pub success_rate: f64,
    pub avg_duration_ms: f64,
    pub total_cost_usd: f64,
    pub active_persona_count: i64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct HealingSummary {
    pub open_issues: i64,
    pub auto_fixed_count: i64,
    pub circuit_breaker_count: i64,
    pub knowledge_patterns: i64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SlaDailyPoint {
    pub date: String,
    pub total: i64,
    pub successful: i64,
    pub failed: i64,
    pub cancelled: i64,
    /// Success rate as 0.0--1.0.  Denominator is successful + failed only;
    /// cancelled executions are excluded (user-initiated, not a reliability signal).
    pub success_rate: f64,
}
