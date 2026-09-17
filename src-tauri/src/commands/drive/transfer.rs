//! Drive transfers: duplicate, import from OS paths, export to an OS folder,
//! and the absolute-path resolver the native drag-out hands to the OS.
//!
//! WIRE CONTRACT (drive-finder spark, 2026-09-17). Bytes never cross IPC:
//! import and export copy on the Rust side from / to absolute OS paths the
//! dialog plugin returned. None of these commands destroy data, so none is
//! privileged (`drive_delete` stays the only privileged drive command).
//!
//! STUB until the transfer work package lands.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use ts_rs::TS;

use crate::error::AppError;

use super::DriveEntry;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveTransferFailure {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveTransferReport {
    /// Top-level items copied successfully.
    pub added: u32,
    /// Names refused because a single file exceeded MAX_WRITE_BYTES.
    pub too_large: Vec<String>,
    /// Names that failed for any other reason, with the reason.
    pub failed: Vec<DriveTransferFailure>,
}

fn not_implemented(what: &str) -> AppError {
    AppError::Execution(format!("drive transfer: {what} not implemented"))
}

/// `name copy.ext`, then `name copy 2.ext`, … Folders duplicate recursively;
/// tags in the index are copied to the new key.
#[tauri::command]
pub fn drive_duplicate(app: AppHandle, rel_path: String) -> Result<DriveEntry, AppError> {
    let _ = (app, rel_path);
    Err(not_implemented("drive_duplicate"))
}

/// Copy absolute OS paths (files or folders) into `dest_rel`.
#[tauri::command]
pub fn drive_import_paths(
    app: AppHandle,
    paths: Vec<String>,
    dest_rel: String,
) -> Result<DriveTransferReport, AppError> {
    let _ = (app, paths, dest_rel);
    Err(not_implemented("drive_import_paths"))
}

/// Copy drive entries out to an absolute OS directory. Collisions get the
/// `name copy` suffix rather than overwriting.
#[tauri::command]
pub fn drive_export_to(
    app: AppHandle,
    rel_paths: Vec<String>,
    dest_dir: String,
) -> Result<DriveTransferReport, AppError> {
    let _ = (app, rel_paths, dest_dir);
    Err(not_implemented("drive_export_to"))
}

/// Absolute paths for a set of drive entries (for the native drag-out).
#[tauri::command]
pub fn drive_abs_paths(app: AppHandle, rel_paths: Vec<String>) -> Result<Vec<String>, AppError> {
    let _ = (app, rel_paths);
    Err(not_implemented("drive_abs_paths"))
}
