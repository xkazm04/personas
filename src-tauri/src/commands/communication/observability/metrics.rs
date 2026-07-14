use chrono::{Datelike, TimeZone};
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tracing::{info, instrument};
use ts_rs::TS;

use crate::db::models::{
    AnomalyDrilldownData, ErrorCategoryBreakdown, ExecutionDashboardData, ExecutionHeatmapData,
    MetricsChartData, MetricsSummary, PersonaHealingIssue, ValueRollup,
};
use crate::db::repos::communication::sla as sla_repo;
use crate::db::repos::communication::sla::{PersonaDailyReliability, PersonaReliability};
use crate::db::repos::execution::healing as healing_repo;
use crate::db::repos::execution::metrics as repo;
use crate::db::repos::execution::provider_audit::{self, ProviderUsageStats};
use crate::engine::byom::ByomPolicy;
use crate::error::AppError;
use crate::ipc_auth::{require_auth_sync, require_privileged_sync};
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

/// Category-aware error analytics over the window. Classifies each failed
/// execution's stored `error_message` through the shared `error_taxonomy` at
/// aggregation time and returns per-category failure counts for the current
/// window and the prior window of equal length (category-grounded deltas, not a
/// resurrected generic trend), plus each persona's dominant failure category.
/// `persona_id = None` rolls up across all personas. Simulations are excluded.
#[tauri::command]
#[instrument(skip(state), fields(days, persona_id))]
pub fn get_error_category_breakdown(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
    persona_id: Option<String>,
) -> Result<ErrorCategoryBreakdown, AppError> {
    require_auth_sync(&state)?;
    let days = days.map(|d| d.clamp(1, 365));
    repo::get_error_category_breakdown(&state.db, days, persona_id.as_deref())
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

// =============================================================================
// Health bundle
// =============================================================================

/// Per-source failure reasons for the health bundle. A `null` field means that
/// source loaded cleanly; a `Some(reason)` means only that source failed, and
/// the corresponding payload on `HealthBundle` is `null`. This lets the health
/// dashboard degrade one source at a time instead of nuking the whole view when
/// a single query fails (the live "Incomplete health data | Retry" banner
/// class). It also disambiguates `byom_policy: None` — "no policy configured"
/// (valid) is `byom_policy = null, errors.byom_policy = null`, whereas a load
/// failure is `byom_policy = null, errors.byom_policy = Some(reason)`.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HealthBundleErrors {
    pub monthly_spend: Option<String>,
    pub healing_issues: Option<String>,
    pub byom_policy: Option<String>,
    pub provider_stats: Option<String>,
    pub persona_stats: Option<String>,
    pub persona_daily: Option<String>,
}

/// Server-side join of the four data sources the persona-health pipeline needs,
/// replacing four independent frontend IPC round-trips (each with its own
/// cold-start token-race failure surface) with one. Each payload is
/// independently fail-able via the `errors` envelope.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HealthBundle {
    pub monthly_spend: Option<MonthlySpendResult>,
    pub healing_issues: Option<Vec<PersonaHealingIssue>>,
    pub byom_policy: Option<ByomPolicy>,
    pub provider_stats: Option<Vec<ProviderUsageStats>>,
    // Per-persona measured reliability (success rate + avg latency): the
    // per-persona truth that replaces the fleet-wide overall_success_rate proxy
    // previously stamped on every active persona.
    pub persona_stats: Option<Vec<PersonaReliability>>,
    // Per-persona daily success series: feeds the per-persona failure trend.
    pub persona_daily: Option<Vec<PersonaDailyReliability>>,
    pub errors: HealthBundleErrors,
}

/// One-shot health bundle: monthly spend + (bounded) healing issues + BYOM
/// policy + provider usage stats, each independently fail-able.
///
/// `healing_window_days` (default 7) and `healing_limit` (default 1000) bound
/// the healing scan — see `healing::get_for_health`. Provider stats stay behind
/// the same privileged gate as the standalone `get_provider_usage_stats`
/// command; if the caller isn't privileged that ONE source reports an error
/// while the rest of the bundle still returns.
#[tauri::command]
#[instrument(skip(state), fields(healing_window_days, healing_limit, stats_window_days, utc_offset_minutes))]
pub fn get_health_bundle(
    state: State<'_, Arc<AppState>>,
    healing_window_days: Option<i64>,
    healing_limit: Option<i64>,
    stats_window_days: Option<i64>,
    utc_offset_minutes: Option<i32>,
) -> Result<HealthBundle, AppError> {
    require_auth_sync(&state)?;
    let start = std::time::Instant::now();
    let pool = &state.db;
    let healing_window = healing_window_days.unwrap_or(7).clamp(1, 365);
    let healing_limit = healing_limit.unwrap_or(1000).clamp(1, 5000);
    let stats_window = stats_window_days.unwrap_or(30).clamp(1, 365);

    // -- Monthly spend ----------------------------------------------------
    let (monthly_spend, monthly_err) = split(
        (|| {
            let conn = pool.get()?;
            get_all_monthly_spend_with_conn(&conn, utc_offset_minutes)
        })(),
    );

    // -- Healing issues (bounded) -----------------------------------------
    let (healing_issues, healing_err) =
        split(healing_repo::get_for_health(pool, healing_window, healing_limit));

    // -- BYOM policy (Ok(None) = no policy configured, which is valid) -----
    let (byom_policy, byom_err) = match ByomPolicy::load(pool) {
        Ok(policy) => (policy, None),
        Err(e) => (None, Some(e.to_string())),
    };

    // -- Provider stats (privileged; degrade this source alone if not) ----
    let (provider_stats, provider_err) =
        match require_privileged_sync(&state, "get_health_bundle") {
            Ok(()) => split(provider_audit::get_usage_stats(pool)),
            Err(e) => (None, Some(e.to_string())),
        };

    // -- Per-persona reliability + daily series (the per-persona truth) ----
    let (persona_stats, persona_stats_err) =
        split(sla_repo::get_persona_reliability(pool, stats_window));
    let (persona_daily, persona_daily_err) =
        split(sla_repo::get_persona_daily_reliability(pool, stats_window));

    info!(
        duration_ms = start.elapsed().as_millis() as u64,
        healing_window, stats_window, "cmd::get_health_bundle"
    );

    Ok(HealthBundle {
        monthly_spend,
        healing_issues,
        byom_policy,
        provider_stats,
        persona_stats,
        persona_daily,
        errors: HealthBundleErrors {
            monthly_spend: monthly_err,
            healing_issues: healing_err,
            byom_policy: byom_err,
            provider_stats: provider_err,
            persona_stats: persona_stats_err,
            persona_daily: persona_daily_err,
        },
    })
}

/// Collapse a `Result<T, AppError>` into a `(Option<T>, Option<String>)`
/// payload/error pair for the health bundle envelope.
fn split<T>(r: Result<T, AppError>) -> (Option<T>, Option<String>) {
    match r {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(e.to_string())),
    }
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
