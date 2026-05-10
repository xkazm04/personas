//! Repository for `persona_curation_schedule` rows — per-persona cron
//! expressions that drive the F-CRON scheduled curation feature.
//!
//! One row per persona at most (persona_id is PRIMARY KEY). NULL or
//! missing row = curation disabled for that persona. The scheduler
//! tick (`engine::curation_scheduler::tick`) reads this table once per
//! tick and enqueues `memory_curation_run` jobs for due personas.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::DbPool;
use crate::error::AppError;

/// One row in `persona_curation_schedule`. Public type returned to the
/// frontend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaCurationSchedule {
    pub persona_id: String,
    /// 5-field cron expression (minutes hours dom month dow). Validated
    /// against `engine::cron::parse_cron` at IPC boundary.
    pub cron_expr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_curation_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn upsert(
    pool: &DbPool,
    persona_id: &str,
    cron_expr: &str,
) -> Result<PersonaCurationSchedule, AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_curation_schedule (persona_id, cron_expr, created_at, updated_at)
         VALUES (?1, ?2, datetime('now'), datetime('now'))
         ON CONFLICT(persona_id) DO UPDATE
           SET cron_expr = excluded.cron_expr,
               updated_at = datetime('now')",
        params![persona_id, cron_expr],
    )?;
    get(pool, persona_id)?.ok_or_else(|| {
        AppError::Internal(format!("upsert succeeded but row not found for `{persona_id}`"))
    })
}

pub fn delete(pool: &DbPool, persona_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let n = conn.execute(
        "DELETE FROM persona_curation_schedule WHERE persona_id = ?1",
        params![persona_id],
    )?;
    Ok(n > 0)
}

pub fn get(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<PersonaCurationSchedule>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT persona_id, cron_expr, last_curation_at, created_at, updated_at
             FROM persona_curation_schedule WHERE persona_id = ?1",
            params![persona_id],
            map_row,
        )
        .optional()?;
    Ok(row)
}

/// List ALL schedules. Used by the scheduler tick.
pub fn list(pool: &DbPool) -> Result<Vec<PersonaCurationSchedule>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT persona_id, cron_expr, last_curation_at, created_at, updated_at
         FROM persona_curation_schedule
         ORDER BY persona_id",
    )?;
    let rows = stmt
        .query_map(params![], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Mark a persona's curation as having run now. Called by the scheduler
/// after enqueueing a job.
pub fn mark_run_now(pool: &DbPool, persona_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE persona_curation_schedule
         SET last_curation_at = datetime('now'), updated_at = datetime('now')
         WHERE persona_id = ?1",
        params![persona_id],
    )?;
    Ok(())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersonaCurationSchedule> {
    Ok(PersonaCurationSchedule {
        persona_id: row.get(0)?,
        cron_expr: row.get(1)?,
        last_curation_at: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}
