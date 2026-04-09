use std::sync::Arc;
use chrono::{Datelike, TimeZone};
use serde::Serialize;
use tauri::State;
use tracing::{info, instrument};
use ts_rs::TS;

use crate::db::models::{MetricsChartData, MetricsSummary, ExecutionDashboardData, AnomalyDrilldownData};
use crate::db::repos::execution::metrics as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PersonaMonthlySpend {
    pub id: String,
    pub spend: f64,
    pub max_budget_usd: Option<f64>,
    pub name: String,
}

/// Wrapper returned by get_all_monthly_spend so the frontend knows exactly
/// which period the spend figures cover.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MonthlySpendResult {
    /// ISO-8601 UTC timestamp of the period start used in the query.
    pub period_start_utc: String,
    pub items: Vec<PersonaMonthlySpend>,
}

#[tauri::command]
#[instrument(skip(state), fields(days, persona_id))]
pub fn get_metrics_summary(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    persona_id: Option<String>,
) -> Result<MetricsSummary, AppError> {
    require_auth_sync(&state)?;
    let days = days.map(|d| d.clamp(1, 365));
    repo::get_summary(&state.db, days, persona_id.as_deref())
}

#[tauri::command]
#[instrument(skip(state), fields(days, persona_id))]
pub fn get_metrics_chart_data(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    persona_id: Option<String>,
) -> Result<MetricsChartData, AppError> {
    require_auth_sync(&state)?;
    let days = days.map(|d| d.clamp(1, 365));
    repo::get_chart_data(&state.db, days, persona_id.as_deref())
}

/// Returns per-persona monthly spend.
///
/// `utc_offset_minutes` — the user's local UTC offset in minutes (e.g. UTC-8 → -480,
/// UTC+2 → 120).  When provided the "start of month" boundary is computed in the
/// user's local timezone so that spend totals match their calendar month.  When
/// omitted the query falls back to UTC.
#[tauri::command]
#[instrument(skip(state), fields(utc_offset_minutes))]
pub fn get_all_monthly_spend(
    state: State<'_, Arc<AppState>>,
    utc_offset_minutes: Option<i32>,
) -> Result<MonthlySpendResult, AppError> {
    require_auth_sync(&state)?;
    let start = std::time::Instant::now();

    // Compute the start-of-month boundary in the user's local timezone,
    // expressed as a UTC datetime string for the SQL query.
    let offset_mins = utc_offset_minutes
        .map(|m| m.clamp(-840, 840)) // max ±14 hours
        .unwrap_or(0);

    let now_utc = chrono::Utc::now();
    let local_offset = chrono::FixedOffset::east_opt(offset_mins * 60)
        .unwrap_or_else(|| chrono::FixedOffset::east_opt(0).unwrap());
    let local_now = now_utc.with_timezone(&local_offset);
    let local_month_start = local_now
        .date_naive()
        .with_day(1)
        .unwrap_or(local_now.date_naive());
    let local_month_start_dt = local_month_start
        .and_hms_opt(0, 0, 0)
        .unwrap();
    // Convert local start-of-month back to UTC.
    // Use earliest() instead of single() so that DST-ambiguous times resolve
    // to the earlier UTC instant (guaranteeing period_start <= now).
    // The fallback manually subtracts the offset rather than misinterpreting
    // the local naive datetime as UTC.
    let period_start_utc: chrono::DateTime<chrono::Utc> = local_offset
        .from_local_datetime(&local_month_start_dt)
        .earliest()
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|| {
            // Gap (e.g. spring-forward): subtract the offset manually so the
            // result is always at-or-before now, never in the future.
            let offset_secs = chrono::Duration::seconds(offset_mins as i64 * 60);
            let naive_utc = local_month_start_dt - offset_secs;
            chrono::DateTime::from_naive_utc_and_offset(naive_utc, chrono::Utc)
        });

    let period_start_str = period_start_utc.format("%Y-%m-%dT%H:%M:%S").to_string();

    let conn = state.db.get()?;
    let mut stmt = conn.prepare(
        "SELECT p.id, COALESCE(e.spend, 0.0), p.max_budget_usd, p.name
         FROM personas p
         LEFT JOIN (
             SELECT persona_id, SUM(cost_usd) AS spend
             FROM persona_executions
             WHERE created_at >= ?1
               AND status IN ('completed', 'failed')
             GROUP BY persona_id
         ) e ON e.persona_id = p.id
         ORDER BY p.name",
    )?;
    let rows = stmt.query_map(rusqlite::params![period_start_str], |row| {
        Ok(PersonaMonthlySpend {
            id: row.get(0)?,
            spend: row.get(1)?,
            max_budget_usd: row.get(2)?,
            name: row.get(3)?,
        })
    })?;
    let items: Vec<PersonaMonthlySpend> = rows.collect::<Result<Vec<_>, _>>()?;
    info!(duration_ms = start.elapsed().as_millis() as u64, rows = items.len(), "cmd::get_all_monthly_spend");
    Ok(MonthlySpendResult {
        period_start_utc: period_start_str,
        items,
    })
}

/// Returns aggregated prompt performance data for a single persona,
/// including daily metrics with percentiles, version markers, and anomalies.
#[tauri::command]
#[instrument(skip(state), fields(persona_id, days))]
pub fn get_prompt_performance(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    days: Option<i64>,
) -> Result<crate::db::models::PromptPerformanceData, AppError> {
    require_auth_sync(&state)?;
    repo::get_prompt_performance(&state.db, &persona_id, days.unwrap_or(30).clamp(1, 365))
}

/// Returns aggregated dashboard data across all personas for the last N days,
/// including daily time-series, latency percentiles, top-5 personas by cost,
/// and cost anomaly detection.
#[tauri::command]
#[instrument(skip(state), fields(days))]
pub fn get_execution_dashboard(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
) -> Result<ExecutionDashboardData, AppError> {
    require_auth_sync(&state)?;
    repo::get_execution_dashboard(&state.db, days.unwrap_or(30).clamp(1, 365))
}

/// Returns correlated events and root-cause suggestions for a specific anomaly.
#[tauri::command]
#[instrument(skip(state), fields(anomaly_date, anomaly_metric))]
pub fn get_anomaly_drilldown(
    state: State<'_, Arc<AppState>>,
    anomaly_date: String,
    anomaly_metric: String,
    anomaly_value: f64,
    anomaly_baseline: f64,
    anomaly_deviation_pct: f64,
    persona_id: Option<String>,
) -> Result<AnomalyDrilldownData, AppError> {
    require_auth_sync(&state)?;
    repo::get_anomaly_drilldown(
        &state.db,
        &anomaly_date,
        &anomaly_metric,
        anomaly_value,
        anomaly_baseline,
        anomaly_deviation_pct,
        persona_id.as_deref(),
    )
}
