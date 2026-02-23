use chrono::{DateTime, Duration, Utc};

use crate::db::models::{PersonaTrigger, TriggerConfig};

use super::cron;

/// Compute the next trigger time from an already-parsed `TriggerConfig`.
/// Called by `compute_next_trigger_at` and also directly from `background.rs`
/// when `parse_config()` has already been called for other purposes.
pub(crate) fn compute_next_from_config(cfg: &TriggerConfig, now: DateTime<Utc>) -> Option<String> {
    match cfg {
        TriggerConfig::Schedule { cron: Some(cron_expr), .. } => {
            let schedule = cron::parse_cron(cron_expr).ok()?;
            let next = cron::next_fire_time(&schedule, now)?;
            Some(next.to_rfc3339())
        }
        TriggerConfig::Polling { interval_seconds: Some(secs), .. } => {
            let next = now + Duration::seconds(*secs as i64);
            Some(next.to_rfc3339())
        }
        _ => None, // "manual", "webhook", "chain", and unknown have no scheduled next time
    }
}

/// Compute the next trigger time for a trigger based on its type and config.
/// Returns RFC3339 string or None.
pub fn compute_next_trigger_at(trigger: &PersonaTrigger, now: DateTime<Utc>) -> Option<String> {
    compute_next_from_config(&trigger.parse_config(), now)
}

/// Extract the event_type from a trigger's config. Default: "trigger_fired".
pub fn trigger_event_type(trigger: &PersonaTrigger) -> String {
    trigger.parse_config().event_type().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn make_trigger(trigger_type: &str, config: Option<&str>) -> PersonaTrigger {
        PersonaTrigger {
            id: "t1".into(),
            persona_id: "p1".into(),
            trigger_type: trigger_type.into(),
            config: config.map(String::from),
            enabled: true,
            last_triggered_at: None,
            next_trigger_at: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn test_compute_next_schedule_trigger() {
        let trigger = make_trigger("schedule", Some(r#"{"cron": "0 * * * *"}"#));
        let now = Utc.with_ymd_and_hms(2026, 1, 15, 10, 30, 0).unwrap();
        let next = compute_next_trigger_at(&trigger, now).unwrap();
        assert!(next.contains("11:00:00"));
    }

    #[test]
    fn test_compute_next_polling_trigger() {
        let trigger = make_trigger("polling", Some(r#"{"interval_seconds": 300}"#));
        let now = Utc.with_ymd_and_hms(2026, 1, 15, 10, 30, 0).unwrap();
        let next = compute_next_trigger_at(&trigger, now).unwrap();
        assert!(next.contains("10:35:00"));
    }

    #[test]
    fn test_compute_next_manual_trigger() {
        let trigger = make_trigger("manual", None);
        let now = Utc::now();
        assert!(compute_next_trigger_at(&trigger, now).is_none());
    }

    #[test]
    fn test_compute_next_webhook_trigger() {
        let trigger = make_trigger("webhook", None);
        let now = Utc::now();
        assert!(compute_next_trigger_at(&trigger, now).is_none());
    }

    #[test]
    fn test_compute_next_invalid_cron() {
        let trigger = make_trigger("schedule", Some(r#"{"cron": "bad cron"}"#));
        let now = Utc::now();
        assert!(compute_next_trigger_at(&trigger, now).is_none());
    }

    #[test]
    fn test_trigger_event_type_default() {
        let trigger = make_trigger("polling", Some(r#"{"interval_seconds": 60}"#));
        assert_eq!(trigger_event_type(&trigger), "trigger_fired");
    }

    #[test]
    fn test_trigger_event_type_custom() {
        let trigger = make_trigger(
            "polling",
            Some(r#"{"interval_seconds": 60, "event_type": "build_check"}"#),
        );
        assert_eq!(trigger_event_type(&trigger), "build_check");
    }
}
