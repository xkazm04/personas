//! Settings-audit-log persistence.
//!
//! Append-only audit trail for every settings mutation. The Settings → History
//! tab in the UI is the canonical reader; the writer is each settings-mutating
//! Tauri command (Stage 1 wires `external_api_keys::create` and `::revoke`;
//! Stages 2 and 3 will spread the call to the remaining mutating commands and
//! add a revert-from-history action).
//!
//! Secret sanitization piggy-backs on the same helper `audit_log.rs` uses for
//! the credential audit log: anything that looks like an API key, token, or
//! secret in `before_value`/`after_value` gets redacted before insert.

use rusqlite::params;

use crate::db::models::SettingsAuditEntry;
use crate::db::DbPool;
use crate::error::AppError;
use crate::utils::sanitization::sanitize_secrets;

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

row_mapper!(row_to_settings_audit_entry -> SettingsAuditEntry {
    id, category, setting_key, action, before_value, after_value, actor, created_at,
});

// ---------------------------------------------------------------------------
// Insert (append-only — no update or delete functions)
// ---------------------------------------------------------------------------

/// Append a new settings-audit entry. `before_value` / `after_value` are
/// sanitized for secrets before persistence; the raw caller-supplied strings
/// are never stored.
pub fn insert(
    pool: &DbPool,
    category: &str,
    setting_key: &str,
    action: &str,
    before_value: Option<&str>,
    after_value: Option<&str>,
    actor: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("settings_audit_log", "settings_audit_log::insert", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let sanitized_before = before_value.map(sanitize_secrets);
        let sanitized_after = after_value.map(sanitize_secrets);

        conn.execute(
            "INSERT INTO settings_audit_log
                (id, category, setting_key, action, before_value, after_value, actor, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                category,
                setting_key,
                action,
                sanitized_before,
                sanitized_after,
                actor,
                now,
            ],
        )?;
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/// Newest-first list of audit entries, optionally filtered by category.
/// `limit` is clamped to [1, 1000] before query.
pub fn list(
    pool: &DbPool,
    limit: u32,
    category: Option<&str>,
) -> Result<Vec<SettingsAuditEntry>, AppError> {
    timed_query!("settings_audit_log", "settings_audit_log::list", {
        let bounded = limit.clamp(1, 1000);
        let conn = pool.get()?;
        match category {
            Some(cat) => {
                let mut stmt = conn.prepare(
                    "SELECT id, category, setting_key, action, before_value, after_value, actor, created_at
                     FROM settings_audit_log
                     WHERE category = ?1
                     ORDER BY created_at DESC
                     LIMIT ?2",
                )?;
                let rows = stmt.query_map(params![cat, bounded], row_to_settings_audit_entry)?;
                rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT id, category, setting_key, action, before_value, after_value, actor, created_at
                     FROM settings_audit_log
                     ORDER BY created_at DESC
                     LIMIT ?1",
                )?;
                let rows = stmt.query_map(params![bounded], row_to_settings_audit_entry)?;
                rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
            }
        }
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> crate::db::DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:settings_audit_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
        }
        pool
    }

    #[test]
    fn insert_then_list_roundtrip() {
        let pool = test_pool();
        insert(
            &pool,
            "api_keys",
            "claude-desktop",
            "create",
            None,
            Some(r#"{"scopes":["personas:read"]}"#),
            Some("ui"),
        )
        .expect("insert");
        let entries = list(&pool, 10, None).expect("list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].category, "api_keys");
        assert_eq!(entries[0].setting_key, "claude-desktop");
        assert_eq!(entries[0].action, "create");
        assert!(entries[0].before_value.is_none());
        assert!(entries[0].after_value.is_some());
        assert_eq!(entries[0].actor.as_deref(), Some("ui"));
    }

    #[test]
    fn list_newest_first() {
        let pool = test_pool();
        insert(&pool, "api_keys", "first", "create", None, None, Some("ui")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        insert(&pool, "api_keys", "second", "create", None, None, Some("ui")).unwrap();
        let entries = list(&pool, 10, None).expect("list");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].setting_key, "second");
        assert_eq!(entries[1].setting_key, "first");
    }

    #[test]
    fn category_filter_excludes_other_categories() {
        let pool = test_pool();
        insert(&pool, "api_keys", "k1", "create", None, None, None).unwrap();
        insert(&pool, "notifications", "n1", "update", None, None, None).unwrap();
        let api_only = list(&pool, 10, Some("api_keys")).expect("list");
        assert_eq!(api_only.len(), 1);
        assert_eq!(api_only[0].category, "api_keys");
    }

    #[test]
    fn limit_is_clamped_to_one_thousand() {
        let pool = test_pool();
        // The query itself should accept any limit ≤ 1000; we verify the
        // clamp doesn't drop entries when the explicit limit is small.
        for i in 0..5 {
            insert(&pool, "api_keys", &format!("k{i}"), "create", None, None, None).unwrap();
        }
        let entries = list(&pool, 3, None).expect("list");
        assert_eq!(entries.len(), 3);
    }

    #[test]
    fn sanitization_redacts_secrets_in_values() {
        let pool = test_pool();
        // sanitize_secrets is shared with the credential audit log; we just
        // want to confirm it's actually being invoked on this path. Use a
        // very obvious token-shaped string.
        let leaky = r#"{"token":"sk-this-should-be-redacted-1234567890abcdef"}"#;
        insert(&pool, "api_keys", "leaky", "create", None, Some(leaky), None).unwrap();
        let entries = list(&pool, 10, None).expect("list");
        let stored = entries[0].after_value.as_deref().unwrap_or_default();
        assert!(
            !stored.contains("sk-this-should-be-redacted-1234567890abcdef"),
            "raw token must not be stored, got: {stored}"
        );
    }
}
