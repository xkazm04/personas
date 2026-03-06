use std::collections::HashMap;
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
    /// Success rate as 0.0–1.0.
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
    let days = days.unwrap_or(30);
    let date_filter = format!("-{} days", days);

    // ── Per-persona aggregates ──────────────────────────────────────────
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
        .filter_map(|r| r.ok())
        .collect();

    // ── P95 duration per persona (separate query for percentile) ────────
    let mut p95_stmt = conn.prepare(
        "SELECT duration_ms FROM persona_executions
         WHERE persona_id = ?1
           AND created_at >= datetime('now', ?2)
           AND status IN ('completed', 'failed')
           AND duration_ms IS NOT NULL
         ORDER BY duration_ms ASC",
    )?;

    // ── MTBF per persona: timestamps of failures ────────────────────────
    let mut fail_ts_stmt = conn.prepare(
        "SELECT created_at FROM persona_executions
         WHERE persona_id = ?1
           AND created_at >= datetime('now', ?2)
           AND status = 'failed'
         ORDER BY created_at ASC",
    )?;

    // ── Consecutive failures per persona ────────────────────────────────
    let mut consec_stmt = conn.prepare(
        "SELECT status FROM persona_executions
         WHERE persona_id = ?1
         ORDER BY created_at DESC
         LIMIT 20",
    )?;

    // ── Auto-healed count per persona ───────────────────────────────────
    let mut healed_stmt = conn.prepare(
        "SELECT COUNT(*) FROM persona_healing_issues
         WHERE persona_id = ?1 AND auto_fixed = 1",
    )?;

    let mut persona_stats: Vec<PersonaSlaStats> = Vec::new();

    for rp in &raw_personas {
        // P95
        let durations: Vec<f64> = p95_stmt
            .query_map(params![rp.persona_id, date_filter], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        let p95 = percentile(&durations, 95.0);

        // MTBF
        let fail_times: Vec<String> = fail_ts_stmt
            .query_map(params![rp.persona_id, date_filter], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        let mtbf = compute_mtbf(&fail_times);

        // Consecutive failures
        let recent_statuses: Vec<String> = consec_stmt
            .query_map(params![rp.persona_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        let consecutive_failures = recent_statuses
            .iter()
            .take_while(|s| s.as_str() == "failed")
            .count() as i64;

        // Auto-healed
        let auto_healed: i64 = healed_stmt
            .query_row(params![rp.persona_id], |row| row.get(0))
            .unwrap_or(0);

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

    // ── Global aggregates ───────────────────────────────────────────────
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

    // ── Healing summary ─────────────────────────────────────────────────
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

    // ── Daily trend ─────────────────────────────────────────────────────
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
        .filter_map(|r| r.ok())
        .collect();

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
