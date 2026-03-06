use std::collections::HashMap;
use std::sync::Arc;

use tauri::State;

use crate::engine::api_definition::ApiEndpoint;
use crate::engine::api_proxy::ApiProxyResponse;
use crate::engine::crypto;
use crate::error::AppError;
use crate::AppState;

/// Validate that credential_id is safe for use in file paths.
/// Rejects anything that isn't alphanumeric or hyphens to prevent path traversal,
/// UNC path injection, and alternate data stream attacks.
fn validate_credential_id(credential_id: &str) -> Result<(), AppError> {
    if credential_id.is_empty()
        || credential_id.len() > 64
        || !credential_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::Validation(
            "Invalid credential_id: must contain only alphanumeric characters and hyphens".into(),
        ));
    }
    Ok(())
}

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
// API Definition Storage (local disk, encrypted at rest)
// ============================================================================

/// Separator between base64 nonce and base64 ciphertext in encrypted files.
const ENC_SEPARATOR: u8 = b'\n';

#[tauri::command]
pub async fn save_api_definition(
    app: tauri::AppHandle,
    credential_id: String,
    raw_spec: String,
) -> Result<(), AppError> {
    validate_credential_id(&credential_id)?;

    let endpoints = crate::engine::api_definition::parse_openapi_spec(&raw_spec)?;

    let dir = api_definitions_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Internal(format!("Failed to create api_definitions dir: {e}")))?;

    let path = dir.join(format!("{}.json.enc", credential_id));

    // Verify resolved path stays within the intended directory
    verify_path_containment(&path, &dir)?;

    let json = serde_json::to_string(&endpoints)
        .map_err(|e| AppError::Internal(format!("JSON serialize error: {e}")))?;

    // Encrypt the JSON with AES-256-GCM using the master key
    let (ciphertext_b64, nonce_b64) = crypto::encrypt_for_db(&json)?;

    // Write as: <nonce_b64>\n<ciphertext_b64>
    let mut file_contents = nonce_b64.into_bytes();
    file_contents.push(ENC_SEPARATOR);
    file_contents.extend_from_slice(ciphertext_b64.as_bytes());

    std::fs::write(&path, file_contents)
        .map_err(|e| AppError::Internal(format!("Failed to write API definition: {e}")))?;

    // Remove legacy plaintext file if it exists
    let legacy_path = dir.join(format!("{}.json", credential_id));
    verify_path_containment(&legacy_path, &dir)?;
    let _ = std::fs::remove_file(legacy_path);

    Ok(())
}

#[tauri::command]
pub fn load_api_definition(
    app: tauri::AppHandle,
    credential_id: String,
) -> Result<Option<Vec<ApiEndpoint>>, AppError> {
    validate_credential_id(&credential_id)?;

    let dir = api_definitions_dir(&app)?;
    let enc_path = dir.join(format!("{}.json.enc", credential_id));
    let legacy_path = dir.join(format!("{}.json", credential_id));

    // Try encrypted file first
    if enc_path.exists() {
        verify_path_containment(&enc_path, &dir)?;

        let raw = std::fs::read(&enc_path)
            .map_err(|e| AppError::Internal(format!("Failed to read API definition: {e}")))?;

        let sep_pos = raw.iter().position(|&b| b == ENC_SEPARATOR).ok_or_else(|| {
            AppError::Internal("Corrupted encrypted API definition: missing separator".into())
        })?;

        let nonce_b64 = std::str::from_utf8(&raw[..sep_pos])
            .map_err(|e| AppError::Internal(format!("Invalid nonce encoding: {e}")))?;
        let ciphertext_b64 = std::str::from_utf8(&raw[sep_pos + 1..])
            .map_err(|e| AppError::Internal(format!("Invalid ciphertext encoding: {e}")))?;

        let json = crypto::decrypt_from_db(ciphertext_b64, nonce_b64)?;

        let endpoints: Vec<ApiEndpoint> = serde_json::from_str(&json)
            .map_err(|e| AppError::Internal(format!("Invalid API definition file: {e}")))?;

        return Ok(Some(endpoints));
    }

    // Fall back to legacy plaintext file and migrate it
    if legacy_path.exists() {
        verify_path_containment(&legacy_path, &dir)?;

        let json = std::fs::read_to_string(&legacy_path)
            .map_err(|e| AppError::Internal(format!("Failed to read API definition: {e}")))?;

        let endpoints: Vec<ApiEndpoint> = serde_json::from_str(&json)
            .map_err(|e| AppError::Internal(format!("Invalid API definition file: {e}")))?;

        // Migrate: encrypt and write as .json.enc, then remove plaintext
        if let Ok((ciphertext_b64, nonce_b64)) = crypto::encrypt_for_db(&json) {
            let mut file_contents = nonce_b64.into_bytes();
            file_contents.push(ENC_SEPARATOR);
            file_contents.extend_from_slice(ciphertext_b64.as_bytes());

            if std::fs::write(&enc_path, file_contents).is_ok() {
                let _ = std::fs::remove_file(&legacy_path);
            }
        }

        return Ok(Some(endpoints));
    }

    Ok(None)
}

fn api_definitions_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    use tauri::Manager;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve app data dir: {e}")))?;
    Ok(app_data.join("api_definitions"))
}

/// Verify that the resolved file path stays within the intended base directory.
/// Defense-in-depth: even after allowlist validation, confirm no path traversal,
/// symlink escape, UNC path injection, or alternate data stream abuse occurs.
fn verify_path_containment(
    file_path: &std::path::Path,
    base_dir: &std::path::Path,
) -> Result<(), AppError> {
    let path_str = file_path.to_string_lossy();

    // Block Windows UNC paths (\\server\share or //server/share)
    if path_str.starts_with("\\\\") || path_str.starts_with("//") {
        return Err(AppError::Validation(
            "Path traversal detected: UNC paths are not allowed".into(),
        ));
    }

    // Block Windows alternate data streams (file.txt:stream)
    if let Some(name) = file_path.file_name() {
        let name_str = name.to_string_lossy();
        // A colon after the first character (drive letter) indicates an ADS
        if name_str.contains(':') {
            return Err(AppError::Validation(
                "Path traversal detected: alternate data streams are not allowed".into(),
            ));
        }
    }

    // Ensure the filename doesn't contain traversal sequences
    let file_name = file_path
        .file_name()
        .ok_or_else(|| AppError::Validation("Invalid file path: no filename".into()))?
        .to_string_lossy();

    if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
        return Err(AppError::Validation(
            "Path traversal detected in credential_id".into(),
        ));
    }

    // Ensure the path has exactly one component beyond the base dir
    if file_path.parent() != Some(base_dir) {
        return Err(AppError::Validation(
            "Path traversal detected in credential_id".into(),
        ));
    }

    // Canonicalize if the file exists to defeat symlink-based traversal
    if file_path.exists() {
        let canonical_file = file_path.canonicalize().map_err(|e| {
            AppError::Internal(format!("Failed to canonicalize file path: {e}"))
        })?;
        let canonical_base = base_dir.canonicalize().map_err(|e| {
            AppError::Internal(format!("Failed to canonicalize base dir: {e}"))
        })?;

        if !canonical_file.starts_with(&canonical_base) {
            return Err(AppError::Validation(
                "Path traversal detected: resolved path escapes base directory".into(),
            ));
        }
    }

    Ok(())
}
