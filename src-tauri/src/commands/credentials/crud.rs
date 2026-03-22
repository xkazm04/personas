use std::sync::Arc;
use std::collections::HashMap;
use tauri::State;

use crate::commands::core::personas::BlastRadiusItem;
use crate::db::models::{
    CreateCredentialEventInput, CreateCredentialInput, CredentialEvent, PersonaCredential,
    UpdateCredentialEventInput, UpdateCredentialInput,
};
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::credentials as repo;
use crate::engine::crypto;
use crate::error::AppError;
use crate::ipc_auth::{require_privileged, require_privileged_sync};
use crate::AppState;

#[tauri::command]
pub fn list_credentials(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaCredential>, AppError> {
    require_privileged_sync(&state, "list_credentials")?;
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn get_session_public_key(
    state: State<'_, Arc<AppState>>,
) -> String {
    state.session_key.public_key_pem().to_string()
}

#[tauri::command]
pub fn create_credential(
    state: State<'_, Arc<AppState>>,
    mut input: CreateCredentialInput,
) -> Result<PersonaCredential, AppError> {
    require_privileged_sync(&state, "create_credential")?;
    // Decrypt session-encrypted data if provided (asymmetric IPC protection)
    if let Some(encrypted) = input.session_encrypted_data.take() {
        match state.session_key.decrypt(&encrypted) {
            Ok(decrypted) => {
                input.encrypted_data = decrypted;
            }
            Err(e) => {
                tracing::error!("Failed to decrypt session-encrypted payload: {}", e);
                return Err(AppError::Internal("Decryption failed".into()));
            }
        }
    }

    // Parse plaintext JSON into field-level rows (the canonical storage path).
    let field_map: HashMap<String, String> = serde_json::from_str(&input.encrypted_data)
        .map_err(|e| AppError::Validation(format!("Invalid credential field data: {}", e)))?;

    // Store an empty blob -- all secrets live in credential_fields now.
    let name = input.name.clone();
    let db_input = CreateCredentialInput {
        encrypted_data: String::new(),
        iv: String::new(),
        session_encrypted_data: None,
        ..input
    };

    // Create credential + save fields in a single transaction to prevent orphaned rows
    let cred = repo::create_with_fields(&state.db, db_input, &field_map)?;

    let _ = audit_log::insert(&state.db, &cred.id, &name, "create", None, None, None);

    // Auto-provision a keepalive rotation policy for OAuth credentials
    crate::engine::rotation::auto_provision_single(&state.db, &cred.id);

    Ok(cred)
}

#[tauri::command]
pub fn update_credential(
    state: State<'_, Arc<AppState>>,
    id: String,
    mut input: UpdateCredentialInput,
) -> Result<PersonaCredential, AppError> {
    require_privileged_sync(&state, "update_credential")?;
    // Decrypt session-encrypted data if provided (asymmetric IPC protection)
    if let Some(encrypted) = input.session_encrypted_data.take() {
        match state.session_key.decrypt(&encrypted) {
            Ok(decrypted) => {
                input.encrypted_data = Some(decrypted);
            }
            Err(e) => {
                tracing::error!("Failed to decrypt session-encrypted payload: {}", e);
                return Err(AppError::Internal("Decryption failed".into()));
            }
        }
    }

    let has_data_change = input.encrypted_data.is_some();

    // Parse plaintext fields for field-level storage
    let field_map: Option<HashMap<String, String>> = match input.encrypted_data.as_ref() {
        Some(data) => Some(serde_json::from_str(data)
            .map_err(|e| AppError::Validation(format!("Invalid credential field data: {}", e)))?),
        None => None,
    };

    // Strip blob columns -- all secrets live in credential_fields now.
    let metadata_input = UpdateCredentialInput {
        encrypted_data: None,
        iv: None,
        session_encrypted_data: None,
        ..input
    };
    let cred = repo::update(&state.db, &id, metadata_input)?;

    // Persist per-field encrypted rows when credential data changes
    if let Some(fields) = field_map {
        if !fields.is_empty() {
            repo::save_fields(&state.db, &id, &fields)?;
        }
    }

    let detail = if has_data_change { "credential data changed" } else { "metadata updated" };
    let _ = audit_log::insert(&state.db, &id, &cred.name, "update", None, None, Some(detail));

    // Auto-provision a keepalive rotation policy if this is now an OAuth credential
    if has_data_change {
        crate::engine::rotation::auto_provision_single(&state.db, &id);
    }

    Ok(cred)
}

#[tauri::command]
pub fn patch_credential_metadata(
    state: State<'_, Arc<AppState>>,
    id: String,
    patch: serde_json::Value,
) -> Result<PersonaCredential, AppError> {
    require_privileged_sync(&state, "patch_credential_metadata")?;
    let patch_obj = patch
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::Validation("metadata patch must be a JSON object".into()))?;

    repo::patch_metadata_atomic(&state.db, &id, patch_obj)
}

#[tauri::command]
pub fn credential_blast_radius(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<BlastRadiusItem>, AppError> {
    require_privileged_sync(&state, "credential_blast_radius")?;
    let items = repo::blast_radius(&state.db, &id)?;
    Ok(items
        .into_iter()
        .map(|(category, description)| BlastRadiusItem { category, description })
        .collect())
}

#[tauri::command]
pub fn delete_credential(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_privileged_sync(&state, "delete_credential")?;
    // Capture name before deletion for audit trail
    let name = repo::get_by_id(&state.db, &id)
        .map(|c| c.name)
        .unwrap_or_else(|_| id.clone());
    let result = repo::delete(&state.db, &id)?;
    if result {
        let _ = audit_log::insert(&state.db, &id, &name, "delete", None, None, None);
    }
    Ok(result)
}

#[tauri::command]
pub fn list_credential_events(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<CredentialEvent>, AppError> {
    require_privileged_sync(&state, "list_credential_events")?;
    repo::get_events_by_credential(&state.db, &credential_id)
}

#[tauri::command]
pub fn list_all_credential_events(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CredentialEvent>, AppError> {
    require_privileged_sync(&state, "list_all_credential_events")?;
    repo::get_all_events(&state.db)
}

#[tauri::command]
pub fn create_credential_event(
    state: State<'_, Arc<AppState>>,
    input: CreateCredentialEventInput,
) -> Result<CredentialEvent, AppError> {
    require_privileged_sync(&state, "create_credential_event")?;
    repo::create_event(&state.db, input)
}

#[tauri::command]
pub fn update_credential_event(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateCredentialEventInput,
) -> Result<CredentialEvent, AppError> {
    require_privileged_sync(&state, "update_credential_event")?;
    repo::update_event(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_credential_event(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_privileged_sync(&state, "delete_credential_event")?;
    repo::delete_event(&state.db, &id)
}

#[tauri::command]
pub async fn healthcheck_credential(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<serde_json::Value, AppError> {
    require_privileged(&state, "healthcheck_credential").await?;
    let result =
        crate::engine::healthcheck::run_healthcheck(&state.db, &credential_id).await?;
    let cred = repo::get_by_id(&state.db, &credential_id)
        .ok();
    let name = cred.as_ref().map(|c| c.name.clone())
        .unwrap_or_else(|| credential_id.clone());
    let detail = if result.success { "passed" } else { &result.message };
    let _ = audit_log::insert(&state.db, &credential_id, &name, "healthcheck", None, None, Some(detail));

    // Record credential usage
    let _ = repo::record_usage(&state.db, &credential_id);

    // Append to healthcheck ring buffer for windowed anomaly scoring
    if let Some(ref c) = cred {
        let metadata: serde_json::Value = c
            .metadata
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null);

        let existing = crate::engine::rotation::parse_healthcheck_entries(&metadata);
        let updated = crate::engine::rotation::append_healthcheck_entry(
            &existing,
            result.success,
            &result.message,
        );

        let mut meta_obj = metadata.as_object().cloned().unwrap_or_default();
        meta_obj.insert(
            "healthcheck_results".to_string(),
            serde_json::to_value(&updated).unwrap_or_default(),
        );
        // Also update legacy fields for backward compatibility
        meta_obj.insert("healthcheck_last_success".to_string(), serde_json::Value::Bool(result.success));
        if result.success {
            meta_obj.insert(
                "healthcheck_last_success_at".to_string(),
                serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
            );
        }
        let updated_meta = serde_json::to_string(&meta_obj).ok();
        let _ = repo::update_metadata(&state.db, &credential_id, updated_meta.as_deref());
    }

    Ok(serde_json::json!({
        "success": result.success,
        "message": result.message,
    }))
}

#[tauri::command]
pub async fn healthcheck_credential_preview(
    state: State<'_, Arc<AppState>>,
    service_type: String,
    mut field_values: HashMap<String, String>,
    session_encrypted_data: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_privileged(&state, "healthcheck_credential_preview").await?;
    // Decrypt session-encrypted data if provided (asymmetric IPC protection)
    if let Some(encrypted) = session_encrypted_data {
        match state.session_key.decrypt(&encrypted) {
            Ok(decrypted) => {
                if let Ok(decrypted_fields) = serde_json::from_str::<HashMap<String, String>>(&decrypted) {
                    field_values.extend(decrypted_fields);
                }
            }
            Err(e) => {
                tracing::error!("Failed to decrypt session-encrypted payload: {}", e);
                return Err(AppError::Internal("Decryption failed".into()));
            }
        }
    }

    let result = crate::engine::healthcheck::run_healthcheck_with_fields(
        &state.db,
        &service_type,
        &field_values,
    )
    .await?;
    Ok(serde_json::json!({
        "success": result.success,
        "message": result.message,
    }))
}

#[tauri::command]
pub fn vault_status(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_privileged_sync(&state, "vault_status")?;
    let all = repo::get_all(&state.db)?;
    let total = all.len();
    let plaintext = all.iter().filter(|c| crypto::is_plaintext(&c.iv)).count();
    let encrypted = total - plaintext;
    let source = crypto::key_source_label();

    Ok(serde_json::json!({
        "key_source": source,
        "total": total,
        "encrypted": encrypted,
        "plaintext": plaintext,
    }))
}

#[tauri::command]
pub fn migrate_plaintext_credentials(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_privileged_sync(&state, "migrate_plaintext_credentials")?;
    let (migrated, failed) = crypto::migrate_plaintext_credentials(&state.db)?;
    Ok(serde_json::json!({
        "migrated": migrated,
        "failed": failed,
    }))
}

/// Get field-level metadata for a credential (field keys, types, sensitivity).
/// Returns field metadata without decrypted values -- safe for frontend display.
#[tauri::command]
pub fn list_credential_fields(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<serde_json::Value>, AppError> {
    require_privileged_sync(&state, "list_credential_fields")?;
    let fields = repo::get_fields(&state.db, &credential_id)?;
    Ok(fields
        .iter()
        .map(|f| {
            serde_json::json!({
                "id": f.id,
                "credentialId": f.credential_id,
                "fieldKey": f.field_key,
                "fieldType": f.field_type,
                "isSensitive": f.is_sensitive,
                "createdAt": f.created_at,
                "updatedAt": f.updated_at,
            })
        })
        .collect())
}

/// Update a single credential field by key.
/// Encrypts the value if the field is sensitive, stores plaintext otherwise.
#[tauri::command]
pub fn update_credential_field(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    field_key: String,
    mut field_value: String,
    is_sensitive: bool,
    session_encrypted_value: Option<String>,
) -> Result<bool, AppError> {
    require_privileged_sync(&state, "update_credential_field")?;
    // Decrypt session-encrypted value if provided (asymmetric IPC protection)
    if let Some(encrypted) = session_encrypted_value {
        match state.session_key.decrypt(&encrypted) {
            Ok(decrypted) => {
                field_value = decrypted;
            }
            Err(e) => {
                tracing::error!("Failed to decrypt session-encrypted payload: {}", e);
                return Err(AppError::Internal("Decryption failed".into()));
            }
        }
    }

    repo::upsert_field(&state.db, &credential_id, &field_key, &field_value, is_sensitive)?;

    let cred = repo::get_by_id(&state.db, &credential_id)?;
    let _ = audit_log::insert(
        &state.db,
        &credential_id,
        &cred.name,
        "field_update",
        None,
        None,
        Some(&format!("field '{field_key}' updated")),
    );
    Ok(true)
}
