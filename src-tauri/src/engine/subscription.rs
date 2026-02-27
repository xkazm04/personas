//! Unified reactive subscription model.
//!
//! All background reactivity loops follow the same abstract pattern:
//!   1. **Source** — poll an external condition (DB rows, HTTP endpoints, etc.)
//!   2. **Predicate** — evaluate whether the condition warrants action
//!   3. **Action** — dispatch the side-effect (publish event, start execution, etc.)
//!
//! The [`ReactiveSubscription`] trait captures this pattern. Each subscription
//! declares its own poll interval, and the unified [`run_subscriptions`] loop
//! schedules all subscriptions through a single `tokio::select!` loop.
//!
//! Adding a new reactivity source (e.g., file-watch, WebSocket) only requires
//! implementing the trait — no new `tokio::spawn` block needed.

use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;

use crate::db::DbPool;
use crate::engine::background::SchedulerState;
use crate::engine::ExecutionEngine;

// ---------------------------------------------------------------------------
// Trait
// ---------------------------------------------------------------------------

/// A reactive subscription that the unified scheduler loop will poll.
///
/// Each implementor defines:
/// - `name()` — human-readable label for logs
/// - `interval()` — how often to poll
/// - `initial_delay()` — optional startup delay (default 0)
/// - `tick()` — the combined source → predicate → action cycle
#[async_trait::async_trait]
pub trait ReactiveSubscription: Send + Sync + 'static {
    /// Human-readable name for logging.
    fn name(&self) -> &'static str;

    /// How often this subscription should be polled.
    fn interval(&self) -> Duration;

    /// Optional delay before the first poll (e.g., let the app fully start).
    fn initial_delay(&self) -> Duration {
        Duration::ZERO
    }

    /// Execute one poll cycle: source → predicate → action.
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
        super::rotation::evaluate_due_rotations(&self.pool).await;
        super::rotation::detect_anomalies(&self.pool).await;
    }
}

// ---------------------------------------------------------------------------
// Unified scheduler loop
// ---------------------------------------------------------------------------

/// Run a single reactive subscription in its own task, respecting initial delay,
/// interval, and the scheduler's running flag.
async fn run_single(
    sub: Box<dyn ReactiveSubscription>,
    scheduler: Arc<SchedulerState>,
) {
    let name = sub.name();
    let delay = sub.initial_delay();
    if !delay.is_zero() {
        tracing::debug!(subscription = name, delay_secs = ?delay.as_secs(), "Delaying initial poll");
        tokio::time::sleep(delay).await;
    }

    let mut interval = tokio::time::interval(sub.interval());
    loop {
        interval.tick().await;
        if !scheduler.is_running() {
            break;
        }
        sub.tick().await;
    }
    tracing::info!(subscription = name, "Subscription loop exited");
}

/// Spawn all reactive subscriptions as independent tokio tasks.
///
/// Each subscription gets its own task but the pattern is uniform: the caller
/// only needs to push a new `Box<dyn ReactiveSubscription>` to add a new
/// reactivity source — no new `tokio::spawn` block required.
pub fn spawn_subscriptions(
    subscriptions: Vec<Box<dyn ReactiveSubscription>>,
    scheduler: Arc<SchedulerState>,
) {
    for sub in subscriptions {
        let sched = scheduler.clone();
        tokio::spawn(run_single(sub, sched));
    }
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
}
