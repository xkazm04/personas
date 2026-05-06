use super::contract::{ValidationError, ValidationRule};

pub const VALID_TRIGGER_TYPES: &[&str] = &[
    "schedule",
    "polling",
    "webhook",
    "manual",
    "chain",
    "event_listener",
    "file_watcher",
    "clipboard",
    "app_focus",
    "composite",
];
pub const MIN_INTERVAL_SECONDS: i64 = 60;

/// Normalize common LLM/template trigger type aliases to valid enum values.
/// Templates and LLMs sometimes produce shortened or alternative names
/// (e.g., "event" instead of "event_listener", "cron" instead of "schedule").
pub fn normalize_trigger_type(raw: &str) -> &str {
    match raw {
        "event" | "event_bus" | "event_sub" | "event_subscription" => "event_listener",
        "cron" | "scheduled" | "timer" => "schedule",
        "poll" => "polling",
        "hook" | "http" | "web_hook" => "webhook",
        "watcher" | "fs_watcher" | "watch" => "file_watcher",
        "focus" | "window_focus" => "app_focus",
        other => other,
    }
}

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
        if !trimmed.is_empty() && serde_json::from_str::<serde_json::Value>(trimmed).is_err() {
            return vec![ValidationError::new(
                "config",
                "json",
                "Invalid config JSON",
            )];
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

                // C7 — when the build pipeline attached a smee.io channel URL,
                // validate format up front so a malformed URL fails build/promote
                // rather than silently being skipped at smee-relay-create time.
                if let Some(smee_url) = parsed.get("smee_channel_url").and_then(|v| v.as_str()) {
                    let trimmed = smee_url.trim();
                    if !trimmed.is_empty() && !trimmed.starts_with("https://smee.io/") {
                        errors.push(ValidationError::new(
                            "config.smee_channel_url",
                            "format",
                            "smee_channel_url must be an https://smee.io/ URL",
                        ));
                    }
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

/// Schedule triggers must declare either a `cron` expression or
/// `interval_seconds` — without one, `compute_next_from_config` returns `None`
/// forever and the trigger silently never fires. Reject the misconfiguration
/// at creation/update time so the failure is visible, not silent.
pub fn validate_schedule_has_cron_or_interval(
    trigger_type: &str,
    config: Option<&str>,
) -> Vec<ValidationError> {
    if trigger_type != "schedule" {
        return vec![];
    }
    let parsed = config
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok());

    let parsed = match parsed {
        Some(v) => v,
        None => {
            return vec![ValidationError::new(
                "config",
                "required",
                "Schedule triggers require a config with either a cron expression or interval_seconds",
            )];
        }
    };

    let cron = parsed
        .get("cron")
        .or_else(|| parsed.get("cron_expression"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let interval = parsed
        .get("interval_seconds")
        .and_then(|v| v.as_i64())
        .filter(|n| *n > 0);

    if cron.is_none() && interval.is_none() {
        return vec![ValidationError::new(
            "config",
            "required",
            "Schedule triggers require either a non-empty cron expression or a positive interval_seconds",
        )];
    }
    vec![]
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

// -- Tests --------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_validator_skips_non_schedule_types() {
        assert!(validate_schedule_has_cron_or_interval("manual", None).is_empty());
        assert!(validate_schedule_has_cron_or_interval("polling", Some("{}")).is_empty());
        assert!(validate_schedule_has_cron_or_interval("webhook", None).is_empty());
    }

    #[test]
    fn schedule_validator_rejects_missing_config() {
        assert_eq!(
            validate_schedule_has_cron_or_interval("schedule", None).len(),
            1
        );
        assert_eq!(
            validate_schedule_has_cron_or_interval("schedule", Some("")).len(),
            1
        );
        assert_eq!(
            validate_schedule_has_cron_or_interval("schedule", Some("   ")).len(),
            1
        );
    }

    #[test]
    fn schedule_validator_rejects_empty_object() {
        let errs = validate_schedule_has_cron_or_interval("schedule", Some("{}"));
        assert_eq!(errs.len(), 1);
    }

    #[test]
    fn schedule_validator_rejects_blank_cron_and_zero_interval() {
        assert_eq!(
            validate_schedule_has_cron_or_interval("schedule", Some(r#"{"cron": ""}"#)).len(),
            1
        );
        assert_eq!(
            validate_schedule_has_cron_or_interval("schedule", Some(r#"{"cron": "   "}"#)).len(),
            1
        );
        assert_eq!(
            validate_schedule_has_cron_or_interval("schedule", Some(r#"{"interval_seconds": 0}"#))
                .len(),
            1
        );
        assert_eq!(
            validate_schedule_has_cron_or_interval(
                "schedule",
                Some(r#"{"interval_seconds": -10}"#)
            )
            .len(),
            1
        );
    }

    #[test]
    fn schedule_validator_accepts_cron() {
        assert!(validate_schedule_has_cron_or_interval(
            "schedule",
            Some(r#"{"cron": "0 * * * *"}"#)
        )
        .is_empty());
        // Alternate key alias
        assert!(validate_schedule_has_cron_or_interval(
            "schedule",
            Some(r#"{"cron_expression": "0 * * * *"}"#)
        )
        .is_empty());
    }

    #[test]
    fn schedule_validator_accepts_interval() {
        assert!(validate_schedule_has_cron_or_interval(
            "schedule",
            Some(r#"{"interval_seconds": 60}"#)
        )
        .is_empty());
    }

    #[test]
    fn schedule_validator_accepts_both() {
        assert!(validate_schedule_has_cron_or_interval(
            "schedule",
            Some(r#"{"cron": "*/5 * * * *", "interval_seconds": 300}"#)
        )
        .is_empty());
    }
}

// -- Rule catalog -------------------------------------------------------------

pub fn rules() -> Vec<ValidationRule> {
    vec![
        ValidationRule::new(
            "trigger",
            "trigger_type",
            "allowed_values",
            "Must be a valid trigger type",
        )
        .with_allowed(VALID_TRIGGER_TYPES.iter().map(|s| s.to_string()).collect()),
        ValidationRule::new(
            "trigger",
            "config",
            "json",
            "Config must be valid JSON when provided",
        ),
        ValidationRule::new(
            "trigger",
            "config.interval_seconds",
            "range",
            format!("Must be at least {MIN_INTERVAL_SECONDS}"),
        )
        .with_min(MIN_INTERVAL_SECONDS as f64),
        ValidationRule::new(
            "trigger",
            "config.webhook_secret",
            "required",
            "Required for webhook triggers",
        ),
        ValidationRule::new(
            "trigger",
            "config.url",
            "url_safety",
            "Polling URLs must not target private/internal addresses",
        ),
    ]
}
