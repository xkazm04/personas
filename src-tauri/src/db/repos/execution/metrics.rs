use std::collections::HashMap;
use rusqlite::{params, Row};
use tracing::{info, instrument};

use crate::db::models::{
    MetricsChartData, MetricsChartPoint, MetricsPersonaBreakdown,
    PersonaPromptVersion, PromptPerformanceData, PromptPerformancePoint,
    VersionMarker, MetricAnomaly,
    DashboardDailyPoint, DashboardCostAnomaly, DashboardTopPersona,
    ExecutionDashboardData, PersonaCostEntry,
    AnomalyDrilldownData, CorrelatedEvent, RootCauseSuggestion,
};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mappers
// ============================================================================

fn row_to_prompt_version(row: &Row) -> rusqlite::Result<PersonaPromptVersion> {
    Ok(PersonaPromptVersion {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        version_number: row.get("version_number")?,
        structured_prompt: row.get("structured_prompt")?,
        system_prompt: row.get("system_prompt")?,
        change_summary: row.get("change_summary")?,
        tag: row.get::<_, Option<String>>("tag")?.unwrap_or_else(|| "experimental".into()),
        created_at: row.get("created_at")?,
        design_context: row.get("design_context").unwrap_or(None),
        last_design_result: row.get("last_design_result").unwrap_or(None),
        resolved_cells: row.get("resolved_cells").unwrap_or(None),
        icon: row.get("icon").unwrap_or(None),
        color: row.get("color").unwrap_or(None),
    })
}

// ============================================================================
// Prompt Versions
// ============================================================================

/// Snapshot fields for full persona versioning (optional — None means "not captured").
#[derive(Default)]
pub struct VersionSnapshotFields {
    pub design_context: Option<String>,
    pub last_design_result: Option<String>,
    pub resolved_cells: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

pub fn create_prompt_version(
    pool: &DbPool,
    persona_id: &str,
    structured_prompt: Option<String>,
    system_prompt: Option<String>,
    change_summary: Option<String>,
) -> Result<PersonaPromptVersion, AppError> {
    create_prompt_version_with_snapshot(pool, persona_id, structured_prompt, system_prompt, change_summary, VersionSnapshotFields::default())
}

pub fn create_prompt_version_with_snapshot(
    pool: &DbPool,
    persona_id: &str,
    structured_prompt: Option<String>,
    system_prompt: Option<String>,
    change_summary: Option<String>,
    snapshot: VersionSnapshotFields,
) -> Result<PersonaPromptVersion, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let tag = "experimental".to_string();

    let conn = pool.get()?;

    let version_number: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM persona_prompt_versions WHERE persona_id = ?1",
            params![persona_id],
            |row| row.get(0),
        )?;

    conn.execute(
        "INSERT INTO persona_prompt_versions
         (id, persona_id, version_number, structured_prompt, system_prompt, change_summary, tag, created_at,
          design_context, last_design_result, resolved_cells, icon, color)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            id, persona_id, version_number, structured_prompt, system_prompt, change_summary, tag, now,
            snapshot.design_context, snapshot.last_design_result, snapshot.resolved_cells, snapshot.icon, snapshot.color,
        ],
    )?;

    Ok(PersonaPromptVersion {
        id, persona_id: persona_id.to_string(), version_number,
        structured_prompt, system_prompt, change_summary, tag, created_at: now,
        design_context: snapshot.design_context, last_design_result: snapshot.last_design_result,
        resolved_cells: snapshot.resolved_cells, icon: snapshot.icon, color: snapshot.color,
    })
}

/// Creates a version only if the prompt actually changed from the latest version.
/// Returns Some(version) if created, None if unchanged.
pub fn create_prompt_version_if_changed(
    pool: &DbPool,
    persona_id: &str,
    structured_prompt: Option<String>,
    system_prompt: Option<String>,
) -> Result<Option<PersonaPromptVersion>, AppError> {
    let conn = pool.get()?;

    // Get latest version's prompt to diff
    let latest: Option<(Option<String>,)> = conn
        .query_row(
            "SELECT structured_prompt FROM persona_prompt_versions
             WHERE persona_id = ?1 ORDER BY version_number DESC LIMIT 1",
            params![persona_id],
            |row| Ok((row.get(0)?,)),
        )
        .ok();

    let latest_prompt = latest.and_then(|r| r.0);

    // Skip if prompts are identical
    if latest_prompt.as_deref() == structured_prompt.as_deref() {
        return Ok(None);
    }

    let version = create_prompt_version(
        pool,
        persona_id,
        structured_prompt,
        system_prompt,
        Some("Auto-saved".into()),
    )?;
    Ok(Some(version))
}

pub fn get_prompt_versions(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaPromptVersion>, AppError> {
    let limit = limit.unwrap_or(50);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_prompt_versions WHERE persona_id = ?1 ORDER BY version_number DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], row_to_prompt_version)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_prompt_version_by_id(
    pool: &DbPool,
    id: &str,
) -> Result<PersonaPromptVersion, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_prompt_versions WHERE id = ?1",
        params![id],
        row_to_prompt_version,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Prompt version {id}")),
        other => AppError::Database(other),
    })
}

pub fn update_prompt_version_tag(
    pool: &DbPool,
    id: &str,
    tag: &str,
) -> Result<PersonaPromptVersion, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "UPDATE persona_prompt_versions SET tag = ?1 WHERE id = ?2",
        params![tag, id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Prompt version {id}")));
    }
    get_prompt_version_by_id(pool, id)
}

/// Get the current production version for a persona, if any.
pub fn get_production_version(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<PersonaPromptVersion>, AppError> {
    let conn = pool.get()?;
    let result = conn.query_row(
        "SELECT * FROM persona_prompt_versions WHERE persona_id = ?1 AND tag = 'production' ORDER BY version_number DESC LIMIT 1",
        params![persona_id],
        row_to_prompt_version,
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Get recent error rate for a persona (last N executions).
pub fn get_recent_error_rate(
    pool: &DbPool,
    persona_id: &str,
    window: i64,
) -> Result<f64, AppError> {
    let conn = pool.get()?;
    let (total, failed): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END), 0)
         FROM (SELECT status FROM persona_executions WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT ?2)",
        params![persona_id, window],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if total == 0 {
        return Ok(0.0);
    }
    Ok(failed as f64 / total as f64)
}

// ============================================================================
// Optional persona_id filter helper
// ============================================================================

/// Builds the optional `AND persona_id = ?N` clause and matching param vec.
/// The date_filter string is always `?1`; if `persona_id` is Some, it becomes `?2`.
fn persona_filter_params(
    date_filter: String,
    persona_id: Option<&str>,
) -> (String, Vec<Box<dyn rusqlite::types::ToSql>>) {
    match persona_id {
        Some(pid) => (
            " AND persona_id = ?2".to_string(),
            vec![
                Box::new(date_filter) as Box<dyn rusqlite::types::ToSql>,
                Box::new(pid.to_string()),
            ],
        ),
        None => (
            String::new(),
            vec![Box::new(date_filter) as Box<dyn rusqlite::types::ToSql>],
        ),
    }
}

// ============================================================================
// Live summary from persona_executions
// ============================================================================

#[instrument(skip(pool), fields(days, persona_id))]
pub fn get_summary(pool: &DbPool, days: Option<i64>, persona_id: Option<&str>) -> Result<serde_json::Value, AppError> {
    let start = std::time::Instant::now();
    let days = days.unwrap_or(30).clamp(1, 365);
    let conn = pool.get()?;
    let (pid_clause, param_values) = persona_filter_params(format!("-{days} days"), persona_id);

    let sql = format!(
        "SELECT
            COUNT(*) as total_executions,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as successful,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
            COALESCE(SUM(cost_usd), 0.0) as total_cost,
            COUNT(DISTINCT persona_id) as active_personas
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1){pid_clause}"
    );

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let row = conn.query_row(&sql, params_ref.as_slice(), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, f64>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;

    let result = serde_json::json!({
        "total_executions": row.0,
        "successful_executions": row.1,
        "failed_executions": row.2,
        "total_cost_usd": row.3,
        "active_personas": row.4,
        "period_days": days,
    });

    info!(
        duration_ms = start.elapsed().as_millis() as u64,
        total_executions = row.0,
        active_personas = row.4,
        "get_summary completed"
    );

    Ok(result)
}

// ============================================================================
// Pre-bucketed chart data (aggregated in SQL, replaces frontend pivot logic)
// ============================================================================

/// Returns chart-ready time-series and per-persona breakdown in a single call.
/// The SQL GROUP BY produces the same result as the ~30 lines of client-side
/// Map-based aggregation that previously ran in ObservabilityDashboard.
#[instrument(skip(pool), fields(days, persona_id))]
pub fn get_chart_data(
    pool: &DbPool,
    days: Option<i64>,
    persona_id: Option<&str>,
) -> Result<MetricsChartData, AppError> {
    let start = std::time::Instant::now();
    let days = days.unwrap_or(30).clamp(1, 365);
    let conn = pool.get()?;
    let (pid_clause, param_values) = persona_filter_params(format!("-{days} days"), persona_id);

    // 1) Date-bucketed chart points (GROUP BY date only)
    let chart_sql = format!(
        "SELECT
            DATE(created_at) as date,
            COALESCE(SUM(cost_usd), 0.0) as cost,
            COUNT(*) as executions,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as success,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
            COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) as tokens,
            COUNT(DISTINCT persona_id) as active_personas
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1){pid_clause}
         GROUP BY DATE(created_at)
         ORDER BY date ASC"
    );

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let chart_points = {
        let mut stmt = conn.prepare(&chart_sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok(MetricsChartPoint {
                date: row.get("date")?,
                cost: row.get("cost")?,
                executions: row.get("executions")?,
                success: row.get("success")?,
                failed: row.get("failed")?,
                tokens: row.get("tokens")?,
                active_personas: row.get("active_personas")?,
            })
        })?;
        rows.filter_map(|r| r.ok()).collect()
    };

    // 2) Per-persona breakdown (for pie chart)
    let breakdown_sql = format!(
        "SELECT
            persona_id,
            COUNT(*) as executions,
            COALESCE(SUM(cost_usd), 0.0) as cost
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1){pid_clause}
         GROUP BY persona_id
         HAVING executions > 0"
    );

    let persona_breakdown = {
        let mut stmt = conn.prepare(&breakdown_sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok(MetricsPersonaBreakdown {
                persona_id: row.get("persona_id")?,
                executions: row.get("executions")?,
                cost: row.get("cost")?,
            })
        })?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let result = MetricsChartData {
        chart_points,
        persona_breakdown,
    };

    info!(
        duration_ms = start.elapsed().as_millis() as u64,
        chart_points = result.chart_points.len(),
        persona_breakdown = result.persona_breakdown.len(),
        "get_chart_data completed"
    );

    Ok(result)
}

// ============================================================================
// Prompt Performance Dashboard -- aggregated metrics for a single persona
// ============================================================================

/// Raw execution row for in-Rust percentile computation.
struct RawExecRow {
    date: String,
    duration_ms: f64,
    cost_usd: f64,
    input_tokens: f64,
    output_tokens: f64,
    status: String,
    id: String,
}

/// Compute the p-th percentile from a sorted slice of f64 values.
fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return sorted[0];
    }
    let idx = (p / 100.0) * (sorted.len() as f64 - 1.0);
    let lower = idx.floor() as usize;
    let upper = idx.ceil() as usize;
    if lower == upper {
        sorted[lower]
    } else {
        let frac = idx - lower as f64;
        sorted[lower] * (1.0 - frac) + sorted[upper] * frac
    }
}

/// Detect anomalies: points where a metric deviates > 2x from its
/// rolling 5-day average (or the overall average for early points).
#[allow(clippy::type_complexity)]
fn detect_anomalies(
    daily_points: &[PromptPerformancePoint],
    worst_exec_by_date: &HashMap<String, (String, f64)>,
) -> Vec<MetricAnomaly> {
    let mut anomalies = Vec::new();
    let window = 5;

    // Check cost and error_rate
    let metrics: Vec<(&str, Box<dyn Fn(&PromptPerformancePoint) -> f64>)> = vec![
        ("cost", Box::new(|p: &PromptPerformancePoint| p.avg_cost_usd)),
        ("error_rate", Box::new(|p: &PromptPerformancePoint| p.error_rate)),
        ("latency", Box::new(|p: &PromptPerformancePoint| p.p95_duration_ms)),
    ];

    for (metric_name, extract) in &metrics {
        for i in 0..daily_points.len() {
            let value = extract(&daily_points[i]);
            if value == 0.0 {
                continue;
            }

            // Compute baseline as rolling window average of preceding points
            let start = i.saturating_sub(window);
            let preceding: Vec<f64> = (start..i).map(|j| extract(&daily_points[j])).collect();
            if preceding.is_empty() {
                continue;
            }
            let baseline = preceding.iter().sum::<f64>() / preceding.len() as f64;
            if baseline == 0.0 {
                continue;
            }

            let deviation_pct = ((value - baseline) / baseline) * 100.0;

            // Flag if deviation > 100% (2x baseline)
            if deviation_pct > 100.0 {
                let exec_id = worst_exec_by_date
                    .get(&daily_points[i].date)
                    .map(|(id, _)| id.clone());

                anomalies.push(MetricAnomaly {
                    date: daily_points[i].date.clone(),
                    metric: metric_name.to_string(),
                    value,
                    baseline,
                    deviation_pct,
                    execution_id: exec_id,
                });
            }
        }
    }

    anomalies
}

/// Returns aggregated prompt performance data for a single persona
/// over the last N days, including daily metrics, version markers,
/// and detected anomalies.
#[instrument(skip(pool), fields(persona_id, days))]
pub fn get_prompt_performance(
    pool: &DbPool,
    persona_id: &str,
    days: i64,
) -> Result<PromptPerformanceData, AppError> {
    let start = std::time::Instant::now();
    let days = days.clamp(1, 365);
    let conn = pool.get()?;
    let date_filter = format!("-{days} days");

    // 1) Fetch raw execution rows for this persona
    let mut stmt = conn.prepare(
        "SELECT
            DATE(created_at) as date,
            COALESCE(duration_ms, 0) as duration_ms,
            COALESCE(cost_usd, 0.0) as cost_usd,
            COALESCE(input_tokens, 0) as input_tokens,
            COALESCE(output_tokens, 0) as output_tokens,
            status,
            id
         FROM persona_executions
         WHERE persona_id = ?1
           AND created_at >= datetime('now', ?2)
           AND status IN ('completed', 'failed')
         ORDER BY date ASC, cost_usd DESC",
    )?;
    let rows: Vec<RawExecRow> = stmt
        .query_map(params![persona_id, date_filter], |row| {
            Ok(RawExecRow {
                date: row.get(0)?,
                duration_ms: row.get(1)?,
                cost_usd: row.get(2)?,
                input_tokens: row.get(3)?,
                output_tokens: row.get(4)?,
                status: row.get(5)?,
                id: row.get(6)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // 2) Bucket by date
    let mut date_buckets: HashMap<String, Vec<&RawExecRow>> = HashMap::new();
    for row in &rows {
        date_buckets
            .entry(row.date.clone())
            .or_default()
            .push(row);
    }

    // Track the worst (most expensive) execution per date for anomaly linking
    let mut worst_exec_by_date: HashMap<String, (String, f64)> = HashMap::new();
    for row in &rows {
        let entry = worst_exec_by_date
            .entry(row.date.clone())
            .or_insert_with(|| (row.id.clone(), row.cost_usd));
        if row.cost_usd > entry.1 || row.duration_ms > entry.1 {
            *entry = (row.id.clone(), row.cost_usd.max(row.duration_ms));
        }
    }

    // 3) Build daily points with percentiles
    let mut dates: Vec<String> = date_buckets.keys().cloned().collect();
    dates.sort();

    let daily_points: Vec<PromptPerformancePoint> = dates
        .iter()
        .map(|date| {
            let bucket = &date_buckets[date];
            let n = bucket.len() as f64;
            let success = bucket.iter().filter(|r| r.status == "completed").count() as i64;
            let failed = bucket.iter().filter(|r| r.status == "failed").count() as i64;

            let mut durations: Vec<f64> = bucket.iter().map(|r| r.duration_ms).collect();
            durations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

            PromptPerformancePoint {
                date: date.clone(),
                avg_cost_usd: bucket.iter().map(|r| r.cost_usd).sum::<f64>() / n,
                avg_duration_ms: bucket.iter().map(|r| r.duration_ms).sum::<f64>() / n,
                avg_input_tokens: bucket.iter().map(|r| r.input_tokens).sum::<f64>() / n,
                avg_output_tokens: bucket.iter().map(|r| r.output_tokens).sum::<f64>() / n,
                total_executions: bucket.len() as i64,
                success_count: success,
                failed_count: failed,
                error_rate: if (success + failed) > 0 {
                    failed as f64 / (success + failed) as f64
                } else {
                    0.0
                },
                p50_duration_ms: percentile(&durations, 50.0),
                p95_duration_ms: percentile(&durations, 95.0),
                p99_duration_ms: percentile(&durations, 99.0),
            }
        })
        .collect();

    // 4) Fetch version markers
    let mut vstmt = conn.prepare(
        "SELECT id, version_number, COALESCE(tag, 'experimental') as tag, created_at, change_summary
         FROM persona_prompt_versions
         WHERE persona_id = ?1
           AND created_at >= datetime('now', ?2)
         ORDER BY version_number ASC",
    )?;
    let version_markers: Vec<VersionMarker> = vstmt
        .query_map(params![persona_id, date_filter], |row| {
            Ok(VersionMarker {
                version_id: row.get(0)?,
                version_number: row.get(1)?,
                tag: row.get(2)?,
                created_at: row.get(3)?,
                change_summary: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // 5) Detect anomalies
    let anomalies = detect_anomalies(&daily_points, &worst_exec_by_date);

    info!(
        duration_ms = start.elapsed().as_millis() as u64,
        raw_rows = rows.len(),
        daily_points = daily_points.len(),
        version_markers = version_markers.len(),
        anomalies = anomalies.len(),
        "get_prompt_performance completed"
    );

    Ok(PromptPerformanceData {
        daily_points,
        version_markers,
        anomalies,
    })
}

// ============================================================================
// Execution Metrics Dashboard -- aggregated cross-persona dashboard data
// ============================================================================

/// Returns aggregated dashboard data across all personas for the last N days.
/// Includes daily time-series with per-persona cost breakdown, latency percentiles,
/// top-5 costliest personas, and cost anomaly detection.
///
/// Uses a single SQL query + single-pass Rust aggregation to avoid redundant table scans.
#[instrument(skip(pool), fields(days))]
pub fn get_execution_dashboard(
    pool: &DbPool,
    days: i64,
) -> Result<ExecutionDashboardData, AppError> {
    let start = std::time::Instant::now();
    let days = days.clamp(1, 365);
    let conn = pool.get()?;
    let date_filter = format!("-{days} days");

    // Single query: fetch all rows with persona name, aggregated in Rust.
    // This replaces 4 separate SQL queries that each scanned the same rows.
    let mut stmt = conn.prepare(
        "SELECT
            DATE(e.created_at) as date,
            e.persona_id,
            COALESCE(p.name, 'Unknown') as persona_name,
            COALESCE(e.duration_ms, 0) as duration_ms,
            COALESCE(e.cost_usd, 0.0) as cost_usd,
            COALESCE(e.input_tokens, 0) as input_tokens,
            COALESCE(e.output_tokens, 0) as output_tokens,
            e.status,
            e.id
         FROM persona_executions e
         LEFT JOIN personas p ON p.id = e.persona_id
         WHERE e.created_at >= datetime('now', ?1)
           AND e.status IN ('completed', 'failed')
         ORDER BY DATE(e.created_at) ASC, e.cost_usd DESC",
    )?;

    struct RawRow {
        date: String,
        persona_id: String,
        persona_name: String,
        duration_ms: f64,
        cost_usd: f64,
        input_tokens: i64,
        output_tokens: i64,
        status: String,
        exec_id: String,
    }

    let rows: Vec<RawRow> = stmt
        .query_map(params![date_filter], |row| {
            Ok(RawRow {
                date: row.get(0)?,
                persona_id: row.get(1)?,
                persona_name: row.get(2)?,
                duration_ms: row.get(3)?,
                cost_usd: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                status: row.get(7)?,
                exec_id: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Ok(ExecutionDashboardData {
            daily_points: vec![],
            top_personas: vec![],
            cost_anomalies: vec![],
            total_executions: 0,
            successful_executions: 0,
            failed_executions: 0,
            total_cost: 0.0,
            overall_success_rate: 0.0,
            avg_latency_ms: 0.0,
            active_personas: 0,
            projected_monthly_cost: None,
            burn_rate: None,
        });
    }

    // Single-pass aggregation over all rows
    struct DateBucket {
        total: i64,
        completed: i64,
        failed: i64,
        total_cost: f64,
        total_tokens: i64,
        sum_duration: f64,
        durations: Vec<f64>,
        persona_costs: HashMap<String, (String, f64)>, // persona_id -> (name, cost)
        top_exec_ids: Vec<(String, f64)>,               // (exec_id, cost_usd) kept sorted desc
    }

    struct PersonaAgg {
        persona_name: String,
        total_cost: f64,
        total_executions: i64,
    }

    let mut date_buckets: HashMap<String, DateBucket> = HashMap::new();
    let mut persona_aggs: HashMap<String, PersonaAgg> = HashMap::new();

    for row in &rows {
        // Per-date aggregation
        let bucket = date_buckets.entry(row.date.clone()).or_insert_with(|| DateBucket {
            total: 0, completed: 0, failed: 0, total_cost: 0.0, total_tokens: 0,
            sum_duration: 0.0, durations: Vec::new(),
            persona_costs: HashMap::new(), top_exec_ids: Vec::new(),
        });
        bucket.total += 1;
        if row.status == "completed" { bucket.completed += 1; }
        if row.status == "failed" { bucket.failed += 1; }
        bucket.total_cost += row.cost_usd;
        bucket.total_tokens += row.input_tokens + row.output_tokens;
        bucket.sum_duration += row.duration_ms;
        bucket.durations.push(row.duration_ms);

        // Per-persona cost within this date
        let pc = bucket.persona_costs
            .entry(row.persona_id.clone())
            .or_insert_with(|| (row.persona_name.clone(), 0.0));
        pc.1 += row.cost_usd;

        // Track top-5 costliest exec IDs per date (rows already ordered by cost_usd DESC)
        if bucket.top_exec_ids.len() < 5 {
            bucket.top_exec_ids.push((row.exec_id.clone(), row.cost_usd));
        }

        // Global per-persona aggregation (for top-5 costliest personas)
        let pa = persona_aggs.entry(row.persona_id.clone()).or_insert_with(|| PersonaAgg {
            persona_name: row.persona_name.clone(),
            total_cost: 0.0,
            total_executions: 0,
        });
        pa.total_cost += row.cost_usd;
        pa.total_executions += 1;
    }

    // Sort durations for percentile computation
    for bucket in date_buckets.values_mut() {
        bucket.durations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    }

    // Build sorted date keys
    let mut dates: Vec<String> = date_buckets.keys().cloned().collect();
    dates.sort();

    // Build daily points
    let daily_points: Vec<DashboardDailyPoint> = dates
        .iter()
        .map(|date| {
            let bucket = date_buckets.get_mut(date).unwrap();

            let persona_costs: Vec<PersonaCostEntry> = {
                let mut entries: Vec<PersonaCostEntry> = bucket.persona_costs.drain()
                    .map(|(pid, (name, cost))| PersonaCostEntry {
                        persona_id: pid,
                        persona_name: name,
                        cost,
                    })
                    .collect();
                entries.sort_by(|a, b| b.cost.partial_cmp(&a.cost).unwrap_or(std::cmp::Ordering::Equal));
                entries
            };

            DashboardDailyPoint {
                date: date.clone(),
                total_cost: bucket.total_cost,
                total_executions: bucket.total,
                completed: bucket.completed,
                failed: bucket.failed,
                success_rate: if bucket.total > 0 { bucket.completed as f64 / bucket.total as f64 } else { 0.0 },
                p50_duration_ms: percentile(&bucket.durations, 50.0),
                p95_duration_ms: percentile(&bucket.durations, 95.0),
                p99_duration_ms: percentile(&bucket.durations, 99.0),
                total_tokens: bucket.total_tokens,
                persona_costs,
            }
        })
        .collect();

    // Top-5 costliest personas (from in-memory aggregation)
    let mut top_personas_vec: Vec<(&String, &PersonaAgg)> = persona_aggs.iter().collect();
    top_personas_vec.sort_by(|a, b| b.1.total_cost.partial_cmp(&a.1.total_cost).unwrap_or(std::cmp::Ordering::Equal));
    let top_personas: Vec<DashboardTopPersona> = top_personas_vec
        .into_iter()
        .take(5)
        .map(|(pid, pa)| DashboardTopPersona {
            persona_id: pid.clone(),
            persona_name: pa.persona_name.clone(),
            total_cost: pa.total_cost,
            total_executions: pa.total_executions,
            avg_cost_per_exec: if pa.total_executions > 0 { pa.total_cost / pa.total_executions as f64 } else { 0.0 },
        })
        .collect();

    // Cost anomaly detection (no N+1 queries — exec IDs already tracked per date)
    let window = 7usize;
    let mut cost_anomalies: Vec<DashboardCostAnomaly> = Vec::new();

    for i in 0..daily_points.len() {
        let start_idx = i.saturating_sub(window);
        let preceding_costs: Vec<f64> = (start_idx..i).map(|j| daily_points[j].total_cost).collect();
        if preceding_costs.len() < 3 {
            continue;
        }

        let n = preceding_costs.len() as f64;
        let mean = preceding_costs.iter().sum::<f64>() / n;
        let variance = preceding_costs.iter().map(|c| (c - mean).powi(2)).sum::<f64>() / n;
        let std_dev = variance.sqrt();

        if std_dev == 0.0 {
            continue;
        }

        let deviation_sigma = (daily_points[i].total_cost - mean) / std_dev;
        if deviation_sigma > 2.0 {
            let exec_ids = date_buckets
                .get(&daily_points[i].date)
                .map(|b| b.top_exec_ids.iter().map(|(id, _)| id.clone()).collect())
                .unwrap_or_default();

            cost_anomalies.push(DashboardCostAnomaly {
                date: daily_points[i].date.clone(),
                cost: daily_points[i].total_cost,
                moving_avg: mean,
                std_dev,
                deviation_sigma,
                execution_ids: exec_ids,
            });
        }
    }

    // Overall summary from in-memory aggregation
    let total_executions: i64 = daily_points.iter().map(|p| p.total_executions).sum();
    let total_cost: f64 = daily_points.iter().map(|p| p.total_cost).sum();
    let total_completed: i64 = daily_points.iter().map(|p| p.completed).sum();
    let total_failed: i64 = daily_points.iter().map(|p| p.failed).sum();
    let active_personas = top_personas.len() as i64;
    let overall_success_rate = if total_executions > 0 {
        total_completed as f64 / total_executions as f64
    } else {
        0.0
    };
    let total_duration: f64 = date_buckets.values().map(|b| b.sum_duration).sum();
    let avg_latency_ms = if total_executions > 0 {
        total_duration / total_executions as f64
    } else {
        0.0
    };

    use chrono::Datelike;
    let (projected_monthly_cost, burn_rate) = {
        let n_points = daily_points.len();
        if n_points >= 2 {
            let limit = n_points.min(7);
            let recent_points: Vec<f64> = daily_points.iter().skip(n_points - limit).map(|p| p.total_cost).collect();
            let n = recent_points.len() as f64;
            
            let sum_x = (0..recent_points.len()).map(|x| x as f64).sum::<f64>();
            let sum_y = recent_points.iter().sum::<f64>();
            let sum_xy = recent_points.iter().enumerate().map(|(x, &y)| x as f64 * y).sum::<f64>();
            let sum_x2 = (0..recent_points.len()).map(|x| (x as f64).powi(2)).sum::<f64>();

            let denominator = n * sum_x2 - sum_x * sum_x;
            let slope = if denominator != 0.0 {
                (n * sum_xy - sum_x * sum_y) / denominator
            } else {
                0.0
            };
            let intercept = (sum_y - slope * sum_x) / n;

            let current_burn_rate = (slope * (n - 1.0) + intercept).max(0.0);

            let now = chrono::Utc::now();
            let year = now.year();
            let month = now.month();
            let next_month = if month == 12 { 1 } else { month + 1 };
            let next_year = if month == 12 { year + 1 } else { year };
            
            let first_of_this = chrono::NaiveDate::from_ymd_opt(year, month, 1).unwrap();
            let first_of_next = chrono::NaiveDate::from_ymd_opt(next_year, next_month, 1).unwrap();
            let days_in_month = (first_of_next - first_of_this).num_days();
            let current_day = now.day() as i64;

            let current_month_prefix = format!("{:04}-{:02}", year, month);
            let spent_this_month: f64 = daily_points.iter()
                .filter(|p| p.date.starts_with(&current_month_prefix))
                .map(|p| p.total_cost)
                .sum();

            let remaining_days = days_in_month - current_day;
            let mut projected_remaining = 0.0;
            for i in 1..=remaining_days {
                let x_future = (n - 1.0) + i as f64;
                let daily_proj = (slope * x_future + intercept).max(0.0);
                projected_remaining += daily_proj;
            }

            (Some(spent_this_month + projected_remaining), Some(current_burn_rate))
        } else {
            (None, None)
        }
    };

    info!(
        duration_ms = start.elapsed().as_millis() as u64,
        daily_buckets = daily_points.len(),
        top_personas = top_personas.len(),
        cost_anomalies = cost_anomalies.len(),
        total_executions,
        total_cost,
        "get_execution_dashboard completed"
    );

    Ok(ExecutionDashboardData {
        daily_points,
        top_personas,
        cost_anomalies,
        total_executions,
        successful_executions: total_completed,
        failed_executions: total_failed,
        total_cost,
        overall_success_rate,
        avg_latency_ms,
        active_personas,
        projected_monthly_cost,
        burn_rate,
    })
}

// =============================================================================
// Anomaly Drill-Down: Cross-reference anomaly with correlated events
// =============================================================================

/// Given an anomaly date, metric, value, and baseline, query prompt versions,
/// credential rotations, healing issues, and fired alerts within ±1 day and
/// return correlated events ranked by relevance plus root-cause suggestions.
#[instrument(skip(pool), fields(anomaly_date, persona_id))]
pub fn get_anomaly_drilldown(
    pool: &DbPool,
    anomaly_date: &str,
    anomaly_metric: &str,
    anomaly_value: f64,
    anomaly_baseline: f64,
    anomaly_deviation_pct: f64,
    persona_id: Option<&str>,
) -> Result<AnomalyDrilldownData, AppError> {
    let start = std::time::Instant::now();
    let conn = pool.get()?;

    // Parse the anomaly date as midday UTC so ±1 day window is clean
    let anomaly_dt = chrono::NaiveDate::parse_from_str(anomaly_date, "%Y-%m-%d")
        .map_err(|e| AppError::Validation(format!("Invalid anomaly_date: {e}")))?
        .and_hms_opt(12, 0, 0)
        .unwrap();
    let window_start = (anomaly_dt - chrono::Duration::days(1)).format("%Y-%m-%dT00:00:00").to_string();
    let window_end = (anomaly_dt + chrono::Duration::days(1)).format("%Y-%m-%dT23:59:59").to_string();

    let mut correlated: Vec<CorrelatedEvent> = Vec::new();

    // 1. Prompt version deployments in window
    {
        let query = if persona_id.is_some() {
            "SELECT id, persona_id, version_number, tag, created_at, change_summary
             FROM persona_prompt_versions
             WHERE created_at BETWEEN ?1 AND ?2 AND persona_id = ?3
             ORDER BY created_at"
        } else {
            "SELECT id, persona_id, version_number, tag, created_at, change_summary
             FROM persona_prompt_versions
             WHERE created_at BETWEEN ?1 AND ?2
             ORDER BY created_at"
        };
        let mut stmt = conn.prepare(query)?;
        let rows: Vec<(String, String, i32, String, String, Option<String>)> = if let Some(pid) = persona_id {
            stmt.query_map(params![&window_start, &window_end, pid], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
            })?.collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map(params![&window_start, &window_end], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
            })?.collect::<Result<Vec<_>, _>>()?
        };
        for (_id, pid, ver_num, tag, created_at, summary) in rows {
            let offset = compute_offset_seconds(&created_at, &anomaly_dt);
            let relevance = compute_relevance(offset, persona_id.is_some());
            correlated.push(CorrelatedEvent {
                timestamp: created_at,
                event_type: "prompt_deployment".into(),
                label: format!("Prompt v{ver_num} ({tag})"),
                detail: summary,
                persona_id: Some(pid),
                offset_seconds: offset,
                relevance,
            });
        }
    }

    // 2. Credential rotations in window
    {
        let mut stmt = conn.prepare(
            "SELECT r.id, r.credential_id, c.name, r.rotation_type, r.status, r.detail, r.created_at
             FROM credential_rotation_history r
             LEFT JOIN credentials c ON c.id = r.credential_id
             WHERE r.created_at BETWEEN ?1 AND ?2
             ORDER BY r.created_at"
        )?;
        let rows: Vec<(String, String, Option<String>, String, String, Option<String>, String)> = stmt
            .query_map(params![&window_start, &window_end], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (_id, _cred_id, cred_name, rot_type, status, detail, created_at) in rows {
            let offset = compute_offset_seconds(&created_at, &anomaly_dt);
            let relevance = compute_relevance(offset, false);
            let name_part = cred_name.as_deref().unwrap_or("unknown");
            correlated.push(CorrelatedEvent {
                timestamp: created_at,
                event_type: "credential_rotation".into(),
                label: format!("Rotation {status} · {name_part} ({rot_type})"),
                detail,
                persona_id: None,
                offset_seconds: offset,
                relevance,
            });
        }
    }

    // 3. Healing issues in window
    {
        let query = if persona_id.is_some() {
            "SELECT id, persona_id, title, description, is_circuit_breaker, severity, category, created_at
             FROM persona_healing_issues
             WHERE created_at BETWEEN ?1 AND ?2 AND persona_id = ?3
             ORDER BY created_at"
        } else {
            "SELECT id, persona_id, title, description, is_circuit_breaker, severity, category, created_at
             FROM persona_healing_issues
             WHERE created_at BETWEEN ?1 AND ?2
             ORDER BY created_at"
        };
        let mut stmt = conn.prepare(query)?;
        let rows: Vec<(String, String, String, String, bool, String, String, String)> = if let Some(pid) = persona_id {
            stmt.query_map(params![&window_start, &window_end, pid], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))
            })?.collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map(params![&window_start, &window_end], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))
            })?.collect::<Result<Vec<_>, _>>()?
        };
        for (_id, pid, title, desc, is_cb, severity, category, created_at) in rows {
            let offset = compute_offset_seconds(&created_at, &anomaly_dt);
            let mut relevance = compute_relevance(offset, persona_id.is_some());
            if is_cb { relevance = (relevance + 0.2).min(1.0); }
            let etype = if is_cb { "circuit_breaker" } else { "healing_issue" };
            correlated.push(CorrelatedEvent {
                timestamp: created_at,
                event_type: etype.into(),
                label: title,
                detail: Some(format!("[{severity}/{category}] {desc}")),
                persona_id: Some(pid),
                offset_seconds: offset,
                relevance,
            });
        }
    }

    // 4. Fired alerts in window
    {
        let mut stmt = conn.prepare(
            "SELECT id, rule_name, metric, severity, message, fired_at
             FROM fired_alerts
             WHERE fired_at BETWEEN ?1 AND ?2
             ORDER BY fired_at"
        )?;
        let rows: Vec<(String, String, String, String, String, String)> = stmt
            .query_map(params![&window_start, &window_end], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (_id, rule_name, metric, severity, message, fired_at) in rows {
            let offset = compute_offset_seconds(&fired_at, &anomaly_dt);
            let mut relevance = compute_relevance(offset, false);
            // Boost relevance if alert metric matches anomaly metric
            if metric == anomaly_metric { relevance = (relevance + 0.3).min(1.0); }
            correlated.push(CorrelatedEvent {
                timestamp: fired_at,
                event_type: "alert".into(),
                label: format!("Alert: {rule_name} [{severity}]"),
                detail: Some(message),
                persona_id: None,
                offset_seconds: offset,
                relevance,
            });
        }
    }

    // Sort by relevance descending
    correlated.sort_by(|a, b| b.relevance.partial_cmp(&a.relevance).unwrap_or(std::cmp::Ordering::Equal));

    // Generate root cause suggestions from top correlated events
    let suggestions = generate_root_cause_suggestions(&correlated, anomaly_metric, anomaly_deviation_pct);

    info!(
        duration_ms = start.elapsed().as_millis() as u64,
        correlated_events = correlated.len(),
        suggestions = suggestions.len(),
        "get_anomaly_drilldown completed"
    );

    Ok(AnomalyDrilldownData {
        anomaly_date: anomaly_date.to_string(),
        anomaly_metric: anomaly_metric.to_string(),
        anomaly_value,
        anomaly_baseline,
        anomaly_deviation_pct,
        correlated_events: correlated,
        root_cause_suggestions: suggestions,
    })
}

/// Compute signed offset in seconds between a timestamp string and the anomaly midpoint.
fn compute_offset_seconds(timestamp: &str, anomaly_midpoint: &chrono::NaiveDateTime) -> f64 {
    if let Ok(ts) = chrono::NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%dT%H:%M:%S%.f") {
        (ts - *anomaly_midpoint).num_seconds() as f64
    } else if let Ok(ts) = chrono::NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%dT%H:%M:%S") {
        (ts - *anomaly_midpoint).num_seconds() as f64
    } else if let Ok(d) = chrono::NaiveDate::parse_from_str(timestamp, "%Y-%m-%d") {
        let dt = d.and_hms_opt(12, 0, 0).unwrap();
        (dt - *anomaly_midpoint).num_seconds() as f64
    } else {
        // Fallback: try chrono's DateTime parser for RFC-3339
        timestamp.parse::<chrono::DateTime<chrono::Utc>>()
            .map(|dt| (dt.naive_utc() - *anomaly_midpoint).num_seconds() as f64)
            .unwrap_or(86400.0) // push to edge if unparseable
    }
}

/// Compute a 0.0–1.0 relevance score based on temporal proximity and persona match.
fn compute_relevance(offset_seconds: f64, persona_matched: bool) -> f64 {
    let abs_offset = offset_seconds.abs();
    // Decay: events within 1h get ~1.0, events at 24h get ~0.15
    let time_score = (-abs_offset / 28800.0).exp(); // 8-hour half-life
    let persona_boost = if persona_matched { 0.15 } else { 0.0 };
    (time_score + persona_boost).min(1.0)
}

/// Generate ranked root-cause suggestions from the correlated events.
fn generate_root_cause_suggestions(
    events: &[CorrelatedEvent],
    anomaly_metric: &str,
    deviation_pct: f64,
) -> Vec<RootCauseSuggestion> {
    let mut suggestions: Vec<RootCauseSuggestion> = Vec::new();

    // Group by event_type and pick the highest-relevance event per type
    let mut best_by_type: std::collections::HashMap<&str, &CorrelatedEvent> = std::collections::HashMap::new();
    for event in events {
        let entry = best_by_type.entry(event.event_type.as_str()).or_insert(event);
        if event.relevance > entry.relevance {
            *entry = event;
        }
    }

    // Prompt deployment → likely root cause for any metric
    if let Some(ev) = best_by_type.get("prompt_deployment") {
        let confidence = (ev.relevance * 0.9).min(0.95);
        suggestions.push(RootCauseSuggestion {
            rank: 0,
            title: "Prompt version change".into(),
            description: format!(
                "\"{}\" was deployed {:.0}s {} the anomaly. Prompt changes can affect {anomaly_metric} \
                 by altering token usage, error rates, or model behavior.",
                ev.label,
                ev.offset_seconds.abs(),
                if ev.offset_seconds < 0.0 { "before" } else { "after" },
            ),
            confidence,
            event_type: "prompt_deployment".into(),
            related_event_timestamp: Some(ev.timestamp.clone()),
        });
    }

    // Credential rotation → likely cause of errors or latency
    if let Some(ev) = best_by_type.get("credential_rotation") {
        let metric_relevance = match anomaly_metric {
            "error_rate" => 0.95,
            "latency" => 0.7,
            _ => 0.5,
        };
        let confidence = (ev.relevance * metric_relevance).min(0.95);
        suggestions.push(RootCauseSuggestion {
            rank: 0,
            title: "Credential rotation".into(),
            description: format!(
                "\"{}\" occurred {:.0}s {} the anomaly. Failed or in-progress rotations \
                 can cause authentication errors and increased latency.",
                ev.label,
                ev.offset_seconds.abs(),
                if ev.offset_seconds < 0.0 { "before" } else { "after" },
            ),
            confidence,
            event_type: "credential_rotation".into(),
            related_event_timestamp: Some(ev.timestamp.clone()),
        });
    }

    // Circuit breaker → strong signal for error_rate spikes
    if let Some(ev) = best_by_type.get("circuit_breaker") {
        let confidence = (ev.relevance * 0.95).min(0.95);
        suggestions.push(RootCauseSuggestion {
            rank: 0,
            title: "Circuit breaker tripped".into(),
            description: format!(
                "\"{}\" triggered {:.0}s {} the anomaly. Circuit breakers indicate \
                 sustained failures that directly cause {anomaly_metric} degradation.",
                ev.label,
                ev.offset_seconds.abs(),
                if ev.offset_seconds < 0.0 { "before" } else { "after" },
            ),
            confidence,
            event_type: "circuit_breaker".into(),
            related_event_timestamp: Some(ev.timestamp.clone()),
        });
    }

    // Healing issue (non-circuit-breaker)
    if let Some(ev) = best_by_type.get("healing_issue") {
        let confidence = (ev.relevance * 0.7).min(0.85);
        suggestions.push(RootCauseSuggestion {
            rank: 0,
            title: "Self-healing event".into(),
            description: format!(
                "\"{}\" was detected {:.0}s {} the anomaly. The healing system \
                 identified an issue that may have contributed to the {anomaly_metric} spike ({deviation_pct:.0}% deviation).",
                ev.label,
                ev.offset_seconds.abs(),
                if ev.offset_seconds < 0.0 { "before" } else { "after" },
            ),
            confidence,
            event_type: "healing_issue".into(),
            related_event_timestamp: Some(ev.timestamp.clone()),
        });
    }

    // Alert
    if let Some(ev) = best_by_type.get("alert") {
        let confidence = (ev.relevance * 0.6).min(0.8);
        suggestions.push(RootCauseSuggestion {
            rank: 0,
            title: "Alert fired".into(),
            description: format!(
                "\"{}\" fired {:.0}s {} the anomaly, confirming the system was under stress.",
                ev.label,
                ev.offset_seconds.abs(),
                if ev.offset_seconds < 0.0 { "before" } else { "after" },
            ),
            confidence,
            event_type: "alert".into(),
            related_event_timestamp: Some(ev.timestamp.clone()),
        });
    }

    // If no correlated events were found, suggest external factors
    if suggestions.is_empty() {
        suggestions.push(RootCauseSuggestion {
            rank: 1,
            title: "No correlated internal events".into(),
            description: format!(
                "No prompt deployments, credential rotations, healing events, or alerts were found \
                 within ±24h of this {anomaly_metric} anomaly ({deviation_pct:.0}% deviation). \
                 Consider external factors: API provider degradation, upstream data changes, or traffic spikes."
            ),
            confidence: 0.3,
            event_type: "external".into(),
            related_event_timestamp: None,
        });
    }

    // Sort by confidence descending and assign ranks
    suggestions.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    for (i, s) in suggestions.iter_mut().enumerate() {
        s.rank = (i + 1) as i32;
    }

    suggestions
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_prompt_version_auto_increment() {
        let pool = init_test_db().unwrap();

        let v1 = create_prompt_version(
            &pool,
            "persona-1",
            None,
            Some("You are v1.".into()),
            Some("Initial version".into()),
        )
        .unwrap();
        assert_eq!(v1.version_number, 1);

        let v2 = create_prompt_version(
            &pool,
            "persona-1",
            None,
            Some("You are v2.".into()),
            Some("Updated prompt".into()),
        )
        .unwrap();
        assert_eq!(v2.version_number, 2);

        // Different persona starts at 1
        let other = create_prompt_version(
            &pool,
            "persona-2",
            Some("structured".into()),
            None,
            None,
        )
        .unwrap();
        assert_eq!(other.version_number, 1);

        // List versions for persona-1
        let versions = get_prompt_versions(&pool, "persona-1", None).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].version_number, 2); // DESC order
        assert_eq!(versions[1].version_number, 1);
    }

    #[test]
    fn test_summary() {
        let pool = init_test_db().unwrap();

        // Summary with no executions
        let summary = get_summary(&pool, Some(30), None).unwrap();
        assert_eq!(summary["total_executions"], 0);
        assert_eq!(summary["active_personas"], 0);
    }
}
