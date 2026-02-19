use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::db::models::{CreatePersonaEventInput, PersonaEvent, UpdateExecutionStatus};
use crate::db::repos::{events as event_repo, executions as exec_repo, personas as persona_repo};
use crate::db::repos::{tools as tool_repo, triggers as trigger_repo};
use crate::db::DbPool;
use crate::engine::bus;
use crate::engine::scheduler as sched_logic;
use crate::engine::ExecutionEngine;

/// Runtime state for the scheduler, shared across threads.
pub struct SchedulerState {
    running: AtomicBool,
    events_processed: AtomicU64,
    events_delivered: AtomicU64,
    events_failed: AtomicU64,
    triggers_fired: AtomicU64,
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
            events_processed: AtomicU64::new(0),
            events_delivered: AtomicU64::new(0),
            events_failed: AtomicU64::new(0),
            triggers_fired: AtomicU64::new(0),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
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

/// Start both background loops. Returns immediately.
pub fn start_loops(
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
    pool: DbPool,
    engine: Arc<ExecutionEngine>,
) {
    scheduler.running.store(true, Ordering::Relaxed);
    tracing::info!("Scheduler starting: event bus (2s) + trigger scheduler (5s)");

    // Event bus loop
    tokio::spawn({
        let scheduler = scheduler.clone();
        let app = app.clone();
        let pool = pool.clone();
        let engine = engine.clone();
        async move {
            event_bus_loop(scheduler, app, pool, engine).await;
        }
    });

    // Trigger scheduler loop
    tokio::spawn({
        let scheduler = scheduler.clone();
        let pool = pool.clone();
        async move {
            trigger_scheduler_loop(scheduler, pool).await;
        }
    });

    // Cleanup loop (hourly)
    tokio::spawn({
        let scheduler = scheduler.clone();
        let pool = pool.clone();
        async move {
            cleanup_loop(scheduler, pool).await;
        }
    });
}

/// Stop both background loops.
pub fn stop_loops(scheduler: &SchedulerState) {
    scheduler.running.store(false, Ordering::Relaxed);
    tracing::info!("Scheduler stopped");
}

/// Event bus: poll pending events, match to subscriptions, trigger executions.
async fn event_bus_loop(
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
    pool: DbPool,
    engine: Arc<ExecutionEngine>,
) {
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    loop {
        interval.tick().await;
        if !scheduler.is_running() {
            break;
        }

        // 1. Get pending events
        let events = match event_repo::get_pending(&pool, Some(50), None) {
            Ok(e) => e,
            Err(e) => {
                tracing::error!("Event bus poll error: {}", e);
                continue;
            }
        };

        for event in events {
            // 2. Mark as processing
            let _ = event_repo::update_status(&pool, &event.id, "processing", None);

            // 3. Get matching subscriptions
            let subs = match event_repo::get_subscriptions_by_event_type(&pool, &event.event_type) {
                Ok(s) => s,
                Err(e) => {
                    tracing::error!(event_id = %event.id, "Failed to fetch subscriptions: {}", e);
                    let _ = event_repo::update_status(
                        &pool,
                        &event.id,
                        "failed",
                        Some("Failed to fetch subscriptions".into()),
                    );
                    scheduler.events_failed.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };

            // 4. Match event to subscriptions (pure logic)
            let matches = bus::match_event(&event, &subs);

            if matches.is_empty() {
                let _ = event_repo::update_status(&pool, &event.id, "skipped", None);
                scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
                emit_event_to_frontend(&app, &event, "skipped");
                continue;
            }

            let mut any_failed = false;
            for m in &matches {
                // 5. Get persona
                let persona = match persona_repo::get_by_id(&pool, &m.persona_id) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::warn!(persona_id = %m.persona_id, "Event bus: persona not found: {}", e);
                        any_failed = true;
                        continue;
                    }
                };

                // 6. Check concurrency
                if !engine
                    .has_capacity(&persona.id, persona.max_concurrent)
                    .await
                {
                    tracing::warn!(
                        persona_id = %persona.id,
                        "Event bus: no capacity, skipping delivery"
                    );
                    any_failed = true;
                    continue;
                }

                // 7. Create execution record
                let exec = match exec_repo::create(
                    &pool,
                    &persona.id,
                    None,
                    m.payload.clone(),
                    None,
                ) {
                    Ok(e) => e,
                    Err(e) => {
                        tracing::error!("Event bus: failed to create execution: {}", e);
                        any_failed = true;
                        continue;
                    }
                };

                // 8. Update to running
                let _ = exec_repo::update_status(
                    &pool,
                    &exec.id,
                    UpdateExecutionStatus {
                        status: "running".into(),
                        ..Default::default()
                    },
                );

                // 9. Get tools
                let tools = tool_repo::get_tools_for_persona(&pool, &persona.id)
                    .unwrap_or_default();

                // 10. Parse input
                let input_val: Option<serde_json::Value> =
                    m.payload.as_deref().and_then(|s| serde_json::from_str(s).ok());

                // 11. Start execution
                if let Err(e) = engine
                    .start_execution(
                        app.clone(),
                        pool.clone(),
                        exec.id.clone(),
                        persona,
                        tools,
                        input_val,
                    )
                    .await
                {
                    tracing::error!(execution_id = %exec.id, "Event bus: failed to start execution: {}", e);
                    any_failed = true;
                    continue;
                }

                scheduler.events_delivered.fetch_add(1, Ordering::Relaxed);
            }

            // 12. Update event status
            let final_status = if any_failed { "partial" } else { "delivered" };
            let _ = event_repo::update_status(&pool, &event.id, final_status, None);
            scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
            emit_event_to_frontend(&app, &event, final_status);
        }
    }
    tracing::info!("Event bus loop exited");
}

/// Trigger scheduler: poll due triggers, publish events.
async fn trigger_scheduler_loop(scheduler: Arc<SchedulerState>, pool: DbPool) {
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    loop {
        interval.tick().await;
        if !scheduler.is_running() {
            break;
        }

        let now = chrono::Utc::now();
        let now_str = now.to_rfc3339();

        // 1. Get due triggers
        let triggers = match trigger_repo::get_due(&pool, &now_str) {
            Ok(t) => t,
            Err(e) => {
                tracing::error!("Trigger poll error: {}", e);
                continue;
            }
        };

        for trigger in triggers {
            // 2. Publish event
            let event_type = sched_logic::trigger_event_type(&trigger);
            let payload = sched_logic::trigger_payload(&trigger);

            match event_repo::publish(
                &pool,
                CreatePersonaEventInput {
                    event_type,
                    source_type: "trigger".into(),
                    source_id: Some(trigger.id.clone()),
                    target_persona_id: Some(trigger.persona_id.clone()),
                    project_id: None,
                    payload,
                },
            ) {
                Ok(_) => {
                    tracing::debug!(trigger_id = %trigger.id, "Trigger fired, event published");
                }
                Err(e) => {
                    tracing::error!(trigger_id = %trigger.id, "Failed to publish trigger event: {}", e);
                    continue;
                }
            }

            // 3. Compute next trigger time
            let next = sched_logic::compute_next_trigger_at(&trigger, now);

            // 4. Mark triggered (returns false if trigger was deleted between get_due and now)
            match trigger_repo::mark_triggered(&pool, &trigger.id, next) {
                Ok(true) => {
                    scheduler.triggers_fired.fetch_add(1, Ordering::Relaxed);
                }
                Ok(false) => {
                    tracing::warn!(trigger_id = %trigger.id, "Trigger was deleted before mark_triggered, skipping");
                }
                Err(e) => {
                    tracing::error!(trigger_id = %trigger.id, "Failed to mark trigger: {}", e);
                }
            }
        }
    }
    tracing::info!("Trigger scheduler loop exited");
}

/// Cleanup: delete old processed events periodically.
async fn cleanup_loop(scheduler: Arc<SchedulerState>, pool: DbPool) {
    let mut interval = tokio::time::interval(Duration::from_secs(3600));
    loop {
        interval.tick().await;
        if !scheduler.is_running() {
            break;
        }
        match event_repo::cleanup(&pool, Some(7)) {
            Ok(n) if n > 0 => tracing::info!("Cleaned up {} old events", n),
            Ok(_) => {}
            Err(e) => tracing::error!("Event cleanup error: {}", e),
        }
    }
}

/// Emit event update to frontend for realtime visualization.
fn emit_event_to_frontend(app: &AppHandle, event: &PersonaEvent, status: &str) {
    #[derive(Clone, Serialize)]
    struct EventBusPayload {
        id: String,
        project_id: String,
        event_type: String,
        source_type: String,
        source_id: Option<String>,
        target_persona_id: Option<String>,
        payload: Option<String>,
        status: String,
        error_message: Option<String>,
        processed_at: Option<String>,
        created_at: String,
    }

    let payload = EventBusPayload {
        id: event.id.clone(),
        project_id: event.project_id.clone(),
        event_type: event.event_type.clone(),
        source_type: event.source_type.clone(),
        source_id: event.source_id.clone(),
        target_persona_id: event.target_persona_id.clone(),
        payload: event.payload.clone(),
        status: status.to_string(),
        processed_at: Some(chrono::Utc::now().to_rfc3339()),
        error_message: event.error_message.clone(),
        created_at: event.created_at.clone(),
    };

    let _ = app.emit("event-bus", payload);
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
