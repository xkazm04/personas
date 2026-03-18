use std::sync::Arc;
use tauri::State;

use crate::engine::bundle::{
    self, BundleExportResult, BundleImportOptions, BundleImportPreview, BundleImportResult,
    BundleVerification,
};
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
    // Falls back to re-reading the file if the cache entry expired or is missing.
    let bytes = if let Some(ref pid) = options.preview_id {
        bundle::take_cached_preview_bytes(pid).unwrap_or_else(|| {
            tracing::warn!(preview_id = %pid, "Preview cache miss, re-reading file");
            std::fs::read(&file_path).unwrap_or_default()
        })
    } else {
        std::fs::read(&file_path)
            .map_err(AppError::Io)?
    };

    if bytes.is_empty() {
        return Err(AppError::Validation("Bundle file is empty or unreadable".into()));
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
