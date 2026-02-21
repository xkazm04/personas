use std::sync::Arc;
use tauri::State;

use crate::db::models::{CredentialAuditEntry, CredentialDependent, CredentialUsageStats};
use crate::db::repos::resources::audit_log;
use crate::error::AppError;
use crate::AppState;

/// Get the audit log for a specific credential.
#[tauri::command]
pub fn credential_audit_log(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    limit: Option<u32>,
) -> Result<Vec<CredentialAuditEntry>, AppError> {
    audit_log::get_by_credential(&state.db, &credential_id, limit.unwrap_or(50))
}

/// Get aggregated usage statistics for a credential.
#[tauri::command]
pub fn credential_usage_stats(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<CredentialUsageStats, AppError> {
    audit_log::get_usage_stats(&state.db, &credential_id)
}

/// Get all personas/teams that depend on a credential.
#[tauri::command]
pub fn credential_dependents(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<CredentialDependent>, AppError> {
    audit_log::get_dependents(&state.db, &credential_id)
}
