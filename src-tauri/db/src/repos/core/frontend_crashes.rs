use rusqlite::params;

use crate::models::FrontendCrashRow;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// Insert a single frontend crash report.
pub fn insert(
    pool: &DbPool,
    component: &str,
    message: &str,
    stack: Option<&str>,
    component_stack: Option<&str>,
    app_version: Option<&str>,
) -> Result<FrontendCrashRow, AppError> {
    timed_query!("frontend_crashes", "frontend_crashes::insert", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.conn("frontend_crashes::insert")?;
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
    })
}

/// List recent frontend crashes, newest first.
pub fn list_recent(pool: &DbPool, limit: u32) -> Result<Vec<FrontendCrashRow>, AppError> {
    timed_query!("frontend_crashes", "frontend_crashes::list_recent", {
        let conn = pool.conn("frontend_crashes::list_recent")?;
        let mut stmt = conn.prepare(
            "SELECT id, component, message, stack, component_stack, app_version, created_at
             FROM frontend_crashes
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;

        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(FrontendCrashRow {
                    id: row.get("id")?,
                    component: row.get("component")?,
                    message: row.get("message")?,
                    stack: row.get("stack")?,
                    component_stack: row.get("component_stack")?,
                    app_version: row.get("app_version")?,
                    created_at: row.get("created_at")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    })
}

/// Count crashes in the last N hours.
pub fn count_since(pool: &DbPool, hours: u32) -> Result<u32, AppError> {
    timed_query!("frontend_crashes", "frontend_crashes::count_since", {
        let conn = pool.conn("frontend_crashes::count_since")?;
        let cutoff = (chrono::Utc::now() - chrono::Duration::hours(i64::from(hours))).to_rfc3339();
        let count: u32 = conn.query_row(
            "SELECT COUNT(*) AS n FROM frontend_crashes WHERE created_at >= ?1",
            params![cutoff],
            |row| row.get("n"),
        )?;
        Ok(count)
    })
}

/// Delete all frontend crash records.
pub fn clear_all(pool: &DbPool) -> Result<(), AppError> {
    timed_query!("frontend_crashes", "frontend_crashes::clear_all", {
        let conn = pool.conn("frontend_crashes::clear_all")?;
        conn.execute("DELETE FROM frontend_crashes", [])?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    /// Every read maps its columns by name against the real migrated schema.
    #[test]
    fn reads_map_every_column_by_name() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert(
            &pool,
            "Panel",
            "boom",
            Some("at x"),
            Some("in Panel"),
            Some("1.1.0"),
        )?;
        let rows = list_recent(&pool, 10)?;
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(
            (r.component.as_str(), r.message.as_str(), r.stack.as_deref()),
            ("Panel", "boom", Some("at x"))
        );
        assert_eq!(
            (r.component_stack.as_deref(), r.app_version.as_deref()),
            (Some("in Panel"), Some("1.1.0"))
        );
        assert_eq!(count_since(&pool, 1)?, 1);
        Ok(())
    }
}
