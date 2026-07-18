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
use personas_macros::requires;

// -- Export ---------------------------------------------------------------

#[tauri::command]
#[requires(privileged)]
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

    std::fs::write(&save_path, &bytes).map_err(AppError::Io)?;

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
    let bytes = std::fs::read(&file_path).map_err(AppError::Io)?;
    bundle::preview_bundle(&state.db, &bytes)
}

// -- Import Apply --------------------------------------------------------

#[tauri::command]
#[requires(privileged)]
pub fn apply_bundle_import(
    state: State<'_, Arc<AppState>>,
    file_path: String,
    options: BundleImportOptions,
) -> Result<BundleImportResult, AppError> {

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
        std::fs::read(&file_path).map_err(AppError::Io)?
    };

    if bytes.is_empty() {
        return Err(AppError::Validation(
            "Bundle file is empty or unreadable".into(),
        ));
    }

    // TOCTOU mitigation: when a preview was performed, the hash check is mandatory.
    if options.preview_id.is_some() && options.expected_bundle_hash.is_none() {
        return Err(AppError::Validation(
            "Bundle hash is required when importing a previewed bundle. \
             Please re-preview the bundle before importing."
                .into(),
        ));
    }
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
#[requires(privileged)]
pub fn export_bundle_to_clipboard(
    state: State<'_, Arc<AppState>>,
    resource_ids: Vec<String>,
) -> Result<ClipboardExportResult, AppError> {
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
#[requires(privileged)]
pub fn apply_bundle_from_clipboard(
    state: State<'_, Arc<AppState>>,
    base64_data: String,
    options: BundleImportOptions,
) -> Result<BundleImportResult, AppError> {

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
        return Err(AppError::Validation(
            "Bundle data is empty or unreadable".into(),
        ));
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
    let bytes = std::fs::read(&file_path).map_err(AppError::Io)?;
    bundle::verify_bundle(&state.db, &bytes)
}

// -- Share Link ----------------------------------------------------------

#[tauri::command]
#[requires(privileged)]
pub fn create_share_link(
    state: State<'_, Arc<AppState>>,
    resource_ids: Vec<String>,
) -> Result<ShareLinkResult, AppError> {
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
pub fn resolve_share_deep_link(url: String) -> Result<ResolvedShareLink, AppError> {
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

/// Verify fetched share-link bytes against the hash advertised by the link.
///
/// TOCTOU guard for the share-link import path — the analog of the
/// `expected_bundle_hash` check the file (`apply_bundle_import`) and clipboard
/// (`apply_bundle_from_clipboard`) import paths enforce. A `personas://share`
/// deep link carries `hash=` (the SHA-256 its creator computed over the bundle
/// bytes); we re-hash the bytes we actually fetch over HTTP and reject on
/// mismatch, so a malicious or MITM'd LAN share host cannot serve different
/// (e.g. trojaned) bytes than the ones the link's creator hashed.
///
/// `advertised` is the link's `hash=` value, or `None` for a raw HTTP URL or a
/// legacy hashless deep link. **Decision for the hashless case:**
/// - hashless `personas://share` deep link (`from_deep_link == true`) → REJECT.
///   Personas' own `create_share_link` ALWAYS emits `hash=`, so a deep link
///   without one is anomalous (a stale pre-hash link or tampering) and is
///   refused rather than imported blindly.
/// - raw `http://` URL (`from_deep_link == false`) → WARN + proceed. A pasted
///   HTTP URL carries no advertised hash to pin against; this mirrors the
///   file/clipboard paths, which only hard-fail on an actual mismatch and
///   otherwise proceed when no hash was supplied.
fn verify_share_link_hash(
    bytes: &[u8],
    advertised: Option<&str>,
    from_deep_link: bool,
) -> Result<(), AppError> {
    match advertised {
        Some(expected) => {
            let actual = hex::encode(sha2::Sha256::digest(bytes));
            if actual != expected {
                tracing::error!(
                    expected = %expected,
                    actual = %actual,
                    "Share-link bundle hash mismatch — fetched bytes differ from the link's advertised hash"
                );
                return Err(AppError::Validation(
                    "Bundle integrity check failed: the downloaded bundle does not match the \
                     hash in the share link. The link may be stale, or the host served \
                     different data. Ask the sender for a fresh link."
                        .into(),
                ));
            }
            Ok(())
        }
        None if from_deep_link => Err(AppError::Validation(
            "This share link is missing its integrity hash, so the downloaded bundle cannot be \
             verified. Ask the sender for an updated link, or import the bundle from a file instead."
                .into(),
        )),
        None => {
            tracing::warn!(
                "Importing share-link bundle from a raw HTTP URL with no advertised hash — \
                 bundle integrity cannot be verified"
            );
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn import_from_share_link(
    state: State<'_, Arc<AppState>>,
    url: String,
    options: BundleImportOptions,
) -> Result<BundleImportResult, AppError> {
    require_privileged_sync(&state, "import_from_share_link")?;

    // Resolve the deep link ourselves (rather than via resolve_to_http_url) so
    // we can pin the advertised content hash — the previous code discarded it,
    // leaving this the one import path without a TOCTOU guard.
    let (http_url, advertised_hash, from_deep_link) = if url.starts_with("personas://") {
        let resolved = share_link::resolve_deep_link(&url)?;
        let hash = (!resolved.bundle_hash.is_empty()).then_some(resolved.bundle_hash);
        (resolved.http_url, hash, true)
    } else {
        // A raw HTTP URL carries no advertised hash to pin against.
        (url.clone(), None, false)
    };

    let bytes = share_link::fetch_share_link(&http_url).await?;

    if bytes.is_empty() {
        return Err(AppError::Validation(
            "Share link returned empty data".into(),
        ));
    }

    // Reject (or, for raw HTTP URLs, warn) before writing anything to the DB.
    verify_share_link_hash(&bytes, advertised_hash.as_deref(), from_deep_link)?;

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
        return Err(AppError::Validation(
            "Share link returned empty data".into(),
        ));
    }

    bundle::preview_bundle(&state.db, &bytes)
}

#[cfg(test)]
mod share_link_hash_tests {
    use super::verify_share_link_hash;
    use sha2::Digest;

    fn hash_of(bytes: &[u8]) -> String {
        hex::encode(sha2::Sha256::digest(bytes))
    }

    #[test]
    fn matching_hash_is_accepted() {
        let bytes = b"trusted bundle bytes";
        let advertised = hash_of(bytes);
        assert!(verify_share_link_hash(bytes, Some(&advertised), true).is_ok());
    }

    #[test]
    fn tampered_bytes_are_rejected() {
        let advertised = hash_of(b"original bundle bytes");
        // Host served different bytes than the link's creator hashed.
        let served = b"swapped malicious bytes";
        let err = verify_share_link_hash(served, Some(&advertised), true)
            .expect_err("hash mismatch must be rejected");
        assert!(err.to_string().contains("integrity check failed"));
    }

    #[test]
    fn hashless_deep_link_is_rejected() {
        // DECISION: a personas://share deep link with no advertised hash is
        // anomalous (our generator always emits one) and is refused.
        let err = verify_share_link_hash(b"anything", None, true)
            .expect_err("hashless deep link must be rejected");
        assert!(err.to_string().contains("missing its integrity hash"));
    }

    #[test]
    fn hashless_raw_http_url_is_allowed() {
        // DECISION: a raw HTTP URL carries no hash to pin against; warn + proceed.
        assert!(verify_share_link_hash(b"anything", None, false).is_ok());
    }
}
