use super::*;
use crate::engine::background::{SchedulerState, SubscriptionCrashEvent};
use crate::engine::event_registry::event_name;
use futures_util::FutureExt;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::Instant;
use tauri::AppHandle;
use tauri::{Emitter, Manager};

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
/// interval, and its own captured generation.
///
/// Adaptively switches between `interval()` and `idle_interval()` based on
/// the scheduler's active flag, reducing CPU/IO when the system is idle.
///
/// Applies exponential backoff when a subscription repeatedly panics, similar
/// to [`PeriodicTask`](crate::engine::p2p::periodic::PeriodicTask).
///
/// Registers itself as alive/dead in `SchedulerState` and emits a
/// `subscription-crashed` Tauri event on every panic so the frontend can
/// surface dead subscriptions immediately.
///
/// `generation` is the scheduler generation active at the moment this task
/// was spawned (see `SchedulerState::try_begin_start` /
/// `background::start_loops`). Each tick re-checks it against a fresh
/// `scheduler.generation()` load instead of the bare `is_running()` bool --
/// a bare bool can't distinguish "the scheduler is currently running" from
/// "the scheduler was stopped and restarted since I was spawned": dropping a
/// `JoinHandle` (all `stop_loops` used to do) doesn't abort this task, so a
/// stop+restart flips `running` back to `true` while this loop is still
/// alive, and it would wrongly conclude it's current and keep polling --
/// producing a second live copy of every trigger/webhook/schedule loop
/// against the same DB.
async fn run_single(
    sub: Box<dyn ReactiveSubscription>,
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
    generation: u64,
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
    let wake = sub.wake_signal();
    loop {
        // Wait for the poll interval OR (when the subscription declares one)
        // a push-wake signal — whichever fires first. A wake that lands while
        // a tick is running is stored as a Notify permit, so the follow-up
        // `notified()` completes immediately and the new work is picked up on
        // the very next loop iteration (no lost wakeups). Dropping the losing
        // `interval.tick()` future does not disturb the interval's schedule —
        // the poll heartbeat cadence is unchanged.
        match wake {
            Some(notify) => {
                tokio::select! {
                    _ = interval.tick() => {}
                    _ = notify.notified() => {
                        tracing::trace!(subscription = name, "Push-wake signal received");
                    }
                }
            }
            None => {
                interval.tick().await;
            }
        }
        // Finding #1: compare OUR captured generation against a fresh load,
        // not the shared `running` bool. See the doc comment above for why
        // `is_running()` alone is unsafe here.
        if scheduler.generation() != generation {
            tracing::debug!(
                subscription = name,
                spawned_generation = generation,
                current_generation = scheduler.generation(),
                "Subscription loop retiring -- scheduler generation moved on (stop or restart since spawn)"
            );
            break;
        }

        // Engine-leadership gate (multi-driver orchestration, ADR 2026-05-26):
        // a leader-only subscription ticks only on the instance that currently
        // holds engine leadership, so multiple instances on one shared DB never
        // double-run a singleton loop (double scheduler fires, double OAuth
        // rotation, double relay consumption). If AppState isn't available
        // (e.g. unit tests), behave as leader — no regression from today's
        // single-instance behavior. A follower just idles + re-checks each
        // interval, taking over within the lease's stale window if the leader dies.
        if sub.requires_leadership()
            && !app
                .try_state::<std::sync::Arc<crate::AppState>>()
                .map(|s| s.leadership.is_leader())
                .unwrap_or(true)
        {
            continue;
        }

        // Switch interval when activity level changes
        if has_idle_mode {
            let is_active = scheduler.is_active();
            if is_active != was_active {
                let new_dur = if is_active {
                    active_interval
                } else {
                    idle_interval
                };
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
        let tick_future = {
            let _span = tracing::debug_span!("subscription_tick", subscription = name).entered();
            // Panic boundary: catch any panic inside tick() so the subscription
            // loop survives and the crash is surfaced via logs + metrics.
            AssertUnwindSafe(sub.tick()).catch_unwind()
        };
        let tick_result = tick_future.await;
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
            let _ = app.emit(
                event_name::SUBSCRIPTION_CRASHED,
                SubscriptionCrashEvent {
                    name: name.to_string(),
                    panic_message: msg,
                    consecutive_panics,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
            );

            // Apply backoff when panics exceed the threshold, to avoid
            // tight-looping on a persistently broken subscription.
            if consecutive_panics >= PANIC_BACKOFF_THRESHOLD {
                let multiplier = PANIC_BACKOFF_MULTIPLIER
                    .saturating_pow(consecutive_panics - PANIC_BACKOFF_THRESHOLD + 1)
                    .min(PANIC_BACKOFF_MAX);
                let effective = if has_idle_mode && !was_active {
                    idle_interval
                } else {
                    active_interval
                };
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
        let effective_interval = if has_idle_mode && !was_active {
            idle_interval
        } else {
            active_interval
        };
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
///
/// `generation` is the scheduler generation this batch is being spawned
/// under (see `SchedulerState::try_begin_start`); every spawned loop
/// captures it and self-retires when the scheduler's generation moves past
/// it (see `run_single`).
pub fn spawn_subscriptions(
    subscriptions: Vec<Box<dyn ReactiveSubscription>>,
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
    generation: u64,
) -> Vec<tokio::task::JoinHandle<()>> {
    let mut handles = Vec::with_capacity(subscriptions.len());
    for sub in subscriptions {
        let sched = scheduler.clone();
        let app_handle = app.clone();
        handles.push(tokio::spawn(run_single(sub, sched, app_handle, generation)));
    }
    handles
}
