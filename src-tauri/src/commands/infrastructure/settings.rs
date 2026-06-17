use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::db::models::SettingsAuditEntry;
use crate::db::repos::core::settings as repo;
use crate::db::repos::resources::settings_audit_log;
use crate::db::settings_keys;
use crate::engine::quality_gate::{self, QualityGateConfig};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

const MAX_SETTING_VALUE_SIZE: usize = 64 * 1024; // 64 KB

/// Validate the settings key against the allow-list.
fn require_valid_key(key: &str) -> Result<(), AppError> {
    settings_keys::validate_key(key).map_err(AppError::Validation)
}

#[tauri::command]
pub fn get_app_setting(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<Option<String>, AppError> {
    require_auth_sync(&state)?;
    require_valid_key(&key)?;
    repo::get(&state.db, &key)
}

/// F10: return the persisted model-routing rules (parsed, empty when unset).
#[tauri::command]
pub fn get_model_routing_rules(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::engine::model_routing::ModelRoutingRule>, AppError> {
    require_auth_sync(&state)?;
    Ok(crate::engine::model_routing::load_rules(&state.db))
}

/// F10: validate + persist the model-routing rules. Rejects blank models or
/// unknown effort tiers before they can reach an execution.
#[tauri::command]
pub fn set_model_routing_rules(
    state: State<'_, Arc<AppState>>,
    rules: Vec<crate::engine::model_routing::ModelRoutingRule>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let diags = crate::engine::model_routing::validate(&rules);
    if !diags.is_empty() {
        return Err(AppError::Validation(diags.join("; ")));
    }
    let json = serde_json::to_string(&rules).map_err(|e| AppError::Internal(e.to_string()))?;
    repo::set(
        &state.db,
        crate::engine::model_routing::MODEL_ROUTING_RULES_KEY,
        &json,
    )
}

/// Bulk-read variant of [`get_app_setting`]. Issues a single
/// `SELECT key, value FROM app_settings WHERE key IN (...)` and returns a map
/// of `{ key: value | null }`.
///
/// Keys missing from the table are returned with `null` so the caller can
/// distinguish "absent" from "empty string". Unknown keys (not on the
/// settings allow-list) are also returned with `null`, matching the
/// behaviour of the single-key reader for typo'd or stale references.
///
/// Frontend panels that mount and read several settings at once should
/// prefer this command over a fan-out of `get_app_setting` calls — each
/// invoke costs ~1-5 ms of serialisation overhead even for cache-hot
/// SQLite reads, so 20+ serial roundtrips add up to perceptible lag.
#[tauri::command]
pub fn get_app_settings_bulk(
    state: State<'_, Arc<AppState>>,
    keys: Vec<String>,
) -> Result<HashMap<String, Option<String>>, AppError> {
    require_auth_sync(&state)?;
    if keys.len() > repo::GET_BATCH_MAX_KEYS {
        return Err(AppError::Validation(format!(
            "get_app_settings_bulk accepts at most {} keys (got {})",
            repo::GET_BATCH_MAX_KEYS,
            keys.len(),
        )));
    }
    repo::get_batch(&state.db, &keys)
}

#[tauri::command]
pub fn set_app_setting(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    require_valid_key(&key)?;
    if value.len() > MAX_SETTING_VALUE_SIZE {
        return Err(AppError::Validation(format!(
            "Setting value for '{}' exceeds maximum size ({} bytes > {} byte limit)",
            key,
            value.len(),
            MAX_SETTING_VALUE_SIZE,
        )));
    }
    repo::set(&state.db, &key, &value)?;

    // Hot-apply the global concurrency cap so a change to `max_parallel_executions`
    // takes effect WITHOUT an app restart (the engine otherwise reads this only
    // once at startup). Fire-and-forget: the value is already persisted, so even
    // if the live update is dropped the new cap applies on next launch. The value
    // is clamped to the documented range as defense-in-depth (the Settings UI's
    // stepper already constrains it).
    if key == settings_keys::MAX_PARALLEL_EXECUTIONS {
        if let Ok(n) = value.trim().parse::<usize>() {
            let n = n.clamp(
                settings_keys::MAX_PARALLEL_EXECUTIONS_MIN,
                settings_keys::MAX_PARALLEL_EXECUTIONS_MAX,
            );
            let engine = state.engine.clone();
            let pool = state.db.clone();
            tauri::async_runtime::spawn(async move {
                engine.set_global_max_concurrent(app, pool, n).await;
            });
        }
    }

    Ok(())
}

/// Delete a setting.
///
/// Returns `Ok(true)` when a row existed for `key` and was removed,
/// `Ok(false)` when no row existed (idempotent no-op — NOT an error).
/// Frontend callers should treat the boolean as diagnostic telemetry only;
/// the observable end state is identical either way (row is gone).
#[tauri::command]
pub fn delete_app_setting(state: State<'_, Arc<AppState>>, key: String) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    require_valid_key(&key)?;
    repo::delete(&state.db, &key)
}

#[tauri::command]
pub fn get_quality_gate_config(
    state: State<'_, Arc<AppState>>,
) -> Result<QualityGateConfig, AppError> {
    require_auth_sync(&state)?;
    Ok(quality_gate::load(&state.db))
}

#[tauri::command]
pub fn set_quality_gate_config(
    state: State<'_, Arc<AppState>>,
    config: QualityGateConfig,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    quality_gate::save(&state.db, &config)
}

#[tauri::command]
pub fn reset_quality_gate_config(
    state: State<'_, Arc<AppState>>,
) -> Result<QualityGateConfig, AppError> {
    require_auth_sync(&state)?;
    let default = QualityGateConfig::default();
    quality_gate::save(&state.db, &default)?;
    Ok(default)
}

/// Newest-first list of settings-audit entries. Optional `category` filters to
/// one sub-module (`"api_keys"`, `"notifications"`, etc); when omitted, all
/// categories are returned. `limit` is clamped to `[1, 1000]` server-side.
#[tauri::command]
pub fn list_settings_audit_entries(
    state: State<'_, Arc<AppState>>,
    limit: u32,
    category: Option<String>,
) -> Result<Vec<SettingsAuditEntry>, AppError> {
    require_auth_sync(&state)?;
    settings_audit_log::list(&state.db, limit, category.as_deref())
}
