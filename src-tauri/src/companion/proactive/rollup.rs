//! End-of-day rollup card (C3 / direction 2): one daily "what I did, what I
//! dropped" digest so a user who lets Athena run autonomously gets the full
//! audit without the live noise. Composed deterministically from the
//! `companion_turn` ledger + proactive + job tables — no model call.
//!
//! Gated by `companion_daily_rollup` (default off). Fires at most once per local
//! day, at/after `companion_daily_rollup_hour` (default 18), tracked by
//! `companion_daily_rollup_last`. Delivered as a `daily_rollup` ProactiveCard
//! with no budget cost (it's the audit OF the budget, not a spend of it) and
//! deduped on the date.

use chrono::{Local, Timelike};

use crate::db::repos::core::settings;
use crate::db::settings_keys as keys;
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

const TRIGGER_KIND: &str = "daily_rollup";

/// Check whether today's rollup is due and, if so, compose + deliver it.
/// Best-effort: called from the proactive evaluation entry points (manual +
/// desktop tick); a failure logs and is swallowed.
pub fn maybe_emit_daily_rollup(user_db: &UserDbPool, sys_db: &DbPool, app: &tauri::AppHandle) {
    if let Err(e) = try_emit(user_db, sys_db, app) {
        tracing::warn!(error = %e, "daily_rollup: emit failed");
    }
}

fn try_emit(user_db: &UserDbPool, sys_db: &DbPool, app: &tauri::AppHandle) -> Result<(), AppError> {
    let enabled = settings::get(sys_db, keys::COMPANION_DAILY_ROLLUP)?
        .map(|v| v == "true")
        .unwrap_or(keys::COMPANION_DAILY_ROLLUP_DEFAULT);
    if !enabled {
        return Ok(());
    }
    let hour = settings::get(sys_db, keys::COMPANION_DAILY_ROLLUP_HOUR)?
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(keys::COMPANION_DAILY_ROLLUP_HOUR_DEFAULT);
    let now = Local::now();
    if now.hour() < hour {
        return Ok(());
    }
    let today = now.format("%Y-%m-%d").to_string();
    let last = settings::get(sys_db, keys::COMPANION_DAILY_ROLLUP_LAST)?.unwrap_or_default();
    if last == today {
        return Ok(()); // already fired today
    }

    let body = compose_rollup(user_db)?;
    let nudge = super::Nudge {
        trigger_kind: TRIGGER_KIND.to_string(),
        trigger_ref: Some(today.clone()),
        message: body,
    };
    // No budget cost (enqueue_external) — deduped on the date.
    match super::enqueue_external(user_db, &nudge) {
        Ok(Some(msg)) => super::deliver_now(user_db, app, msg),
        Ok(None) => {} // a card for today already exists
        Err(e) => tracing::warn!(error = %e, "daily_rollup: enqueue failed"),
    }
    // Mark fired regardless — the card is delivered or already present; either
    // way today's rollup is handled and shouldn't re-gather every tick.
    settings::set(sys_db, keys::COMPANION_DAILY_ROLLUP_LAST, &today)?;
    Ok(())
}

/// Build the rollup body (UTC-day counts) from the companion user DB. Counts
/// only — each line names where to look. Backend-composed English, matching the
/// existing deterministic cards (message-triage digest, exec-review digest).
fn compose_rollup(user_db: &UserDbPool) -> Result<String, AppError> {
    let conn = user_db.get()?;

    let (turns, cost): (i64, f64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(cost_usd), 0)
         FROM companion_turn WHERE date(created_at) = date('now')",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    // Triage verdict distribution from the headless triage rows' outcome_json.
    let mut passes = 0i64;
    let (mut drop, mut digest, mut attention, mut deep, mut parse_fail) = (0i64, 0i64, 0i64, 0i64, 0i64);
    {
        let mut stmt = conn.prepare(
            "SELECT outcome_json FROM companion_turn
             WHERE origin = 'headless'
               AND trigger_kind IN ('exec_triage', 'msg_triage')
               AND date(created_at) = date('now')",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, Option<String>>(0))?;
        for row in rows {
            passes += 1;
            let Some(oj) = row? else { continue };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&oj) else {
                continue;
            };
            if v.get("parse_failure").and_then(|x| x.as_bool()).unwrap_or(false) {
                parse_fail += 1;
            }
            let n = |k: &str| v.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
            drop += n("drop");
            digest += n("digest");
            attention += n("attention");
            deep += n("deep_dive");
        }
    }

    let (cards, engaged, dismissed): (i64, i64, i64) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(CASE WHEN status = 'engaged'   THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END), 0)
         FROM companion_proactive_message WHERE date(created_at) = date('now')",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    let job_failed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM companion_background_job
         WHERE status = 'failed' AND date(created_at) = date('now')",
        [],
        |r| r.get(0),
    )?;

    let mut s = String::from("**Today's rollup** — the full audit, without the live noise.\n\n");
    s.push_str(&format!("- I ran **{turns}** turn(s) today (${cost:.2}).\n"));
    if passes > 0 {
        s.push_str(&format!(
            "- Triage: **{passes}** pass(es) — {drop} dropped, {digest} digested, {attention} flagged for you, {deep} deep-dived"
        ));
        if parse_fail > 0 {
            s.push_str(&format!(", {parse_fail} parse failure(s)"));
        }
        s.push_str(". (Overview → Executions / Messages)\n");
    }
    s.push_str(&format!(
        "- Proactive cards: **{cards}** created, {engaged} engaged, {dismissed} dismissed.\n"
    ));
    if job_failed > 0 {
        s.push_str(&format!(
            "- ⚠️ **{job_failed}** background job(s) failed today — worth a look. (Overview → Observability)\n"
        ));
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    fn user_pool() -> UserDbPool {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE companion_turn (id TEXT, origin TEXT, trigger_kind TEXT,
                    cost_usd REAL, outcome_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE companion_proactive_message (id TEXT, status TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE companion_background_job (id TEXT, status TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')));",
            )
            .unwrap();
        pool
    }

    #[test]
    fn compose_summarizes_todays_activity() {
        let pool = user_pool();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO companion_turn (id, origin, trigger_kind, cost_usd, outcome_json)
             VALUES ('t1','chat',NULL,0.50,NULL),
                    ('t2','headless','exec_triage',0.02,'{\"drop\":10,\"digest\":2,\"deep_dive\":1}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO companion_proactive_message (id, status) VALUES ('m1','engaged'),('m2','dismissed')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO companion_background_job (id, status) VALUES ('j1','failed')",
            [],
        )
        .unwrap();
        drop(conn); // release the single pooled connection before compose_rollup

        let body = compose_rollup(&pool).unwrap();
        assert!(body.contains("**2** turn(s)"));
        assert!(body.contains("$0.52"));
        assert!(body.contains("**1** pass(es)")); // one triage row
        assert!(body.contains("10 dropped"));
        assert!(body.contains("**2** created"));
        assert!(body.contains("1 engaged"));
        assert!(body.contains("background job(s) failed"));
    }
}
