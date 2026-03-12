use std::sync::Arc;
use tauri::State;

use crate::db::repos::core::settings as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn get_app_setting(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<Option<String>, AppError> {
    require_auth_sync(&state)?;
    repo::get(&state.db, &key)
}

#[tauri::command]
pub fn set_app_setting(
    state: State<'_, Arc<AppState>>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::set(&state.db, &key, &value)
}

#[tauri::command]
pub fn delete_app_setting(state: State<'_, Arc<AppState>>, key: String) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &key)
}
