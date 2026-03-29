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
        return Err(AppError::Validation(format!("{field} is too long (max 200 chars)")));
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

/// Securely resolve a log file path from the database against an allowed root directory.
///
/// Defence-in-depth against CWE-22 (path traversal):
/// 1. **Pre-canonicalization**: reject raw paths containing `..` segments, null bytes,
///    or Windows alternate data streams (`:`) before any filesystem call. This prevents
///    NTFS junction / symlink tricks that could fool `canonicalize()`.
/// 2. **Canonicalize both root and requested path** so symlinks are fully resolved.
/// 3. **`starts_with` containment check** on the canonical paths.
pub fn safe_resolve_log_path(
    raw_path: &str,
    log_root: &std::path::Path,
) -> Result<std::path::PathBuf, AppError> {
    use std::path::{Component, Path};

    let path = Path::new(raw_path);

    // 1. Reject null bytes (could truncate C-level path strings).
    if raw_path.as_bytes().contains(&0) {
        return Err(AppError::Validation(
            "Log file path contains invalid characters".into(),
        ));
    }

    // 2. Reject `..` components before any filesystem call.
    //    Also reject Windows alternate data streams (colon in non-prefix position).
    for component in path.components() {
        match component {
            Component::ParentDir => {
                return Err(AppError::Validation(
                    "Log file path must not contain parent directory references".into(),
                ));
            }
            Component::Normal(seg) => {
                let s = seg.to_string_lossy();
                // Block NTFS alternate data streams (e.g. "file.log:hidden")
                if s.contains(':') {
                    return Err(AppError::Validation(
                        "Log file path contains invalid characters".into(),
                    ));
                }
            }
            _ => {}
        }
    }

    // 3. Canonicalize the allowed root.
    let canonical_root = log_root.canonicalize().map_err(|_| {
        AppError::Internal("Log directory is not accessible".into())
    })?;

    // 4. Canonicalize the requested path (resolves symlinks/junctions).
    let canonical_requested = path.canonicalize().map_err(|_| {
        AppError::NotFound("Log file not found".into())
    })?;

    // 5. Containment check on fully resolved paths.
    if !canonical_requested.starts_with(&canonical_root) {
        return Err(AppError::Validation(
            "Log file path is outside the allowed log directory".into(),
        ));
    }

    Ok(canonical_requested)
}
