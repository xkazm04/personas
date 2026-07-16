use std::collections::HashMap;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use ts_rs::TS;

use crate::db::models::{
    GlobalSlaStats, HealingSummary, PersonaSlaStats, SlaDailyPoint, SlaDashboardData,
};
use crate::db::query_builder::QueryBuilder;
use crate::db::DbPool;
use crate::error::AppError;

/// Per-persona reliability aggregate over the window — measured success rate and
/// average latency from THIS persona's own executions, not the fleet-wide proxy
/// the heartbeats pipeline used to substitute for every active persona. Reuses
/// the `get_sla_dashboard` per-persona query shape trimmed to the two fields the
/// heartbeats input layer needs.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PersonaReliability {
    pub persona_id: String,
    // `completed + failed` in the window (cancelled excluded, same rule as
    // PersonaSlaStats.success_rate). Zero => no measured basis; the frontend
    // falls back to the labeled fleet proxy.
    #[ts(type = "number")]
    pub total_decided: i64,
    // Measured success rate as 0.0..=1.0 (`successful / decided`).
    pub success_rate: f64,
    // Mean execution latency (ms) for this persona's timed runs in the window.
    pub avg_duration_ms: f64,
}

/// Per-persona daily success series over the window. Feeds the per-persona
/// failure-trend regression, replacing the fleet-wide daily success series that
/// made every persona render an identical trend/prediction.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PersonaDailyReliability {
    pub persona_id: String,
    // `YYYY-MM-DD` — bucketed by the caller-supplied local-day offset (see
    // `local_day_modifier`), the same definition the SLA rollups/trend use.
    pub date: String,
    // Measured success rate for the day as 0.0..=1.0.
    pub success_rate: f64,
    #[ts(type = "number")]
    pub decided: i64,
}

/// Per-persona reliability aggregate (success rate + avg latency) over the last
/// `days`. Mirrors the per-persona aggregate in `get_sla_dashboard`, trimmed.
pub fn get_persona_reliability(
    pool: &DbPool,
    days: i64,
) -> Result<Vec<PersonaReliability>, AppError> {
    timed_query!("sla", "sla::get_persona_reliability", {
        let conn = pool.get()?;
        let date_filter = format!("-{} days", days);
        let mut stmt = conn.prepare(
            "SELECT e.persona_id,
                    SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS successful,
                    SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) AS failed,
                    AVG(CASE WHEN e.duration_ms IS NOT NULL THEN e.duration_ms ELSE NULL END) AS avg_dur
             FROM persona_executions e
             WHERE e.created_at >= datetime('now', ?1)
               AND e.status IN ('completed', 'failed')
             GROUP BY e.persona_id",
        )?;
        let rows = stmt.query_map(params![date_filter], |row| {
            let successful: i64 = row.get(1)?;
            let failed: i64 = row.get(2)?;
            let decided = successful + failed;
            let success_rate = if decided > 0 {
                successful as f64 / decided as f64
            } else {
                0.0
            };
            Ok(PersonaReliability {
                persona_id: row.get(0)?,
                total_decided: decided,
                success_rate,
                avg_duration_ms: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

/// Per-persona daily success series over the last `days` (one row per persona
/// per active day). Feeds the per-persona failure-trend regression.
///
/// `offset_min` selects the local-day bucket definition (see
/// [`local_day_modifier`]) so this series agrees with the SLA rollups/trend on
/// which calendar day a run belongs to.
pub fn get_persona_daily_reliability(
    pool: &DbPool,
    days: i64,
    offset_min: i64,
) -> Result<Vec<PersonaDailyReliability>, AppError> {
    timed_query!("sla", "sla::get_persona_daily_reliability", {
        let conn = pool.get()?;
        let date_filter = format!("-{} days", days);
        let modifier = local_day_modifier(offset_min);
        let mut stmt = conn.prepare(
            "SELECT e.persona_id,
                    DATE(e.created_at, ?2) AS day,
                    SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS successful,
                    SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) AS failed
             FROM persona_executions e
             WHERE e.created_at >= datetime('now', ?1)
               AND e.status IN ('completed', 'failed')
             GROUP BY e.persona_id, DATE(e.created_at, ?2)
             ORDER BY e.persona_id, day ASC",
        )?;
        let rows = stmt.query_map(params![date_filter, modifier], |row| {
            let successful: i64 = row.get(2)?;
            let failed: i64 = row.get(3)?;
            let decided = successful + failed;
            let success_rate = if decided > 0 {
                successful as f64 / decided as f64
            } else {
                0.0
            };
            Ok(PersonaDailyReliability {
                persona_id: row.get(0)?,
                date: row.get(1)?,
                success_rate,
                decided,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

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
    /// Count of executions that actually have a duration (the n behind avg_dur).
    /// The global avg-latency rollup must weight by THIS, not total_executions —
    /// otherwise personas with many untimed (cancelled/no-duration) runs skew it.
    timed: i64,
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
    get_sla_dashboard_with_offset(pool, days, server_offset_minutes())
}

/// Offset-aware variant of [`get_sla_dashboard`]. `offset_min` (minutes east of
/// UTC) selects the local-day definition used for the trend's day buckets AND
/// the window boundary, so a UTC-8 user's "last 7 days" is seven full local
/// days aligned to local midnight rather than a rolling 7×24h UTC slice. On a
/// local-first desktop the frontend passes its own `-getTimezoneOffset()`; when
/// omitted the caller falls back to `server_offset_minutes()`.
pub fn get_sla_dashboard_with_offset(
    pool: &DbPool,
    days: i64,
    offset_min: i64,
) -> Result<SlaDashboardData, AppError> {
    timed_query!("sla", "sla::get_sla_dashboard", {
        let conn = pool.get()?;

        // Local-day-aligned window lower bound, materialised as a UTC instant so
        // the raw `created_at` filters stay index-friendly. This is the start of
        // the local day `days` days before today: `now → local wall clock →
        // back N days → local midnight → back to UTC`.
        let window_cutoff: String = conn.query_row(
            "SELECT datetime('now', ?1, ?2, 'start of day', ?3)",
            params![
                local_day_modifier(offset_min),
                format!("-{} days", days),
                local_day_modifier(-offset_min),
            ],
            |r| r.get(0),
        )?;

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
                SUM(CASE WHEN e.duration_ms IS NOT NULL THEN 1 ELSE 0 END) AS timed,
                COALESCE(SUM(e.cost_usd), 0.0) AS total_cost
             FROM persona_executions e
             LEFT JOIN personas p ON p.id = e.persona_id
             WHERE e.created_at >= ?1
               AND e.status IN ('completed', 'failed', 'cancelled')
             GROUP BY e.persona_id
             ORDER BY total DESC",
        )?;

        let raw_personas: Vec<RawPersona> = stmt
            .query_map(params![window_cutoff], |row| {
                Ok(RawPersona {
                    persona_id: row.get(0)?,
                    persona_name: row.get(1)?,
                    total: row.get(2)?,
                    successful: row.get(3)?,
                    failed: row.get(4)?,
                    cancelled: row.get(5)?,
                    avg_dur: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                    timed: row.get(7)?,
                    total_cost: row.get(8)?,
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
               AND created_at >= {date_param}
               AND status IN ('completed', 'failed')
               AND duration_ms IS NOT NULL
             ORDER BY persona_id, duration_ms ASC",
            &persona_ids,
            Some(&window_cutoff),
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)),
        )?;

        // -- Batch MTBF: failure timestamps ----------------------------------
        let fail_ts_map = batch_query_map_vec(
            &conn,
            "SELECT persona_id, created_at FROM persona_executions
             WHERE persona_id IN ({placeholders})
               AND created_at >= {date_param}
               AND status = 'failed'
             ORDER BY persona_id, created_at ASC",
            &persona_ids,
            Some(&window_cutoff),
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;

        // -- Batch consecutive failures --------------------------------------
        // Bounded to the displayed window (was windowless — it scanned every
        // persona's ENTIRE execution history on every dashboard load). Two wins:
        // the scan is now capped by `created_at >= window`, and the streak is
        // definitionally consistent with the windowed counts rendered next to
        // it (a "12 failing" badge can no longer reflect failures outside the
        // 7d/30d card it sits on). The lookback cap still bounds it to the most
        // recent N rows within that window.
        let consec_map = {
            let consec_sql = format!(
                "SELECT persona_id, status FROM (
                    SELECT persona_id, status,
                           ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY created_at DESC) AS rn
                    FROM persona_executions
                    WHERE persona_id IN ({{placeholders}})
                      AND created_at >= {{date_param}}
                 ) WHERE rn <= {}
                 ORDER BY persona_id, rn ASC",
                CONSECUTIVE_FAILURE_LOOKBACK,
            );
            let statuses_map =
                batch_query_map_vec(&conn, &consec_sql, &persona_ids, Some(&window_cutoff), |row| {
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
        // Weight each persona's avg latency by its TIMED execution count (the n
        // behind avg_dur), not total_executions — otherwise personas with many
        // untimed (cancelled / no-duration) runs are over-weighted and the
        // global average is wrong.
        let g_timed: i64 = raw_personas.iter().map(|p| p.timed).sum();
        let g_avg_dur = if g_timed > 0 {
            raw_personas
                .iter()
                .map(|p| p.avg_dur * p.timed as f64)
                .sum::<f64>()
                / g_timed as f64
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
        // Served from persisted `sla_daily` rollups (durable past retention)
        // merged with a windowed raw recompute for today/recent days. Buckets
        // by local day so the trend does not break at a UTC boundary.
        let daily_trend: Vec<SlaDailyPoint> = load_daily_trend(&conn, days, offset_min)?;

        Ok(SlaDashboardData {
            persona_stats,
            global,
            healing_summary,
            daily_trend,
        })
    })
}

// ============================================================================
// Local-day bucketing — THE shared definition
// ============================================================================
//
// Both the persisted daily rollups (`sla_daily`) and the on-read daily trend
// bucket executions by the user's *local* calendar day, not the UTC day. A
// UTC-8 user's Tuesday runs from 08:00 UTC Tue to 08:00 UTC Wed; bucketing by
// `DATE(created_at)` (UTC) would split that Tuesday across two chart columns
// and break at 16:00 local. The single source of truth for "which day does
// this UTC timestamp fall on" is `local_day_modifier`, applied identically by
// the rollup writer, the migration backfill, and the trend reader so a stored
// rollup and a live recompute always agree on day boundaries.

/// SQLite `datetime()`/`DATE()` modifier that shifts a stored UTC timestamp
/// into the user's wall-clock day. `offset_min` is minutes east of UTC
/// (e.g. `-480` for UTC-8, `+330` for IST). SQLite normalises timestamps that
/// carry an explicit `Z`/`±HH:MM` offset to UTC first, then this modifier is
/// applied — so mixed timestamp shapes (naive-UTC and RFC3339) bucket
/// consistently.
pub(crate) fn local_day_modifier(offset_min: i64) -> String {
    format!("{:+} minutes", offset_min)
}

/// The server's current UTC offset in minutes east of UTC. Personas is a
/// local-first desktop app: the Rust backend shares the user's machine clock
/// and timezone, so this equals the frontend's `-new Date().getTimezoneOffset()`.
/// Used as the default day-bucket offset by the rollup writer (which runs in a
/// background maintenance tick with no request context) and as the fallback for
/// the dashboard read when the frontend does not pass an explicit offset.
pub fn server_offset_minutes() -> i64 {
    (chrono::Local::now().offset().local_minus_utc() / 60) as i64
}

// ============================================================================
// Persisted daily rollups (`sla_daily`)
// ============================================================================

/// Recompute + upsert daily SLA rollups from raw `persona_executions` for every
/// `(persona_id, local-day)` that currently has terminal rows.
///
/// **Idempotent by construction:** each call recomputes the full day from the
/// source rows, so running it twice (or every maintenance tick) produces the
/// same table state — it never double-counts. Days whose raw rows have since
/// been pruned by execution retention are simply not re-selected, so their last
/// written rollup is preserved (frozen). That is exactly why the maintenance
/// tick must call this **before** `cleanup_old_executions`: the about-to-be-
/// pruned day gets one final accurate rollup, and the trend survives beyond the
/// raw-execution retention window.
///
/// `offset_min` selects the local-day definition (see `local_day_modifier`).
pub fn upsert_sla_daily(pool: &DbPool, offset_min: i64) -> Result<usize, AppError> {
    let conn = pool.get()?;
    upsert_sla_daily_conn(&conn, offset_min)
}

/// Connection-scoped body of [`upsert_sla_daily`], also reused by the migration
/// backfill (which only has a `&Connection`).
pub(crate) fn upsert_sla_daily_conn(
    conn: &rusqlite::Connection,
    offset_min: i64,
) -> Result<usize, AppError> {
    let modifier = local_day_modifier(offset_min);
    let n = conn.execute(
        "INSERT INTO sla_daily
            (persona_id, day, total, successful, failed, cancelled,
             timed_count, duration_sum_ms, cost_sum_usd, updated_at)
         SELECT
            persona_id,
            DATE(created_at, ?1) AS day,
            COUNT(*),
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END),
            SUM(CASE WHEN duration_ms IS NOT NULL THEN 1 ELSE 0 END),
            COALESCE(SUM(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END), 0),
            COALESCE(SUM(cost_usd), 0.0),
            datetime('now')
         FROM persona_executions
         WHERE status IN ('completed', 'failed', 'cancelled')
         GROUP BY persona_id, DATE(created_at, ?1)
         ON CONFLICT(persona_id, day) DO UPDATE SET
            total           = excluded.total,
            successful      = excluded.successful,
            failed          = excluded.failed,
            cancelled       = excluded.cancelled,
            timed_count     = excluded.timed_count,
            duration_sum_ms = excluded.duration_sum_ms,
            cost_sum_usd    = excluded.cost_sum_usd,
            updated_at      = excluded.updated_at",
        params![modifier],
    )?;
    Ok(n)
}

/// One accumulated (persona-agnostic) day bucket for the trend.
struct DayAcc {
    total: i64,
    successful: i64,
    failed: i64,
    cancelled: i64,
}

/// Load the fleet-wide daily success-rate trend for the window.
///
/// The trend is served from two sources merged per local day, keeping the
/// higher-`total` source for each day:
///
/// - **Durable tail** — `sla_daily` rollups cover days whose raw executions have
///   been pruned by retention (the reason the pre-rollup trend "died" past the
///   execution window).
/// - **Fresh head** — a windowed (never full-history) recompute of the retained
///   raw rows, including today's still-growing partial day.
///
/// Because a sealed rollup is complete while a same-day raw recompute may be
/// stale-low (rows added since the last tick) or prune-low, and vice-versa,
/// max-by-total picks the more complete source for each day automatically:
/// today and recent days resolve to the fresh raw recompute; pruned history
/// resolves to the durable rollup.
fn load_daily_trend(
    conn: &rusqlite::Connection,
    days: i64,
    offset_min: i64,
) -> Result<Vec<SlaDailyPoint>, AppError> {
    use std::collections::BTreeMap;

    let modifier = local_day_modifier(offset_min);
    let date_filter = format!("-{} days", days);
    let mut by_day: BTreeMap<String, DayAcc> = BTreeMap::new();

    // Window boundary as a local day, and its UTC instant so the raw head can
    // filter on `created_at` (index-friendly) while covering exactly the same
    // local days as the rollup tail.
    let start_day: String = conn.query_row(
        "SELECT DATE('now', ?1, ?2)",
        params![modifier, date_filter],
        |r| r.get(0),
    )?;
    let inverse_modifier = local_day_modifier(-offset_min);
    let raw_cutoff_utc: String = conn.query_row(
        "SELECT datetime(?1, ?2)",
        params![start_day, inverse_modifier],
        |r| r.get(0),
    )?;

    let mut consider = |day: String, acc: DayAcc| match by_day.get(&day) {
        Some(existing) if existing.total >= acc.total => {}
        _ => {
            by_day.insert(day, acc);
        }
    };

    // Durable tail: persisted rollups within the window.
    {
        let mut stmt = conn.prepare(
            "SELECT day, SUM(total), SUM(successful), SUM(failed), SUM(cancelled)
             FROM sla_daily
             WHERE day >= ?1
             GROUP BY day",
        )?;
        let rows = stmt.query_map(params![start_day], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        for r in rows {
            let (day, total, successful, failed, cancelled) = r?;
            consider(
                day,
                DayAcc {
                    total,
                    successful,
                    failed,
                    cancelled,
                },
            );
        }
    }

    // Fresh head: windowed raw recompute (retained days incl. today's partial).
    {
        let mut stmt = conn.prepare(
            "SELECT DATE(created_at, ?1) AS day,
                    COUNT(*),
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)
             FROM persona_executions
             WHERE created_at >= ?2
               AND status IN ('completed', 'failed', 'cancelled')
             GROUP BY DATE(created_at, ?1)",
        )?;
        let rows = stmt.query_map(params![modifier, raw_cutoff_utc], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        for r in rows {
            let (day, total, successful, failed, cancelled) = r?;
            consider(
                day,
                DayAcc {
                    total,
                    successful,
                    failed,
                    cancelled,
                },
            );
        }
    }

    Ok(by_day
        .into_iter()
        .map(|(date, a)| {
            let decided = a.successful + a.failed;
            SlaDailyPoint {
                date,
                total: a.total,
                successful: a.successful,
                failed: a.failed,
                cancelled: a.cancelled,
                success_rate: if decided > 0 {
                    a.successful as f64 / decided as f64
                } else {
                    0.0
                },
            }
        })
        .collect())
}

// ============================================================================
// Helpers
// ============================================================================

/// The `p`-th percentile of `values`, or `None` when there is no data. Empty
/// input returns `None` (surfaced as "N/A") rather than `0.0` — a real
/// zero-latency execution is impossible, so "0ms" here only ever meant "no
/// data" and read as a falsely precise number.
fn percentile(values: &[f64], p: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = (p / 100.0 * (sorted.len() as f64 - 1.0)).round() as usize;
    Some(sorted[idx.min(sorted.len() - 1)])
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

// ============================================================================
// Breach detection (zero-config reliability episodes)
// ============================================================================
//
// SLA state used to be a read-only island: it computed rates and streaks for
// the dashboard but never *notified*. Breach detection closes that gap by
// running cheaply on the execution-completion path (NEVER at dashboard load)
// and emitting a typed bus event when a persona crosses into — or back out of —
// a reliability breach. The reads here are the detection half; the emission +
// episode-dedup orchestration lives in `engine::sla_breach`.
//
// **Zero-config by product decision (2026-07-14):** there is deliberately NO
// `sla_targets` table, no authoring UI, no new settings surface. The thresholds
// below are fixed constants tuned to be conservative — the failure mode we
// guard against is false-positive noise, not missed breaches. A user with a
// genuinely flaky persona will cross these; a healthy persona having one bad
// run will not.

/// How many of a persona's most-recent terminal runs the breach signal
/// inspects. Bounded so detection is O(1) per completion regardless of history
/// size — it never full-scans `persona_executions`. Mirrors the spirit of
/// [`CONSECUTIVE_FAILURE_LOOKBACK`] (the dashboard streak cap): once a persona
/// is this deep into failures the operational meaning ("broken") no longer
/// sharpens with more rows.
pub const BREACH_LOOKBACK: i64 = 20;

/// Consecutive-failure count at or above which a persona is in breach.
/// Five back-to-back failures is well past "a transient blip" and past the
/// value-delivery circuit breaker's 3-run window — by here the persona is
/// reliably failing, not unlucky.
pub const BREACH_CONSECUTIVE_FAILURES: i64 = 5;

/// Minimum number of *decided* runs (completed + failed; cancelled excluded,
/// same denominator rule as `success_rate`) required before the rate-based
/// check can fire. Without a sample floor, "1 fail out of 1" reads as a 0%
/// success rate and would open a breach on a single failure — exactly the
/// false-positive we refuse to emit.
pub const BREACH_MIN_SAMPLE: i64 = 5;

/// Windowed success rate below which a persona is in breach (given at least
/// [`BREACH_MIN_SAMPLE`] decided runs). Half the recent decided runs failing
/// is a clear reliability collapse, not variance.
pub const BREACH_SUCCESS_RATE: f64 = 0.5;

/// Success rate a breached persona must climb back to (with no active failure
/// streak) before the episode is considered recovered. Set ABOVE
/// [`BREACH_SUCCESS_RATE`] on purpose: the hysteresis gap (0.5 → 0.75) stops an
/// episode from flapping open/closed while a persona hovers right at the 50%
/// boundary. Between the two thresholds the episode simply stays in its current
/// state.
pub const RECOVERY_SUCCESS_RATE: f64 = 0.75;

/// Bounded per-persona reliability snapshot used for breach classification.
/// Computed from the persona's most-recent [`BREACH_LOOKBACK`] terminal runs.
#[derive(Debug, Clone)]
pub struct BreachSignal {
    /// Leading run of `failed` statuses from newest backward (a `completed` or
    /// `cancelled` breaks the streak — same rule as the dashboard streak).
    pub consecutive_failures: i64,
    /// Decided runs in the window (`completed + failed`).
    pub decided: i64,
    /// Successful (`completed`) runs in the window.
    pub successful: i64,
    /// `successful / decided`, or `0.0` when there are no decided runs.
    pub success_rate: f64,
}

/// Read the bounded breach signal for one persona. Single indexed query over
/// the persona's most-recent terminal rows — cheap enough to call on every
/// execution completion.
pub fn get_persona_breach_signal(
    pool: &DbPool,
    persona_id: &str,
) -> Result<BreachSignal, AppError> {
    timed_query!("sla", "sla::get_persona_breach_signal", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT status FROM persona_executions
             WHERE persona_id = ?1 AND status IN ('completed', 'failed', 'cancelled')
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;
        let statuses: Vec<String> = stmt
            .query_map(params![persona_id, BREACH_LOOKBACK], |row| {
                row.get::<_, String>(0)
            })?
            .filter_map(|r| r.ok())
            .collect();

        let consecutive_failures = statuses
            .iter()
            .take_while(|s| s.as_str() == "failed")
            .count() as i64;
        let successful = statuses.iter().filter(|s| s.as_str() == "completed").count() as i64;
        let failed = statuses.iter().filter(|s| s.as_str() == "failed").count() as i64;
        let decided = successful + failed;
        let success_rate = if decided > 0 {
            successful as f64 / decided as f64
        } else {
            0.0
        };

        Ok(BreachSignal {
            consecutive_failures,
            decided,
            successful,
            success_rate,
        })
    })
}

/// Whether a signal meets a breach condition, and which reason token to emit.
/// Consecutive-failure breach takes precedence over the rate breach (it's the
/// sharper, more actionable signal). Returns `None` when the persona is not in
/// breach. Pure function — no I/O — so the thresholds are unit-testable.
pub fn classify_breach(sig: &BreachSignal) -> Option<&'static str> {
    if sig.consecutive_failures >= BREACH_CONSECUTIVE_FAILURES {
        return Some("consecutive_failures");
    }
    if sig.decided >= BREACH_MIN_SAMPLE && sig.success_rate < BREACH_SUCCESS_RATE {
        return Some("low_success_rate");
    }
    None
}

/// Whether a currently-open episode should be closed: no active failure streak
/// AND either too little recent signal to judge (the persona went quiet) or a
/// success rate back above the hysteresis recovery bar.
pub fn is_recovered(sig: &BreachSignal) -> bool {
    sig.consecutive_failures == 0
        && (sig.decided < BREACH_MIN_SAMPLE || sig.success_rate >= RECOVERY_SUCCESS_RATE)
}

/// The action a completion should take given the current episode state and the
/// fresh signal. Encapsulates the enter-once / no-re-emit / recover-closes
/// state machine as a pure function so it can be tested without an `AppHandle`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BreachDecision {
    /// Nothing to emit (not breached, or already-open episode still breached,
    /// or borderline inside the hysteresis band).
    NoOp,
    /// Cross into breach — emit the opened event once. Carries the reason token.
    Open(&'static str),
    /// Cross back out — emit the recovered event and close the episode.
    Recover,
}

/// Pure decision function for the breach state machine. `episode_open` is the
/// durable per-persona state (from `sla_breach_episodes`); `sig` is the fresh
/// bounded signal. This is what guarantees ONE enter-event per episode and no
/// re-emission on every subsequent failing run.
pub fn decide(episode_open: bool, sig: &BreachSignal) -> BreachDecision {
    if !episode_open {
        match classify_breach(sig) {
            Some(reason) => BreachDecision::Open(reason),
            None => BreachDecision::NoOp,
        }
    } else if is_recovered(sig) {
        BreachDecision::Recover
    } else {
        BreachDecision::NoOp
    }
}

/// Durable per-persona breach-episode state. Persisted so a restart mid-episode
/// does not re-emit an already-announced breach.
#[derive(Debug, Clone, Default)]
pub struct BreachEpisode {
    /// True while the persona is in an announced (un-recovered) breach.
    pub is_open: bool,
    /// The reason token captured when the episode opened.
    pub reason: Option<String>,
    /// When the episode opened (RFC 3339), carried into the recovery event.
    pub opened_at: Option<String>,
}

/// Load a persona's current episode state, or a default (closed) state when no
/// row exists yet.
pub fn get_breach_episode(pool: &DbPool, persona_id: &str) -> Result<BreachEpisode, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT is_open, reason, opened_at FROM sla_breach_episodes WHERE persona_id = ?1",
            params![persona_id],
            |r| {
                Ok(BreachEpisode {
                    is_open: r.get::<_, i64>(0)? != 0,
                    reason: r.get(1)?,
                    opened_at: r.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(row.unwrap_or_default())
}

/// Open (or re-open) a persona's breach episode, stamping the reason + signal
/// snapshot. Idempotent per persona (PK upsert).
pub fn open_breach_episode(
    pool: &DbPool,
    persona_id: &str,
    reason: &str,
    sig: &BreachSignal,
    at: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO sla_breach_episodes
            (persona_id, is_open, reason, consecutive_failures, success_rate, decided,
             opened_at, recovered_at, updated_at)
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, NULL, ?6)
         ON CONFLICT(persona_id) DO UPDATE SET
            is_open              = 1,
            reason               = excluded.reason,
            consecutive_failures = excluded.consecutive_failures,
            success_rate         = excluded.success_rate,
            decided              = excluded.decided,
            opened_at            = excluded.opened_at,
            recovered_at         = NULL,
            updated_at           = excluded.updated_at",
        params![
            persona_id,
            reason,
            sig.consecutive_failures,
            sig.success_rate,
            sig.decided,
            at,
        ],
    )?;
    Ok(())
}

/// Close a persona's breach episode (recovery), stamping the recovery signal.
pub fn close_breach_episode(
    pool: &DbPool,
    persona_id: &str,
    sig: &BreachSignal,
    at: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE sla_breach_episodes
         SET is_open              = 0,
             consecutive_failures = ?2,
             success_rate         = ?3,
             decided              = ?4,
             recovered_at         = ?5,
             updated_at           = ?5
         WHERE persona_id = ?1",
        params![
            persona_id,
            sig.consecutive_failures,
            sig.success_rate,
            sig.decided,
            at,
        ],
    )?;
    Ok(())
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
                notification_channels: None,
                lifecycle: None,
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

        // Anchor on "now" (not a hardcoded date) so the 30-day dashboard
        // window this test exercises never ages the fixture out of range.
        let base = chrono::Utc::now() - chrono::Duration::hours(1);

        // 25 failures, oldest first; created_at is monotonic so ORDER BY DESC
        // walks newest-to-oldest deterministically.
        let cap = CONSECUTIVE_FAILURE_LOOKBACK as usize;
        let total = cap + 5;
        for i in 0..total {
            let minute = i + 1;
            let ts = (base + chrono::Duration::minutes(minute as i64))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
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

        // Anchor on "now" (not a hardcoded date) so the 30-day dashboard
        // window this test exercises never ages the fixture out of range.
        let base = chrono::Utc::now() - chrono::Duration::hours(1);
        // The trend now buckets by LOCAL day (server offset), so the expected
        // trend key is the local wall-clock date of `base`, not its UTC date.
        let day = (base + chrono::Duration::minutes(server_offset_minutes()))
            .format("%Y-%m-%d")
            .to_string();
        let ts = |minute: i64| (base + chrono::Duration::minutes(minute)).format("%Y-%m-%d %H:%M:%S").to_string();

        for i in 0..4 {
            insert_execution(&pool, &persona_id, "completed", &ts(i));
        }
        insert_execution(&pool, &persona_id, "failed", &ts(10));
        for i in 0..5 {
            insert_execution(&pool, &persona_id, "cancelled", &ts(20 + i));
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
        let day_point = dash
            .daily_trend
            .iter()
            .find(|d| d.date == day)
            .expect("daily point missing");
        assert!(
            (day_point.success_rate - 0.8).abs() < 1e-9,
            "daily success_rate must follow the same denominator rule; got {}",
            day_point.success_rate,
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
            &pool,
            &persona_id,
            "open",
            false,
            false,
            "2025-01-01 12:00:00",
        );
        insert_healing_issue(
            &pool,
            &persona_id,
            "open",
            false,
            true,
            "2025-01-02 12:00:00",
        );
        insert_healing_issue(
            &pool,
            &persona_id,
            "resolved",
            true,
            false,
            "2025-01-03 12:00:00",
        );

        // Recent issues (well inside the 7d window).
        insert_healing_issue(
            &pool,
            &persona_id,
            "open",
            false,
            false,
            "2026-05-04 12:00:00",
        );
        insert_healing_issue(
            &pool,
            &persona_id,
            "resolved",
            true,
            false,
            "2026-05-04 13:00:00",
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

        // Anchor on "now" (not a hardcoded date) so the 30-day dashboard
        // window this test exercises never ages the fixture out of range.
        let base = chrono::Utc::now() - chrono::Duration::hours(1);
        for i in 0..3 {
            let ts = (base + chrono::Duration::minutes(i))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            insert_execution(&pool, &persona_id, "cancelled", &ts);
        }

        let dash = get_sla_dashboard(&pool, 30).unwrap();
        let row = dash
            .persona_stats
            .iter()
            .find(|p| p.persona_id == persona_id)
            .expect("persona row missing");
        assert_eq!(row.success_rate, 0.0);
    }

    // -- Direction 1: persisted daily rollups + bounded queries --------------

    /// The `sla_daily` rollup table must exist on a FRESH schema — i.e. the
    /// migration step lives INSIDE `run_incremental` (not appended to the
    /// `ensure_composite_fires_table` tail that `initial::run` invokes before
    /// `run_incremental`). If it were misplaced, `init_test_db` (which builds a
    /// fresh DB) would fail here.
    #[test]
    fn sla_daily_exists_on_fresh_schema() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM sla_daily", [], |r| r.get(0))
            .expect("sla_daily table must exist on a fresh schema");
        assert_eq!(n, 0, "fresh backfill of an empty history is empty");
        // Dashboard load must not error on an empty rollup table.
        let dash = get_sla_dashboard(&pool, 30).unwrap();
        assert!(dash.daily_trend.is_empty());
    }

    /// Recomputing rollups twice produces identical table state — never a
    /// double count. This is the property that lets the maintenance tick call
    /// it every pass unconditionally.
    #[test]
    fn upsert_sla_daily_is_idempotent() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "rollup-idem");
        let base = chrono::Utc::now() - chrono::Duration::hours(2);
        let ts = |m: i64| (base + chrono::Duration::minutes(m))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        for i in 0..3 {
            insert_execution(&pool, &persona_id, "completed", &ts(i));
        }
        insert_execution(&pool, &persona_id, "failed", &ts(10));
        insert_execution(&pool, &persona_id, "cancelled", &ts(20));

        let off = server_offset_minutes();
        upsert_sla_daily(&pool, off).unwrap();
        let snapshot = |pool: &DbPool| -> (i64, i64, i64, i64, i64) {
            let conn = pool.get().unwrap();
            conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(total),0), COALESCE(SUM(successful),0),
                        COALESCE(SUM(failed),0), COALESCE(SUM(cancelled),0)
                 FROM sla_daily WHERE persona_id = ?1",
                params![persona_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap()
        };
        let first = snapshot(&pool);
        upsert_sla_daily(&pool, off).unwrap();
        let second = snapshot(&pool);

        assert_eq!(first, second, "second upsert must not change table state");
        // Totals reflect the source rows regardless of how many local days they
        // land on (5 terminal rows: 3 completed, 1 failed, 1 cancelled).
        assert_eq!(first.1, 5);
        assert_eq!(first.2, 3);
        assert_eq!(first.3, 1);
        assert_eq!(first.4, 1);
    }

    /// The consecutive-failure streak must only count failures WITHIN the
    /// displayed window. Failures older than the window are excluded, so the
    /// badge stays consistent with the windowed counts beside it.
    #[test]
    fn consecutive_failures_bounded_by_window() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "streak-window");

        // 5 failures ~40 days ago (OUTSIDE a 30-day window).
        let old = chrono::Utc::now() - chrono::Duration::days(40);
        for i in 0..5 {
            let ts = (old + chrono::Duration::minutes(i))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            insert_execution(&pool, &persona_id, "failed", &ts);
        }
        // 2 failures within the last hour (INSIDE the window).
        let recent = chrono::Utc::now() - chrono::Duration::hours(1);
        for i in 0..2 {
            let ts = (recent + chrono::Duration::minutes(i))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            insert_execution(&pool, &persona_id, "failed", &ts);
        }

        let dash = get_sla_dashboard(&pool, 30).unwrap();
        let row = dash
            .persona_stats
            .iter()
            .find(|p| p.persona_id == persona_id)
            .expect("persona row missing");
        assert_eq!(
            row.consecutive_failures, 2,
            "streak must be bounded to the 30-day window (2 recent), not the 7 total failures",
        );
        assert_eq!(row.failed, 2, "windowed failure count excludes the 40-day-old rows");
    }

    /// The trend read from persisted rollups must match a raw recompute — and
    /// must survive deletion of the raw executions (the retention scenario the
    /// rollups exist for).
    #[test]
    fn daily_trend_parity_rollup_vs_raw() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "trend-parity");

        let now = chrono::Utc::now();
        let ins = |offset_days: i64, minute: i64, status: &str| {
            let ts = (now - chrono::Duration::days(offset_days) + chrono::Duration::minutes(minute))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            insert_execution(&pool, &persona_id, status, &ts);
        };
        // Spread across three days, all inside a 30-day window.
        for i in 0..3 { ins(2, i, "completed"); }
        ins(2, 30, "failed");
        for i in 0..2 { ins(1, i, "completed"); }
        for i in 0..2 { ins(1, 30 + i, "failed"); }
        for i in 0..4 { ins(0, -60 + i, "completed"); } // ~1h ago
        ins(0, -30, "failed");

        // Raw-path trend (no rollups written yet).
        let raw_trend = get_sla_dashboard(&pool, 30).unwrap().daily_trend;
        assert!(!raw_trend.is_empty(), "raw trend must have points");

        // Persist rollups, then delete all raw executions to simulate retention.
        upsert_sla_daily(&pool, server_offset_minutes()).unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute("DELETE FROM persona_executions", []).unwrap();
        }

        // Rollup-path trend must match the raw-path trend exactly.
        let rollup_trend = get_sla_dashboard(&pool, 30).unwrap().daily_trend;
        assert_eq!(
            raw_trend.len(),
            rollup_trend.len(),
            "rollup trend must have the same number of days as the raw trend",
        );
        for (a, b) in raw_trend.iter().zip(rollup_trend.iter()) {
            assert_eq!(a.date, b.date, "day keys must match");
            assert_eq!(a.total, b.total, "total must match for {}", a.date);
            assert_eq!(a.successful, b.successful, "successful must match for {}", a.date);
            assert_eq!(a.failed, b.failed, "failed must match for {}", a.date);
            assert_eq!(a.cancelled, b.cancelled, "cancelled must match for {}", a.date);
            assert!(
                (a.success_rate - b.success_rate).abs() < 1e-9,
                "success_rate must match for {} ({} vs {})",
                a.date, a.success_rate, b.success_rate,
            );
        }
    }

    // -- Direction 2: local-day correctness ----------------------------------

    /// Day bucketing must respect the caller's local offset. Two executions
    /// straddling a UTC midnight but on the SAME local day (for a UTC-8 user)
    /// must land in ONE trend bucket keyed by the local date — not split across
    /// two UTC days. The mirror UTC run proves they WOULD bucket on a DIFFERENT
    /// date without the offset, so the test actually exercises the offset path.
    #[test]
    fn trend_buckets_by_local_day_not_utc() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "tz");

        // UTC-8. Anchor on a recent UTC day (3 days ago) at 06:00 and 07:30 UTC
        // — both before 08:00 UTC, so under UTC-8 they fall on the PREVIOUS
        // local day (22:00 / 23:30). Same local day, same UTC day, but the two
        // dates differ by one — the offset is the only thing that decides which.
        let offset = -480_i64;
        let utc_day = (chrono::Utc::now() - chrono::Duration::days(3)).date_naive();
        let at = |h: u32, m: u32| {
            utc_day
                .and_hms_opt(h, m, 0)
                .unwrap()
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        };
        insert_execution(&pool, &persona_id, "completed", &at(6, 0));
        insert_execution(&pool, &persona_id, "failed", &at(7, 30));

        let utc_date = utc_day.format("%Y-%m-%d").to_string();
        let local_date = (utc_day - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();
        let window = 5_i64; // comfortably covers "3 days ago"

        // Local-offset run: both executions collapse into a single LOCAL day
        // (the day before the UTC day).
        let local = get_sla_dashboard_with_offset(&pool, window, offset).unwrap();
        let local_days: Vec<&str> = local
            .daily_trend
            .iter()
            .filter(|p| p.total > 0)
            .map(|p| p.date.as_str())
            .collect();
        assert_eq!(
            local_days,
            vec![local_date.as_str()],
            "UTC-8 buckets both runs into the single local day {local_date}",
        );
        let point = local.daily_trend.iter().find(|p| p.total > 0).unwrap();
        assert_eq!(point.total, 2);
        assert_eq!(point.successful, 1);
        assert_eq!(point.failed, 1);

        // UTC run (offset 0): the SAME two rows bucket on the UTC date instead,
        // proving the offset is what shifted the day above.
        let utc = get_sla_dashboard_with_offset(&pool, window, 0).unwrap();
        let utc_days: Vec<&str> = utc
            .daily_trend
            .iter()
            .filter(|p| p.total > 0)
            .map(|p| p.date.as_str())
            .collect();
        assert_eq!(
            utc_days,
            vec![utc_date.as_str()],
            "under UTC both runs fall on the UTC day {utc_date}",
        );
        assert_ne!(local_date, utc_date, "the offset must actually shift the day");
    }

    /// Empty timed-execution set surfaces p95 as `None` (→ "N/A"), never 0.0.
    #[test]
    fn p95_is_none_without_timed_executions() {
        assert_eq!(percentile(&[], 95.0), None);
        assert_eq!(percentile(&[100.0, 200.0], 95.0), Some(200.0));

        // End-to-end: a persona with only cancelled (untimed) runs has no p95.
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "no-timed");
        let base = chrono::Utc::now() - chrono::Duration::hours(1);
        for i in 0..3 {
            let ts = (base + chrono::Duration::minutes(i))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            insert_execution(&pool, &persona_id, "cancelled", &ts);
        }
        let dash = get_sla_dashboard(&pool, 30).unwrap();
        let row = dash
            .persona_stats
            .iter()
            .find(|p| p.persona_id == persona_id)
            .expect("persona row missing");
        assert_eq!(row.p95_duration_ms, None, "no timed runs ⇒ p95 is N/A, not 0ms");
    }

    // -- Direction 2: per-persona reliability + daily series -----------------

    #[test]
    fn get_persona_reliability_is_measured_per_persona() {
        let pool = init_test_db().unwrap();
        let p1 = create_test_persona(&pool, "alpha");
        let p2 = create_test_persona(&pool, "beta");
        let now = chrono::Utc::now();
        let ts = |mins: i64| {
            (now - chrono::Duration::minutes(mins))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        };

        // p1: 3 completed + 1 failed → 75%. p2: 1 completed + 3 failed → 25%.
        insert_execution(&pool, &p1, "completed", &ts(10));
        insert_execution(&pool, &p1, "completed", &ts(9));
        insert_execution(&pool, &p1, "completed", &ts(8));
        insert_execution(&pool, &p1, "failed", &ts(7));
        insert_execution(&pool, &p2, "completed", &ts(6));
        insert_execution(&pool, &p2, "failed", &ts(5));
        insert_execution(&pool, &p2, "failed", &ts(4));
        insert_execution(&pool, &p2, "failed", &ts(3));
        // Cancelled is excluded from the decided denominator.
        insert_execution(&pool, &p1, "cancelled", &ts(2));

        let rel = get_persona_reliability(&pool, 30).unwrap();
        let by: std::collections::HashMap<String, &PersonaReliability> =
            rel.iter().map(|r| (r.persona_id.clone(), r)).collect();

        let r1 = by.get(&p1).expect("p1 row");
        assert_eq!(r1.total_decided, 4, "cancelled excluded");
        assert!((r1.success_rate - 0.75).abs() < 1e-9);

        let r2 = by.get(&p2).expect("p2 row");
        assert_eq!(r2.total_decided, 4);
        assert!((r2.success_rate - 0.25).abs() < 1e-9);
    }

    #[test]
    fn get_persona_daily_reliability_buckets_by_day_ascending() {
        let pool = init_test_db().unwrap();
        let p1 = create_test_persona(&pool, "alpha");
        let now = chrono::Utc::now();
        let day_a = (now - chrono::Duration::days(3)).format("%Y-%m-%d").to_string();
        let day_b = (now - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();

        // Day A: 2 completed → 100%. Day B: 1 completed + 1 failed → 50%.
        insert_execution(&pool, &p1, "completed", &format!("{day_a} 10:00:00"));
        insert_execution(&pool, &p1, "completed", &format!("{day_a} 11:00:00"));
        insert_execution(&pool, &p1, "completed", &format!("{day_b} 10:00:00"));
        insert_execution(&pool, &p1, "failed", &format!("{day_b} 11:00:00"));

        // Offset 0 keeps the fixture's UTC day strings authoritative regardless
        // of the host timezone.
        let daily = get_persona_daily_reliability(&pool, 30, 0).unwrap();
        let rows: Vec<&PersonaDailyReliability> =
            daily.iter().filter(|d| d.persona_id == p1).collect();

        assert_eq!(rows.len(), 2, "one row per active day");
        assert_eq!(rows[0].date, day_a, "ordered day-ascending");
        assert!((rows[0].success_rate - 1.0).abs() < 1e-9);
        assert_eq!(rows[1].date, day_b);
        assert!((rows[1].success_rate - 0.5).abs() < 1e-9);
        assert_eq!(rows[1].decided, 2);
    }

    // -- Breach detection: threshold boundaries + episode dedup --------------

    fn recent_ts(mins_ago: i64) -> String {
        (chrono::Utc::now() - chrono::Duration::minutes(mins_ago))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string()
    }

    #[test]
    fn classify_breach_boundaries() {
        // Streak just below the threshold with plenty of successes → no breach.
        let below = BreachSignal {
            consecutive_failures: BREACH_CONSECUTIVE_FAILURES - 1,
            decided: 10,
            successful: 6,
            success_rate: 0.6,
        };
        assert_eq!(classify_breach(&below), None);

        // Streak exactly at the threshold → consecutive-failure breach.
        let streak = BreachSignal {
            consecutive_failures: BREACH_CONSECUTIVE_FAILURES,
            decided: BREACH_CONSECUTIVE_FAILURES,
            successful: 0,
            success_rate: 0.0,
        };
        assert_eq!(classify_breach(&streak), Some("consecutive_failures"));

        // Low rate but below the sample floor → NOT a breach (false-positive guard).
        let thin = BreachSignal {
            consecutive_failures: 0,
            decided: BREACH_MIN_SAMPLE - 1,
            successful: 0,
            success_rate: 0.0,
        };
        assert_eq!(classify_breach(&thin), None);

        // Low rate with enough sample and no streak → rate breach.
        let rate = BreachSignal {
            consecutive_failures: 0,
            decided: 10,
            successful: 4,
            success_rate: 0.4,
        };
        assert_eq!(classify_breach(&rate), Some("low_success_rate"));

        // Exactly at the rate boundary (0.5) is NOT below it → no breach.
        let boundary = BreachSignal {
            consecutive_failures: 0,
            decided: 10,
            successful: 5,
            success_rate: 0.5,
        };
        assert_eq!(classify_breach(&boundary), None);
    }

    #[test]
    fn recovery_has_hysteresis() {
        // In the hysteresis band (rate between 0.5 and 0.75, no streak):
        // not a breach, but also NOT recovered — an open episode stays open.
        let band = BreachSignal {
            consecutive_failures: 0,
            decided: 10,
            successful: 6,
            success_rate: 0.6,
        };
        assert_eq!(classify_breach(&band), None);
        assert!(!is_recovered(&band));
        assert_eq!(decide(true, &band), BreachDecision::NoOp);

        // Clearly healthy → recovered.
        let healthy = BreachSignal {
            consecutive_failures: 0,
            decided: 10,
            successful: 9,
            success_rate: 0.9,
        };
        assert!(is_recovered(&healthy));

        // Quiet persona (too little recent signal) with no streak → recovered.
        let quiet = BreachSignal {
            consecutive_failures: 0,
            decided: 1,
            successful: 1,
            success_rate: 1.0,
        };
        assert!(is_recovered(&quiet));
    }

    #[test]
    fn breach_signal_reads_bounded_streak_and_rate() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "breach-signal");

        // 5 completed (older) then 3 failed (newest) → streak 3, rate 5/8.
        for i in 0..5 {
            insert_execution(&pool, &persona_id, "completed", &recent_ts(100 - i));
        }
        for i in 0..3 {
            insert_execution(&pool, &persona_id, "failed", &recent_ts(10 - i));
        }
        let sig = get_persona_breach_signal(&pool, &persona_id).unwrap();
        assert_eq!(sig.consecutive_failures, 3);
        assert_eq!(sig.decided, 8);
        assert_eq!(sig.successful, 5);
        assert!((sig.success_rate - 5.0 / 8.0).abs() < 1e-9);

        // A cancelled newest run breaks the streak but is excluded from the rate.
        insert_execution(&pool, &persona_id, "cancelled", &recent_ts(1));
        let sig2 = get_persona_breach_signal(&pool, &persona_id).unwrap();
        assert_eq!(sig2.consecutive_failures, 0, "cancelled breaks the streak");
        assert_eq!(sig2.decided, 8, "cancelled excluded from decided");
    }

    /// The full episode lifecycle: ENTER once when the persona crosses into
    /// breach, NO re-emit while it stays breached, RECOVER when it climbs back,
    /// and NO-OP once closed. This is the durable-dedup contract restarts rely
    /// on (the episode row is what `decide` reads, not in-memory state).
    #[test]
    fn breach_episode_enter_once_then_recover() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool, "breach-cycle");
        let now = || chrono::Utc::now().to_rfc3339();

        // Fresh persona, no episode row yet.
        let ep0 = get_breach_episode(&pool, &persona_id).unwrap();
        assert!(!ep0.is_open);

        // Cross into breach: 5 consecutive failures.
        for i in 0..BREACH_CONSECUTIVE_FAILURES {
            insert_execution(&pool, &persona_id, "failed", &recent_ts(50 - i));
        }
        let sig = get_persona_breach_signal(&pool, &persona_id).unwrap();
        let d1 = decide(ep0.is_open, &sig);
        assert_eq!(d1, BreachDecision::Open("consecutive_failures"));
        open_breach_episode(&pool, &persona_id, "consecutive_failures", &sig, &now()).unwrap();

        // Another failing run: episode already open → NO re-emit.
        insert_execution(&pool, &persona_id, "failed", &recent_ts(2));
        let ep1 = get_breach_episode(&pool, &persona_id).unwrap();
        assert!(ep1.is_open);
        assert_eq!(ep1.reason.as_deref(), Some("consecutive_failures"));
        let sig2 = get_persona_breach_signal(&pool, &persona_id).unwrap();
        assert_eq!(
            decide(ep1.is_open, &sig2),
            BreachDecision::NoOp,
            "must not re-emit while the episode is open",
        );

        // Recover: enough fresh successes to clear the streak and beat the
        // hysteresis bar.
        for i in 0..12 {
            insert_execution(&pool, &persona_id, "completed", &recent_ts(0 - i));
        }
        let sig3 = get_persona_breach_signal(&pool, &persona_id).unwrap();
        let ep2 = get_breach_episode(&pool, &persona_id).unwrap();
        assert_eq!(decide(ep2.is_open, &sig3), BreachDecision::Recover);
        close_breach_episode(&pool, &persona_id, &sig3, &now()).unwrap();

        // Closed + healthy → no-op (no duplicate recovery).
        let ep3 = get_breach_episode(&pool, &persona_id).unwrap();
        assert!(!ep3.is_open);
        assert_eq!(decide(ep3.is_open, &sig3), BreachDecision::NoOp);
    }

    /// The `sla_breach_episodes` table must exist on a FRESH schema — the
    /// migration step lives INSIDE `run_incremental`, so `init_test_db` builds
    /// it. (Same guard as `sla_daily_exists_on_fresh_schema`.)
    #[test]
    fn sla_breach_episodes_exists_on_fresh_schema() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM sla_breach_episodes", [], |r| r.get(0))
            .expect("sla_breach_episodes table must exist on a fresh schema");
        assert_eq!(n, 0);
    }
}
