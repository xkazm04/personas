use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{CreatePersonaEventInput, TriggerConfig};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::engine::background::{self, SchedulerStats, SubscriptionHealth};
use crate::engine::{cron, scheduler as sched_logic};
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

#[tauri::command]
pub fn get_scheduler_status(state: State<'_, Arc<AppState>>) -> Result<SchedulerStats, AppError> {
    require_auth_sync(&state)?;
    Ok(state.scheduler.stats())
}

#[tauri::command]
pub async fn start_scheduler(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
) -> Result<SchedulerStats, AppError> {
    require_auth(&state).await?;
    if state.scheduler.is_running() {
        return Ok(state.scheduler.stats());
    }

    background::start_loops(
        state.scheduler.clone(),
        app,
        state.db.clone(),
        state.engine.clone(),
        state.rate_limiter.clone(),
        state.tier_config.clone(),
        state.cloud_client.clone(),
        state.cloud_webhook_relay_state.clone(),
        state.shared_event_relay_state.clone(),
        #[cfg(feature = "desktop")]
        state.ambient_context.clone(),
        #[cfg(feature = "desktop")]
        state.context_rule_engine.clone(),
        state.composite_state.clone(),
        state.smee_relay_notifier.clone(),
    );

    Ok(state.scheduler.stats())
}

#[tauri::command]
pub fn stop_scheduler(state: State<'_, Arc<AppState>>) -> Result<SchedulerStats, AppError> {
    require_auth_sync(&state)?;
    background::stop_loops(&state.scheduler);
    Ok(state.scheduler.stats())
}

/// Diagnostic: return per-subscription health status for all registered subscriptions.
#[tauri::command]
pub fn get_subscription_health(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SubscriptionHealth>, AppError> {
    require_auth_sync(&state)?;
    Ok(state.scheduler.subscription_health())
}

/// Direction 1 (missed-runs visibility): list every schedule trigger that has
/// scheduled slots discarded while the app was offline. The schedule UI renders
/// a "missed N while offline" badge with one-click backfill from this.
#[tauri::command]
pub fn list_schedule_missed_runs(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<trigger_repo::ScheduleMissedRuns>, AppError> {
    require_auth_sync(&state)?;
    trigger_repo::list_missed_runs(&state.db)
}

/// Clear a trigger's discarded-while-offline count after the user backfilled the
/// gap or explicitly dismissed the badge. Idempotent.
#[tauri::command]
pub fn clear_schedule_missed_runs(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    trigger_repo::clear_missed_runs(&state.db, &trigger_id)
}

/// Result of a user-initiated schedule backfill — see `backfill_schedule`.
#[derive(Debug, Clone, serde::Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BackfillResult {
    pub trigger_id: String,
    pub window_start: String,
    pub window_end: String,
    pub slots_enqueued: u32,
    /// True when the configured/default cap was reached and more slots in the
    /// requested window were dropped. UI surfaces this so the user knows the
    /// catch-up was partial.
    pub capped: bool,
    /// ISO 8601 fire times for the slots that were enqueued. Length matches
    /// `slots_enqueued`. Useful for the timeline progress display.
    pub slot_times: Vec<String>,
    pub failures: u32,
}

/// Maximum number of catch-up events one backfill request may enqueue. Lower
/// than `BACKFILL_HARD_CAP` (100) because this is user-initiated; if someone
/// genuinely needs more they can run the command again with a later start.
const BACKFILL_MAX_SLOTS_PER_REQUEST: usize = 100;

/// Replay every cron/interval fire time that would have occurred in the
/// half-open window `(start, end]` for the given schedule trigger. Each slot
/// is enqueued as a `persona_event` with a `backfill_slot: true` marker so
/// downstream code can distinguish catch-up from live fires.
///
/// Bounded by `BACKFILL_MAX_SLOTS_PER_REQUEST`. Returns details of what was
/// enqueued so the UI can show progress inline.
#[tauri::command]
pub fn backfill_schedule(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
    start: String,
    end: String,
) -> Result<BackfillResult, AppError> {
    require_auth_sync(&state)?;

    let start_dt = chrono::DateTime::parse_from_rfc3339(&start)
        .map_err(|e| AppError::Validation(format!("invalid start timestamp: {e}")))?
        .with_timezone(&chrono::Utc);
    let end_dt = chrono::DateTime::parse_from_rfc3339(&end)
        .map_err(|e| AppError::Validation(format!("invalid end timestamp: {e}")))?
        .with_timezone(&chrono::Utc);
    if end_dt <= start_dt {
        return Err(AppError::Validation(
            "end must be after start".into(),
        ));
    }
    // Refuse to fire slots scheduled in the future — backfill is for
    // catch-up only, not pre-scheduling.
    let now = chrono::Utc::now();
    let effective_end = if end_dt > now { now } else { end_dt };
    if effective_end <= start_dt {
        return Err(AppError::Validation(
            "backfill window does not cover any past time".into(),
        ));
    }

    let trigger = trigger_repo::get_by_id(&state.db, &trigger_id)?;
    if trigger.trigger_type != "schedule" {
        return Err(AppError::Validation(
            "backfill is only supported for schedule triggers".into(),
        ));
    }
    let cfg = trigger.parse_config();

    // Finding #3: refuse to backfill on an unparseable timezone instead of
    // silently replaying every slot at the wrong wall-clock hour. The live
    // scheduler refuses (next_trigger_at NULL) on a bad zone; surface that same
    // refusal here as a validation error rather than falling back to local.
    if let TriggerConfig::Schedule {
        timezone: Some(raw),
        ..
    } = &cfg
    {
        if let Err(err) = sched_logic::resolve_schedule_tz(Some(raw.as_str())) {
            return Err(AppError::Validation(format!(
                "backfill refused: schedule timezone '{}' is not a valid IANA zone ({})",
                err.raw, err.message
            )));
        }
    }

    // Finding #2: claim this trigger via the SAME `trigger_version` CAS the
    // live scheduler uses for its own backfill claim (see
    // `engine::background::trigger_scheduler_tick_counted`'s Finding #3 fix)
    // BEFORE computing or publishing anything below. Without this, the
    // `already_published` set fetched further down is a point-in-time read
    // with no re-check before insert and no unique constraint behind it: two
    // concurrent invocations of this command (double-click), or this command
    // racing the auto-backfill tick, both compute the same "missing" set and
    // both publish every slot in it -- duplicate `persona_events` rows, i.e.
    // the persona gets dispatched (and any external side effects it performs
    // re-run) twice for one slot. `advance_schedule_pointer` is reused rather
    // than a bespoke lock because it CASes on `trigger_version` without
    // moving `last_triggered_at`, so the loser just gets told to retry
    // instead of silently corrupting the schedule pointer.
    match trigger_repo::advance_schedule_pointer(
        &state.db,
        &trigger.id,
        trigger.next_trigger_at.clone(),
        trigger.trigger_version,
    ) {
        Ok(true) => {}
        Ok(false) => {
            return Err(AppError::Validation(
                "backfill is already in progress for this trigger (claimed by a concurrent \
                 backfill request or the auto-catch-up scheduler) -- please retry"
                    .into(),
            ));
        }
        Err(e) => {
            return Err(AppError::Validation(format!(
                "failed to claim trigger for backfill: {e}"
            )));
        }
    }

    // Cap to one over the limit so we can detect whether the user's window
    // actually overflowed (`capped == true`) versus fitting exactly.
    let probe_cap = BACKFILL_MAX_SLOTS_PER_REQUEST + 1;
    let mut slots = sched_logic::compute_slots_in_range(
        &cfg,
        start_dt,
        effective_end,
        cron::seed_hash(&trigger.id),
        probe_cap,
    );
    let mut capped = slots.len() > BACKFILL_MAX_SLOTS_PER_REQUEST;
    if capped {
        slots.truncate(BACKFILL_MAX_SLOTS_PER_REQUEST);
    }

    let event_type = cfg.event_type().to_string();
    let mut enqueued: u32 = 0;
    let mut failures: u32 = 0;
    let mut skipped_duplicate: u32 = 0;
    let mut slot_times: Vec<String> = Vec::with_capacity(slots.len());

    // Finding #2: dedup against backfill slots already published (a prior click
    // on this command OR the auto-backfill path), so re-clicking can't multiply
    // the exact same slots into duplicate executions.
    let already_published = event_repo::backfill_slot_times_for_source(&state.db, &trigger.id)?;

    // Finding #2: apply the SAME per-persona hourly ceiling the auto path uses,
    // so an on-demand replay can't blow past the scheduled-execution rate cap.
    let hourly_ceiling = background::schedule_executions_per_persona_hour(&state.db);
    let mut scheduled_publishes_by_persona: HashMap<String, i64> = HashMap::new();

    for slot in &slots {
        let slot_iso = slot.to_rfc3339();

        // Idempotent re-click: skip a slot already enqueued earlier.
        if already_published.contains(&slot_iso) {
            skipped_duplicate += 1;
            tracing::debug!(
                trigger_id = %trigger.id,
                slot = %slot_iso,
                "user-initiated backfill slot skipped — already published"
            );
            continue;
        }

        // Per-persona hourly cap, mirroring the auto path. Stop here (partial
        // catch-up, surfaced via `capped`) and log a healing issue so the
        // ceiling is visible instead of silently over-firing.
        if background::schedule_hourly_cap_exceeded(
            &state.db,
            &trigger,
            now,
            hourly_ceiling,
            &scheduled_publishes_by_persona,
        ) {
            background::log_schedule_rate_limit_issue(&state.db, &trigger, hourly_ceiling);
            tracing::warn!(
                trigger_id = %trigger.id,
                persona_id = %trigger.persona_id,
                hourly_ceiling,
                "user-initiated backfill halted: scheduled execution hourly cap exceeded"
            );
            capped = true;
            break;
        }

        let payload = cfg
            .payload()
            .or_else(|| Some(synthesize_user_backfill_payload(&trigger, &cfg, &slot_iso)));
        match event_repo::publish(
            &state.db,
            CreatePersonaEventInput {
                event_type: event_type.clone(),
                source_type: "trigger".into(),
                source_id: Some(trigger.id.clone()),
                target_persona_id: Some(trigger.persona_id.clone()),
                project_id: None,
                payload,
                use_case_id: trigger.use_case_id.clone(),
            },
        ) {
            Ok(_) => {
                enqueued += 1;
                *scheduled_publishes_by_persona
                    .entry(trigger.persona_id.clone())
                    .or_default() += 1;
                slot_times.push(slot_iso);
            }
            Err(e) => {
                tracing::warn!(
                    trigger_id = %trigger.id,
                    slot = %slot,
                    error = %e,
                    "user-initiated backfill publish failed"
                );
                failures += 1;
            }
        }
    }

    tracing::info!(
        trigger_id = %trigger.id,
        persona_id = %trigger.persona_id,
        window_start = %start_dt,
        window_end = %effective_end,
        enqueued,
        failures,
        skipped_duplicate,
        capped,
        "user-initiated backfill completed"
    );

    Ok(BackfillResult {
        trigger_id: trigger.id,
        window_start: start_dt.to_rfc3339(),
        window_end: effective_end.to_rfc3339(),
        slots_enqueued: enqueued,
        capped,
        slot_times,
        failures,
    })
}

/// Build the event payload for a user-initiated backfill slot.
///
/// Delegates the field synthesis to `engine::background::
/// synthesize_trigger_fired_payload`, the same builder the live fire uses. This
/// used to be a hand-copied field-by-field twin of that function with one extra
/// key — the copy is what would silently drift if the live payload shape
/// changed; delegating means the shared fields (trigger_id, trigger_type,
/// target_persona_id, fired_at, cron, interval_seconds, use_case_id) can never
/// diverge from the live payload here. Only the two marker booleans below are
/// local to the user-initiated path, and `user_backfill_payload_delegates_and_
/// adds_both_markers` pins that field-by-field.
///
/// CORRECTED 2026-08-17 (golden-paths/backfill-window-replay.md §7 D5). This
/// comment used to assert that the AUTO path did the same — that
/// `engine::background::synthesize_backfill_payload` "layers just
/// `backfill_slot: true` on top of that same call". **It does not.** That
/// function (`background.rs:2358`) still rebuilds the map field by field, and
/// the copy has already lost a field: the live builder matches
/// `TriggerConfig::Polling { interval_seconds }` and the twin matches only
/// `Schedule`. The loss is currently unreachable (the auto-backfill branch is
/// entered only for `trigger_type == "schedule"`), and nothing pins the twin to
/// anything. So: the delegation guarantee below is real for THIS function and
/// does not extend to the auto path. If you add a field to the live payload,
/// add it to `synthesize_backfill_payload` by hand — or make it delegate too,
/// which is three lines and is the right fix.
fn synthesize_user_backfill_payload(
    trigger: &crate::db::models::PersonaTrigger,
    cfg: &TriggerConfig,
    slot_fired_at: &str,
) -> String {
    let base = background::synthesize_trigger_fired_payload(trigger, cfg, slot_fired_at);
    let mut value: serde_json::Value =
        serde_json::from_str(&base).unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));
    if let serde_json::Value::Object(ref mut map) = value {
        map.insert("backfill_slot".into(), serde_json::Value::Bool(true));
        map.insert("user_backfill".into(), serde_json::Value::Bool(true));
    }
    serde_json::to_string(&value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// Pins the delegation to `background::synthesize_trigger_fired_payload`:
    /// the shared fields must match exactly what the live path produces (so a
    /// future change to that shared function is automatically picked up here
    /// instead of silently drifting out of sync), and both backfill markers
    /// must be layered on top.
    #[test]
    fn user_backfill_payload_delegates_and_adds_both_markers() {
        let trigger = make_trigger_for_test("t-cron-1", "p-alice", "schedule");
        let cfg = TriggerConfig::Schedule {
            cron: Some("*/15 * * * *".into()),
            interval_seconds: None,
            timezone: None,
            max_backfill: None,
            event_type: None,
            payload: None,
        };
        let fired_at = "2026-04-08T16:30:00Z";

        let live_json = background::synthesize_trigger_fired_payload(&trigger, &cfg, fired_at);
        let user_json = synthesize_user_backfill_payload(&trigger, &cfg, fired_at);

        let live: serde_json::Value = serde_json::from_str(&live_json).unwrap();
        let user: serde_json::Value = serde_json::from_str(&user_json).unwrap();

        // Every field the shared builder produces must survive untouched.
        for key in ["trigger_id", "trigger_type", "target_persona_id", "fired_at", "cron"] {
            assert_eq!(user[key], live[key], "field `{key}` diverged from the shared builder");
        }
        assert!(user.get("interval_seconds").is_none(), "no interval for cron-based schedules");

        // Both backfill markers are layered on top.
        assert_eq!(user["backfill_slot"], serde_json::Value::Bool(true));
        assert_eq!(user["user_backfill"], serde_json::Value::Bool(true));
        // The live (non-backfill) payload carries neither marker.
        assert!(live.get("backfill_slot").is_none());
        assert!(live.get("user_backfill").is_none());
    }
}
