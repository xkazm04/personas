use sha2::Digest;
use std::sync::Arc;
use tauri::State;

use crate::engine::bundle::{
    self, BundleExportResult, BundleImportOptions, BundleImportPreview, BundleImportResult,
    BundleVerification,
};
use crate::engine::share_link::{self, ResolvedShareLink, ShareLinkResult};
use crate::error::AppError;
use crate::ipc_auth::{require_auth_sync, require_privileged_sync};
use crate::AppState;

// -- Export ---------------------------------------------------------------

#[tauri::command]
pub fn export_persona_bundle(
    state: State<'_, Arc<AppState>>,
    resource_ids: Vec<String>,
    save_path: String,
) -> Result<BundleExportResult, AppError> {
    require_privileged_sync(&state, "export_persona_bundle")?;
    if resource_ids.is_empty() {
        return Err(AppError::Validation(
            "At least one resource must be selected for export".into(),
        ));
    }

    let (bytes, result) = bundle::export_bundle(&state.db, &resource_ids)?;

    std::fs::write(&save_path, &bytes)
        .map_err(AppError::Io)?;

    tracing::info!(
        path = %save_path,
        resources = resource_ids.len(),
        bytes = bytes.len(),
        action = "bundle_exported",
        "Bundle exported"
    );

    Ok(result)
}

// -- Import Preview ------------------------------------------------------

#[tauri::command]
pub fn preview_bundle_import(
    state: State<'_, Arc<AppState>>,
    file_path: String,
) -> Result<BundleImportPreview, AppError> {
    require_auth_sync(&state)?;
    let bytes = std::fs::read(&file_path)
        .map_err(AppError::Io)?;
    bundle::preview_bundle(&state.db, &bytes)
}

// -- Import Apply --------------------------------------------------------

#[tauri::command]
pub fn apply_bundle_import(
    state: State<'_, Arc<AppState>>,
    file_path: String,
    options: BundleImportOptions,
) -> Result<BundleImportResult, AppError> {
    require_privileged_sync(&state, "apply_bundle_import")?;

    // Use cached preview bytes if a preview_id was provided (TOCTOU mitigation).
    // Falls back to re-reading the file if the cache entry expired or is missing,
    // but always verifies the bundle hash matches the preview hash.
    let bytes = if let Some(ref pid) = options.preview_id {
        match bundle::take_cached_preview_bytes(pid) {
            Some((cached_bytes, _cached_hash)) => cached_bytes,
            None => {
                tracing::warn!(preview_id = %pid, "Preview cache miss, re-reading file");
                std::fs::read(&file_path).map_err(AppError::Io)?
            }
        }
    } else {
        std::fs::read(&file_path)
            .map_err(AppError::Io)?
    };

    if bytes.is_empty() {
        return Err(AppError::Validation("Bundle file is empty or unreadable".into()));
    }

    // TOCTOU mitigation: verify the bundle hash matches what was shown at preview time.
    if let Some(ref expected_hash) = options.expected_bundle_hash {
        let actual_hash = hex::encode(sha2::Sha256::digest(&bytes));
        if actual_hash != *expected_hash {
            tracing::error!(
                expected = %expected_hash,
                actual = %actual_hash,
                "Bundle hash mismatch — file may have been swapped after preview"
            );
            return Err(AppError::Validation(
                "Bundle integrity check failed: the file has changed since it was previewed. \
                 Please re-preview the bundle before importing."
                    .into(),
            ));
        }
    }

    let result = bundle::apply_import(&state.db, &bytes, options)?;

    tracing::info!(
        file_path = %file_path,
        imported = result.imported,
        skipped = result.skipped,
        errors = result.errors.len(),
        action = "bundle_imported",
        "Bundle import completed"
    );

    Ok(result)
}

// -- Clipboard Export (base64) -------------------------------------------

/// Maximum bundle size eligible for clipboard sharing (~256 KB).
const CLIPBOARD_MAX_BYTES: usize = 256 * 1024;

#[derive(serde::Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ClipboardExportResult {
    pub base64: String,
    pub bundle_hash: String,
    pub resource_count: u32,
    pub byte_size: u64,
}

#[tauri::command]
pub fn export_bundle_to_clipboard(
    state: State<'_, Arc<AppState>>,
    resource_ids: Vec<String>,
) -> Result<ClipboardExportResult, AppError> {
    require_privileged_sync(&state, "export_bundle_to_clipboard")?;
    if resource_ids.is_empty() {
        return Err(AppError::Validation(
            "At least one resource must be selected for export".into(),
        ));
    }

    let (bytes, result) = bundle::export_bundle(&state.db, &resource_ids)?;

    if bytes.len() > CLIPBOARD_MAX_BYTES {
        return Err(AppError::Validation(format!(
            "Bundle is too large for clipboard sharing ({} bytes, max {})",
            bytes.len(),
            CLIPBOARD_MAX_BYTES
        )));
    }

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    tracing::info!(
        resources = resource_ids.len(),
        bytes = bytes.len(),
        action = "bundle_clipboard_export",
        "Bundle exported to clipboard"
    );

    Ok(ClipboardExportResult {
        base64: b64,
        bundle_hash: result.bundle_hash,
        resource_count: result.resource_count,
        byte_size: result.byte_size,
    })
}

// -- Clipboard Import Preview (base64) -----------------------------------

#[tauri::command]
pub fn preview_bundle_from_clipboard(
    state: State<'_, Arc<AppState>>,
    base64_data: String,
) -> Result<BundleImportPreview, AppError> {
    require_auth_sync(&state)?;

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| AppError::Validation(format!("Invalid clipboard data: {e}")))?;

    if bytes.is_empty() {
        return Err(AppError::Validation("Clipboard data is empty".into()));
    }

    bundle::preview_bundle(&state.db, &bytes)
}

// -- Clipboard Import Apply (base64) ------------------------------------

#[tauri::command]
pub fn apply_bundle_from_clipboard(
    state: State<'_, Arc<AppState>>,
    base64_data: String,
    options: BundleImportOptions,
) -> Result<BundleImportResult, AppError> {
    require_privileged_sync(&state, "apply_bundle_from_clipboard")?;

    // Use cached preview bytes if available, otherwise decode from base64
    let bytes = if let Some(ref pid) = options.preview_id {
        match bundle::take_cached_preview_bytes(pid) {
            Some((cached_bytes, _cached_hash)) => cached_bytes,
            None => {
                tracing::warn!(preview_id = %pid, "Preview cache miss, re-decoding clipboard data");
                use base64::Engine;
                base64::engine::general_purpose::STANDARD
                    .decode(&base64_data)
                    .map_err(|e| AppError::Validation(format!("Invalid clipboard data: {e}")))?
            }
        }
    } else {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(&base64_data)
            .map_err(|e| AppError::Validation(format!("Invalid clipboard data: {e}")))?
    };

    if bytes.is_empty() {
        return Err(AppError::Validation("Bundle data is empty or unreadable".into()));
    }

    // TOCTOU mitigation: verify the bundle hash matches what was shown at preview time.
    if let Some(ref expected_hash) = options.expected_bundle_hash {
        let actual_hash = hex::encode(sha2::Sha256::digest(&bytes));
        if actual_hash != *expected_hash {
            tracing::error!(
                expected = %expected_hash,
                actual = %actual_hash,
                "Bundle hash mismatch — clipboard data may have been swapped after preview"
            );
            return Err(AppError::Validation(
                "Bundle integrity check failed: the data has changed since it was previewed. \
                 Please re-preview the bundle before importing."
                    .into(),
            ));
        }
    }

    let result = bundle::apply_import(&state.db, &bytes, options)?;

    tracing::info!(
        imported = result.imported,
        skipped = result.skipped,
        errors = result.errors.len(),
        action = "bundle_clipboard_import",
        "Bundle clipboard import completed"
    );

    Ok(result)
}

// -- Verify --------------------------------------------------------------

#[tauri::command]
pub fn verify_bundle(
    state: State<'_, Arc<AppState>>,
    file_path: String,
) -> Result<BundleVerification, AppError> {
    require_auth_sync(&state)?;
    let bytes = std::fs::read(&file_path)
        .map_err(AppError::Io)?;
    bundle::verify_bundle(&state.db, &bytes)
}

// -- Share Link ----------------------------------------------------------

#[tauri::command]
pub fn create_share_link(
    state: State<'_, Arc<AppState>>,
    resource_ids: Vec<String>,
) -> Result<ShareLinkResult, AppError> {
    require_privileged_sync(&state, "create_share_link")?;
    if resource_ids.is_empty() {
        return Err(AppError::Validation(
            "At least one resource must be selected for sharing".into(),
        ));
    }

    let result = share_link::create_share_link(&state.db, &resource_ids)?;

    tracing::info!(
        resources = resource_ids.len(),
        token = %result.token,
        action = "share_link_created",
        "Share link created"
    );

    Ok(result)
}

/// Resolve a `personas://share` deep link URL to its HTTP fetch URL
/// and metadata. The frontend uses this before preview/import.
#[tauri::command]
pub fn resolve_share_deep_link(
    url: String,
) -> Result<ResolvedShareLink, AppError> {
    share_link::resolve_deep_link(&url)
}

/// Resolve a URL that might be a `personas://share` deep link or an HTTP URL.
fn resolve_to_http_url(url: &str) -> Result<String, AppError> {
    if url.starts_with("personas://") {
        let resolved = share_link::resolve_deep_link(url)?;
        Ok(resolved.http_url)
    } else {
        Ok(url.to_string())
    }
}

#[tauri::command]
pub async fn import_from_share_link(
    state: State<'_, Arc<AppState>>,
    url: String,
    options: BundleImportOptions,
) -> Result<BundleImportResult, AppError> {
    require_privileged_sync(&state, "import_from_share_link")?;

    let http_url = resolve_to_http_url(&url)?;
    let bytes = share_link::fetch_share_link(&http_url).await?;

    if bytes.is_empty() {
        return Err(AppError::Validation("Share link returned empty data".into()));
    }

    let result = bundle::apply_import(&state.db, &bytes, options)?;

    tracing::info!(
        url = %url,
        imported = result.imported,
        skipped = result.skipped,
        action = "share_link_imported",
        "Bundle imported from share link"
    );

    Ok(result)
}

#[tauri::command]
pub async fn preview_share_link(
    state: State<'_, Arc<AppState>>,
    url: String,
) -> Result<BundleImportPreview, AppError> {
    require_auth_sync(&state)?;

    let http_url = resolve_to_http_url(&url)?;
    let bytes = share_link::fetch_share_link(&http_url).await?;

    if bytes.is_empty() {
        return Err(AppError::Validation("Share link returned empty data".into()));
    }

    bundle::preview_bundle(&state.db, &bytes)
}
