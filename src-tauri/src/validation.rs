#![allow(dead_code)] // Used by commands as needed

use crate::error::AppError;

pub fn require_non_empty(field: &str, value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::Validation(format!("{field} cannot be empty")));
    }
    Ok(())
}

pub fn require_valid_id(field: &str, value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::Validation(format!("{field} must be a valid ID")));
    }
    Ok(())
}
