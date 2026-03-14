#![allow(dead_code)] // Used by commands as needed

use crate::error::AppError;

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
