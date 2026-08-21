//! Zip container: writing a bundle to disk and reading one back.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

pub(crate) async fn save_bundle_to_file(
    app: &AppHandle,
    bundle: &PortabilityBundle,
    default_name: &str,
) -> Result<bool, AppError> {
    let json =
        serde_json::to_string_pretty(bundle).map_err(|e| AppError::Internal(e.to_string()))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let file_name = format!("{}_{}.zip", default_name, timestamp);
    let app_clone = app.clone();

    let save_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("Personas Export Archive", &["zip"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    if let Some(file_path) = save_path {
        let path = file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;

        // Write as ZIP containing the JSON manifest
        let zip_bytes = create_zip_bundle(&json)?;
        tokio::fs::write(&path, zip_bytes)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;

        return Ok(true);
    }

    Ok(false)
}

pub(crate) fn create_zip_bundle(json: &str) -> Result<Vec<u8>, AppError> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP error: {e}")))?;
        zip.write_all(json.as_bytes())
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.finish()
            .map_err(|e| AppError::Internal(format!("ZIP finish error: {e}")))?;
    }
    Ok(buf.into_inner())
}

/// Maximum decompressed size for ZIP entries (50 MB).
pub(crate) const MAX_DECOMPRESSED_SIZE: u64 = 50 * 1024 * 1024;

pub(crate) fn read_zip_bundle(path: &std::path::Path) -> Result<String, AppError> {
    let file = std::fs::File::open(path)
        .map_err(|e| AppError::Internal(format!("Failed to open ZIP: {e}")))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Internal(format!("Invalid ZIP archive: {e}")))?;
    let mut manifest = archive
        .by_name("manifest.json")
        .map_err(|_| AppError::Validation("ZIP archive does not contain manifest.json".into()))?;

    // Guard against zip bombs: reject entries whose declared size exceeds the limit
    if manifest.size() > MAX_DECOMPRESSED_SIZE {
        return Err(AppError::Validation(format!(
            "manifest.json decompressed size ({} bytes) exceeds the {} MB limit",
            manifest.size(),
            MAX_DECOMPRESSED_SIZE / (1024 * 1024)
        )));
    }

    // Read with a capped reader so even a lying size header cannot exhaust memory
    let mut limited = std::io::Read::take(&mut manifest, MAX_DECOMPRESSED_SIZE + 1);
    let mut content = String::new();
    limited
        .read_to_string(&mut content)
        .map_err(|e| AppError::Internal(format!("Failed to read manifest: {e}")))?;

    if content.len() as u64 > MAX_DECOMPRESSED_SIZE {
        return Err(AppError::Validation(format!(
            "manifest.json decompressed content exceeds the {} MB limit",
            MAX_DECOMPRESSED_SIZE / (1024 * 1024)
        )));
    }

    Ok(content)
}
