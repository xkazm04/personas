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

use crate::AppState;
use personas_macros::requires;

// ============================================================================
// Rotation Policy CRUD
// ============================================================================

#[tauri::command]
#[requires(privileged)]
pub fn list_rotation_policies(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<CredentialRotationPolicy>, AppError> {
    rotation_repo::get_policies_by_credential(&state.db, &credential_id)
}

#[tauri::command]
#[requires(privileged)]
pub fn create_rotation_policy(
    state: State<'_, Arc<AppState>>,
    input: CreateRotationPolicyInput,
) -> Result<CredentialRotationPolicy, AppError> {
    rotation_repo::create_policy(&state.db, input)
}

#[tauri::command]
#[requires(privileged)]
pub fn update_rotation_policy(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateRotationPolicyInput,
) -> Result<CredentialRotationPolicy, AppError> {
    rotation_repo::update_policy(&state.db, &id, input)
}

#[tauri::command]
#[requires(privileged)]
pub fn delete_rotation_policy(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<String, AppError> {
    // Fetch credential_id before deletion so the frontend can refresh status
    let policy = rotation_repo::get_policy_by_id(&state.db, &id)?;
    rotation_repo::delete_policy(&state.db, &id)?;
    Ok(policy.credential_id)
}

// ============================================================================
// Rotation History
// ============================================================================

#[tauri::command]
#[requires(privileged)]
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
#[requires(privileged)]
pub fn get_rotation_status(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<rotation_engine::RotationStatus, AppError> {
    rotation_engine::get_rotation_status(&state.db, &credential_id)
}

#[tauri::command]
#[requires(privileged)]
pub async fn rotate_credential_now(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<String, AppError> {
    let cred = crate::db::repos::resources::credentials::get_by_id(&state.db, &credential_id)?;
    let result = rotation_engine::rotate_now(&state.db, &credential_id, "manual").await;
    let (op, detail) = match &result {
        Ok(_) => (
            "credential_rotated",
            "manual rotation succeeded".to_string(),
        ),
        Err(e) => (
            "credential_rotation_failed",
            format!("manual rotation failed: {e}"),
        ),
    };
    audit_log::insert_warn(&state.db, &credential_id, &cred.name, op, Some(&detail));
    result
}

#[tauri::command]
#[requires(privileged)]
pub async fn refresh_credential_cli_now(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<String, AppError> {
    let cred = crate::db::repos::resources::credentials::get_by_id(&state.db, &credential_id)?;
    let result =
        crate::commands::credentials::cli_capture::recapture_for_credential(&state.db, &cred).await;
    let (op, detail) = match &result {
        Ok(_) => (
            "credential_cli_recaptured",
            "manual CLI recapture succeeded".to_string(),
        ),
        Err(e) => (
            "credential_cli_recapture_failed",
            format!("manual CLI recapture failed: {e}"),
        ),
    };
    audit_log::insert_warn(&state.db, &credential_id, &cred.name, op, Some(&detail));
    result
}

#[tauri::command]
#[requires(privileged)]
pub async fn refresh_credential_oauth_now(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<String, AppError> {
    let cred = crate::db::repos::resources::credentials::get_by_id(&state.db, &credential_id)?;
    let result = crate::engine::oauth_refresh::refresh_single_credential(&state.db, &cred).await;
    let (op, detail) = match &result {
        Ok(_) => (
            "credential_oauth_refreshed",
            "manual OAuth token refresh succeeded".to_string(),
        ),
        Err(e) => (
            "credential_oauth_refresh_failed",
            format!("manual OAuth refresh failed: {e}"),
        ),
    };
    audit_log::insert_warn(&state.db, &credential_id, &cred.name, op, Some(&detail));
    result
}

// ============================================================================
// OAuth Token Lifetime Metrics
// ============================================================================

#[tauri::command]
#[requires(privileged)]
pub fn get_oauth_token_metrics(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    limit: Option<u32>,
) -> Result<Vec<OAuthTokenMetric>, AppError> {
    metrics_repo::get_by_credential(&state.db, &credential_id, limit.unwrap_or(50))
}

#[tauri::command]
#[requires(privileged)]
pub fn get_oauth_token_lifetime_summary(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<OAuthTokenLifetimeSummary, AppError> {
    metrics_repo::get_lifetime_summary(&state.db, &credential_id)
}
