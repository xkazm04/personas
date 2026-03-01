use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Sliding-window rate limiter using in-memory token buckets.
///
/// Each key (e.g. source type or trigger ID) gets its own bucket with
/// a configurable window and max event count.
pub struct RateLimiter {
    /// Per-key buckets: key → list of timestamps within the window.
    buckets: Mutex<HashMap<String, Vec<Instant>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Attempt to consume one token for `key`.
    ///
    /// Returns `Ok(())` if allowed, or `Err(retry_after_secs)` with the
    /// number of seconds until the oldest entry in the window expires.
    pub fn check(&self, key: &str, max_events: usize, window: Duration) -> Result<(), u64> {
        let now = Instant::now();
        let cutoff = now - window;

        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        let timestamps = buckets.entry(key.to_string()).or_default();

        // Evict expired entries
        timestamps.retain(|t| *t > cutoff);

        if timestamps.len() >= max_events {
            // Calculate how long until the oldest entry expires
            let oldest = timestamps[0];
            let retry_after = window
                .checked_sub(now.duration_since(oldest))
                .unwrap_or(Duration::from_secs(1));
            return Err(retry_after.as_secs().max(1));
        }

        timestamps.push(now);
        Ok(())
    }

    /// Periodically prune empty or fully-expired buckets to prevent unbounded
    /// memory growth. Called opportunistically, not on every request.
    pub fn prune(&self, window: Duration) {
        let cutoff = Instant::now() - window;
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        buckets.retain(|_, timestamps| {
            timestamps.retain(|t| *t > cutoff);
            !timestamps.is_empty()
        });
    }
}

// ── Default limits ──────────────────────────────────────────────────────

/// Max events per source type per window (60 events/minute).
pub const EVENT_SOURCE_MAX: usize = 60;
/// Window duration for event source rate limiting.
pub const EVENT_SOURCE_WINDOW: Duration = Duration::from_secs(60);

/// Max webhook calls per trigger per window (10 calls/minute).
pub const WEBHOOK_TRIGGER_MAX: usize = 10;
/// Window duration for webhook rate limiting.
pub const WEBHOOK_TRIGGER_WINDOW: Duration = Duration::from_secs(60);

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_allows_within_limit() {
        let rl = RateLimiter::new();
        for _ in 0..5 {
            assert!(rl.check("key", 5, Duration::from_secs(60)).is_ok());
        }
    }

    #[test]
    fn test_rejects_over_limit() {
        let rl = RateLimiter::new();
        for _ in 0..5 {
            rl.check("key", 5, Duration::from_secs(60)).unwrap();
        }
        let result = rl.check("key", 5, Duration::from_secs(60));
        assert!(result.is_err());
    }

    #[test]
    fn test_separate_keys() {
        let rl = RateLimiter::new();
        for _ in 0..3 {
            rl.check("a", 3, Duration::from_secs(60)).unwrap();
        }
        // "a" is exhausted but "b" should still work
        assert!(rl.check("a", 3, Duration::from_secs(60)).is_err());
        assert!(rl.check("b", 3, Duration::from_secs(60)).is_ok());
    }

    #[test]
    fn test_window_expiry() {
        let rl = RateLimiter::new();
        let short_window = Duration::from_millis(50);
        for _ in 0..3 {
            rl.check("key", 3, short_window).unwrap();
        }
        assert!(rl.check("key", 3, short_window).is_err());
        // Wait for the window to expire
        thread::sleep(Duration::from_millis(60));
        assert!(rl.check("key", 3, short_window).is_ok());
    }

    #[test]
    fn test_prune_removes_expired_buckets() {
        let rl = RateLimiter::new();
        let short_window = Duration::from_millis(50);
        rl.check("key1", 10, short_window).unwrap();
        thread::sleep(Duration::from_millis(60));
        rl.prune(short_window);
        let buckets = rl.buckets.lock().unwrap();
        assert!(buckets.is_empty());
    }
}
