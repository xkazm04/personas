use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use std::collections::HashMap;

use crate::db::models::{CreatePersonaEventInput, PersonaEvent, UpdateExecutionStatus};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::{personas as persona_repo, settings};
use crate::db::repos::resources::audit_log;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::{tools as tool_repo, triggers as trigger_repo};
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::bus;
use crate::engine::scheduler as sched_logic;
use crate::engine::subscription::{
    self, CleanupSubscription, CloudWebhookRelaySubscription, EventBusSubscription,
    PollingSubscription, RotationSubscription, TriggerSchedulerSubscription,
    CompositeSubscription, OAuthRefreshSubscription,
};
#[cfg(feature = "desktop")]
use crate::engine::subscription::{
    FileWatcherSubscription, ClipboardSubscription, AppFocusSubscription,
};
use crate::engine::ExecutionEngine;

/// Runtime state for the scheduler, shared across threads.
pub struct SchedulerState {
    running: AtomicBool,
    webhook_alive: AtomicBool,
    /// True when at least one execution is in-flight. Subscriptions use this
    /// to choose between active and idle polling intervals.
    active: AtomicBool,
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
            active: AtomicBool::new(false),
            events_processed: AtomicU64::new(0),
            events_delivered: AtomicU64::new(0),
            events_failed: AtomicU64::new(0),
            triggers_fired: AtomicU64::new(0),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Whether the system has active work (executions running, events pending).
    /// Used by subscriptions to choose between active and idle intervals.
    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    /// Mark the system as active or idle. Called by the execution engine
    /// when executions start/finish.
    pub fn set_active(&self, active: bool) {
        self.active.store(active, Ordering::Relaxed);
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
/// Returns a webhook shutdown sender -- hold onto it to keep the server running,
/// send `true` or drop it to trigger graceful shutdown.
pub fn start_loops(
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
    pool: DbPool,
    engine: Arc<ExecutionEngine>,
    rate_limiter: Arc<super::rate_limiter::RateLimiter>,
    tier_config: Arc<std::sync::Mutex<super::tier::TierConfig>>,
    cloud_client: Arc<tokio::sync::Mutex<Option<Arc<crate::cloud::client::CloudClient>>>>,
) -> tokio::sync::watch::Sender<bool> {
    scheduler.running.store(true, Ordering::Relaxed);
    tracing::info!("Scheduler starting via unified subscription model");

    // Build the HTTP client for the polling subscription
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Personas-Polling/1.0")
        .build()
        .unwrap_or_default();

    // Assemble all reactive subscriptions
    let mut subscriptions: Vec<Box<dyn subscription::ReactiveSubscription>> = vec![
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
            app: app.clone(),
        }),
        Box::new(CompositeSubscription {
            pool: pool.clone(),
        }),
        Box::new(subscription::AutoRollbackSubscription {
            pool: pool.clone(),
        }),
        Box::new(OAuthRefreshSubscription {
            pool: pool.clone(),
        }),
        Box::new(subscription::ZombieExecutionSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        Box::new(CloudWebhookRelaySubscription {
            cloud_client,
            pool: pool.clone(),
            app: app.clone(),
            state: Arc::new(tokio::sync::Mutex::new(
                super::cloud_webhook_relay::CloudWebhookRelayState::new(),
            )),
        }),
    ];

    // Desktop-only subscriptions: file watcher, clipboard monitor, app focus
    #[cfg(feature = "desktop")]
    {
        let (fw_state, fw_tx, fw_rx) = super::file_watcher::create_file_watcher();
        subscriptions.push(Box::new(FileWatcherSubscription {
            pool: pool.clone(),
            state: fw_state,
            tx: fw_tx,
            rx: fw_rx,
        }));
        subscriptions.push(Box::new(ClipboardSubscription {
            pool: pool.clone(),
            state: Arc::new(tokio::sync::Mutex::new(
                super::clipboard_monitor::ClipboardState::new(),
            )),
        }));
        subscriptions.push(Box::new(AppFocusSubscription {
            pool: pool.clone(),
            state: Arc::new(tokio::sync::Mutex::new(
                super::app_focus::AppFocusState::new(),
            )),
        }));
    }

    // Spawn all subscriptions through the unified scheduler
    subscription::spawn_subscriptions(subscriptions, scheduler.clone());

    // Smee.io relay (long-lived SSE connection, not a reactive subscription)
    tokio::spawn({
        let pool = pool.clone();
        let app = app.clone();
        async move {
            super::smee_relay::run_smee_relay(
                pool,
                app,
                Arc::new(tokio::sync::Mutex::new(
                    super::smee_relay::SmeeRelayState::new(),
                )),
            )
            .await;
        }
    });

    // Webhook HTTP server (not a reactive subscription -- it's a long-lived server)
    let (webhook_shutdown_tx, webhook_shutdown_rx) = tokio::sync::watch::channel(false);
    tokio::spawn({
        let pool = pool.clone();
        let scheduler = scheduler.clone();
        async move {
            scheduler.webhook_alive.store(true, Ordering::Relaxed);
            if let Err(e) = super::webhook::start_webhook_server(pool, rate_limiter, tier_config, webhook_shutdown_rx).await {
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
// Tick functions -- single-cycle logic extracted from the old loops.
// Called by the ReactiveSubscription implementations in subscription.rs.
// ---------------------------------------------------------------------------

/// One tick of the event bus: fetch pending events, match to subscriptions,
/// and dispatch executions.
///
/// Uses batch pre-fetching to minimize SQLite queries: instead of querying
/// per-event and per-match, we bulk-fetch subscriptions, listeners, personas,
/// and tools for the entire tick cycle (~3 queries instead of ~350).
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

    if events.is_empty() {
        // No pending events — check if any executions are running to set idle mode.
        // This is a cheap query that lets subscriptions reduce their polling cadence.
        let has_running = exec_repo::has_running_executions(pool).unwrap_or(false);
        scheduler.set_active(has_running);
        return;
    }
    // Events are pending — system is definitely active
    scheduler.set_active(true);

    // 2. Collect unique event types for batch queries
    let event_types: Vec<String> = {
        let mut types: Vec<String> = events.iter().map(|e| e.event_type.clone()).collect();
        types.sort();
        types.dedup();
        types
    };

    // 3. Bulk-fetch all subscriptions and listeners for these event types (2 queries)
    let all_subs = match event_repo::get_subscriptions_by_event_types(pool, &event_types) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Event bus: bulk subscription fetch failed: {}", e);
            // Fall through with empty — individual events will be marked skipped
            Vec::new()
        }
    };
    let all_listeners = trigger_repo::get_event_listeners_for_event_types(pool, &event_types)
        .unwrap_or_default();

    tracing::debug!(
        event_count = events.len(),
        event_types = event_types.len(),
        subscriptions = all_subs.len(),
        listeners = all_listeners.len(),
        "Event bus: batch pre-fetch complete"
    );

    // 4. Match all events against the pre-fetched subscriptions/listeners
    //    and collect (event_index, matches) pairs.
    let mut event_matches: Vec<(usize, Vec<bus::EventMatch>)> = Vec::new();
    for (idx, event) in events.iter().enumerate() {
        let _ = event_repo::update_status(pool, &event.id, "processing", None);

        // Match against legacy subscriptions
        let mut matches = bus::match_event(event, &all_subs);

        // Also match event_listener triggers (unified model).
        // Deduplicate by persona_id to avoid double-fire.
        let listener_matches = bus::match_event_listeners(event, &all_listeners);
        for lm in listener_matches {
            if !matches.iter().any(|m| m.persona_id == lm.persona_id) {
                matches.push(lm);
            }
        }

        tracing::debug!(
            event_id = %event.id,
            event_type = %event.event_type,
            match_count = matches.len(),
            "Event bus: matching complete"
        );

        if matches.is_empty() {
            tracing::info!(
                event_id = %event.id,
                event_type = %event.event_type,
                "Event bus: no matches found -- check subscription/listener configuration"
            );
            let _ = event_repo::update_status(pool, &event.id, "skipped", None);
            scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
            emit_event_to_frontend(app, event, "skipped");
        } else {
            event_matches.push((idx, matches));
        }
    }

    if event_matches.is_empty() {
        return;
    }

    // 5. Collect unique persona IDs across all matches for bulk persona + tool fetch
    let persona_ids: Vec<String> = {
        let mut ids: Vec<String> = event_matches
            .iter()
            .flat_map(|(_, matches)| matches.iter().map(|m| m.persona_id.clone()))
            .collect();
        ids.sort();
        ids.dedup();
        ids
    };

    // 6. Bulk-fetch personas (1 query)
    let persona_map: HashMap<String, crate::db::models::Persona> =
        match persona_repo::get_by_ids(pool, &persona_ids) {
            Ok(personas) => personas.into_iter().map(|p| (p.id.clone(), p)).collect(),
            Err(e) => {
                tracing::error!("Event bus: bulk persona fetch failed: {}", e);
                HashMap::new()
            }
        };

    // 7. Bulk-fetch tools for all matched personas (1 query)
    let tools_map: HashMap<String, Vec<crate::db::models::PersonaToolDefinition>> = {
        let pairs = tool_repo::get_tools_for_personas(pool, &persona_ids).unwrap_or_default();
        let mut map: HashMap<String, Vec<crate::db::models::PersonaToolDefinition>> =
            HashMap::new();
        for (pid, def) in pairs {
            map.entry(pid).or_default().push(def);
        }
        map
    };

    tracing::debug!(
        personas_fetched = persona_map.len(),
        personas_with_tools = tools_map.len(),
        "Event bus: batch persona/tool fetch complete"
    );

    // 8. Dispatch executions using the pre-fetched maps
    for (idx, matches) in &event_matches {
        let event = &events[*idx];
        let mut any_failed = false;

        for m in matches {
            // Resolve persona from map
            let persona = match persona_map.get(&m.persona_id) {
                Some(p) => p.clone(),
                None => {
                    tracing::warn!(persona_id = %m.persona_id, "Event bus: persona not found in batch");
                    any_failed = true;
                    continue;
                }
            };

            // Create execution record (must be per-match, not batchable)
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

            // Resolve tools from map
            let tools = tools_map
                .get(&persona.id)
                .cloned()
                .unwrap_or_default();

            // Parse input
            let input_val: Option<serde_json::Value> =
                m.payload.as_deref().and_then(|s| serde_json::from_str(s).ok());

            // Start execution (admit() handles concurrency atomically --
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

        let final_status = if any_failed { "partial" } else { "delivered" };
        let _ = event_repo::update_status(pool, &event.id, final_status, None);
        scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
        emit_event_to_frontend(app, event, final_status);
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
        // Skip polling triggers -- they are handled by the PollingSubscription
        // which does HTTP content-hash diffing before deciding whether to fire.
        // Skip event_listener triggers -- they are event-driven, not time-based.
        if trigger.trigger_type == "polling" || trigger.trigger_type == "event_listener" {
            continue;
        }

        // 2. Parse config once; reuse for event_type, payload, and next schedule time
        let cfg = trigger.parse_config();

        // Check if persona is over budget for scheduled triggers
        if trigger.trigger_type == "schedule" {
            let over_budget: bool = pool.get().map_err(|e| e.to_string()).and_then(|conn| {
                conn.query_row(
                    "SELECT COALESCE((
                        SELECT SUM(cost_usd)
                        FROM persona_executions
                        WHERE persona_id = ?1 AND created_at >= datetime('now', 'start of month')
                    ), 0.0) >= max_budget_usd
                    FROM personas
                    WHERE id = ?1 AND max_budget_usd IS NOT NULL",
                    rusqlite::params![trigger.persona_id],
                    |row| row.get(0)
                ).map_err(|e| e.to_string())
            }).unwrap_or(false);

            if over_budget {
                tracing::warn!(persona_id = %trigger.persona_id, "Cron agent paused due to exceeded budget");
                let next = sched_logic::compute_next_from_config(&cfg, now);
                let _ = trigger_repo::mark_triggered(pool, &trigger.id, next, trigger.next_trigger_at.as_deref());
                continue;
            }
        }

        // 3. Compute next trigger time first
        let next = sched_logic::compute_next_from_config(&cfg, now);

        // 4. Atomically claim the trigger using compare-and-swap on next_trigger_at.
        // If an overlapping tick already advanced the schedule, the CAS returns
        // false (0 rows affected) and we skip to prevent double-fire.
        match trigger_repo::mark_triggered(pool, &trigger.id, next, trigger.next_trigger_at.as_deref()) {
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

        // 5. Schedule advanced -- now safe to publish the event
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

    // Credential audit log: 90-day retention
    match audit_log::cleanup_old_entries(pool, 90) {
        Ok(n) if n > 0 => tracing::info!("Cleaned up {} old credential audit log entries (retention=90d)", n),
        Ok(_) => {}
        Err(e) => tracing::error!("Credential audit log cleanup error: {}", e),
    }

    // Execution log: 90-day retention, keep at least 50 per persona
    match exec_repo::cleanup_old_executions(pool, 90, 50) {
        Ok(n) if n > 0 => tracing::info!("Cleaned up {} old execution records (retention=90d, min_keep=50/persona)", n),
        Ok(_) => {}
        Err(e) => tracing::error!("Execution log cleanup error: {}", e),
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

// ---------------------------------------------------------------------------
// Zombie execution sweep
// ---------------------------------------------------------------------------

/// Tauri event emitted when zombie executions are detected and transitioned.
#[derive(Clone, Serialize)]
pub struct ZombieExecutionEvent {
    /// IDs of executions that were transitioned to incomplete.
    pub zombie_ids: Vec<String>,
    /// Number of zombies found in this sweep.
    pub count: usize,
}

/// One tick of the zombie execution sweep: find executions stuck in 'running'
/// beyond the threshold and transition them to 'incomplete'.
pub(crate) fn zombie_execution_tick(pool: &DbPool, app: &AppHandle) {
    match exec_repo::sweep_zombie_executions(pool) {
        Ok(zombie_ids) => {
            if !zombie_ids.is_empty() {
                let count = zombie_ids.len();
                tracing::warn!(
                    count,
                    ids = ?zombie_ids,
                    "Zombie execution sweep: transitioned {} stale executions to incomplete",
                    count,
                );
                let _ = app.emit("zombie-executions-detected", ZombieExecutionEvent {
                    zombie_ids,
                    count,
                });
            }
        }
        Err(e) => {
            tracing::error!("Zombie execution sweep failed: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scheduler_state_initial() {
        let state = SchedulerState::new();
        assert!(!state.is_running());
        assert!(!state.is_active());
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
}
