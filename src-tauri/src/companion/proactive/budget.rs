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
    /// Persist a +1 increment. Caller invokes this AFTER a successful
    /// enqueue so a transient error doesn't burn budget.
    pub fn increment(&mut self, pool: &UserDbPool) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO companion_proactive_budget (date, count) VALUES (?1, 1)
             ON CONFLICT(date) DO UPDATE SET count = count + 1",
            params![self.date],
        )?;
        self.used = self.used.saturating_add(1);
        Ok(())
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
