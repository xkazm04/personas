use std::collections::HashMap;

use rusqlite::{params, Row};

use crate::db::models::{
    CreateCredentialEventInput, CreateCredentialInput, CredentialEvent, CredentialField,
    PersonaCredential, UpdateCredentialEventInput, UpdateCredentialInput,
};
use crate::db::DbPool;
use crate::engine::crypto;
use crate::error::AppError;

// ============================================================================
// Row Mappers
// ============================================================================

fn row_to_credential(row: &Row) -> rusqlite::Result<PersonaCredential> {
    Ok(PersonaCredential {
        id: row.get("id")?,
        name: row.get("name")?,
        service_type: row.get("service_type")?,
        encrypted_data: row.get("encrypted_data")?,
        iv: row.get("iv")?,
        metadata: row.get("metadata")?,
        last_used_at: row.get("last_used_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_credential_event(row: &Row) -> rusqlite::Result<CredentialEvent> {
    Ok(CredentialEvent {
        id: row.get("id")?,
        credential_id: row.get("credential_id")?,
        event_template_id: row.get("event_template_id")?,
        name: row.get("name")?,
        config: row.get("config")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        last_polled_at: row.get("last_polled_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// ============================================================================
// Credential CRUD
// ============================================================================

pub fn get_all(pool: &DbPool) -> Result<Vec<PersonaCredential>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM persona_credentials ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], row_to_credential)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaCredential, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_credentials WHERE id = ?1",
        params![id],
        row_to_credential,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Credential {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_by_service_type(
    pool: &DbPool,
    service_type: &str,
) -> Result<Vec<PersonaCredential>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_credentials WHERE service_type = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![service_type], row_to_credential)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn create(pool: &DbPool, input: CreateCredentialInput) -> Result<PersonaCredential, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_credentials
         (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            input.name,
            input.service_type,
            input.encrypted_data,
            input.iv,
            input.metadata,
            now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateCredentialInput,
) -> Result<PersonaCredential, AppError> {
    // Verify exists
    get_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.name, "name", sets, param_idx);
    push_field!(input.service_type, "service_type", sets, param_idx);
    push_field!(input.encrypted_data, "encrypted_data", sets, param_idx);
    push_field!(input.iv, "iv", sets, param_idx);
    push_field!(input.metadata, "metadata", sets, param_idx);

    let sql = format!(
        "UPDATE persona_credentials SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.name {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.service_type {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.encrypted_data {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.iv {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.metadata {
        param_values.push(Box::new(v.clone()));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    // Explicitly clean up dependent rows to guarantee no orphans even if
    // PRAGMA foreign_keys is not active on this connection.
    conn.execute("DELETE FROM credential_fields WHERE credential_id = ?1", params![id])?;
    conn.execute("DELETE FROM credential_rotation_history WHERE credential_id = ?1", params![id])?;
    conn.execute("DELETE FROM credential_rotation_policies WHERE credential_id = ?1", params![id])?;
    conn.execute("DELETE FROM credential_events WHERE credential_id = ?1", params![id])?;
    let rows = conn.execute("DELETE FROM persona_credentials WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// Update only the metadata column for a credential.
/// Used by the anomaly scoring engine to persist healthcheck ring buffer data
/// without touching encrypted fields.
pub fn update_metadata(pool: &DbPool, id: &str, metadata: Option<&str>) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let rows = conn.execute(
        "UPDATE persona_credentials SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
        params![metadata, now, id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Credential {id}")));
    }
    Ok(())
}

pub fn mark_used(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let rows = conn.execute(
        "UPDATE persona_credentials SET last_used_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Credential {id}")));
    }
    Ok(())
}

// ============================================================================
// Credential Event CRUD
// ============================================================================

pub fn get_events_by_credential(
    pool: &DbPool,
    credential_id: &str,
) -> Result<Vec<CredentialEvent>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM credential_events WHERE credential_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![credential_id], row_to_credential_event)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_all_events(pool: &DbPool) -> Result<Vec<CredentialEvent>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM credential_events ORDER BY credential_id, created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_credential_event)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_event_by_id(pool: &DbPool, id: &str) -> Result<CredentialEvent, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM credential_events WHERE id = ?1",
        params![id],
        row_to_credential_event,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("CredentialEvent {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_enabled_events(pool: &DbPool) -> Result<Vec<CredentialEvent>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM credential_events WHERE enabled = 1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_credential_event)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn create_event(
    pool: &DbPool,
    input: CreateCredentialEventInput,
) -> Result<CredentialEvent, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let enabled = input.enabled.unwrap_or(true) as i32;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO credential_events
         (id, credential_id, event_template_id, name, config, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            input.credential_id,
            input.event_template_id,
            input.name,
            input.config,
            enabled,
            now,
        ],
    )?;

    get_event_by_id(pool, &id)
}

pub fn update_event(
    pool: &DbPool,
    id: &str,
    input: UpdateCredentialEventInput,
) -> Result<CredentialEvent, AppError> {
    // Verify exists
    get_event_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.name, "name", sets, param_idx);
    push_field!(input.config, "config", sets, param_idx);
    push_field!(input.enabled, "enabled", sets, param_idx);
    push_field!(input.last_polled_at, "last_polled_at", sets, param_idx);

    let sql = format!(
        "UPDATE credential_events SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.name {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.config {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(v) = input.enabled {
        param_values.push(Box::new(v as i32));
    }
    if let Some(ref v) = input.last_polled_at {
        param_values.push(Box::new(v.clone()));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_event_by_id(pool, id)
}

pub fn delete_event(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM credential_events WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn delete_events_by_credential(pool: &DbPool, credential_id: &str) -> Result<i64, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM credential_events WHERE credential_id = ?1",
        params![credential_id],
    )?;
    Ok(rows as i64)
}

// ============================================================================
// Credential Field CRUD (field-level storage)
// ============================================================================

fn row_to_credential_field(row: &Row) -> rusqlite::Result<CredentialField> {
    Ok(CredentialField {
        id: row.get("id")?,
        credential_id: row.get("credential_id")?,
        field_key: row.get("field_key")?,
        encrypted_value: row.get("encrypted_value")?,
        iv: row.get("iv")?,
        field_type: row.get("field_type")?,
        is_sensitive: row.get::<_, i32>("is_sensitive")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Get all field rows for a credential.
pub fn get_fields(pool: &DbPool, credential_id: &str) -> Result<Vec<CredentialField>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM credential_fields WHERE credential_id = ?1 ORDER BY field_key"
    )?;
    let rows = stmt.query_map(params![credential_id], row_to_credential_field)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Save (upsert) all fields for a credential from a `HashMap<String, String>`.
/// Encrypts sensitive fields individually. Replaces any existing field rows
/// by deleting first, then inserting — wrapped in a transaction to prevent
/// partial state if encryption or insertion fails mid-loop.
pub fn save_fields(
    pool: &DbPool,
    credential_id: &str,
    fields: &HashMap<String, String>,
) -> Result<usize, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    // Non-sensitive field keys (stored as queryable plaintext)
    const NON_SENSITIVE_KEYS: &[&str] = &[
        "base_url", "url", "host", "hostname", "server",
        "port", "database", "project", "organization", "org",
        "workspace", "team", "region", "scope", "scopes",
        "oauth_client_mode", "token_type",
    ];

    // Remove existing field rows and re-insert atomically
    tx.execute(
        "DELETE FROM credential_fields WHERE credential_id = ?1",
        params![credential_id],
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut count = 0usize;

    for (key, value) in fields {
        let is_sensitive = !NON_SENSITIVE_KEYS.contains(&key.to_lowercase().as_str());
        let (enc_val, field_iv) = crypto::encrypt_field(value, is_sensitive)
            .map_err(|e| AppError::Internal(format!("Field encryption failed: {}", e)))?;

        let field_type = classify_field_type(key);
        let field_id = uuid::Uuid::new_v4().to_string();

        tx.execute(
            "INSERT INTO credential_fields
             (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                field_id,
                credential_id,
                key,
                enc_val,
                field_iv,
                field_type,
                is_sensitive as i32,
                now,
            ],
        )?;
        count += 1;
    }

    tx.commit().map_err(AppError::Database)?;
    Ok(count)
}

/// Update a single credential field. If the field doesn't exist, inserts it.
pub fn upsert_field(
    pool: &DbPool,
    credential_id: &str,
    field_key: &str,
    field_value: &str,
    is_sensitive: bool,
) -> Result<(), AppError> {
    let (enc_val, field_iv) = crypto::encrypt_field(field_value, is_sensitive)
        .map_err(|e| AppError::Internal(format!("Field encryption failed: {}", e)))?;

    let now = chrono::Utc::now().to_rfc3339();
    let field_type = classify_field_type(field_key);
    let conn = pool.get()?;

    // Try UPDATE first
    let rows = conn.execute(
        "UPDATE credential_fields SET encrypted_value = ?1, iv = ?2, field_type = ?3,
         is_sensitive = ?4, updated_at = ?5 WHERE credential_id = ?6 AND field_key = ?7",
        params![enc_val, field_iv, field_type, is_sensitive as i32, now, credential_id, field_key],
    )?;

    if rows == 0 {
        let field_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO credential_fields
             (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![field_id, credential_id, field_key, enc_val, field_iv, field_type, is_sensitive as i32, now],
        )?;
    }

    Ok(())
}

/// Delete all field rows for a credential.
pub fn delete_fields(pool: &DbPool, credential_id: &str) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM credential_fields WHERE credential_id = ?1",
        params![credential_id],
    )?;
    Ok(rows)
}

// ============================================================================
// Unified field decryption (field-level storage)
// ============================================================================

/// Get decrypted credential fields as a `HashMap<String, String>`.
///
/// Reads from the `credential_fields` table and decrypts each field
/// independently using per-field AES-256-GCM nonces.
///
/// This is the single entry point that all consumers (runner, healthcheck,
/// connector_strategy, gitlab converter) should use.
pub fn get_decrypted_fields(
    pool: &DbPool,
    credential: &PersonaCredential,
) -> Result<HashMap<String, String>, AppError> {
    let field_rows = get_fields(pool, &credential.id)?;

    let mut result = HashMap::with_capacity(field_rows.len());
    for field in &field_rows {
        let value = crypto::decrypt_field(&field.encrypted_value, &field.iv)
            .map_err(|e| AppError::Internal(format!(
                "Failed to decrypt field '{}' of credential '{}': {}",
                field.field_key, credential.name, e
            )))?;
        result.insert(field.field_key.clone(), value);
    }
    Ok(result)
}

/// Classify a credential field key into a type hint.
fn classify_field_type(key: &str) -> &'static str {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_credential_crud() {
        let pool = init_test_db().unwrap();

        // Create
        let cred = create(
            &pool,
            CreateCredentialInput {
                name: "My Gmail".into(),
                service_type: "gmail".into(),
                encrypted_data: "enc_data_abc".into(),
                iv: "iv_123".into(),
                metadata: Some("{\"email\": \"test@gmail.com\"}".into()),
            },
        )
        .unwrap();
        assert_eq!(cred.name, "My Gmail");
        assert_eq!(cred.service_type, "gmail");
        assert!(cred.last_used_at.is_none());

        // Get by id
        let fetched = get_by_id(&pool, &cred.id).unwrap();
        assert_eq!(fetched.id, cred.id);
        assert_eq!(fetched.encrypted_data, "enc_data_abc");

        // Get by service type
        let by_type = get_by_service_type(&pool, "gmail").unwrap();
        assert_eq!(by_type.len(), 1);

        // Get all
        let all = get_all(&pool).unwrap();
        assert_eq!(all.len(), 1);

        // Mark used
        mark_used(&pool, &cred.id).unwrap();
        let after_used = get_by_id(&pool, &cred.id).unwrap();
        assert!(after_used.last_used_at.is_some());

        // Update (partial — only change name and encrypted_data)
        let updated = update(
            &pool,
            &cred.id,
            UpdateCredentialInput {
                name: Some("Updated Gmail".into()),
                service_type: None,
                encrypted_data: Some("enc_data_xyz".into()),
                iv: Some("iv_456".into()),
                metadata: Some(None),
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Updated Gmail");
        assert_eq!(updated.encrypted_data, "enc_data_xyz");
        assert_eq!(updated.iv, "iv_456");
        assert!(updated.metadata.is_none());
        // service_type should be unchanged
        assert_eq!(updated.service_type, "gmail");

        // Delete
        let deleted = delete(&pool, &cred.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &cred.id).is_err());

        // Mark used on non-existent should fail
        let mark_result = mark_used(&pool, "nonexistent");
        assert!(mark_result.is_err());
    }

    #[test]
    fn test_credential_event_crud() {
        let pool = init_test_db().unwrap();

        // Create a credential first (required by FK)
        let cred = create(
            &pool,
            CreateCredentialInput {
                name: "Event Test Cred".into(),
                service_type: "github".into(),
                encrypted_data: "enc_token".into(),
                iv: "iv_evt".into(),
                metadata: None,
            },
        )
        .unwrap();

        // Create event
        let event = create_event(
            &pool,
            CreateCredentialEventInput {
                credential_id: cred.id.clone(),
                event_template_id: "tpl_pr_opened".into(),
                name: "PR Opened".into(),
                config: Some("{\"repo\": \"myrepo\"}".into()),
                enabled: Some(true),
            },
        )
        .unwrap();
        assert_eq!(event.name, "PR Opened");
        assert!(event.enabled);
        assert_eq!(event.credential_id, cred.id);

        // Get event by id
        let fetched_event = get_event_by_id(&pool, &event.id).unwrap();
        assert_eq!(fetched_event.id, event.id);

        // Get events by credential
        let by_cred = get_events_by_credential(&pool, &cred.id).unwrap();
        assert_eq!(by_cred.len(), 1);

        // Get enabled events
        let enabled = get_enabled_events(&pool).unwrap();
        assert_eq!(enabled.len(), 1);

        // Update event
        let updated_event = update_event(
            &pool,
            &event.id,
            UpdateCredentialEventInput {
                name: Some("PR Opened v2".into()),
                config: None,
                enabled: Some(false),
                last_polled_at: None,
            },
        )
        .unwrap();
        assert_eq!(updated_event.name, "PR Opened v2");
        assert!(!updated_event.enabled);

        // Enabled events should now be empty
        let enabled_after = get_enabled_events(&pool).unwrap();
        assert_eq!(enabled_after.len(), 0);

        // Create a second event
        let event2 = create_event(
            &pool,
            CreateCredentialEventInput {
                credential_id: cred.id.clone(),
                event_template_id: "tpl_issue_created".into(),
                name: "Issue Created".into(),
                config: None,
                enabled: Some(true),
            },
        )
        .unwrap();

        // Delete single event
        let deleted_evt = delete_event(&pool, &event.id).unwrap();
        assert!(deleted_evt);
        assert!(get_event_by_id(&pool, &event.id).is_err());

        // event2 should still exist
        assert!(get_event_by_id(&pool, &event2.id).is_ok());

        // Delete all events by credential
        let deleted_count = delete_events_by_credential(&pool, &cred.id).unwrap();
        assert_eq!(deleted_count, 1); // only event2 remained
        let remaining = get_events_by_credential(&pool, &cred.id).unwrap();
        assert_eq!(remaining.len(), 0);
    }
}
