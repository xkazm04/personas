use std::time::Duration;

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

    /// Whether this subscription is an engine *singleton* that must run only
    /// on the instance holding engine leadership (multi-driver orchestration,
    /// ADR 2026-05-26 — `engine/leadership.rs`). Default `true`: every loop in
    /// this registry is a singleton (scheduler, polling, OAuth refresh, relays,
    /// event bus) and double-running it across instances on one shared DB is a
    /// bug. A genuinely per-instance subscription overrides to `false`.
    fn requires_leadership(&self) -> bool {
        true
    }

    /// Optional push-wake signal. When `Some`, the scheduler loop runs the tick
    /// as soon as the signal fires OR the poll interval elapses — whichever
    /// comes first. The poll interval is unchanged and acts as the
    /// degraded-mode heartbeat when signals are missed. Default `None`
    /// (pure polling).
    fn wake_signal(&self) -> Option<&'static tokio::sync::Notify> {
        None
    }
}

/// Run a blocking, DB-heavy tick body on the blocking thread pool.
///
/// rusqlite is synchronous: calling repo functions directly inside an
/// `async fn tick()` occupies a tokio worker thread for the whole query
/// (up to `POOL_ACQUIRE_TIMEOUT` under pool contention). Offloading to
/// `spawn_blocking` keeps async workers free for IPC and other tasks.
///
/// If the blocking closure panics, the panic is re-propagated onto the
/// tick future so `run_single`'s `catch_unwind` still records the crash
/// and applies backoff — preserving the existing crash-surfacing behavior.
pub(super) async fn run_blocking_tick<F>(f: F)
where
    F: FnOnce() + Send + 'static,
{
    if let Err(join_err) = tokio::task::spawn_blocking(f).await {
        if join_err.is_panic() {
            std::panic::resume_unwind(join_err.into_panic());
        }
    }
}
