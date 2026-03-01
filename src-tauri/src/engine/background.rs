use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::db::models::{CreatePersonaEventInput, PersonaEvent, UpdateExecutionStatus};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::{personas as persona_repo, settings};
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::{tools as tool_repo, triggers as trigger_repo};
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::bus;
use crate::engine::scheduler as sched_logic;
use crate::engine::subscription::{
    self, CleanupSubscription, EventBusSubscription, PollingSubscription,
    RotationSubscription, TriggerSchedulerSubscription,
};
use crate::engine::ExecutionEngine;

/// Runtime state for the scheduler, shared across threads.
pub struct SchedulerState {
    running: AtomicBool,
    webhook_alive: AtomicBool,
    events_processed: AtomicU64,
    events_delivered: AtomicU64,
    events_failed: AtomicU64,
    pub(crate) triggers_fired: AtomicU64,
}

impl Default for SchedulerState {
    fn default() -> Self {
        Self::new()
    }
}

impl SchedulerState {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            webhook_alive: AtomicBool::new(false),
            events_processed: AtomicU64::new(0),
            events_delivered: AtomicU64::new(0),
            events_failed: AtomicU64::new(0),
            triggers_fired: AtomicU64::new(0),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn is_webhook_alive(&self) -> bool {
        self.webhook_alive.load(Ordering::Relaxed)
    }

    pub fn stats(&self) -> SchedulerStats {
        SchedulerStats {
            running: self.running.load(Ordering::Relaxed),
            events_processed: self.events_processed.load(Ordering::Relaxed),
            events_delivered: self.events_delivered.load(Ordering::Relaxed),
            events_failed: self.events_failed.load(Ordering::Relaxed),
            triggers_fired: self.triggers_fired.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SchedulerStats {
    pub running: bool,
    pub events_processed: u64,
    pub events_delivered: u64,
    pub events_failed: u64,
    pub triggers_fired: u64,
}

/// Start all background loops via the unified subscription model.
///
/// Returns a webhook shutdown sender — hold onto it to keep the server running,
/// send `true` or drop it to trigger graceful shutdown.
pub fn start_loops(
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
    pool: DbPool,
    engine: Arc<ExecutionEngine>,
    rate_limiter: Arc<super::rate_limiter::RateLimiter>,
) -> tokio::sync::watch::Sender<bool> {
    scheduler.running.store(true, Ordering::Relaxed);
    tracing::info!("Scheduler starting via unified subscription model: event_bus (2s) + trigger_scheduler (5s) + polling (10s) + cleanup (3600s) + rotation (60s) + webhook server (port 9420)");

    // Build the HTTP client for the polling subscription
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Personas-Polling/1.0")
        .build()
        .unwrap_or_default();

    // Assemble all reactive subscriptions
    let subscriptions: Vec<Box<dyn subscription::ReactiveSubscription>> = vec![
        Box::new(EventBusSubscription {
            scheduler: scheduler.clone(),
            app: app.clone(),
            pool: pool.clone(),
            engine,
        }),
        Box::new(TriggerSchedulerSubscription {
            scheduler: scheduler.clone(),
            pool: pool.clone(),
        }),
        Box::new(PollingSubscription {
            scheduler: scheduler.clone(),
            pool: pool.clone(),
            http,
        }),
        Box::new(CleanupSubscription {
            pool: pool.clone(),
        }),
        Box::new(RotationSubscription {
            pool: pool.clone(),
        }),
    ];

    // Spawn all subscriptions through the unified scheduler
    subscription::spawn_subscriptions(subscriptions, scheduler.clone());

    // Webhook HTTP server (not a reactive subscription — it's a long-lived server)
    let (webhook_shutdown_tx, webhook_shutdown_rx) = tokio::sync::watch::channel(false);
    tokio::spawn({
        let pool = pool.clone();
        let scheduler = scheduler.clone();
        async move {
            scheduler.webhook_alive.store(true, Ordering::Relaxed);
            if let Err(e) = super::webhook::start_webhook_server(pool, rate_limiter, webhook_shutdown_rx).await {
                tracing::error!("Webhook server failed: {}", e);
            }
            scheduler.webhook_alive.store(false, Ordering::Relaxed);
        }
    });

    webhook_shutdown_tx
}

/// Stop all background loops.
pub fn stop_loops(scheduler: &SchedulerState) {
    scheduler.running.store(false, Ordering::Relaxed);
    tracing::info!("Scheduler stopped");
}

// ---------------------------------------------------------------------------
// Tick functions — single-cycle logic extracted from the old loops.
// Called by the ReactiveSubscription implementations in subscription.rs.
// ---------------------------------------------------------------------------

/// One tick of the event bus: fetch pending events, match to subscriptions,
/// and dispatch executions.
pub(crate) async fn event_bus_tick(
    scheduler: &SchedulerState,
    app: &AppHandle,
    pool: &DbPool,
    engine: &ExecutionEngine,
) {
    // 1. Get pending events
    let events = match event_repo::get_pending(pool, Some(50), None) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!("Event bus poll error: {}", e);
            return;
        }
    };

    for event in events {
        // 2. Mark as processing
        let _ = event_repo::update_status(pool, &event.id, "processing", None);

        // 3. Get matching subscriptions from legacy table AND event_listener triggers.
        // Both paths are checked to handle pre-migration and post-migration states.
        let subs = match event_repo::get_subscriptions_by_event_type(pool, &event.event_type) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(event_id = %event.id, "Failed to fetch subscriptions: {}", e);
                let _ = event_repo::update_status(
                    pool,
                    &event.id,
                    "failed",
                    Some("Failed to fetch subscriptions".into()),
                );
                scheduler.events_failed.fetch_add(1, Ordering::Relaxed);
                continue;
            }
        };

        // 4. Match event to legacy subscriptions
        let mut matches = bus::match_event(&event, &subs);

        // 4b. Also match event_listener triggers (unified model).
        // Deduplicate by persona_id to avoid double-fire when a subscription
        // has been migrated to a trigger but the legacy row still exists.
        if let Ok(listeners) = trigger_repo::get_event_listeners_for_event_type(pool, &event.event_type) {
            let listener_matches = bus::match_event_listeners(&event, &listeners);
            for lm in listener_matches {
                if !matches.iter().any(|m| m.persona_id == lm.persona_id) {
                    matches.push(lm);
                }
            }
        }

        if matches.is_empty() {
            let _ = event_repo::update_status(pool, &event.id, "skipped", None);
            scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
            emit_event_to_frontend(app, &event, "skipped");
            continue;
        }

        let mut any_failed = false;
        for m in &matches {
            // 5. Get persona
            let persona = match persona_repo::get_by_id(pool, &m.persona_id) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(persona_id = %m.persona_id, "Event bus: persona not found: {}", e);
                    any_failed = true;
                    continue;
                }
            };

            // 6. Create execution record
            let exec = match exec_repo::create(
                pool,
                &persona.id,
                None,
                m.payload.clone(),
                None,
                m.use_case_id.clone(),
            ) {
                Ok(e) => e,
                Err(e) => {
                    tracing::error!("Event bus: failed to create execution: {}", e);
                    any_failed = true;
                    continue;
                }
            };

            // 7. Get tools
            let tools = tool_repo::get_tools_for_persona(pool, &persona.id)
                .unwrap_or_default();

            // 8. Parse input
            let input_val: Option<serde_json::Value> =
                m.payload.as_deref().and_then(|s| serde_json::from_str(s).ok());

            // 9. Start execution (admit() handles concurrency atomically —
            //    no separate has_capacity check to avoid TOCTOU gap)
            if let Err(e) = engine
                .start_execution(
                    app.clone(),
                    pool.clone(),
                    exec.id.clone(),
                    persona,
                    tools,
                    input_val,
                    None,
                )
                .await
            {
                tracing::error!(execution_id = %exec.id, "Event bus: failed to start execution: {}", e);
                // Mark the orphaned execution record as failed
                super::persist_status_update(
                    pool,
                    Some(app),
                    &exec.id,
                    UpdateExecutionStatus {
                        status: crate::engine::types::ExecutionState::Failed,
                        error_message: Some(e.to_string()),
                        ..Default::default()
                    },
                )
                .await;
                any_failed = true;
                continue;
            }

            scheduler.events_delivered.fetch_add(1, Ordering::Relaxed);
        }

        // 12. Update event status
        let final_status = if any_failed { "partial" } else { "delivered" };
        let _ = event_repo::update_status(pool, &event.id, final_status, None);
        scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
        emit_event_to_frontend(app, &event, final_status);
    }
}

/// One tick of the trigger scheduler: fetch due triggers, evaluate, publish events.
pub(crate) fn trigger_scheduler_tick(scheduler: &SchedulerState, pool: &DbPool) {
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();

    // 1. Get due triggers
    let triggers = match trigger_repo::get_due(pool, &now_str) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Trigger poll error: {}", e);
            return;
        }
    };

    for trigger in triggers {
        // Skip polling triggers — they are handled by the PollingSubscription
        // which does HTTP content-hash diffing before deciding whether to fire.
        // Skip event_listener triggers — they are event-driven, not time-based.
        if trigger.trigger_type == "polling" || trigger.trigger_type == "event_listener" {
            continue;
        }

        // 2. Parse config once; reuse for event_type, payload, and next schedule time
        let cfg = trigger.parse_config();

        // 3. Compute next trigger time first
        let next = sched_logic::compute_next_from_config(&cfg, now);

        // 4. Advance the schedule BEFORE publishing the event.
        // This prevents duplicate events when mark_triggered fails after
        // a successful publish (the trigger stays "due" with stale
        // next_trigger_at and get_due returns it again next tick).
        match trigger_repo::mark_triggered(pool, &trigger.id, next) {
            Ok(true) => {}
            Ok(false) => {
                tracing::warn!(trigger_id = %trigger.id, "Trigger was deleted before mark_triggered, skipping");
                continue;
            }
            Err(e) => {
                tracing::error!(trigger_id = %trigger.id, "Failed to mark trigger: {}", e);
                continue;
            }
        }

        // 5. Schedule advanced — now safe to publish the event
        let event_type = cfg.event_type().to_string();
        let payload = cfg.payload();

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
            }
            Err(e) => {
                tracing::error!(trigger_id = %trigger.id, "Failed to publish trigger event: {}", e);
            }
        }
    }
}

/// One tick of the cleanup subscription: delete old processed events.
///
/// Reads `event_retention_days` from app_settings (default 30 days).
pub(crate) fn cleanup_tick(pool: &DbPool) {
    let retention_days = settings::get(pool, settings_keys::EVENT_RETENTION_DAYS)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(30);

    match event_repo::cleanup(pool, Some(retention_days)) {
        Ok(n) if n > 0 => tracing::info!("Cleaned up {} old events (retention={}d)", n, retention_days),
        Ok(_) => {}
        Err(e) => tracing::error!("Event cleanup error: {}", e),
    }
}

/// Emit event update to frontend for realtime visualization.
fn emit_event_to_frontend(app: &AppHandle, event: &PersonaEvent, status: &str) {
    let mut payload = event.clone();
    payload.status = status.to_string();
    payload.processed_at = Some(chrono::Utc::now().to_rfc3339());

    if let Err(e) = app.emit("event-bus", payload) {
        tracing::warn!(event_id = %event.id, error = %e, "Failed to emit event-bus event to frontend");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scheduler_state_initial() {
        let state = SchedulerState::new();
        assert!(!state.is_running());
        let stats = state.stats();
        assert!(!stats.running);
        assert_eq!(stats.events_processed, 0);
        assert_eq!(stats.triggers_fired, 0);
    }

    #[test]
    fn test_scheduler_state_toggle() {
        let state = SchedulerState::new();
        state.running.store(true, Ordering::Relaxed);
        assert!(state.is_running());
        state.running.store(false, Ordering::Relaxed);
        assert!(!state.is_running());
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
}
