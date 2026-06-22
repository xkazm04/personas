//! Qwen remote-engine configuration commands (Phase 1 split engine).
//!
//! Stores the Qwen API key in the OS keyring and the base URL as an app
//! setting, so a capability routed to `provider: "qwen"` can run on the remote
//! HTTP engine (`engine::http_engine`). The API key is never returned to the
//! frontend; `get_qwen_status` only reports whether it is configured.

use std::sync::Arc;
use tauri::State;

use crate::db::repos::core::settings as settings_repo;
use crate::db::settings_keys;
use crate::engine::http_engine;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Configuration status for the Qwen remote engine (no secret material).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QwenStatus {
    /// Whether an API key is available (keyring or environment).
    pub configured: bool,
    /// Effective base URL (setting override or built-in default).
    pub base_url: String,
    /// Default model (setting override or built-in default).
    pub model: String,
}

/// Store the Qwen API key (OS keyring) and optionally the base URL (setting).
#[tauri::command]
pub fn set_qwen_credentials(
    state: State<'_, Arc<AppState>>,
    api_key: String,
    base_url: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    if api_key.trim().is_empty() {
        return Err(AppError::Validation("Qwen API key must not be empty".into()));
    }
    http_engine::store_qwen_api_key(api_key.trim()).map_err(AppError::Internal)?;
    if let Some(url) = base_url {
        let url = url.trim();
        if !url.is_empty() {
            settings_repo::set(&state.db, settings_keys::QWEN_BASE_URL, url)?;
        }
    }
    Ok(())
}

/// Report whether Qwen is configured + the effective base URL / default model.
/// Never returns the API key itself.
#[tauri::command]
pub fn get_qwen_status(state: State<'_, Arc<AppState>>) -> Result<QwenStatus, AppError> {
    require_auth_sync(&state)?;
    let base_url = settings_repo::get(&state.db, settings_keys::QWEN_BASE_URL)?
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| http_engine::DEFAULT_BASE_URL.to_string());
    let model = settings_repo::get(&state.db, settings_keys::QWEN_MODEL)?
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| http_engine::DEFAULT_MODEL.to_string());
    Ok(QwenStatus {
        configured: http_engine::qwen_key_configured(),
        base_url,
        model,
    })
}

/// Remove the stored Qwen API key from the OS keyring.
#[tauri::command]
pub fn clear_qwen_credentials(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    http_engine::clear_qwen_api_key();
    Ok(())
}
