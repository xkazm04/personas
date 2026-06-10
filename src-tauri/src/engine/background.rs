use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use std::collections::HashMap;

use super::event_registry::{emit_event_bus, event_name};
use crate::daemon::lock::{default_data_dir, trigger_type_to_kind, DaemonLock, LockFileContents};
use crate::db::models::{
    CreatePersonaEventInput, PersonaEvent, PersonaEventStatus, UpdateExecutionStatus,
};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::{personas as persona_repo, settings};
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::healing as healing_repo;
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::{tools as tool_repo, triggers as trigger_repo};
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::bus;
use crate::engine::scheduler as sched_logic;
use crate::engine::subscription::{
    self, CleanupSubscription, CloudWebhookRelaySubscription, CompositeSubscription,
    EventBusSubscription, OAuthRefreshSubscription, PollingSubscription, RotationSubscription,
    SharedEventRelaySubscription, TriggerSchedulerSubscription,
};
#[cfg(feature = "desktop")]
use crate::engine::subscription::{
    AppFocusSubscription, ClipboardSubscription, ContextRuleSubscription, FileWatcherSubscription,
};
use crate::engine::ExecutionEngine;

/// Per-subscription health snapshot including tick latency, counts, and error tracking.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionHealth {
    pub name: String,
    /// Whether the subscription loop is currently running.
    pub alive: bool,
    /// ISO 8601 timestamp when the subscription loop started.
    pub started_at: Option<String>,
    pub interval_ms: u64,
    pub last_tick_duration_ms: u64,
    pub max_tick_duration_ms: u64,
    /// True when the last tick took longer than the subscription's configured interval.
    pub overrun: bool,
    /// Total number of successful ticks since startup.
    pub tick_count: u64,
    /// Total number of tick errors (panics caught by the panic boundary).
    pub error_count: u64,
    /// Consecutive panics without a successful tick in between.
    /// Resets to 0 after a successful tick.
    pub consecutive_panics: u32,
    /// ISO 8601 timestamp of the last completed tick (success or panic).
    pub last_tick_at: Option<String>,
    /// Rolling average tick duration in milliseconds.
    pub avg_tick_duration_ms: u64,
    /// Total number of ticks that exceeded their configured interval.
    pub overrun_count: u64,
    /// Total number of ticks that exceeded 80% of the configured interval
    /// but did not fully overrun.
    pub slow_tick_count: u64,
}

/// Tauri event emitted when a subscription tick panics.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionCrashEvent {
    pub name: String,
    pub panic_message: String,
    pub consecutive_panics: u32,
    pub timestamp: String,
}

/// Tauri event emitted when overdue triggers are fired (startup sweep or recovery).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverdueTriggersEvent {
    pub recovered: u32,
    pub timestamp: String,
}

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
    /// Total chain cascade evaluations (one per hop).
    chain_cascades_total: AtomicU64,
    /// Cumulative wall-clock time spent evaluating chain cascades (ms).
    chain_cascade_duration_ms: AtomicU64,
    /// Executions rejected due to queue backpressure (queue full).
    queue_rejections: AtomicU64,
    /// Subscription ticks that panicked and were caught by the panic boundary.
    subscriptions_crashed: AtomicU64,
    /// Chain trace continuity breaks: payload parse failures that caused a
    /// chain_trace_id to be lost, resulting in orphaned trace roots.
    trace_continuity_breaks: AtomicU64,
    /// Per-subscription health tracking (latency, tick counts, errors).
    subscription_health: std::sync::Mutex<HashMap<String, SubscriptionHealth>>,
    /// Retained JoinHandles for spawned subscription tasks. Prevents silent
    /// task drops and enables future graceful-shutdown awaits.
    subscription_handles: std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>,
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
            chain_cascades_total: AtomicU64::new(0),
            chain_cascade_duration_ms: AtomicU64::new(0),
            queue_rejections: AtomicU64::new(0),
            subscriptions_crashed: AtomicU64::new(0),
            trace_continuity_breaks: AtomicU64::new(0),
            subscription_health: std::sync::Mutex::new(HashMap::new()),
            subscription_handles: std::sync::Mutex::new(Vec::new()),
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
            chain_cascades_total: self.chain_cascades_total.load(Ordering::Relaxed),
            chain_cascade_duration_ms: self.chain_cascade_duration_ms.load(Ordering::Relaxed),
            queue_rejections: self.queue_rejections.load(Ordering::Relaxed),
            subscriptions_crashed: self.subscriptions_crashed.load(Ordering::Relaxed),
            trace_continuity_breaks: self.trace_continuity_breaks.load(Ordering::Relaxed),
            subscription_health: self.subscription_health(),
        }
    }

    /// Record metrics from a chain cascade hop evaluation.
    pub fn record_chain_cascade(&self, metrics: &super::chain::CascadeMetrics) {
        if metrics.triggers_evaluated > 0 {
            self.chain_cascades_total.fetch_add(1, Ordering::Relaxed);
            self.chain_cascade_duration_ms
                .fetch_add(metrics.duration_ms, Ordering::Relaxed);
        }
    }

    /// Increment the queue rejection counter. Called when an execution is
    /// rejected due to backpressure (queue full).
    pub fn record_queue_rejection(&self) {
        self.queue_rejections.fetch_add(1, Ordering::Relaxed);
    }

    /// Record a subscription tick panic. Called from `run_single` when a
    /// panic boundary catches a panicked tick.
    pub fn record_subscription_crash(&self, name: &str) {
        self.subscriptions_crashed.fetch_add(1, Ordering::Relaxed);

        let now = chrono::Utc::now().to_rfc3339();
        let mut map = self
            .subscription_health
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let entry = map
            .entry(name.to_string())
            .or_insert_with(|| SubscriptionHealth {
                name: name.to_string(),
                alive: false,
                started_at: None,
                interval_ms: 0,
                last_tick_duration_ms: 0,
                max_tick_duration_ms: 0,
                overrun: false,
                tick_count: 0,
                error_count: 0,
                consecutive_panics: 0,
                last_tick_at: None,
                avg_tick_duration_ms: 0,
                overrun_count: 0,
                slow_tick_count: 0,
            });
        entry.error_count += 1;
        entry.consecutive_panics += 1;
        entry.last_tick_at = Some(now);

        tracing::error!(
            subscription = name,
            total_crashes = self.subscriptions_crashed.load(Ordering::Relaxed),
            consecutive_panics = entry.consecutive_panics,
            "Subscription tick panicked — crash counter incremented"
        );
    }

    /// Record a successful tick duration for a subscription. Called from `run_single`.
    pub fn record_tick_latency(&self, name: &str, interval: Duration, elapsed: Duration) {
        let elapsed_ms = elapsed.as_millis() as u64;
        let interval_ms = interval.as_millis() as u64;
        let overrun = elapsed_ms > interval_ms;
        let now = chrono::Utc::now().to_rfc3339();

        let mut map = self
            .subscription_health
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let entry = map
            .entry(name.to_string())
            .or_insert_with(|| SubscriptionHealth {
                name: name.to_string(),
                alive: false,
                started_at: None,
                interval_ms,
                last_tick_duration_ms: 0,
                max_tick_duration_ms: 0,
                overrun: false,
                tick_count: 0,
                error_count: 0,
                consecutive_panics: 0,
                last_tick_at: None,
                avg_tick_duration_ms: 0,
                overrun_count: 0,
                slow_tick_count: 0,
            });
        entry.tick_count += 1;
        entry.consecutive_panics = 0; // successful tick resets consecutive panic counter
        entry.last_tick_at = Some(now);
        entry.interval_ms = interval_ms; // update in case active/idle switch changed it

        // Rolling average: avg = ((avg * (n-1)) + new) / n
        let n = entry.tick_count;
        entry.avg_tick_duration_ms = if n == 1 {
            elapsed_ms
        } else {
            (entry.avg_tick_duration_ms * (n - 1) + elapsed_ms) / n
        };

        entry.last_tick_duration_ms = elapsed_ms;
        if elapsed_ms > entry.max_tick_duration_ms {
            entry.max_tick_duration_ms = elapsed_ms;
        }
        entry.overrun = overrun;

        // Track cumulative overrun and slow-tick counts
        if overrun {
            entry.overrun_count += 1;
        }
        // Slow tick: exceeded 80% of interval but not a full overrun
        let slow_threshold = interval_ms * 4 / 5;
        if elapsed_ms > slow_threshold && !overrun {
            entry.slow_tick_count += 1;
        }
    }

    /// Snapshot of per-subscription health status.
    pub fn subscription_health(&self) -> Vec<SubscriptionHealth> {
        let map = self
            .subscription_health
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        map.values().cloned().collect()
    }

    /// Mark a subscription as alive when its loop starts. Called from `run_single`.
    pub fn mark_subscription_alive(&self, name: &str, interval_ms: u64) {
        let now = chrono::Utc::now().to_rfc3339();
        let mut map = self
            .subscription_health
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let entry = map
            .entry(name.to_string())
            .or_insert_with(|| SubscriptionHealth {
                name: name.to_string(),
                alive: false,
                started_at: None,
                interval_ms,
                last_tick_duration_ms: 0,
                max_tick_duration_ms: 0,
                overrun: false,
                tick_count: 0,
                error_count: 0,
                consecutive_panics: 0,
                last_tick_at: None,
                avg_tick_duration_ms: 0,
                overrun_count: 0,
                slow_tick_count: 0,
            });
        entry.alive = true;
        entry.started_at = Some(now);
        entry.interval_ms = interval_ms;
    }

    /// Mark a subscription as dead when its loop exits. Called from `run_single`.
    pub fn mark_subscription_dead(&self, name: &str) {
        let mut map = self
            .subscription_health
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = map.get_mut(name) {
            entry.alive = false;
        }
    }

    /// Store retained JoinHandles for spawned subscription tasks.
    pub fn store_subscription_handles(&self, handles: Vec<tokio::task::JoinHandle<()>>) {
        let mut h = self
            .subscription_handles
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *h = handles;
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerStats {
    pub running: bool,
    pub events_processed: u64,
    pub events_delivered: u64,
    pub events_failed: u64,
    pub triggers_fired: u64,
    pub chain_cascades_total: u64,
    pub chain_cascade_duration_ms: u64,
    pub queue_rejections: u64,
    pub subscriptions_crashed: u64,
    pub trace_continuity_breaks: u64,
    pub subscription_health: Vec<SubscriptionHealth>,
}

/// Start all background loops via the unified subscription model.
///
/// Returns a webhook shutdown sender -- hold onto it to keep the server running,
/// send `true` or drop it to trigger graceful shutdown.
#[allow(clippy::too_many_arguments)]
pub fn start_loops(
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
    pool: DbPool,
    engine: Arc<ExecutionEngine>,
    rate_limiter: Arc<super::rate_limiter::RateLimiter>,
    tier_config: Arc<std::sync::Mutex<super::tier::TierConfig>>,
    cloud_client: Arc<tokio::sync::Mutex<Option<Arc<crate::cloud::client::CloudClient>>>>,
    cloud_webhook_relay_state: Arc<
        tokio::sync::Mutex<super::cloud_webhook_relay::CloudWebhookRelayState>,
    >,
    shared_event_relay_state: Arc<
        tokio::sync::Mutex<super::shared_event_relay::SharedEventRelayState>,
    >,
    #[cfg(feature = "desktop")] ambient_ctx: super::ambient_context::AmbientContextHandle,
    #[cfg(feature = "desktop")] context_rule_engine: super::context_rules::ContextRuleEngineHandle,
    composite_state: super::composite::CompositeState,
    smee_notifier: super::smee_relay::SmeeRelayNotifier,
) -> tokio::sync::watch::Sender<bool> {
    scheduler.running.store(true, Ordering::Relaxed);
    tracing::info!("Scheduler starting via unified subscription model");

    // V8: re-attach orchestrator tick tasks to team assignments orphaned by the
    // last shutdown (status running/queued with no task) — their in-flight
    // steps re-queue as pending and the assignment resumes instead of wedging.
    crate::engine::team_assignment_orchestrator::recover_orphaned_assignments(
        Arc::new(pool.clone()),
        app.clone(),
        engine.clone(),
        None,
    );

    // Build the HTTP client for the polling subscription.
    // Uses SsrfSafeResolver to reject private IPs at connect time,
    // closing the DNS-rebinding TOCTOU window (CWE-367).
    let http = super::url_safety::build_ssrf_safe_client(Duration::from_secs(30));

    // Assemble all reactive subscriptions
    #[allow(unused_mut)]
    let mut subscriptions: Vec<Box<dyn subscription::ReactiveSubscription>> = vec![
        Box::new(EventBusSubscription {
            scheduler: scheduler.clone(),
            app: app.clone(),
            pool: pool.clone(),
            engine: engine.clone(),
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
        Box::new(CleanupSubscription { pool: pool.clone() }),
        Box::new(RotationSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        Box::new(CompositeSubscription {
            pool: pool.clone(),
            composite_state,
        }),
        Box::new(subscription::AutoRollbackSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        Box::new(OAuthRefreshSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        Box::new(subscription::ZombieExecutionSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        Box::new(subscription::HealingTtlSubscription { pool: pool.clone() }),
        Box::new(CloudWebhookRelaySubscription {
            cloud_client: cloud_client.clone(),
            pool: pool.clone(),
            app: app.clone(),
            state: cloud_webhook_relay_state,
        }),
        Box::new(SharedEventRelaySubscription {
            cloud_client,
            pool: pool.clone(),
            app: app.clone(),
            state: shared_event_relay_state,
        }),
        Box::new(subscription::DigestSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Autonomous goal advancement — default-OFF; gated on the
        // AUTONOMOUS_GOAL_ADVANCEMENT setting inside its tick.
        Box::new(subscription::GoalAdvanceSubscription {
            pool: pool.clone(),
            app: app.clone(),
            engine: engine.clone(),
        }),
        // Autonomous assignment retry — default-OFF; gated on the
        // AUTONOMOUS_ASSIGNMENT_RETRY setting inside its tick. Resumes an
        // assignment soft-paused at awaiting_review after a retryable
        // (quota/session/rate-limit) step failure so the goal-advance loop
        // self-heals instead of deadlocking.
        Box::new(subscription::AssignmentAutoResumeSubscription {
            pool: pool.clone(),
            app: app.clone(),
            engine: engine.clone(),
        }),
        // Autonomous manual-review triage — default-OFF; gated on the
        // AUTONOMOUS_REVIEW_TRIAGE setting inside its tick. Auto-approves routine
        // (low/medium) pending reviews past a grace window so the accept→memory
        // learning loop keeps turning unattended; high severity stays for a human.
        Box::new(subscription::ManualReviewAutoTriageSubscription {
            pool: pool.clone(),
        }),
        // Autonomous backlog -> goal (G7) — default-OFF; gated on the
        // AUTONOMOUS_BACKLOG_TO_GOAL setting inside its tick. When a goal-linked
        // project runs out of open goals, promote its best pending backlog idea
        // to a new goal so the goal-advance loop self-sustains instead of idling.
        Box::new(subscription::BacklogToGoalSubscription {
            pool: pool.clone(),
        }),
        // G7 — autonomous idea replenishment: when a goal-managed project is
        // fully idle (no open goals, no pending ideas), run a backlog scan to
        // refeed the loop. Default-OFF (`autonomous_idea_scan`); 20h
        // per-project cooldown; one project per tick.
        Box::new(subscription::IdeaReplenishSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Roster redesign — Product Strategist backlog triage: ranks the
        // next-up queue + rejects low-value ideas (default-OFF
        // `autonomous_backlog_triage`; 24h/project cooldown).
        Box::new(subscription::BacklogTriageSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Director storm trigger (C3) — runs focused Director coaching on a
        // persona whose recent team work shows a burst of failures / QA
        // change-requests, bridging the verdict into the team channel
        // (default-OFF `autonomous_director_storm`; 6h/persona rate-limit).
        Box::new(subscription::DirectorStormSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Athena channel reactions — Athena watches each goal-managed team's
        // delivery stream and posts a genuine react/decline decision into the
        // team channel at reaction-worthy moments (cap-out escalations, QA
        // bounces, shipped goals), so her orchestration is visible + auditable
        // throughout development (default-OFF `autonomous_athena_reactions`;
        // ≤4 teams/tick, deduped against her last channel post per team).
        Box::new(subscription::AthenaChannelReactionSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Queue drain watchdog — re-drains the execution queue after a
        // quota-aware admission cooldown lifts (the normal completion-driven
        // drain can't restart itself once all in-flight work has finished).
        // Always-on; cheap no-op when the queue is empty / at capacity.
        Box::new(subscription::QueueDrainWatchdog {
            pool: pool.clone(),
            app: app.clone(),
            engine: engine.clone(),
        }),
        // Incident auto-continuation (P2.3b): re-run blocked work when its
        // persona-raised incident is resolved. Idempotent via claim_continuation.
        Box::new(crate::engine::incident_continuation::IncidentContinuationSubscription {
            pool: pool.clone(),
            app: app.clone(),
            engine: engine.clone(),
        }),
    ];

    // Desktop-only subscriptions: file watcher, clipboard monitor, app focus, ambient context
    #[cfg(feature = "desktop")]
    {
        let (fw_state, fw_tx, fw_rx, fw_dropped) = super::file_watcher::create_file_watcher();
        subscriptions.push(Box::new(FileWatcherSubscription {
            pool: pool.clone(),
            state: fw_state,
            tx: fw_tx,
            rx: fw_rx,
            dropped: fw_dropped,
            ambient_ctx: ambient_ctx.clone(),
        }));
        // Build clipboard subscription with watcher support (error detection + KB search)
        {
            let app_state: &Arc<crate::AppState> = &app.state::<Arc<crate::AppState>>();
            subscriptions.push(Box::new(ClipboardSubscription {
                pool: pool.clone(),
                state: Arc::new(tokio::sync::Mutex::new(
                    super::clipboard_monitor::ClipboardState::new(),
                )),
                ambient_ctx: ambient_ctx.clone(),
                app: app.clone(),
                user_db: app_state.user_db.clone(),
                #[cfg(feature = "ml")]
                embedding_manager: app_state.embedding_manager.clone(),
                #[cfg(feature = "ml")]
                vector_store: app_state.vector_store.clone(),
                last_notification: Arc::new(tokio::sync::Mutex::new(None)),
                watcher_enabled: app_state.clipboard_watcher_enabled.clone(),
            }));
        }
        subscriptions.push(Box::new(AppFocusSubscription {
            pool: pool.clone(),
            state: Arc::new(tokio::sync::Mutex::new(
                super::app_focus::AppFocusState::new(),
            )),
            ambient_ctx: ambient_ctx.clone(),
        }));
        subscriptions.push(Box::new(subscription::AmbientContextSubscription {
            ctx: ambient_ctx.clone(),
        }));
        // Phase 3 c v3: TTL eviction for the cross-process ambient_signal
        // SQL projection. Runs every 30 min, drops rows older than 24h.
        subscriptions.push(Box::new(subscription::AmbientSignalEvictionSubscription {
            pool: pool.clone(),
        }));
        // Context rule engine: subscribes to the context stream and evaluates
        // persona-defined rules for proactive actions.
        let stream_rx = {
            let ctx = ambient_ctx
                .try_lock()
                .expect("ambient_ctx lock should be uncontested during startup");
            ctx.subscribe()
        };
        subscriptions.push(Box::new(ContextRuleSubscription {
            rule_engine: context_rule_engine,
            stream_rx: Arc::new(tokio::sync::Mutex::new(stream_rx)),
            pool: pool.clone(),
            app: app.clone(),
        }));
    }

    // Spawn all subscriptions through the unified scheduler
    let handles = subscription::spawn_subscriptions(subscriptions, scheduler.clone(), app.clone());
    scheduler.store_subscription_handles(handles);

    // -- Startup overdue sweep ------------------------------------------------
    // Fire all overdue triggers immediately on startup (before waiting for the
    // first subscription tick). This ensures missed schedules from app-offline
    // periods are caught up within milliseconds of launch.
    {
        let recovered = trigger_scheduler_tick_counted(&scheduler, &pool);
        if recovered > 0 {
            tracing::info!(
                count = recovered,
                "Startup overdue sweep: fired {recovered} overdue trigger(s)"
            );
            let _ = app.emit(
                event_name::OVERDUE_TRIGGERS_FIRED,
                OverdueTriggersEvent {
                    recovered,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
            );
        }
    }

    // -- Startup OAuth refresh sweep ------------------------------------------
    // Immediately refresh all expired/expiring OAuth tokens on startup, before
    // waiting for the OAuthRefreshSubscription's first tick. Google access tokens
    // expire in ~1 hour, so any app-offline period >1h leaves tokens dead.
    tokio::spawn({
        let pool = pool.clone();
        let app = app.clone();
        async move {
            let (refreshed, failed) =
                super::oauth_refresh::startup_oauth_sweep(&pool, Some(&app)).await;
            if refreshed > 0 || failed > 0 {
                tracing::info!(refreshed, failed, "Startup OAuth sweep complete");
            }
            // Also auto-provision rotation policies for OAuth credentials that don't have one
            super::rotation::auto_provision_oauth_rotation_policies(&pool);
        }
    });

    // -- Startup stale-review GC sweep (A-grade Phase 8, 2026-05-04) ----------
    // Auto-resolve manual reviews left in `pending` for more than 7 days. The
    // rapid-validation modules driver flagged 5 such rows from a prior C7/C8
    // session — they accumulate when auto_triage's tokio task crashes or the
    // human-review UI subscription drops. Each resolution writes one
    // policy_events row tagged `review.stale_gc.resolved` so the disposition
    // is traceable. Runs once per launch; spawned async so it doesn't block
    // boot. Threshold is hardcoded at 7d here — exposing it via app_settings
    // is tracked as a follow-up.
    tokio::spawn({
        let pool = pool.clone();
        async move {
            const STALE_REVIEW_THRESHOLD_DAYS: i64 = 7;
            let cutoff = (chrono::Utc::now() - chrono::Duration::days(STALE_REVIEW_THRESHOLD_DAYS))
                .to_rfc3339();
            match crate::commands::design::reviews::gc_stale_manual_reviews_inner(&pool, &cutoff) {
                Ok(count) if count > 0 => {
                    tracing::info!(
                        count,
                        threshold_days = STALE_REVIEW_THRESHOLD_DAYS,
                        "Startup stale-review GC: auto-resolved pending reviews older than threshold"
                    );
                }
                Ok(_) => {} // no-op on a clean install — no log spam
                Err(e) => {
                    tracing::warn!(error = %e, "Startup stale-review GC failed");
                }
            }
        }
    });

    // Smee.io relay (long-lived SSE connection, event-driven via notifier)
    tokio::spawn({
        let pool = pool.clone();
        let app = app.clone();
        let notifier = smee_notifier.clone();
        async move {
            super::smee_relay::run_smee_relay(
                pool,
                app,
                Arc::new(tokio::sync::Mutex::new(
                    super::smee_relay::SmeeRelayState::new(),
                )),
                notifier,
            )
            .await;
        }
    });

    // Webhook HTTP server + Management API (not a reactive subscription -- it's a long-lived server)
    let (webhook_shutdown_tx, webhook_shutdown_rx) = tokio::sync::watch::channel(false);
    tokio::spawn({
        let pool = pool.clone();
        let scheduler = scheduler.clone();
        let app_for_mgmt = app.clone();
        async move {
            scheduler.webhook_alive.store(true, Ordering::Relaxed);

            // Try to start with management API (needs AppState for process_registry)
            let process_registry = app_for_mgmt
                .try_state::<std::sync::Arc<crate::AppState>>()
                .map(|s| s.process_registry.clone());
            let result = if let Some(registry) = process_registry {
                super::webhook::start_webhook_server_with_management(
                    pool,
                    rate_limiter,
                    tier_config,
                    app_for_mgmt,
                    registry,
                    webhook_shutdown_rx,
                )
                .await
            } else {
                // Fallback: webhook-only (no management API)
                super::webhook::start_webhook_server(
                    pool,
                    rate_limiter,
                    tier_config,
                    webhook_shutdown_rx,
                )
                .await
            };

            if let Err(e) = result {
                let msg = e.to_string();
                // EADDRINUSE (Windows os error 10048 / Unix EADDRINUSE) is a dev-mode
                // double-start, not an app bug — downgrade so it stays out of Sentry.
                if msg.contains("10048") || msg.to_lowercase().contains("address already in use") {
                    tracing::warn!("Webhook server bind skipped (port in use): {}", msg);
                } else {
                    tracing::error!("Webhook server failed: {}", msg);
                }
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
    // 1. Atomically claim pending events (SET status='processing' WHERE status='pending')
    //    This prevents duplicate processing when ticks overlap.
    let events = match event_repo::claim_pending(pool, 50) {
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
    let all_listeners =
        trigger_repo::get_event_listeners_for_event_types(pool, &event_types).unwrap_or_default();

    tracing::debug!(
        event_count = events.len(),
        event_types = event_types.len(),
        subscriptions = all_subs.len(),
        listeners = all_listeners.len(),
        "Event bus: batch pre-fetch complete"
    );

    // 4. Pre-parse trigger configs once (avoids re-deserializing JSON per event).
    let parsed_listeners: Vec<bus::ParsedTrigger<'_>> =
        all_listeners.iter().map(bus::ParsedTrigger::new).collect();

    // 5. Match all events against the pre-fetched subscriptions/listeners
    //    and collect (event_index, matches) pairs.
    let mut event_matches: Vec<(usize, Vec<bus::EventMatch>)> = Vec::new();
    for (idx, event) in events.iter().enumerate() {
        // Status already set to 'processing' by claim_pending — no separate update needed.

        // Match against legacy subscriptions + event_listener triggers, then
        // prefer capability-scoped over persona-wide for the same persona
        // (Phase C4 §event-routing). The helper also dedupes on
        // `(persona_id, use_case_id)` so the legacy-subs + trigger-rows merge
        // doesn't double-fire a capability-scoped handler.
        let mut combined = bus::match_event(event, &all_subs);
        combined.extend(bus::match_event(event, &parsed_listeners));
        let matches = bus::prefer_capability_scoped(combined);

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
                "Event bus: no subscriber matches -- marking as delivered (no consumers)"
            );
            let _ = event_repo::update_status(pool, &event.id, PersonaEventStatus::Delivered, None);
            scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
            scheduler.events_delivered.fetch_add(1, Ordering::Relaxed);
            emit_event_to_frontend(app, event, PersonaEventStatus::Delivered);
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
        // Also fetch each event's source persona so the cross-team bleed guard
        // can compare home teams — the source may not be among matched personas.
        for (idx, _) in &event_matches {
            let ev = &events[*idx];
            if ev.source_type.starts_with("persona:") {
                if let Some(src) = ev.source_id.clone() {
                    ids.push(src);
                }
            }
        }
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
        // Breadcrumb: set when a handoff EXPLICITLY targeted at a persona is
        // dropped because that persona is disabled. The bus marks the event
        // `delivered` either way, so without this a stalled cascade is invisible
        // (delivered + no execution, no error). health-lint catches this pre-run;
        // this carries the reason onto the event at runtime.
        let mut dropped_disabled_target = false;

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

            // Honour the persona Active/Off toggle. The header switch sets
            // personas.enabled = 0; without this guard the event-bus path
            // happily dispatched executions to disabled personas because the
            // get_subscriptions / get_event_listeners SQL paths never joined
            // on personas.enabled. Skip silently — no DLQ, no retry — the
            // user explicitly turned the agent off.
            if !persona.enabled {
                // A handoff explicitly targeted at this (disabled) persona is a
                // dropped cascade step — the chain stalls here. Mark it so the
                // delivered event carries WHY no execution followed. An untargeted
                // fan-out reaching a disabled persona is an ordinary skip (the user
                // turned that agent off on purpose) and stays a quiet info log.
                if event.target_persona_id.as_deref() == Some(persona.id.as_str()) {
                    dropped_disabled_target = true;
                    tracing::warn!(
                        persona_id = %persona.id,
                        persona_name = %persona.name,
                        event_type = %event.event_type,
                        "Event bus: DROPPED handoff — target persona is disabled; cascade stalls here (enable it to resume)"
                    );
                } else {
                    tracing::info!(
                        persona_id = %persona.id,
                        persona_name = %persona.name,
                        event_type = %event.event_type,
                        "Event bus: skipping — persona is disabled"
                    );
                }
                continue;
            }

            // Cross-team bleed guard. Adoption wires intra-team subscriptions
            // with source_filter "*"; in a multi-team / multi-repo deployment
            // that lets one team's event (e.g. ai-bookkeeper's release.published)
            // wake every team's matching persona, which then refuses the
            // off-repo work and burns a precondition_failed run. Suppress a
            // wildcard match that crosses a team boundary (same-team, explicit
            // filters, and teamless personas are untouched).
            if event.source_type.starts_with("persona:") {
                let src_home = event
                    .source_id
                    .as_deref()
                    .and_then(|sid| persona_map.get(sid))
                    .and_then(|p| p.home_team_id.as_deref());
                if bus::is_cross_team_wildcard_bleed(
                    m.source_filter.as_deref(),
                    persona.home_team_id.as_deref(),
                    src_home,
                ) {
                    tracing::info!(
                        persona_id = %persona.id,
                        persona_name = %persona.name,
                        source_id = ?event.source_id,
                        event_type = %event.event_type,
                        "Event bus: skipping — cross-team wildcard bleed suppressed"
                    );
                    continue;
                }
            }

            // Cascade guard. Scope it to the capability when the match is
            // capability-scoped so a legitimate UC1→UC2 chain in the same
            // persona isn't blocked by UC1 still completing when its
            // emitted event lands. Persona-wide matches keep the original
            // per-persona guard (no use_case to disambiguate).
            let running_count = match m.use_case_id.as_deref() {
                Some(uc_id) => {
                    exec_repo::get_running_count_for_persona_use_case(pool, &persona.id, uc_id)
                        .unwrap_or(0)
                }
                None => exec_repo::get_running_count_for_persona(pool, &persona.id).unwrap_or(0),
            };
            if running_count > 0 {
                tracing::info!(
                    persona_id = %persona.id,
                    persona_name = %persona.name,
                    use_case_id = ?m.use_case_id,
                    running_count = running_count,
                    event_type = %event.event_type,
                    "Event bus: skipping — capability already has running execution (cascade guard)"
                );
                continue;
            }

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
            let tools = tools_map.get(&persona.id).cloned().unwrap_or_default();

            // Parse input — log on failure since chain_trace_id is embedded in the payload JSON.
            // A parse failure here means the chain trace ID is lost and downstream
            // chain executions will create orphaned trace roots.
            let parsed_payload: Option<serde_json::Value> =
                m.payload
                    .as_deref()
                    .and_then(|s| match serde_json::from_str(s) {
                        Ok(v) => Some(v),
                        Err(parse_err) => {
                            tracing::warn!(
                                event_id = %event.id,
                                persona_id = %m.persona_id,
                                payload_len = s.len(),
                                error = %parse_err,
                                "Event bus: payload JSON parse failed — chain trace correlation \
                                 will break if this event is part of a chain cascade"
                            );
                            scheduler
                                .trace_continuity_breaks
                                .fetch_add(1, Ordering::Relaxed);
                            None
                        }
                    });

            // Wrap the payload with `_event` metadata so the persona prompt
            // (see engine/prompt.rs `## Triggering Event` block) can show the
            // firing event_type + source. Without this, the persona has no
            // way to route behavior per-event. `source_persona_id` is set only
            // when the source_id refers to an actual persona row.
            let source_persona_id = event.source_id.as_ref().and_then(|sid| {
                match crate::db::repos::core::personas::get_by_id(pool, sid) {
                    Ok(_) => Some(sid.clone()),
                    Err(_) => None,
                }
            });
            let mut event_meta = serde_json::Map::new();
            event_meta.insert(
                "event_type".into(),
                serde_json::Value::String(event.event_type.clone()),
            );
            event_meta.insert(
                "source_type".into(),
                serde_json::Value::String(event.source_type.clone()),
            );
            if let Some(sid) = &event.source_id {
                event_meta.insert("source_id".into(), serde_json::Value::String(sid.clone()));
            }
            if let Some(spid) = &source_persona_id {
                event_meta.insert(
                    "source_persona_id".into(),
                    serde_json::Value::String(spid.clone()),
                );
            }
            if let Some(tpid) = &event.target_persona_id {
                event_meta.insert(
                    "target_persona_id".into(),
                    serde_json::Value::String(tpid.clone()),
                );
            }
            let input_val: Option<serde_json::Value> = Some(serde_json::json!({
                "_event": serde_json::Value::Object(event_meta),
                "payload": parsed_payload.unwrap_or(serde_json::Value::Null),
            }));

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

        if any_failed {
            // Use DLQ pattern: increment retry count, move to dead_letter after max retries
            let max_retries = event_repo::DEFAULT_MAX_RETRIES;
            match event_repo::increment_retry_or_dead_letter(
                pool,
                &event.id,
                Some("One or more subscription executions failed".into()),
                max_retries,
            ) {
                Ok(moved_to_dlq) => {
                    let status = if moved_to_dlq {
                        PersonaEventStatus::DeadLetter
                    } else {
                        PersonaEventStatus::Failed
                    };
                    if moved_to_dlq {
                        tracing::warn!(
                            event_id = %event.id,
                            event_type = %event.event_type,
                            "Event moved to dead letter queue after {} retries",
                            max_retries,
                        );
                    }
                    emit_event_to_frontend(app, event, status);
                }
                Err(e) => {
                    tracing::error!(event_id = %event.id, "Failed to update DLQ status: {}", e);
                }
            }
        } else {
            // Carry the disabled-target breadcrumb onto the delivered event so DB
            // forensics (and any UI reading error_message) show why a targeted
            // handoff produced no execution instead of an opaque "delivered".
            let note = dropped_disabled_target.then(|| {
                "handoff dropped: target persona disabled — cascade stalled here \
                 (enable the persona to resume)"
                    .to_string()
            });
            let _ = event_repo::update_status(pool, &event.id, PersonaEventStatus::Delivered, note);
            emit_event_to_frontend(app, event, PersonaEventStatus::Delivered);
        }
        scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
    }

    // Durable usage-limit retries: dispatch any whose reset time has passed.
    // Lives on this tick because it's the engine-aware loop with the right
    // cadence (2s active / 10s idle); the table itself is written by the
    // healing paths (HealingAction::RetryAt).
    engine.drain_due_scheduled_retries(app, pool).await;
}

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
const BACKFILL_HARD_CAP: usize = crate::engine::limits::BACKFILL_HARD_CAP;

fn schedule_executions_per_persona_hour(pool: &DbPool) -> i64 {
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

fn schedule_hourly_cap_exceeded(
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
fn schedule_over_budget(max_budget: Option<f64>, monthly_spend: f64) -> bool {
    matches!(max_budget, Some(budget) if budget > 0.0 && monthly_spend >= budget)
}

fn log_schedule_rate_limit_issue(
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

/// Enumerate cron/interval slots that should have fired strictly between
/// `last_fire` (exclusive) and `now` (inclusive), excluding the most-recent
/// one (which the existing scheduler tick path will fire as the "current"
/// event). Used by the backfill path to emit catch-up events for older slots
/// that were missed during downtime.
///
/// Returns at most `BACKFILL_HARD_CAP` slots regardless of caller intent.
fn compute_missed_backfill_slots(
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
            let tz = timezone
                .as_deref()
                .and_then(|s| s.parse::<chrono_tz::Tz>().ok());
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
fn synthesize_backfill_payload(
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

    for trigger in triggers {
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
            let cfg = trigger.parse_config();
            let next = sched_logic::compute_next_from_config(
                &cfg,
                now,
                crate::engine::cron::seed_hash(&trigger.id),
            );
            let _ = trigger_repo::mark_triggered(pool, &trigger.id, next, trigger.trigger_version);
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
                let spend =
                    exec_repo::get_monthly_spend(pool, &trigger.persona_id).unwrap_or(0.0);
                schedule_over_budget(max_budget, spend)
            } else {
                false
            };

            if over_budget {
                tracing::warn!(persona_id = %trigger.persona_id, "Cron agent paused due to exceeded budget");
                let next = sched_logic::compute_next_from_config(
                    &cfg,
                    now,
                    crate::engine::cron::seed_hash(&trigger.id),
                );
                let _ =
                    trigger_repo::mark_triggered(pool, &trigger.id, next, trigger.trigger_version);
                continue;
            }
        }

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
        if backfill_cap > 1 {
            if let Some(last_iso) = trigger.last_triggered_at.as_deref() {
                if let Ok(last_dt) = chrono::DateTime::parse_from_rfc3339(last_iso) {
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
                            }
                            Err(e) => {
                                tracing::error!(
                                    trigger_id = %trigger.id,
                                    "Backfill publish failed: {}", e
                                );
                            }
                        }
                    }
                }
            }
        }

        // 3. Compute next trigger time first
        let next = sched_logic::compute_next_from_config(
            &cfg,
            now,
            crate::engine::cron::seed_hash(&trigger.id),
        );

        if trigger.trigger_type == "schedule"
            && schedule_hourly_cap_exceeded(
                pool,
                &trigger,
                now,
                hourly_ceiling,
                &scheduled_publishes_by_persona,
            )
        {
            match trigger_repo::mark_triggered(pool, &trigger.id, next, trigger.trigger_version) {
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
            }
        }
    }

    fired
}

/// Read a numeric retention setting from `app_settings`, falling back to
/// `default` if the row is absent OR unparseable. Unparseable values emit a
/// `warn!` so corrupt/legacy values are visible in observability — without
/// this, a user setting `"90d"` or `"  45 "` silently reverts to the default.
fn parse_retention_setting(pool: &DbPool, key: &str, default: i64) -> i64 {
    match settings::get(pool, key).ok().flatten() {
        None => default,
        Some(raw) => match raw.parse::<i64>() {
            Ok(n) => n,
            Err(err) => {
                tracing::warn!(
                    key = key,
                    value = %raw,
                    error = %err,
                    default = default,
                    "settings retention value is not a valid integer — using default",
                );
                default
            }
        },
    }
}

/// One tick of the cleanup subscription: delete old processed events.
///
/// Reads `event_retention_days` from app_settings (default 30 days).
pub(crate) fn cleanup_tick(pool: &DbPool) {
    let retention_days = parse_retention_setting(
        pool,
        settings_keys::EVENT_RETENTION_DAYS,
        settings_keys::EVENT_RETENTION_DAYS_DEFAULT,
    );

    match event_repo::cleanup(pool, Some(retention_days)) {
        Ok(n) if n > 0 => tracing::info!(
            "Cleaned up {} old events (retention={}d)",
            n,
            retention_days
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Event cleanup error: {}", e),
    }

    // DLQ auto-retry: re-queue failed events that haven't exhausted retries
    let max_retries = event_repo::DEFAULT_MAX_RETRIES;
    match event_repo::get_retry_eligible(pool, max_retries, 20) {
        Ok(events) if !events.is_empty() => {
            let count = events.len();
            for evt in &events {
                if let Err(e) =
                    event_repo::update_status(pool, &evt.id, PersonaEventStatus::Pending, None)
                {
                    tracing::warn!(event_id = %evt.id, "DLQ auto-retry: failed to re-queue: {}", e);
                }
            }
            tracing::info!(
                "DLQ auto-retry: re-queued {} failed events for retry",
                count
            );
        }
        Ok(_) => {}
        Err(e) => tracing::error!("DLQ auto-retry query error: {}", e),
    }

    // Credential audit log: 90-day retention
    match audit_log::cleanup_old_entries(pool, 90) {
        Ok(n) if n > 0 => tracing::info!(
            "Cleaned up {} old credential audit log entries (retention=90d)",
            n
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Credential audit log cleanup error: {}", e),
    }

    // Stale automation runs: reap runs stuck in 'running' beyond 2× timeout
    {
        use crate::db::repos::resources::automations as auto_repo;
        match auto_repo::reap_stale_runs(pool) {
            Ok(n) if n > 0 => {
                tracing::warn!("Reaped {} stale automation run(s) stuck in running", n)
            }
            Ok(_) => {}
            Err(e) => tracing::error!("Stale automation run reaper error: {}", e),
        }
    }

    // Execution log: configurable retention (default 60 days / 2 months), keep at least 50 per persona
    let exec_retention_days = parse_retention_setting(
        pool,
        settings_keys::EXECUTION_RETENTION_DAYS,
        settings_keys::EXECUTION_RETENTION_DAYS_DEFAULT,
    );
    match exec_repo::cleanup_old_executions(pool, exec_retention_days, 50) {
        Ok(n) if n > 0 => tracing::info!(
            "Cleaned up {} old execution records (retention={}d, min_keep=50/persona)",
            n,
            exec_retention_days
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Execution log cleanup error: {}", e),
    }

    // Fix 2: orphan trigger sweep — delete triggers whose owning persona no
    // longer exists, then purge their dead audit events. Also heal any
    // schedule/polling/webhook trigger that's missing its Fix 4a auto-listener
    // (e.g. after an import, a template adoption, or a pre-Fix-4a install).
    // All three are idempotent; logs only surface when work was done.
    match trigger_repo::delete_orphaned_triggers(pool) {
        Ok(n) if n > 0 => tracing::warn!(
            count = n,
            "Orphan sweep: deleted {} trigger(s) whose persona no longer exists",
            n,
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Orphan trigger sweep error: {}", e),
    }
    match event_repo::delete_orphaned_trigger_events(pool) {
        Ok(n) if n > 0 => tracing::info!(
            count = n,
            "Orphan sweep: purged {} persona_events row(s) from deleted triggers",
            n,
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Orphan event sweep error: {}", e),
    }
    match trigger_repo::backfill_auto_listeners(pool) {
        Ok((_scanned, created)) if created > 0 => tracing::info!(
            created,
            "Auto-listener backfill: created {} missing event_listener trigger(s)",
            created,
        ),
        Ok(_) => {}
        Err(e) => tracing::error!("Auto-listener backfill error: {}", e),
    }
}

/// Emit event update to frontend for realtime visualization.
fn emit_event_to_frontend(app: &AppHandle, event: &PersonaEvent, status: PersonaEventStatus) {
    let mut payload = event.clone();
    payload.status = status;
    payload.processed_at = Some(chrono::Utc::now().to_rfc3339());

    emit_event_bus(app, &payload);
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

/// Tauri event emitted when executions are running but have not heartbeated
/// recently. This is a passive signal only — no status change happens. The
/// existing zombie sweep + hard `timeout_ms` are still authoritative for
/// terminating runs; this event surfaces a "looks alive but quiet" warning
/// so the UI can show it earlier than the hard kill, and so healing can
/// proactively act before the watchdog terminates the run.
#[derive(Clone, Serialize)]
pub struct SilentExecutionEvent {
    /// IDs of executions whose last heartbeat is older than the cutoff.
    pub execution_ids: Vec<String>,
    /// Number of silent runs found in this sweep.
    pub count: usize,
    /// Cutoff threshold in seconds applied for this sweep.
    pub cutoff_secs: i64,
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
                let _ = app.emit(
                    event_name::ZOMBIE_EXECUTIONS_DETECTED,
                    ZombieExecutionEvent { zombie_ids, count },
                );
            }
        }
        Err(e) => {
            tracing::error!("Zombie execution sweep failed: {}", e);
        }
    }
}

/// Threshold (seconds) of stream silence before a still-running execution is
/// reported as `silent`. Set well below the zombie threshold so the silent
/// signal fires earlier and gives the UI / healing a chance to react before
/// the zombie sweep transitions the run to `incomplete`.
const SILENT_EXECUTION_THRESHOLD_SECS: i64 = 90;

/// Cap on how many silent executions a single sweep emits, so a wedged
/// runner pool can't flood the frontend.
const SILENT_EXECUTION_BATCH_LIMIT: i64 = 50;

/// One tick of the silent-execution watchdog: find runs whose last heartbeat
/// is older than `SILENT_EXECUTION_THRESHOLD_SECS` and emit a passive event.
/// No status change is performed — the existing zombie sweep + hard
/// `timeout_ms` remain authoritative for terminating runs.
pub(crate) fn silent_execution_tick(pool: &DbPool, app: &AppHandle) {
    let cutoff_dt = chrono::Utc::now() - chrono::Duration::seconds(SILENT_EXECUTION_THRESHOLD_SECS);
    let cutoff = cutoff_dt.to_rfc3339();
    match exec_repo::find_silent_running(pool, &cutoff, SILENT_EXECUTION_BATCH_LIMIT) {
        Ok(execution_ids) => {
            if !execution_ids.is_empty() {
                let count = execution_ids.len();
                tracing::info!(
                    count,
                    cutoff_secs = SILENT_EXECUTION_THRESHOLD_SECS,
                    "Silent-execution sweep: {} runs without heartbeat past cutoff",
                    count,
                );
                let _ = app.emit(
                    event_name::EXECUTIONS_SILENT_DETECTED,
                    SilentExecutionEvent {
                        execution_ids,
                        count,
                        cutoff_secs: SILENT_EXECUTION_THRESHOLD_SECS,
                    },
                );
            }
        }
        Err(e) => {
            tracing::error!("Silent-execution sweep failed: {}", e);
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
}
