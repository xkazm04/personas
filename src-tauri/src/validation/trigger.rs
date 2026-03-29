use super::contract::{ValidationError, ValidationRule};

pub const VALID_TRIGGER_TYPES: &[&str] = &[
    "schedule", "polling", "webhook", "manual", "chain", "event_listener",
    "file_watcher", "clipboard", "app_focus", "composite",
];
pub const MIN_INTERVAL_SECONDS: i64 = 60;

pub fn validate_trigger_type(trigger_type: &str) -> Vec<ValidationError> {
    if !VALID_TRIGGER_TYPES.contains(&trigger_type) {
        vec![ValidationError::new(
            "trigger_type",
            "allowed_values",
            format!(
                "Invalid trigger_type '{}'. Must be one of: {}",
                trigger_type,
                VALID_TRIGGER_TYPES.join(", ")
            ),
        )]
    } else {
        vec![]
    }
}

pub fn validate_config_json(config: Option<&str>) -> Vec<ValidationError> {
    if let Some(c) = config {
        let trimmed = c.trim();
        if !trimmed.is_empty() {
            if serde_json::from_str::<serde_json::Value>(trimmed).is_err() {
                return vec![ValidationError::new(
                    "config",
                    "json",
                    "Invalid config JSON",
                )];
            }
        }
    }
    vec![]
}

pub fn validate_config(trigger_type: &str, config: Option<&str>) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    if let Some(config_str) = config {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(config_str) {
            if let Some(interval) = parsed.get("interval_seconds") {
                match interval.as_i64() {
                    Some(n) if n < MIN_INTERVAL_SECONDS => {
                        errors.push(ValidationError::new(
                            "config.interval_seconds",
                            "range",
                            format!("interval_seconds must be at least {MIN_INTERVAL_SECONDS}"),
                        ));
                    }
                    Some(_) => {}
                    None => {
                        errors.push(ValidationError::new(
                            "config.interval_seconds",
                            "type",
                            "interval_seconds must be a valid integer",
                        ));
                    }
                }
            }

            if trigger_type == "webhook" {
                let secret = parsed
                    .get("webhook_secret")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if secret.trim().is_empty() {
                    errors.push(ValidationError::new(
                        "config.webhook_secret",
                        "required",
                        "Webhook triggers require a non-empty webhook_secret for HMAC authentication",
                    ));
                }
            }
        }
    } else if trigger_type == "webhook" {
        errors.push(ValidationError::new(
            "config",
            "required",
            "Webhook triggers require a config with a non-empty webhook_secret",
        ));
    }

    errors
}

pub fn validate_polling_url(trigger_type: &str, config: Option<&str>) -> Vec<ValidationError> {
    if trigger_type != "polling" {
        return vec![];
    }
    let url = config
        .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
        .and_then(|v| {
            v.get("url")
                .or(v.get("endpoint"))
                .and_then(|u| u.as_str().map(String::from))
        });
    if let Some(u) = url {
        if !u.is_empty() {
            if let Err(reason) = crate::engine::url_safety::validate_url_safety(&u) {
                return vec![ValidationError::new(
                    "config.url",
                    "url_safety",
                    format!("Polling URL blocked: {reason}"),
                )];
            }
        }
    }
    vec![]
}

// -- Rule catalog -------------------------------------------------------------

pub fn rules() -> Vec<ValidationRule> {
    vec![
        ValidationRule::new("trigger", "trigger_type", "allowed_values", "Must be a valid trigger type")
            .with_allowed(VALID_TRIGGER_TYPES.iter().map(|s| s.to_string()).collect()),
        ValidationRule::new("trigger", "config", "json", "Config must be valid JSON when provided"),
        ValidationRule::new("trigger", "config.interval_seconds", "range", format!("Must be at least {MIN_INTERVAL_SECONDS}"))
            .with_min(MIN_INTERVAL_SECONDS as f64),
        ValidationRule::new("trigger", "config.webhook_secret", "required", "Required for webhook triggers"),
        ValidationRule::new("trigger", "config.url", "url_safety", "Polling URLs must not target private/internal addresses"),
    ]
}
