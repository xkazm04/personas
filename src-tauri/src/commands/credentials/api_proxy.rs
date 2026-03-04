use std::collections::HashMap;
use std::sync::Arc;

use tauri::State;

use crate::engine::api_definition::ApiEndpoint;
use crate::engine::api_proxy::ApiProxyResponse;
use crate::error::AppError;
use crate::AppState;

// ============================================================================
// API Proxy
// ============================================================================

#[tauri::command]
pub async fn execute_api_request(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<ApiProxyResponse, AppError> {
    crate::engine::api_proxy::execute_api_request(
        &state.db,
        &credential_id,
        &method,
        &path,
        headers,
        body,
    )
    .await
}

// ============================================================================
// API Definition Parsing
// ============================================================================

#[tauri::command]
pub fn parse_api_definition(raw_spec: String) -> Result<Vec<ApiEndpoint>, AppError> {
    crate::engine::api_definition::parse_openapi_spec(&raw_spec)
}

// ============================================================================
// API Definition Storage (local disk, not in DB)
// ============================================================================

#[tauri::command]
pub async fn save_api_definition(
    app: tauri::AppHandle,
    credential_id: String,
    raw_spec: String,
) -> Result<(), AppError> {
    let endpoints = crate::engine::api_definition::parse_openapi_spec(&raw_spec)?;

    let dir = api_definitions_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Internal(format!("Failed to create api_definitions dir: {e}")))?;

    let path = dir.join(format!("{}.json", credential_id));
    let json = serde_json::to_string_pretty(&endpoints)
        .map_err(|e| AppError::Internal(format!("JSON serialize error: {e}")))?;

    std::fs::write(&path, json)
        .map_err(|e| AppError::Internal(format!("Failed to write API definition: {e}")))?;

    Ok(())
}

#[tauri::command]
pub fn load_api_definition(
    app: tauri::AppHandle,
    credential_id: String,
) -> Result<Option<Vec<ApiEndpoint>>, AppError> {
    let dir = api_definitions_dir(&app)?;
    let path = dir.join(format!("{}.json", credential_id));

    if !path.exists() {
        return Ok(None);
    }

    let json = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Internal(format!("Failed to read API definition: {e}")))?;

    let endpoints: Vec<ApiEndpoint> = serde_json::from_str(&json)
        .map_err(|e| AppError::Internal(format!("Invalid API definition file: {e}")))?;

    Ok(Some(endpoints))
}

fn api_definitions_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    use tauri::Manager;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve app data dir: {e}")))?;
    Ok(app_data.join("api_definitions"))
}
