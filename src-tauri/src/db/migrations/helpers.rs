use rusqlite::Connection;

use crate::error::AppError;

/// Split existing monolithic encrypted_data blobs into per-field rows.
/// Only processes credentials that don't already have field rows (idempotent).
/// Runs inside the caller's connection -- the incremental migration context
/// means this is already within a serialized startup sequence.
pub(super) fn migrate_blob_credentials_to_fields(conn: &Connection) -> Result<(), AppError> {
    use crate::engine::crypto;
    use std::collections::HashMap;

    // Find credentials that have no field rows yet
    let mut stmt = conn.prepare(
        "SELECT c.id, c.encrypted_data, c.iv FROM persona_credentials c
         WHERE NOT EXISTS (SELECT 1 FROM credential_fields cf WHERE cf.credential_id = c.id)",
    )?;

    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut insert_stmt = conn.prepare(
        "INSERT OR IGNORE INTO credential_fields
         (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)"
    )?;

    let mut total_fields = 0usize;

    // Classify which field keys are typically non-sensitive (queryable)
    const NON_SENSITIVE_KEYS: &[&str] = &[
        "base_url",
        "url",
        "host",
        "hostname",
        "server",
        "port",
        "database",
        "project",
        "organization",
        "org",
        "workspace",
        "team",
        "region",
        "scope",
        "scopes",
        "oauth_client_mode",
        "token_type",
    ];

    for (cred_id, encrypted_data, iv) in &rows {
        // Decrypt the blob to get the JSON fields
        let plaintext = if crypto::is_plaintext(iv) {
            encrypted_data.clone()
        } else {
            match crypto::decrypt_from_db(encrypted_data, iv) {
                Ok(pt) => pt,
                Err(e) => {
                    tracing::warn!(
                        "Skipping field migration for credential {}: decrypt failed: {}",
                        cred_id,
                        e
                    );
                    continue;
                }
            }
        };

        let fields: HashMap<String, String> = match serde_json::from_str(&plaintext) {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!(
                    "Skipping field migration for credential {}: invalid JSON: {}",
                    cred_id,
                    e
                );
                continue;
            }
        };

        for (key, value) in &fields {
            let field_id = uuid::Uuid::new_v4().to_string();
            let is_sensitive = !NON_SENSITIVE_KEYS.contains(&key.to_lowercase().as_str());

            let (enc_val, field_iv) = if is_sensitive && !value.is_empty() {
                match crypto::encrypt_for_db(value) {
                    Ok((ct, nonce)) => (ct, nonce),
                    Err(e) => {
                        tracing::warn!(
                            "Failed to encrypt field '{}' for credential {}: {}",
                            key,
                            cred_id,
                            e
                        );
                        continue;
                    }
                }
            } else {
                // Non-sensitive: store as plaintext for queryability
                (value.clone(), String::new())
            };

            let field_type = classify_field_type(key);

            insert_stmt.execute(rusqlite::params![
                field_id,
                cred_id,
                key,
                enc_val,
                field_iv,
                field_type,
                is_sensitive as i32,
                now,
            ])?;
            total_fields += 1;
        }
    }

    if total_fields > 0 {
        tracing::info!(
            "Migrated {} credentials ({} total fields) from blob to field-level storage",
            rows.len(),
            total_fields
        );
    }

    Ok(())
}

/// Empty the legacy `encrypted_data` / `iv` columns on every credential whose
/// fields have been split into `credential_fields`. Once a credential's
/// secrets live in field rows, the blob columns are by-contract empty — see
/// the invariant on `PersonaCredential`. Running this idempotently on every
/// startup makes the dual-source-of-truth bug irreversible-by-design: a
/// reader can no longer "silently prefer" the blob over the fields because
/// the blob is gone.
///
/// Safety: only clears blobs on rows that already have at least one field
/// row, so a partial migration (e.g. decrypt failure earlier in
/// `migrate_blob_credentials_to_fields`) preserves the original blob until
/// the next attempt succeeds.
pub(super) fn clear_legacy_credential_blobs(conn: &Connection) -> Result<(), AppError> {
    let cleared = conn.execute(
        "UPDATE persona_credentials
            SET encrypted_data = '', iv = ''
          WHERE (encrypted_data <> '' OR iv <> '')
            AND EXISTS (
                SELECT 1 FROM credential_fields cf WHERE cf.credential_id = persona_credentials.id
            )",
        [],
    )?;
    if cleared > 0 {
        tracing::info!(
            "Cleared legacy encrypted_data/iv blobs on {cleared} migrated credential row(s)"
        );
    }
    Ok(())
}

/// Startup invariant assertion: every credential with field rows must have
/// `encrypted_data == ''` AND `iv == ''`. A violation indicates either a
/// regression in `create_credential` (re-populating the blob) or a partial
/// state that should not exist after `clear_legacy_credential_blobs`. Logged
/// at `tracing::error!` so the violation is loud — it does not crash the
/// app, since a transient inconsistency during a future migration may be
/// acceptable, but every breach is captured for forensic review.
pub(super) fn assert_credential_blob_invariant(conn: &Connection) -> Result<(), AppError> {
    let mut stmt = conn.prepare(
        "SELECT c.id FROM persona_credentials c
          WHERE (c.encrypted_data <> '' OR c.iv <> '')
            AND EXISTS (
                SELECT 1 FROM credential_fields cf WHERE cf.credential_id = c.id
            )",
    )?;
    let bad: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    if !bad.is_empty() {
        tracing::error!(
            count = bad.len(),
            credential_ids = ?bad,
            "credential blob invariant violated: rows have both blob data AND credential_fields rows; \
             credential_fields is the source of truth and the blob columns must be empty for these IDs"
        );
    }
    Ok(())
}

/// Normalize legacy camelCase credential field keys to snake_case.
///
/// Some credentials were stored with `refreshToken` instead of `refresh_token`.
/// This migration renames them so all code paths can use the canonical snake_case
/// key without dual-convention checks.
pub(super) fn normalize_credential_field_keys(conn: &Connection) -> Result<(), AppError> {
    // Map of camelCase → snake_case field keys to normalize.
    let renames: &[(&str, &str)] = &[
        ("refreshToken", "refresh_token"),
        ("accessToken", "access_token"),
        ("clientId", "client_id"),
        ("clientSecret", "client_secret"),
        ("tokenType", "token_type"),
    ];

    for &(old_key, new_key) in renames {
        // Only rename if there isn't already a row with the canonical key for
        // the same credential (avoid unique-constraint violations).
        let updated = conn.execute(
            "UPDATE credential_fields SET field_key = ?1
             WHERE field_key = ?2
               AND credential_id NOT IN (
                   SELECT credential_id FROM credential_fields WHERE field_key = ?1
               )",
            rusqlite::params![new_key, old_key],
        )?;
        if updated > 0 {
            tracing::info!("Normalized {updated} credential field(s): {old_key} → {new_key}");
        }
    }

    Ok(())
}

/// One-shot migration: collapse the two `dev_ideas.category` vocabularies
/// into the single canonical `IdeaCategory` enum. See the doc comment on
/// `db::models::IdeaCategory` for the full mapping. Idempotent: running this
/// on already-migrated rows is a no-op.
///
/// Anything outside both known vocabularies is left untouched and reported
/// at `tracing::warn!`. We don't blanket-overwrite mystery values because
/// they may carry intent we'd silently lose; logging them gives a forensic
/// trail without dropping data.
pub(super) fn reconcile_idea_category_vocabulary(conn: &Connection) -> Result<(), AppError> {
    // Skip if the table doesn't exist yet (fresh DB before schema apply).
    let exists: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dev_ideas'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !exists {
        return Ok(());
    }

    // Mapping legacy → canonical. Mirrors `IdeaCategory::from_token`. Kept
    // inline so the SQL is auditable in one place.
    let remaps: &[(&str, &str)] = &[
        ("functionality", "technical"),
        ("performance", "technical"),
        ("maintenance", "technical"),
        ("code_quality", "technical"),
        ("ui", "user"),
        ("user_benefit", "user"),
    ];

    let mut total = 0i64;
    for &(legacy, canonical) in remaps {
        let n = conn.execute(
            "UPDATE dev_ideas SET category = ?1 WHERE category = ?2",
            rusqlite::params![canonical, legacy],
        )? as i64;
        if n > 0 {
            tracing::info!(
                "dev_ideas: remapped {n} row(s) from category '{legacy}' → '{canonical}'"
            );
            total += n;
        }
    }
    if total == 0 {
        return Ok(());
    }

    // Forensic trail for unknown values: log distinct survivors so a future
    // operator can decide whether to extend the mapping.
    let mut stmt = conn.prepare(
        "SELECT category, COUNT(*) FROM dev_ideas
          WHERE category NOT IN ('technical','user','business','mastermind')
          GROUP BY category",
    )?;
    let rows: Vec<(String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    for (cat, count) in rows {
        tracing::warn!(
            "dev_ideas: {count} row(s) carry unknown category '{cat}' — outside both vocabularies, left untouched"
        );
    }
    Ok(())
}

/// Install schema-level invariants for `persona_memories` that the table-level
/// CHECK clause can't carry (SQLite does not allow `ALTER TABLE` to add a
/// CHECK constraint, and the column was added incrementally). Implemented as
/// `BEFORE INSERT/UPDATE` triggers that ABORT on out-of-range importance.
///
/// See the MEMORY CONTRACT block on `db::models::PersonaMemory` for why the
/// bound is 1..=5. Idempotent: triggers are dropped-then-recreated so any
/// future tweak to the bound takes effect on the next launch.
pub(super) fn install_persona_memory_invariants(conn: &Connection) -> Result<(), AppError> {
    // Skip cleanly if the table doesn't exist yet on this DB (migrations
    // can run in unusual orders during test setup).
    let exists: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='persona_memories'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !exists {
        return Ok(());
    }

    conn.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS persona_memories_importance_insert;
        DROP TRIGGER IF EXISTS persona_memories_importance_update;

        CREATE TRIGGER persona_memories_importance_insert
        BEFORE INSERT ON persona_memories
        FOR EACH ROW
        WHEN NEW.importance IS NOT NULL AND (NEW.importance < 1 OR NEW.importance > 5)
        BEGIN
            SELECT RAISE(ABORT, 'persona_memories.importance must be in 1..=5 (MEMORY CONTRACT 4)');
        END;

        CREATE TRIGGER persona_memories_importance_update
        BEFORE UPDATE OF importance ON persona_memories
        FOR EACH ROW
        WHEN NEW.importance IS NOT NULL AND (NEW.importance < 1 OR NEW.importance > 5)
        BEGIN
            SELECT RAISE(ABORT, 'persona_memories.importance must be in 1..=5 (MEMORY CONTRACT 4)');
        END;
        "#,
    )?;
    Ok(())
}

/// Classify a credential field key into a type hint.
pub(super) fn classify_field_type(key: &str) -> &'static str {
    let lower = key.to_lowercase();
    if lower.contains("url") || lower.contains("endpoint") || lower == "host" || lower == "server" {
        "url"
    } else if lower.contains("token")
        || lower.contains("key")
        || lower.contains("secret")
        || lower.contains("password")
    {
        "secret"
    } else if lower == "port" {
        "number"
    } else if lower.contains("email") || lower.contains("username") || lower.contains("user") {
        "identity"
    } else {
        "text"
    }
}
