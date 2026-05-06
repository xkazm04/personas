use std::collections::HashMap;

use rusqlite::params;

use crate::db::models::{
    GlobalSlaStats, HealingSummary, PersonaSlaStats, SlaDailyPoint, SlaDashboardData,
};
use crate::db::query_builder::QueryBuilder;
use crate::db::DbPool;
use crate::error::AppError;

/// Maximum number of recent executions inspected when computing a
/// persona's `consecutive_failures` streak.
///
/// The window is bounded for two reasons:
/// 1. **Cost** — scanning a persona's full history during the SLA
///    aggregate query (which fans out across every persona) becomes
///    quadratic at fleet scale.
/// 2. **Diminishing signal** — by the time a streak reaches ~20, the
///    circuit breaker has long since fired and any larger number has
///    the same operational meaning as 20: "this persona is broken".
///
/// The cap is observable: `PersonaSlaStats.consecutive_failure_lookback`
/// echoes this value to the frontend so the SLA card can render a
/// "{cap}+" boundary indicator when `consecutive_failures` equals the
/// cap, instead of misleading users into thinking the streak has
/// stopped at exactly 20.
pub const CONSECUTIVE_FAILURE_LOOKBACK: i64 = 20;

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
///
/// # Time-window policy
///
/// The `days` parameter applies **only** to per-execution metrics that are
/// derived from the `persona_executions` table:
///
/// - `persona_stats.*` (success/failure counts, p95, MTBF, cost, streaks)
/// - `global.*` (rolled up from `persona_stats`)
/// - `daily_trend` (one point per day inside the window)
///
/// The fields on `healing_summary` are intentionally **all-time / snapshot**
/// and ignore `days`:
///
/// - `open_issues` is the count of healing issues currently in the `open`
///   state. An issue that opened six months ago and is still open is still
///   broken now — clipping it to a 7-day window would hide active problems.
/// - `circuit_breaker_count` is the same: a circuit breaker that tripped
///   last quarter and is still open is still pausing executions today.
/// - `auto_fixed_count` is the cumulative number of issues the healing
///   engine has auto-resolved across the lifetime of the install. Treating
///   it as windowed would make the headline number jump around for a
///   reason that has nothing to do with current reliability.
/// - `knowledge_patterns` is the size of the `healing_knowledge` table —
///   a fleet-wide knowledge-base count with no execution-time meaning.
///
/// The frontend (`SLADashboard.tsx`) labels these four cards with an
/// "All-time" scope badge so users don't expect them to react to the
/// 7d/14d/30d/60d/90d selector. The contract is pinned by
/// `healing_summary_is_invariant_across_window` in this file's tests; do
/// not silently change the policy without updating both the badge and
/// the test.
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

        let persona_ids: Vec<&str> = raw_personas
            .iter()
            .map(|rp| rp.persona_id.as_str())
            .collect();

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
            let consec_sql = format!(
                "SELECT persona_id, status FROM (
                    SELECT persona_id, status,
                           ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY created_at DESC) AS rn
                    FROM persona_executions
                    WHERE persona_id IN ({{placeholders}})
                 ) WHERE rn <= {}
                 ORDER BY persona_id, rn ASC",
                CONSECUTIVE_FAILURE_LOOKBACK,
            );
            let statuses_map =
                batch_query_map_vec(&conn, &consec_sql, &persona_ids, None, |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?;
            statuses_map
                .into_iter()
                .map(|(pid, statuses)| {
                    let count = statuses
                        .iter()
                        .take_while(|s| s.as_str() == "failed")
                        .count() as i64;
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
                durations_map
                    .get(&rp.persona_id)
                    .map(|v| v.as_slice())
                    .unwrap_or(&[]),
                95.0,
            );
            let mtbf = compute_mtbf(
                fail_ts_map
                    .get(&rp.persona_id)
                    .map(|v| v.as_slice())
                    .unwrap_or(&[]),
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
                consecutive_failure_lookback: CONSECUTIVE_FAILURE_LOOKBACK,
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
            success_rate: if g_decided > 0 {
                g_success as f64 / g_decided as f64
            } else {
                0.0
            },
            avg_duration_ms: g_avg_dur,
            total_cost_usd: g_cost,
            active_persona_count: persona_stats.len() as i64,
        };

        // -- Healing summary -------------------------------------------------
        // Previously this swallowed any rusqlite::Error and replaced it with
        // an all-zeros HealingSummary, which made a real outage (table
        // missing post-migration, lock contention, schema drift, row
        // deserialization failures) look like "all healthy: 0 open issues,
        // 0 circuit breakers" on the SLA dashboard. Surface the failure
        // instead so the dashboard goes red rather than silently green.
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
            .map_err(|e| {
                tracing::error!(error = %e, "failed to load healing summary for SLA dashboard");
                AppError::Database(e)
            })?;

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

/// Try every timestamp shape we have ever written into
/// `persona_executions.created_at` and return a `NaiveDateTime` if any
/// succeeds.
///
/// SQLite's `datetime('now')` writes `"YYYY-MM-DD HH:MM:SS"` while
/// `chrono::Utc::now().to_rfc3339()` (used by the dispatcher) writes a
/// `T`-separated form with a `+00:00` offset, and historical migrations
/// have produced rows with a trailing `Z`. We accept all of these so a
/// future schema change cannot silently break MTBF for legacy rows.
fn parse_execution_timestamp(ts: &str) -> Option<chrono::NaiveDateTime> {
    // RFC 3339 with offset (e.g. "2026-05-05T12:34:56.789+00:00" or "...Z")
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return Some(dt.naive_utc());
    }
    // Naive forms historically written by SQLite/chrono.
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(ts, fmt) {
            return Some(dt);
        }
    }
    None
}

/// Compute mean time between failures from sorted timestamps.
///
/// Unrecognised timestamp shapes are dropped, but logged at WARN level
/// with a sample. MTBF is the single number on the SLA card that
/// answers "is this persona stable?", so a silent parser drift would
/// quietly turn it into `None` and make a broken persona look healthy.
fn compute_mtbf(timestamps: &[String]) -> Option<f64> {
    if timestamps.len() < 2 {
        return None;
    }

    let mut parsed: Vec<chrono::NaiveDateTime> = Vec::with_capacity(timestamps.len());
    let mut dropped = 0usize;
    let mut sample: Option<&str> = None;
    for ts in timestamps {
        match parse_execution_timestamp(ts) {
            Some(dt) => parsed.push(dt),
            None => {
                dropped += 1;
                if sample.is_none() {
                    sample = Some(ts.as_str());
                }
            }
        }
    }

    if dropped > 0 {
        tracing::warn!(
            dropped,
            total = timestamps.len(),
            sample = sample.unwrap_or(""),
            "compute_mtbf: failed to parse {} of {} failure timestamps; metric may underreport",
            dropped,
            timestamps.len(),
        );
    }

    if parsed.len() < 2 {
        return None;
    }

    let first = *parsed.first()?;
    let last = *parsed.last()?;
    let total_span = (last - first).num_seconds() as f64;
    let gaps = (parsed.len() - 1) as f64;
    Some(total_span / gaps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::core::personas;

    /// Insert a `persona_executions` row with a fully specified status and
    /// `created_at` timestamp so SLA tests can pin both the streak length
    /// and the timestamp shape (`YYYY-MM-DD HH:MM:SS` vs RFC 3339).
    fn insert_execution(pool: &DbPool, persona_id: &str, status: &str, created_at: &str) -> String {
        let conn = pool.get().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO persona_executions
             (id, persona_id, status, input_tokens, output_tokens, cost_usd, created_at)
             VALUES (?1, ?2, ?3, 0, 0, 0, ?4)",
            params![id, persona_id, status, created_at],
        )
        .unwrap();
        id
    }

    fn create_test_persona(pool: &DbPool, name: &str) -> String {
        personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap()
        .id
    }

    // -- Phase 4: compute_mtbf parser tolerance ------------------------------

    #[test]
    fn parse_execution_timestamp_accepts_known_shapes() {
        // SQLite datetime('now') form
        assert!(parse_execution_timestamp("2026-05-04 12:00:00").is_some());
        // chrono::Utc::now().to_rfc3339() form with offset
        assert!(parse_execution_timestamp("2026-05-04T12:00:00+00:00").is_some());
        // Z-suffixed RFC 3339
        assert!(parse_execution_timestamp("2026-05-04T12:00:00Z").is_some());
        // Sub-second precision (chrono default)
        assert!(parse_execution_timestamp("2026-05-04T12:00:00.123456789+00:00").is_some());
        assert!(parse_execution_timestamp("2026-05-04 12:00:00.500").is_some());
    }

    #[test]
    fn parse_execution_timestamp_rejects_garbage() {
        assert!(parse_execution_timestamp("not a date").is_none());
        assert!(parse_execution_timestamp("").is_none());
    }

    #[test]
    fn compute_mtbf_handles_mixed_formats() {
        // Two-minute spacing across heterogeneous timestamp shapes.
        let timestamps = vec![
            "2026-05-04 12:00:00".to_string(),
            "2026-05-04T12:02:00+00:00".to_string(),
            "2026-05-04T12:04:00Z".to_string(),
        ];
        let mtbf = compute_mtbf(&timestamps).expect("mtbf should be Some");
        // Two gaps of 120s each → mean 120s.
        assert!((mtbf - 120.0).abs() < 0.001, "expected 120, got {mtbf}");
    }

    #[test]
    fn compute_mtbf_returns_none_when_too_few_parsed() {
        // Only one parses; the rest are unrecognised. Must not pretend MTBF
        // exists from a single timestamp.
        let timestamps = vec![
            "2026-05-04T12:00:00Z".to_string(),
            "garbage-1".to_string(),
            "garbage-2".to_string(),
        ];
        assert!(compute_mtbf(&timestamps).is_none());
    }

    #[test]
    fn compute_mtbf_returns_none_for_under_two_inputs() {
        assert!(compute_mtbf(&[]).is_none());
        assert!(compute_mtbf(&["2026-05-04T12:00:00Z".to_string()]).is_none());
    }

    // -- Phase 2: consecutive_failures cap regression ------------------------

    #[test]
    fn consecutive_failures_caps_at_lookback_constant() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "streak");

        // 25 failures, oldest first; created_at is monotonic so ORDER BY DESC
        // walks newest-to-oldest deterministically.
        let cap = CONSECUTIVE_FAILURE_LOOKBACK as usize;
        let total = cap + 5;
        for i in 0..total {
            let minute = i + 1;
            let ts = format!("2026-05-04 12:{:02}:00", minute);
            insert_execution(&pool, &persona_id, "failed", &ts);
        }

        let dash = get_sla_dashboard(&pool, 30).unwrap();
        let row = dash
            .persona_stats
            .iter()
            .find(|p| p.persona_id == persona_id)
            .expect("persona row missing");

        assert_eq!(
            row.consecutive_failures, CONSECUTIVE_FAILURE_LOOKBACK,
            "streak should saturate at the lookback cap, not the true count",
        );
        assert_eq!(
            row.consecutive_failure_lookback, CONSECUTIVE_FAILURE_LOOKBACK,
            "lookback cap must be surfaced on every row so the UI can render '{cap}+' boundary",
        );
        assert_eq!(row.failed, total as i64);
    }

    // -- Phase 3: success_rate denominator policy ----------------------------

    #[test]
    fn success_rate_excludes_cancelled_runs() {
        // 4 successful, 1 failed, 5 cancelled. With cancelled excluded the
        // denominator is 5 and the rate is 4/5 = 0.8. If a future refactor
        // changes the policy (e.g. counts cancelled as failures), this test
        // pins the original contract so the divergence is loud.
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "rate");

        for i in 0..4 {
            insert_execution(
                &pool,
                &persona_id,
                "completed",
                &format!("2026-05-04 12:{:02}:00", i),
            );
        }
        insert_execution(&pool, &persona_id, "failed", "2026-05-04 12:10:00");
        for i in 0..5 {
            insert_execution(
                &pool,
                &persona_id,
                "cancelled",
                &format!("2026-05-04 12:{:02}:00", 20 + i),
            );
        }

        let dash = get_sla_dashboard(&pool, 30).unwrap();
        let row = dash
            .persona_stats
            .iter()
            .find(|p| p.persona_id == persona_id)
            .expect("persona row missing");

        assert_eq!(row.successful, 4);
        assert_eq!(row.failed, 1);
        assert_eq!(row.cancelled, 5);
        assert_eq!(row.total_executions, 10);
        assert!(
            (row.success_rate - 0.8).abs() < 1e-9,
            "success_rate must be successful / (successful + failed); cancelled rows are excluded; got {}",
            row.success_rate,
        );

        // Same rule applied to global aggregates.
        assert!(
            (dash.global.success_rate - 0.8).abs() < 1e-9,
            "global success_rate must follow the same denominator rule; got {}",
            dash.global.success_rate,
        );

        // Daily trend uses the same formula.
        let day = dash
            .daily_trend
            .iter()
            .find(|d| d.date == "2026-05-04")
            .expect("daily point missing");
        assert!(
            (day.success_rate - 0.8).abs() < 1e-9,
            "daily success_rate must follow the same denominator rule; got {}",
            day.success_rate,
        );
    }

    // -- Healing summary time-window policy ---------------------------------

    /// Insert a healing issue with explicit `created_at` so we can place
    /// rows both inside and outside any rolling window the test exercises.
    fn insert_healing_issue(
        pool: &DbPool,
        persona_id: &str,
        status: &str,
        auto_fixed: bool,
        is_circuit_breaker: bool,
        created_at: &str,
    ) {
        let conn = pool.get().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO persona_healing_issues
             (id, persona_id, title, description, is_circuit_breaker,
              severity, category, auto_fixed, status, created_at)
             VALUES (?1, ?2, 'test', 'test', ?3, 'low', 'config', ?4, ?5, ?6)",
            params![
                id,
                persona_id,
                is_circuit_breaker as i64,
                auto_fixed as i64,
                status,
                created_at,
            ],
        )
        .unwrap();
    }

    fn insert_knowledge_pattern(pool: &DbPool, key: &str, last_seen_at: &str) {
        let conn = pool.get().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO healing_knowledge
             (id, service_type, pattern_key, description, occurrence_count, last_seen_at)
             VALUES (?1, 'test_service', ?2, 'test', 1, ?3)",
            params![id, key, last_seen_at],
        )
        .unwrap();
    }

    /// `healing_summary` is intentionally **all-time / snapshot** and must
    /// not move when the user toggles the 7d/14d/30d/60d/90d window in the
    /// SLA dashboard. The dashboard frames these four cards as operational
    /// state ("right now, what's broken?") rather than executions in a
    /// window, and the SLADashboard frontend renders an "All-time" badge to
    /// match. If a future refactor windowed any of these aggregates, the
    /// label and the SQL would silently drift apart again — exactly the
    /// fog this test exists to prevent.
    #[test]
    fn healing_summary_is_invariant_across_window() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "healing-window");

        // Old issues (>90 days back, outside every selectable window).
        insert_healing_issue(
            &pool, &persona_id, "open", false, false, "2025-01-01 12:00:00",
        );
        insert_healing_issue(
            &pool, &persona_id, "open", false, true, "2025-01-02 12:00:00",
        );
        insert_healing_issue(
            &pool, &persona_id, "resolved", true, false, "2025-01-03 12:00:00",
        );

        // Recent issues (well inside the 7d window).
        insert_healing_issue(
            &pool, &persona_id, "open", false, false, "2026-05-04 12:00:00",
        );
        insert_healing_issue(
            &pool, &persona_id, "resolved", true, false, "2026-05-04 13:00:00",
        );

        // A pattern that's also "old".
        insert_knowledge_pattern(&pool, "ancient", "2025-01-01 12:00:00");
        insert_knowledge_pattern(&pool, "recent", "2026-05-04 12:00:00");

        // Pre-window expectations: 3 open (2 old + 1 recent), 2 auto-fixed
        // total (1 old + 1 recent), 1 open circuit breaker (old), 2 patterns.
        let expected_open = 3;
        let expected_auto_fixed = 2;
        let expected_breakers = 1;
        let expected_patterns = 2;

        for &days in &[7_i64, 14, 30, 60, 90] {
            let dash = get_sla_dashboard(&pool, days).unwrap();
            assert_eq!(
                dash.healing_summary.open_issues, expected_open,
                "open_issues must be all-time and invariant across window (days={days})",
            );
            assert_eq!(
                dash.healing_summary.auto_fixed_count, expected_auto_fixed,
                "auto_fixed_count must be all-time and invariant across window (days={days})",
            );
            assert_eq!(
                dash.healing_summary.circuit_breaker_count, expected_breakers,
                "circuit_breaker_count must be all-time and invariant across window (days={days})",
            );
            assert_eq!(
                dash.healing_summary.knowledge_patterns, expected_patterns,
                "knowledge_patterns must be all-time and invariant across window (days={days})",
            );
        }
    }

    #[test]
    fn success_rate_is_zero_when_no_decided_runs() {
        // Only cancelled runs ⇒ denominator is 0 ⇒ rate falls back to 0.0
        // (the contract is "0 not NaN" so the dashboard renders cleanly).
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "zero");

        for i in 0..3 {
            insert_execution(
                &pool,
                &persona_id,
                "cancelled",
                &format!("2026-05-04 12:{:02}:00", i),
            );
        }

        let dash = get_sla_dashboard(&pool, 30).unwrap();
        let row = dash
            .persona_stats
            .iter()
            .find(|p| p.persona_id == persona_id)
            .expect("persona row missing");
        assert_eq!(row.success_rate, 0.0);
    }
}
