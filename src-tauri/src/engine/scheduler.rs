use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;

use crate::db::models::{PersonaTrigger, TriggerConfig};

use super::cron;

pub(crate) fn invalid_schedule_timezone(cfg: &TriggerConfig) -> Option<(String, String, String)> {
    match cfg {
        TriggerConfig::Schedule {
            cron: Some(cron_expr),
            timezone: Some(raw),
            ..
        } => raw
            .parse::<Tz>()
            .err()
            .map(|err| (cron_expr.clone(), raw.clone(), err.to_string())),
        _ => None,
    }
}

/// Compute the next trigger time from an already-parsed `TriggerConfig`.
/// Called by `compute_next_trigger_at` and also directly from `background.rs`
/// when `parse_config()` has already been called for other purposes.
///
/// `seed` is the deterministic hash used to expand any Jenkins-style `H`
/// tokens in the cron expression — pass [`cron::seed_hash`] of the trigger
/// id so two personas with the same `H/15` cron land on different minutes.
/// A zero seed collapses every `H` to its range minimum (top of the hour).
pub(crate) fn compute_next_from_config(
    cfg: &TriggerConfig,
    now: DateTime<Utc>,
    seed: u64,
) -> Option<String> {
    match cfg {
        TriggerConfig::Schedule {
            cron: Some(cron_expr),
            timezone,
            ..
        } => {
            let schedule = cron::parse_cron_seeded(cron_expr, seed).ok()?;
            let resolved_tz: Option<Tz> = match timezone.as_deref() {
                None => None,
                Some(raw) => match raw.parse::<Tz>() {
                    Ok(tz) => Some(tz),
                    Err(err) => {
                        tracing::warn!(
                            cron = %cron_expr,
                            timezone_raw = %raw,
                            error = %err,
                            "schedule timezone failed to parse; refusing to compute next fire time"
                        );
                        return None;
                    }
                },
            };
            let next = match resolved_tz {
                Some(tz) => cron::next_fire_time_in_tz(&schedule, now, tz)?,
                None => {
                    if timezone.is_none() {
                        // No timezone authored — falls back to system Local. This
                        // is the common case for triggers created before the TS
                        // ScheduleConfig type carried a `timezone` field, so we
                        // emit at debug to avoid flooding logs. Enable via
                        // RUST_LOG=personas_desktop=debug to audit which triggers
                        // are still on the implicit-local path.
                        tracing::debug!(
                            cron = %cron_expr,
                            "schedule has no timezone set; falling back to system-local"
                        );
                    }
                    cron::next_fire_time_local(&schedule, now)?
                }
            };
            Some(next.to_rfc3339())
        }
        TriggerConfig::Schedule {
            interval_seconds: Some(secs),
            ..
        } => {
            let next = now + Duration::seconds(*secs as i64);
            Some(next.to_rfc3339())
        }
        TriggerConfig::Polling {
            interval_seconds: Some(secs),
            ..
        } => {
            let next = now + Duration::seconds(*secs as i64);
            Some(next.to_rfc3339())
        }
        _ => None, // "manual", "webhook", "chain", and unknown have no scheduled next time
    }
}

/// Compute the next trigger time for a trigger based on its type and config.
/// Returns RFC3339 string or None. The trigger id is hashed and used to seed
/// Jenkins-style `H` token expansion in the cron expression so concurrent
/// triggers spread instead of all firing at `:00`.
pub fn compute_next_trigger_at(trigger: &PersonaTrigger, now: DateTime<Utc>) -> Option<String> {
    compute_next_from_config(&trigger.parse_config(), now, cron::seed_hash(&trigger.id))
}

/// Enumerate every cron or interval fire time that falls in the half-open
/// range `(start, end]`. Used by the user-initiated backfill flow that
/// retroactively replays missed schedules for a custom window — distinct
/// from the auto-backfill in `background.rs` which keys off
/// `last_triggered_at` and a per-trigger cap.
///
/// Returns at most `max_slots` slots (capped to a defensive upper bound so a
/// nightly cron over five years can't enqueue tens of thousands of events).
pub fn compute_slots_in_range(
    cfg: &TriggerConfig,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    seed: u64,
    max_slots: usize,
) -> Vec<DateTime<Utc>> {
    let cap = max_slots.min(crate::engine::limits::BACKFILL_HARD_CAP);
    let mut slots: Vec<DateTime<Utc>> = Vec::new();
    if end <= start || cap == 0 {
        return slots;
    }
    match cfg {
        TriggerConfig::Schedule {
            cron: Some(expr),
            timezone,
            ..
        } => {
            let Ok(schedule) = cron::parse_cron_seeded(expr, seed) else {
                return slots;
            };
            let tz = timezone
                .as_deref()
                .and_then(|s| s.parse::<chrono_tz::Tz>().ok());
            let mut from = start;
            while slots.len() < cap {
                let next = match tz {
                    Some(zone) => cron::next_fire_time_in_tz(&schedule, from, zone),
                    None => cron::next_fire_time_local(&schedule, from),
                };
                match next {
                    Some(t) if t <= end => {
                        slots.push(t);
                        from = t;
                    }
                    _ => break,
                }
            }
        }
        TriggerConfig::Schedule {
            interval_seconds: Some(secs),
            ..
        } => {
            if *secs == 0 {
                return slots;
            }
            let interval = Duration::seconds(*secs as i64);
            let mut t = start + interval;
            while t <= end && slots.len() < cap {
                slots.push(t);
                t += interval;
            }
        }
        _ => {}
    }
    slots
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
            status: "active".into(),
            last_triggered_at: None,
            next_trigger_at: None,
            trigger_version: 0,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            use_case_id: None,
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
    fn test_compute_next_schedule_with_timezone_summer() {
        // Repro from C5-handoff-2026-04-26: cron 0 7 * * * + America/New_York
        // around 2026-04-26 should land at 11:00 UTC (07:00 EDT, UTC-4),
        // not at 05:00 UTC (which is what the system Local fallback produced
        // on a Europe/Prague dev box).
        let trigger = make_trigger(
            "schedule",
            Some(r#"{"cron": "0 7 * * *", "timezone": "America/New_York"}"#),
        );
        let now = Utc.with_ymd_and_hms(2026, 4, 26, 22, 0, 0).unwrap();
        let next = compute_next_trigger_at(&trigger, now).unwrap();
        assert!(
            next.starts_with("2026-04-27T11:00:00"),
            "expected 2026-04-27T11:00:00 (07:00 EDT), got {next}"
        );
    }

    #[test]
    fn test_compute_next_schedule_with_invalid_timezone_refuses_schedule() {
        // Garbage timezone should not crash, but it must not silently fall back
        // to host-local time and fire at the wrong wall-clock hour.
        let trigger = make_trigger(
            "schedule",
            Some(r#"{"cron": "0 * * * *", "timezone": "Not/A_Real_Zone"}"#),
        );
        let now = Utc.with_ymd_and_hms(2026, 1, 15, 10, 30, 0).unwrap();
        assert!(compute_next_trigger_at(&trigger, now).is_none());
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

    #[test]
    fn test_compute_slots_in_range_cron() {
        // Every hour, 4-hour window — expect 4 slots
        let trigger = make_trigger("schedule", Some(r#"{"cron": "0 * * * *"}"#));
        let cfg = trigger.parse_config();
        let start = Utc.with_ymd_and_hms(2026, 1, 15, 10, 0, 0).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 1, 15, 14, 0, 0).unwrap();
        let slots = compute_slots_in_range(&cfg, start, end, 0, 100);
        assert_eq!(slots.len(), 4, "expected 4 hourly slots, got {slots:?}");
    }

    #[test]
    fn test_compute_slots_in_range_interval() {
        // Every 600s, 1-hour window — expect 6 slots
        let trigger = make_trigger("schedule", Some(r#"{"interval_seconds": 600}"#));
        let cfg = trigger.parse_config();
        let start = Utc.with_ymd_and_hms(2026, 1, 15, 10, 0, 0).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 1, 15, 11, 0, 0).unwrap();
        let slots = compute_slots_in_range(&cfg, start, end, 0, 100);
        assert_eq!(slots.len(), 6, "expected 6 interval slots, got {slots:?}");
    }

    #[test]
    fn test_compute_slots_in_range_caps_at_max() {
        // Every-minute cron over a 24h window would yield 1440 slots; cap to 50.
        let trigger = make_trigger("schedule", Some(r#"{"cron": "* * * * *"}"#));
        let cfg = trigger.parse_config();
        let start = Utc.with_ymd_and_hms(2026, 1, 15, 0, 0, 0).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 1, 16, 0, 0, 0).unwrap();
        let slots = compute_slots_in_range(&cfg, start, end, 0, 50);
        assert_eq!(slots.len(), 50);
    }

    #[test]
    fn test_compute_slots_in_range_empty_when_end_before_start() {
        let trigger = make_trigger("schedule", Some(r#"{"cron": "0 * * * *"}"#));
        let cfg = trigger.parse_config();
        let start = Utc.with_ymd_and_hms(2026, 1, 15, 14, 0, 0).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 1, 15, 10, 0, 0).unwrap();
        assert!(compute_slots_in_range(&cfg, start, end, 0, 100).is_empty());
    }

    #[test]
    fn test_compute_slots_in_range_non_schedule_returns_empty() {
        let trigger = make_trigger("manual", None);
        let cfg = trigger.parse_config();
        let start = Utc.with_ymd_and_hms(2026, 1, 15, 10, 0, 0).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 1, 15, 14, 0, 0).unwrap();
        assert!(compute_slots_in_range(&cfg, start, end, 0, 100).is_empty());
    }
}
