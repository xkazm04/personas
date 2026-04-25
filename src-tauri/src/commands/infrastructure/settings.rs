use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

use crate::db::repos::core::settings as repo;
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
    repo::set(&state.db, &key, &value)
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
