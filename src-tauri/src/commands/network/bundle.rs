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

    enforce_preview_pin(
        &bytes,
        options.preview_id.as_deref(),
        options.expected_bundle_hash.as_deref(),
        "file",
    )?;

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

/// TOCTOU pin shared by all three import doors (file, clipboard, share link):
/// the bytes committed must be the bytes the user previewed.
///
/// When a preview was performed (`preview_id` set) the preview's hash is
/// mandatory, and whenever a hash is supplied the bytes about to be imported
/// are re-hashed and refused on mismatch. `subject` names what changed in the
/// user-facing message ("file", "data", "downloaded bundle").
fn enforce_preview_pin(
    bytes: &[u8],
    preview_id: Option<&str>,
    expected_hash: Option<&str>,
    subject: &str,
) -> Result<(), AppError> {
    if preview_id.is_some() && expected_hash.is_none() {
        return Err(AppError::Validation(
            "Bundle hash is required when importing a previewed bundle. \
             Please re-preview the bundle before importing."
                .into(),
        ));
    }
    if let Some(expected) = expected_hash {
        let actual = hex::encode(sha2::Sha256::digest(bytes));
        if actual != expected {
            tracing::error!(
                expected = %expected,
                actual = %actual,
                subject = %subject,
                "Bundle hash mismatch — bytes may have been swapped after preview"
            );
            return Err(AppError::Validation(format!(
                "Bundle integrity check failed: the {subject} has changed since it was previewed. \
                 Please re-preview the bundle before importing."
            )));
        }
    }
    Ok(())
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

    // Without this, a clipboard payload swapped after the preview was shown to
    // the user could be applied on a preview-cache miss with no integrity check.
    enforce_preview_pin(
        &bytes,
        options.preview_id.as_deref(),
        options.expected_bundle_hash.as_deref(),
        "data",
    )?;

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

/// Where a share URL points and what it advertises: the HTTP fetch URL, the
/// link's `hash=` (if any) and whether it was a `personas://share` deep link.
/// Shared by the preview and import doors so both pin the same facts.
struct ShareTarget {
    http_url: String,
    advertised_hash: Option<String>,
    from_deep_link: bool,
}

/// Resolve a URL that might be a `personas://share` deep link or an HTTP URL.
fn resolve_share_target(url: &str) -> Result<ShareTarget, AppError> {
    if url.starts_with("personas://") {
        let resolved = share_link::resolve_deep_link(url)?;
        let advertised_hash = (!resolved.bundle_hash.is_empty()).then_some(resolved.bundle_hash);
        Ok(ShareTarget {
            http_url: resolved.http_url,
            advertised_hash,
            from_deep_link: true,
        })
    } else {
        // A raw HTTP URL carries no advertised hash to pin against.
        Ok(ShareTarget {
            http_url: url.to_string(),
            advertised_hash: None,
            from_deep_link: false,
        })
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

    let ShareTarget {
        http_url,
        advertised_hash,
        from_deep_link,
    } = resolve_share_target(&url)?;

    // Commit the previewed bytes, not a second download: `preview_share_link`
    // cached what the user saw under `preview_id`. Only on a cache miss do we
    // re-fetch, and then the preview pin below refuses anything the host
    // swapped in after the preview.
    let cached = options
        .preview_id
        .as_deref()
        .and_then(bundle::take_cached_preview_bytes);
    let bytes = match cached {
        Some((cached_bytes, _cached_hash)) => cached_bytes,
        None => {
            if let Some(pid) = options.preview_id.as_deref() {
                tracing::warn!(preview_id = %pid, "Preview cache miss, re-fetching share link");
            }
            share_link::fetch_share_link(&http_url).await?
        }
    };

    if bytes.is_empty() {
        return Err(AppError::Validation(
            "Share link returned empty data".into(),
        ));
    }

    // Reject (or, for raw HTTP URLs, warn) before writing anything to the DB.
    verify_share_link_hash(&bytes, advertised_hash.as_deref(), from_deep_link)?;
    enforce_preview_pin(
        &bytes,
        options.preview_id.as_deref(),
        options.expected_bundle_hash.as_deref(),
        "downloaded bundle",
    )?;

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

    let target = resolve_share_target(&url)?;
    let bytes = share_link::fetch_share_link(&target.http_url).await?;

    if bytes.is_empty() {
        return Err(AppError::Validation(
            "Share link returned empty data".into(),
        ));
    }

    // Refuse here exactly what `import_from_share_link` refuses, so a swapped
    // bundle is never rendered in a preview that the import will then reject.
    verify_share_link_hash(
        &bytes,
        target.advertised_hash.as_deref(),
        target.from_deep_link,
    )?;

    bundle::preview_bundle(&state.db, &bytes)
}

#[cfg(test)]
mod share_link_hash_tests {
    use super::{resolve_share_target, verify_share_link_hash};
    use sha2::Digest;

    #[test]
    fn share_target_carries_the_links_hash_for_the_preview_door() {
        let t =
            resolve_share_target("personas://share?token=tok&hash=abc123&host=10.0.0.5&port=1234")
                .expect("deep link resolves");
        assert_eq!(t.advertised_hash.as_deref(), Some("abc123"));
        assert!(t.from_deep_link);
        assert_eq!(t.http_url, "http://10.0.0.5:1234/share/tok");

        let hashless = resolve_share_target("personas://share?token=tok").unwrap();
        assert_eq!(hashless.advertised_hash, None);
        assert!(hashless.from_deep_link);

        let raw = resolve_share_target("http://10.0.0.5:1234/share/tok").unwrap();
        assert_eq!(raw.advertised_hash, None);
        assert!(!raw.from_deep_link);
    }

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

    // -- Preview pin (shared by the file, clipboard and share-link doors) --

    use super::enforce_preview_pin;

    #[test]
    fn preview_pin_accepts_the_previewed_bytes() {
        let bytes = b"previewed bundle A";
        let pinned = hash_of(bytes);
        assert!(enforce_preview_pin(bytes, Some("pid"), Some(&pinned), "file").is_ok());
    }

    #[test]
    fn preview_pin_rejects_bytes_swapped_after_preview() {
        // A share host served bundle A at preview time and bundle B at import
        // time: the hash the dialog pinned from the preview must refuse B.
        let pinned = hash_of(b"previewed bundle A");
        let err = enforce_preview_pin(
            b"swapped bundle B",
            Some("pid"),
            Some(&pinned),
            "downloaded bundle",
        )
        .expect_err("bytes that differ from the preview must be refused");
        assert!(err.to_string().contains("integrity check failed"));
        assert!(err.to_string().contains("downloaded bundle"));
    }

    #[test]
    fn preview_pin_requires_a_hash_once_previewed() {
        let err = enforce_preview_pin(b"anything", Some("pid"), None, "data")
            .expect_err("a previewed import without a pinned hash must be refused");
        assert!(err.to_string().contains("Bundle hash is required"));
    }

    #[test]
    fn preview_pin_is_a_no_op_without_a_preview() {
        assert!(enforce_preview_pin(b"anything", None, None, "file").is_ok());
    }
}
