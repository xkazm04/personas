use std::sync::Arc;
use tauri::State;

use crate::engine::byom::{ByomPolicy, ProviderAuditEntry};
use crate::db::repos::execution::provider_audit;
use crate::error::AppError;
use crate::ipc_auth::{require_auth_sync, require_privileged_sync};
use crate::AppState;

// =============================================================================
// BYOM Policy CRUD
// =============================================================================

/// Get the current BYOM policy. Returns null if none is configured.
#[tauri::command]
pub fn get_byom_policy(state: State<'_, Arc<AppState>>) -> Result<Option<ByomPolicy>, AppError> {
    require_auth_sync(&state)?;
    Ok(ByomPolicy::load(&state.db))
}

/// Save the BYOM policy.
#[tauri::command]
pub fn set_byom_policy(
    state: State<'_, Arc<AppState>>,
    policy: ByomPolicy,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    policy.save(&state.db)
}

/// Delete the BYOM policy (revert to default: all providers allowed).
#[tauri::command]
pub fn delete_byom_policy(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    crate::db::repos::core::settings::delete(&state.db, crate::engine::byom::BYOM_POLICY_KEY)?;
    Ok(())
}

// =============================================================================
// Provider Audit Log
// =============================================================================

/// List provider audit log entries (newest first).
#[tauri::command]
pub fn list_provider_audit_log(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<ProviderAuditEntry>, AppError> {
    require_privileged_sync(&state, "list_provider_audit_log")?;
    provider_audit::list(&state.db, limit)
}

/// List provider audit entries for a specific persona.
#[tauri::command]
pub fn list_provider_audit_by_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<ProviderAuditEntry>, AppError> {
    require_privileged_sync(&state, "list_provider_audit_by_persona")?;
    provider_audit::list_by_persona(&state.db, &persona_id, limit)
}

/// Get aggregate provider usage statistics.
#[tauri::command]
pub fn get_provider_usage_stats(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<provider_audit::ProviderUsageStats>, AppError> {
    require_privileged_sync(&state, "get_provider_usage_stats")?;
    provider_audit::get_usage_stats(&state.db)
}
