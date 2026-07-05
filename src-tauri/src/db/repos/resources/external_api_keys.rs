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
    expires_at, bound_origin, label,
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
///
/// `expires_at` (ISO 8601) sets a hard expiry enforced at lookup; `None` =
/// never expires. `bound_origin` restricts the key to a single browser origin
/// (set by the pairing ceremony); `None` = no restriction. `label` is an
/// optional human note. Existing callers pass `None` for all three.
pub fn create(
    pool: &DbPool,
    name: &str,
    scopes: Vec<String>,
    expires_at: Option<String>,
    bound_origin: Option<String>,
    label: Option<String>,
) -> Result<CreateApiKeyResponse, AppError> {
    timed_query!("external_api_keys", "external_api_keys::create", {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(AppError::Validation("API key name cannot be empty".into()));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let (plaintext_token, key_prefix) = generate_token();
        let key_hash = hash_token(&plaintext_token);
        let scopes_json = serde_json::to_string(&scopes).unwrap_or_else(|_| "[]".to_string());

        let conn = pool.get()?;
        let record = conn
            .query_row(
                "INSERT INTO external_api_keys
                    (id, name, key_hash, key_prefix, scopes, enabled,
                     expires_at, bound_origin, label)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8)
                 RETURNING *",
                params![
                    id,
                    trimmed_name,
                    key_hash,
                    key_prefix,
                    scopes_json,
                    expires_at,
                    bound_origin,
                    label
                ],
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
        let mut stmt = conn.prepare("SELECT * FROM external_api_keys ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], row_to_external_api_key)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Look up a key by its plaintext token. Hashes the input, queries the indexed
/// `key_hash` column, and filters out disabled/revoked/**expired** rows.
/// Updates `last_used_at` on a successful hit.
///
/// Expiry is checked in Rust (not SQL) via [`ExternalApiKey::is_expired_at`] so
/// a malformed `expires_at` fails closed instead of relying on lexical string
/// comparison. An expired key resolves to `None` — the caller sees the same
/// outcome (401) as a revoked key, and `last_used_at` is not touched.
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
            .map_err(AppError::Database)?
            .filter(|key| !key.is_expired_at(chrono::Utc::now()));

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
        let rows = conn.execute("DELETE FROM external_api_keys WHERE id = ?1", params![id])?;
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

    /// Deterministic pool holding exactly the `external_api_keys` table this
    /// repo owns, in its current shape (capability-token columns included).
    ///
    /// Deliberately does NOT go through the full migration chain
    /// (`db::init_test_db`): that chain does not reliably leave
    /// `external_api_keys` present in the test binary — a pre-existing,
    /// unrelated migration-harness issue where the table is absent from a fresh
    /// `init_test_db` (dropped during `run_incremental`; see
    /// docs/architecture/cloud-integration-bridge.md, P1 notes). Creating the
    /// one table directly keeps these repo tests hermetic and focused on the
    /// repo logic (token hashing, expiry enforcement, origin binding).
    fn test_pool() -> crate::db::DbPool {
        use std::time::Duration;
        let tmp =
            std::env::temp_dir().join(format!("eapikey_test_{}.db", uuid::Uuid::new_v4()));
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&tmp);
        let pool = r2d2::Pool::builder()
            .max_size(2)
            .connection_timeout(Duration::from_secs(5))
            .build(manager)
            .expect("test pool build");
        pool.get()
            .expect("conn")
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS external_api_keys (
                    id            TEXT PRIMARY KEY,
                    name          TEXT NOT NULL,
                    key_hash      TEXT NOT NULL UNIQUE,
                    key_prefix    TEXT NOT NULL,
                    scopes        TEXT NOT NULL DEFAULT '[]',
                    enabled       INTEGER NOT NULL DEFAULT 1,
                    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                    last_used_at  TEXT,
                    revoked_at    TEXT,
                    expires_at    TEXT,
                    bound_origin  TEXT,
                    label         TEXT
                );",
            )
            .expect("create external_api_keys");
        pool
    }

    #[test]
    fn create_then_find_by_token_roundtrip() {
        let pool = test_pool();
        let resp =
            create(&pool, "test-key", vec!["personas:read".into()], None, None, None)
                .expect("create should succeed");

        // Plaintext is returned once and starts with the expected prefix.
        assert!(resp.plaintext_token.starts_with("pk_"));
        assert!(resp.record.key_prefix.starts_with("pk_"));
        assert!(resp.record.enabled);
        assert!(resp.record.revoked_at.is_none());

        // The record itself does not contain the plaintext (key_hash is skip_serializing).
        let found =
            find_by_token(&pool, &resp.plaintext_token).expect("find_by_token should not error");
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
        let _resp = create(&pool, "list-test", vec![], None, None, None).expect("create");
        let rows = list(&pool).expect("list");
        assert_eq!(rows.len(), 1);
        // Sanity: serialized form must NOT contain the key_hash field.
        let json = serde_json::to_string(&rows[0]).unwrap();
        assert!(!json.contains("key_hash"));
    }

    #[test]
    fn revoke_disables_lookup() {
        let pool = test_pool();
        let resp = create(&pool, "revoke-test", vec![], None, None, None).expect("create");
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
        let resp = create(&pool, "delete-test", vec![], None, None, None).expect("create");
        delete(&pool, &resp.record.id).expect("delete");
        let rows = list(&pool).expect("list");
        assert!(rows.iter().all(|k| k.id != resp.record.id));
    }

    #[test]
    fn duplicate_names_have_distinct_hashes() {
        let pool = test_pool();
        let a = create(&pool, "dupe", vec![], None, None, None).expect("create a");
        let b = create(&pool, "dupe", vec![], None, None, None).expect("create b");
        assert_ne!(a.plaintext_token, b.plaintext_token);
        assert_ne!(a.record.id, b.record.id);
    }

    #[test]
    fn invalid_token_returns_none() {
        let pool = test_pool();
        let _ = create(&pool, "k", vec![], None, None, None).expect("create");
        let found = find_by_token(&pool, "pk_not_a_real_token").expect("query");
        assert!(found.is_none());
    }

    #[test]
    fn empty_token_returns_none() {
        let pool = test_pool();
        let found = find_by_token(&pool, "").expect("query");
        assert!(found.is_none());
    }

    #[test]
    fn expired_key_does_not_resolve() {
        let pool = test_pool();
        let past = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        let resp = create(&pool, "expired", vec![], Some(past), None, None).expect("create");

        let found = find_by_token(&pool, &resp.plaintext_token).expect("query");
        assert!(found.is_none(), "expired key must not resolve");

        // Row is still present (audit trail); expires_at is set.
        let rows = list(&pool).expect("list");
        let row = rows.iter().find(|k| k.id == resp.record.id).unwrap();
        assert!(row.expires_at.is_some());
    }

    #[test]
    fn future_expiry_key_resolves() {
        let pool = test_pool();
        let future = (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
        let resp = create(&pool, "not-yet", vec![], Some(future), None, None).expect("create");

        let found = find_by_token(&pool, &resp.plaintext_token).expect("query");
        assert!(found.is_some(), "key not yet expired must resolve");
    }

    #[test]
    fn malformed_expiry_fails_closed() {
        let pool = test_pool();
        let resp = create(
            &pool,
            "garbage-expiry",
            vec![],
            Some("not-a-timestamp".into()),
            None,
            None,
        )
        .expect("create");

        let found = find_by_token(&pool, &resp.plaintext_token).expect("query");
        assert!(found.is_none(), "unparseable expires_at must fail closed");
    }

    #[test]
    fn bound_origin_and_label_round_trip() {
        let pool = test_pool();
        let resp = create(
            &pool,
            "paired",
            vec![],
            None,
            Some("https://app.personas.example".into()),
            Some("Cloud dashboard".into()),
        )
        .expect("create");

        assert_eq!(
            resp.record.bound_origin.as_deref(),
            Some("https://app.personas.example")
        );
        assert_eq!(resp.record.label.as_deref(), Some("Cloud dashboard"));

        // The values survive a lookup (mapper reads the new columns).
        let found = find_by_token(&pool, &resp.plaintext_token)
            .expect("query")
            .expect("should resolve");
        assert_eq!(
            found.bound_origin.as_deref(),
            Some("https://app.personas.example")
        );
    }
}
