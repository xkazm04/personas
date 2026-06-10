//! CRUD + scheduling queries for `system_op_automations`.
//!
//! Pure persistence. The orchestration (running ops, computing next-run times,
//! publishing lifecycle events) lives in `engine::system_ops`.

use rusqlite::{params, Row};

use crate::db::models::SystemOpAutomation;
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_automation(row: &Row) -> rusqlite::Result<SystemOpAutomation> {
    Ok(SystemOpAutomation {
        id: row.get("id")?,
        op_kind: row.get("op_kind")?,
        params_json: row.get("params_json")?,
        trigger_kind: row.get("trigger_kind")?,
        cron: row.get("cron").unwrap_or(None),
        timezone: row.get("timezone").unwrap_or(None),
        listen_event_type: row.get("listen_event_type").unwrap_or(None),
        source_filter: row.get("source_filter").unwrap_or(None),
        enabled: row.get::<_, i64>("enabled").unwrap_or(1) != 0,
        next_run_at: row.get("next_run_at").unwrap_or(None),
        last_run_at: row.get("last_run_at").unwrap_or(None),
        last_status: row.get("last_status").unwrap_or(None),
        last_detail: row.get("last_detail").unwrap_or(None),
        label: row.get("label").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Field bundle for [`create`] (avoids a too-many-arguments signature).
pub struct NewAutomation<'a> {
    pub id: &'a str,
    pub op_kind: &'a str,
    pub params_json: &'a str,
    pub trigger_kind: &'a str,
    pub cron: Option<&'a str>,
    pub timezone: Option<&'a str>,
    pub listen_event_type: Option<&'a str>,
    pub source_filter: Option<&'a str>,
    pub next_run_at: Option<&'a str>,
    pub label: Option<&'a str>,
}

pub fn list(pool: &DbPool) -> Result<Vec<SystemOpAutomation>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM system_op_automations ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], row_to_automation)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get(pool: &DbPool, id: &str) -> Result<SystemOpAutomation, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM system_op_automations WHERE id = ?1",
        params![id],
        row_to_automation,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("system op automation not found: {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create(pool: &DbPool, a: NewAutomation<'_>) -> Result<SystemOpAutomation, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO system_op_automations
            (id, op_kind, params_json, trigger_kind, cron, timezone, listen_event_type,
             source_filter, enabled, next_run_at, label, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11, ?11)",
        params![
            a.id,
            a.op_kind,
            a.params_json,
            a.trigger_kind,
            a.cron,
            a.timezone,
            a.listen_event_type,
            a.source_filter,
            a.next_run_at,
            a.label,
            now,
        ],
    )?;
    get(pool, a.id)
}

pub fn set_enabled(pool: &DbPool, id: &str, enabled: bool) -> Result<bool, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let rows = conn.execute(
        "UPDATE system_op_automations SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![enabled as i64, now, id],
    )?;
    Ok(rows > 0)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM system_op_automations WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// Record the outcome of a run: bumps `last_run_at`/`last_status`/`last_detail`
/// and re-arms `next_run_at` (schedule kind passes the recomputed time; event
/// kind passes its existing value, typically `None`).
pub fn mark_run(
    pool: &DbPool,
    id: &str,
    status: &str,
    detail: Option<&str>,
    next_run_at: Option<&str>,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE system_op_automations
            SET last_run_at = ?1, last_status = ?2, last_detail = ?3, next_run_at = ?4, updated_at = ?1
          WHERE id = ?5",
        params![now, status, detail, next_run_at, id],
    )?;
    Ok(())
}

/// Schedule automations whose next fire time has arrived.
pub fn get_due_schedules(pool: &DbPool, now: &str) -> Result<Vec<SystemOpAutomation>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM system_op_automations
          WHERE trigger_kind = 'schedule'
            AND enabled = 1
            AND next_run_at IS NOT NULL
            AND next_run_at <= ?1
          ORDER BY next_run_at ASC",
    )?;
    let rows = stmt.query_map(params![now], row_to_automation)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// All enabled event-listener automations (matched against bus events per tick).
pub fn list_enabled_event_automations(pool: &DbPool) -> Result<Vec<SystemOpAutomation>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM system_op_automations
          WHERE trigger_kind = 'event' AND enabled = 1 AND listen_event_type IS NOT NULL",
    )?;
    let rows = stmt.query_map([], row_to_automation)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}
