use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    CreateRotationPolicyInput, CredentialRotationEntry, CredentialRotationPolicy,
    UpdateRotationPolicyInput,
};
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::rotation as rotation_repo;
use crate::engine::rotation as rotation_engine;
use crate::error::AppError;
use crate::AppState;

// ============================================================================
// Rotation Policy CRUD
// ============================================================================

#[tauri::command]
pub fn list_rotation_policies(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<CredentialRotationPolicy>, AppError> {
    rotation_repo::get_policies_by_credential(&state.db, &credential_id)
}

#[tauri::command]
pub fn create_rotation_policy(
    state: State<'_, Arc<AppState>>,
    input: CreateRotationPolicyInput,
) -> Result<CredentialRotationPolicy, AppError> {
    rotation_repo::create_policy(&state.db, input)
}

#[tauri::command]
pub fn update_rotation_policy(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateRotationPolicyInput,
) -> Result<CredentialRotationPolicy, AppError> {
    rotation_repo::update_policy(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_rotation_policy(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    rotation_repo::delete_policy(&state.db, &id)
}

// ============================================================================
// Rotation History
// ============================================================================

#[tauri::command]
pub fn get_rotation_history(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    limit: Option<i64>,
) -> Result<Vec<CredentialRotationEntry>, AppError> {
    rotation_repo::get_history(&state.db, &credential_id, limit)
}

// ============================================================================
// Rotation Status & Manual Trigger
// ============================================================================

#[tauri::command]
pub fn get_rotation_status(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<rotation_engine::RotationStatus, AppError> {
    rotation_engine::get_rotation_status(&state.db, &credential_id)
}

#[tauri::command]
pub async fn rotate_credential_now(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<String, AppError> {
    let result = rotation_engine::rotate_now(&state.db, &credential_id, "manual").await;
    let (op, detail) = match &result {
        Ok(_) => ("credential_rotated", "manual rotation succeeded".to_string()),
        Err(e) => ("credential_rotation_failed", format!("manual rotation failed: {}", e)),
    };
    let _ = audit_log::insert(
        &state.db, &credential_id, &credential_id,
        op, None, None, Some(&detail),
    );
    result
}
