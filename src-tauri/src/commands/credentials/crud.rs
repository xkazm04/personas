use std::sync::Arc;
use std::collections::HashMap;
use tauri::State;

use crate::db::models::{
    CreateCredentialEventInput, CreateCredentialInput, CredentialEvent, PersonaCredential,
    UpdateCredentialEventInput, UpdateCredentialInput,
};
use crate::db::repos::credentials as repo;
use crate::engine::crypto;
use crate::error::AppError;
use crate::AppState;

fn encrypt_data(plaintext: &str) -> Result<(String, String), AppError> {
    crypto::encrypt_for_db(plaintext)
        .map_err(|e| AppError::Internal(format!("Encryption failed: {}", e)))
}

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
    let (ciphertext, nonce) = encrypt_data(&input.encrypted_data)?;
    let encrypted_input = CreateCredentialInput {
        encrypted_data: ciphertext,
        iv: nonce,
        ..input
    };
    repo::create(&state.db, encrypted_input)
}

#[tauri::command]
pub fn update_credential(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateCredentialInput,
) -> Result<PersonaCredential, AppError> {
    let encrypted_input = if let Some(ref data) = input.encrypted_data {
        let (ciphertext, nonce) = encrypt_data(data)?;
        UpdateCredentialInput {
            encrypted_data: Some(ciphertext),
            iv: Some(nonce),
            ..input
        }
    } else {
        input
    };
    repo::update(&state.db, &id, encrypted_input)
}

#[tauri::command]
pub fn delete_credential(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn list_credential_events(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<CredentialEvent>, AppError> {
    repo::get_events_by_credential(&state.db, &credential_id)
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
pub async fn healthcheck_credential(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<serde_json::Value, AppError> {
    let result =
        crate::engine::healthcheck::run_healthcheck(&state.db, &credential_id).await?;
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
