use std::collections::HashMap;
use rusqlite::{params, Row};

use crate::db::models::{
    MetricsChartData, MetricsChartPoint, MetricsPersonaBreakdown,
    PersonaPromptVersion, PromptPerformanceData, PromptPerformancePoint,
    VersionMarker, MetricAnomaly,
    DashboardDailyPoint, DashboardCostAnomaly, DashboardTopPersona,
    ExecutionDashboardData, PersonaCostEntry,
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
    })
}

// ============================================================================
// Prompt Versions
// ============================================================================

pub fn create_prompt_version(
    pool: &DbPool,
    persona_id: &str,
    structured_prompt: Option<String>,
    system_prompt: Option<String>,
    change_summary: Option<String>,
) -> Result<PersonaPromptVersion, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let tag = "experimental".to_string();

    let conn = pool.get()?;

    // Auto-compute version_number as MAX + 1
    let version_number: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM persona_prompt_versions WHERE persona_id = ?1",
            params![persona_id],
            |row| row.get(0),
        )?;

    conn.execute(
        "INSERT INTO persona_prompt_versions
         (id, persona_id, version_number, structured_prompt, system_prompt, change_summary, tag, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            persona_id,
            version_number,
            structured_prompt,
            system_prompt,
            change_summary,
            tag,
            now,
        ],
    )?;

    Ok(PersonaPromptVersion {
        id,
        persona_id: persona_id.to_string(),
        version_number,
        structured_prompt,
        system_prompt,
        change_summary,
        tag,
        created_at: now,
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
        "SELECT COUNT(*), SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END)
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

pub fn get_summary(pool: &DbPool, days: Option<i64>, persona_id: Option<&str>) -> Result<serde_json::Value, AppError> {
    let days = days.unwrap_or(30);
    let conn = pool.get()?;
    let (pid_clause, param_values) = persona_filter_params(format!("-{} days", days), persona_id);

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

    Ok(serde_json::json!({
        "total_executions": row.0,
        "successful_executions": row.1,
        "failed_executions": row.2,
        "total_cost_usd": row.3,
        "active_personas": row.4,
        "period_days": days,
    }))
}

// ============================================================================
// Pre-bucketed chart data (aggregated in SQL, replaces frontend pivot logic)
// ============================================================================

/// Returns chart-ready time-series and per-persona breakdown in a single call.
/// The SQL GROUP BY produces the same result as the ~30 lines of client-side
/// Map-based aggregation that previously ran in ObservabilityDashboard.
pub fn get_chart_data(
    pool: &DbPool,
    days: Option<i64>,
    persona_id: Option<&str>,
) -> Result<MetricsChartData, AppError> {
    let days = days.unwrap_or(30);
    let conn = pool.get()?;
    let (pid_clause, param_values) = persona_filter_params(format!("-{} days", days), persona_id);

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

    Ok(MetricsChartData {
        chart_points,
        persona_breakdown,
    })
}

// ============================================================================
// Prompt Performance Dashboard — aggregated metrics for a single persona
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
pub fn get_prompt_performance(
    pool: &DbPool,
    persona_id: &str,
    days: i64,
) -> Result<PromptPerformanceData, AppError> {
    let conn = pool.get()?;
    let date_filter = format!("-{} days", days);

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

    Ok(PromptPerformanceData {
        daily_points,
        version_markers,
        anomalies,
    })
}

// ============================================================================
// Execution Metrics Dashboard — aggregated cross-persona dashboard data
// ============================================================================

/// Raw row for dashboard aggregation (fetched per-execution for percentile computation).
struct DashboardRawRow {
    date: String,
    persona_id: String,
    persona_name: String,
    duration_ms: f64,
    cost_usd: f64,
    status: String,
    exec_id: String,
}

/// Returns aggregated dashboard data across all personas for the last N days.
/// Includes daily time-series with per-persona cost breakdown, latency percentiles,
/// top-5 costliest personas, and cost anomaly detection.
pub fn get_execution_dashboard(
    pool: &DbPool,
    days: i64,
) -> Result<ExecutionDashboardData, AppError> {
    let conn = pool.get()?;
    let date_filter = format!("-{} days", days);

    // 1) Fetch raw execution rows with persona names
    let mut stmt = conn.prepare(
        "SELECT
            DATE(e.created_at) as date,
            e.persona_id,
            COALESCE(p.name, 'Unknown') as persona_name,
            COALESCE(e.duration_ms, 0) as duration_ms,
            COALESCE(e.cost_usd, 0.0) as cost_usd,
            e.status,
            e.id
         FROM persona_executions e
         LEFT JOIN personas p ON p.id = e.persona_id
         WHERE e.created_at >= datetime('now', ?1)
           AND e.status IN ('completed', 'failed')
         ORDER BY date ASC, e.cost_usd DESC",
    )?;
    let rows: Vec<DashboardRawRow> = stmt
        .query_map(params![date_filter], |row| {
            Ok(DashboardRawRow {
                date: row.get(0)?,
                persona_id: row.get(1)?,
                persona_name: row.get(2)?,
                duration_ms: row.get(3)?,
                cost_usd: row.get(4)?,
                status: row.get(5)?,
                exec_id: row.get(6)?,
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
            total_cost: 0.0,
            overall_success_rate: 0.0,
            avg_latency_ms: 0.0,
        });
    }

    // 2) Bucket by date
    let mut date_buckets: HashMap<String, Vec<&DashboardRawRow>> = HashMap::new();
    for row in &rows {
        date_buckets.entry(row.date.clone()).or_default().push(row);
    }

    let mut dates: Vec<String> = date_buckets.keys().cloned().collect();
    dates.sort();

    // 3) Build daily points
    let daily_points: Vec<DashboardDailyPoint> = dates
        .iter()
        .map(|date| {
            let bucket = &date_buckets[date];
            let completed = bucket.iter().filter(|r| r.status == "completed").count() as i64;
            let failed = bucket.iter().filter(|r| r.status == "failed").count() as i64;
            let total = completed + failed;
            let total_cost: f64 = bucket.iter().map(|r| r.cost_usd).sum();

            let mut durations: Vec<f64> = bucket.iter().map(|r| r.duration_ms).collect();
            durations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

            // Per-persona cost breakdown for this date
            let mut persona_map: HashMap<String, (String, f64)> = HashMap::new();
            for r in bucket {
                let entry = persona_map
                    .entry(r.persona_id.clone())
                    .or_insert_with(|| (r.persona_name.clone(), 0.0));
                entry.1 += r.cost_usd;
            }
            let mut persona_costs: Vec<PersonaCostEntry> = persona_map
                .into_iter()
                .map(|(pid, (name, cost))| PersonaCostEntry {
                    persona_id: pid,
                    persona_name: name,
                    cost,
                })
                .collect();
            persona_costs.sort_by(|a, b| b.cost.partial_cmp(&a.cost).unwrap_or(std::cmp::Ordering::Equal));

            DashboardDailyPoint {
                date: date.clone(),
                total_cost,
                total_executions: total,
                completed,
                failed,
                success_rate: if total > 0 { completed as f64 / total as f64 } else { 0.0 },
                p50_duration_ms: percentile(&durations, 50.0),
                p95_duration_ms: percentile(&durations, 95.0),
                p99_duration_ms: percentile(&durations, 99.0),
                persona_costs,
            }
        })
        .collect();

    // 4) Top-5 costliest personas
    let mut persona_totals: HashMap<String, (String, f64, i64)> = HashMap::new();
    for row in &rows {
        let entry = persona_totals
            .entry(row.persona_id.clone())
            .or_insert_with(|| (row.persona_name.clone(), 0.0, 0));
        entry.1 += row.cost_usd;
        entry.2 += 1;
    }
    let mut top_personas: Vec<DashboardTopPersona> = persona_totals
        .into_iter()
        .map(|(pid, (name, cost, count))| DashboardTopPersona {
            persona_id: pid,
            persona_name: name,
            total_cost: cost,
            total_executions: count,
            avg_cost_per_exec: if count > 0 { cost / count as f64 } else { 0.0 },
        })
        .collect();
    top_personas.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap_or(std::cmp::Ordering::Equal));
    top_personas.truncate(5);

    // 5) Cost anomaly detection: flag days where cost > moving_avg + 2*std_dev
    let window = 7usize;
    let mut cost_anomalies: Vec<DashboardCostAnomaly> = Vec::new();

    for i in 0..daily_points.len() {
        let start = i.saturating_sub(window);
        let preceding_costs: Vec<f64> = (start..i).map(|j| daily_points[j].total_cost).collect();
        if preceding_costs.len() < 3 {
            continue; // Need at least 3 data points for meaningful stats
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
            // Find the costliest executions on this date
            let bucket = &date_buckets[&daily_points[i].date];
            let execution_ids: Vec<String> = bucket
                .iter()
                .take(5)
                .map(|r| r.exec_id.clone())
                .collect();

            cost_anomalies.push(DashboardCostAnomaly {
                date: daily_points[i].date.clone(),
                cost: daily_points[i].total_cost,
                moving_avg: mean,
                std_dev,
                deviation_sigma,
                execution_ids,
            });
        }
    }

    // 6) Overall summary
    let total_executions = rows.len() as i64;
    let total_cost: f64 = rows.iter().map(|r| r.cost_usd).sum();
    let total_completed = rows.iter().filter(|r| r.status == "completed").count() as i64;
    let overall_success_rate = if total_executions > 0 {
        total_completed as f64 / total_executions as f64
    } else {
        0.0
    };
    let avg_latency_ms = if total_executions > 0 {
        rows.iter().map(|r| r.duration_ms).sum::<f64>() / total_executions as f64
    } else {
        0.0
    };

    Ok(ExecutionDashboardData {
        daily_points,
        top_personas,
        cost_anomalies,
        total_executions,
        total_cost,
        overall_success_rate,
        avg_latency_ms,
    })
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
