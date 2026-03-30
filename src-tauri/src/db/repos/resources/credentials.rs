use std::collections::HashMap;

use rusqlite::{params, OptionalExtension};

use crate::db::models::{
    CreateCredentialEventInput, CreateCredentialInput, CredentialEvent, CredentialField,
    CredentialLedger, PersonaCredential, UpdateCredentialEventInput, UpdateCredentialInput,
};
use crate::db::DbPool;
use crate::engine::crypto;
use crate::error::AppError;
use crate::utils::sanitization::sanitize_secrets;

// ============================================================================
// Row Mappers
// ============================================================================

row_mapper!(row_to_credential -> PersonaCredential {
    id, name, service_type, encrypted_data, iv,
    metadata, last_used_at, created_at, updated_at,
});

row_mapper!(row_to_credential_event -> CredentialEvent {
    id, credential_id, event_template_id, name, config,
    enabled [bool],
    last_polled_at, created_at, updated_at,
});

// ============================================================================
// Non-sensitive field keys (single source of truth)
// ============================================================================

/// Field keys that are stored as queryable plaintext rather than encrypted.
/// Used by both `create_with_fields` and `save_fields` to classify sensitivity.
pub const NON_SENSITIVE_KEYS: &[&str] = &[
    "base_url", "url", "host", "hostname", "server",
    "port", "database", "project", "organization", "org",
    "workspace", "team", "region", "scope", "scopes",
    "oauth_client_mode", "token_type",
];

/// Build a lookup map of `field_key -> is_sensitive` from a connector's fields
/// JSON.  Returns `None` if the connector is not found or its fields column
/// cannot be parsed.  Each field object may contain an explicit `"sensitive"`
/// boolean; when absent the field defaults to sensitive (`true`).
pub fn sensitivity_map_for_connector(
    pool: &DbPool,
    service_type: &str,
) -> Option<HashMap<String, bool>> {
    use crate::db::repos::resources::connectors;

    let def = connectors::get_by_name(pool, service_type).ok()??;

    #[derive(serde::Deserialize)]
    struct FieldEntry {
        key: String,
        sensitive: Option<bool>,
    }

    let entries: Vec<FieldEntry> = serde_json::from_str(&def.fields).ok()?;
    let mut map = HashMap::new();
    for entry in entries {
        map.insert(entry.key.clone(), entry.sensitive.unwrap_or(true));
    }
    Some(map)
}

/// Determine whether a credential field is sensitive.
///
/// Priority:
/// 1. Connector schema `sensitive` flag (authoritative single source of truth)
/// 2. Fallback to `NON_SENSITIVE_KEYS` heuristic for connectors without schema
///    annotations or for ad-hoc fields not declared in the schema.
pub fn is_field_sensitive(
    sensitivity_map: Option<&HashMap<String, bool>>,
    field_key: &str,
) -> bool {
    if let Some(map) = sensitivity_map {
        if let Some(&sensitive) = map.get(field_key) {
            return sensitive;
        }
    }
    // Fallback: any key NOT in the hardcoded list is treated as sensitive
    !NON_SENSITIVE_KEYS.contains(&field_key.to_lowercase().as_str())
}

// ============================================================================
// Credential CRUD
// ============================================================================

crud_get_by_id!(PersonaCredential, "persona_credentials", "Credential", row_to_credential);
crud_get_all!(PersonaCredential, "persona_credentials", row_to_credential, "created_at DESC");

/// Count total credentials and plaintext (unencrypted) credentials via SQL.
/// Much cheaper than `get_all` when only aggregate counts are needed.
pub fn count_vault_status(pool: &DbPool) -> Result<(i64, i64), AppError> {
    timed_query!("persona_credentials", "persona_credentials::count_vault_status", {
        let conn = pool.get()?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM persona_credentials",
            [],
            |row| row.get(0),
        ).map_err(AppError::Database)?;
        let plaintext: i64 = conn.query_row(
            "SELECT COUNT(*) FROM persona_credentials WHERE iv = ''",
            [],
            |row| row.get(0),
        ).map_err(AppError::Database)?;
        Ok((total, plaintext))
    })
}

/// Return the distinct set of service types that already exist in the vault.
/// Much cheaper than `get_all` when only the service types are needed.
pub fn get_distinct_service_types(
    pool: &DbPool,
) -> Result<std::collections::HashSet<String>, AppError> {
    timed_query!("persona_credentials", "persona_credentials::get_distinct_service_types", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT DISTINCT service_type FROM persona_credentials",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut set = std::collections::HashSet::new();
        for row in rows {
            set.insert(row?);
        }
        Ok(set)
    })
}

pub fn get_by_service_type(
    pool: &DbPool,
    service_type: &str,
) -> Result<Vec<PersonaCredential>, AppError> {
    timed_query!("persona_credentials", "persona_credentials::get_by_service_type", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_credentials WHERE service_type = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![service_type], row_to_credential)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

pub fn create(pool: &DbPool, input: CreateCredentialInput) -> Result<PersonaCredential, AppError> {
    timed_query!("persona_credentials", "persona_credentials::create", {
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

    })
}

/// Create a credential and save its fields in a single SQLite transaction.
/// If field encryption or insertion fails, the credential row is rolled back
/// automatically -- no orphaned rows.
pub fn create_with_fields(
    pool: &DbPool,
    input: CreateCredentialInput,
    fields: &HashMap<String, String>,
) -> Result<PersonaCredential, AppError> {
    timed_query!("persona_credentials", "persona_credentials::create_with_fields", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let sens_map = sensitivity_map_for_connector(pool, &input.service_type);

        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;

        tx.execute(
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

        for (key, value) in fields {
            let is_sensitive = is_field_sensitive(sens_map.as_ref(), key);
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
                    id,
                    key,
                    enc_val,
                    field_iv,
                    field_type,
                    is_sensitive as i32,
                    now,
                ],
            )?;
        }

        tx.commit().map_err(AppError::Database)?;
        get_by_id(pool, &id)

    })
}

crud_update! {
    model: PersonaCredential,
    table: "persona_credentials",
    input: UpdateCredentialInput,
    fields: {
        name: clone,
        service_type: clone,
        encrypted_data: clone,
        iv: clone,
        metadata: clone,
    }
}

/// Update credential metadata and save fields in a single SQLite transaction.
/// Prevents inconsistent state where metadata succeeds but field save fails.
pub fn update_with_fields(
    pool: &DbPool,
    id: &str,
    input: UpdateCredentialInput,
    fields: Option<&HashMap<String, String>>,
) -> Result<PersonaCredential, AppError> {
    timed_query!("persona_credentials", "persona_credentials::update_with_fields", {
        // Verify exists and get service_type for sensitivity lookup
        let existing = get_by_id(pool, id)?;

        // Use the new service_type if being updated, otherwise keep existing
        let effective_service_type = input.service_type.as_deref()
            .unwrap_or(&existing.service_type);
        let sens_map = sensitivity_map_for_connector(pool, effective_service_type);

        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;

        // -- 1. Update credential metadata --
        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now.clone())];

        push_field_param!(input.name, "name", sets, param_idx, param_values, clone);
        push_field_param!(input.service_type, "service_type", sets, param_idx, param_values, clone);
        push_field_param!(input.encrypted_data, "encrypted_data", sets, param_idx, param_values, clone);
        push_field_param!(input.iv, "iv", sets, param_idx, param_values, clone);
        push_field_param!(input.metadata, "metadata", sets, param_idx, param_values, clone);
        param_values.push(Box::new(id.to_string()));

        let sql = format!(
            "UPDATE persona_credentials SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        tx.execute(&sql, params_ref.as_slice())?;

        // -- 2. Save fields if provided --
        if let Some(field_map) = fields {
            if !field_map.is_empty() {
                // Delete existing fields and re-insert within the same transaction
                tx.execute(
                    "DELETE FROM credential_fields WHERE credential_id = ?1",
                    params![id],
                )?;

                for (key, value) in field_map {
                    let is_sensitive = is_field_sensitive(sens_map.as_ref(), key);
                    let (enc_val, field_iv) = crypto::encrypt_field(value, is_sensitive)
                        .map_err(|e| AppError::Internal(format!("Field encryption failed: {e}")))?;

                    let field_type = classify_field_type(key);
                    let field_id = uuid::Uuid::new_v4().to_string();

                    tx.execute(
                        "INSERT INTO credential_fields
                         (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                        params![
                            field_id, id, key, enc_val, field_iv,
                            field_type, is_sensitive as i32, now,
                        ],
                    )?;
                }
            }
        }

        tx.commit().map_err(AppError::Database)?;
        get_by_id(pool, id)

    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("persona_credentials", "persona_credentials::delete", {
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;

        // Explicitly clean up dependent rows to guarantee no orphans even if
        // PRAGMA foreign_keys is not active on this connection.
        // All deletes are wrapped in a single transaction so a crash mid-sequence
        // won't leave orphaned rows in dependent tables.
        tx.execute("DELETE FROM credential_fields WHERE credential_id = ?1", params![id])?;
        tx.execute("DELETE FROM credential_rotation_history WHERE credential_id = ?1", params![id])?;
        tx.execute("DELETE FROM credential_rotation_policies WHERE credential_id = ?1", params![id])?;
        tx.execute("DELETE FROM credential_events WHERE credential_id = ?1", params![id])?;
        let rows = tx.execute("DELETE FROM persona_credentials WHERE id = ?1", params![id])?;

        tx.commit().map_err(AppError::Database)?;
        Ok(rows > 0)

    })
}

/// Returns a summary of resources affected by deleting this credential.
pub fn blast_radius(pool: &DbPool, id: &str) -> Result<Vec<(String, String)>, AppError> {
    timed_query!("persona_credentials", "persona_credentials::blast_radius", {
        let conn = pool.get()?;
        let mut impacts: Vec<(String, String)> = Vec::new();

        // Event triggers that will be removed
        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM credential_events WHERE credential_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if event_count > 0 {
            impacts.push(("event".into(), format!("{event_count} event trigger(s) will be removed")));
        }

        // Rotation policies
        let rotation_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM credential_rotation_policies WHERE credential_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if rotation_count > 0 {
            impacts.push(("rotation".into(), format!("{rotation_count} rotation policy/policies will be removed")));
        }

        // Dependent personas (structural: personas whose tools use connectors matching this credential)
        let service_type: Option<String> = conn
            .query_row(
                "SELECT service_type FROM persona_credentials WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();

        if let Some(ref svc) = service_type {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT p.name FROM personas p
                 INNER JOIN persona_tools pt ON pt.persona_id = p.id
                 INNER JOIN persona_tool_definitions ptd ON ptd.id = pt.tool_id
                 INNER JOIN connector_definitions cd ON cd.name = ?1
                 WHERE cd.services LIKE '%' || ptd.name || '%'",
            )?;
            let names: Vec<String> = stmt
                .query_map(params![svc], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect();
            if !names.is_empty() {
                impacts.push((
                    "persona".into(),
                    format!(
                        "Agent(s) {} may lose {} access",
                        names.join(", "),
                        svc
                    ),
                ));
            }
        }

        // Active automations using this credential
        let auto_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_automations WHERE platform_credential_id = ?1 AND deployment_status = 'active'",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if auto_count > 0 {
            impacts.push(("automation".into(), format!("{auto_count} active automation(s) will lose their credential")));
        }

        Ok(impacts)

    })
}

/// Update only the metadata column for a credential.
/// Used by the anomaly scoring engine to persist healthcheck ring buffer data
/// without touching encrypted fields.
pub fn update_metadata(pool: &DbPool, id: &str, metadata: Option<&str>) -> Result<(), AppError> {
    timed_query!("persona_credentials", "persona_credentials::update_metadata", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        // Sanitize metadata to prevent leaking secrets in plaintext column
        let sanitized_metadata = metadata.map(sanitize_secrets);

        let rows = conn.execute(
            "UPDATE persona_credentials SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
            params![sanitized_metadata, now, id],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("Credential {id}")));
        }
        Ok(())

    })
}

/// Atomically merge a metadata patch into the current credential metadata.
///
/// - Reads current metadata inside a transaction
/// - Applies shallow key-level patch semantics
/// - `null` values remove keys
/// - Sanitizes before persisting
/// - Returns the updated credential row
/// Apply a metadata patch on an existing connection (for use inside an outer
/// transaction).  Does NOT manage its own transaction — the caller is
/// responsible for commit/rollback.
pub fn patch_metadata_on_conn(
    conn: &rusqlite::Connection,
    id: &str,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<(), AppError> {
    let current_raw: Option<String> = conn
        .query_row(
            "SELECT metadata FROM persona_credentials WHERE id = ?1",
            params![id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();

    // Ensure credential exists before applying patch
    if current_raw.is_none() {
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM persona_credentials WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            return Err(AppError::NotFound(format!("Credential {id}")));
        }
    }

    let mut base_obj = current_raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    for (key, value) in patch {
        if value.is_null() {
            base_obj.remove(&key);
        } else {
            base_obj.insert(key, value);
        }
    }

    let next_meta_json = serde_json::Value::Object(base_obj);
    let next_meta_str = serde_json::to_string(&next_meta_json)?;
    let sanitized_meta = sanitize_secrets(&next_meta_str);
    let now = chrono::Utc::now().to_rfc3339();

    let updated_rows = conn.execute(
        "UPDATE persona_credentials SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
        params![sanitized_meta, now, id],
    )?;
    if updated_rows == 0 {
        return Err(AppError::NotFound(format!("Credential {id}")));
    }

    Ok(())
}

pub fn patch_metadata_atomic(
    pool: &DbPool,
    id: &str,
    patch: serde_json::Map<String, serde_json::Value>,
) -> Result<PersonaCredential, AppError> {
    timed_query!("persona_credentials", "persona_credentials::patch_metadata_atomic", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        patch_metadata_on_conn(&tx, id, patch)?;
        tx.commit()?;
        get_by_id(pool, id)
    })
}

/// Atomically read the current `oauth_refresh_fail_count`, increment it,
/// compute the backoff-until timestamp, and write both back — all inside a
/// single SQLite transaction.  Returns `(new_fail_count, backoff_secs)`.
pub fn increment_refresh_backoff_atomic(
    pool: &DbPool,
    id: &str,
    backoff_steps: &[i64],
) -> Result<(u64, i64), AppError> {
    timed_query!("persona_credentials", "persona_credentials::increment_refresh_backoff_atomic", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let current_raw: Option<String> = tx
            .query_row(
                "SELECT metadata FROM persona_credentials WHERE id = ?1",
                params![id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();

        if current_raw.is_none() {
            let exists: Option<String> = tx
                .query_row(
                    "SELECT id FROM persona_credentials WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .optional()?;
            if exists.is_none() {
                return Err(AppError::NotFound(format!("Credential {id}")));
            }
        }

        let mut ledger = CredentialLedger::parse(current_raw.as_deref());
        let (new_fail_count, backoff_secs) = ledger.increment_refresh_backoff(backoff_steps);

        let next_meta_str = ledger.to_json_string()?;
        let sanitized_meta = sanitize_secrets(&next_meta_str);
        let now = chrono::Utc::now().to_rfc3339();

        tx.execute(
            "UPDATE persona_credentials SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
            params![sanitized_meta, now, id],
        )?;

        tx.commit()?;
        Ok((new_fail_count, backoff_secs))
    })
}

/// Atomically append a healthcheck entry to the metadata ring buffer.
///
/// Performs the read-modify-write inside a single SQLite transaction to prevent
/// concurrent healthcheck invocations from overwriting each other's results.
pub fn append_healthcheck_metadata(
    pool: &DbPool,
    credential_id: &str,
    success: bool,
    message: &str,
) -> Result<(), AppError> {
    timed_query!("persona_credentials", "persona_credentials::append_healthcheck_metadata", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let current_raw: Option<String> = tx
            .query_row(
                "SELECT metadata FROM persona_credentials WHERE id = ?1",
                params![credential_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();

        let mut ledger = CredentialLedger::parse(current_raw.as_deref());

        // Delegate to rotation engine for ring-buffer append logic (entry
        // construction, FIFO overflow, error classification).
        let existing = crate::engine::rotation::ledger_entries_to_engine(&ledger.healthcheck_results);
        let updated = crate::engine::rotation::append_healthcheck_entry(&existing, success, message);

        // Write updated ring buffer back into the ledger using typed conversion
        ledger.healthcheck_results = crate::engine::rotation::engine_entries_to_ledger(&updated);
        ledger.healthcheck_last_success = Some(success);
        if success {
            ledger.healthcheck_last_success_at = Some(chrono::Utc::now().to_rfc3339());
        }

        let next_meta = ledger.to_json_string()?;
        let sanitized = sanitize_secrets(&next_meta);
        let now = chrono::Utc::now().to_rfc3339();

        tx.execute(
            "UPDATE persona_credentials SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
            params![sanitized, now, credential_id],
        )?;

        tx.commit()?;
        Ok(())

    })
}

/// Record a usage event for a credential: increment usage_count and set last_used_at.
/// Uses a single SQL UPDATE with json_set/json_extract to avoid multiple round-trips.
pub fn record_usage(pool: &DbPool, credential_id: &str) -> Result<(), AppError> {
    timed_query!("persona_credentials", "persona_credentials::record_usage", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        conn.execute(
            "UPDATE persona_credentials SET
                last_used_at = ?1,
                updated_at = ?1,
                metadata = json_set(
                    COALESCE(metadata, '{}'),
                    '$.usage_count', COALESCE(json_extract(metadata, '$.usage_count'), 0) + 1,
                    '$.last_used_at', ?1
                )
            WHERE id = ?2",
            params![now, credential_id],
        )?;

        Ok(())

    })
}

pub fn mark_used(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("persona_credentials", "persona_credentials::mark_used", {
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

    })
}

// ============================================================================
// Credential Event CRUD
// ============================================================================

pub fn get_events_by_credential(
    pool: &DbPool,
    credential_id: &str,
) -> Result<Vec<CredentialEvent>, AppError> {
    timed_query!("persona_credentials", "persona_credentials::get_events_by_credential", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM credential_events WHERE credential_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![credential_id], row_to_credential_event)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

/// Read the typed `CredentialLedger` for a credential.
/// Returns `Default` if the credential has no metadata or it is invalid JSON.
pub fn read_ledger(pool: &DbPool, credential_id: &str) -> Result<CredentialLedger, AppError> {
    let cred = get_by_id(pool, credential_id)?;
    Ok(CredentialLedger::parse(cred.metadata.as_deref()))
}

/// Atomically read-modify-write the credential ledger via a typed closure.
///
/// The closure receives a mutable `CredentialLedger`, applies section-level
/// changes, and the result is persisted back as sanitized JSON. This is the
/// preferred way for engine subsystems to update their slice of the ledger.
pub fn update_ledger<F>(pool: &DbPool, id: &str, mutator: F) -> Result<CredentialLedger, AppError>
where
    F: FnOnce(&mut CredentialLedger),
{
    timed_query!("persona_credentials", "persona_credentials::update_ledger", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let current_raw: Option<String> = tx
            .query_row(
                "SELECT metadata FROM persona_credentials WHERE id = ?1",
                params![id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();

        if current_raw.is_none() {
            let exists: Option<String> = tx
                .query_row(
                    "SELECT id FROM persona_credentials WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .optional()?;
            if exists.is_none() {
                return Err(AppError::NotFound(format!("Credential {id}")));
            }
        }

        let mut ledger = CredentialLedger::parse(current_raw.as_deref());
        mutator(&mut ledger);

        let next_meta_str = ledger.to_json_string()?;
        let sanitized_meta = sanitize_secrets(&next_meta_str);
        let now = chrono::Utc::now().to_rfc3339();

        tx.execute(
            "UPDATE persona_credentials SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
            params![sanitized_meta, now, id],
        )?;

        tx.commit()?;
        Ok(ledger)
    })
}

pub fn get_all_events(pool: &DbPool) -> Result<Vec<CredentialEvent>, AppError> {
    timed_query!("persona_credentials", "persona_credentials::get_all_events", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM credential_events ORDER BY credential_id, created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_credential_event)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

pub fn get_event_by_id(pool: &DbPool, id: &str) -> Result<CredentialEvent, AppError> {
    timed_query!("persona_credentials", "persona_credentials::get_event_by_id", {
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

    })
}

pub fn get_enabled_events(pool: &DbPool) -> Result<Vec<CredentialEvent>, AppError> {
    timed_query!("persona_credentials", "persona_credentials::get_enabled_events", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM credential_events WHERE enabled = 1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_credential_event)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

pub fn create_event(
    pool: &DbPool,
    input: CreateCredentialEventInput,
) -> Result<CredentialEvent, AppError> {
    timed_query!("persona_credentials", "persona_credentials::create_event", {
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

    })
}

pub fn update_event(
    pool: &DbPool,
    id: &str,
    input: UpdateCredentialEventInput,
) -> Result<CredentialEvent, AppError> {
    timed_query!("persona_credentials", "persona_credentials::update_event", {
        // Verify exists
        get_event_by_id(pool, id)?;

        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(input.name, "name", sets, param_idx, param_values, clone);
        push_field_param!(input.config, "config", sets, param_idx, param_values, clone);
        push_field_param!(input.enabled, "enabled", sets, param_idx, param_values, bool);
        push_field_param!(input.last_polled_at, "last_polled_at", sets, param_idx, param_values, clone);
        param_values.push(Box::new(id.to_string()));

        let sql = format!(
            "UPDATE credential_events SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_event_by_id(pool, id)

    })
}

pub fn delete_event(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("persona_credentials", "persona_credentials::delete_event", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM credential_events WHERE id = ?1", params![id])?;
        Ok(rows > 0)

    })
}

pub fn delete_events_by_credential(pool: &DbPool, credential_id: &str) -> Result<i64, AppError> {
    timed_query!("persona_credentials", "persona_credentials::delete_events_by_credential", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM credential_events WHERE credential_id = ?1",
            params![credential_id],
        )?;
        Ok(rows as i64)

    })
}

// ============================================================================
// Credential Field CRUD (field-level storage)
// ============================================================================

row_mapper!(row_to_credential_field -> CredentialField {
    id, credential_id, field_key, encrypted_value, iv,
    field_type, is_sensitive [bool], created_at, updated_at,
});

/// Get all field rows for a credential.
pub fn get_fields(pool: &DbPool, credential_id: &str) -> Result<Vec<CredentialField>, AppError> {
    timed_query!("persona_credentials", "persona_credentials::get_fields", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM credential_fields WHERE credential_id = ?1 ORDER BY field_key"
        )?;
        let rows = stmt.query_map(params![credential_id], row_to_credential_field)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

/// Save (upsert) all fields for a credential from a `HashMap<String, String>`.
/// Encrypts sensitive fields individually. Replaces any existing field rows
/// by deleting first, then inserting -- wrapped in a transaction to prevent
/// partial state if encryption or insertion fails mid-loop.
pub fn save_fields(
    pool: &DbPool,
    credential_id: &str,
    fields: &HashMap<String, String>,
) -> Result<usize, AppError> {
    timed_query!("persona_credentials", "persona_credentials::save_fields", {
        // Look up the credential's service_type for schema-based sensitivity
        let cred = get_by_id(pool, credential_id)?;
        let sens_map = sensitivity_map_for_connector(pool, &cred.service_type);

        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;

        // Remove existing field rows and re-insert atomically
        tx.execute(
            "DELETE FROM credential_fields WHERE credential_id = ?1",
            params![credential_id],
        )?;

        let now = chrono::Utc::now().to_rfc3339();
        let mut count = 0usize;

        for (key, value) in fields {
            let is_sensitive = is_field_sensitive(sens_map.as_ref(), key);
            let (enc_val, field_iv) = crypto::encrypt_field(value, is_sensitive)
                .map_err(|e| AppError::Internal(format!("Field encryption failed: {e}")))?;

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

    })
}

/// Update a single credential field on an existing connection (for use inside
/// an outer transaction).  If the field doesn't exist, inserts it.
pub fn upsert_field_on_conn(
    conn: &rusqlite::Connection,
    credential_id: &str,
    field_key: &str,
    field_value: &str,
    is_sensitive: bool,
) -> Result<(), AppError> {
    let (enc_val, field_iv) = crypto::encrypt_field(field_value, is_sensitive)
        .map_err(|e| AppError::Internal(format!("Field encryption failed: {e}")))?;

    let now = chrono::Utc::now().to_rfc3339();
    let field_type = classify_field_type(field_key);
    let field_id = uuid::Uuid::new_v4().to_string();

    // Atomic upsert — avoids TOCTOU race between concurrent UPDATE/INSERT.
    conn.execute(
        "INSERT INTO credential_fields
         (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT(credential_id, field_key) DO UPDATE SET
           encrypted_value = excluded.encrypted_value,
           iv              = excluded.iv,
           field_type      = excluded.field_type,
           is_sensitive    = excluded.is_sensitive,
           updated_at      = excluded.updated_at",
        params![field_id, credential_id, field_key, enc_val, field_iv, field_type, is_sensitive as i32, now],
    )?;

    Ok(())
}

/// Update a single credential field. If the field doesn't exist, inserts it.
pub fn upsert_field(
    pool: &DbPool,
    credential_id: &str,
    field_key: &str,
    field_value: &str,
    is_sensitive: bool,
) -> Result<(), AppError> {
    timed_query!("persona_credentials", "persona_credentials::upsert_field", {
        let conn = pool.get()?;
        upsert_field_on_conn(&conn, credential_id, field_key, field_value, is_sensitive)
    })
}

/// Delete all field rows for a credential.
pub fn delete_fields(pool: &DbPool, credential_id: &str) -> Result<usize, AppError> {
    timed_query!("persona_credentials", "persona_credentials::delete_fields", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM credential_fields WHERE credential_id = ?1",
            params![credential_id],
        )?;
        Ok(rows)

    })
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
        let key = normalize_field_key(&field.field_key);
        result.insert(key, value);
    }
    Ok(result)
}

/// Normalize legacy camelCase credential field keys to canonical snake_case.
///
/// This runs on every read so that any camelCase fields missed by the DB
/// migration (e.g. created between migration and app restart) are
/// transparently mapped.
fn normalize_field_key(key: &str) -> String {
    match key {
        "refreshToken" => "refresh_token".to_string(),
        "accessToken" => "access_token".to_string(),
        "clientId" => "client_id".to_string(),
        "clientSecret" => "client_secret".to_string(),
        "tokenType" => "token_type".to_string(),
        _ => key.to_string(),
    }
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
                session_encrypted_data: None,
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

        // Update (partial -- only change name and encrypted_data)
        let updated = update(
            &pool,
            &cred.id,
            UpdateCredentialInput {
                name: Some("Updated Gmail".into()),
                service_type: None,
                encrypted_data: Some("enc_data_xyz".into()),
                iv: Some("iv_456".into()),
                metadata: Some(None),
                session_encrypted_data: None,
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
                session_encrypted_data: None,
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
