use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use ts_rs::TS;

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
    pub(super) running: AtomicBool,
    pub(super) webhook_alive: AtomicBool,
    /// True when at least one execution is in-flight. Subscriptions use this
    /// to choose between active and idle polling intervals.
    pub(super) active: AtomicBool,
    pub(super) events_processed: AtomicU64,
    pub(super) events_delivered: AtomicU64,
    pub(super) events_failed: AtomicU64,
    pub(crate) triggers_fired: AtomicU64,
    /// Total chain cascade evaluations (one per hop).
    pub(super) chain_cascades_total: AtomicU64,
    /// Cumulative wall-clock time spent evaluating chain cascades (ms).
    pub(super) chain_cascade_duration_ms: AtomicU64,
    /// Executions rejected due to queue backpressure (queue full).
    pub(super) queue_rejections: AtomicU64,
    /// Subscription ticks that panicked and were caught by the panic boundary.
    pub(super) subscriptions_crashed: AtomicU64,
    /// Chain trace continuity breaks: payload parse failures that caused a
    /// chain_trace_id to be lost, resulting in orphaned trace roots.
    pub(super) trace_continuity_breaks: AtomicU64,
    /// Events the stuck-`processing` reaper returned to the queue (redelivered
    /// or dead-lettered). Cumulative since scheduler start.
    pub(super) events_reaped: AtomicU64,
    /// Unix millis of the last stuck-event reap pass; 0 = never run.
    pub(super) stuck_reap_last_ms: AtomicU64,
    /// Event ids observed in `processing` on the PREVIOUS reap pass. A row must
    /// appear on two consecutive passes before it is considered stranded — a
    /// single snapshot cannot tell a stranded row from one a healthy tick (or
    /// the headless daemon, a separate process on the same DB) is processing
    /// right now, and `claim_pending` records no claim timestamp to lean on.
    pub(super) stuck_reap_seen: std::sync::Mutex<std::collections::HashSet<String>>,
    /// Per-subscription health tracking (latency, tick counts, errors).
    pub(super) subscription_health: std::sync::Mutex<HashMap<String, SubscriptionHealth>>,
    /// Retained JoinHandles for spawned subscription tasks. Prevents silent
    /// task drops and enables future graceful-shutdown awaits.
    pub(super) subscription_handles: std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>,
    /// Monotonic generation counter, bumped on every `start_loops` AND every
    /// `stop_loops`. `run_single` captures this at spawn time and compares a
    /// fresh load against it on every tick instead of checking the bare
    /// `running` bool. This matters because dropping a `JoinHandle` (which is
    /// all `stop_loops` used to do) does NOT abort the underlying tokio task —
    /// a subscription loop spawned before a stop keeps ticking. If liveness
    /// were still gated on `running` alone, a subsequent `start_loops` flips
    /// `running` back to `true` and that orphaned old loop's `is_running()`
    /// check reads `true` again, concluding (wrongly) that it's still current
    /// and continuing to poll -- two live copies of every trigger/webhook/
    /// schedule loop hammering the same DB (double-fired schedules, duplicate
    /// OAuth refresh). Bumping the generation on stop retires every orphan
    /// even though its handle was never aborted; each loop compares its own
    /// captured generation, not a shared bool that a restart can flip back.
    pub(super) generation: AtomicU64,
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
            events_reaped: AtomicU64::new(0),
            stuck_reap_last_ms: AtomicU64::new(0),
            stuck_reap_seen: std::sync::Mutex::new(std::collections::HashSet::new()),
            subscription_health: std::sync::Mutex::new(HashMap::new()),
            subscription_handles: std::sync::Mutex::new(Vec::new()),
            generation: AtomicU64::new(0),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Current generation. A spawned subscription loop snapshots this once at
    /// spawn time and must re-load it on every tick (see
    /// `subscription::run_single`) rather than checking `is_running()` --
    /// a stop-then-restart cycle flips `running` back to `true` while leaving
    /// any loop from the previous generation still alive (its `JoinHandle`
    /// was dropped, not aborted), so a bare bool can't tell "I'm current" from
    /// "I'm an orphan from before the restart."
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Atomically transition the scheduler from stopped to running. Returns
    /// the new generation on success, or `None` if the scheduler was already
    /// running. Callers MUST NOT spawn a subscription set when this returns
    /// `None` -- without this CAS, two concurrent `start_scheduler` calls can
    /// both observe `is_running() == false` (check-then-act race) and both
    /// spawn a full subscription set, doubling every trigger fire and OAuth
    /// refresh from that point on.
    pub fn try_begin_start(&self) -> Option<u64> {
        if self
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return None;
        }
        Some(self.generation.fetch_add(1, Ordering::SeqCst) + 1)
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
            events_reaped: self.events_reaped.load(Ordering::Relaxed),
            subscription_health: self.subscription_health(),
        }
    }

    /// Record metrics from a chain cascade hop evaluation.
    pub fn record_chain_cascade(&self, metrics: &crate::engine::chain::CascadeMetrics) {
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
    /// Events the stuck-`processing` reaper returned to the queue or
    /// dead-lettered since scheduler start. Normally 0 — a non-zero value means
    /// ticks are dying between claiming an event and writing its outcome.
    pub events_reaped: u64,
    pub subscription_health: Vec<SubscriptionHealth>,
}
