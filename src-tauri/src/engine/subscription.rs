//! Unified reactive subscription model.
//!
//! All background reactivity loops follow the same abstract pattern:
//!   1. **Source** -- poll an external condition (DB rows, HTTP endpoints, etc.)
//!   2. **Predicate** -- evaluate whether the condition warrants action
//!   3. **Action** -- dispatch the side-effect (publish event, start execution, etc.)
//!
//! The [`ReactiveSubscription`] trait captures this pattern. Each subscription
//! declares its own poll interval, and the unified [`run_subscriptions`] loop
//! schedules all subscriptions through a single `tokio::select!` loop.
//!
//! Adding a new reactivity source (e.g., file-watch, WebSocket) only requires
//! implementing the trait -- no new `tokio::spawn` block needed.

use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::FutureExt;
use tauri::{AppHandle, Emitter};

use crate::db::DbPool;
use crate::engine::background::{SchedulerState, SubscriptionCrashEvent};
use crate::engine::ExecutionEngine;

// ---------------------------------------------------------------------------
// Trait
// ---------------------------------------------------------------------------

/// A reactive subscription that the unified scheduler loop will poll.
///
/// Each implementor defines:
/// - `name()` -- human-readable label for logs
/// - `interval()` -- how often to poll when active
/// - `idle_interval()` -- how often to poll when idle (default: same as interval)
/// - `initial_delay()` -- optional startup delay (default 0)
/// - `tick()` -- the combined source -> predicate -> action cycle
#[async_trait::async_trait]
pub trait ReactiveSubscription: Send + Sync + 'static {
    /// Human-readable name for logging.
    fn name(&self) -> &'static str;

    /// How often this subscription should be polled when the app is active.
    fn interval(&self) -> Duration;

    /// How often to poll when idle (no running executions, app backgrounded).
    /// Subscriptions that don't benefit from reduced cadence can leave the default.
    fn idle_interval(&self) -> Duration {
        self.interval()
    }

    /// Optional delay before the first poll (e.g., let the app fully start).
    fn initial_delay(&self) -> Duration {
        Duration::ZERO
    }

    /// Execute one poll cycle: source -> predicate -> action.
    ///
    /// Errors are logged internally; the loop continues regardless.
    async fn tick(&self);
}

// ---------------------------------------------------------------------------
// Concrete subscriptions
// ---------------------------------------------------------------------------

/// Event bus subscription: poll pending events, match to subscriptions, trigger executions.
pub struct EventBusSubscription {
    pub scheduler: Arc<SchedulerState>,
    pub app: AppHandle,
    pub pool: DbPool,
    pub engine: Arc<ExecutionEngine>,
}

/// Trigger scheduler subscription: poll due schedule/chain triggers, publish events.
pub struct TriggerSchedulerSubscription {
    pub scheduler: Arc<SchedulerState>,
    pub pool: DbPool,
}

/// Polling subscription: HTTP content-hash diffing for polling triggers.
pub struct PollingSubscription {
    pub scheduler: Arc<SchedulerState>,
    pub pool: DbPool,
    pub http: reqwest::Client,
}

/// Cleanup subscription: delete old processed events periodically.
pub struct CleanupSubscription {
    pub pool: DbPool,
}

/// Credential rotation subscription: evaluate due policies and detect anomalies.
pub struct RotationSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// File watcher subscription: monitor file system for changes.
#[cfg(feature = "desktop")]
pub struct FileWatcherSubscription {
    pub pool: DbPool,
    pub state: Arc<tokio::sync::Mutex<super::file_watcher::FileWatcherState>>,
    pub tx: tokio::sync::mpsc::Sender<super::file_watcher::RawFsEvent>,
    pub rx: Arc<tokio::sync::Mutex<tokio::sync::mpsc::Receiver<super::file_watcher::RawFsEvent>>>,
    pub ambient_ctx: super::ambient_context::AmbientContextHandle,
}

/// Clipboard monitor subscription: detect clipboard content changes.
#[cfg(feature = "desktop")]
pub struct ClipboardSubscription {
    pub pool: DbPool,
    pub state: Arc<tokio::sync::Mutex<super::clipboard_monitor::ClipboardState>>,
    pub ambient_ctx: super::ambient_context::AmbientContextHandle,
}

/// App focus subscription: detect foreground application changes.
#[cfg(feature = "desktop")]
pub struct AppFocusSubscription {
    pub pool: DbPool,
    pub state: Arc<tokio::sync::Mutex<super::app_focus::AppFocusState>>,
    pub ambient_ctx: super::ambient_context::AmbientContextHandle,
}

/// Ambient context fusion subscription: aggregates desktop signals into a rolling context window.
#[cfg(feature = "desktop")]
pub struct AmbientContextSubscription {
    pub ctx: super::ambient_context::AmbientContextHandle,
}

/// Context rule engine subscription: evaluates persona-defined rules against
/// the real-time context stream and triggers actions on matches.
#[cfg(feature = "desktop")]
pub struct ContextRuleSubscription {
    pub rule_engine: super::context_rules::ContextRuleEngineHandle,
    pub stream_rx: Arc<tokio::sync::Mutex<super::ambient_context::ContextStreamReceiver>>,
    pub pool: DbPool,
    pub app: AppHandle,
}

/// Composite trigger subscription: evaluate composite conditions against event stream.
pub struct CompositeSubscription {
    pub pool: DbPool,
}

/// Auto-rollback subscription: periodically checks personas with auto-rollback
/// enabled and reverts to the previous prompt version when error rate exceeds 2x.
pub struct AutoRollbackSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// OAuth token refresh subscription: proactively refresh tokens before expiry.
pub struct OAuthRefreshSubscription {
    pub pool: DbPool,
}

/// Periodic sweep for zombie executions stuck in 'running' state.
pub struct ZombieExecutionSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// Cloud webhook relay: polls cloud trigger firings and injects them into
/// the local event bus so 3rd-party webhooks reach the desktop app.
pub struct CloudWebhookRelaySubscription {
    pub cloud_client: Arc<tokio::sync::Mutex<Option<Arc<crate::cloud::client::CloudClient>>>>,
    pub pool: DbPool,
    pub app: AppHandle,
    pub state: Arc<tokio::sync::Mutex<super::cloud_webhook_relay::CloudWebhookRelayState>>,
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

#[async_trait::async_trait]
impl ReactiveSubscription for EventBusSubscription {
    fn name(&self) -> &'static str {
        "event_bus"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(2)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn tick(&self) {
        super::background::event_bus_tick(
            &self.scheduler,
            &self.app,
            &self.pool,
            &self.engine,
        )
        .await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for TriggerSchedulerSubscription {
    fn name(&self) -> &'static str {
        "trigger_scheduler"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(5)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(30)
    }

    async fn tick(&self) {
        super::background::trigger_scheduler_tick(&self.scheduler, &self.pool);
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for PollingSubscription {
    fn name(&self) -> &'static str {
        "polling"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(10)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(60)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn tick(&self) {
        super::polling::poll_due_triggers(&self.pool, &self.scheduler, &self.http).await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for CleanupSubscription {
    fn name(&self) -> &'static str {
        "cleanup"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(3600)
    }

    async fn tick(&self) {
        super::background::cleanup_tick(&self.pool);
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for RotationSubscription {
    fn name(&self) -> &'static str {
        "rotation"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(60)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(30)
    }

    async fn tick(&self) {
        super::rotation::evaluate_due_rotations(&self.pool, &self.app).await;
        super::rotation::evaluate_credential_events(&self.pool).await;
        super::rotation::detect_anomalies(&self.pool, &self.app).await;
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for FileWatcherSubscription {
    fn name(&self) -> &'static str {
        "file_watcher"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(2)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(5)
    }

    async fn tick(&self) {
        // Capture queued events count before tick so we can push new ones to ambient context
        let events_before = {
            let rx = self.rx.lock().await;
            // We can't count without draining, so just run the tick and push
            // file change signals from within file_watcher_tick via ambient ctx
            drop(rx);
            0usize
        };
        let _ = events_before;
        super::file_watcher::file_watcher_tick(&self.pool, &self.state, &self.tx, &self.rx).await;
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for ClipboardSubscription {
    fn name(&self) -> &'static str {
        "clipboard"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(3)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(8)
    }

    async fn tick(&self) {
        // Capture clipboard state before tick to detect changes
        let hash_before = {
            let s = self.state.lock().await;
            s.last_hash()
        };

        super::clipboard_monitor::clipboard_tick(&self.pool, &self.state).await;

        // If hash changed, push a signal to ambient context
        let hash_after = {
            let s = self.state.lock().await;
            s.last_hash()
        };
        if hash_before != hash_after {
            let mut ctx = self.ambient_ctx.lock().await;
            ctx.push_clipboard("text", 0); // Length unknown here, but signal is still useful
        }
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for AppFocusSubscription {
    fn name(&self) -> &'static str {
        "app_focus"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(3)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(8)
    }

    async fn tick(&self) {
        // Capture app state before tick to detect changes
        let (app_before, title_before) = {
            let s = self.state.lock().await;
            (s.last_app_name().map(|s| s.to_string()), s.last_window_title().map(|s| s.to_string()))
        };

        super::app_focus::app_focus_tick(&self.pool, &self.state).await;

        // If app changed, push a signal to ambient context
        let (app_after, title_after) = {
            let s = self.state.lock().await;
            (s.last_app_name().map(|s| s.to_string()), s.last_window_title().map(|s| s.to_string()))
        };
        if app_before != app_after || title_before != title_after {
            if let (Some(ref app), Some(ref title)) = (&app_after, &title_after) {
                let mut ctx = self.ambient_ctx.lock().await;
                ctx.push_app_focus(app, title);
            }
        }
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for AmbientContextSubscription {
    fn name(&self) -> &'static str {
        "ambient_context"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(5)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(30)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn tick(&self) {
        super::ambient_context::ambient_context_tick(&self.ctx).await;
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for ContextRuleSubscription {
    fn name(&self) -> &'static str {
        "context_rules"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(2)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(10)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(12) // Start after ambient context subscription
    }

    async fn tick(&self) {
        super::context_rules::context_rule_tick(
            &self.rule_engine,
            &self.stream_rx,
            &self.pool,
            &self.app,
        )
        .await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for CompositeSubscription {
    fn name(&self) -> &'static str {
        "composite"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(2)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(15)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(3)
    }

    async fn tick(&self) {
        super::composite::composite_tick(&self.pool);
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for AutoRollbackSubscription {
    fn name(&self) -> &'static str {
        "auto_rollback"
    }

    fn interval(&self) -> Duration {
        // Check every 5 minutes -- auto-rollback doesn't need to be instant
        Duration::from_secs(300)
    }

    fn initial_delay(&self) -> Duration {
        // Wait 60 seconds after startup before first check
        Duration::from_secs(60)
    }

    async fn tick(&self) {
        super::auto_rollback::auto_rollback_tick(&self.pool, &self.app);
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for OAuthRefreshSubscription {
    fn name(&self) -> &'static str {
        "oauth_refresh"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(300) // 5 minutes
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(45) // Let the app fully start
    }

    async fn tick(&self) {
        super::oauth_refresh::oauth_refresh_tick(&self.pool).await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for ZombieExecutionSubscription {
    fn name(&self) -> &'static str {
        "zombie_execution_sweep"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(300) // 5 minutes
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(60) // Let the app fully start
    }

    async fn tick(&self) {
        super::background::zombie_execution_tick(&self.pool, &self.app);
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for CloudWebhookRelaySubscription {
    fn name(&self) -> &'static str {
        "cloud_webhook_relay"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(15)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(60)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn tick(&self) {
        let client_guard = self.cloud_client.lock().await;
        if let Some(ref client) = *client_guard {
            let client = client.clone();
            drop(client_guard); // Release lock before async work
            super::cloud_webhook_relay::cloud_webhook_relay_tick(
                &client,
                &self.pool,
                &self.app,
                &self.state,
            )
            .await;
        }
        // Not connected — silently skip
    }
}

// ---------------------------------------------------------------------------
// Unified scheduler loop
// ---------------------------------------------------------------------------

/// Maximum consecutive panics before applying backoff to the tick interval.
const PANIC_BACKOFF_THRESHOLD: u32 = 3;
/// Multiplier applied to the interval after consecutive panics exceed the threshold.
const PANIC_BACKOFF_MULTIPLIER: u32 = 2;
/// Cap on the backoff multiplier to prevent intervals from growing unbounded.
const PANIC_BACKOFF_MAX: u32 = 16;
/// Fraction of the interval that triggers a slow-tick warning (80%).
const SLOW_TICK_THRESHOLD_NUM: u64 = 4;
const SLOW_TICK_THRESHOLD_DEN: u64 = 5;

/// Run a single reactive subscription in its own task, respecting initial delay,
/// interval, and the scheduler's running flag.
///
/// Adaptively switches between `interval()` and `idle_interval()` based on
/// the scheduler's active flag, reducing CPU/IO when the system is idle.
///
/// Applies exponential backoff when a subscription repeatedly panics, similar
/// to [`PeriodicTask`](super::p2p::periodic::PeriodicTask).
///
/// Registers itself as alive/dead in `SchedulerState` and emits a
/// `subscription-crashed` Tauri event on every panic so the frontend can
/// surface dead subscriptions immediately.
async fn run_single(
    sub: Box<dyn ReactiveSubscription>,
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
) {
    let name = sub.name();
    let active_interval = sub.interval();
    let idle_interval = sub.idle_interval();
    let has_idle_mode = active_interval != idle_interval;

    // Register this subscription as alive before any delay
    scheduler.mark_subscription_alive(name, active_interval.as_millis() as u64);

    let delay = sub.initial_delay();
    if !delay.is_zero() {
        tracing::debug!(subscription = name, delay_secs = ?delay.as_secs(), "Delaying initial poll");
        tokio::time::sleep(delay).await;
    }

    let mut was_active = true;
    let mut consecutive_panics: u32 = 0;
    let mut interval = tokio::time::interval(active_interval);
    loop {
        interval.tick().await;
        if !scheduler.is_running() {
            break;
        }

        // Switch interval when activity level changes
        if has_idle_mode {
            let is_active = scheduler.is_active();
            if is_active != was_active {
                let new_dur = if is_active { active_interval } else { idle_interval };
                interval = tokio::time::interval(new_dur);
                interval.tick().await; // consume the immediate first tick
                was_active = is_active;
                tracing::debug!(
                    subscription = name,
                    mode = if is_active { "active" } else { "idle" },
                    interval_secs = new_dur.as_secs(),
                    "Subscription interval adjusted"
                );
            }
        }

        let tick_start = Instant::now();

        // Execute the tick within a tracing span for structured observability.
        let tick_result = {
            let _span = tracing::debug_span!("subscription_tick", subscription = name).entered();
            // Panic boundary: catch any panic inside tick() so the subscription
            // loop survives and the crash is surfaced via logs + metrics.
            AssertUnwindSafe(sub.tick()).catch_unwind().await
        };
        let elapsed = tick_start.elapsed();

        if let Err(panic_payload) = tick_result {
            let msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown panic".to_string()
            };
            consecutive_panics = consecutive_panics.saturating_add(1);
            tracing::error!(
                subscription = name,
                panic_message = %msg,
                consecutive_panics,
                "Subscription tick panicked — loop will continue on next interval"
            );
            scheduler.record_subscription_crash(name);

            // Emit a Tauri event so the frontend can surface the crash immediately
            let _ = app.emit("subscription-crashed", SubscriptionCrashEvent {
                name: name.to_string(),
                panic_message: msg,
                consecutive_panics,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });

            // Apply backoff when panics exceed the threshold, to avoid
            // tight-looping on a persistently broken subscription.
            if consecutive_panics >= PANIC_BACKOFF_THRESHOLD {
                let multiplier = PANIC_BACKOFF_MULTIPLIER
                    .saturating_pow(consecutive_panics - PANIC_BACKOFF_THRESHOLD + 1)
                    .min(PANIC_BACKOFF_MAX);
                let effective = if has_idle_mode && !was_active { idle_interval } else { active_interval };
                let backoff = effective * multiplier;
                tracing::warn!(
                    subscription = name,
                    consecutive_panics,
                    backoff_secs = backoff.as_secs(),
                    "Applying backoff after repeated panics"
                );
                tokio::time::sleep(backoff).await;
            }
            continue;
        }

        // Successful tick — reset the panic counter
        if consecutive_panics > 0 {
            tracing::info!(
                subscription = name,
                previous_panics = consecutive_panics,
                "Subscription recovered after consecutive panics"
            );
            consecutive_panics = 0;
        }

        // Use the current effective interval for overrun / slow-tick detection
        let effective_interval = if has_idle_mode && !was_active { idle_interval } else { active_interval };
        scheduler.record_tick_latency(name, effective_interval, elapsed);

        let elapsed_ms = elapsed.as_millis() as u64;
        let interval_ms = effective_interval.as_millis() as u64;

        // Debug-level trace for every tick — available when tracing is turned up.
        tracing::debug!(
            subscription = name,
            elapsed_ms,
            interval_ms,
            "Tick completed"
        );

        if elapsed > effective_interval {
            tracing::warn!(
                subscription = name,
                elapsed_ms,
                interval_ms,
                "Tick overrun: subscription tick took longer than its configured interval"
            );
        } else {
            // Slow-tick early warning at 80% of interval
            let slow_threshold = interval_ms * SLOW_TICK_THRESHOLD_NUM / SLOW_TICK_THRESHOLD_DEN;
            if elapsed_ms > slow_threshold {
                tracing::warn!(
                    subscription = name,
                    elapsed_ms,
                    interval_ms,
                    threshold_ms = slow_threshold,
                    "Slow tick: approaching interval limit"
                );
            }
        }
    }
    scheduler.mark_subscription_dead(name);
    tracing::info!(subscription = name, "Subscription loop exited");
}

/// Spawn all reactive subscriptions as independent tokio tasks.
///
/// Each subscription gets its own task but the pattern is uniform: the caller
/// only needs to push a new `Box<dyn ReactiveSubscription>` to add a new
/// reactivity source -- no new `tokio::spawn` block required.
///
/// Returns the retained `JoinHandle`s so the caller can store them (preventing
/// silent task drops) and optionally await graceful shutdown.
pub fn spawn_subscriptions(
    subscriptions: Vec<Box<dyn ReactiveSubscription>>,
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
) -> Vec<tokio::task::JoinHandle<()>> {
    let mut handles = Vec::with_capacity(subscriptions.len());
    for sub in subscriptions {
        let sched = scheduler.clone();
        let app_handle = app.clone();
        handles.push(tokio::spawn(run_single(sub, sched, app_handle)));
    }
    handles
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TestSubscription {
        tick_count: Arc<AtomicU32>,
    }

    #[async_trait::async_trait]
    impl ReactiveSubscription for TestSubscription {
        fn name(&self) -> &'static str {
            "test"
        }

        fn interval(&self) -> Duration {
            Duration::from_millis(50)
        }

        async fn tick(&self) {
            self.tick_count.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn test_subscription_trait_name() {
        let count = Arc::new(AtomicU32::new(0));
        let sub = TestSubscription { tick_count: count };
        assert_eq!(sub.name(), "test");
        assert_eq!(sub.interval(), Duration::from_millis(50));
        assert_eq!(sub.initial_delay(), Duration::ZERO);
    }

    #[tokio::test]
    async fn test_subscription_ticks() {
        let count = Arc::new(AtomicU32::new(0));
        let sub = TestSubscription {
            tick_count: count.clone(),
        };
        sub.tick().await;
        sub.tick().await;
        assert_eq!(count.load(Ordering::Relaxed), 2);
    }

    /// A subscription whose tick always panics — used to verify the panic boundary.
    struct PanickingSubscription;

    #[async_trait::async_trait]
    impl ReactiveSubscription for PanickingSubscription {
        fn name(&self) -> &'static str {
            "panicker"
        }

        fn interval(&self) -> Duration {
            Duration::from_millis(50)
        }

        async fn tick(&self) {
            panic!("intentional test panic");
        }
    }

    #[tokio::test]
    async fn test_panic_boundary_catches_tick_panic() {
        use futures_util::FutureExt;

        let sub: Box<dyn ReactiveSubscription> = Box::new(PanickingSubscription);
        let result = AssertUnwindSafe(sub.tick()).catch_unwind().await;
        assert!(result.is_err(), "catch_unwind should capture the panic");
    }

    #[test]
    fn test_scheduler_crash_counter_from_subscription() {
        let state = SchedulerState::new();
        assert_eq!(state.stats().subscriptions_crashed, 0);
        state.record_subscription_crash("panicker");
        assert_eq!(state.stats().subscriptions_crashed, 1);
    }
}
