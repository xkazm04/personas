use std::sync::Arc;
use std::collections::HashMap;
use tauri::State;

use crate::db::models::{
    CreateCredentialEventInput, CreateCredentialInput, CredentialEvent, PersonaCredential,
    UpdateCredentialEventInput, UpdateCredentialInput,
};
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::credentials as repo;
use crate::engine::crypto;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_credentials(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaCredential>, AppError> {
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn create_credential(
    state: State<'_, Arc<AppState>>,
    input: CreateCredentialInput,
) -> Result<PersonaCredential, AppError> {
    // Parse plaintext JSON into field-level rows (the canonical storage path).
    let field_map: HashMap<String, String> =
        serde_json::from_str(&input.encrypted_data).unwrap_or_default();

    // Store an empty blob — all secrets live in credential_fields now.
    let name = input.name.clone();
    let db_input = CreateCredentialInput {
        encrypted_data: String::new(),
        iv: String::new(),
        ..input
    };
    let cred = repo::create(&state.db, db_input)?;

    // Persist per-field encrypted rows — roll back the credential row on failure
    if !field_map.is_empty() {
        if let Err(e) = repo::save_fields(&state.db, &cred.id, &field_map) {
            let _ = repo::delete(&state.db, &cred.id);
            return Err(e);
        }
    }

    let _ = audit_log::insert(&state.db, &cred.id, &name, "create", None, None, None);
    Ok(cred)
}

#[tauri::command]
pub fn update_credential(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateCredentialInput,
) -> Result<PersonaCredential, AppError> {
    let has_data_change = input.encrypted_data.is_some();

    // Parse plaintext fields for field-level storage
    let field_map: Option<HashMap<String, String>> = input
        .encrypted_data
        .as_ref()
        .and_then(|data| serde_json::from_str(data).ok());

    // Strip blob columns — all secrets live in credential_fields now.
    let metadata_input = UpdateCredentialInput {
        encrypted_data: None,
        iv: None,
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
    Ok(cred)
}

#[tauri::command]
pub fn delete_credential(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
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
    repo::get_events_by_credential(&state.db, &credential_id)
}

#[tauri::command]
pub fn list_all_credential_events(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CredentialEvent>, AppError> {
    repo::get_all_events(&state.db)
}

#[tauri::command]
pub fn create_credential_event(
    state: State<'_, Arc<AppState>>,
    input: CreateCredentialEventInput,
) -> Result<CredentialEvent, AppError> {
    repo::create_event(&state.db, input)
}

#[tauri::command]
pub fn update_credential_event(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateCredentialEventInput,
) -> Result<CredentialEvent, AppError> {
    repo::update_event(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_credential_event(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete_event(&state.db, &id)
}

#[tauri::command]
pub async fn healthcheck_credential(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<serde_json::Value, AppError> {
    let result =
        crate::engine::healthcheck::run_healthcheck(&state.db, &credential_id).await?;
    let cred = repo::get_by_id(&state.db, &credential_id)
        .ok();
    let name = cred.as_ref().map(|c| c.name.clone())
        .unwrap_or_else(|| credential_id.clone());
    let detail = if result.success { "passed" } else { &result.message };
    let _ = audit_log::insert(&state.db, &credential_id, &name, "healthcheck", None, None, Some(detail));

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
    field_values: HashMap<String, String>,
) -> Result<serde_json::Value, AppError> {
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
    let all = repo::get_all(&state.db)?;
    let total = all.len();
    let plaintext = all.iter().filter(|c| crypto::is_plaintext(&c.iv)).count();
    let encrypted = total - plaintext;
    let source = crypto::key_source();

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
    let (migrated, failed) = crypto::migrate_plaintext_credentials(&state.db)?;
    Ok(serde_json::json!({
        "migrated": migrated,
        "failed": failed,
    }))
}

/// Get field-level metadata for a credential (field keys, types, sensitivity).
/// Returns field metadata without decrypted values — safe for frontend display.
#[tauri::command]
pub fn list_credential_fields(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<serde_json::Value>, AppError> {
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
    field_value: String,
    is_sensitive: bool,
) -> Result<bool, AppError> {
    repo::upsert_field(&state.db, &credential_id, &field_key, &field_value, is_sensitive)?;

    let cred = repo::get_by_id(&state.db, &credential_id)?;
    let _ = audit_log::insert(
        &state.db,
        &credential_id,
        &cred.name,
        "field_update",
        None,
        None,
        Some(&format!("field '{}' updated", field_key)),
    );
    Ok(true)
}
