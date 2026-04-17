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
         WHERE NOT EXISTS (SELECT 1 FROM credential_fields cf WHERE cf.credential_id = c.id)"
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
        "base_url", "url", "host", "hostname", "server",
        "port", "database", "project", "organization", "org",
        "workspace", "team", "region", "scope", "scopes",
        "oauth_client_mode", "token_type",
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
                        cred_id, e
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
                    cred_id, e
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
                            key, cred_id, e
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

/// Classify a credential field key into a type hint.
pub(super) fn classify_field_type(key: &str) -> &'static str {
    let lower = key.to_lowercase();
    if lower.contains("url") || lower.contains("endpoint") || lower == "host" || lower == "server" {
        "url"
    } else if lower.contains("token") || lower.contains("key") || lower.contains("secret") || lower.contains("password") {
        "secret"
    } else if lower == "port" {
        "number"
    } else if lower.contains("email") || lower.contains("username") || lower.contains("user") {
        "identity"
    } else {
        "text"
    }
}
