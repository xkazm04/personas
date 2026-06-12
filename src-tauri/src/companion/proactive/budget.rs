//! Daily proactive-message budget. Tracked per UTC date; crossing midnight UTC
//! resets cleanly without a cron — the next `today()` call sees fresh rows.
//!
//! Two layers (C2 — per-source attention budgets):
//!   - a **global ceiling** ([`GLOBAL_DAILY_CAP`]) over all proactive deliveries
//!     in a day, counted in `companion_proactive_budget(date, count)`;
//!   - a **per-trigger-kind cap** ([`kind_cap`]) counted in
//!     `companion_attention_budget(date, trigger_kind, count)`, so one noisy leg
//!     (e.g. execution reviews) can't crowd out another's cards within the day.
//!
//! A delivery must claim BOTH (atomically, in one transaction) to surface. The
//! single pre-C2 cap of 3 was both too coarse (every kind shared it) and too
//! tight once the kinds multiplied — the global ceiling now sits at 12 with
//! per-kind sub-budgets underneath.

use chrono::Utc;
use rusqlite::{params, OptionalExtension};

use crate::db::UserDbPool;
use crate::error::AppError;

/// Hard ceiling on total proactive deliveries per UTC day, across all kinds.
pub const GLOBAL_DAILY_CAP: u32 = 12;

/// Per-kind cap when a trigger kind isn't specifically listed.
const FALLBACK_KIND_CAP: u32 = 3;

/// Daily cap for one trigger kind. Chosen so high-value but bursty kinds
/// (incidents) get more room than chatty ones, and a user-consented scheduled
/// check-in is never throttled by its own kind (only the global ceiling).
pub fn kind_cap(kind: &str) -> u32 {
    // Scheduled check-ins were explicitly requested by the user — no per-kind
    // throttle (they still count toward the global ceiling).
    if kind == "athena_scheduled" {
        return u32::MAX;
    }
    // Goal nudges (dev_goal_target / dev_goal_stalled / …) share a small budget.
    if kind.starts_with("dev_goal") {
        return 2;
    }
    match kind {
        "execution_review" => 4,
        "message_digest" => 4,
        "incident_blocker" => 6,
        "message_attention" => 8,
        _ => FALLBACK_KIND_CAP,
    }
}

#[derive(Debug)]
pub struct DailyBudget {
    pub date: String,
    /// Global units consumed today (across all kinds).
    pub used: u32,
    /// Global ceiling ([`GLOBAL_DAILY_CAP`]).
    pub cap: u32,
}

impl DailyBudget {
    pub fn cap(&self) -> u32 {
        self.cap
    }

    /// True once the global ceiling is reached — the evaluate loop breaks here.
    pub fn is_exhausted(&self) -> bool {
        self.used >= self.cap
    }

    /// Atomically claim one unit for `kind`: the delivery must fit under BOTH
    /// the global ceiling and the per-kind cap. Returns `true` if both were
    /// available (and have now been consumed), `false` otherwise. Both
    /// conditional UPDATEs run in one transaction, so the global increment is
    /// rolled back if the per-kind cap blocks the claim — no double-counting,
    /// and concurrent passes can never burst past either cap (the atomic-claim
    /// guarantee from bug-hunt 2026-06-07 companion #2, now per-kind). Call
    /// AFTER a successful enqueue so a transient error doesn't burn budget.
    pub fn try_consume(&mut self, pool: &UserDbPool, kind: &str) -> Result<bool, AppError> {
        let cap_kind = kind_cap(kind);
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        // Ensure both counter rows exist so the conditional UPDATEs have a row.
        tx.execute(
            "INSERT OR IGNORE INTO companion_proactive_budget (date, count) VALUES (?1, 0)",
            params![self.date],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO companion_attention_budget (date, trigger_kind, count) VALUES (?1, ?2, 0)",
            params![self.date, kind],
        )?;
        // Global ceiling first.
        let g = tx.execute(
            "UPDATE companion_proactive_budget SET count = count + 1 WHERE date = ?1 AND count < ?2",
            params![self.date, GLOBAL_DAILY_CAP],
        )?;
        if g != 1 {
            tx.rollback()?;
            self.used = self.cap;
            return Ok(false);
        }
        // Per-kind cap. A failure rolls back the global increment too.
        let k = tx.execute(
            "UPDATE companion_attention_budget SET count = count + 1
             WHERE date = ?1 AND trigger_kind = ?2 AND count < ?3",
            params![self.date, kind, cap_kind],
        )?;
        if k != 1 {
            tx.rollback()?;
            return Ok(false);
        }
        tx.commit()?;
        self.used = self.used.saturating_add(1);
        Ok(true)
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
        cap: GLOBAL_DAILY_CAP,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    fn test_pool() -> UserDbPool {
        // A single private :memory: connection — try_consume opens a write
        // transaction, and shared-cache in-memory mode would dead-lock a second
        // pooled connection on the same table (SQLITE_LOCKED). Production uses a
        // file-backed WAL pool where this isn't an issue; max_size 1 serializes
        // the test cleanly.
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS companion_proactive_budget (
                    date TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE IF NOT EXISTS companion_attention_budget (
                    date TEXT NOT NULL, trigger_kind TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (date, trigger_kind));",
            )
            .unwrap();
        pool
    }

    #[test]
    fn kind_caps() {
        assert_eq!(kind_cap("athena_scheduled"), u32::MAX);
        assert_eq!(kind_cap("dev_goal_target"), 2);
        assert_eq!(kind_cap("incident_blocker"), 6);
        assert_eq!(kind_cap("something_else"), FALLBACK_KIND_CAP);
    }

    #[test]
    fn per_kind_cap_blocks_before_global() {
        let pool = test_pool();
        let mut b = today(&pool).unwrap();
        // message_digest cap is 4 — the 5th claim fails on the per-kind cap even
        // though the global ceiling (12) still has room.
        for _ in 0..4 {
            assert!(b.try_consume(&pool, "message_digest").unwrap());
        }
        assert!(!b.try_consume(&pool, "message_digest").unwrap());
        // A different kind still has its own budget.
        assert!(b.try_consume(&pool, "incident_blocker").unwrap());
    }

    #[test]
    fn global_ceiling_blocks_all_kinds() {
        let pool = test_pool();
        let mut b = today(&pool).unwrap();
        // Spend the whole global ceiling across roomy kinds.
        for _ in 0..6 {
            assert!(b.try_consume(&pool, "incident_blocker").unwrap());
        }
        for _ in 0..6 {
            assert!(b.try_consume(&pool, "message_attention").unwrap());
        }
        assert!(b.is_exhausted());
        // Global is full → even a fresh kind can't claim.
        assert!(!b.try_consume(&pool, "execution_review").unwrap());
    }
}
