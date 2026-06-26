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

/// Build the event payload for a user-initiated backfill slot. Mirrors
/// `engine::background::synthesize_backfill_payload` but also marks the
/// payload with `user_backfill: true` so consumers can tell scheduler-driven
/// catch-up apart from on-demand replay.
fn synthesize_user_backfill_payload(
    trigger: &crate::db::models::PersonaTrigger,
    cfg: &TriggerConfig,
    slot_fired_at: &str,
) -> String {
    let (cron_expr, interval_seconds) = match cfg {
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
    meta.insert("user_backfill".into(), serde_json::Value::Bool(true));
    if let Some(c) = cron_expr {
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
