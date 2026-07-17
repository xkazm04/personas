use rusqlite::params;
use rusqlite::params_from_iter;
use std::collections::HashMap;

use crate::db::repos::resources::settings_audit_log;
use crate::db::repos::utils::escape_like;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;

/// Best-effort settings-audit write for a user-facing settings mutation.
///
/// Direction 1 (universal settings audit): the audit is emitted here, at the
/// REPO layer, so INTERNAL Rust callers (engine subscriptions, companion ticks
/// that flip a toggle, the management HTTP API) are audited too — not only the
/// Tauri command surface. It NO-OPS when:
/// - the key is internal engine bookkeeping (see [`settings_keys::audit_category`]
///   returns `None`) — cursors, `*_last` timestamps, cloud-sync watermarks; or
/// - the value did not actually change (UI re-saving an identical value).
///
/// Secret sanitization is handled inside [`settings_audit_log::insert`] (shared
/// with the credential audit log), so api-key/token values are redacted before
/// they ever hit the table. Audit failures are logged but NEVER fail the
/// underlying write — losing an audit row must not block a settings change.
fn audit_setting_change(pool: &DbPool, key: &str, before: Option<&str>, after: Option<&str>) {
    let Some(category) = settings_keys::audit_category(key) else {
        return; // internal bookkeeping — never audited
    };
    // Skip no-op writes to keep the History tab signal-rich.
    if before == after {
        return;
    }
    let action = match (before, after) {
        (None, Some(_)) => "create",
        (Some(_), Some(_)) => "update",
        (Some(_), None) => "delete",
        (None, None) => return, // nothing happened
    };
    // Defense-in-depth for known-secret keys: the shared `sanitize_secrets`
    // pass inside `settings_audit_log::insert` is PATTERN-based (key:value
    // pairs, `sk_live_`/`AKIA`-style prefixed tokens) and cannot recognize a
    // BARE token value (e.g. a raw Ollama key). For the api_keys category we
    // know the value IS the secret, so redact it structurally — the History
    // tab still shows that the key changed, never what it was.
    let (before, after) = if category == "api_keys" {
        (before.map(|_| "[redacted]"), after.map(|_| "[redacted]"))
    } else {
        (before, after)
    };
    // actor = None: the repo layer cannot attribute a caller surface (that
    // distinction lives at the command/HTTP boundary). The trade-off is
    // deliberate — auditing every internal caller is worth more than an
    // origin tag the History tab renders only as an optional badge.
    if let Err(e) = settings_audit_log::insert(pool, category, key, action, before, after, None) {
        tracing::warn!(
            key,
            category,
            error = %e,
            "settings audit insert failed (the settings write itself succeeded)"
        );
    }
}

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
    // Quarantined-key breadcrumb: writing a DEPRECATED key still persists (the
    // row stays harmless + allow-listed), but a warn surfaces the stale writer.
    if let Some(superseded_by) = settings_keys::deprecated_replacement(key) {
        tracing::warn!(
            key = key,
            superseded_by = superseded_by,
            "settings::set called with a DEPRECATED key — value persisted but no consumer reads it"
        );
    }
    // Capture the prior value BEFORE the upsert overwrites it, for the audit
    // trail. `get` is a cache-hot single-row read; settings writes are rare.
    let before = get(pool, key)?;
    let write: Result<(), AppError> = timed_query!("app_settings", "app_settings::set", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, now],
        )?;
        Ok(())
    });
    write?;
    audit_setting_change(pool, key, before.as_deref(), Some(value));
    Ok(())
}

/// Maximum number of keys accepted in a single [`get_batch`] call.
///
/// SQLite supports up to 32 766 host parameters per statement, so the limit
/// is conservative — it exists to bound the IPC payload and prevent a caller
/// from issuing pathological requests by mistake.
pub const GET_BATCH_MAX_KEYS: usize = 256;

/// Get many settings in a single round-trip. Returns a map from each requested
/// key to its value. Keys that do not exist in the table are returned with
/// value `None`, so the caller can distinguish "absent" from "empty".
///
/// Unknown keys (failing `validate_key`) are dropped from the query rather
/// than rejecting the whole call: a typo or stale frontend reference
/// surfaces as `None` plus a `tracing::warn!` breadcrumb, mirroring [`get`].
pub fn get_batch(
    pool: &DbPool,
    keys: &[String],
) -> Result<HashMap<String, Option<String>>, AppError> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }

    // Dedupe + filter unknowns, preserving the original keys in the result map
    // so callers always get an entry for every key they asked for.
    let mut unique_valid: Vec<&str> = Vec::with_capacity(keys.len());
    let mut result: HashMap<String, Option<String>> = HashMap::with_capacity(keys.len());
    for key in keys {
        if result.contains_key(key) {
            continue;
        }
        result.insert(key.clone(), None);
        if let Err(msg) = settings_keys::validate_key(key) {
            tracing::warn!(key = %key, reason = %msg, "settings::get_batch called with unknown key");
            continue;
        }
        unique_valid.push(key.as_str());
    }

    if unique_valid.is_empty() {
        return Ok(result);
    }

    timed_query!("app_settings", "app_settings::get_batch", {
        let conn = pool.get()?;
        let placeholders = std::iter::repeat("?")
            .take(unique_valid.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("SELECT key, value FROM app_settings WHERE key IN ({placeholders})");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(unique_valid.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (k, v) = row.map_err(AppError::Database)?;
            result.insert(k, Some(v));
        }
        Ok(result)
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
        let pattern = format!("{}%", escape_like(prefix));
        let mut stmt =
            conn.prepare("SELECT key, value FROM app_settings WHERE key LIKE ?1 ESCAPE '\\'")?;
        let rows = stmt.query_map(params![pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
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
    // Capture the prior value BEFORE the delete, for the audit trail.
    let before = get(pool, key)?;
    let removed: Result<bool, AppError> = timed_query!("app_settings", "app_settings::delete", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])?;
        Ok(rows > 0)
    });
    let removed = removed?;
    // Only audit a delete that actually removed a row (idempotent no-op → silent).
    if removed {
        audit_setting_change(pool, key, before.as_deref(), None);
    }
    Ok(removed)
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
        assert!(
            matches!(err, AppError::Validation(_)),
            "expected Validation error, got {err:?}"
        );
    }

    #[test]
    fn set_rejects_malformed_numeric_value() {
        let pool = init_test_db().unwrap();
        let err = set(&pool, settings_keys::EVENT_RETENTION_DAYS, "30d").unwrap_err();
        assert!(
            matches!(err, AppError::Validation(_)),
            "expected Validation error, got {err:?}"
        );
        // Valid value accepted
        set(&pool, settings_keys::EVENT_RETENTION_DAYS, "45").unwrap();
    }

    #[test]
    fn get_batch_returns_present_and_absent() {
        let pool = init_test_db().unwrap();
        set(&pool, settings_keys::CLI_ENGINE, "claude_code").unwrap();
        set(&pool, settings_keys::HEALTH_DIGEST_ENABLED, "true").unwrap();

        let keys = vec![
            settings_keys::CLI_ENGINE.to_string(),
            settings_keys::HEALTH_DIGEST_ENABLED.to_string(),
            settings_keys::NOTIFICATION_PREFS.to_string(), // absent
        ];
        let result = get_batch(&pool, &keys).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(
            result.get(settings_keys::CLI_ENGINE),
            Some(&Some("claude_code".to_string()))
        );
        assert_eq!(
            result.get(settings_keys::HEALTH_DIGEST_ENABLED),
            Some(&Some("true".to_string()))
        );
        assert_eq!(result.get(settings_keys::NOTIFICATION_PREFS), Some(&None));
    }

    #[test]
    fn get_batch_ignores_unknown_keys() {
        let pool = init_test_db().unwrap();
        set(&pool, settings_keys::CLI_ENGINE, "claude_code").unwrap();

        let keys = vec![
            settings_keys::CLI_ENGINE.to_string(),
            "evil_key".to_string(),
        ];
        let result = get_batch(&pool, &keys).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(
            result.get(settings_keys::CLI_ENGINE),
            Some(&Some("claude_code".to_string()))
        );
        // Unknown key still appears in the result map but with None.
        assert_eq!(result.get("evil_key"), Some(&None));
    }

    #[test]
    fn get_batch_empty_input_returns_empty_map() {
        let pool = init_test_db().unwrap();
        let result = get_batch(&pool, &[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn get_batch_dedupes_repeated_keys() {
        let pool = init_test_db().unwrap();
        set(&pool, settings_keys::CLI_ENGINE, "codex_cli").unwrap();
        let keys = vec![
            settings_keys::CLI_ENGINE.to_string(),
            settings_keys::CLI_ENGINE.to_string(),
        ];
        let result = get_batch(&pool, &keys).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(
            result.get(settings_keys::CLI_ENGINE),
            Some(&Some("codex_cli".to_string()))
        );
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

    // -----------------------------------------------------------------------
    // Direction 1: universal settings audit (repo-layer, so internal callers
    // are audited too). These use a fresh migrated pool because `init_test_db`
    // drops `settings_audit_log` in the test binary.
    // -----------------------------------------------------------------------

    fn audit_pool() -> DbPool {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:settings_repo_audit_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("build audit test pool");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
            crate::db::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    #[test]
    fn audit_on_set_create_then_update_then_noop() {
        let pool = audit_pool();
        // First write → "create" (no prior value).
        set(&pool, settings_keys::CLI_ENGINE, "claude_code").unwrap();
        let rows = settings_audit_log::list(&pool, 100, None).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].category, "engine");
        assert_eq!(rows[0].setting_key, settings_keys::CLI_ENGINE);
        assert_eq!(rows[0].action, "create");
        assert!(rows[0].before_value.is_none());
        assert_eq!(rows[0].after_value.as_deref(), Some("claude_code"));

        // Changed value → "update" with before/after.
        set(&pool, settings_keys::CLI_ENGINE, "codex_cli").unwrap();
        let rows = settings_audit_log::list(&pool, 100, None).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].action, "update");
        assert_eq!(rows[0].before_value.as_deref(), Some("claude_code"));
        assert_eq!(rows[0].after_value.as_deref(), Some("codex_cli"));

        // Identical re-save → no new audit row (no-op suppression).
        set(&pool, settings_keys::CLI_ENGINE, "codex_cli").unwrap();
        let rows = settings_audit_log::list(&pool, 100, None).unwrap();
        assert_eq!(rows.len(), 2, "identical re-save must not add an audit row");
    }

    #[test]
    fn audit_on_delete_records_entry() {
        let pool = audit_pool();
        set(&pool, settings_keys::HEALTH_DIGEST_ENABLED, "true").unwrap();
        assert!(delete(&pool, settings_keys::HEALTH_DIGEST_ENABLED).unwrap());
        let rows = settings_audit_log::list(&pool, 100, None).unwrap();
        // create + delete.
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].action, "delete");
        assert_eq!(rows[0].category, "notifications");
        assert_eq!(rows[0].before_value.as_deref(), Some("true"));
        assert!(rows[0].after_value.is_none());

        // Deleting an absent key is a no-op → no audit row.
        assert!(!delete(&pool, settings_keys::HEALTH_DIGEST_ENABLED).unwrap());
        let rows = settings_audit_log::list(&pool, 100, None).unwrap();
        assert_eq!(rows.len(), 2, "idempotent no-op delete must not audit");
    }

    #[test]
    fn audit_excludes_internal_bookkeeping_keys() {
        let pool = audit_pool();
        // Internal cursor — must NOT be audited (engine state, not a user action).
        set(
            &pool,
            settings_keys::COMPANION_EXEC_REVIEW_CURSOR,
            "2026-07-13T00:00:00Z",
        )
        .unwrap();
        set(&pool, "cloud_sync_cursor:executions", "2026-07-13T00:00:00Z").unwrap();
        let rows = settings_audit_log::list(&pool, 100, None).unwrap();
        assert!(
            rows.is_empty(),
            "internal bookkeeping keys must not produce audit rows, got {rows:?}"
        );
    }

    #[test]
    fn audit_sanitizes_secret_values() {
        let pool = audit_pool();
        // OLLAMA_API_KEY is categorized as api_keys → its value IS the secret,
        // so the audit layer redacts it STRUCTURALLY (pattern-based
        // sanitize_secrets cannot recognize a bare token). A bare `ghp_…` token
        // is exactly the shape the pattern pass misses.
        let leaky = "ghp_0123456789abcdefghijABCDEFGHIJ0123";
        set(&pool, settings_keys::OLLAMA_API_KEY, leaky).unwrap();
        let rows = settings_audit_log::list(&pool, 100, None).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].category, "api_keys");
        assert_eq!(rows[0].action, "create");
        let stored = rows[0].after_value.as_deref().unwrap_or_default();
        assert!(
            !stored.contains(leaky),
            "raw secret must not be stored in the audit log, got: {stored}"
        );
        assert_eq!(stored, "[redacted]");

        // An update between two secrets still audits (raw values differ) but
        // stores only redaction markers on both sides.
        set(&pool, settings_keys::OLLAMA_API_KEY, "another-secret-value").unwrap();
        let rows = settings_audit_log::list(&pool, 100, None).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].action, "update");
        assert_eq!(rows[0].before_value.as_deref(), Some("[redacted]"));
        assert_eq!(rows[0].after_value.as_deref(), Some("[redacted]"));
    }
}
