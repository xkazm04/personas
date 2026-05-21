//! Custom persona icon storage.
//!
//! Users can upload their own image for a persona instead of picking from the
//! built-in catalog. An uploaded file is decoded, downscaled, and re-encoded to
//! PNG before it ever touches disk — the original bytes are never persisted, so
//! EXIF payloads, oversized dimensions, and format-specific exploits are
//! stripped at the door.
//!
//! Storage layout: `{app_data_dir}/persona-icons/{sha256}.png`. The filename is
//! the SHA-256 of the re-encoded PNG, so two identical uploads dedupe to one
//! file. A persona's `icon` column holds `custom-icon:{sha256}`.
//!
//! There is no database table — the directory IS the icon library. Files are
//! intentionally kept even when no persona currently references them, so a user
//! can upload once and reuse the icon across many personas ("Your icons" in the
//! picker). Removal is always explicit, via `delete_persona_icon`.

use std::io::Cursor;
use std::path::PathBuf;

use image::{imageops::FilterType, ImageFormat, ImageReader, Limits};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::fs;

use crate::error::AppError;

/// Hard cap on the source file we'll even read (10 MB). A persona icon is a
/// small image; anything larger is a mistake or an attack.
const MAX_SOURCE_BYTES: u64 = 10 * 1024 * 1024;

/// Largest edge of the stored icon. Uploads are downscaled to fit; smaller
/// images are left as-is (never upscaled).
const MAX_ICON_EDGE: u32 = 512;

/// Decoder guardrails against decompression bombs — a small file can still
/// declare enormous dimensions.
const MAX_DECODE_WIDTH: u32 = 12_000;
const MAX_DECODE_HEIGHT: u32 = 12_000;
const MAX_DECODE_ALLOC: u64 = 256 * 1024 * 1024;

/// Resolve `{app_data_dir}/persona-icons`, the custom-icon library directory.
fn persona_icons_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app_data_dir unavailable: {e}")))?;
    Ok(dir.join("persona-icons"))
}

/// An asset ID is always the hex SHA-256 of a stored file. Validating the shape
/// before joining it into a path closes off `../` traversal from a crafted IPC
/// call.
fn is_valid_asset_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Decode an arbitrary user image, downscale it to fit `MAX_ICON_EDGE`, and
/// re-encode it as PNG. Synchronous + CPU-bound — call via `spawn_blocking`.
///
/// The decode-then-re-encode round trip is the security boundary: the output
/// is a freshly-encoded PNG with no metadata carried over from the source.
fn decode_and_reencode(source_path: &str) -> Result<Vec<u8>, AppError> {
    let mut reader = ImageReader::open(source_path)
        .map_err(|e| AppError::NotFound(format!("Cannot open image: {e}")))?
        .with_guessed_format()
        .map_err(|e| AppError::Validation(format!("Cannot read image header: {e}")))?;

    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DECODE_WIDTH);
    limits.max_image_height = Some(MAX_DECODE_HEIGHT);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);

    let img = reader
        .decode()
        .map_err(|e| AppError::Validation(format!("Unsupported or corrupt image: {e}")))?;

    // Downscale to fit, preserving aspect ratio. Never upscale a small image.
    let img = if img.width() > MAX_ICON_EDGE || img.height() > MAX_ICON_EDGE {
        img.resize(MAX_ICON_EDGE, MAX_ICON_EDGE, FilterType::Lanczos3)
    } else {
        img
    };

    let mut png_bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| AppError::Internal(format!("Encode PNG: {e}")))?;
    Ok(png_bytes)
}

/// Import an image file as a custom persona icon.
///
/// `source_path` is a path the user picked via the file dialog. Returns the
/// asset ID (hex SHA-256 of the stored PNG); the caller stores
/// `custom-icon:{id}` in the persona's `icon` column.
#[tauri::command]
pub async fn import_persona_icon(app: AppHandle, source_path: String) -> Result<String, AppError> {
    // 1. Size gate before reading anything large into memory.
    let meta = fs::metadata(&source_path)
        .await
        .map_err(|e| AppError::NotFound(format!("Cannot read {source_path}: {e}")))?;
    if meta.len() > MAX_SOURCE_BYTES {
        return Err(AppError::Validation(format!(
            "Image is too large ({:.1} MB). Maximum is {} MB.",
            meta.len() as f64 / (1024.0 * 1024.0),
            MAX_SOURCE_BYTES / (1024 * 1024),
        )));
    }

    // 2. Decode + downscale + re-encode off the IPC worker thread.
    let png_bytes = tokio::task::spawn_blocking(move || decode_and_reencode(&source_path))
        .await
        .map_err(|e| AppError::Internal(format!("Image task panicked: {e}")))??;

    // 3. Content-address: the filename is the hash of the re-encoded bytes, so
    //    identical uploads collapse to one file.
    let mut hasher = Sha256::new();
    hasher.update(&png_bytes);
    let asset_id = hex::encode(hasher.finalize());

    // 4. Persist (skip the write when the content is already on disk).
    let dir = persona_icons_dir(&app)?;
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Internal(format!("Create persona-icons dir: {e}")))?;
    let target = dir.join(format!("{asset_id}.png"));
    if !target.exists() {
        fs::write(&target, &png_bytes)
            .await
            .map_err(|e| AppError::Internal(format!("Write icon: {e}")))?;
    }

    Ok(asset_id)
}

/// List every custom icon asset ID currently in the library. Backs the
/// "Your icons" section of the picker, where uploads can be reused fleet-wide.
#[tauri::command]
pub async fn list_persona_icons(app: AppHandle) -> Result<Vec<String>, AppError> {
    let dir = persona_icons_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = fs::read_dir(&dir)
        .await
        .map_err(|e| AppError::Internal(format!("Read persona-icons dir: {e}")))?;

    let mut ids = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Internal(format!("Iterate persona-icons dir: {e}")))?
    {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("png") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if is_valid_asset_id(stem) {
                ids.push(stem.to_string());
            }
        }
    }
    Ok(ids)
}

/// Delete a custom icon file from the library. Best-effort — a missing file is
/// not an error. Personas still referencing the deleted asset fall back to the
/// default icon at render time.
#[tauri::command]
pub async fn delete_persona_icon(app: AppHandle, asset_id: String) -> Result<(), AppError> {
    if !is_valid_asset_id(&asset_id) {
        return Err(AppError::Validation("Invalid icon asset ID".into()));
    }
    let target = persona_icons_dir(&app)?.join(format!("{asset_id}.png"));
    if target.exists() {
        fs::remove_file(&target)
            .await
            .map_err(|e| AppError::Internal(format!("Delete icon: {e}")))?;
    }
    Ok(())
}
