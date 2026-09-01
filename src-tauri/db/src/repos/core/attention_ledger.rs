//! Repository for `persona_attention_ledger` — one row per attention or
//! consolidation pass (migration `e16_living_agent`).
//!
//! Lifecycle: [`insert_started`] opens a row with `verdict = 'started'` and no
//! `completed_at`; [`complete`] stamps the terminal verdict + stats + cost;
//! [`insert_refusal`] records a pass that was refused before it ever started
//! (rate cap, quiet hours) as an already-terminal row. `last_completed` and
//! `count_today` are the scheduler's two questions: "where did the last pass
//! stop?" and "have we hit today's cap?".

use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::{AttentionLedgerEntry, AttentionLoopSummary};
use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// Every full-row read goes through this projection — exactly the columns
/// `row_to_entry` consumes, nothing else.
const COLUMNS: &str = "id, persona_id, responsibility_id, kind, lane, verdict, \
     reason, consumed_through, stats_json, cost_usd, started_at, completed_at";

row_mapper!(row_to_entry -> AttentionLedgerEntry {
    id, persona_id, responsibility_id, kind, lane, verdict,
    reason, consumed_through, stats_json, cost_usd, started_at, completed_at,
});

/// Open a pass. `kind` must be 'attention' | 'consolidation' (DB CHECK).
/// Returns the new row's id, which [`complete`] later closes.
pub fn insert_started(
    pool: &DbPool,
    persona_id: &str,
    responsibility_id: Option<&str>,
    kind: &str,
    lane: Option<&str>,
) -> Result<String, AppError> {
    timed_query!(
        "persona_attention_ledger",
        "attention_ledger::insert_started",
        {
            let id = format!("att_{}", Uuid::new_v4().simple());
            let conn = pool.conn("attention_ledger::insert_started")?;
            conn.execute(
                "INSERT INTO persona_attention_ledger
                (id, persona_id, responsibility_id, kind, lane, verdict, reason, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'started', '', ?6)",
                params![
                    id,
                    persona_id,
                    responsibility_id,
                    kind,
                    lane,
                    chrono::Utc::now().to_rfc3339(),
                ],
            )?;
            Ok(id)
        }
    )
}

/// Close a pass with its terminal verdict ('acted' | 'noop' | 'failed' | ...).
/// `consumed_through` is the episode watermark the pass consumed up to; pass
/// `None` to leave whatever an earlier write recorded. Returns whether the row
/// existed and was still open (a second complete on the same id is a no-op).
#[allow(clippy::too_many_arguments)]
pub fn complete(
    pool: &DbPool,
    id: &str,
    verdict: &str,
    reason: &str,
    consumed_through: Option<&str>,
    stats_json: Option<&str>,
    cost_usd: Option<f64>,
) -> Result<bool, AppError> {
    timed_query!("persona_attention_ledger", "attention_ledger::complete", {
        let conn = pool.conn("attention_ledger::complete")?;
        let updated = conn.execute(
            "UPDATE persona_attention_ledger
             SET verdict = ?1,
                 reason = ?2,
                 consumed_through = COALESCE(?3, consumed_through),
                 stats_json = ?4,
                 cost_usd = ?5,
                 completed_at = ?6
             WHERE id = ?7 AND completed_at IS NULL",
            params![
                verdict,
                reason,
                consumed_through,
                stats_json,
                cost_usd,
                chrono::Utc::now().to_rfc3339(),
                id,
            ],
        )?;
        Ok(updated > 0)
    })
}

/// Record a pass refused before it started (rate cap, quiet hours, budget).
/// The row lands already terminal: `verdict = 'refused'`, completed at insert.
pub fn insert_refusal(
    pool: &DbPool,
    persona_id: &str,
    responsibility_id: Option<&str>,
    kind: &str,
    lane: Option<&str>,
    reason: &str,
) -> Result<String, AppError> {
    timed_query!(
        "persona_attention_ledger",
        "attention_ledger::insert_refusal",
        {
            let id = format!("att_{}", Uuid::new_v4().simple());
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.conn("attention_ledger::insert_refusal")?;
            conn.execute(
                "INSERT INTO persona_attention_ledger
                (id, persona_id, responsibility_id, kind, lane, verdict, reason,
                 started_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'refused', ?6, ?7, ?7)",
                params![id, persona_id, responsibility_id, kind, lane, reason, now],
            )?;
            Ok(id)
        }
    )
}

/// A persona's passes, newest first.
pub fn list_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: u32,
) -> Result<Vec<AttentionLedgerEntry>, AppError> {
    timed_query!(
        "persona_attention_ledger",
        "attention_ledger::list_by_persona",
        {
            let conn = pool.conn("attention_ledger::list_by_persona")?;
            let mut stmt = conn.prepare_cached(&format!(
                "SELECT {COLUMNS} FROM persona_attention_ledger
             WHERE persona_id = ?1
             ORDER BY started_at DESC, id DESC
             LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![persona_id, limit], row_to_entry)?;
            Ok(collect_rows(rows, "attention_ledger::list_by_persona"))
        }
    )
}

/// The most recent COMPLETED pass of `kind` — the scheduler reads its
/// `consumed_through` watermark to resume, and its `completed_at` to space
/// the next run. Open ('started', un-completed) rows are invisible here.
pub fn last_completed(
    pool: &DbPool,
    persona_id: &str,
    kind: &str,
) -> Result<Option<AttentionLedgerEntry>, AppError> {
    timed_query!(
        "persona_attention_ledger",
        "attention_ledger::last_completed",
        {
            let conn = pool.conn("attention_ledger::last_completed")?;
            let mut stmt = conn.prepare_cached(&format!(
                "SELECT {COLUMNS} FROM persona_attention_ledger
             WHERE persona_id = ?1 AND kind = ?2 AND completed_at IS NOT NULL
             ORDER BY started_at DESC, id DESC
             LIMIT 1"
            ))?;
            stmt.query_row(params![persona_id, kind], row_to_entry)
                .optional()
                .map_err(AppError::Database)
        }
    )
}

/// Open passes of `kind` — `started` rows with no completion — newest first.
/// The attention scheduler's in-flight probe: a young open row refuses a new
/// pass; a stale one (older than its window) is ignored and narrated.
pub fn list_open(
    pool: &DbPool,
    persona_id: &str,
    kind: &str,
) -> Result<Vec<AttentionLedgerEntry>, AppError> {
    timed_query!("persona_attention_ledger", "attention_ledger::list_open", {
        let conn = pool.conn("attention_ledger::list_open")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_attention_ledger
             WHERE persona_id = ?1 AND kind = ?2 AND completed_at IS NULL
             ORDER BY started_at DESC, id DESC"
        ))?;
        let rows = stmt.query_map(params![persona_id, kind], row_to_entry)?;
        Ok(collect_rows(rows, "attention_ledger::list_open"))
    })
}

/// The newest row of `kind` regardless of verdict or completion — the
/// refusal-dedupe read ("is the latest entry already this same refusal?").
pub fn last_row(
    pool: &DbPool,
    persona_id: &str,
    kind: &str,
) -> Result<Option<AttentionLedgerEntry>, AppError> {
    timed_query!("persona_attention_ledger", "attention_ledger::last_row", {
        let conn = pool.conn("attention_ledger::last_row")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_attention_ledger
             WHERE persona_id = ?1 AND kind = ?2
             ORDER BY started_at DESC, id DESC
             LIMIT 1"
        ))?;
        stmt.query_row(params![persona_id, kind], row_to_entry)
            .optional()
            .map_err(AppError::Database)
    })
}

/// Per-responsibility newest `started_at` for `(kind, lane)`, refusals
/// excluded — the advance lane's rotation input (least-recently-advanced
/// charter first, derived from history rather than a stored cursor).
pub fn latest_started_per_responsibility(
    pool: &DbPool,
    persona_id: &str,
    kind: &str,
    lane: &str,
) -> Result<Vec<(String, String)>, AppError> {
    timed_query!(
        "persona_attention_ledger",
        "attention_ledger::latest_started_per_responsibility",
        {
            let conn = pool.conn("attention_ledger::latest_started_per_responsibility")?;
            let mut stmt = conn.prepare_cached(
                "SELECT responsibility_id, MAX(started_at) AS latest
                 FROM persona_attention_ledger
                 WHERE persona_id = ?1 AND kind = ?2 AND lane = ?3
                   AND responsibility_id IS NOT NULL
                   AND verdict != 'refused'
                 GROUP BY responsibility_id",
            )?;
            let rows = stmt.query_map(params![persona_id, kind, lane], |r| {
                Ok((
                    r.get::<_, String>("responsibility_id")?,
                    r.get::<_, String>("latest")?,
                ))
            })?;
            Ok(collect_rows(
                rows,
                "attention_ledger::latest_started_per_responsibility",
            ))
        }
    )
}

/// How many passes of `kind` started today (UTC), for the max-runs-per-day
/// cap. `lane = Some(..)` narrows to one lane; `None` counts every lane.
/// Refusal rows are excluded — a refused pass never ran, and counting it
/// would make the cap self-tightening.
pub fn count_today(
    pool: &DbPool,
    persona_id: &str,
    kind: &str,
    lane: Option<&str>,
) -> Result<i64, AppError> {
    timed_query!(
        "persona_attention_ledger",
        "attention_ledger::count_today",
        {
            let conn = pool.conn("attention_ledger::count_today")?;
            let count: i64 = match lane {
                Some(l) => conn.query_row(
                    "SELECT COUNT(*) AS n FROM persona_attention_ledger
                 WHERE persona_id = ?1 AND kind = ?2 AND lane = ?3
                   AND verdict != 'refused'
                   AND date(started_at) = date('now')",
                    params![persona_id, kind, l],
                    |r| r.get("n"),
                )?,
                None => conn.query_row(
                    "SELECT COUNT(*) AS n FROM persona_attention_ledger
                 WHERE persona_id = ?1 AND kind = ?2
                   AND verdict != 'refused'
                   AND date(started_at) = date('now')",
                    params![persona_id, kind],
                    |r| r.get("n"),
                )?,
            };
            Ok(count)
        }
    )
}

/// Fleet-wide aggregate for the Overview status tile: the newest ledger row
/// overall (any persona, any verdict — `None` only when the ledger is empty)
/// plus today's (UTC) counts: dispatched lanes, refusals, enqueued
/// consolidations, and distinct personas served (non-refused).
pub fn summary_today(pool: &DbPool) -> Result<AttentionLoopSummary, AppError> {
    timed_query!(
        "persona_attention_ledger",
        "attention_ledger::summary_today",
        {
            let conn = pool.conn("attention_ledger::summary_today")?;
            let latest = {
                let mut stmt = conn.prepare_cached(&format!(
                    "SELECT {COLUMNS} FROM persona_attention_ledger
                 ORDER BY started_at DESC, id DESC
                 LIMIT 1"
                ))?;
                stmt.query_row([], row_to_entry)
                    .optional()
                    .map_err(AppError::Database)?
            };
            // CASE-form conditional aggregates (not FILTER) so the one scan
            // stays portable across the SQLite versions the app links.
            let (dispatched, refused, consolidations, personas) = conn.query_row(
                "SELECT
                    COALESCE(SUM(CASE WHEN verdict = 'dispatched' THEN 1 ELSE 0 END), 0) AS dispatched,
                    COALESCE(SUM(CASE WHEN verdict = 'refused' THEN 1 ELSE 0 END), 0) AS refused,
                    COALESCE(SUM(CASE WHEN kind = 'consolidation' AND verdict = 'enqueued' THEN 1 ELSE 0 END), 0) AS consolidations,
                    COUNT(DISTINCT CASE WHEN verdict != 'refused' THEN persona_id END) AS personas
                 FROM persona_attention_ledger
                 WHERE date(started_at) = date('now')",
                [],
                |r| {
                    Ok((
                        r.get::<_, i64>("dispatched")?,
                        r.get::<_, i64>("refused")?,
                        r.get::<_, i64>("consolidations")?,
                        r.get::<_, i64>("personas")?,
                    ))
                },
            )?;
            Ok(AttentionLoopSummary {
                latest,
                dispatched_today: dispatched,
                refused_today: refused,
                consolidations_today: consolidations,
                personas_served_today: personas,
            })
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn insert_persona(pool: &DbPool, id: &str) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES (?1, ?1, 'sp', datetime('now'), datetime('now'))",
            params![id],
        )?;
        Ok(())
    }

    #[test]
    fn started_then_complete_lifecycle() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1")?;
        let id = insert_started(&pool, "p1", Some("resp-1"), "attention", Some("signal"))?;

        // Open row: visible in the list, invisible to last_completed.
        let open = list_by_persona(&pool, "p1", 10)?;
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].verdict, "started");
        assert!(open[0].completed_at.is_none());
        assert!(last_completed(&pool, "p1", "attention")?.is_none());

        assert!(complete(
            &pool,
            &id,
            "acted",
            "posted a report",
            Some("2026-01-01T00:00:05Z"),
            Some(r#"{"episodes":4}"#),
            Some(0.12),
        )?);

        let last = last_completed(&pool, "p1", "attention")?.expect("row");
        assert_eq!(last.id, id);
        assert_eq!(last.verdict, "acted");
        assert_eq!(
            last.consumed_through.as_deref(),
            Some("2026-01-01T00:00:05Z")
        );
        assert_eq!(last.cost_usd, Some(0.12));

        // Re-completing a closed row is a no-op, not an overwrite.
        assert!(!complete(&pool, &id, "failed", "", None, None, None)?);
        let still = last_completed(&pool, "p1", "attention")?.unwrap();
        assert_eq!(still.verdict, "acted");
        Ok(())
    }

    #[test]
    fn last_completed_is_kind_scoped() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1")?;
        let a = insert_started(&pool, "p1", None, "attention", None)?;
        complete(&pool, &a, "noop", "", None, None, None)?;
        assert!(
            last_completed(&pool, "p1", "consolidation")?.is_none(),
            "an attention pass must not answer for consolidation"
        );
        Ok(())
    }

    #[test]
    fn list_open_and_last_row_see_what_the_completed_reads_hide() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1")?;
        let open = insert_started(&pool, "p1", None, "attention", Some("advance"))?;
        assert!(last_completed(&pool, "p1", "attention")?.is_none());

        let open_rows = list_open(&pool, "p1", "attention")?;
        assert_eq!(open_rows.len(), 1);
        assert_eq!(open_rows[0].id, open);
        assert!(list_open(&pool, "p1", "consolidation")?.is_empty());

        // last_row sees the OPEN row (last_completed cannot), and after a
        // refusal lands it moves to the newest entry regardless of verdict.
        assert_eq!(last_row(&pool, "p1", "attention")?.unwrap().id, open);
        complete(&pool, &open, "dispatched", "", None, None, None)?;
        assert!(list_open(&pool, "p1", "attention")?.is_empty());
        let refusal = insert_refusal(&pool, "p1", None, "attention", None, "quiet")?;
        assert_eq!(last_row(&pool, "p1", "attention")?.unwrap().id, refusal);
        Ok(())
    }

    #[test]
    fn latest_started_per_responsibility_derives_the_rotation() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1")?;
        let a1 = insert_started(&pool, "p1", Some("resp-a"), "attention", Some("advance"))?;
        let b1 = insert_started(&pool, "p1", Some("resp-b"), "attention", Some("advance"))?;
        // Refusals never advance the rotation; other lanes/kinds are invisible.
        insert_refusal(
            &pool,
            "p1",
            Some("resp-c"),
            "attention",
            Some("advance"),
            "cap",
        )?;
        insert_started(&pool, "p1", Some("resp-a"), "attention", Some("improve"))?;
        insert_started(
            &pool,
            "p1",
            Some("resp-a"),
            "consolidation",
            Some("advance"),
        )?;
        // Backdate a's advance so b is unambiguously the most recent.
        pool.get()?.execute(
            "UPDATE persona_attention_ledger SET started_at = '2020-01-01T00:00:00Z'
             WHERE id = ?1",
            params![a1],
        )?;
        let _ = b1;

        let latest = latest_started_per_responsibility(&pool, "p1", "attention", "advance")?;
        assert_eq!(latest.len(), 2, "resp-c (refused only) must be absent");
        let map: std::collections::HashMap<_, _> = latest.into_iter().collect();
        assert_eq!(map["resp-a"], "2020-01-01T00:00:00Z");
        assert!(map["resp-b"] > map["resp-a"]);
        Ok(())
    }

    #[test]
    fn count_today_scopes_by_lane_and_excludes_refusals() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1")?;
        insert_started(&pool, "p1", None, "attention", Some("lane-a"))?;
        insert_started(&pool, "p1", None, "attention", Some("lane-b"))?;
        insert_started(&pool, "p1", None, "consolidation", None)?;
        insert_refusal(&pool, "p1", None, "attention", Some("lane-a"), "daily cap")?;

        assert_eq!(count_today(&pool, "p1", "attention", None)?, 2);
        assert_eq!(count_today(&pool, "p1", "attention", Some("lane-a"))?, 1);
        assert_eq!(count_today(&pool, "p1", "consolidation", None)?, 1);

        // A refusal is terminal on arrival and carries its reason.
        let rows = list_by_persona(&pool, "p1", 10)?;
        let refused = rows
            .iter()
            .find(|r| r.verdict == "refused")
            .expect("refusal row");
        assert_eq!(refused.reason, "daily cap");
        assert!(refused.completed_at.is_some());

        // Yesterday's run does not count toward today.
        pool.get()?.execute(
            "UPDATE persona_attention_ledger
             SET started_at = '2020-01-01T09:00:00Z'
             WHERE lane = 'lane-b'",
            [],
        )?;
        assert_eq!(count_today(&pool, "p1", "attention", None)?, 1);
        Ok(())
    }

    #[test]
    fn summary_today_aggregates_the_fleet_and_scopes_to_today() -> Result<(), AppError> {
        let pool = init_test_db()?;

        // Empty ledger: no latest row, all counts a measured zero.
        let empty = summary_today(&pool)?;
        assert!(empty.latest.is_none());
        assert_eq!(empty.dispatched_today, 0);
        assert_eq!(empty.refused_today, 0);
        assert_eq!(empty.consolidations_today, 0);
        assert_eq!(empty.personas_served_today, 0);

        insert_persona(&pool, "p1")?;
        insert_persona(&pool, "p2")?;

        // p1: a dispatched attention lane + a refused pass.
        let a = insert_started(&pool, "p1", None, "attention", Some("advance"))?;
        complete(&pool, &a, "dispatched", "", None, None, None)?;
        insert_refusal(&pool, "p1", None, "attention", Some("advance"), "daily cap")?;
        // p2: a consolidation decision recorded as 'enqueued'.
        let c = insert_started(&pool, "p2", None, "consolidation", None)?;
        complete(&pool, &c, "enqueued", "", None, None, None)?;
        // Yesterday's dispatched pass must not count toward today.
        let old = insert_started(&pool, "p2", None, "attention", Some("advance"))?;
        complete(&pool, &old, "dispatched", "", None, None, None)?;
        pool.get()?.execute(
            "UPDATE persona_attention_ledger SET started_at = '2020-01-01T00:00:00Z'
             WHERE id = ?1",
            params![old],
        )?;

        let s = summary_today(&pool)?;
        assert_eq!(
            s.dispatched_today, 1,
            "yesterday's dispatch is out of scope"
        );
        assert_eq!(s.refused_today, 1);
        assert_eq!(s.consolidations_today, 1);
        // p1 (dispatched) + p2 (enqueued consolidation) served; the refusal
        // alone would not have counted p1.
        assert_eq!(s.personas_served_today, 2);

        // Latest is the newest row overall regardless of verdict or kind —
        // here the ledger's last insert (p2's backdated row sorts last by
        // started_at, so the consolidation or refusal wins on recency).
        let latest = s.latest.expect("non-empty ledger has a latest row");
        assert_ne!(latest.id, old, "a backdated row can never be the latest");
        Ok(())
    }
}
