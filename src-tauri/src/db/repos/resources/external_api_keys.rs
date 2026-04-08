//! External API key persistence for the management HTTP API.
//!
//! Tokens are stored as SHA-256 hashes only — the plaintext is returned exactly
//! once at creation time and never again. Lookups by plaintext token hash the
//! input, then look up the row by the indexed `key_hash` column.

use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::db::models::{CreateApiKeyResponse, ExternalApiKey};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mapper
// ============================================================================

row_mapper!(row_to_external_api_key -> ExternalApiKey {
    id, name, key_hash, key_prefix, scopes,
    enabled [bool],
    created_at, last_used_at, revoked_at,
});

// ============================================================================
// Token helpers
// ============================================================================

/// SHA-256 hex digest of a token. Used for both storage and lookup.
fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Generate a fresh token of the form `pk_<32 hex chars>` and return it
/// alongside its short prefix (`pk_<first 6 hex chars>`) used for display.
fn generate_token() -> (String, String) {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex_token = hex::encode(bytes);
    let token = format!("pk_{hex_token}");
    let prefix = token.chars().take(9).collect::<String>(); // "pk_" + 6 hex chars
    (token, prefix)
}

// ============================================================================
// CRUD
// ============================================================================

/// Create a fresh API key. The plaintext token is returned ONCE and never
/// stored — only its SHA-256 hash is persisted.
pub fn create(
    pool: &DbPool,
    name: &str,
    scopes: Vec<String>,
) -> Result<CreateApiKeyResponse, AppError> {
    timed_query!("external_api_keys", "external_api_keys::create", {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(AppError::Validation("API key name cannot be empty".into()));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let (plaintext_token, key_prefix) = generate_token();
        let key_hash = hash_token(&plaintext_token);
        let scopes_json = serde_json::to_string(&scopes)
            .unwrap_or_else(|_| "[]".to_string());

        let conn = pool.get()?;
        let record = conn
            .query_row(
                "INSERT INTO external_api_keys
                    (id, name, key_hash, key_prefix, scopes, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1)
                 RETURNING *",
                params![id, trimmed_name, key_hash, key_prefix, scopes_json],
                row_to_external_api_key,
            )
            .map_err(AppError::Database)?;

        Ok(CreateApiKeyResponse {
            record,
            plaintext_token,
        })
    })
}

/// Return all API key records (without plaintext, naturally).
pub fn list(pool: &DbPool) -> Result<Vec<ExternalApiKey>, AppError> {
    timed_query!("external_api_keys", "external_api_keys::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM external_api_keys ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_external_api_key)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Look up a key by its plaintext token. Hashes the input, queries the indexed
/// `key_hash` column, and filters out disabled/revoked rows. Updates
/// `last_used_at` on a successful hit.
pub fn find_by_token(
    pool: &DbPool,
    plaintext_token: &str,
) -> Result<Option<ExternalApiKey>, AppError> {
    timed_query!("external_api_keys", "external_api_keys::find_by_token", {
        if plaintext_token.is_empty() {
            return Ok(None);
        }

        let key_hash = hash_token(plaintext_token);
        let conn = pool.get()?;

        let record = conn
            .query_row(
                "SELECT * FROM external_api_keys
                 WHERE key_hash = ?1 AND enabled = 1 AND revoked_at IS NULL",
                params![key_hash],
                row_to_external_api_key,
            )
            .optional()
            .map_err(AppError::Database)?;

        if let Some(ref key) = record {
            // Best-effort touch — failure here should not block auth.
            let _ = conn.execute(
                "UPDATE external_api_keys SET last_used_at = ?1 WHERE id = ?2",
                params![chrono::Utc::now().to_rfc3339(), key.id],
            );
        }

        Ok(record)
    })
}

/// Soft-delete: mark the key as revoked and disabled. The row remains for audit.
pub fn revoke(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("external_api_keys", "external_api_keys::revoke", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE external_api_keys
             SET revoked_at = ?1, enabled = 0
             WHERE id = ?2",
            params![chrono::Utc::now().to_rfc3339(), id],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("ExternalApiKey {id}")));
        }
        Ok(())
    })
}

/// Hard delete: remove the row entirely. Use sparingly — `revoke` is preferred.
pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("external_api_keys", "external_api_keys::delete", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM external_api_keys WHERE id = ?1",
            params![id],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("ExternalApiKey {id}")));
        }
        Ok(())
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Build a fresh in-memory SQLite pool with the full schema applied.
    /// Mirrors the helper in `db_schema.rs`'s test module — kept local because
    /// that one is private. Each call gets a uniquely-named shared-cache DB so
    /// parallel tests do not collide.
    fn test_pool() -> crate::db::DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:eapikey_testdb_{id}?mode=memory&cache=shared");
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
    fn create_then_find_by_token_roundtrip() {
        let pool = test_pool();
        let resp = create(&pool, "test-key", vec!["personas:read".into()])
            .expect("create should succeed");

        // Plaintext is returned once and starts with the expected prefix.
        assert!(resp.plaintext_token.starts_with("pk_"));
        assert!(resp.record.key_prefix.starts_with("pk_"));
        assert!(resp.record.enabled);
        assert!(resp.record.revoked_at.is_none());

        // The record itself does not contain the plaintext (key_hash is skip_serializing).
        let found = find_by_token(&pool, &resp.plaintext_token)
            .expect("find_by_token should not error");
        let found = found.expect("token should be found");
        assert_eq!(found.id, resp.record.id);

        // last_used_at gets touched on a successful lookup.
        let after = list(&pool).expect("list should succeed");
        let found_in_list = after.iter().find(|k| k.id == resp.record.id).unwrap();
        assert!(found_in_list.last_used_at.is_some());
    }

    #[test]
    fn list_does_not_return_plaintext() {
        let pool = test_pool();
        let _resp = create(&pool, "list-test", vec![]).expect("create");
        let rows = list(&pool).expect("list");
        assert_eq!(rows.len(), 1);
        // Sanity: serialized form must NOT contain the key_hash field.
        let json = serde_json::to_string(&rows[0]).unwrap();
        assert!(!json.contains("key_hash"));
    }

    #[test]
    fn revoke_disables_lookup() {
        let pool = test_pool();
        let resp = create(&pool, "revoke-test", vec![]).expect("create");
        revoke(&pool, &resp.record.id).expect("revoke");

        let found = find_by_token(&pool, &resp.plaintext_token).expect("query");
        assert!(found.is_none(), "revoked key must not resolve");

        // Row is still present in list (audit trail) but revoked_at is set.
        let rows = list(&pool).expect("list");
        let row = rows.iter().find(|k| k.id == resp.record.id).unwrap();
        assert!(row.revoked_at.is_some());
        assert!(!row.enabled);
    }

    #[test]
    fn delete_removes_the_row() {
        let pool = test_pool();
        let resp = create(&pool, "delete-test", vec![]).expect("create");
        delete(&pool, &resp.record.id).expect("delete");
        let rows = list(&pool).expect("list");
        assert!(rows.iter().all(|k| k.id != resp.record.id));
    }

    #[test]
    fn duplicate_names_have_distinct_hashes() {
        let pool = test_pool();
        let a = create(&pool, "dupe", vec![]).expect("create a");
        let b = create(&pool, "dupe", vec![]).expect("create b");
        assert_ne!(a.plaintext_token, b.plaintext_token);
        assert_ne!(a.record.id, b.record.id);
    }

    #[test]
    fn invalid_token_returns_none() {
        let pool = test_pool();
        let _ = create(&pool, "k", vec![]).expect("create");
        let found = find_by_token(&pool, "pk_not_a_real_token").expect("query");
        assert!(found.is_none());
    }

    #[test]
    fn empty_token_returns_none() {
        let pool = test_pool();
        let found = find_by_token(&pool, "").expect("query");
        assert!(found.is_none());
    }
}
