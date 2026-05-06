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
    /// Success rate as 0.0--1.0.  Denominator is `successful + failed`
    /// only; cancelled executions are excluded because they are
    /// user-initiated and do not reflect system reliability. The same
    /// rule is used for the global rate and the daily trend so a single
    /// dashboard never mixes definitions.
    pub success_rate: f64,
    pub avg_duration_ms: f64,
    pub p95_duration_ms: f64,
    pub total_cost_usd: f64,
    /// Mean time between failures in seconds (null if < 2 failures).
    #[ts(type = "number | null")]
    pub mtbf_seconds: Option<f64>,
    /// Count of consecutive recent failures (0 = healthy). Capped at
    /// `consecutive_failure_lookback`; render as "{cap}+" in the UI when
    /// the two are equal so users know the streak may be longer.
    pub consecutive_failures: i64,
    /// Number of recent executions inspected when computing
    /// `consecutive_failures`. Always equal to the
    /// `CONSECUTIVE_FAILURE_LOOKBACK` constant in the SLA repository;
    /// surfaced on the row so the frontend can render a "{cap}+"
    /// boundary indicator without hard-coding the cap.
    pub consecutive_failure_lookback: i64,
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
