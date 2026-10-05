//! Repeat bound shared by the stdout and JSONL sinks.
//!
//! The first [`DEFAULT_LIMIT`] events per fingerprint in a
//! [`DEFAULT_WINDOW_MS`] window pass; the rest of that window is counted, not
//! written. When the window has rolled over, the next event with that
//! fingerprint (or the periodic sweep, whichever comes first) queues one
//! `log.suppressed` summary that the JSONL layer writes before its next
//! record. ERROR, the `devlog` target and the WebView aggregates
//! ([`UNLIMITED_TARGETS`]) are never limited, and Sentry sits
//! outside the [`RateLimited`] wrapper.
//!
//! The sweep piggy-backs on events (no thread): at most every
//! [`DEFAULT_SWEEP_MS`] it walks every shard, queues the summaries of expired
//! windows and evicts them, which is also what bounds the map. Nothing is
//! flushed at process exit, so a storm in the last window before exit loses
//! its summary.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

/// Targets that are never limited. `devlog` carries the sink's own records
/// (`boot.start`, `log.suppressed`). The two WebView kinds are ALREADY
/// aggregates - one record per command or tag per flush - and they share one
/// constant message, so a per-fingerprint bound would drop most of a flush's
/// rows and with them the per-command latency they exist to carry (measured
/// 2026-10-05: 1,255 `ipc_window` rows withheld in one boot).
const UNLIMITED_TARGETS: [&str; 3] = ["devlog", "webview::ipc_window", "webview::swallow_rollup"];

use std::any::TypeId;

use tracing::level_filters::LevelFilter;
use tracing::span::{Attributes, Id, Record};
use tracing::subscriber::Interest;
use tracing::{Dispatch, Event, Level, Metadata, Subscriber};
use tracing_subscriber::layer::{Context, Layer};

use super::fingerprint::stamp_event;

pub const DEFAULT_LIMIT: u32 = 20;
pub const DEFAULT_WINDOW_MS: u64 = 60_000;
pub const DEFAULT_SWEEP_MS: u64 = 10_000;
const SHARDS: usize = 16;

/// Milliseconds since an origin. Injectable so tests can roll a window
/// without sleeping through it.
#[derive(Clone)]
pub enum Clock {
    System(Instant),
    #[cfg_attr(not(test), allow(dead_code))]
    Manual(Arc<AtomicU64>),
}

impl Clock {
    pub fn system() -> Self {
        Clock::System(Instant::now())
    }

    fn now_ms(&self) -> u64 {
        match self {
            Clock::System(origin) => origin.elapsed().as_millis() as u64,
            Clock::Manual(ms) => ms.load(Ordering::Relaxed),
        }
    }
}

/// One fingerprint's suppressed run, waiting to be written.
#[derive(Debug, Clone, PartialEq)]
pub struct Suppressed {
    pub fp: u32,
    pub count: u64,
    pub window_s: u64,
    pub sample_tgt: String,
}

struct Window {
    start_ms: u64,
    passed: u32,
    suppressed: u64,
    sample_tgt: Box<str>,
}

struct Inner {
    shards: [Mutex<HashMap<u32, Window>>; SHARDS],
    limit: u32,
    window_ms: u64,
    sweep_ms: u64,
    last_sweep_ms: AtomicU64,
    clock: Clock,
    pending: Mutex<Vec<Suppressed>>,
    has_pending: AtomicBool,
}

/// The limiter's shared state. Cloning shares it, which is how the JSONL
/// layer reads the queued summaries.
#[derive(Clone)]
pub struct RateLimit {
    inner: Arc<Inner>,
}

/// A poisoned lock here guards a counter cache, not an invariant: keep going.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl RateLimit {
    pub fn new(clock: Clock) -> Self {
        Self::with_params(clock, DEFAULT_LIMIT, DEFAULT_WINDOW_MS, DEFAULT_SWEEP_MS)
    }

    pub fn with_params(clock: Clock, limit: u32, window_ms: u64, sweep_ms: u64) -> Self {
        let now = clock.now_ms();
        Self {
            inner: Arc::new(Inner {
                shards: std::array::from_fn(|_| Mutex::new(HashMap::new())),
                limit,
                window_ms,
                sweep_ms,
                last_sweep_ms: AtomicU64::new(now),
                clock,
                pending: Mutex::new(Vec::new()),
                has_pending: AtomicBool::new(false),
            }),
        }
    }

    /// Whether an event with this fingerprint is written.
    pub fn admit(&self, level: &Level, target: &str, fp: u32) -> bool {
        let inner = &self.inner;
        let now = inner.clock.now_ms();
        self.maybe_sweep(now);
        if *level == Level::ERROR || UNLIMITED_TARGETS.contains(&target) {
            return true;
        }
        let mut shard = lock(&inner.shards[fp as usize % SHARDS]);
        let Some(w) = shard.get_mut(&fp) else {
            shard.insert(
                fp,
                Window {
                    start_ms: now,
                    passed: 1,
                    suppressed: 0,
                    sample_tgt: target.into(),
                },
            );
            return true;
        };
        if now.saturating_sub(w.start_ms) >= inner.window_ms {
            if w.suppressed > 0 {
                self.queue(Suppressed {
                    fp,
                    count: w.suppressed,
                    window_s: inner.window_ms / 1000,
                    sample_tgt: w.sample_tgt.to_string(),
                });
            }
            w.start_ms = now;
            w.passed = 1;
            w.suppressed = 0;
            return true;
        }
        if w.passed < inner.limit {
            w.passed += 1;
            true
        } else {
            w.suppressed += 1;
            false
        }
    }

    fn queue(&self, s: Suppressed) {
        lock(&self.inner.pending).push(s);
        self.inner.has_pending.store(true, Ordering::Release);
    }

    fn maybe_sweep(&self, now: u64) {
        let inner = &self.inner;
        let last = inner.last_sweep_ms.load(Ordering::Relaxed);
        if now.saturating_sub(last) < inner.sweep_ms
            || inner
                .last_sweep_ms
                .compare_exchange(last, now, Ordering::AcqRel, Ordering::Relaxed)
                .is_err()
        {
            return;
        }
        for shard in &inner.shards {
            lock(shard).retain(|fp, w| {
                if now.saturating_sub(w.start_ms) < inner.window_ms {
                    return true;
                }
                if w.suppressed > 0 {
                    self.queue(Suppressed {
                        fp: *fp,
                        count: w.suppressed,
                        window_s: inner.window_ms / 1000,
                        sample_tgt: w.sample_tgt.to_string(),
                    });
                }
                false
            });
        }
    }

    /// Summaries queued since the last call, oldest first.
    pub fn take_pending(&self) -> Vec<Suppressed> {
        if !self.inner.has_pending.swap(false, Ordering::AcqRel) {
            return Vec::new();
        }
        std::mem::take(&mut *lock(&self.inner.pending))
    }
}

/// The sinks behind the rate limit: a layer that forwards everything to
/// `inner` and drops only the events [`RateLimit::admit`] refuses.
///
/// Not a per-layer `Filter`: tracing-subscriber 0.3.22 debug-asserts on the
/// event AFTER one a per-layer filter's `event_enabled` refused when no other
/// layer took it (`filter/layer_filters/mod.rs:1158`, `FilterMap` left dirty),
/// which would panic the logging path of every debug build. Deciding inside
/// `on_event` keeps the verdict local to these sinks and leaves Sentry and the
/// subscriber's own enablement untouched.
pub struct RateLimited<L> {
    inner: L,
    rate: RateLimit,
}

impl<L> RateLimited<L> {
    pub fn new(inner: L, rate: RateLimit) -> Self {
        Self { inner, rate }
    }
}

impl<S, L> Layer<S> for RateLimited<L>
where
    S: Subscriber,
    L: Layer<S>,
{
    fn on_register_dispatch(&self, subscriber: &Dispatch) {
        self.inner.on_register_dispatch(subscriber);
    }

    fn on_layer(&mut self, subscriber: &mut S) {
        self.inner.on_layer(subscriber);
    }

    fn register_callsite(&self, metadata: &'static Metadata<'static>) -> Interest {
        self.inner.register_callsite(metadata)
    }

    fn enabled(&self, metadata: &Metadata<'_>, ctx: Context<'_, S>) -> bool {
        self.inner.enabled(metadata, ctx)
    }

    fn max_level_hint(&self) -> Option<LevelFilter> {
        self.inner.max_level_hint()
    }

    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        self.inner.on_new_span(attrs, id, ctx);
    }

    fn on_record(&self, span: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        self.inner.on_record(span, values, ctx);
    }

    fn on_follows_from(&self, span: &Id, follows: &Id, ctx: Context<'_, S>) {
        self.inner.on_follows_from(span, follows, ctx);
    }

    fn event_enabled(&self, event: &Event<'_>, ctx: Context<'_, S>) -> bool {
        self.inner.event_enabled(event, ctx)
    }

    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        // Stamping here (fp + formatted message) leaves the result in a
        // thread-local the JSONL layer picks up, so each event is
        // fingerprinted once however many sinks it reaches.
        let fp = stamp_event(event);
        let meta = event.metadata();
        if self.rate.admit(meta.level(), meta.target(), fp) {
            self.inner.on_event(event, ctx);
        }
    }

    fn on_enter(&self, id: &Id, ctx: Context<'_, S>) {
        self.inner.on_enter(id, ctx);
    }

    fn on_exit(&self, id: &Id, ctx: Context<'_, S>) {
        self.inner.on_exit(id, ctx);
    }

    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        self.inner.on_close(id, ctx);
    }

    fn on_id_change(&self, old: &Id, new: &Id, ctx: Context<'_, S>) {
        self.inner.on_id_change(old, new, ctx);
    }

    unsafe fn downcast_raw(&self, id: TypeId) -> Option<*const ()> {
        if id == TypeId::of::<Self>() {
            return Some(self as *const Self as *const ());
        }
        // SAFETY: forwarded unchanged; the inner layer upholds the contract
        // for its own types.
        unsafe { self.inner.downcast_raw(id) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manual(limit: u32) -> (RateLimit, Arc<AtomicU64>) {
        let ms = Arc::new(AtomicU64::new(0));
        (
            RateLimit::with_params(Clock::Manual(ms.clone()), limit, 60_000, 10_000),
            ms,
        )
    }

    #[test]
    fn first_n_pass_then_rollover_queues_one_summary() {
        let (rl, clock) = manual(20);
        let passed = (0..100)
            .filter(|_| rl.admit(&Level::WARN, "app_lib::x", 7))
            .count();
        assert_eq!(passed, 20);
        assert!(rl.take_pending().is_empty(), "nothing queued mid-window");

        clock.store(61_000, Ordering::Relaxed);
        assert!(rl.admit(&Level::WARN, "app_lib::x", 7));
        assert_eq!(
            rl.take_pending(),
            vec![Suppressed {
                fp: 7,
                count: 80,
                window_s: 60,
                sample_tgt: "app_lib::x".into()
            }]
        );
    }

    #[test]
    fn error_and_devlog_are_never_limited() {
        let (rl, _) = manual(2);
        assert!((0..50).all(|_| rl.admit(&Level::ERROR, "app_lib::x", 1)));
        assert!((0..50).all(|_| rl.admit(&Level::INFO, "devlog", 2)));
    }

    #[test]
    fn webview_aggregates_are_never_limited() {
        let (rl, _) = manual(2);
        assert!((0..50).all(|_| rl.admit(&Level::DEBUG, "webview::ipc_window", 3)));
        assert!((0..50).all(|_| rl.admit(&Level::INFO, "webview::swallow_rollup", 4)));
        // A non-aggregate WebView kind is still bounded.
        assert_eq!(
            (0..50)
                .filter(|_| rl.admit(&Level::WARN, "webview::ipc_slow", 5))
                .count(),
            2
        );
    }

    #[test]
    fn sweep_flushes_a_storm_that_never_recurs_and_evicts_it() {
        let (rl, clock) = manual(1);
        for _ in 0..5 {
            rl.admit(&Level::WARN, "a", 9);
        }
        clock.store(70_000, Ordering::Relaxed);
        // A different fingerprint triggers the sweep.
        rl.admit(&Level::INFO, "b", 10);
        let pending = rl.take_pending();
        assert_eq!(pending.len(), 1);
        assert_eq!((pending[0].fp, pending[0].count), (9, 4));
        let live: usize = rl.inner.shards.iter().map(|s| lock(s).len()).sum();
        assert_eq!(live, 1, "the expired window is evicted, the new one kept");
    }
}
