use super::SchedulerState;
use crate::daemon::lock::{default_data_dir, trigger_type_to_kind, DaemonLock, LockFileContents};
use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::settings;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::healing as healing_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::scheduler as sched_logic;
use std::collections::HashMap;
use std::sync::atomic::Ordering;

/// One tick of the trigger scheduler: fetch due triggers, evaluate, publish events.
pub(crate) fn trigger_scheduler_tick(scheduler: &SchedulerState, pool: &DbPool) {
    trigger_scheduler_tick_counted(scheduler, pool);
}

/// Check whether a trigger should be yielded to the daemon.
///
/// Returns `true` (yield = skip) when **all three** conditions hold:
///  1. A `daemon.lock` file exists and is fresh (heartbeat < 90 s old).
///  2. The daemon's `owns[]` list includes this trigger's kind.
///  3. The trigger's persona has `headless = true`.
///
/// When any condition is false the UI fires the trigger normally — this
/// is the fallback behavior that guarantees users who haven't installed
/// the daemon are completely unaffected.
fn should_yield_to_daemon(
    daemon_lock: &Option<LockFileContents>,
    pool: &DbPool,
    trigger: &crate::db::models::PersonaTrigger,
) -> bool {
    // No daemon running → never yield.
    let lock = match daemon_lock {
        Some(l) => l,
        None => return false,
    };

    // Map the trigger's DB string to our enum. Unknown types → never yield.
    let kind = match trigger_type_to_kind(&trigger.trigger_type) {
        Some(k) => k,
        None => return false,
    };

    // Daemon doesn't own this trigger kind → don't yield.
    if !lock.owns_kind(kind) {
        return false;
    }

    // Finally check if the persona is headless. A single PK lookup is
    // cheap (persona index on primary key). If the query fails or the
    // persona doesn't exist, default to NOT yielding — better to
    // double-fire than silently lose a trigger.
    let headless = pool
        .get()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT headless FROM personas WHERE id = ?1",
                rusqlite::params![trigger.persona_id],
                |row| row.get::<_, bool>(0),
            )
            .ok()
        })
        .unwrap_or(false);

    if headless {
        tracing::debug!(
            trigger_id = %trigger.id,
            persona_id = %trigger.persona_id,
            kind = ?kind,
            "yielding trigger to daemon (persona is headless and daemon owns this kind)"
        );
    }

    headless
}

/// Fix 3 helper: when a trigger author didn't specify a payload, synthesize
/// a diagnostic one so downstream consumers (Live Stream, Event Log, dev
/// inspection) can see WHAT fired, WHY, and WHEN. Pure function — unit-tested
/// in the `tests` module below.
pub(crate) fn synthesize_trigger_fired_payload(
    trigger: &crate::db::models::PersonaTrigger,
    cfg: &crate::db::models::TriggerConfig,
    fired_at: &str,
) -> String {
    use crate::db::models::TriggerConfig;
    let (cron, interval_seconds) = match cfg {
        TriggerConfig::Schedule {
            cron,
            interval_seconds,
            ..
        } => (cron.clone(), *interval_seconds),
        TriggerConfig::Polling {
            interval_seconds, ..
        } => (None, *interval_seconds),
        _ => (None, None),
    };
    let mut meta = serde_json::Map::new();
    meta.insert(
        "trigger_id".into(),
        serde_json::Value::String(trigger.id.clone()),
    );
    meta.insert(
        "trigger_type".into(),
        serde_json::Value::String(trigger.trigger_type.clone()),
    );
    meta.insert(
        "target_persona_id".into(),
        serde_json::Value::String(trigger.persona_id.clone()),
    );
    meta.insert(
        "fired_at".into(),
        serde_json::Value::String(fired_at.to_string()),
    );
    if let Some(c) = cron {
        meta.insert("cron".into(), serde_json::Value::String(c));
    }
    if let Some(iv) = interval_seconds {
        meta.insert(
            "interval_seconds".into(),
            serde_json::Value::Number(iv.into()),
        );
    }
    if let Some(uc) = trigger.use_case_id.as_ref() {
        meta.insert("use_case_id".into(), serde_json::Value::String(uc.clone()));
    }
    serde_json::to_string(&serde_json::Value::Object(meta)).unwrap_or_default()
}

/// Hard ceiling on backfill events emitted per tick per trigger. Defends
/// against amplification when a trigger configured with a large
/// `max_backfill` was offline for a long time — without this cap, an
/// every-minute trigger offline overnight would emit hundreds of events.
///
/// Single source of truth lives in [`crate::engine::limits::BACKFILL_HARD_CAP`];
/// re-exported here so the existing local references compile unchanged.
pub(super) const BACKFILL_HARD_CAP: usize = crate::engine::limits::BACKFILL_HARD_CAP;

/// Global ceiling on backfill events emitted across ALL triggers in a single
/// tick. BACKFILL_HARD_CAP bounds each trigger individually, but a mass restart
/// after long downtime with many backfill-enabled triggers could still emit
/// (triggers × cap) catch-up events in one tick — a thundering herd. This caps
/// the aggregate; triggers whose backfill is skipped this tick still get their
/// live fire + watermark advance, so their best-effort catch-up extras are just
/// dropped (the same semantics as the per-trigger drop-oldest).
const GLOBAL_BACKFILL_PER_TICK: usize = 50;

pub(crate) fn schedule_executions_per_persona_hour(pool: &DbPool) -> i64 {
    match settings::get(pool, settings_keys::SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR)
        .ok()
        .flatten()
    {
        Some(raw) => match raw.parse::<i64>() {
            Ok(n) if n > 0 => n,
            Ok(n) => {
                tracing::warn!(
                    value = n,
                    "invalid scheduled execution hourly cap; using default"
                );
                settings_keys::SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR_DEFAULT
            }
            Err(err) => {
                tracing::warn!(
                    value = %raw,
                    error = %err,
                    "failed to parse scheduled execution hourly cap; using default"
                );
                settings_keys::SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR_DEFAULT
            }
        },
        None => settings_keys::SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR_DEFAULT,
    }
}

pub(crate) fn schedule_hourly_cap_exceeded(
    pool: &DbPool,
    trigger: &crate::db::models::PersonaTrigger,
    now: chrono::DateTime<chrono::Utc>,
    ceiling: i64,
    pending_by_persona: &HashMap<String, i64>,
) -> bool {
    let since = (now - chrono::Duration::hours(1)).to_rfc3339();
    let recent = match exec_repo::count_for_persona_since(pool, &trigger.persona_id, &since) {
        Ok(count) => count,
        Err(err) => {
            tracing::warn!(
                persona_id = %trigger.persona_id,
                error = %err,
                "failed to read scheduled execution hourly count; allowing trigger"
            );
            return false;
        }
    };
    let pending = pending_by_persona
        .get(&trigger.persona_id)
        .copied()
        .unwrap_or(0);
    recent + pending >= ceiling
}

/// Direction 3 (lost fires get a home): a publish failure AFTER `mark_triggered`
/// has advanced the schedule is a PERMANENTLY LOST fire — the slot is gone and
/// was previously recorded only in a `tracing::error!`. Reuse the existing
/// healing-issue mechanism (mirrors `log_schedule_rate_limit_issue`) so the loss
/// becomes an actionable, user-visible issue. Deduped to one open issue per
/// trigger episode: while an issue is open, further lost fires for the same
/// trigger fold into it instead of spamming a new row per failed publish.
pub(crate) fn log_schedule_lost_fire_issue(
    pool: &DbPool,
    trigger: &crate::db::models::PersonaTrigger,
    slot_iso: &str,
    error: &str,
) {
    let title = "Scheduled fire lost after schedule advanced";
    let category = "schedule_lost_fire";
    let already_open = match pool.get() {
        Ok(conn) => conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM persona_healing_issues
                    WHERE persona_id = ?1
                      AND status = 'open'
                      AND category = ?2
                      AND title = ?3
                )",
                rusqlite::params![trigger.persona_id, category, title],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false),
        Err(err) => {
            tracing::warn!(
                trigger_id = %trigger.id,
                persona_id = %trigger.persona_id,
                error = %err,
                "failed to check existing schedule lost-fire healing issue"
            );
            false
        }
    };
    if already_open {
        return;
    }

    let description = format!(
        "Schedule trigger {} advanced its schedule but the event publish failed for the fire due at {}, so that run was lost ({}). The schedule pointer already moved, so it will not retry on its own.",
        trigger.id, slot_iso, error
    );
    let suggested_fix = format!(
        "Replay the lost run with Backfill on trigger {}, then check the event bus / database health if this recurs.",
        trigger.id
    );
    if let Err(err) = healing_repo::create(
        pool,
        &trigger.persona_id,
        title,
        &description,
        false,
        Some("high"),
        Some(category),
        None,
        Some(&suggested_fix),
    ) {
        tracing::warn!(
            trigger_id = %trigger.id,
            persona_id = %trigger.persona_id,
            error = %err,
            "failed to create schedule lost-fire healing issue"
        );
    }
}

/// Decide whether a scheduled persona is over its monthly budget.
///
/// This is the canonical decision shared with the manual/preview gate in
/// `commands/execution/executions.rs` (the `budget > 0.0` guard +
/// `get_monthly_spend`). A budget of `0.0` is a LEGAL value
/// (`validate_max_budget_usd` allows `>= 0`) that means "unlimited", and
/// `None` (no budget set) is likewise unlimited — neither is ever over budget.
/// Only a positive cap that monthly spend meets-or-exceeds counts. The caller
/// must pass spend from `get_monthly_spend` so the cron path measures the SAME
/// executions the budget UI shows (terminal statuses only, ops-chat excluded).
pub(super) fn schedule_over_budget(max_budget: Option<f64>, monthly_spend: f64) -> bool {
    matches!(max_budget, Some(budget) if budget > 0.0 && monthly_spend >= budget)
}

pub(crate) fn log_schedule_rate_limit_issue(
    pool: &DbPool,
    trigger: &crate::db::models::PersonaTrigger,
    ceiling: i64,
) {
    let title = "Scheduled execution hourly cap exceeded";
    let category = "schedule_rate_limit";
    let already_open = match pool.get() {
        Ok(conn) => conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM persona_healing_issues
                    WHERE persona_id = ?1
                      AND status = 'open'
                      AND category = ?2
                      AND title = ?3
                )",
                rusqlite::params![trigger.persona_id, category, title],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false),
        Err(err) => {
            tracing::warn!(
                trigger_id = %trigger.id,
                persona_id = %trigger.persona_id,
                error = %err,
                "failed to check existing schedule rate-limit healing issue"
            );
            false
        }
    };
    if already_open {
        return;
    }

    let description = format!(
        "Schedule trigger {} was skipped because persona {} reached the configured ceiling of {} scheduled executions per rolling hour.",
        trigger.id, trigger.persona_id, ceiling
    );
    let suggested_fix = format!(
        "Increase '{}' or reduce cron frequency/backfill for trigger {}.",
        settings_keys::SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR,
        trigger.id
    );
    if let Err(err) = healing_repo::create(
        pool,
        &trigger.persona_id,
        title,
        &description,
        false,
        Some("medium"),
        Some(category),
        None,
        Some(&suggested_fix),
    ) {
        tracing::warn!(
            trigger_id = %trigger.id,
            persona_id = %trigger.persona_id,
            error = %err,
            "failed to create schedule rate-limit healing issue"
        );
    }
}

/// Direction 1 (missed-runs visibility): persist `discarded` dropped slots for
/// a trigger and publish a feed-visible `schedule.missed.offline` event so the
/// schedule UI can surface "missed N while offline". The count accumulates
/// across gaps and is cleared when the user backfills or dismisses. The event
/// carries no side-effect: `schedule.missed.offline` is not a listener-matched
/// type, so it never spawns an execution — it is purely informational.
pub(crate) fn record_and_emit_missed_runs(
    pool: &DbPool,
    trigger: &crate::db::models::PersonaTrigger,
    discarded: i64,
    now_str: &str,
) {
    if let Err(err) = trigger_repo::record_missed_runs(pool, &trigger.id, discarded, now_str) {
        tracing::warn!(
            trigger_id = %trigger.id,
            persona_id = %trigger.persona_id,
            error = %err,
            "failed to persist discarded-while-offline slot count"
        );
        return;
    }

    let mut meta = serde_json::Map::new();
    meta.insert(
        "trigger_id".into(),
        serde_json::Value::String(trigger.id.clone()),
    );
    meta.insert(
        "target_persona_id".into(),
        serde_json::Value::String(trigger.persona_id.clone()),
    );
    meta.insert(
        "missed_count".into(),
        serde_json::Value::Number(discarded.into()),
    );
    meta.insert(
        "detected_at".into(),
        serde_json::Value::String(now_str.to_string()),
    );
    let payload = serde_json::to_string(&serde_json::Value::Object(meta)).ok();

    match event_repo::publish(
        pool,
        CreatePersonaEventInput {
            event_type: "schedule.missed.offline".into(),
            source_type: "scheduler".into(),
            source_id: Some(trigger.id.clone()),
            target_persona_id: Some(trigger.persona_id.clone()),
            project_id: None,
            payload,
            use_case_id: trigger.use_case_id.clone(),
        },
    ) {
        Ok(_) => tracing::info!(
            trigger_id = %trigger.id,
            persona_id = %trigger.persona_id,
            discarded,
            "Scheduled slots discarded while offline — recorded + signalled"
        ),
        Err(e) => tracing::warn!(
            trigger_id = %trigger.id,
            "failed to publish schedule.missed.offline event: {}", e
        ),
    }
}

/// Direction 2 (overlap policy): is a previous run from THIS schedule trigger
/// still in flight?
///
/// Architectural note on why this is a bounded DB check and NOT an in-memory
/// `InflightGuard`: the scheduler fire path only *publishes an event* and
/// returns — the execution is created and run detached by a later
/// `event_bus_tick` (a separate subscription tick). An in-memory guard acquired
/// in the fire path would be released the instant the fire path returns, long
/// before the execution even starts, so it cannot represent "still running".
/// The durable signal is the execution row itself. Scheduler-spawned execution
/// rows carry `trigger_id = NULL` (the event-bus path passes `None`), so the
/// only correlation back to the trigger is `input_data._event.source_id`. We
/// also treat an as-yet-undispatched fire (a pending/processing `persona_event`
/// from this trigger) as "in flight" to close the publish→dispatch gap.
pub(crate) fn schedule_overlap_active(pool: &DbPool, trigger_id: &str) -> bool {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            // On a DB error, do NOT skip — better to risk a rare overlap than
            // to silently drop a legitimate fire on a transient pool hiccup.
            tracing::warn!(trigger_id, error = %e, "overlap check: pool error — allowing fire");
            return false;
        }
    };
    conn.query_row(
        "SELECT
            EXISTS(
                SELECT 1 FROM persona_executions
                WHERE status IN ('queued','running')
                  AND json_extract(input_data, '$._event.source_id') = ?1
            )
            OR EXISTS(
                SELECT 1 FROM persona_events
                WHERE source_type = 'trigger'
                  AND source_id = ?1
                  AND status IN ('pending','processing')
            )",
        rusqlite::params![trigger_id],
        |row| row.get::<_, bool>(0),
    )
    .unwrap_or_else(|e| {
        tracing::warn!(trigger_id, error = %e, "overlap check query failed — allowing fire");
        false
    })
}

/// Build the `schedule.skipped.overlap` signal payload. Pure so the shape is
/// unit-testable without a DB.
pub(super) fn synthesize_overlap_skip_payload(
    trigger: &crate::db::models::PersonaTrigger,
    skipped_at: &str,
) -> String {
    let mut meta = serde_json::Map::new();
    meta.insert(
        "trigger_id".into(),
        serde_json::Value::String(trigger.id.clone()),
    );
    meta.insert(
        "target_persona_id".into(),
        serde_json::Value::String(trigger.persona_id.clone()),
    );
    meta.insert(
        "reason".into(),
        serde_json::Value::String("previous_run_active".into()),
    );
    meta.insert(
        "skipped_at".into(),
        serde_json::Value::String(skipped_at.to_string()),
    );
    serde_json::to_string(&serde_json::Value::Object(meta)).unwrap_or_default()
}

/// Direction 2: emit the visible "skipped — previous run still active" signal.
/// `schedule.skipped.overlap` is informational (not listener-matched), so it
/// never spawns an execution — it only records the skip in the event feed.
fn emit_overlap_skip_signal(
    pool: &DbPool,
    trigger: &crate::db::models::PersonaTrigger,
    skipped_at: &str,
) {
    let payload = Some(synthesize_overlap_skip_payload(trigger, skipped_at));
    if let Err(e) = event_repo::publish(
        pool,
        CreatePersonaEventInput {
            event_type: "schedule.skipped.overlap".into(),
            source_type: "scheduler".into(),
            source_id: Some(trigger.id.clone()),
            target_persona_id: Some(trigger.persona_id.clone()),
            project_id: None,
            payload,
            use_case_id: trigger.use_case_id.clone(),
        },
    ) {
        tracing::warn!(
            trigger_id = %trigger.id,
            "failed to publish schedule.skipped.overlap signal: {}", e
        );
    }
}

/// Enumerate cron/interval slots that should have fired strictly between
/// `last_fire` (exclusive) and `now` (inclusive), excluding the most-recent
/// one (which the existing scheduler tick path will fire as the "current"
/// event). Used by the backfill path to emit catch-up events for older slots
/// that were missed during downtime.
///
/// Returns at most `BACKFILL_HARD_CAP` slots regardless of caller intent.
pub(super) fn compute_missed_backfill_slots(
    cfg: &crate::db::models::TriggerConfig,
    last_fire: chrono::DateTime<chrono::Utc>,
    now: chrono::DateTime<chrono::Utc>,
    seed: u64,
) -> Vec<chrono::DateTime<chrono::Utc>> {
    use crate::db::models::TriggerConfig;
    let mut slots: Vec<chrono::DateTime<chrono::Utc>> = Vec::new();
    match cfg {
        TriggerConfig::Schedule {
            cron: Some(expr),
            timezone,
            ..
        } => {
            let Ok(schedule) = crate::engine::cron::parse_cron_seeded(expr, seed) else {
                return slots;
            };
            // Mirror the live path's refuse-on-bad-zone policy: an unparseable
            // timezone yields an EMPTY catch-up set rather than silently falling
            // back to system-local and replaying at the wrong wall-clock hour.
            let tz = match sched_logic::resolve_schedule_tz(timezone.as_deref()) {
                Ok(tz) => tz,
                Err(_) => return slots,
            };
            let mut from = last_fire;
            while slots.len() < BACKFILL_HARD_CAP {
                let next = match tz {
                    Some(zone) => crate::engine::cron::next_fire_time_in_tz(&schedule, from, zone),
                    None => crate::engine::cron::next_fire_time_local(&schedule, from),
                };
                match next {
                    Some(t) if t <= now => {
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
            let interval = chrono::Duration::seconds(*secs as i64);
            let mut t = last_fire + interval;
            while t <= now && slots.len() < BACKFILL_HARD_CAP {
                slots.push(t);
                t += interval;
            }
        }
        _ => {}
    }
    // Drop the most-recent slot — that one is fired by the existing
    // mark_triggered + publish path. We're only emitting EXTRA catch-up
    // events for the older missed slots.
    if !slots.is_empty() {
        slots.pop();
    }
    slots
}

/// Same as `synthesize_trigger_fired_payload` but injects a `backfill_slot`
/// marker so consumers can distinguish catch-up events from the live one.
pub(super) fn synthesize_backfill_payload(
    trigger: &crate::db::models::PersonaTrigger,
    cfg: &crate::db::models::TriggerConfig,
    slot_fired_at: &str,
) -> String {
    use crate::db::models::TriggerConfig;
    let (cron, interval_seconds) = match cfg {
        TriggerConfig::Schedule {
            cron,
            interval_seconds,
            ..
        } => (cron.clone(), *interval_seconds),
        _ => (None, None),
    };
    let mut meta = serde_json::Map::new();
    meta.insert(
        "trigger_id".into(),
        serde_json::Value::String(trigger.id.clone()),
    );
    meta.insert(
        "trigger_type".into(),
        serde_json::Value::String(trigger.trigger_type.clone()),
    );
    meta.insert(
        "target_persona_id".into(),
        serde_json::Value::String(trigger.persona_id.clone()),
    );
    meta.insert(
        "fired_at".into(),
        serde_json::Value::String(slot_fired_at.to_string()),
    );
    meta.insert("backfill_slot".into(), serde_json::Value::Bool(true));
    if let Some(c) = cron {
        meta.insert("cron".into(), serde_json::Value::String(c));
    }
    if let Some(iv) = interval_seconds {
        meta.insert(
            "interval_seconds".into(),
            serde_json::Value::Number(iv.into()),
        );
    }
    if let Some(uc) = trigger.use_case_id.as_ref() {
        meta.insert("use_case_id".into(), serde_json::Value::String(uc.clone()));
    }
    serde_json::to_string(&serde_json::Value::Object(meta)).unwrap_or_default()
}

/// Same as `trigger_scheduler_tick` but returns the number of triggers fired.
/// Used by the startup overdue sweep to know how many were recovered.
pub fn trigger_scheduler_tick_counted(scheduler: &SchedulerState, pool: &DbPool) -> u32 {
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();
    let mut fired: u32 = 0;
    let hourly_ceiling = schedule_executions_per_persona_hour(pool);
    let mut scheduled_publishes_by_persona: HashMap<String, i64> = HashMap::new();
    // Tick-wide backfill budget shared across all triggers — caps the aggregate
    // catch-up herd after a long downtime (see GLOBAL_BACKFILL_PER_TICK).
    let mut backfill_emitted_this_tick: usize = 0;

    // 1. Get due triggers
    let triggers = match trigger_repo::get_due(pool, &now_str) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Trigger poll error: {}", e);
            return 0;
        }
    };

    // Daemon-lock check: read once per tick (not per trigger) to avoid
    // re-reading the lock file for every due trigger. If the daemon is
    // running, `daemon_lock` holds its lock contents; if not, it's None
    // and `should_yield_to_daemon` falls through to the UI-fires path.
    let daemon_lock = DaemonLock::check_active(&default_data_dir()).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "failed to read daemon lock — assuming no daemon");
        None
    });

    for mut trigger in triggers {
        // Skip polling triggers -- they are handled by the PollingSubscription
        // which does HTTP content-hash diffing before deciding whether to fire.
        // Skip event_listener triggers -- they are event-driven, not time-based.
        if trigger.trigger_type == "polling" || trigger.trigger_type == "event_listener" {
            continue;
        }

        // Daemon yield check: if a daemon is running, owns this trigger
        // kind, and the persona is headless, let the daemon handle it.
        // The trigger's schedule still advances (mark_triggered below),
        // but the event is NOT published from the UI — the daemon's own
        // trigger loop will claim it instead.
        if should_yield_to_daemon(&daemon_lock, pool, &trigger) {
            continue;
        }

        // Active window gate: skip triggers outside their configured active hours.
        // The schedule still advances so triggers don't pile up as overdue.
        if !trigger.is_within_active_window(now) {
            // Anchored on the trigger's prior scheduled fire so intervals keep
            // their cadence even when this slot is skipped (drift fix).
            let next = sched_logic::compute_next_trigger_at(&trigger, now);
            // Skip path: advance ONLY the schedule pointer (next_trigger_at +
            // version), never last_triggered_at — that watermark must keep
            // tracking the last actually-fired slot so auto-backfill can replay
            // the slots skipped while outside the active window.
            let _ = trigger_repo::advance_schedule_pointer(
                pool,
                &trigger.id,
                next,
                trigger.trigger_version,
            );
            tracing::debug!(trigger_id = %trigger.id, "Trigger outside active window, skipping");
            continue;
        }

        // 2. Parse config once; reuse for event_type, payload, and next schedule time
        let cfg = trigger.parse_config();

        // Check if persona is over budget for scheduled triggers.
        //
        // This MUST mirror the canonical manual/preview budget gate in
        // commands/execution/executions.rs (the `budget > 0.0` guard +
        // get_monthly_spend) — otherwise a scheduled agent diverges from what
        // the same persona does when run by hand. Three rules the old bespoke
        // inline SQL got wrong and this path fixes:
        //   1. A budget of 0.0 is a LEGAL value (validate_max_budget_usd allows
        //      >= 0) that means "unlimited" on the manual path. The old query
        //      had no `budget > 0.0` guard, so `0.0 >= 0.0` made such personas
        //      permanently "over budget" and silently paused.
        //   2. get_monthly_spend only counts terminal statuses
        //      (completed/failed/incomplete/cancelled), not in-flight rows.
        //   3. get_monthly_spend excludes conversational `_ops` chat spend the
        //      old query wrongly counted, matching the budget UI exactly.
        if trigger.trigger_type == "schedule" {
            let max_budget: Option<f64> = pool
                .get()
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT max_budget_usd FROM personas WHERE id = ?1",
                        rusqlite::params![trigger.persona_id],
                        |row| row.get::<_, Option<f64>>(0),
                    )
                    .ok()
                })
                .flatten();

            // Only personas with a POSITIVE cap can be over budget; querying
            // monthly spend for the unlimited case (None or 0.0) is wasted
            // work, so short-circuit before touching the DB. schedule_over_budget
            // re-applies the same guard so it is correct in isolation too.
            let over_budget = if matches!(max_budget, Some(b) if b > 0.0) {
                let spend = exec_repo::get_monthly_spend(pool, &trigger.persona_id).unwrap_or(0.0);
                schedule_over_budget(max_budget, spend)
            } else {
                false
            };

            if over_budget {
                tracing::warn!(persona_id = %trigger.persona_id, "Cron agent paused due to exceeded budget");
                let next = sched_logic::compute_next_trigger_at(&trigger, now);
                // Skip path: advance the pointer only, preserving last_triggered_at
                // as the true last-fired watermark so backfill replays every run
                // missed while the persona was paused on budget.
                let _ = trigger_repo::advance_schedule_pointer(
                    pool,
                    &trigger.id,
                    next,
                    trigger.trigger_version,
                );
                continue;
            }
        }

        // Direction 2 (overlap policy): default skip-with-signal. A slow persona
        // must not stack concurrent executions up to the hourly cap while its
        // previous run from THIS trigger is still active. Distinct schedules stay
        // independent — the check is keyed per trigger, not per persona.
        //
        // We CONSUME the slot here (mark_triggered advances last_triggered_at +
        // next + version) rather than using advance_schedule_pointer. Rationale:
        // an overlap skip is an INTENTIONAL drop — the previous run is still
        // doing the work — so the slot must be neither replayed by backfill nor
        // counted as an offline miss (Direction 1). Preserving the fired-watermark
        // (advance_schedule_pointer) would do both: the auto-backfill window and
        // the missed-runs computation both key off (last_triggered_at, now]. The
        // visible signal below ensures this is never a silent drop.
        if trigger.trigger_type == "schedule" && schedule_overlap_active(pool, &trigger.id) {
            let next = sched_logic::compute_next_trigger_at(&trigger, now);
            match trigger_repo::mark_triggered(pool, &trigger.id, next, trigger.trigger_version) {
                Ok(true) => {
                    emit_overlap_skip_signal(pool, &trigger, &now_str);
                    tracing::info!(
                        trigger_id = %trigger.id,
                        persona_id = %trigger.persona_id,
                        "Scheduled fire skipped — previous run still active (overlap)"
                    );
                }
                Ok(false) => tracing::debug!(
                    trigger_id = %trigger.id,
                    "Overlap skip: trigger already claimed by another tick"
                ),
                Err(e) => tracing::error!(
                    trigger_id = %trigger.id,
                    "Overlap skip: failed to advance schedule: {}", e
                ),
            }
            continue;
        }

        // Direction 1 (missed-runs visibility): enumerate the full set of slots
        // missed strictly between (last_triggered_at, now], independent of the
        // backfill policy. In the DEFAULT single-catch-up case (backfill_cap ==
        // 1) EVERY one of these older slots is silently discarded; we count them
        // so a daily-job user who closed the app for N days gets a visible
        // "missed N while offline" record instead of silent loss. Bounded by
        // BACKFILL_HARD_CAP (100) — a longer gap reports the cap.
        let missed_total: usize = if trigger.trigger_type == "schedule" {
            trigger
                .last_triggered_at
                .as_deref()
                .and_then(|iso| chrono::DateTime::parse_from_rfc3339(iso).ok())
                .map(|last_dt| {
                    compute_missed_backfill_slots(
                        &cfg,
                        last_dt.with_timezone(&chrono::Utc),
                        now,
                        crate::engine::cron::seed_hash(&trigger.id),
                    )
                    .len()
                })
                .unwrap_or(0)
        } else {
            0
        };
        // Count of missed slots this tick actually replayed via backfill for
        // THIS trigger — subtracted from missed_total so the "discarded" figure
        // reflects only slots that were genuinely dropped.
        let mut backfill_emitted_for_trigger: usize = 0;

        // 2.5. Backfill catch-up: when max_backfill > 1 AND the trigger has
        // an explicit last_triggered_at, emit catch-up events for any older
        // missed slots strictly between (last_triggered_at, now]. The
        // existing mark_triggered + publish path below handles the most-
        // recent slot as the "live" fire — backfill only emits the EXTRAS.
        let backfill_cap: usize = match &cfg {
            crate::db::models::TriggerConfig::Schedule {
                max_backfill: Some(n),
                ..
            } if trigger.trigger_type == "schedule" => crate::engine::limits::cap_with_log(
                "backfill_hard_cap",
                *n as usize,
                BACKFILL_HARD_CAP,
            ),
            _ => 1,
        };
        if backfill_cap > 1 && backfill_emitted_this_tick < GLOBAL_BACKFILL_PER_TICK {
            if let Some(last_iso) = trigger.last_triggered_at.clone() {
                if let Ok(last_dt) = chrono::DateTime::parse_from_rfc3339(&last_iso) {
                    // Finding #3: claim this trigger's backfill window BEFORE
                    // computing or publishing any slot. Without this, the
                    // startup overdue-sweep and this same trigger's first
                    // subscription tick (spawned with no initial delay) both
                    // read the identical `last_triggered_at` watermark, both
                    // compute the identical missed-slot set below, and both
                    // publish every one of them -- the CAS that's supposed to
                    // prevent double-fire (`mark_triggered`) only runs AFTER
                    // this whole loop, by which point both callers already
                    // published the same backlog once each.
                    //
                    // `advance_schedule_pointer` is the right primitive here:
                    // it CASes on `trigger_version` (same guarantee as
                    // `mark_triggered`) but does NOT move `last_triggered_at`,
                    // so the watermark this backfill computation depends on
                    // stays correct for whichever caller loses the race (it
                    // just skips its own backlog attempt this tick and
                    // catches up on the next one). We pass the trigger's
                    // current `next_trigger_at` back unchanged -- this call's
                    // only job is to bump the version as a claim, not to
                    // advance the schedule (step 3 below still owns that).
                    let claimed = match trigger_repo::advance_schedule_pointer(
                        pool,
                        &trigger.id,
                        trigger.next_trigger_at.clone(),
                        trigger.trigger_version,
                    ) {
                        Ok(true) => {
                            // Our in-memory version must track the bump so
                            // the live-fire CAS below (`mark_triggered`)
                            // still uses the correct expected_version instead
                            // of one that's now one behind the DB.
                            trigger.trigger_version += 1;
                            true
                        }
                        Ok(false) => {
                            tracing::debug!(
                                trigger_id = %trigger.id,
                                "Backfill window already claimed by another tick this cycle, skipping backlog"
                            );
                            false
                        }
                        Err(e) => {
                            tracing::warn!(
                                trigger_id = %trigger.id,
                                error = %e,
                                "Backfill claim failed; skipping backlog this tick"
                            );
                            false
                        }
                    };
                    if claimed {
                        let last_utc = last_dt.with_timezone(&chrono::Utc);
                        let mut missed = compute_missed_backfill_slots(
                            &cfg,
                            last_utc,
                            now,
                            crate::engine::cron::seed_hash(&trigger.id),
                        );
                        // Cap to (cap - 1) extras; the live fire below counts
                        // toward the user's intent. Drop the OLDEST when over.
                        let extras_wanted = backfill_cap.saturating_sub(1);
                        if missed.len() > extras_wanted {
                            missed.drain(..(missed.len() - extras_wanted));
                        }
                        for slot in &missed {
                            // Stop if this tick's global backfill budget is spent —
                            // remaining slots (and triggers) defer their catch-up.
                            if backfill_emitted_this_tick >= GLOBAL_BACKFILL_PER_TICK {
                                break;
                            }
                            // Per-slot budget re-check so catch-up runs respect
                            // the persona's monthly cap mid-loop.
                            let exhausted: bool = pool.get().map_err(|e| e.to_string()).and_then(|conn| {
                            conn.query_row(
                                "SELECT COALESCE((
                                    SELECT SUM(cost_usd)
                                    FROM persona_executions
                                    WHERE persona_id = ?1 AND created_at >= datetime('now', 'start of month')
                                ), 0.0) >= max_budget_usd
                                FROM personas
                                WHERE id = ?1 AND max_budget_usd IS NOT NULL",
                                rusqlite::params![trigger.persona_id],
                                |row| row.get(0),
                            ).map_err(|e| e.to_string())
                        }).unwrap_or(false);
                            if exhausted {
                                tracing::warn!(
                                    persona_id = %trigger.persona_id,
                                    "Backfill halted mid-loop: budget exhausted"
                                );
                                break;
                            }

                            // Per-slot active-window check: don't emit catch-up
                            // events for slots that fell outside the window.
                            if !trigger.is_within_active_window(*slot) {
                                tracing::debug!(
                                    trigger_id = %trigger.id,
                                    slot = %slot,
                                    "Backfill slot skipped — outside active window"
                                );
                                continue;
                            }

                            if schedule_hourly_cap_exceeded(
                                pool,
                                &trigger,
                                now,
                                hourly_ceiling,
                                &scheduled_publishes_by_persona,
                            ) {
                                log_schedule_rate_limit_issue(pool, &trigger, hourly_ceiling);
                                tracing::warn!(
                                    trigger_id = %trigger.id,
                                    persona_id = %trigger.persona_id,
                                    hourly_ceiling,
                                    "Backfill slot skipped: scheduled execution hourly cap exceeded"
                                );
                                break;
                            }

                            let slot_iso = slot.to_rfc3339();
                            let payload = cfg.payload().or_else(|| {
                                Some(synthesize_backfill_payload(&trigger, &cfg, &slot_iso))
                            });
                            let event_type = cfg.event_type().to_string();
                            match event_repo::publish(
                                pool,
                                CreatePersonaEventInput {
                                    event_type,
                                    source_type: "trigger".into(),
                                    source_id: Some(trigger.id.clone()),
                                    target_persona_id: Some(trigger.persona_id.clone()),
                                    project_id: None,
                                    payload,
                                    use_case_id: trigger.use_case_id.clone(),
                                },
                            ) {
                                Ok(_) => {
                                    tracing::debug!(
                                        trigger_id = %trigger.id,
                                        slot = %slot,
                                        "Backfill event published"
                                    );
                                    scheduler.triggers_fired.fetch_add(1, Ordering::Relaxed);
                                    *scheduled_publishes_by_persona
                                        .entry(trigger.persona_id.clone())
                                        .or_default() += 1;
                                    fired += 1;
                                    backfill_emitted_this_tick += 1;
                                    backfill_emitted_for_trigger += 1;
                                }
                                Err(e) => {
                                    tracing::error!(
                                        trigger_id = %trigger.id,
                                        "Backfill publish failed: {}", e
                                    );
                                    // Direction 3: a dropped backfill slot is a lost
                                    // fire too — give it a home instead of only a log.
                                    log_schedule_lost_fire_issue(
                                        pool,
                                        &trigger,
                                        &slot_iso,
                                        &e.to_string(),
                                    );
                                }
                            }
                        }
                    } // end if claimed (Finding #3 backfill claim)
                }
            }
        }

        // 3. Compute next trigger time first (anchored on the prior scheduled
        // fire so interval cadences don't drift later each cycle).
        let next = sched_logic::compute_next_trigger_at(&trigger, now);

        if trigger.trigger_type == "schedule"
            && schedule_hourly_cap_exceeded(
                pool,
                &trigger,
                now,
                hourly_ceiling,
                &scheduled_publishes_by_persona,
            )
        {
            // Skip path: advance the pointer only (CAS on version), never
            // last_triggered_at — the fired-watermark must stay put so the
            // rate-limited slot is replayed by backfill once headroom returns.
            match trigger_repo::advance_schedule_pointer(
                pool,
                &trigger.id,
                next,
                trigger.trigger_version,
            ) {
                Ok(true) => {}
                Ok(false) => {
                    tracing::debug!(trigger_id = %trigger.id, "Trigger already claimed by another tick, skipping rate-limit advance");
                    continue;
                }
                Err(e) => {
                    tracing::error!(trigger_id = %trigger.id, "Failed to mark rate-limited trigger: {}", e);
                    continue;
                }
            }
            log_schedule_rate_limit_issue(pool, &trigger, hourly_ceiling);
            tracing::warn!(
                trigger_id = %trigger.id,
                persona_id = %trigger.persona_id,
                hourly_ceiling,
                "Scheduled trigger skipped: execution hourly cap exceeded"
            );
            continue;
        }

        // 4. Atomically claim the trigger using compare-and-swap on trigger_version.
        // If an overlapping tick already advanced the schedule (incrementing the version),
        // the CAS returns false (0 rows affected) and we skip to prevent double-fire.
        match trigger_repo::mark_triggered(pool, &trigger.id, next, trigger.trigger_version) {
            Ok(true) => {}
            Ok(false) => {
                tracing::debug!(trigger_id = %trigger.id, "Trigger already claimed by another tick, skipping");
                continue;
            }
            Err(e) => {
                tracing::error!(trigger_id = %trigger.id, "Failed to mark trigger: {}", e);
                continue;
            }
        }

        // Direction 1 (missed-runs visibility): the live slot just fired via
        // mark_triggered. Any older missed slots NOT replayed by the backfill
        // path above were discarded (the default single-catch-up drops them).
        // Persist the count and emit a feed-visible event so an offline gap is
        // visible instead of silently lost. Only fires after a real multi-slot
        // gap (missed_total > emitted); a continuously-running scheduler sees
        // missed_total == 0 and records nothing.
        let discarded_missed = missed_total.saturating_sub(backfill_emitted_for_trigger);
        if discarded_missed > 0 {
            record_and_emit_missed_runs(pool, &trigger, discarded_missed as i64, &now_str);
        }

        // 5. Schedule advanced -- now safe to publish the event
        let event_type = cfg.event_type().to_string();

        // Fix 3: payload enrichment.
        //
        // When the trigger author set an explicit `payload` in config we
        // respect it verbatim. When they didn't, synthesize a self-documenting
        // diagnostic payload so `trigger_fired` rows in the Live Stream /
        // Event Log actually tell you WHAT fired, WHY, and WHEN — instead of
        // 158 rows of NULL like we had in the user's dead-data audit.
        let payload = cfg
            .payload()
            .or_else(|| Some(synthesize_trigger_fired_payload(&trigger, &cfg, &now_str)));

        // 5b. Destructive-action gate (UAT P5): `approval` mode HOLDS the fire for
        // human approval instead of publishing. The schedule has already advanced
        // (mark_triggered above), so the fire is captured exactly once; on approval
        // the held event is published (resolve_pending_trigger_fire).
        if trigger.unattended_mode == "approval" {
            match trigger_repo::insert_pending_fire(
                pool,
                &trigger.id,
                &trigger.persona_id,
                &event_type,
                payload.as_deref(),
                trigger.use_case_id.as_deref(),
            ) {
                Ok(pf) => tracing::info!(
                    trigger_id = %trigger.id,
                    persona_id = %trigger.persona_id,
                    pending_id = %pf.id,
                    "Trigger in approval mode — fire held for human approval (event not published)"
                ),
                Err(e) => {
                    tracing::error!(
                        trigger_id = %trigger.id,
                        "Failed to hold trigger fire for approval: {}", e
                    );
                    // Direction 3: the schedule advanced but the approval hold
                    // failed to persist, so this fire is lost — give it a home.
                    log_schedule_lost_fire_issue(pool, &trigger, &now_str, &e.to_string());
                }
            }
            continue;
        }

        match event_repo::publish(
            pool,
            CreatePersonaEventInput {
                event_type,
                source_type: "trigger".into(),
                source_id: Some(trigger.id.clone()),
                target_persona_id: Some(trigger.persona_id.clone()),
                project_id: None,
                payload,
                use_case_id: trigger.use_case_id.clone(),
            },
        ) {
            Ok(_) => {
                tracing::debug!(trigger_id = %trigger.id, "Trigger fired, event published");
                scheduler.triggers_fired.fetch_add(1, Ordering::Relaxed);
                if trigger.trigger_type == "schedule" {
                    *scheduled_publishes_by_persona
                        .entry(trigger.persona_id.clone())
                        .or_default() += 1;
                }
                fired += 1;
            }
            Err(e) => {
                tracing::error!(trigger_id = %trigger.id, "Failed to publish trigger event: {}", e);
                // Direction 3 (lost fires get a home): the schedule already
                // advanced via mark_triggered, so this fire is permanently lost.
                // Record a deduped healing issue instead of only a log line.
                log_schedule_lost_fire_issue(pool, &trigger, &now_str, &e.to_string());
            }
        }
    }

    fired
}
