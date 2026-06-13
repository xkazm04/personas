//! Athena autonomous wake window (docs/plans/athena-wake-window.md).
//!
//! Shared GATE over Athena's autonomous CLI surfaces (exec triage, message
//! triage, channel reactions). The signal queues already exist — every
//! surface persists its signals and reads them through a cursor — so this
//! module only decides WHEN a surface may process: signals accumulate until
//! the surface's last wake is older than the configured window, the backlog
//! passes the queue cap, or a priority signal demands immediate handling.
//! Every actual wake is logged to `athena_wake_log` (the autonomy-impact
//! ledger; skipped ticks are not logged).

use crate::db::DbPool;
use crate::error::AppError;

/// Queue-pressure bypass: a backlog this deep wakes the surface regardless
/// of the window — "dozens of events" should not wait out the timer.
pub const QUEUE_CAP: usize = 25;

#[derive(Debug, Clone, Copy)]
pub struct WakeGate {
    pub due: bool,
    pub reason: &'static str, // reactive | window | queue_size | priority | waiting
}

/// Configured window in minutes; 0/unset/garbage = reactive (legacy).
pub fn window_minutes(pool: &DbPool) -> u64 {
    crate::db::repos::core::settings::get(
        pool,
        crate::db::settings_keys::ATHENA_WAKE_WINDOW_MINUTES,
    )
    .ok()
    .flatten()
    .and_then(|v| v.trim().parse::<u64>().ok())
    .unwrap_or(0)
}

/// Minutes since this surface last actually woke (None = never).
fn minutes_since_last_wake(pool: &DbPool, surface: &str) -> Option<i64> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT CAST((julianday('now') - julianday(MAX(created_at))) * 1440 AS INTEGER)
         FROM athena_wake_log WHERE surface = ?1",
        [surface],
        |r| r.get::<_, Option<i64>>(0),
    )
    .ok()
    .flatten()
}

/// The gate. `pending` is the surface's current backlog size; `has_priority`
/// marks human-blocking signals (awaiting-review cap-outs, high/urgent/critical
/// messages) that must not wait out the window.
pub fn gate(pool: &DbPool, surface: &str, pending: usize, has_priority: bool) -> WakeGate {
    if pending == 0 {
        return WakeGate { due: false, reason: "waiting" };
    }
    let window = window_minutes(pool);
    if window == 0 {
        return WakeGate { due: true, reason: "reactive" };
    }
    if has_priority {
        return WakeGate { due: true, reason: "priority" };
    }
    if pending >= QUEUE_CAP {
        return WakeGate { due: true, reason: "queue_size" };
    }
    match minutes_since_last_wake(pool, surface) {
        None => WakeGate { due: true, reason: "window" }, // first wake ever
        Some(age) if age >= window as i64 => WakeGate { due: true, reason: "window" },
        Some(_) => WakeGate { due: false, reason: "waiting" },
    }
}

/// Record an actual wake — the autonomy-impact ledger. Best-effort.
pub fn log_wake(
    pool: &DbPool,
    surface: &str,
    reason: &str,
    pending: usize,
    cli_calls: usize,
    actions: usize,
    duration_ms: u64,
) {
    let Ok(conn) = pool.get() else { return };
    let _ = conn.execute(
        "INSERT INTO athena_wake_log
           (id, surface, trigger_reason, signals_pending, oldest_age_min,
            cli_calls, actions_taken, duration_ms)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7)",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            surface,
            reason,
            pending as i64,
            cli_calls as i64,
            actions as i64,
            duration_ms as i64,
        ],
    );
}

/// Last-24h aggregates per surface for the Companion impact strip.
pub fn stats_24h(pool: &DbPool) -> Result<serde_json::Value, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT surface, COUNT(*), SUM(signals_pending), SUM(cli_calls), SUM(actions_taken)
         FROM athena_wake_log
         WHERE datetime(created_at) > datetime('now', '-1 day')
         GROUP BY surface ORDER BY surface",
    )?;
    let rows: Vec<serde_json::Value> = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "surface": r.get::<_, String>(0)?,
                "wakes": r.get::<_, i64>(1)?,
                "signals": r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                "cli_calls": r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                "actions": r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            }))
        })?
        .filter_map(Result::ok)
        .collect();
    Ok(serde_json::json!({
        "window_minutes": window_minutes(pool),
        "surfaces": rows,
    }))
}
