//! Daily proactive-message budget. Default cap is 3/day — enough to
//! catch a stale goal, an aging promise, and a cadence-due ritual in
//! the same day, without becoming background noise.
//!
//! The budget is tracked per UTC date. Crossing midnight UTC resets it
//! cleanly without needing a cron job — the next `today()` call sees
//! a fresh row.

use chrono::Utc;
use rusqlite::{params, OptionalExtension};

use crate::db::UserDbPool;
use crate::error::AppError;

/// Hard cap on proactive deliveries per UTC day. The current value is
/// chosen for one user (Michal) — multi-tenant deployments would want
/// this configurable. For now the constant captures the design intent.
pub const DAILY_CAP: u32 = 3;

#[derive(Debug)]
pub struct DailyBudget {
    pub date: String,
    pub used: u32,
    pub cap: u32,
}

impl DailyBudget {
    pub fn cap(&self) -> u32 {
        self.cap
    }
    pub fn is_exhausted(&self) -> bool {
        self.used >= self.cap
    }
    /// Atomically claim one unit of today's budget. Returns `true` if a unit was
    /// available and has now been consumed, `false` if the cap is already
    /// reached. The check-and-increment is a single conditional UPDATE, so two
    /// evaluate passes that overlap (background tick + a manual "evaluate now",
    /// or the trigger path and the scheduled-delivery path within one pass) can
    /// never both deliver up to the cap. The previous read-then-increment let
    /// each pass independently burst to the cap → up to 2× the intended nudges
    /// (bug-hunt 2026-06-07 companion #2). Call AFTER a successful enqueue so a
    /// transient error doesn't burn budget.
    pub fn try_consume(&mut self, pool: &UserDbPool) -> Result<bool, AppError> {
        let conn = pool.get()?;
        // Ensure today's row exists so the conditional UPDATE has a row to gate.
        conn.execute(
            "INSERT OR IGNORE INTO companion_proactive_budget (date, count) VALUES (?1, 0)",
            params![self.date],
        )?;
        let claimed = conn.execute(
            "UPDATE companion_proactive_budget SET count = count + 1 \
             WHERE date = ?1 AND count < ?2",
            params![self.date, self.cap],
        )?;
        if claimed == 1 {
            self.used = self.used.saturating_add(1);
            Ok(true)
        } else {
            // Cap reached (possibly by a concurrent pass) — reflect it locally.
            self.used = self.cap;
            Ok(false)
        }
    }
}

pub fn today(pool: &UserDbPool) -> Result<DailyBudget, AppError> {
    let date = Utc::now().format("%Y-%m-%d").to_string();
    let conn = pool.get()?;
    let used: u32 = conn
        .query_row(
            "SELECT count FROM companion_proactive_budget WHERE date = ?1",
            params![date],
            |r| r.get::<_, u32>(0),
        )
        .optional()?
        .unwrap_or(0);
    Ok(DailyBudget {
        date,
        used,
        cap: DAILY_CAP,
    })
}
