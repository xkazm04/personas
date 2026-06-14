//! Persistence for the aggregate run-budget ledger (P2).
//!
//! The in-memory `engine::run_budget::RunBudgetLedger` is the source of truth
//! during a run; this repo persists the final state to `run_budgets` at the
//! consumer's finalize point so cost trends survive process restarts and feed
//! historical / aggregate dashboards. Keyed by the run identity (evolution cycle
//! id / lab run id / pipeline run id).

use rusqlite::params;

use crate::db::DbPool;
use crate::engine::run_budget::{enforce_enabled, RunBudgetRecord, RunBudgetState};
use crate::error::AppError;

/// Upsert the persisted budget row for a run. Captures the global enforce-mode
/// flag at write time. Idempotent on `run_id` (a re-run overwrites its row).
pub fn persist(pool: &DbPool, state: &RunBudgetState) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO run_budgets
            (run_id, kind, ceiling_usd, spent_usd, spawn_count, exceeded, enforce, finished, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
         ON CONFLICT(run_id) DO UPDATE SET
            kind        = excluded.kind,
            ceiling_usd = excluded.ceiling_usd,
            spent_usd   = excluded.spent_usd,
            spawn_count = excluded.spawn_count,
            exceeded    = excluded.exceeded,
            enforce     = excluded.enforce,
            finished    = excluded.finished,
            updated_at  = datetime('now')",
        params![
            state.run_id,
            state.kind,
            state.ceiling_usd,
            state.spent_usd,
            state.spawn_count as i64,
            state.exceeded as i64,
            enforce_enabled() as i64,
            state.finished as i64,
        ],
    )?;
    Ok(())
}

fn row_to_record(row: &rusqlite::Row) -> rusqlite::Result<RunBudgetRecord> {
    Ok(RunBudgetRecord {
        run_id: row.get("run_id")?,
        kind: row.get("kind")?,
        ceiling_usd: row.get("ceiling_usd")?,
        spent_usd: row.get("spent_usd")?,
        spawn_count: row.get::<_, i64>("spawn_count")?.max(0) as u32,
        exceeded: row.get::<_, i64>("exceeded")? != 0,
        enforce: row.get::<_, i64>("enforce")? != 0,
        finished: row.get::<_, i64>("finished")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Recent persisted run budgets, optionally filtered by `kind`, newest first.
/// `limit` is clamped to 1..=500.
pub fn list_recent(
    pool: &DbPool,
    kind: Option<&str>,
    limit: i64,
) -> Result<Vec<RunBudgetRecord>, AppError> {
    let conn = pool.get()?;
    let limit = limit.clamp(1, 500);
    let rows = match kind {
        Some(k) => {
            let mut stmt = conn.prepare(
                "SELECT * FROM run_budgets WHERE kind = ?1 ORDER BY updated_at DESC LIMIT ?2",
            )?;
            let mapped = stmt.query_map(params![k, limit], row_to_record)?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()?
        }
        None => {
            let mut stmt = conn
                .prepare("SELECT * FROM run_budgets ORDER BY updated_at DESC LIMIT ?1")?;
            let mapped = stmt.query_map(params![limit], row_to_record)?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()?
        }
    };
    Ok(rows)
}
