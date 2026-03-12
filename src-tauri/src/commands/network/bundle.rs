use std::sync::Arc;
use tauri::State;

use crate::engine::bundle::{
    self, BundleExportResult, BundleImportOptions, BundleImportPreview, BundleImportResult,
    BundleVerification,
};
use crate::error::AppError;
use crate::AppState;

// ── Export ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn export_persona_bundle(
    state: State<'_, Arc<AppState>>,
    resource_ids: Vec<String>,
    save_path: String,
) -> Result<BundleExportResult, AppError> {
    if resource_ids.is_empty() {
        return Err(AppError::Validation(
            "At least one resource must be selected for export".into(),
        ));
    }

    let (bytes, result) = bundle::export_bundle(&state.db, &resource_ids)?;

    std::fs::write(&save_path, &bytes)
        .map_err(|e| AppError::Io(e))?;

    tracing::info!(
        path = %save_path,
        resources = resource_ids.len(),
        bytes = bytes.len(),
        "Bundle exported"
    );

    Ok(result)
}

// ── Import Preview ──────────────────────────────────────────────────────

#[tauri::command]
pub fn preview_bundle_import(
    state: State<'_, Arc<AppState>>,
    file_path: String,
) -> Result<BundleImportPreview, AppError> {
    let bytes = std::fs::read(&file_path)
        .map_err(|e| AppError::Io(e))?;
    bundle::preview_bundle(&state.db, &bytes)
}

// ── Import Apply ────────────────────────────────────────────────────────

#[tauri::command]
pub fn apply_bundle_import(
    state: State<'_, Arc<AppState>>,
    file_path: String,
    options: BundleImportOptions,
) -> Result<BundleImportResult, AppError> {
    let bytes = std::fs::read(&file_path)
        .map_err(|e| AppError::Io(e))?;

    let result = bundle::apply_import(&state.db, &bytes, options)?;

    tracing::info!(
        imported = result.imported,
        skipped = result.skipped,
        errors = result.errors.len(),
        "Bundle import completed"
    );

    Ok(result)
}

// ── Verify ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn verify_bundle(
    state: State<'_, Arc<AppState>>,
    file_path: String,
) -> Result<BundleVerification, AppError> {
    let bytes = std::fs::read(&file_path)
        .map_err(|e| AppError::Io(e))?;
    bundle::verify_bundle(&state.db, &bytes)
}
