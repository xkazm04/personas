//! Per-key management-API action audit log.
//!
//! Append-mostly trail of every request an authenticated external API key made
//! (method / path / status / persona / origin). Written best-effort by the
//! `require_api_key` middleware; the API-keys settings UI reads it per key. Rows
//! are capped per key on insert (`RETAIN_PER_KEY`) so the table cannot grow
//! unbounded on a long-lived key.

use rusqlite::params;

use crate::db::models::ApiKeyAuditEntry;
use crate::db::DbPool;
use crate::error::AppError;

row_mapper!(row_to_api_key_audit -> ApiKeyAuditEntry {
    id, key_id, at, method, path, status, persona_id, origin,
});

/// How many audit rows to keep per key. Older rows are trimmed on each insert.
const RETAIN_PER_KEY: i64 = 500;

/// Append one audit row, then trim the key's history to the most recent
/// `RETAIN_PER_KEY` rows. Both statements run on the same connection; errors
/// propagate to the (best-effort) caller, which logs and swallows them.
#[allow(clippy::too_many_arguments)]
pub fn insert(
    pool: &DbPool,
    key_id: &str,
    method: &str,
    path: &str,
    status: i64,
    persona_id: Option<&str>,
    origin: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("api_key_audit", "api_key_audit::insert", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO api_key_audit
                (id, key_id, at, method, path, status, persona_id, origin)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, key_id, now, method, path, status, persona_id, origin],
        )?;
        // Cap the per-key history. Bounded DELETE keyed on the indexed column.
        conn.execute(
            "DELETE FROM api_key_audit
             WHERE key_id = ?1
               AND id NOT IN (
                   SELECT id FROM api_key_audit
                   WHERE key_id = ?1
                   ORDER BY at DESC
                   LIMIT ?2
               )",
            params![key_id, RETAIN_PER_KEY],
        )?;
        Ok(())
    })
}

/// Newest-first audit rows for a key. `limit` is clamped to [1, 500].
pub fn list_for_key(
    pool: &DbPool,
    key_id: &str,
    limit: u32,
) -> Result<Vec<ApiKeyAuditEntry>, AppError> {
    timed_query!("api_key_audit", "api_key_audit::list_for_key", {
        let bounded = limit.clamp(1, 500);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, key_id, at, method, path, status, persona_id, origin
             FROM api_key_audit
             WHERE key_id = ?1
             ORDER BY at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![key_id, bounded], row_to_api_key_audit)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Self-contained pool with just the `api_key_audit` table. Deliberately
    /// avoids the full migration chain — see the note in
    /// `external_api_keys.rs`'s test module (the chain drops these tables in the
    /// test binary).
    fn test_pool() -> crate::db::DbPool {
        use std::time::Duration;
        let tmp = std::env::temp_dir()
            .join(format!("apikeyaudit_test_{}.db", uuid::Uuid::new_v4()));
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&tmp);
        let pool = r2d2::Pool::builder()
            .max_size(2)
            .connection_timeout(Duration::from_secs(5))
            .build(manager)
            .expect("test pool build");
        pool.get()
            .expect("conn")
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS api_key_audit (
                    id          TEXT PRIMARY KEY,
                    key_id      TEXT NOT NULL,
                    at          TEXT NOT NULL DEFAULT (datetime('now')),
                    method      TEXT NOT NULL,
                    path        TEXT NOT NULL,
                    status      INTEGER NOT NULL,
                    persona_id  TEXT,
                    origin      TEXT
                );",
            )
            .expect("create api_key_audit");
        pool
    }

    #[test]
    fn insert_then_list_for_key_scoped_and_newest_first() {
        let pool = test_pool();
        insert(
            &pool,
            "key-1",
            "POST",
            "/api/execute/p1",
            200,
            Some("p1"),
            Some("https://app.example"),
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        insert(&pool, "key-1", "GET", "/api/personas", 200, None, None).unwrap();
        insert(&pool, "key-2", "GET", "/api/personas", 200, None, None).unwrap();

        let k1 = list_for_key(&pool, "key-1", 10).unwrap();
        assert_eq!(k1.len(), 2, "rows are scoped to the key");
        assert_eq!(k1[0].path, "/api/personas", "newest first");
        assert_eq!(k1[1].path, "/api/execute/p1");
        assert_eq!(k1[1].persona_id.as_deref(), Some("p1"));
        assert_eq!(k1[1].origin.as_deref(), Some("https://app.example"));
        assert_eq!(k1[1].status, 200);

        let k2 = list_for_key(&pool, "key-2", 10).unwrap();
        assert_eq!(k2.len(), 1);
    }

    #[test]
    fn history_is_capped_per_key() {
        let pool = test_pool();
        for i in 0..(RETAIN_PER_KEY + 20) {
            insert(&pool, "key-1", "GET", &format!("/api/x/{i}"), 200, None, None).unwrap();
        }
        let rows = list_for_key(&pool, "key-1", 1000).unwrap();
        assert!(
            rows.len() as i64 <= RETAIN_PER_KEY,
            "history must be capped at {RETAIN_PER_KEY}, got {}",
            rows.len()
        );
    }
}
