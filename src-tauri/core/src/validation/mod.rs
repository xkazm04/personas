#![allow(dead_code)] // Used by commands as needed

pub mod chat;
pub mod contract;
pub mod memory;
pub mod persona;
pub mod trigger;

use crate::error::AppError;

/// Strip HTML/XML tags from a string to prevent stored XSS.
///
/// Uses the `ammonia` crate to properly distinguish real HTML tags from
/// legitimate text containing `<` / `>` (e.g. math expressions, code snippets).
/// After stripping, HTML entities are decoded back so stored content remains
/// human-readable.
pub fn strip_html_tags(input: &str) -> String {
    let cleaned = ammonia::Builder::new()
        .tags(std::collections::HashSet::new())
        .clean(input)
        .to_string();
    cleaned
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
}

pub fn require_non_empty(field: &str, value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::Validation(format!("{field} cannot be empty")));
    }
    Ok(())
}

pub fn require_valid_id(field: &str, value: &str) -> Result<(), AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{field} must be a valid ID")));
    }
    if trimmed.len() > 200 {
        return Err(AppError::Validation(format!(
            "{field} is too long (max 200 chars)"
        )));
    }
    // Whitelist: only allow alphanumeric, dash, underscore, and dot.
    // This eliminates entire classes of injection (null bytes, control chars,
    // path traversal, CRLF injection, SQL injection via special chars).
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(AppError::Validation(format!(
            "{field} contains invalid characters (only alphanumeric, dash, underscore, and dot are allowed)"
        )));
    }
    // Still reject consecutive dots to prevent path traversal like "../"
    if trimmed.contains("..") {
        return Err(AppError::Validation(format!(
            "{field} contains invalid character sequence"
        )));
    }
    Ok(())
}

/// Validate that a string does not exceed a maximum byte length.
pub fn require_max_len(field: &str, value: &str, max_bytes: usize) -> Result<(), AppError> {
    if value.len() > max_bytes {
        return Err(AppError::Validation(format!(
            "{field} exceeds maximum length ({} bytes > {max_bytes} limit)",
            value.len()
        )));
    }
    Ok(())
}

/// Validate that an optional string, if present, does not exceed a maximum byte length.
pub fn require_optional_max_len(
    field: &str,
    value: &Option<String>,
    max_bytes: usize,
) -> Result<(), AppError> {
    if let Some(v) = value {
        require_max_len(field, v, max_bytes)?;
    }
    Ok(())
}

/// Validate that a collection does not exceed a maximum number of items.
pub fn require_max_count<T>(field: &str, items: &[T], max: usize) -> Result<(), AppError> {
    if items.len() > max {
        return Err(AppError::Validation(format!(
            "{field} has too many items ({} > {max} limit)",
            items.len()
        )));
    }
    Ok(())
}

/// Open a log file path from the database after validating it against an allowed root directory.
///
/// Defence-in-depth against CWE-22 (path traversal):
/// 1. **Pre-canonicalization**: reject raw paths containing `..` segments, null bytes,
///    or Windows alternate data streams (`:`) before any filesystem call. This prevents
///    NTFS junction / symlink tricks that could fool `canonicalize()`.
/// 2. **Open before trusting the path** using no-follow flags where the platform exposes them.
/// 3. **Canonicalize both root and requested path** so symlinks are fully resolved.
/// 4. **`starts_with` containment check** on the canonical paths.
/// 5. **File identity check** between the opened handle and canonical path to close the
///    check/open race if the path is swapped while validation is in progress.
pub fn open_log_file_safely(
    raw_path: &str,
    log_root: &std::path::Path,
) -> Result<std::fs::File, AppError> {
    use std::path::Path;

    let path = Path::new(raw_path);

    validate_log_path_text(raw_path, path)?;

    let file = open_no_follow(path).map_err(|_| AppError::NotFound("Log file not found".into()))?;
    let opened_metadata = file
        .metadata()
        .map_err(|_| AppError::NotFound("Log file not found".into()))?;
    if !opened_metadata.is_file() {
        return Err(AppError::Validation("Log path is not a file".into()));
    }

    let canonical_root = log_root
        .canonicalize()
        .map_err(|_| AppError::Internal("Log directory is not accessible".into()))?;

    let canonical_requested = path
        .canonicalize()
        .map_err(|_| AppError::NotFound("Log file not found".into()))?;

    if !canonical_requested.starts_with(&canonical_root) {
        return Err(AppError::Validation(
            "Log file path is outside the allowed log directory".into(),
        ));
    }

    if !same_file_identity(&file, &opened_metadata, &canonical_requested)? {
        return Err(AppError::Validation(
            "Log file changed while it was being validated".into(),
        ));
    }

    Ok(file)
}

fn validate_log_path_text(raw_path: &str, path: &std::path::Path) -> Result<(), AppError> {
    use std::path::Component;

    if raw_path.as_bytes().contains(&0) {
        return Err(AppError::Validation(
            "Log file path contains invalid characters".into(),
        ));
    }

    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err(AppError::Validation(
                    "Log file path must not contain parent directory references".into(),
                ));
            }
            Component::Normal(seg) => {
                let s = seg.to_string_lossy();
                if s.contains(':') {
                    return Err(AppError::Validation(
                        "Log file path contains invalid characters".into(),
                    ));
                }
            }
            _ => {}
        }
    }

    Ok(())
}

fn open_no_follow(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }

    options.open(path)
}

#[cfg(unix)]
fn same_file_identity(
    _opened_file: &std::fs::File,
    opened_metadata: &std::fs::Metadata,
    canonical_path: &std::path::Path,
) -> Result<bool, AppError> {
    use std::os::unix::fs::MetadataExt;
    let canonical_metadata = std::fs::metadata(canonical_path)
        .map_err(|_| AppError::NotFound("Log file not found".into()))?;
    Ok(opened_metadata.dev() == canonical_metadata.dev()
        && opened_metadata.ino() == canonical_metadata.ino())
}

#[cfg(windows)]
fn same_file_identity(
    opened_file: &std::fs::File,
    _opened_metadata: &std::fs::Metadata,
    canonical_path: &std::path::Path,
) -> Result<bool, AppError> {
    let canonical_file = open_no_follow(canonical_path)
        .map_err(|_| AppError::NotFound("Log file not found".into()))?;
    Ok(windows_file_identity(opened_file)? == windows_file_identity(&canonical_file)?)
}

#[cfg(not(any(unix, windows)))]
fn same_file_identity(
    _opened_file: &std::fs::File,
    opened_metadata: &std::fs::Metadata,
    canonical_path: &std::path::Path,
) -> Result<bool, AppError> {
    let canonical_metadata = std::fs::metadata(canonical_path)
        .map_err(|_| AppError::NotFound("Log file not found".into()))?;
    Ok(opened_metadata.len() == canonical_metadata.len()
        && opened_metadata.modified().ok() == canonical_metadata.modified().ok()
        && opened_metadata.created().ok() == canonical_metadata.created().ok())
}

#[cfg(windows)]
#[derive(Debug, Eq, PartialEq)]
struct WindowsFileIdentity {
    volume_serial_number: u32,
    file_index_high: u32,
    file_index_low: u32,
}

#[cfg(windows)]
fn windows_file_identity(file: &std::fs::File) -> Result<WindowsFileIdentity, AppError> {
    use std::mem::MaybeUninit;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), info.as_mut_ptr()) }
        .map_err(|e| AppError::Internal(format!("Failed to inspect log file handle: {e}")))?;
    let info = unsafe { info.assume_init() };
    Ok(WindowsFileIdentity {
        volume_serial_number: info.dwVolumeSerialNumber,
        file_index_high: info.nFileIndexHigh,
        file_index_low: info.nFileIndexLow,
    })
}
