use crate::engine::ENGINE_MAX_EXECUTION_MS;

use super::contract::{ValidationError, ValidationRule};

// -- Constants ----------------------------------------------------------------

pub const MAX_NAME_CHARS: usize = 200;
pub const MAX_PROMPT_BYTES: usize = 50 * 1024; // 50 KB
pub const MAX_CONCURRENT_MIN: i32 = 1;
pub const MAX_CONCURRENT_MAX: i32 = 50;
pub const TIMEOUT_MS_MIN: i32 = 1000;
pub const MAX_TURNS_MIN: i32 = 1;

// -- Individual validators ----------------------------------------------------

pub fn validate_name(name: &str) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if name.trim().is_empty() {
        errors.push(ValidationError::new("name", "required", "Name cannot be empty"));
        return errors;
    }
    if name.chars().count() > MAX_NAME_CHARS {
        errors.push(ValidationError::new(
            "name",
            "max_length",
            format!("Name exceeds maximum length of {MAX_NAME_CHARS} characters"),
        ));
    }
    errors.extend(check_dangerous_content(name, "name", "Name"));
    errors
}

pub fn validate_system_prompt(prompt: &str) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if prompt.trim().is_empty() {
        errors.push(ValidationError::new("system_prompt", "required", "System prompt cannot be empty"));
        return errors;
    }
    if prompt.len() > MAX_PROMPT_BYTES {
        errors.push(ValidationError::new(
            "system_prompt",
            "max_length",
            format!("System prompt exceeds maximum size of {} KB", MAX_PROMPT_BYTES / 1024),
        ));
    }
    errors.extend(check_dangerous_content(prompt, "system_prompt", "System prompt"));
    errors
}

pub fn validate_structured_prompt(prompt: &str) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if prompt.len() > MAX_PROMPT_BYTES {
        errors.push(ValidationError::new(
            "structured_prompt",
            "max_length",
            format!("Structured prompt exceeds maximum size of {} KB", MAX_PROMPT_BYTES / 1024),
        ));
    }
    errors.extend(check_dangerous_content(prompt, "structured_prompt", "Structured prompt"));
    match serde_json::from_str::<serde_json::Value>(prompt) {
        Err(_) => {
            errors.push(ValidationError::new(
                "structured_prompt",
                "json",
                "Structured prompt must be valid JSON",
            ));
        }
        Ok(val) => {
            errors.extend(validate_structured_prompt_schema(&val));
        }
    }
    errors
}

/// Known top-level keys in a structured prompt. The prompt builder reads these
/// to assemble the final system prompt; any other keys are silently ignored at
/// runtime, which makes typos and malformed LLM output invisible.
const KNOWN_STRUCTURED_KEYS: &[&str] = &[
    "identity",
    "instructions",
    "toolGuidance",
    "examples",
    "errorHandling",
    "customSections",
    "webSearch",
];

/// Validate the inner structure of a parsed structured prompt JSON value.
/// Ensures that:
/// 1. The root is a JSON object (not array, string, etc.)
/// 2. At least one of `identity` or `instructions` is present (otherwise the
///    prompt is effectively empty and the persona would silently lose its behavior)
/// 3. String fields are actually strings (not nested objects/arrays)
/// 4. `customSections`, if present, is an array of objects with `content` strings
/// 5. No unknown top-level keys (catches LLM hallucinated fields)
pub fn validate_structured_prompt_schema(val: &serde_json::Value) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    let obj = match val.as_object() {
        Some(o) => o,
        None => {
            errors.push(ValidationError::new(
                "structured_prompt",
                "schema",
                "Structured prompt must be a JSON object",
            ));
            return errors;
        }
    };

    // Must have at least identity or instructions to be a meaningful prompt
    let has_identity = obj.get("identity").and_then(|v| v.as_str()).map_or(false, |s| !s.trim().is_empty());
    let has_instructions = obj.get("instructions").and_then(|v| v.as_str()).map_or(false, |s| !s.trim().is_empty());
    if !has_identity && !has_instructions {
        errors.push(ValidationError::new(
            "structured_prompt",
            "schema",
            "Structured prompt must contain at least 'identity' or 'instructions'",
        ));
    }

    // Validate string fields are actually strings
    for &key in &["identity", "instructions", "toolGuidance", "examples", "errorHandling", "webSearch"] {
        if let Some(v) = obj.get(key) {
            if !v.is_string() && !v.is_null() {
                errors.push(ValidationError::new(
                    "structured_prompt",
                    "schema",
                    format!("Field '{key}' must be a string"),
                ));
            }
        }
    }

    // Validate customSections structure
    if let Some(sections_val) = obj.get("customSections") {
        if sections_val.is_null() {
            // null is fine — treated as absent
        } else if let Some(sections) = sections_val.as_array() {
            for (i, section) in sections.iter().enumerate() {
                if let Some(sec_obj) = section.as_object() {
                    // Must have a content string
                    match sec_obj.get("content") {
                        Some(c) if c.is_string() => {}
                        _ => {
                            errors.push(ValidationError::new(
                                "structured_prompt",
                                "schema",
                                format!("customSections[{i}] must have a 'content' string"),
                            ));
                        }
                    }
                    // Must have at least one heading key
                    let has_heading = ["title", "label", "name", "key"]
                        .iter()
                        .any(|k| sec_obj.get(*k).and_then(|v| v.as_str()).map_or(false, |s| !s.is_empty()));
                    if !has_heading {
                        errors.push(ValidationError::new(
                            "structured_prompt",
                            "schema",
                            format!("customSections[{i}] must have a heading ('title', 'label', 'name', or 'key')"),
                        ));
                    }
                } else {
                    errors.push(ValidationError::new(
                        "structured_prompt",
                        "schema",
                        format!("customSections[{i}] must be an object"),
                    ));
                }
            }
        } else {
            errors.push(ValidationError::new(
                "structured_prompt",
                "schema",
                "'customSections' must be an array",
            ));
        }
    }

    // Warn about unknown top-level keys (LLM hallucinations)
    for key in obj.keys() {
        if !KNOWN_STRUCTURED_KEYS.contains(&key.as_str()) {
            errors.push(ValidationError::new(
                "structured_prompt",
                "unknown_field",
                format!("Unknown field '{key}' in structured prompt"),
            ));
        }
    }

    errors
}

pub fn validate_max_concurrent(v: i32) -> Vec<ValidationError> {
    if v < MAX_CONCURRENT_MIN || v > MAX_CONCURRENT_MAX {
        vec![ValidationError::new(
            "max_concurrent",
            "range",
            format!("max_concurrent must be between {MAX_CONCURRENT_MIN} and {MAX_CONCURRENT_MAX}"),
        )]
    } else {
        vec![]
    }
}

pub fn validate_timeout_ms(v: i32) -> Vec<ValidationError> {
    let ceiling = ENGINE_MAX_EXECUTION_MS;
    if v < TIMEOUT_MS_MIN {
        vec![ValidationError::new(
            "timeout_ms",
            "range",
            format!("timeout_ms must be >= {TIMEOUT_MS_MIN}"),
        )]
    } else if v > ceiling {
        vec![ValidationError::new(
            "timeout_ms",
            "range",
            format!("timeout_ms must be <= {} (engine ceiling is {} minutes)", ceiling, ceiling / 60_000),
        )]
    } else {
        vec![]
    }
}

pub fn validate_max_budget_usd(v: f64) -> Vec<ValidationError> {
    if v.is_nan() || v.is_infinite() {
        vec![ValidationError::new("max_budget_usd", "finite", "max_budget_usd must be a finite number")]
    } else if v < 0.0 {
        vec![ValidationError::new("max_budget_usd", "range", "max_budget_usd must be >= 0")]
    } else {
        vec![]
    }
}

pub fn validate_max_turns(v: i32) -> Vec<ValidationError> {
    if v < MAX_TURNS_MIN {
        vec![ValidationError::new("max_turns", "range", format!("max_turns must be >= {MAX_TURNS_MIN}"))]
    } else {
        vec![]
    }
}

pub fn validate_notification_channels(channels_json: &str) -> Vec<ValidationError> {
    let channels: Vec<serde_json::Value> = match serde_json::from_str(channels_json) {
        Ok(v) => v,
        Err(_) => {
            return vec![ValidationError::new(
                "notification_channels",
                "json",
                "notification_channels must be a valid JSON array",
            )];
        }
    };

    let mut errors = Vec::new();
    for ch in &channels {
        let enabled = ch.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        if !enabled {
            continue;
        }
        let ch_type = ch.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let config = ch.get("config");
        let get_field = |key: &str| -> bool {
            config
                .and_then(|c| c.get(key))
                .and_then(|v| v.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
        };
        match ch_type {
            "slack" if !get_field("channel") => {
                errors.push(ValidationError::new("notification_channels", "channel_required", "Slack channel name is required"));
            }
            "telegram" if !get_field("chat_id") => {
                errors.push(ValidationError::new("notification_channels", "chat_id_required", "Telegram chat ID is required"));
            }
            "email" if !get_field("to") => {
                errors.push(ValidationError::new("notification_channels", "to_required", "Email 'to' address is required"));
            }
            _ => {}
        }
    }
    errors
}

// -- Dangerous content check --------------------------------------------------

fn check_dangerous_content(text: &str, field: &str, field_label: &str) -> Vec<ValidationError> {
    for ch in text.chars() {
        if ch == '\0' {
            return vec![ValidationError::new(
                field,
                "no_null_bytes",
                format!("{field_label} must not contain null bytes"),
            )];
        }
        if ch.is_control() && ch != '\t' && ch != '\n' && ch != '\r' {
            return vec![ValidationError::new(
                field,
                "no_control_chars",
                format!("{field_label} contains invalid control characters"),
            )];
        }
    }
    vec![]
}

// -- Rule catalog -------------------------------------------------------------

pub fn rules() -> Vec<ValidationRule> {
    let ceiling = ENGINE_MAX_EXECUTION_MS;
    vec![
        ValidationRule::new("persona", "name", "required", "Name cannot be empty"),
        ValidationRule::new("persona", "name", "max_length", format!("Maximum {MAX_NAME_CHARS} characters"))
            .with_max(MAX_NAME_CHARS as f64),
        ValidationRule::new("persona", "name", "no_control_chars", "Must not contain null bytes or control characters"),
        ValidationRule::new("persona", "system_prompt", "required", "System prompt cannot be empty"),
        ValidationRule::new("persona", "system_prompt", "max_length", format!("Maximum {} KB", MAX_PROMPT_BYTES / 1024))
            .with_max(MAX_PROMPT_BYTES as f64),
        ValidationRule::new("persona", "structured_prompt", "max_length", format!("Maximum {} KB", MAX_PROMPT_BYTES / 1024))
            .with_max(MAX_PROMPT_BYTES as f64),
        ValidationRule::new("persona", "structured_prompt", "json", "Must be valid JSON"),
        ValidationRule::new("persona", "structured_prompt", "schema", "Must be a JSON object with 'identity' or 'instructions'"),
        ValidationRule::new("persona", "structured_prompt", "unknown_field", "Must not contain unknown top-level fields"),
        ValidationRule::new("persona", "max_concurrent", "range", format!("Must be between {MAX_CONCURRENT_MIN} and {MAX_CONCURRENT_MAX}"))
            .with_range(MAX_CONCURRENT_MIN as f64, MAX_CONCURRENT_MAX as f64),
        ValidationRule::new("persona", "timeout_ms", "range", format!("Must be between {TIMEOUT_MS_MIN} and {ceiling}"))
            .with_range(TIMEOUT_MS_MIN as f64, ceiling as f64),
        ValidationRule::new("persona", "max_budget_usd", "finite", "Must be a finite number"),
        ValidationRule::new("persona", "max_budget_usd", "range", "Must be >= 0")
            .with_min(0.0),
        ValidationRule::new("persona", "max_turns", "range", format!("Must be >= {MAX_TURNS_MIN}"))
            .with_min(MAX_TURNS_MIN as f64),
        ValidationRule::new("persona", "notification_channels", "json", "Must be a valid JSON array"),
    ]
}
