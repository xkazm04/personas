//! Durable usage-limit retries.
//!
//! When a run fails on a provider usage-limit WINDOW (e.g. Claude's rolling
//! ~5h cap), healing schedules a retry at the parsed reset time via
//! [`HealingAction::RetryAt`](crate::engine::healing::HealingAction). A
//! multi-hour in-memory sleep would not survive an app restart, so the
//! schedule lives in the `scheduled_retries` table and the event-bus tick
//! drains due rows (`ExecutionEngine::drain_due_scheduled_retries`).
//!
//! One pending retry per failed execution (PK = execution_id); rows are
//! deleted on dispatch.

use rusqlite::params;

use crate::db::DbPool;
use crate::error::AppError;

/// A persisted pending retry row.
#[derive(Debug, Clone)]
pub struct ScheduledRetry {
    pub execution_id: String,
    pub persona_id: String,
    /// RFC 3339 timestamp at which the retry becomes due.
    pub retry_at: String,
    pub reason: Option<String>,
}

/// Schedule (or reschedule) a retry for a failed execution.
pub fn upsert(
    pool: &DbPool,
    execution_id: &str,
    persona_id: &str,
    retry_at: &str,
    reason: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO scheduled_retries (execution_id, persona_id, retry_at, reason)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(execution_id) DO UPDATE SET
           retry_at = excluded.retry_at,
           reason = excluded.reason",
        params![execution_id, persona_id, retry_at, reason],
    )?;
    Ok(())
}

/// Return all rows whose `retry_at` is due (≤ `now_iso`), oldest first.
pub fn get_due(pool: &DbPool, now_iso: &str) -> Result<Vec<ScheduledRetry>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare_cached(
        "SELECT execution_id, persona_id, retry_at, reason
         FROM scheduled_retries
         WHERE retry_at <= ?1
         ORDER BY retry_at ASC",
    )?;
    let rows = stmt.query_map(params![now_iso], |row| {
        Ok(ScheduledRetry {
            execution_id: row.get(0)?,
            persona_id: row.get(1)?,
            retry_at: row.get(2)?,
            reason: row.get(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Remove a pending retry (called on dispatch, or to cancel).
pub fn delete(pool: &DbPool, execution_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM scheduled_retries WHERE execution_id = ?1",
        params![execution_id],
    )?;
    Ok(())
}
