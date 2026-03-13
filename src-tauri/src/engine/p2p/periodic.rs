//! Generic periodic-task harness for P2P background loops.
//!
//! Eliminates duplicated sleep → check → error-handle → repeat boilerplate
//! across health checks, manifest sync, mDNS pruning, etc.

use std::future::Future;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

/// Configuration for a periodic background task.
pub struct PeriodicTask {
    /// Human-readable name used in tracing spans and logs.
    name: &'static str,
    /// Returns the current interval each tick (supports live config reload).
    get_interval: Box<dyn Fn() -> Duration + Send>,
    /// Maximum consecutive errors before applying backoff.
    max_consecutive_errors: u32,
    /// How much to multiply the interval on consecutive errors.
    backoff_multiplier: u32,
    /// Token to signal graceful shutdown.
    cancel: CancellationToken,
}

impl PeriodicTask {
    /// Create a new periodic task with a fixed interval.
    pub fn new(name: &'static str, interval: Duration, cancel: CancellationToken) -> Self {
        Self {
            name,
            get_interval: Box::new(move || interval),
            max_consecutive_errors: 3,
            backoff_multiplier: 2,
            cancel,
        }
    }

    /// Create a periodic task that reads its interval dynamically each tick.
    /// This supports hot-reloading config without restarting the task.
    pub fn with_dynamic_interval(
        name: &'static str,
        get_interval: impl Fn() -> Duration + Send + 'static,
        cancel: CancellationToken,
    ) -> Self {
        Self {
            name,
            get_interval: Box::new(get_interval),
            max_consecutive_errors: 3,
            backoff_multiplier: 2,
            cancel,
        }
    }

    /// Override the consecutive error threshold for backoff (default: 3).
    pub fn with_max_errors(mut self, n: u32) -> Self {
        self.max_consecutive_errors = n;
        self
    }

    /// Override the backoff multiplier (default: 2).
    pub fn with_backoff_multiplier(mut self, m: u32) -> Self {
        self.backoff_multiplier = m;
        self
    }

    /// Run the periodic task loop until the cancellation token is triggered.
    ///
    /// `task_fn` is called each interval and should return `Ok(())` on success
    /// or `Err(message)` on failure. On repeated failures, the interval is
    /// extended via exponential backoff to avoid log spam and resource waste.
    pub async fn run<F, Fut>(self, mut task_fn: F)
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<(), String>>,
    {
        let mut consecutive_errors: u32 = 0;

        loop {
            // Read interval dynamically each tick
            let base_interval = (self.get_interval)();

            // Compute effective sleep: apply backoff if we've hit repeated errors
            let effective_interval = if consecutive_errors >= self.max_consecutive_errors {
                let multiplier = self
                    .backoff_multiplier
                    .saturating_pow(consecutive_errors - self.max_consecutive_errors + 1)
                    .min(60); // cap at 60x the base interval
                base_interval * multiplier
            } else {
                base_interval
            };

            // Wait for the interval or cancellation
            tokio::select! {
                _ = tokio::time::sleep(effective_interval) => {}
                _ = self.cancel.cancelled() => {
                    tracing::info!(task = self.name, "Periodic task shutting down");
                    return;
                }
            }

            // Execute the task within a tracing span
            let span = tracing::info_span!("periodic_task", task = self.name);
            let result = {
                let _guard = span.enter();
                task_fn().await
            };

            match result {
                Ok(()) => {
                    if consecutive_errors > 0 {
                        tracing::info!(
                            task = self.name,
                            previous_errors = consecutive_errors,
                            "Periodic task recovered"
                        );
                    }
                    consecutive_errors = 0;
                }
                Err(e) => {
                    consecutive_errors = consecutive_errors.saturating_add(1);
                    if consecutive_errors <= self.max_consecutive_errors {
                        tracing::warn!(
                            task = self.name,
                            error = %e,
                            consecutive = consecutive_errors,
                            "Periodic task failed"
                        );
                    } else {
                        tracing::warn!(
                            task = self.name,
                            error = %e,
                            consecutive = consecutive_errors,
                            backoff_secs = effective_interval.as_secs(),
                            "Periodic task failed (backing off)"
                        );
                    }
                }
            }
        }
    }
}
