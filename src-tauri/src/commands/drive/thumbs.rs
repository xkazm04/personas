//! Drive thumbnail service.
//!
//! WIRE CONTRACT (drive-finder spark, 2026-09-17): `drive_thumbnail` returns
//! JPEG bytes for an image entry, downsized to `edge` px on the long side
//! (clamped to one of 96 / 256 / 1024). The cache lives OUTSIDE the sandbox
//! at `app_cache_dir()/drive-thumbs/` keyed by
//! `<sha1(rel_path)>-<mtime_secs>-<size>-<edge>.jpg`; failures are cached as
//! `.fail` markers for 24 h; the cache holds a 256 MB budget, evicting the
//! oldest entries on write.
//!
//! STUB until the thumbnail work package lands.

use tauri::AppHandle;

use crate::error::AppError;

/// Allowed long-edge sizes. Any other value is clamped to the nearest.
pub const THUMB_EDGES: [u32; 3] = [96, 256, 1024];

#[tauri::command]
pub fn drive_thumbnail(
    app: AppHandle,
    rel_path: String,
    edge: u32,
) -> Result<tauri::ipc::Response, AppError> {
    let _ = (app, rel_path, edge);
    Err(AppError::Execution(
        "drive thumbs: drive_thumbnail not implemented".into(),
    ))
}
