use super::*;
use std::sync::atomic::Ordering;
use std::time::Duration;

#[test]
fn test_scheduler_state_initial() {
    let state = SchedulerState::new();
    assert!(!state.is_running());
    assert!(!state.is_active());
    let stats = state.stats();
    assert!(!stats.running);
    assert_eq!(stats.events_processed, 0);
    assert_eq!(stats.triggers_fired, 0);
    assert_eq!(stats.queue_rejections, 0);
    assert_eq!(stats.subscriptions_crashed, 0);
}

// ========================================================================
// Cron budget gate parity with the canonical manual/preview gate
// (executions.rs). Regression coverage for idea-c0734d28: the old bespoke
// inline SQL had no `budget > 0.0` guard, so a persona with max_budget_usd
// = 0.0 (a legal "unlimited" value) was ALWAYS reported over budget and
// silently paused, diverging from the manual run path.
// ========================================================================

#[test]
fn schedule_over_budget_treats_zero_as_unlimited() {
    // 0.0 is a legal budget meaning "unlimited" — never over budget,
    // even when spend is positive.
    assert!(!schedule_over_budget(Some(0.0), 0.0));
    assert!(!schedule_over_budget(Some(0.0), 12.34));
}

#[test]
fn schedule_over_budget_none_is_unlimited() {
    // No budget set → unlimited, regardless of spend.
    assert!(!schedule_over_budget(None, 0.0));
    assert!(!schedule_over_budget(None, 999.0));
}

#[test]
fn schedule_over_budget_positive_cap_enforced() {
    assert!(!schedule_over_budget(Some(10.0), 9.99)); // under cap → runs
    assert!(schedule_over_budget(Some(10.0), 10.0)); // at cap (>=) → paused
    assert!(schedule_over_budget(Some(10.0), 10.01)); // over cap → paused
}

// ========================================================================
// Fix 3: trigger_fired payload enrichment
// ========================================================================

fn make_trigger_for_test(
    id: &str,
    persona_id: &str,
    trigger_type: &str,
) -> crate::db::models::PersonaTrigger {
    crate::db::models::PersonaTrigger {
        id: id.into(),
        persona_id: persona_id.into(),
        trigger_type: trigger_type.into(),
        config: None,
        enabled: true,
        status: "active".into(),
        last_triggered_at: None,
        next_trigger_at: None,
        trigger_version: 0,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        use_case_id: None,
        unattended_mode: "auto".into(),
    }
}

#[test]
fn test_fix3_synthesize_payload_schedule_cron() {
    use crate::db::models::TriggerConfig;
    let trigger = make_trigger_for_test("t-cron-1", "p-alice", "schedule");
    let cfg = TriggerConfig::Schedule {
        cron: Some("*/15 * * * *".into()),
        interval_seconds: None,
        timezone: None,
        max_backfill: None,
        event_type: None,
        payload: None,
    };
    let json = synthesize_trigger_fired_payload(&trigger, &cfg, "2026-04-08T16:30:00Z");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["trigger_id"], "t-cron-1");
    assert_eq!(v["trigger_type"], "schedule");
    assert_eq!(v["target_persona_id"], "p-alice");
    assert_eq!(v["fired_at"], "2026-04-08T16:30:00Z");
    assert_eq!(v["cron"], "*/15 * * * *");
    assert!(
        v.get("interval_seconds").is_none(),
        "no interval for cron-based schedules",
    );
}

#[test]
fn test_fix3_synthesize_payload_polling_interval() {
    use crate::db::models::TriggerConfig;
    let trigger = make_trigger_for_test("t-poll-1", "p-bob", "polling");
    let cfg = TriggerConfig::Polling {
        url: Some("https://example.com/api".into()),
        headers: None,
        content_hash: None,
        interval_seconds: Some(300),
        event_type: None,
        payload: None,
    };
    let json = synthesize_trigger_fired_payload(&trigger, &cfg, "2026-04-08T16:30:00Z");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["trigger_id"], "t-poll-1");
    assert_eq!(v["trigger_type"], "polling");
    assert_eq!(v["interval_seconds"], 300);
    assert!(v.get("cron").is_none());
}

#[test]
fn test_fix3_synthesize_payload_webhook_no_cadence() {
    use crate::db::models::TriggerConfig;
    let trigger = make_trigger_for_test("t-wh-1", "p-carol", "webhook");
    let cfg = TriggerConfig::Webhook {
        webhook_secret: None,
        event_type: None,
        payload: None,
        smee_channel_url: None,
        smee_event_filter: None,
    };
    let json = synthesize_trigger_fired_payload(&trigger, &cfg, "2026-04-08T16:30:00Z");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    // Core fields still present even without cron/interval
    assert_eq!(v["trigger_id"], "t-wh-1");
    assert_eq!(v["trigger_type"], "webhook");
    assert_eq!(v["target_persona_id"], "p-carol");
    assert!(v.get("cron").is_none());
    assert!(v.get("interval_seconds").is_none());
}

#[test]
fn test_fix3_synthesize_payload_includes_use_case_id_when_set() {
    use crate::db::models::TriggerConfig;
    let mut trigger = make_trigger_for_test("t-uc-1", "p-d", "schedule");
    trigger.use_case_id = Some("usecase-42".into());
    let cfg = TriggerConfig::Schedule {
        cron: Some("0 * * * *".into()),
        interval_seconds: None,
        timezone: None,
        max_backfill: None,
        event_type: None,
        payload: None,
    };
    let json = synthesize_trigger_fired_payload(&trigger, &cfg, "2026-04-08T16:30:00Z");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["use_case_id"], "usecase-42");
}

// -- Backfill ----------------------------------------------------------

#[test]
fn test_backfill_interval_three_missed_drops_most_recent() {
    // Interval 3600s (every hour). Last fired 09:00, now 12:30.
    // Slots strictly after 09:00 and ≤ 12:30: 10:00, 11:00, 12:00.
    // The function drops the MOST-RECENT slot (12:00) — that one is
    // fired by the existing scheduler tick path. Returns [10:00, 11:00].
    use crate::db::models::TriggerConfig;
    use chrono::{TimeZone, Timelike};
    let cfg = TriggerConfig::Schedule {
        cron: None,
        interval_seconds: Some(3600),
        timezone: None,
        max_backfill: Some(10),
        event_type: None,
        payload: None,
    };
    let last = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 9, 0, 0).unwrap();
    let now = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 30, 0).unwrap();
    let slots = compute_missed_backfill_slots(&cfg, last, now, 0);
    assert_eq!(slots.len(), 2, "expected [10:00, 11:00] (12:00 dropped)");
    assert_eq!(slots[0].hour(), 10);
    assert_eq!(slots[1].hour(), 11);
}

#[test]
fn test_backfill_interval_no_misses_returns_empty() {
    use crate::db::models::TriggerConfig;
    use chrono::TimeZone;
    let cfg = TriggerConfig::Schedule {
        cron: None,
        interval_seconds: Some(3600),
        timezone: None,
        max_backfill: Some(10),
        event_type: None,
        payload: None,
    };
    let last = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 0, 0).unwrap();
    let now = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 30, 0).unwrap();
    // Next slot is 13:00 — past `now`, so no missed slots.
    let slots = compute_missed_backfill_slots(&cfg, last, now, 0);
    assert!(slots.is_empty());
}

#[test]
fn test_backfill_cron_returns_extras_only() {
    // Cron 0 * * * * (top of every hour). Last fired 09:00, now 12:30.
    // Slots ≤ 12:30: 10:00, 11:00, 12:00. Function drops 12:00, returns
    // [10:00, 11:00].
    use crate::db::models::TriggerConfig;
    use chrono::{TimeZone, Timelike};
    let cfg = TriggerConfig::Schedule {
        cron: Some("0 * * * *".into()),
        interval_seconds: None,
        timezone: Some("UTC".into()),
        max_backfill: Some(10),
        event_type: None,
        payload: None,
    };
    let last = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 9, 0, 0).unwrap();
    let now = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 30, 0).unwrap();
    let slots = compute_missed_backfill_slots(&cfg, last, now, 0);
    assert_eq!(slots.len(), 2);
    assert_eq!(slots[0].hour(), 10);
    assert_eq!(slots[1].hour(), 11);
}

// ========================================================================
// Direction 1: discarded-while-offline count. The tick fires ONE live slot
// and (optionally) some backfill extras; every OTHER missed slot in the gap
// is discarded. `discarded = missed_total - backfill_emitted_for_trigger`,
// where `missed_total = compute_missed_backfill_slots(...).len()`.
// ========================================================================

#[test]
fn test_discarded_default_cap_drops_all_older_slots() {
    // DEFAULT single-catch-up (backfill_cap == 1 → 0 extras emitted). A
    // daily job whose app was closed across an 8-hour gap of an hourly cron:
    // 8 slots after 04:00 up to 12:30 → compute drops the live (12:00) → 7
    // older slots. With 0 backfill extras all 7 are discarded.
    use crate::db::models::TriggerConfig;
    use chrono::TimeZone;
    let cfg = TriggerConfig::Schedule {
        cron: Some("0 * * * *".into()),
        interval_seconds: None,
        timezone: Some("UTC".into()),
        max_backfill: None, // default → cap 1 → 0 extras
        event_type: None,
        payload: None,
    };
    let last = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 4, 0, 0).unwrap();
    let now = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 30, 0).unwrap();
    let missed_total = compute_missed_backfill_slots(&cfg, last, now, 0).len();
    assert_eq!(missed_total, 7, "05:00..=11:00 older slots (12:00 is live)");
    let backfill_emitted_for_trigger = 0usize; // cap == 1
    let discarded = missed_total.saturating_sub(backfill_emitted_for_trigger);
    assert_eq!(discarded, 7);
}

#[test]
fn test_discarded_partial_cap_reduces_count() {
    // With max_backfill = 4 the tick replays up to (cap-1)=3 extras; the
    // remaining older slots are discarded. Same 7-slot gap → 3 replayed,
    // 4 discarded.
    use crate::db::models::TriggerConfig;
    use chrono::TimeZone;
    let cfg = TriggerConfig::Schedule {
        cron: Some("0 * * * *".into()),
        interval_seconds: None,
        timezone: Some("UTC".into()),
        max_backfill: Some(4),
        event_type: None,
        payload: None,
    };
    let last = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 4, 0, 0).unwrap();
    let now = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 30, 0).unwrap();
    let missed_total = compute_missed_backfill_slots(&cfg, last, now, 0).len();
    assert_eq!(missed_total, 7);
    let backfill_emitted_for_trigger = 3usize; // (cap - 1), budget permitting
    let discarded = missed_total.saturating_sub(backfill_emitted_for_trigger);
    assert_eq!(discarded, 4);
}

#[test]
fn test_discarded_none_when_no_gap() {
    // Continuously-running scheduler: last fire is the previous slot, so
    // there is no older gap → 0 missed → 0 discarded (no record/emit).
    use crate::db::models::TriggerConfig;
    use chrono::TimeZone;
    let cfg = TriggerConfig::Schedule {
        cron: Some("0 * * * *".into()),
        interval_seconds: None,
        timezone: Some("UTC".into()),
        max_backfill: None,
        event_type: None,
        payload: None,
    };
    let last = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 0, 0).unwrap();
    let now = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 30, 0).unwrap();
    let missed_total = compute_missed_backfill_slots(&cfg, last, now, 0).len();
    assert_eq!(missed_total, 0);
    assert_eq!(missed_total.saturating_sub(0), 0);
}

#[test]
fn test_backfill_hard_cap_protects_against_amplification() {
    // Interval 60s (every minute). 4 hours of downtime = 240 missed
    // slots. Hard cap is 100. Function returns at most 100 slots minus
    // the most-recent (so 99 here — but the cap is on enumeration, not
    // on the output, so we expect exactly cap-1 entries after the pop).
    use crate::db::models::TriggerConfig;
    use chrono::TimeZone;
    let cfg = TriggerConfig::Schedule {
        cron: None,
        interval_seconds: Some(60),
        timezone: None,
        max_backfill: Some(500),
        event_type: None,
        payload: None,
    };
    let last = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 8, 0, 0).unwrap();
    let now = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 0, 0).unwrap();
    let slots = compute_missed_backfill_slots(&cfg, last, now, 0);
    // Internally the loop stops at BACKFILL_HARD_CAP=100 entries before
    // popping the most-recent — so output is 99.
    assert_eq!(slots.len(), 99);
}

#[test]
fn test_backfill_non_schedule_returns_empty() {
    use crate::db::models::TriggerConfig;
    use chrono::TimeZone;
    let cfg = TriggerConfig::Manual {
        event_type: None,
        payload: None,
    };
    let last = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 9, 0, 0).unwrap();
    let now = chrono::Utc.with_ymd_and_hms(2026, 5, 1, 12, 30, 0).unwrap();
    assert!(compute_missed_backfill_slots(&cfg, last, now, 0).is_empty());
}

#[test]
fn test_backfill_payload_marks_slot() {
    use crate::db::models::TriggerConfig;
    let trigger = make_trigger_for_test("t-bf-1", "p-x", "schedule");
    let cfg = TriggerConfig::Schedule {
        cron: Some("0 * * * *".into()),
        interval_seconds: None,
        timezone: None,
        max_backfill: Some(5),
        event_type: None,
        payload: None,
    };
    let json = synthesize_backfill_payload(&trigger, &cfg, "2026-05-01T10:00:00Z");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(
        v["backfill_slot"], true,
        "backfill events must self-identify"
    );
    assert_eq!(v["fired_at"], "2026-05-01T10:00:00Z");
    assert_eq!(v["cron"], "0 * * * *");
    assert_eq!(v["trigger_id"], "t-bf-1");
}

#[test]
fn test_overlap_skip_payload_shape() {
    // Direction 2: the overlap-skip signal must self-identify with the
    // trigger, a machine-readable reason, and a timestamp so the event feed
    // can render "skipped — previous run still active".
    let trigger = make_trigger_for_test("t-ov-1", "p-y", "schedule");
    let json = synthesize_overlap_skip_payload(&trigger, "2026-05-01T10:00:00Z");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["trigger_id"], "t-ov-1");
    assert_eq!(v["target_persona_id"], "p-y");
    assert_eq!(v["reason"], "previous_run_active");
    assert_eq!(v["skipped_at"], "2026-05-01T10:00:00Z");
}

#[test]
fn test_scheduler_state_toggle() {
    let state = SchedulerState::new();
    state.running.store(true, Ordering::Relaxed);
    assert!(state.is_running());
    state.running.store(false, Ordering::Relaxed);
    assert!(!state.is_running());
}

/// Finding #1 regression pin (double-start CAS): two "concurrent" start
/// attempts must not both succeed. Without `try_begin_start`'s CAS, a
/// naive check-then-set (mirroring the old `is_running()` then
/// `running.store(true, ...)` pattern) lets both callers observe
/// `is_running() == false` and both proceed to spawn a full subscription
/// set -- doubling every trigger fire and OAuth refresh from then on.
#[test]
fn test_try_begin_start_rejects_concurrent_double_start() {
    let state = SchedulerState::new();
    assert!(!state.is_running());

    let first = state.try_begin_start();
    assert_eq!(
        first,
        Some(1),
        "first start should succeed and claim generation 1"
    );
    assert!(state.is_running());

    // A second start attempt while still running (simulating a racing
    // caller) must be rejected, not silently succeed.
    let second = state.try_begin_start();
    assert_eq!(
        second, None,
        "a second start while already running must be rejected by the CAS"
    );
}

/// Finding #1 regression pin (orphaned subscription loop survives a
/// restart): `stop_loops` must retire the generation, not just flip the
/// `running` bool. If it only flipped the bool, a loop spawned under the
/// pre-stop generation and still ticking (its JoinHandle was dropped, not
/// aborted) would see `running` flip back to `true` on the next start and
/// wrongly conclude it's still current -- this test asserts the
/// generation actually changes across a stop+restart cycle so a loop
/// comparing its captured generation against a fresh load correctly
/// detects it is stale.
#[test]
fn test_stop_loops_retires_generation_so_orphan_loops_detect_staleness() {
    let state = SchedulerState::new();
    let gen1 = state.try_begin_start().expect("first start succeeds");
    assert_eq!(state.generation(), gen1);

    // Simulate a subscription loop spawned under gen1: it captured gen1
    // and would keep polling as long as `gen1 == state.generation()`.
    stop_loops(&state);
    assert!(!state.is_running());
    assert_ne!(
        state.generation(),
        gen1,
        "stop_loops must bump the generation so orphaned gen1 loops retire"
    );

    // A restart must claim a NEW generation distinct from gen1 -- proving
    // the orphaned loop's captured gen1 can never match again, even
    // though `running` is now back to true (the exact condition that
    // previously fooled a bare `is_running()` check).
    let gen2 = state
        .try_begin_start()
        .expect("restart succeeds after stop");
    assert!(state.is_running());
    assert_ne!(gen2, gen1, "restart must claim a fresh generation");
    assert_eq!(
        state.generation(),
        gen2,
        "orphan loops comparing captured gen1 against this load correctly see a mismatch"
    );
}

#[test]
fn test_scheduler_active_flag() {
    let state = SchedulerState::new();
    assert!(!state.is_active());
    state.set_active(true);
    assert!(state.is_active());
    state.set_active(false);
    assert!(!state.is_active());
}

#[test]
fn test_scheduler_stats_atomic() {
    let state = SchedulerState::new();
    state.events_processed.fetch_add(5, Ordering::Relaxed);
    state.events_delivered.fetch_add(3, Ordering::Relaxed);
    state.events_failed.fetch_add(2, Ordering::Relaxed);
    state.triggers_fired.fetch_add(7, Ordering::Relaxed);
    let stats = state.stats();
    assert_eq!(stats.events_processed, 5);
    assert_eq!(stats.events_delivered, 3);
    assert_eq!(stats.events_failed, 2);
    assert_eq!(stats.triggers_fired, 7);
}

#[test]
fn test_tick_latency_recording() {
    let state = SchedulerState::new();

    // Record a normal tick (under interval)
    state.record_tick_latency(
        "event_bus",
        Duration::from_secs(2),
        Duration::from_millis(50),
    );
    let health = state.subscription_health();
    assert_eq!(health.len(), 1);
    let h = &health[0];
    assert_eq!(h.name, "event_bus");
    assert_eq!(h.last_tick_duration_ms, 50);
    assert_eq!(h.max_tick_duration_ms, 50);
    assert_eq!(h.tick_count, 1);
    assert_eq!(h.error_count, 0);
    assert_eq!(h.consecutive_panics, 0);
    assert_eq!(h.avg_tick_duration_ms, 50);
    assert!(h.last_tick_at.is_some());
    assert!(!h.overrun);
    assert_eq!(h.overrun_count, 0);
    assert_eq!(h.slow_tick_count, 0);

    // Record an overrun tick
    state.record_tick_latency(
        "event_bus",
        Duration::from_secs(2),
        Duration::from_millis(3000),
    );
    let health = state.subscription_health();
    let h = health.iter().find(|l| l.name == "event_bus").unwrap();
    assert_eq!(h.last_tick_duration_ms, 3000);
    assert_eq!(h.max_tick_duration_ms, 3000);
    assert_eq!(h.tick_count, 2);
    assert_eq!(h.avg_tick_duration_ms, (50 + 3000) / 2);
    assert!(h.overrun);
    assert_eq!(h.overrun_count, 1);

    // Record a smaller tick — max should stay at 3000
    state.record_tick_latency(
        "event_bus",
        Duration::from_secs(2),
        Duration::from_millis(100),
    );
    let health = state.subscription_health();
    let h = health.iter().find(|l| l.name == "event_bus").unwrap();
    assert_eq!(h.last_tick_duration_ms, 100);
    assert_eq!(h.max_tick_duration_ms, 3000);
    assert_eq!(h.tick_count, 3);
    assert!(!h.overrun);
    assert_eq!(h.overrun_count, 1); // still 1 from previous overrun
}

#[test]
fn test_slow_tick_counting() {
    let state = SchedulerState::new();

    // interval=2000ms, 80% threshold=1600ms

    // 1500ms — under threshold, not slow
    state.record_tick_latency(
        "poller",
        Duration::from_secs(2),
        Duration::from_millis(1500),
    );
    let h = state
        .subscription_health()
        .into_iter()
        .find(|h| h.name == "poller")
        .unwrap();
    assert_eq!(h.slow_tick_count, 0);
    assert_eq!(h.overrun_count, 0);

    // 1700ms — above 80% threshold but under interval, counts as slow
    state.record_tick_latency(
        "poller",
        Duration::from_secs(2),
        Duration::from_millis(1700),
    );
    let h = state
        .subscription_health()
        .into_iter()
        .find(|h| h.name == "poller")
        .unwrap();
    assert_eq!(h.slow_tick_count, 1);
    assert_eq!(h.overrun_count, 0);

    // 2500ms — overrun, does NOT also count as slow (only overrun)
    state.record_tick_latency(
        "poller",
        Duration::from_secs(2),
        Duration::from_millis(2500),
    );
    let h = state
        .subscription_health()
        .into_iter()
        .find(|h| h.name == "poller")
        .unwrap();
    assert_eq!(h.slow_tick_count, 1); // unchanged
    assert_eq!(h.overrun_count, 1);
}

#[test]
fn test_queue_rejection_counter() {
    let state = SchedulerState::new();
    assert_eq!(state.stats().queue_rejections, 0);
    state.record_queue_rejection();
    state.record_queue_rejection();
    state.record_queue_rejection();
    assert_eq!(state.stats().queue_rejections, 3);
}

#[test]
fn test_stats_includes_subscription_health() {
    let state = SchedulerState::new();
    state.record_tick_latency(
        "cleanup",
        Duration::from_secs(3600),
        Duration::from_millis(200),
    );
    let stats = state.stats();
    assert_eq!(stats.subscription_health.len(), 1);
    assert_eq!(stats.subscription_health[0].name, "cleanup");
    assert_eq!(stats.subscription_health[0].tick_count, 1);
}

#[test]
fn test_subscription_crash_counter() {
    let state = SchedulerState::new();
    assert_eq!(state.stats().subscriptions_crashed, 0);
    state.record_subscription_crash("event_bus");
    state.record_subscription_crash("oauth_refresh");
    state.record_subscription_crash("event_bus");
    assert_eq!(state.stats().subscriptions_crashed, 3);
}

#[test]
fn test_per_subscription_crash_tracking() {
    let state = SchedulerState::new();

    // Two consecutive panics on event_bus
    state.record_subscription_crash("event_bus");
    state.record_subscription_crash("event_bus");

    let health = state.subscription_health();
    let h = health.iter().find(|h| h.name == "event_bus").unwrap();
    assert_eq!(h.error_count, 2);
    assert_eq!(h.consecutive_panics, 2);
    assert_eq!(h.tick_count, 0);
    assert!(h.last_tick_at.is_some());

    // A successful tick resets consecutive_panics
    state.record_tick_latency(
        "event_bus",
        Duration::from_secs(2),
        Duration::from_millis(10),
    );
    let health = state.subscription_health();
    let h = health.iter().find(|h| h.name == "event_bus").unwrap();
    assert_eq!(h.error_count, 2); // errors stay
    assert_eq!(h.consecutive_panics, 0); // reset
    assert_eq!(h.tick_count, 1);
}

#[test]
fn test_chain_cascade_recording() {
    let state = SchedulerState::new();
    assert_eq!(state.stats().chain_cascades_total, 0);
    assert_eq!(state.stats().chain_cascade_duration_ms, 0);

    // Recording an empty cascade (no triggers) should be a no-op
    let empty = crate::engine::chain::CascadeMetrics::default();
    state.record_chain_cascade(&empty);
    assert_eq!(state.stats().chain_cascades_total, 0);

    // Recording a cascade with triggers_evaluated > 0 should increment
    let metrics = crate::engine::chain::CascadeMetrics {
        triggers_evaluated: 3,
        predicates_matched: 2,
        events_published: 2,
        duration_ms: 42,
        ..Default::default()
    };
    state.record_chain_cascade(&metrics);
    assert_eq!(state.stats().chain_cascades_total, 1);
    assert_eq!(state.stats().chain_cascade_duration_ms, 42);

    // Record a second cascade
    let metrics2 = crate::engine::chain::CascadeMetrics {
        triggers_evaluated: 1,
        duration_ms: 18,
        ..Default::default()
    };
    state.record_chain_cascade(&metrics2);
    assert_eq!(state.stats().chain_cascades_total, 2);
    assert_eq!(state.stats().chain_cascade_duration_ms, 60);
}

#[test]
fn test_trace_continuity_breaks_counter() {
    let state = SchedulerState::new();
    assert_eq!(state.stats().trace_continuity_breaks, 0);
    state
        .trace_continuity_breaks
        .fetch_add(1, Ordering::Relaxed);
    state
        .trace_continuity_breaks
        .fetch_add(1, Ordering::Relaxed);
    assert_eq!(state.stats().trace_continuity_breaks, 2);
}

#[test]
fn test_initial_stats_include_trace_continuity_breaks() {
    let state = SchedulerState::new();
    let stats = state.stats();
    assert_eq!(stats.trace_continuity_breaks, 0);
}

#[test]
fn test_mark_subscription_alive_and_dead() {
    let state = SchedulerState::new();

    // Initially no subscriptions
    assert!(state.subscription_health().is_empty());

    // Mark alive
    state.mark_subscription_alive("event_bus", 2000);
    let health = state.subscription_health();
    let h = health.iter().find(|h| h.name == "event_bus").unwrap();
    assert!(h.alive);
    assert!(h.started_at.is_some());
    assert_eq!(h.interval_ms, 2000);

    // Mark dead
    state.mark_subscription_dead("event_bus");
    let health = state.subscription_health();
    let h = health.iter().find(|h| h.name == "event_bus").unwrap();
    assert!(!h.alive);
    // started_at preserved even after death
    assert!(h.started_at.is_some());
}

#[test]
fn test_mark_dead_unknown_subscription_is_noop() {
    let state = SchedulerState::new();
    // Should not panic on unknown subscription
    state.mark_subscription_dead("nonexistent");
    assert!(state.subscription_health().is_empty());
}

#[test]
fn test_alive_survives_crash_recording() {
    let state = SchedulerState::new();

    // Mark alive, then record a crash — should stay alive (loop continues)
    state.mark_subscription_alive("oauth_refresh", 300_000);
    state.record_subscription_crash("oauth_refresh");

    let health = state.subscription_health();
    let h = health.iter().find(|h| h.name == "oauth_refresh").unwrap();
    assert!(h.alive);
    assert_eq!(h.error_count, 1);
    assert_eq!(h.consecutive_panics, 1);
}

#[test]
fn test_store_subscription_handles() {
    let state = SchedulerState::new();
    // Just verify the method doesn't panic with an empty vec
    state.store_subscription_handles(Vec::new());
    let handles = state.subscription_handles.lock().unwrap();
    assert!(handles.is_empty());
}

// ========================================================================
// Event skip-reason ledger
//
// The gate→token mapping is the wire contract with the frontend
// (`tokenLabel(t, 'event_reason', …)`) and with the DB-level tests in
// `db/repos/communication/events.rs`, which pin the same literal strings.
// ========================================================================

const ALL_GATE_REASONS: [EventGateReason; 9] = [
    EventGateReason::NoSubscriber,
    EventGateReason::ApprovalHeld,
    EventGateReason::PersonaDisabled,
    EventGateReason::HandoffTargetDisabled,
    EventGateReason::CrossTeamBlocked,
    EventGateReason::CascadeGuard,
    EventGateReason::DryRun,
    EventGateReason::StuckReclaimed,
    EventGateReason::StuckRetryExhausted,
];

#[test]
fn gate_reason_tokens_are_distinct_and_machine_shaped() {
    let mut seen = std::collections::HashSet::new();
    for reason in ALL_GATE_REASONS {
        let token = reason.token();
        assert!(
            seen.insert(token),
            "duplicate gate token {token} — the UI cannot tell the gates apart"
        );
        assert!(
            token.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
            "{token} must be a language-agnostic identifier, not prose"
        );
        assert!(
            !token.contains(','),
            "{token} must not contain the ledger separator"
        );
    }
}

#[test]
fn gate_reason_tokens_match_the_frontend_contract() {
    assert_eq!(EventGateReason::NoSubscriber.token(), "no_subscriber");
    assert_eq!(EventGateReason::ApprovalHeld.token(), "approval_held");
    assert_eq!(EventGateReason::PersonaDisabled.token(), "persona_disabled");
    assert_eq!(
        EventGateReason::HandoffTargetDisabled.token(),
        "handoff_target_disabled"
    );
    assert_eq!(
        EventGateReason::CrossTeamBlocked.token(),
        "cross_team_blocked"
    );
    assert_eq!(EventGateReason::CascadeGuard.token(), "cascade_guard");
    assert_eq!(EventGateReason::DryRun.token(), "dry_run");
    assert_eq!(EventGateReason::StuckReclaimed.token(), "stuck_reclaimed");
    assert_eq!(
        EventGateReason::StuckRetryExhausted.token(),
        "stuck_retry_exhausted"
    );
}

#[test]
fn gate_ledger_empty_writes_no_reason() {
    // A clean dispatch must leave the reason column NULL — never "" —
    // so the UI can tell "nothing to explain" from "reason unknown".
    assert_eq!(EventGateLedger::default().into_reason(), None);
}

#[test]
fn gate_ledger_records_single_gate() {
    let mut ledger = EventGateLedger::default();
    ledger.record(EventGateReason::CascadeGuard);
    assert_eq!(ledger.into_reason().as_deref(), Some("cascade_guard"));
}

#[test]
fn gate_ledger_dedupes_and_preserves_first_seen_order() {
    let mut ledger = EventGateLedger::default();
    ledger.record(EventGateReason::PersonaDisabled);
    ledger.record(EventGateReason::CascadeGuard);
    ledger.record(EventGateReason::PersonaDisabled);
    assert_eq!(
        ledger.into_reason().as_deref(),
        Some("persona_disabled,cascade_guard")
    );
}

// ========================================================================
// Stuck-`processing` reaper — candidate selection
//
// The two-consecutive-sightings rule is the whole safety story: it is what
// separates a stranded row from one a healthy tick (or the headless daemon
// in another process) is holding right now. Row-level reap behaviour is
// covered by the DB tests in `db/repos/communication/events.rs`.
// ========================================================================

fn seen(ids: &[&str]) -> std::collections::HashSet<String> {
    ids.iter().map(|s| (*s).to_string()).collect()
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_string()).collect()
}

#[test]
fn stuck_reaper_never_reaps_on_the_first_sighting() {
    // Boot / first pass: nothing has been observed before, so nothing is
    // touched — a full backlog claimed seconds ago must not be re-queued.
    let (to_reap, next_seen) =
        partition_stuck_candidates(&ids(&["a", "b"]), &std::collections::HashSet::new());
    assert!(to_reap.is_empty());
    assert_eq!(next_seen, seen(&["a", "b"]));
}

#[test]
fn stuck_reaper_reaps_only_ids_that_survived_a_whole_interval() {
    // "a" was already claimed last pass and still is → stranded.
    // "c" was just claimed → watched, not reaped.
    let (to_reap, next_seen) = partition_stuck_candidates(&ids(&["a", "c"]), &seen(&["a", "b"]));
    assert_eq!(to_reap, ids(&["a"]));
    assert_eq!(next_seen, seen(&["a", "c"]));
}

#[test]
fn stuck_reaper_forgets_rows_a_healthy_tick_finished() {
    // Everything the previous pass saw has moved to a terminal status, so
    // the watch list empties instead of accumulating forever.
    let (to_reap, next_seen) = partition_stuck_candidates(&[], &seen(&["a", "b"]));
    assert!(to_reap.is_empty());
    assert!(next_seen.is_empty());
}

#[test]
fn stuck_reaper_interval_is_far_above_every_claiming_cadence() {
    // Event bus: 2s active / 10s idle. Headless daemon: 5s. A threshold
    // near those would re-dispatch events a healthy tick still owns.
    assert!(STUCK_EVENT_REAP_INTERVAL >= Duration::from_secs(60));
}
