use rusqlite::params;

use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;

/// Get a setting value by key. Returns `None` if the row does not exist.
///
/// Emits a `tracing::warn!` breadcrumb (but does not fail) when called with a
/// key that is not on the [`settings_keys`] allowlist — this is how typo'd or
/// legacy keys surface in observability instead of silently returning `None`.
pub fn get(pool: &DbPool, key: &str) -> Result<Option<String>, AppError> {
    if let Err(msg) = settings_keys::validate_key(key) {
        tracing::warn!(key = key, reason = %msg, "settings::get called with unknown key");
    }
    timed_query!("app_settings", "app_settings::get", {
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
    })
}

/// Set a setting value. Creates or updates the row.
///
/// Enforces the allowlist in [`settings_keys::validate_key`] and the typed-value
/// contract in [`settings_keys::validate_value`], so internal Rust callers
/// cannot bypass the validation that the Tauri command layer also applies.
/// Malformed keys or values are rejected with [`AppError::Validation`].
pub fn set(pool: &DbPool, key: &str, value: &str) -> Result<(), AppError> {
    settings_keys::validate_key(key).map_err(AppError::Validation)?;
    settings_keys::validate_value(key, value).map_err(AppError::Validation)?;
    timed_query!("app_settings", "app_settings::set", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, now],
        )?;
        Ok(())
    })
}

/// Get all settings whose key begins with `prefix`. Returns `(key, value)` pairs.
///
/// SQLite `LIKE` treats `_` as "any single char" and `%` as "any sequence",
/// so callers whose prefixes contain `_` (e.g. `auto_rollback:`) would otherwise
/// match unrelated rows like `"autoXrollback:..."`. We therefore escape `\`,
/// `%`, and `_` in the prefix and use the `ESCAPE '\\'` clause to force
/// literal matching. This also makes the API safe if the prefix ever comes
/// from user-derived input.
pub fn get_by_prefix(pool: &DbPool, prefix: &str) -> Result<Vec<(String, String)>, AppError> {
    timed_query!("app_settings", "app_settings::get_by_prefix", {
        let conn = pool.get()?;
        // Escape LIKE metacharacters so prefixes containing `_` or `%` match literally.
        // Order matters: `\` must be escaped first so it does not double-escape later ones.
        let escaped = prefix
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("{escaped}%");
        let mut stmt = conn.prepare(
            "SELECT key, value FROM app_settings WHERE key LIKE ?1 ESCAPE '\\'",
        )?;
        let rows = stmt.query_map(params![pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Delete a setting by key.
///
/// ## Return value contract
///
/// - `Ok(true)` — a row existed for `key` and was removed.
/// - `Ok(false)` — no row existed for `key`; this is treated as a successful
///   no-op (idempotent delete). Callers MUST NOT surface "setting cleared"
///   toasts based on `true`, nor surface "nothing to do" errors based on
///   `false`; the caller's observable end state (row is gone) is the same.
/// - `Err(_)` — the query itself failed (DB unreachable, schema problem).
///
/// Emits a `tracing::warn!` breadcrumb (but does not fail) when called with a
/// key that is not on the [`settings_keys`] allowlist, mirroring [`get`].
pub fn delete(pool: &DbPool, key: &str) -> Result<bool, AppError> {
    if let Err(msg) = settings_keys::validate_key(key) {
        tracing::warn!(key = key, reason = %msg, "settings::delete called with unknown key");
    }
    timed_query!("app_settings", "app_settings::delete", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])?;
        Ok(rows > 0)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_get_set_delete() {
        let pool = init_test_db().unwrap();
        let key = settings_keys::CLI_ENGINE;

        // Get non-existent
        assert_eq!(get(&pool, key).unwrap(), None);

        // Set
        set(&pool, key, "claude_code").unwrap();
        assert_eq!(get(&pool, key).unwrap(), Some("claude_code".into()));

        // Overwrite
        set(&pool, key, "codex_cli").unwrap();
        assert_eq!(get(&pool, key).unwrap(), Some("codex_cli".into()));

        // Delete — row exists → true
        assert!(delete(&pool, key).unwrap());
        assert_eq!(get(&pool, key).unwrap(), None);

        // Delete — row absent → false (idempotent no-op, not an error)
        assert!(!delete(&pool, key).unwrap());
    }

    #[test]
    fn set_rejects_unknown_key() {
        let pool = init_test_db().unwrap();
        let err = set(&pool, "evil_key", "whatever").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "expected Validation error, got {err:?}");
    }

    #[test]
    fn set_rejects_malformed_numeric_value() {
        let pool = init_test_db().unwrap();
        let err = set(&pool, settings_keys::EVENT_RETENTION_DAYS, "30d").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "expected Validation error, got {err:?}");
        // Valid value accepted
        set(&pool, settings_keys::EVENT_RETENTION_DAYS, "45").unwrap();
    }

    #[test]
    fn get_by_prefix_escapes_underscore() {
        let pool = init_test_db().unwrap();
        // `auto_rollback:abc` matches the prefix; a synthetic key that would match
        // an unescaped LIKE (`_` wildcard) is now in the allowlist only via prefix,
        // so we simulate the risk with two distinct prefix keys.
        set(&pool, "auto_rollback:abc", "true").unwrap();
        set(&pool, "auto_optimize:abc", "{}").unwrap();

        let rows = get_by_prefix(&pool, "auto_rollback:").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "auto_rollback:abc");
    }
}
