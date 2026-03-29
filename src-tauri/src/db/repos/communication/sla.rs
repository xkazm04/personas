use std::collections::HashMap;

use rusqlite::params;

use crate::db::models::{
    GlobalSlaStats, HealingSummary, PersonaSlaStats, SlaDailyPoint, SlaDashboardData,
};
use crate::db::query_builder::QueryBuilder;
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Batch query helper
// ============================================================================

/// Execute a dynamic `IN (...)` query against a list of persona IDs and collect
/// results into a `HashMap` keyed by persona_id.
///
/// `sql_template` must contain `{placeholders}` (replaced with `?1, ?2, ...`)
/// and `{date_param}` (replaced with `?N` where N = persona_ids.len() + 1).
///
/// `row_mapper` converts each row into a `(persona_id, V)` pair.
///
/// If `date_filter` is `None`, the `{date_param}` placeholder is still replaced
/// but no extra parameter is appended — use this for queries that don't need a
/// date filter.
fn batch_query_map<V>(
    conn: &rusqlite::Connection,
    sql_template: &str,
    persona_ids: &[&str],
    date_filter: Option<&str>,
    row_mapper: fn(&rusqlite::Row) -> rusqlite::Result<(String, V)>,
) -> Result<HashMap<String, V>, AppError> {
    if persona_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut qb = QueryBuilder::new();
    let placeholders: Vec<String> = persona_ids
        .iter()
        .map(|s| qb.push_param(s.to_string()))
        .collect();
    let date_ph = if let Some(df) = date_filter {
        qb.push_param(df.to_string())
    } else {
        // No date filter — use a placeholder index that won't be referenced
        format!("?{}", qb.param_count() + 1)
    };

    let sql = sql_template
        .replace("{placeholders}", &placeholders.join(", "))
        .replace("{date_param}", &date_ph);

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(qb.params_ref().as_slice(), row_mapper)?;

    let mut map = HashMap::new();
    for r in rows {
        let (key, val) = r?;
        map.insert(key, val);
    }
    Ok(map)
}

/// Like `batch_query_map` but collects multiple values per key into a `Vec`.
fn batch_query_map_vec<V>(
    conn: &rusqlite::Connection,
    sql_template: &str,
    persona_ids: &[&str],
    date_filter: Option<&str>,
    row_mapper: fn(&rusqlite::Row) -> rusqlite::Result<(String, V)>,
) -> Result<HashMap<String, Vec<V>>, AppError> {
    if persona_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut qb = QueryBuilder::new();
    let placeholders: Vec<String> = persona_ids
        .iter()
        .map(|s| qb.push_param(s.to_string()))
        .collect();
    let date_ph = if let Some(df) = date_filter {
        qb.push_param(df.to_string())
    } else {
        // No date filter — use a placeholder index that won't be referenced
        format!("?{}", qb.param_count() + 1)
    };

    let sql = sql_template
        .replace("{placeholders}", &placeholders.join(", "))
        .replace("{date_param}", &date_ph);

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(qb.params_ref().as_slice(), row_mapper)?;

    let mut map: HashMap<String, Vec<V>> = HashMap::new();
    for r in rows {
        let (key, val) = r?;
        map.entry(key).or_default().push(val);
    }
    Ok(map)
}

// ============================================================================
// Internal row struct for the initial per-persona aggregate query
// ============================================================================

struct RawPersona {
    persona_id: String,
    persona_name: String,
    total: i64,
    successful: i64,
    failed: i64,
    cancelled: i64,
    avg_dur: f64,
    total_cost: f64,
}

// ============================================================================
// Public query API
// ============================================================================

/// Load full SLA dashboard data for the given time window.
pub fn get_sla_dashboard(pool: &DbPool, days: i64) -> Result<SlaDashboardData, AppError> {
    timed_query!("sla", "sla::get_sla_dashboard", {
        let conn = pool.get()?;
        let date_filter = format!("-{} days", days);

        // -- Per-persona aggregates ------------------------------------------
        let mut stmt = conn.prepare(
            "SELECT
                e.persona_id,
                COALESCE(p.name, 'Unknown') AS persona_name,
                COUNT(*) AS total,
                SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS successful,
                SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN e.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
                AVG(CASE WHEN e.duration_ms IS NOT NULL THEN e.duration_ms ELSE NULL END) AS avg_dur,
                COALESCE(SUM(e.cost_usd), 0.0) AS total_cost
             FROM persona_executions e
             LEFT JOIN personas p ON p.id = e.persona_id
             WHERE e.created_at >= datetime('now', ?1)
               AND e.status IN ('completed', 'failed', 'cancelled')
             GROUP BY e.persona_id
             ORDER BY total DESC",
        )?;

        let raw_personas: Vec<RawPersona> = stmt
            .query_map(params![date_filter], |row| {
                Ok(RawPersona {
                    persona_id: row.get(0)?,
                    persona_name: row.get(1)?,
                    total: row.get(2)?,
                    successful: row.get(3)?,
                    failed: row.get(4)?,
                    cancelled: row.get(5)?,
                    avg_dur: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                    total_cost: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let persona_ids: Vec<&str> = raw_personas.iter().map(|rp| rp.persona_id.as_str()).collect();

        // -- Batch P95 durations ---------------------------------------------
        let durations_map = batch_query_map_vec(
            &conn,
            "SELECT persona_id, duration_ms FROM persona_executions
             WHERE persona_id IN ({placeholders})
               AND created_at >= datetime('now', {date_param})
               AND status IN ('completed', 'failed')
               AND duration_ms IS NOT NULL
             ORDER BY persona_id, duration_ms ASC",
            &persona_ids,
            Some(&date_filter),
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)),
        )?;

        // -- Batch MTBF: failure timestamps ----------------------------------
        let fail_ts_map = batch_query_map_vec(
            &conn,
            "SELECT persona_id, created_at FROM persona_executions
             WHERE persona_id IN ({placeholders})
               AND created_at >= datetime('now', {date_param})
               AND status = 'failed'
             ORDER BY persona_id, created_at ASC",
            &persona_ids,
            Some(&date_filter),
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;

        // -- Batch consecutive failures --------------------------------------
        let consec_map = {
            let statuses_map = batch_query_map_vec(
                &conn,
                "SELECT persona_id, status FROM (
                    SELECT persona_id, status,
                           ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY created_at DESC) AS rn
                    FROM persona_executions
                    WHERE persona_id IN ({placeholders})
                 ) WHERE rn <= 20
                 ORDER BY persona_id, rn ASC",
                &persona_ids,
                None,
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )?;
            statuses_map
                .into_iter()
                .map(|(pid, statuses)| {
                    let count = statuses.iter().take_while(|s| s.as_str() == "failed").count() as i64;
                    (pid, count)
                })
                .collect::<HashMap<String, i64>>()
        };

        // -- Batch auto-healed count -----------------------------------------
        let healed_map = batch_query_map(
            &conn,
            "SELECT persona_id, COUNT(*) FROM persona_healing_issues
             WHERE persona_id IN ({placeholders}) AND auto_fixed = 1
             GROUP BY persona_id",
            &persona_ids,
            None,
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )?;

        // -- Assemble per-persona stats --------------------------------------
        let mut persona_stats: Vec<PersonaSlaStats> = Vec::new();

        for rp in &raw_personas {
            let p95 = percentile(
                durations_map.get(&rp.persona_id).map(|v| v.as_slice()).unwrap_or(&[]),
                95.0,
            );
            let mtbf = compute_mtbf(
                fail_ts_map.get(&rp.persona_id).map(|v| v.as_slice()).unwrap_or(&[]),
            );
            let consecutive_failures = consec_map.get(&rp.persona_id).copied().unwrap_or(0);
            let auto_healed = healed_map.get(&rp.persona_id).copied().unwrap_or(0);

            let decided = rp.successful + rp.failed;
            let success_rate = if decided > 0 {
                rp.successful as f64 / decided as f64
            } else {
                0.0
            };

            persona_stats.push(PersonaSlaStats {
                persona_id: rp.persona_id.clone(),
                persona_name: rp.persona_name.clone(),
                total_executions: rp.total,
                successful: rp.successful,
                failed: rp.failed,
                cancelled: rp.cancelled,
                success_rate,
                avg_duration_ms: rp.avg_dur,
                p95_duration_ms: p95,
                total_cost_usd: rp.total_cost,
                mtbf_seconds: mtbf,
                consecutive_failures,
                auto_healed_count: auto_healed,
            });
        }

        // -- Global aggregates -----------------------------------------------
        let g_total: i64 = persona_stats.iter().map(|p| p.total_executions).sum();
        let g_success: i64 = persona_stats.iter().map(|p| p.successful).sum();
        let g_failed: i64 = persona_stats.iter().map(|p| p.failed).sum();
        let g_cancelled: i64 = persona_stats.iter().map(|p| p.cancelled).sum();
        let g_cost: f64 = persona_stats.iter().map(|p| p.total_cost_usd).sum();
        let g_avg_dur = if g_total > 0 {
            persona_stats
                .iter()
                .map(|p| p.avg_duration_ms * p.total_executions as f64)
                .sum::<f64>()
                / g_total as f64
        } else {
            0.0
        };
        let g_decided = g_success + g_failed;

        let global = GlobalSlaStats {
            total_executions: g_total,
            successful: g_success,
            failed: g_failed,
            cancelled: g_cancelled,
            success_rate: if g_decided > 0 { g_success as f64 / g_decided as f64 } else { 0.0 },
            avg_duration_ms: g_avg_dur,
            total_cost_usd: g_cost,
            active_persona_count: persona_stats.len() as i64,
        };

        // -- Healing summary -------------------------------------------------
        let healing_summary: HealingSummary = conn
            .query_row(
                "SELECT
                    SUM(CASE WHEN h.status = 'open' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN h.auto_fixed = 1 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN h.is_circuit_breaker = 1 AND h.status = 'open' THEN 1 ELSE 0 END),
                    (SELECT COUNT(*) FROM healing_knowledge)
                 FROM persona_healing_issues h",
                [],
                |row| {
                    Ok(HealingSummary {
                        open_issues: row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                        auto_fixed_count: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                        circuit_breaker_count: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                        knowledge_patterns: row.get(3)?,
                    })
                },
            )
            .unwrap_or(HealingSummary {
                open_issues: 0,
                auto_fixed_count: 0,
                circuit_breaker_count: 0,
                knowledge_patterns: 0,
            });

        // -- Daily trend -----------------------------------------------------
        let mut daily_stmt = conn.prepare(
            "SELECT
                DATE(created_at) AS date,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successful,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
             FROM persona_executions
             WHERE created_at >= datetime('now', ?1)
               AND status IN ('completed', 'failed', 'cancelled')
             GROUP BY DATE(created_at)
             ORDER BY date ASC",
        )?;

        let daily_trend: Vec<SlaDailyPoint> = daily_stmt
            .query_map(params![date_filter], |row| {
                let successful: i64 = row.get(2)?;
                let failed: i64 = row.get(3)?;
                let cancelled: i64 = row.get(4)?;
                let decided = successful + failed;
                Ok(SlaDailyPoint {
                    date: row.get(0)?,
                    total: row.get(1)?,
                    successful,
                    failed,
                    cancelled,
                    success_rate: if decided > 0 {
                        successful as f64 / decided as f64
                    } else {
                        0.0
                    },
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(SlaDashboardData {
            persona_stats,
            global,
            healing_summary,
            daily_trend,
        })
    })
}

// ============================================================================
// Helpers
// ============================================================================

fn percentile(values: &[f64], p: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = (p / 100.0 * (sorted.len() as f64 - 1.0)).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

/// Compute mean time between failures from sorted timestamps.
fn compute_mtbf(timestamps: &[String]) -> Option<f64> {
    if timestamps.len() < 2 {
        return None;
    }

    let parsed: Vec<chrono::NaiveDateTime> = timestamps
        .iter()
        .filter_map(|ts| {
            chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%.f")
                .or_else(|_| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S"))
                .ok()
        })
        .collect();

    if parsed.len() < 2 {
        return None;
    }

    let first = *parsed.first()?;
    let last = *parsed.last()?;
    let total_span = (last - first).num_seconds() as f64;
    let gaps = (parsed.len() - 1) as f64;
    Some(total_span / gaps)
}
