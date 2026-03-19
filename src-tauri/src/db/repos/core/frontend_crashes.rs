use rusqlite::params;

use crate::db::models::FrontendCrashRow;
use crate::db::DbPool;
use crate::error::AppError;

/// Insert a single frontend crash report.
pub fn insert(
    pool: &DbPool,
    component: &str,
    message: &str,
    stack: Option<&str>,
    component_stack: Option<&str>,
    app_version: Option<&str>,
) -> Result<FrontendCrashRow, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO frontend_crashes (id, component, message, stack, component_stack, app_version, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, component, message, stack, component_stack, app_version, now],
    )?;

    // Cap at 200 rows to prevent unbounded growth
    conn.execute(
        "DELETE FROM frontend_crashes WHERE id NOT IN (
            SELECT id FROM frontend_crashes ORDER BY created_at DESC LIMIT 200
        )",
        [],
    )?;

    Ok(FrontendCrashRow {
        id,
        component: component.to_string(),
        message: message.to_string(),
        stack: stack.map(String::from),
        component_stack: component_stack.map(String::from),
        app_version: app_version.map(String::from),
        created_at: now,
    })
}

/// List recent frontend crashes, newest first.
pub fn list_recent(pool: &DbPool, limit: u32) -> Result<Vec<FrontendCrashRow>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, component, message, stack, component_stack, app_version, created_at
         FROM frontend_crashes
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;

    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(FrontendCrashRow {
                id: row.get(0)?,
                component: row.get(1)?,
                message: row.get(2)?,
                stack: row.get(3)?,
                component_stack: row.get(4)?,
                app_version: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// Count crashes in the last N hours.
pub fn count_since(pool: &DbPool, hours: u32) -> Result<u32, AppError> {
    let conn = pool.get()?;
    let cutoff = (chrono::Utc::now() - chrono::Duration::hours(i64::from(hours))).to_rfc3339();
    let count: u32 = conn.query_row(
        "SELECT COUNT(*) FROM frontend_crashes WHERE created_at >= ?1",
        params![cutoff],
        |row| row.get(0),
    )?;
    Ok(count)
}

/// Delete all frontend crash records.
pub fn clear_all(pool: &DbPool) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM frontend_crashes", [])?;
    Ok(())
}
