use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    CreateRotationPolicyInput, CredentialRotationEntry, CredentialRotationPolicy,
    OAuthTokenLifetimeSummary, OAuthTokenMetric, UpdateRotationPolicyInput,
};
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::oauth_token_metrics as metrics_repo;
use crate::db::repos::resources::rotation as rotation_repo;
use crate::engine::rotation as rotation_engine;
use crate::error::AppError;
use crate::ipc_auth::{require_privileged, require_privileged_sync};
use crate::AppState;

// ============================================================================
// Rotation Policy CRUD
// ============================================================================

#[tauri::command]
pub fn list_rotation_policies(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<CredentialRotationPolicy>, AppError> {
    require_privileged_sync(&state, "list_rotation_policies")?;
    rotation_repo::get_policies_by_credential(&state.db, &credential_id)
}

#[tauri::command]
pub fn create_rotation_policy(
    state: State<'_, Arc<AppState>>,
    input: CreateRotationPolicyInput,
) -> Result<CredentialRotationPolicy, AppError> {
    require_privileged_sync(&state, "create_rotation_policy")?;
    rotation_repo::create_policy(&state.db, input)
}

#[tauri::command]
pub fn update_rotation_policy(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateRotationPolicyInput,
) -> Result<CredentialRotationPolicy, AppError> {
    require_privileged_sync(&state, "update_rotation_policy")?;
    rotation_repo::update_policy(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_rotation_policy(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_privileged_sync(&state, "delete_rotation_policy")?;
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
    require_privileged_sync(&state, "get_rotation_history")?;
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
    require_privileged_sync(&state, "get_rotation_status")?;
    rotation_engine::get_rotation_status(&state.db, &credential_id)
}

#[tauri::command]
pub async fn rotate_credential_now(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<String, AppError> {
    require_privileged(&state, "rotate_credential_now").await?;
    let result = rotation_engine::rotate_now(&state.db, &credential_id, "manual").await;
    let (op, detail) = match &result {
        Ok(_) => ("credential_rotated", "manual rotation succeeded".to_string()),
        Err(e) => ("credential_rotation_failed", format!("manual rotation failed: {e}")),
    };
    if let Err(e) = audit_log::insert(
        &state.db, &credential_id, &credential_id,
        op, None, None, Some(&detail),
    ) {
        tracing::warn!(credential_id = %credential_id, error = %e, "Failed to write audit log for rotation");
    }
    result
}

#[tauri::command]
pub async fn refresh_credential_oauth_now(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<String, AppError> {
    require_privileged(&state, "refresh_credential_oauth_now").await?;
    let cred = crate::db::repos::resources::credentials::get_by_id(&state.db, &credential_id)?;
    let result = crate::engine::oauth_refresh::refresh_single_credential(&state.db, &cred).await;
    let (op, detail) = match &result {
        Ok(_) => ("credential_oauth_refreshed", "manual OAuth token refresh succeeded".to_string()),
        Err(e) => ("credential_oauth_refresh_failed", format!("manual OAuth refresh failed: {e}")),
    };
    if let Err(e) = audit_log::insert(
        &state.db, &credential_id, &cred.name,
        op, None, None, Some(&detail),
    ) {
        tracing::warn!(credential_id = %credential_id, error = %e, "Failed to write audit log for OAuth refresh");
    }
    result
}

// ============================================================================
// OAuth Token Lifetime Metrics
// ============================================================================

#[tauri::command]
pub fn get_oauth_token_metrics(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    limit: Option<u32>,
) -> Result<Vec<OAuthTokenMetric>, AppError> {
    require_privileged_sync(&state, "get_oauth_token_metrics")?;
    metrics_repo::get_by_credential(&state.db, &credential_id, limit.unwrap_or(50))
}

#[tauri::command]
pub fn get_oauth_token_lifetime_summary(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<OAuthTokenLifetimeSummary, AppError> {
    require_privileged_sync(&state, "get_oauth_token_lifetime_summary")?;
    metrics_repo::get_lifetime_summary(&state.db, &credential_id)
}
