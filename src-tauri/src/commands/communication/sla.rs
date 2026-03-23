use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

// ============================================================================
// Types
// ============================================================================

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
    pub success_rate: f64,
}

// ============================================================================
// Command
// ============================================================================

/// Returns SLA dashboard data: per-persona reliability stats, global aggregates,
/// healing summary, and daily success-rate trend.
#[tauri::command]
pub fn get_sla_dashboard(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
) -> Result<SlaDashboardData, AppError> {
    require_auth_sync(&state)?;
    let pool = &state.db;
    let conn = pool.get()?;
    let days = days.unwrap_or(30).clamp(1, 365);
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

    // Collect persona IDs for batch queries
    let persona_ids: Vec<&str> = raw_personas.iter().map(|rp| rp.persona_id.as_str()).collect();

    // -- Batch P95 durations (1 query instead of N) ----------------------
    let durations_map: std::collections::HashMap<String, Vec<f64>> = if persona_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        let placeholders: Vec<String> = persona_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT persona_id, duration_ms FROM persona_executions
             WHERE persona_id IN ({})
               AND created_at >= datetime('now', ?{})
               AND status IN ('completed', 'failed')
               AND duration_ms IS NOT NULL
             ORDER BY persona_id, duration_ms ASC",
            placeholders.join(", "),
            persona_ids.len() + 1
        );
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = persona_ids
            .iter()
            .map(|s| Box::new(s.to_string()) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        params_vec.push(Box::new(date_filter.clone()));
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        })?;
        let mut map: std::collections::HashMap<String, Vec<f64>> = std::collections::HashMap::new();
        for r in rows {
            let (pid, dur) = r?;
            map.entry(pid).or_default().push(dur);
        }
        map
    };

    // -- Batch MTBF: failure timestamps (1 query instead of N) -----------
    let fail_ts_map: std::collections::HashMap<String, Vec<String>> = if persona_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        let placeholders: Vec<String> = persona_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT persona_id, created_at FROM persona_executions
             WHERE persona_id IN ({})
               AND created_at >= datetime('now', ?{})
               AND status = 'failed'
             ORDER BY persona_id, created_at ASC",
            placeholders.join(", "),
            persona_ids.len() + 1
        );
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = persona_ids
            .iter()
            .map(|s| Box::new(s.to_string()) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        params_vec.push(Box::new(date_filter.clone()));
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        for r in rows {
            let (pid, ts) = r?;
            map.entry(pid).or_default().push(ts);
        }
        map
    };

    // -- Batch consecutive failures: last 20 statuses per persona --------
    // Uses a window function to rank rows, then filters to top-20 per persona.
    let consec_map: std::collections::HashMap<String, i64> = if persona_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        let placeholders: Vec<String> = persona_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT persona_id, status FROM (
                SELECT persona_id, status,
                       ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY created_at DESC) AS rn
                FROM persona_executions
                WHERE persona_id IN ({})
             ) WHERE rn <= 20
             ORDER BY persona_id, rn ASC",
            placeholders.join(", ")
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = persona_ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        // Group statuses by persona, then count leading failures
        let mut statuses_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        for r in rows {
            let (pid, status) = r?;
            statuses_map.entry(pid).or_default().push(status);
        }
        statuses_map
            .into_iter()
            .map(|(pid, statuses)| {
                let count = statuses.iter().take_while(|s| s.as_str() == "failed").count() as i64;
                (pid, count)
            })
            .collect()
    };

    // -- Batch auto-healed count (1 query instead of N) ------------------
    let healed_map: std::collections::HashMap<String, i64> = if persona_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        let placeholders: Vec<String> = persona_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT persona_id, COUNT(*) FROM persona_healing_issues
             WHERE persona_id IN ({}) AND auto_fixed = 1
             GROUP BY persona_id",
            placeholders.join(", ")
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = persona_ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        rows.collect::<Result<std::collections::HashMap<_, _>, _>>()?
    };

    // -- Assemble per-persona stats from batch results -------------------
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

        let success_rate = if rp.total > 0 {
            rp.successful as f64 / rp.total as f64
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

    let global = GlobalSlaStats {
        total_executions: g_total,
        successful: g_success,
        failed: g_failed,
        success_rate: if g_total > 0 { g_success as f64 / g_total as f64 } else { 0.0 },
        avg_duration_ms: g_avg_dur,
        total_cost_usd: g_cost,
        active_persona_count: persona_stats.len() as i64,
    };

    // -- Healing summary -------------------------------------------------
    let open_issues: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_healing_issues WHERE status = 'open'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let auto_fixed_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_healing_issues WHERE auto_fixed = 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let circuit_breaker_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_healing_issues WHERE is_circuit_breaker = 1 AND status = 'open'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let knowledge_patterns: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM healing_knowledge",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let healing_summary = HealingSummary {
        open_issues,
        auto_fixed_count,
        circuit_breaker_count,
        knowledge_patterns,
    };

    // -- Daily trend -----------------------------------------------------
    let mut daily_stmt = conn.prepare(
        "SELECT
            DATE(created_at) AS date,
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successful,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1)
           AND status IN ('completed', 'failed')
         GROUP BY DATE(created_at)
         ORDER BY date ASC",
    )?;

    let daily_trend: Vec<SlaDailyPoint> = daily_stmt
        .query_map(params![date_filter], |row| {
            let total: i64 = row.get(1)?;
            let successful: i64 = row.get(2)?;
            Ok(SlaDailyPoint {
                date: row.get(0)?,
                total,
                successful,
                failed: row.get(3)?,
                success_rate: if total > 0 {
                    successful as f64 / total as f64
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
}

// ============================================================================
// Helpers
// ============================================================================

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
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
