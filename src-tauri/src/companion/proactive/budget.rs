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

// ── F4: engagement-modulated caps (spend the profile) ─────────────────────
//
// The static per-kind caps adapt to how the user actually responds: a kind the
// user reliably dismisses gets throttled; one they reliably engage gets a touch
// more room. ±1 only, within hard bounds, requires enough signal to act — and
// it only ever changes how OFTEN cards appear, never the message-triage safety
// floor (high/urgent/critical can't be auto-resolved regardless — that's
// enforced in message_triage, not here) and never the attention tier.

/// Minimum 30-day engage+dismiss samples before modulation kicks in.
const MODULATION_MIN_N: i64 = 5;

/// The ±1 adjustment from engagement: dismissed ≥80% → −1; engaged ≥60% → +1;
/// else 0. `None`-equivalent (0) below the sample floor.
fn adjustment(engaged: i64, dismissed: i64) -> i64 {
    let total = engaged + dismissed;
    if total < MODULATION_MIN_N {
        return 0;
    }
    let dismiss_rate = dismissed as f64 / total as f64;
    let engage_rate = engaged as f64 / total as f64;
    if dismiss_rate >= 0.80 {
        -1
    } else if engage_rate >= 0.60 {
        1
    } else {
        0
    }
}

/// 30-day engaged vs dismissed for one kind.
fn engagement_30d(conn: &rusqlite::Connection, kind: &str) -> (i64, i64) {
    conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN status = 'engaged'   THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END), 0)
         FROM companion_proactive_message
         WHERE trigger_kind = ?1 AND created_at >= datetime('now', '-30 days')
           AND status IN ('engaged', 'dismissed')",
        params![kind],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .unwrap_or((0, 0))
}

/// The effective per-kind cap after engagement modulation. Scheduled check-ins
/// (uncapped) and kinds without enough signal return their static cap.
fn effective_kind_cap(conn: &rusqlite::Connection, kind: &str) -> u32 {
    let base = kind_cap(kind);
    if base == u32::MAX {
        return base;
    }
    let (engaged, dismissed) = engagement_30d(conn, kind);
    let adj = adjustment(engaged, dismissed);
    if adj != 0 {
        tracing::debug!(kind, base, adj, engaged, dismissed, "budget: engagement-modulated cap");
    }
    ((base as i64 + adj).clamp(1, base as i64 + 2)) as u32
}

/// One kind's adapted budget, for the transparency surface ("what Athena
/// adapts").
#[derive(Debug, Clone)]
pub struct KindModulation {
    pub kind: String,
    pub base_cap: u32,
    pub effective_cap: u32,
    pub engaged: i64,
    pub dismissed: i64,
}

/// Active engagement modulations — every kind with ≥[`MODULATION_MIN_N`] signal
/// in the last 30 days whose effective cap differs from its base. Best-effort.
pub fn modulations_summary(pool: &UserDbPool) -> Vec<KindModulation> {
    let Ok(conn) = pool.get() else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT trigger_kind,
                COALESCE(SUM(CASE WHEN status = 'engaged'   THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END), 0)
         FROM companion_proactive_message
         WHERE created_at >= datetime('now', '-30 days') AND status IN ('engaged', 'dismissed')
         GROUP BY trigger_kind",
    ) else {
        return Vec::new();
    };
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
        })
        .map(|it| it.filter_map(Result::ok).collect::<Vec<_>>())
        .unwrap_or_default();

    let mut out = Vec::new();
    for (kind, engaged, dismissed) in rows {
        let base = kind_cap(&kind);
        if base == u32::MAX {
            continue;
        }
        let adj = adjustment(engaged, dismissed);
        if adj == 0 {
            continue; // only surface kinds we actually adapted
        }
        let effective = ((base as i64 + adj).clamp(1, base as i64 + 2)) as u32;
        out.push(KindModulation {
            kind,
            base_cap: base,
            effective_cap: effective,
            engaged,
            dismissed,
        });
    }
    out.sort_by(|a, b| a.kind.cmp(&b.kind));
    out
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
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        // F4: the per-kind cap adapts to how the user responds to this kind.
        let cap_kind = effective_kind_cap(&tx, kind);
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
                    PRIMARY KEY (date, trigger_kind));
                 CREATE TABLE IF NOT EXISTS companion_proactive_message (
                    id TEXT, trigger_kind TEXT, status TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')));",
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
    fn adjustment_rules() {
        assert_eq!(adjustment(0, 0), 0); // no signal
        assert_eq!(adjustment(1, 3), 0); // total < MIN_N
        assert_eq!(adjustment(1, 9), -1); // 90% dismissed
        assert_eq!(adjustment(7, 3), 1); // 70% engaged
        assert_eq!(adjustment(4, 4), 0); // mixed
    }

    #[test]
    fn dismiss_heavy_kind_is_throttled() {
        let pool = test_pool();
        {
            let c = pool.get().unwrap();
            // message_digest (base cap 4) dismissed 9/10 → effective 3.
            for i in 0..9 {
                c.execute(
                    "INSERT INTO companion_proactive_message (id, trigger_kind, status) VALUES (?1, 'message_digest', 'dismissed')",
                    params![format!("d{i}")],
                ).unwrap();
            }
            c.execute(
                "INSERT INTO companion_proactive_message (id, trigger_kind, status) VALUES ('e0', 'message_digest', 'engaged')",
                [],
            ).unwrap();
        }
        // The effective cap is 3, so the 4th claim fails (base would allow 4).
        let mut b = today(&pool).unwrap();
        for _ in 0..3 {
            assert!(b.try_consume(&pool, "message_digest").unwrap());
        }
        assert!(!b.try_consume(&pool, "message_digest").unwrap());

        let mods = modulations_summary(&pool);
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].kind, "message_digest");
        assert_eq!(mods[0].base_cap, 4);
        assert_eq!(mods[0].effective_cap, 3);
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
