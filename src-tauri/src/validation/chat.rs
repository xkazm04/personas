use super::contract::{ValidationError, ValidationRule};

/// Maximum content length for a chat message (100 KB).
pub const MAX_CONTENT_BYTES: usize = 100_000;

/// Maximum metadata length for a chat message (10 KB).
pub const MAX_METADATA_BYTES: usize = 10_000;

pub fn validate_content(value: &str) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if value.trim().is_empty() {
        errors.push(ValidationError::new(
            "content",
            "required",
            "Chat message content cannot be empty",
        ));
    }
    if value.len() > MAX_CONTENT_BYTES {
        errors.push(ValidationError::new(
            "content",
            "max_length",
            format!(
                "Chat message content exceeds maximum length ({} bytes > {} limit)",
                value.len(),
                MAX_CONTENT_BYTES
            ),
        ));
    }
    errors
}

pub fn validate_metadata(value: &str) -> Vec<ValidationError> {
    if value.len() > MAX_METADATA_BYTES {
        vec![ValidationError::new(
            "metadata",
            "max_length",
            format!(
                "Chat message metadata exceeds maximum length ({} bytes > {} limit)",
                value.len(),
                MAX_METADATA_BYTES
            ),
        )]
    } else {
        vec![]
    }
}

// -- Rule catalog -------------------------------------------------------------

pub fn rules() -> Vec<ValidationRule> {
    vec![
        ValidationRule::new(
            "chat",
            "content",
            "required",
            "Chat message content cannot be empty",
        ),
        ValidationRule::new(
            "chat",
            "content",
            "max_length",
            format!("Must not exceed {} bytes", MAX_CONTENT_BYTES),
        )
        .with_max(MAX_CONTENT_BYTES as f64),
        ValidationRule::new(
            "chat",
            "metadata",
            "max_length",
            format!("Must not exceed {} bytes", MAX_METADATA_BYTES),
        )
        .with_max(MAX_METADATA_BYTES as f64),
        ValidationRule::new(
            "chat",
            "role",
            "allowed_values",
            "Must be one of: user, assistant, system, tool",
        )
        .with_allowed(vec![
            "user".into(),
            "assistant".into(),
            "system".into(),
            "tool".into(),
        ]),
    ]
}
