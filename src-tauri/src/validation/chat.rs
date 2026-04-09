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

/// Allowed chat-message roles (defence-in-depth — `ChatRole` enum already
/// enforces this at the serde boundary, but the validation layer should be
/// self-contained).
const ALLOWED_ROLES: &[&str] = &["user", "assistant", "system", "tool"];

pub fn validate_role(value: &str) -> Vec<ValidationError> {
    if !ALLOWED_ROLES.contains(&value) {
        vec![ValidationError::new(
            "role",
            "allowed_values",
            format!(
                "Chat role must be one of: {}; got '{}'",
                ALLOWED_ROLES.join(", "),
                value
            ),
        )]
    } else {
        vec![]
    }
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
            format!("Must be one of: {}", ALLOWED_ROLES.join(", ")),
        )
        .with_allowed(ALLOWED_ROLES.iter().map(|s| (*s).into()).collect()),
    ]
}
