use std::sync::Arc;
use tauri::State;

use crate::db::repos::core::settings as repo;
use crate::db::settings_keys;
use crate::engine::quality_gate::{self, QualityGateConfig};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

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

#[tauri::command]
pub fn set_app_setting(
    state: State<'_, Arc<AppState>>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    require_valid_key(&key)?;
    repo::set(&state.db, &key, &value)
}

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
