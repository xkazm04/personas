use super::contract::{ValidationError, ValidationRule};
use crate::models::TriggerKind;

/// The wire spellings of every storable trigger type, **derived from
/// [`TriggerKind`]** — the single source. Never spell a trigger type here (or
/// anywhere else) as a literal; call `TriggerKind::X.as_str()` so a rename is
/// one edit. Membership agreement with `TriggerKind::ALL` is asserted by
/// `valid_trigger_types_matches_all` in the test module below.
pub const VALID_TRIGGER_TYPES: &[&str] = &[
    TriggerKind::Manual.as_str(),
    TriggerKind::Schedule.as_str(),
    TriggerKind::Polling.as_str(),
    TriggerKind::Webhook.as_str(),
    TriggerKind::Chain.as_str(),
    TriggerKind::EventListener.as_str(),
    TriggerKind::FileWatcher.as_str(),
    TriggerKind::Clipboard.as_str(),
    TriggerKind::AppFocus.as_str(),
    TriggerKind::Composite.as_str(),
];

/// Floor for the cadence of the two *scheduled* kinds (`schedule`, `polling`),
/// which each cost a network call or an execution per tick.
///
/// It is deliberately NOT applied to the ambient kinds. `clipboard` and
/// `app_focus` poll a local OS handle every few seconds by design — the form
/// writes 5s and 3s respectively (`buildTriggerConfig.ts`) and
/// `engine/src/{clipboard_monitor,app_focus}.rs` are built for that cadence.
/// Applying the 60s floor to them (which this validator did for every trigger
/// type until 2026-08-17) makes every clipboard/app-focus trigger the form can
/// produce unsavable.
pub const MIN_INTERVAL_SECONDS: i64 = 60;

/// Floor for the ambient kinds (`clipboard`, `app_focus`) — a local poll, but
/// still not a spin loop.
pub const MIN_AMBIENT_INTERVAL_SECONDS: i64 = 1;

/// The interval floor that applies to `trigger_type`.
fn min_interval_for(trigger_type: &str) -> i64 {
    match TriggerKind::from_wire(trigger_type) {
        Some(TriggerKind::Clipboard) | Some(TriggerKind::AppFocus) => {
            MIN_AMBIENT_INTERVAL_SECONDS
        }
        _ => MIN_INTERVAL_SECONDS,
    }
}

/// Bounds for a composite trigger's look-back `window_seconds`. The composite
/// engine loads every event inside this window on every tick, so an unbounded
/// value degrades into a per-tick full-table scan plus a large allocation under
/// real event volume (starving the shared SQLite pool). Clamp to a sane range
/// at create/update so the misconfiguration is rejected up front; the engine
/// also clamps defensively for rows that predate this guard.
pub const MIN_COMPOSITE_WINDOW_SECONDS: i64 = 1;
pub const MAX_COMPOSITE_WINDOW_SECONDS: i64 = 86_400; // 24h

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
        // Fail CLOSED on malformed JSON. This used to be `if let Ok(parsed)`,
        // silently skipping every check below on a parse error — so a webhook
        // trigger created via the repo/build-session paths (which don't also
        // call validate_config_json) could bypass the webhook_secret HMAC
        // requirement, the interval floor, and the composite window clamp
        // just by carrying malformed config. LLM-generated configs are the
        // inputs most likely to be malformed.
        let parse_result = if config_str.trim().is_empty() {
            None
        } else {
            match serde_json::from_str::<serde_json::Value>(config_str) {
                Ok(parsed) => Some(parsed),
                Err(_) => {
                    errors.push(ValidationError::new("config", "json", "Invalid config JSON"));
                    return errors;
                }
            }
        };
        if let Some(parsed) = parse_result {
            let min_interval = min_interval_for(trigger_type);
            if let Some(interval) = parsed.get("interval_seconds") {
                match interval.as_i64() {
                    Some(n) if n < min_interval => {
                        errors.push(ValidationError::new(
                            "config.interval_seconds",
                            "range",
                            format!("interval_seconds must be at least {min_interval}"),
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

            // Composite triggers look back over `window_seconds`; the engine
            // pulls every event in that window into memory each tick, so an
            // unbounded value is a latent per-tick full-table scan. Reject
            // out-of-range / non-integer values up front.
            if let Some(window) = parsed.get("window_seconds") {
                match window.as_i64() {
                    Some(n)
                        if !(MIN_COMPOSITE_WINDOW_SECONDS..=MAX_COMPOSITE_WINDOW_SECONDS)
                            .contains(&n) =>
                    {
                        errors.push(ValidationError::new(
                            "config.window_seconds",
                            "range",
                            format!(
                                "window_seconds must be between {MIN_COMPOSITE_WINDOW_SECONDS} and {MAX_COMPOSITE_WINDOW_SECONDS} (24h)"
                            ),
                        ));
                    }
                    Some(_) => {}
                    None => {
                        errors.push(ValidationError::new(
                            "config.window_seconds",
                            "type",
                            "window_seconds must be a valid integer",
                        ));
                    }
                }
            }

            if trigger_type == "schedule" {
                for key in ["cron", "cron_expression"] {
                    if let Some(expr) = parsed.get(key).and_then(|v| v.as_str()) {
                        let trimmed = expr.trim();
                        if !trimmed.is_empty() {
                            if let Err(reason) = crate::cron::parse_cron(trimmed) {
                                errors.push(ValidationError::new(
                                    format!("config.{key}"),
                                    "cron",
                                    format!("Invalid cron expression: {reason}"),
                                ));
                            }
                        }
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
        } else if trigger_type == "webhook" {
            // Present-but-empty config: same contract as absent config.
            errors.push(ValidationError::new(
                "config",
                "required",
                "Webhook triggers require a config with a non-empty webhook_secret",
            ));
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

/// Stable prefix of the "born dead" refusal, so the frontend error registry can
/// match it without depending on the reason text. Keep in step with the rule in
/// `src/lib/errors/errorRegistry.ts` and `src/i18n/useTranslatedError.ts`.
pub const UNSCHEDULABLE_PREFIX: &str = "This trigger would never fire";

/// The refusal a creation path raises when a **time-based** trigger
/// (`TriggerKind::is_time_based`) parses cleanly but
/// `scheduler::compute_next_from_config` still returns `None` — meaning the row
/// would be written with `next_trigger_at IS NULL`, which `get_due` skips
/// forever. That is the single largest way a trigger is born dead in this app
/// (37 of the operator's 351 live rows), and it is silent: the row renders
/// `armed` and simply never runs.
///
/// The message NAMES the reason, so a refused creation tells the user what to
/// change instead of "Something went wrong."
pub fn unschedulable_error(trigger_type: &str, config: Option<&str>) -> ValidationError {
    let parsed: Option<serde_json::Value> = config
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .and_then(|c| serde_json::from_str(c).ok());

    let get_str = |key: &str| -> Option<String> {
        parsed
            .as_ref()?
            .get(key)?
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    let has_interval = parsed
        .as_ref()
        .and_then(|v| v.get("interval_seconds"))
        .and_then(|v| v.as_i64())
        .is_some_and(|n| n > 0);

    let reason = if trigger_type == TriggerKind::Polling.as_str() {
        if has_interval {
            "its polling interval could not be read as a positive number of seconds".to_string()
        } else {
            "it has no polling interval, so nothing ever schedules the next fetch".to_string()
        }
    } else {
        // schedule
        let cron = get_str("cron").or_else(|| get_str("cron_expression"));
        match (cron, get_str("timezone"), has_interval) {
            (Some(_), Some(tz), _) => format!(
                "its timezone \"{tz}\" is not a valid IANA zone name (for example \"Europe/Prague\"), so the cron expression cannot be resolved to a wall-clock time"
            ),
            (Some(expr), None, _) => format!(
                "its cron expression \"{expr}\" has no future fire time"
            ),
            (None, _, true) => "its interval could not be read as a positive number of seconds"
                .to_string(),
            (None, _, false) => {
                "it declares neither a cron expression nor an interval, so there is no next run to schedule".to_string()
            }
        }
    };

    ValidationError::new(
        "config",
        "unschedulable",
        format!("{UNSCHEDULABLE_PREFIX}: {reason}."),
    )
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
            if let Err(reason) = crate::url_safety::validate_url_safety(&u) {
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
    fn valid_trigger_types_matches_all() {
        // The two lists are the ONLY places the vocabulary's membership is
        // written down. This asserts they agree — a variant added to
        // `TriggerKind` (and therefore to `TriggerKind::ALL`) but not to
        // `VALID_TRIGGER_TYPES` fails here, and vice versa.
        let from_enum: Vec<&str> = TriggerKind::ALL.iter().map(|k| k.as_str()).collect();
        assert_eq!(
            from_enum, VALID_TRIGGER_TYPES,
            "VALID_TRIGGER_TYPES drifted from TriggerKind::ALL"
        );
    }

    #[test]
    fn every_kind_round_trips_through_the_wire() {
        for kind in TriggerKind::ALL {
            assert_eq!(
                TriggerKind::from_wire(kind.as_str()),
                Some(*kind),
                "{} did not round-trip",
                kind.as_str()
            );
            assert!(validate_trigger_type(kind.as_str()).is_empty());
        }
        assert_eq!(TriggerKind::from_wire("nope"), None);
    }

    #[test]
    fn sql_check_list_covers_the_whole_vocabulary() {
        let list = TriggerKind::sql_check_list();
        for kind in TriggerKind::ALL {
            assert!(
                list.contains(&format!("'{}'", kind.as_str())),
                "CHECK list is missing {}",
                kind.as_str()
            );
        }
        // Exactly one quoted member per kind — no stragglers.
        assert_eq!(list.matches('\'').count(), TriggerKind::ALL.len() * 2);
    }

    #[test]
    fn only_schedule_and_polling_are_time_based() {
        // `is_time_based` decides whether a NULL `next_trigger_at` is a defect
        // or simply not applicable, so it must track
        // `scheduler::compute_next_from_config`, which returns Some(_) for
        // exactly these two.
        for kind in TriggerKind::ALL {
            let expected =
                matches!(kind, TriggerKind::Schedule | TriggerKind::Polling);
            assert_eq!(
                kind.is_time_based(),
                expected,
                "{} changed its time-based classification. This predicate is \
                 mirrored on the client in \
                 src/features/triggers/sub_triggers/triggerArmState.ts \
                 (TIME_BASED_KINDS) — update that set in the same change, or \
                 the badge will stop telling the user their trigger can never \
                 fire.",
                kind.as_str()
            );
        }
    }

    #[test]
    fn ambient_kinds_keep_their_sub_minute_cadence() {
        // The Add-trigger form writes 5s (clipboard) and 3s (app_focus); the
        // 60s floor is for the two kinds that cost a network call or an
        // execution per tick. Applying it to the ambient kinds made every
        // clipboard/app_focus trigger the form can produce unsavable.
        assert!(validate_config("clipboard", Some(r#"{"interval_seconds": 5}"#)).is_empty());
        assert!(validate_config("app_focus", Some(r#"{"interval_seconds": 3}"#)).is_empty());
        assert!(validate_config("clipboard", Some(r#"{"interval_seconds": 0}"#)).len() == 1);

        // …and the floor still holds where it matters.
        assert_eq!(
            validate_config("polling", Some(r#"{"interval_seconds": 5}"#)).len(),
            1
        );
        assert_eq!(
            validate_config("schedule", Some(r#"{"interval_seconds": 5}"#)).len(),
            1
        );
    }

    #[test]
    fn unschedulable_error_names_the_reason() {
        let bad_tz = unschedulable_error(
            "schedule",
            Some(r#"{"cron": "0 9 * * *", "timezone": "local"}"#),
        );
        assert_eq!(bad_tz.rule, "unschedulable");
        assert!(bad_tz.message.starts_with(UNSCHEDULABLE_PREFIX));
        assert!(bad_tz.message.contains("local"));
        assert!(bad_tz.message.contains("IANA"));

        let no_timing = unschedulable_error("schedule", Some("{}"));
        assert!(no_timing.message.contains("neither a cron expression nor an interval"));

        let no_interval = unschedulable_error("polling", Some(r#"{"url": "https://x.test"}"#));
        assert!(no_interval.message.contains("no polling interval"));
    }

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
    fn malformed_config_fails_closed() {
        // Fail closed: unparseable JSON must produce an error from
        // validate_config itself, not rely on callers also invoking
        // validate_config_json (the repo + build-session paths don't).
        let errs = validate_config("webhook", Some("{not json"));
        assert!(errs.iter().any(|e| e.field == "config" && e.rule == "json"));

        // Present-but-empty config is rejected like absent config.
        let errs = validate_config("webhook", Some("   "));
        assert!(errs.iter().any(|e| e.rule == "required"));
    }

    #[test]
    fn schedule_config_rejects_invalid_cron() {
        let errs = validate_config("schedule", Some(r#"{"cron": "* * *"}"#));
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].field, "config.cron");
    }

    #[test]
    fn schedule_config_accepts_every_minute_cron_floor() {
        assert!(validate_config("schedule", Some(r#"{"cron": "* * * * *"}"#)).is_empty());
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
    fn composite_window_seconds_within_range_ok() {
        assert!(validate_config("composite", Some(r#"{"window_seconds": 300}"#)).is_empty());
        assert!(validate_config("composite", Some(r#"{"window_seconds": 1}"#)).is_empty());
        assert!(validate_config("composite", Some(r#"{"window_seconds": 86400}"#)).is_empty());
    }

    #[test]
    fn composite_window_seconds_out_of_range_rejected() {
        let too_big = validate_config("composite", Some(r#"{"window_seconds": 86401}"#));
        assert_eq!(too_big.len(), 1);
        assert_eq!(too_big[0].field, "config.window_seconds");
        assert_eq!(too_big[0].rule, "range");

        let zero = validate_config("composite", Some(r#"{"window_seconds": 0}"#));
        assert_eq!(zero.len(), 1);
        assert_eq!(zero[0].field, "config.window_seconds");
    }

    #[test]
    fn composite_window_seconds_non_integer_rejected() {
        let errs = validate_config("composite", Some(r#"{"window_seconds": "300"}"#));
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].field, "config.window_seconds");
        assert_eq!(errs[0].rule, "type");
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
