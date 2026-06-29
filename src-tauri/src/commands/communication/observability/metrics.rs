use chrono::{Datelike, TimeZone};
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tracing::{info, instrument};
use ts_rs::TS;

use crate::db::models::{
    AnomalyDrilldownData, ExecutionDashboardData, ExecutionHeatmapData, MetricsChartData,
    MetricsSummary, ValueRollup,
};
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

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OverviewBundle {
    pub metrics_summary: MetricsSummary,
    pub metrics_chart_data: MetricsChartData,
    pub monthly_spend: MonthlySpendResult,
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

/// Business-value + efficiency rollup over the window. `persona_id = None`
/// rolls up across all personas (dashboard headline tile); `Some(id)` scopes
/// to one persona. Aggregates the per-execution `business_outcome`
/// self-assessment into a value-delivered rate, cost-per-value, and per-model
/// breakdown. Excludes simulations.
#[tauri::command]
#[instrument(skip(state), fields(days, persona_id))]
pub fn get_value_rollup(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    persona_id: Option<String>,
) -> Result<ValueRollup, AppError> {
    require_auth_sync(&state)?;
    let days = days.map(|d| d.clamp(1, 365));
    repo::get_value_rollup(&state.db, days, persona_id.as_deref())
}

/// Returns per-persona monthly spend for the budget UI.
///
/// The spend total here MUST equal what the server budget gate enforces, so the
/// "start of month" boundary is UTC (`datetime('now', 'start of month')`) and the
/// counted row set matches `get_monthly_spend` exactly via the shared
/// `MONTHLY_SPEND_PREDICATE`. The `utc_offset_minutes` argument is still accepted
/// for backward compatibility with existing callers but is intentionally ignored —
/// a local-timezone boundary would make the badge disagree with the gate that
/// actually blocks runs.
#[tauri::command]
#[instrument(skip(state), fields(utc_offset_minutes))]
pub fn get_all_monthly_spend(
    state: State<'_, Arc<AppState>>,
    utc_offset_minutes: Option<i32>,
) -> Result<MonthlySpendResult, AppError> {
    require_auth_sync(&state)?;
    let start = std::time::Instant::now();
    let conn = state.db.get()?;
    let result = get_all_monthly_spend_with_conn(&conn, utc_offset_minutes)?;
    info!(
        duration_ms = start.elapsed().as_millis() as u64,
        rows = result.items.len(),
        "cmd::get_all_monthly_spend"
    );
    Ok(result)
}

#[tauri::command]
#[instrument(skip(state), fields(days, persona_id, utc_offset_minutes))]
pub fn get_overview_bundle(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    persona_id: Option<String>,
    utc_offset_minutes: Option<i32>,
) -> Result<OverviewBundle, AppError> {
    require_auth_sync(&state)?;
    let start = std::time::Instant::now();
    let days = days.unwrap_or(30).clamp(1, 365);
    let conn = state.db.get()?;
    conn.execute_batch("BEGIN DEFERRED")?;
    let result = (|| -> Result<OverviewBundle, AppError> {
        Ok(OverviewBundle {
            metrics_summary: repo::get_summary_with_conn(&conn, days, persona_id.as_deref())?,
            metrics_chart_data: repo::get_chart_data_with_conn(&conn, days, persona_id.as_deref())?,
            monthly_spend: get_all_monthly_spend_with_conn(&conn, utc_offset_minutes)?,
        })
    })();

    match result {
        Ok(bundle) => {
            conn.execute_batch("COMMIT")?;
            info!(
                duration_ms = start.elapsed().as_millis() as u64,
                days,
                persona_id = persona_id.as_deref().unwrap_or(""),
                monthly_rows = bundle.monthly_spend.items.len(),
                "cmd::get_overview_bundle"
            );
            Ok(bundle)
        }
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(err)
        }
    }
}

fn get_all_monthly_spend_with_conn(
    conn: &Connection,
    _utc_offset_minutes: Option<i32>,
) -> Result<MonthlySpendResult, AppError> {
    // The budget UI MUST measure exactly what the server budget gate enforces,
    // so per-persona spend uses the shared MONTHLY_SPEND_PREDICATE — the SAME
    // status set, UTC start-of-month boundary, and ops-chat exclusion as
    // db::repos::execution::executions::get_monthly_spend (the gate that BLOCKS
    // runs). These MUST stay in lock-step; see the engine/background.rs invariant
    // (~1498-1510): "the budget UI shows terminal statuses only, ops-chat
    // excluded". Because the boundary is UTC (to match the server), the caller's
    // utc_offset_minutes is intentionally ignored.
    let period_start_str = monthly_period_start_utc(None);
    let sql = format!(
        "SELECT p.id, COALESCE(e.spend, 0.0), p.max_budget_usd, p.name
         FROM personas p
         LEFT JOIN (
             SELECT persona_id, SUM(cost_usd) AS spend
             FROM persona_executions
             WHERE {}
             GROUP BY persona_id
         ) e ON e.persona_id = p.id
         ORDER BY p.name",
        crate::db::repos::execution::executions::MONTHLY_SPEND_PREDICATE
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(PersonaMonthlySpend {
            id: row.get(0)?,
            spend: row.get(1)?,
            max_budget_usd: row.get(2)?,
            name: row.get(3)?,
        })
    })?;
    let items: Vec<PersonaMonthlySpend> = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(MonthlySpendResult {
        period_start_utc: period_start_str,
        items,
    })
}

fn monthly_period_start_utc(utc_offset_minutes: Option<i32>) -> String {
    // Compute the start-of-month boundary in the user's local timezone,
    // expressed as a UTC datetime string for the SQL query.
    let offset_mins = utc_offset_minutes
        .map(|m| m.clamp(-840, 840)) // max +/-14 hours
        .unwrap_or(0);

    let now_utc = chrono::Utc::now();
    let local_offset = chrono::FixedOffset::east_opt(offset_mins * 60)
        .unwrap_or_else(|| chrono::FixedOffset::east_opt(0).unwrap());
    let local_now = now_utc.with_timezone(&local_offset);
    let local_month_start = local_now
        .date_naive()
        .with_day(1)
        .unwrap_or(local_now.date_naive());
    let local_month_start_dt = local_month_start.and_hms_opt(0, 0, 0).unwrap();
    let period_start_utc: chrono::DateTime<chrono::Utc> = local_offset
        .from_local_datetime(&local_month_start_dt)
        .earliest()
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|| {
            let offset_secs = chrono::Duration::seconds(offset_mins as i64 * 60);
            let naive_utc = local_month_start_dt - offset_secs;
            chrono::DateTime::from_naive_utc_and_offset(naive_utc, chrono::Utc)
        });

    period_start_utc.format("%Y-%m-%dT%H:%M:%S").to_string()
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

/// Returns daily execution counts + cost for the last `days` days (default 365),
/// plus derived insights (longest streak, dormant-since, peak day, week-over-week).
/// Result is cached server-side per (days, persona_id) for 1 hour.
#[tauri::command]
#[instrument(skip(state), fields(days, persona_id))]
pub fn get_execution_heatmap(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    persona_id: Option<String>,
    tz_offset_minutes: Option<i64>,
) -> Result<ExecutionHeatmapData, AppError> {
    require_auth_sync(&state)?;
    let days = days.map(|d| d.clamp(1, 365));
    repo::get_execution_heatmap(&state.db, days, persona_id.as_deref(), tz_offset_minutes)
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
