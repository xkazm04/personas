use rusqlite::params;

use crate::db::DbPool;
use crate::error::AppError;

/// A persisted circuit breaker state row.
pub struct PersistedCircuitState {
    pub provider: String,
    pub consecutive_failures: u32,
    pub is_open: bool,
    pub opened_at_iso: Option<String>,
}

/// Save a single provider's circuit state. Upserts on provider key.
pub fn upsert(
    pool: &DbPool,
    provider: &str,
    consecutive_failures: u32,
    is_open: bool,
    opened_at_iso: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO circuit_breaker_state (provider, consecutive_failures, is_open, opened_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(provider) DO UPDATE SET
           consecutive_failures = excluded.consecutive_failures,
           is_open = excluded.is_open,
           opened_at = excluded.opened_at,
           updated_at = datetime('now')",
        params![provider, consecutive_failures, is_open as i32, opened_at_iso],
    )?;
    Ok(())
}

/// Load all non-expired circuit states (updated within the last `ttl_minutes`).
pub fn load_active(pool: &DbPool, ttl_minutes: i64) -> Result<Vec<PersistedCircuitState>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT provider, consecutive_failures, is_open, opened_at
         FROM circuit_breaker_state
         WHERE updated_at > datetime('now', ?1)",
    )?;
    let ttl_param = format!("-{} minutes", ttl_minutes);
    let rows = stmt.query_map(params![ttl_param], |row| {
        Ok(PersistedCircuitState {
            provider: row.get(0)?,
            consecutive_failures: row.get::<_, u32>(1)?,
            is_open: row.get::<_, i32>(2)? != 0,
            opened_at_iso: row.get(3)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

/// Delete expired rows (older than `ttl_minutes`).
pub fn purge_expired(pool: &DbPool, ttl_minutes: i64) -> Result<u64, AppError> {
    let conn = pool.get()?;
    let ttl_param = format!("-{} minutes", ttl_minutes);
    let deleted = conn.execute(
        "DELETE FROM circuit_breaker_state WHERE updated_at <= datetime('now', ?1)",
        params![ttl_param],
    )?;
    Ok(deleted as u64)
}
