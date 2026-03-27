use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::engine::byom::{ByomPolicy, ProviderAuditEntry};
use crate::engine::provider::{resolve_provider, EngineKind};
use crate::db::repos::execution::provider_audit;
use crate::error::AppError;
use crate::ipc_auth::{require_auth_sync, require_privileged_sync};
use crate::AppState;
use std::time::Instant;

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

/// Validate a BYOM policy without saving it. Returns a list of warning strings.
#[tauri::command]
pub fn validate_byom_policy(
    state: State<'_, Arc<AppState>>,
    policy: ByomPolicy,
) -> Result<Vec<String>, AppError> {
    require_auth_sync(&state)?;
    Ok(policy.validate())
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

/// Get daily provider usage timeseries for sparkline rendering.
#[tauri::command]
pub fn get_provider_usage_timeseries(
    state: State<'_, Arc<AppState>>,
    days: Option<i64>,
) -> Result<Vec<provider_audit::ProviderUsageTimeseries>, AppError> {
    require_privileged_sync(&state, "get_provider_usage_timeseries")?;
    provider_audit::get_usage_timeseries(&state.db, days.unwrap_or(30))
}

// =============================================================================
// Provider Connection Test
// =============================================================================

/// Result of testing a provider connection.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ProviderConnectionResult {
    pub provider_id: String,
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// Test whether a provider's CLI binary is installed and reachable.
///
/// Checks that the binary exists in PATH and can report its version.
#[tauri::command]
pub fn test_provider_connection(
    state: State<'_, Arc<AppState>>,
    provider_id: String,
) -> Result<ProviderConnectionResult, AppError> {
    require_auth_sync(&state)?;

    let engine_kind: EngineKind = match provider_id.parse() {
        Ok(k) => k,
        Err(_) => {
            return Ok(ProviderConnectionResult {
                provider_id,
                reachable: false,
                latency_ms: None,
                version: None,
                error: Some("Unknown provider".into()),
            });
        }
    };

    let provider = resolve_provider(engine_kind);
    let candidates = provider.binary_candidates();
    let cache = &state.binary_probe_cache;

    // Try each binary candidate until one succeeds, using cached probe results
    for candidate in candidates {
        let start = Instant::now();
        let probe = cache.get_or_probe(candidate);
        let elapsed = start.elapsed().as_millis() as u64;
        if let Some(version) = probe.version {
            return Ok(ProviderConnectionResult {
                provider_id,
                reachable: true,
                latency_ms: Some(elapsed),
                version: Some(version),
                error: None,
            });
        }
    }

    // None of the candidates worked — check if at least one is in PATH
    let in_path = candidates
        .iter()
        .any(|c| cache.get_or_probe(c).exists_in_path);

    let error_msg = if in_path {
        "Binary found in PATH but --version failed. The CLI may be misconfigured."
    } else {
        "CLI binary not found in PATH. Please install the provider CLI."
    };

    Ok(ProviderConnectionResult {
        provider_id,
        reachable: false,
        latency_ms: None,
        version: None,
        error: Some(error_msg.into()),
    })
}
