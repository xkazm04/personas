//! Athena auditability — usage + health query commands (Phase A2 of
//! `docs/plans/athena-value-expansion.md`, direction 6).
//!
//! Reads the `companion_turn` ledger (written by `companion::turn_ledger`)
//! plus `companion_proactive_message` / `companion_proactive_budget` /
//! `companion_background_job` — all in the companion user DB — into two
//! dashboard payloads:
//!
//!   * `companion_get_usage_dashboard` → cost / turns / tokens over time and
//!     by action type (Overview → Activity "Athena lane", A3).
//!   * `companion_get_health` → triage funnel, proactive economy, job health
//!     (Overview → Observability "Athena health" panel, A4).
//!
//! Counts are typed `f64` (not `i64`) so the ts-rs bindings emit `number`
//! rather than `bigint` — matching the execution dashboard and keeping the
//! chart code free of bigint coercion. SQLite COUNT/SUM integers coerce to
//! f64 cleanly via rusqlite's `FromSql`.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

// ── Usage dashboard ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaUsageDay {
    pub date: String,
    pub turns: f64,
    pub cost_usd: f64,
    pub input_tokens: f64,
    pub output_tokens: f64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaOriginRollup {
    pub origin: String,
    pub trigger_kind: Option<String>,
    pub turns: f64,
    pub cost_usd: f64,
    pub avg_duration_ms: f64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaUsageTotals {
    pub turns: f64,
    pub cost_usd: f64,
    pub input_tokens: f64,
    pub output_tokens: f64,
    pub avg_cost_per_turn: f64,
    pub voice_turns: f64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaUsageDashboard {
    pub daily: Vec<AthenaUsageDay>,
    pub by_origin: Vec<AthenaOriginRollup>,
    pub totals: AthenaUsageTotals,
}

/// Usage rollup for the last `days` (clamped 1..=365). Cheap aggregation over
/// the indexed `companion_turn` table — no cache.
#[tauri::command]
pub fn companion_get_usage_dashboard(
    state: State<'_, Arc<AppState>>,
    days: u32,
) -> Result<AthenaUsageDashboard, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let days = days.clamp(1, 365);
    let modifier = format!("-{days} days");
    let conn = state.user_db.get()?;

    let daily = {
        let mut stmt = conn.prepare(
            "SELECT date(created_at) AS d,
                    COUNT(*) AS turns,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COALESCE(SUM(input_tokens), 0) AS tin,
                    COALESCE(SUM(output_tokens), 0) AS tout
             FROM companion_turn
             WHERE created_at >= datetime('now', ?1)
             GROUP BY d
             ORDER BY d",
        )?;
        let rows = stmt.query_map([&modifier], |r| {
            Ok(AthenaUsageDay {
                date: r.get(0)?,
                turns: r.get(1)?,
                cost_usd: r.get(2)?,
                input_tokens: r.get(3)?,
                output_tokens: r.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let by_origin = {
        let mut stmt = conn.prepare(
            "SELECT origin, trigger_kind,
                    COUNT(*) AS turns,
                    COALESCE(SUM(cost_usd), 0) AS cost,
                    COALESCE(AVG(duration_ms), 0) AS avg_dur
             FROM companion_turn
             WHERE created_at >= datetime('now', ?1)
             GROUP BY origin, trigger_kind
             ORDER BY cost DESC",
        )?;
        let rows = stmt.query_map([&modifier], |r| {
            Ok(AthenaOriginRollup {
                origin: r.get(0)?,
                trigger_kind: r.get(1)?,
                turns: r.get(2)?,
                cost_usd: r.get(3)?,
                avg_duration_ms: r.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let totals = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(cost_usd), 0),
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(voice), 0)
         FROM companion_turn
         WHERE created_at >= datetime('now', ?1)",
        [&modifier],
        |r| {
            let turns: f64 = r.get(0)?;
            let cost: f64 = r.get(1)?;
            Ok(AthenaUsageTotals {
                turns,
                cost_usd: cost,
                input_tokens: r.get(2)?,
                output_tokens: r.get(3)?,
                avg_cost_per_turn: if turns > 0.0 { cost / turns } else { 0.0 },
                voice_turns: r.get(4)?,
            })
        },
    )?;

    Ok(AthenaUsageDashboard {
        daily,
        by_origin,
        totals,
    })
}

// ── Health ──────────────────────────────────────────────────────────────

#[derive(Debug, Default, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaTriageStats {
    /// Headless triage passes (exec_triage + msg_triage) in the window.
    pub passes: f64,
    pub parse_failures: f64,
    pub drop: f64,
    pub digest: f64,
    pub attention: f64,
    pub deep_dive: f64,
}

#[derive(Debug, Default, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaProactiveStats {
    /// Cards that ever surfaced (status != queued) in the window.
    pub delivered: f64,
    pub engaged: f64,
    pub dismissed: f64,
    pub expired: f64,
    pub budget_used_today: f64,
    pub budget_cap: f64,
}

#[derive(Debug, Default, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaJobStats {
    pub completed: f64,
    pub failed: f64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaHealth {
    pub triage: AthenaTriageStats,
    pub proactive: AthenaProactiveStats,
    pub jobs: AthenaJobStats,
    /// companion_turn rows flagged `is_error` in the window.
    pub errors: f64,
}

/// Operational-quality snapshot for the last `days` (clamped 1..=365).
#[tauri::command]
pub fn companion_get_health(
    state: State<'_, Arc<AppState>>,
    days: u32,
) -> Result<AthenaHealth, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let days = days.clamp(1, 365);
    let modifier = format!("-{days} days");
    let conn = state.user_db.get()?;

    // Triage funnel — sum the verdict counts stored in each triage row's
    // outcome_json. Parsed in Rust (tolerant of shape drift) rather than via
    // json_extract; the row count is bounded by the window.
    let mut triage = AthenaTriageStats::default();
    {
        let mut stmt = conn.prepare(
            "SELECT outcome_json FROM companion_turn
             WHERE origin = 'headless'
               AND trigger_kind IN ('exec_triage', 'msg_triage')
               AND created_at >= datetime('now', ?1)",
        )?;
        let rows = stmt.query_map([&modifier], |r| r.get::<_, Option<String>>(0))?;
        for row in rows {
            triage.passes += 1.0;
            let Some(oj) = row? else { continue };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&oj) else {
                continue;
            };
            if v.get("parse_failure").and_then(|x| x.as_bool()).unwrap_or(false) {
                triage.parse_failures += 1.0;
            }
            let n = |key: &str| v.get(key).and_then(|x| x.as_i64()).unwrap_or(0) as f64;
            triage.drop += n("drop");
            triage.digest += n("digest");
            triage.attention += n("attention");
            triage.deep_dive += n("deep_dive");
        }
    }

    let mut proactive = conn.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN status != 'queued' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'engaged'   THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'expired'   THEN 1 ELSE 0 END), 0)
         FROM companion_proactive_message
         WHERE created_at >= datetime('now', ?1)",
        [&modifier],
        |r| {
            Ok(AthenaProactiveStats {
                delivered: r.get(0)?,
                engaged: r.get(1)?,
                dismissed: r.get(2)?,
                expired: r.get(3)?,
                budget_used_today: 0.0,
                budget_cap: crate::companion::proactive::budget::GLOBAL_DAILY_CAP as f64,
            })
        },
    )?;
    proactive.budget_used_today = conn
        .query_row(
            "SELECT COALESCE(count, 0) FROM companion_proactive_budget WHERE date = date('now')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let jobs = conn.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END), 0)
         FROM companion_background_job
         WHERE created_at >= datetime('now', ?1)",
        [&modifier],
        |r| {
            Ok(AthenaJobStats {
                completed: r.get(0)?,
                failed: r.get(1)?,
            })
        },
    )?;

    let errors: f64 = conn.query_row(
        "SELECT COALESCE(SUM(is_error), 0) FROM companion_turn
         WHERE created_at >= datetime('now', ?1)",
        [&modifier],
        |r| r.get(0),
    )?;

    Ok(AthenaHealth {
        triage,
        proactive,
        jobs,
        errors,
    })
}
