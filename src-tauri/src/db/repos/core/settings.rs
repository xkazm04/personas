use rusqlite::params;

use crate::db::DbPool;
use crate::error::AppError;

/// Get a setting value by key. Returns None if not found.
pub fn get(pool: &DbPool, key: &str) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let result = conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Set a setting value. Creates or updates the key.
pub fn set(pool: &DbPool, key: &str, value: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
        params![key, value, now],
    )?;
    Ok(())
}

/// Delete a setting by key. Returns true if a row was deleted.
pub fn delete(pool: &DbPool, key: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])?;
    Ok(rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_get_set_delete() {
        let pool = init_test_db().unwrap();

        // Get non-existent
        assert_eq!(get(&pool, "foo").unwrap(), None);

        // Set
        set(&pool, "foo", "bar").unwrap();
        assert_eq!(get(&pool, "foo").unwrap(), Some("bar".into()));

        // Overwrite
        set(&pool, "foo", "baz").unwrap();
        assert_eq!(get(&pool, "foo").unwrap(), Some("baz".into()));

        // Delete
        assert!(delete(&pool, "foo").unwrap());
        assert_eq!(get(&pool, "foo").unwrap(), None);

        // Delete non-existent
        assert!(!delete(&pool, "foo").unwrap());
    }
}
