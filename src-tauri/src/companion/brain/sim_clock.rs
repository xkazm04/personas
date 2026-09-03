//! The brain's one reading of "now".
//!
//! Every timestamp the companion brain writes, and every interval it compares
//! against, used to come from a direct `chrono::Utc::now()` call or from
//! SQLite's `datetime('now')` column default. That is fine for a process that
//! lives in real time, and fatal for a harness that wants to replay a *year* of
//! conversation in minutes: the 6-hour lifecycle latch never fires, the sleep
//! cycle's `MIN_INTERVAL_HOURS` floor never elapses, and every fact is written
//! at the same instant, so decay measures nothing.
//!
//! So the brain reads the clock through here instead. With no override set,
//! [`now`] IS `Utc::now()` — the same value, from the same call, so production
//! behaviour is byte-identical and there is no branch worth measuring. With an
//! override set (only the `memory-sim` driver and tests ever set one) the whole
//! brain moves to simulated time at once: writes, comparisons, latches and
//! floors, consistently, because they all read the same seam.
//!
//! ## Why a process global rather than a threaded parameter
//!
//! The alternative is a `now: DateTime<Utc>` argument on roughly fifty
//! functions across twenty files, most of which are Tauri commands whose
//! signatures are wire contracts. The seam has to be *complete* to be useful —
//! one missed site and the simulated year silently mixes two clocks — and a
//! global is the only shape that can be made complete without rewriting the
//! module's public surface. It is set once per request by a single-threaded
//! driver and never in the shipped app.
//!
//! ## Two formats, deliberately
//!
//! - [`now`] backs every `Utc::now()` the brain used to make, and callers keep
//!   their own `.to_rfc3339()`.
//! - [`now_sql`] is the shape SQLite's `datetime('now')` writes
//!   (`YYYY-MM-DD HH:MM:SS`), for the handful of columns whose default the
//!   brain used to lean on. Both shapes already coexist in `companion_cycle`
//!   (see `sleep_cycle::parse::parse_ts`), so this introduces no new ambiguity
//!   — it just makes the second shape settable.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

use chrono::{DateTime, TimeZone, Utc};

/// Whether an override is in force. Separate from the value so that `set(0)`
/// (the unix epoch) is a legal simulated instant rather than "unset".
static OVERRIDDEN: AtomicBool = AtomicBool::new(false);
/// The simulated instant, in whole unix seconds.
static SIM_UNIX: AtomicI64 = AtomicI64::new(0);

/// Pin the brain's clock to `unix` (seconds since the epoch).
///
/// Every subsequent [`now`] / [`now_sql`] answers with that instant until the
/// next `set` or a [`clear`]. Only the simulation driver and tests call this.
// No setter has a caller on a shipped build — which is the point: with nothing
// able to set the override, `now()` there is exactly `Utc::now()`.
#[cfg_attr(not(any(test, feature = "memory-sim")), allow(dead_code))]
pub fn set(unix: i64) {
    SIM_UNIX.store(unix, Ordering::Relaxed);
    OVERRIDDEN.store(true, Ordering::Release);
}

/// Drop back to real time.
#[allow(dead_code)] // the driver clears on shutdown; nothing in the app sets one
pub fn clear() {
    OVERRIDDEN.store(false, Ordering::Release);
}

/// True while an override is in force. Exposed so a diagnostic can say which
/// clock produced a timestamp rather than leaving the reader to guess.
#[allow(dead_code)]
pub fn is_simulated() -> bool {
    OVERRIDDEN.load(Ordering::Acquire)
}

/// The brain's current instant: the override when one is set, real UTC
/// otherwise.
///
/// The fallback inside the override arm is not defensive noise — an out-of-range
/// unix second cannot become a `DateTime`, and answering with real time beats
/// panicking inside a chat turn.
pub fn now() -> DateTime<Utc> {
    if OVERRIDDEN.load(Ordering::Acquire) {
        let secs = SIM_UNIX.load(Ordering::Relaxed);
        return Utc
            .timestamp_opt(secs, 0)
            .single()
            .unwrap_or_else(Utc::now);
    }
    Utc::now()
}

/// [`now`] in SQLite's `datetime('now')` format: `YYYY-MM-DD HH:MM:SS`, UTC, no
/// zone suffix. The exact text the column defaults this seam replaces used to
/// produce.
pub fn now_sql() -> String {
    now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// `now()` minus `days`, as RFC3339 — the shape the several
/// `datetime('now', '-N days')` predicates in this module needed once they
/// became bound parameters.
pub fn days_ago_sql(days: i64) -> String {
    (now() - chrono::Duration::days(days))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The property the whole seam rests on: unset, this is `Utc::now()`.
    #[test]
    fn unset_tracks_real_time() {
        clear();
        let before = Utc::now();
        let seam = now();
        let after = Utc::now();
        assert!(seam >= before && seam <= after, "{seam} not in [{before}, {after}]");
        assert!(!is_simulated());
    }

    #[test]
    fn set_pins_both_formats_and_clear_releases() {
        set(1_767_225_600); // 2026-01-01T00:00:00Z
        assert!(is_simulated());
        assert_eq!(now().to_rfc3339(), "2026-01-01T00:00:00+00:00");
        assert_eq!(now_sql(), "2026-01-01 00:00:00");
        assert_eq!(days_ago_sql(1), "2025-12-31 00:00:00");
        clear();
        assert!(!is_simulated());
    }
}
