//! **The quota governor** — stop the autonomous loop just before the
//! subscription's rate-limit window does it for us.
//!
//! # Why this exists
//!
//! A monthly Claude subscription is limited on two rolling windows, a 5-hour
//! one and a 7-day one, and [`crate::commands::fleet::claude_usage`] already
//! reads the live utilisation of both from Anthropic's OAuth usage endpoint —
//! the only source that knows the real ceiling. Until now nothing in the
//! autonomous loop consulted it. The loop found the wall by hitting it:
//! measured 2026-09-09, a burst of fifteen concurrent executions took the
//! 5-hour window to its limit, and six of seven personas then spent their next
//! wake being told "usage limit reached" by the CLI. That path works — the
//! wake is not spent and the persona resumes ([`super::attention`]'s paused
//! verdict) — but it is a wall, not a plan: work stops mid-flight, the reset
//! time is usually not stated so a default hour is guessed, and the operator
//! learns about it afterwards.
//!
//! So the loop now watches the same gauge the operator watches, and **stops
//! dispatching at [`SETTING_STOP_PCT`] (default 97 %) of either window**,
//! leaving the last sliver of the quota for whatever is already running and
//! for the operator's own session.
//!
//! # Why it does not switch accounts instead
//!
//! [`crate::commands::fleet::claude_accounts::rotate`] can switch to a cooler
//! stored login, and its machinery is sound — it stashes the live credential,
//! refreshes the target's OAuth token under the CLI lock, and rewrites what
//! the CLI reads. But on this install `claude_accounts` holds **zero rows**
//! and `claude_accounts.auto_rotate` is unset, so there is nothing to rotate
//! to and the setting lookup logs an unknown key on every subscription tick.
//! Rotation is therefore not a path this governor can rely on; when a second
//! login is captured, the two compose (rotate first, stop only if every stored
//! account is spent). Until then the stop is the whole mechanism and the
//! switch is the operator's.
//!
//! # Failing open, deliberately
//!
//! If the usage endpoint cannot be read — an API-key install with no OAuth
//! login, a token in the macOS Keychain rather than the file, the network
//! down — the governor **does not block**. A gauge that cannot be read is not
//! evidence that the tank is empty, and freezing an entire organisation on an
//! unreadable gauge would be a worse failure than the wall this exists to
//! avoid. The unavailable reason is logged once per transition instead.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use crate::commands::fleet::claude_usage::{cached_snapshot, ClaudeUsageSnapshot};
use crate::db::repos::core::settings;
use crate::db::DbPool;

/// Percent utilisation at which the loop stops dispatching. One setting, so
/// the operator can lower it for a shared account or raise it when they are
/// watching.
pub const SETTING_STOP_PCT: &str = crate::db::settings_keys::ATTENTION_USAGE_STOP_PCT;

/// Points below the stop at which a headless FLEET WORKER is not started
/// (G42). The decide lane is a bounded call; a worker is a multi-turn CLI
/// session that keeps burning after the window has filled under it.
pub const SETTING_FLEET_START_MARGIN_PCT: &str =
    crate::db::settings_keys::ATTENTION_FLEET_START_MARGIN_PCT;
pub const DEFAULT_FLEET_START_MARGIN_PCT: f64 = 10.0;
const MIN_FLEET_START_MARGIN_PCT: f64 = 0.0;
const MAX_FLEET_START_MARGIN_PCT: f64 = 40.0;

/// 97 %, not 100: the last few percent belong to the work already in flight
/// and to the operator's own session, and the endpoint's number is a snapshot
/// that can be a minute stale. Stopping AT the limit is the same as not
/// stopping.
pub const DEFAULT_STOP_PCT: f64 = 97.0;

/// Clamp for a hand-set value. Below 50 the loop would idle most of the time
/// on a healthy account; above 99.5 there is no margin left to act in.
const MIN_STOP_PCT: f64 = 50.0;
const MAX_STOP_PCT: f64 = 99.5;

/// How long a burn-rate sample stays useful. A rolling window's utilisation
/// falls as old usage ages out, so a projection built from half-hour-old
/// samples describes a slope that is no longer running.
const SAMPLE_TTL_SECS: u64 = 45 * 60;

/// The fewest seconds a pair of samples must span before their slope is worth
/// projecting from. Two readings a minute apart on a gauge that reports whole
/// percents produce a slope dominated by rounding.
const MIN_SPAN_SECS: u64 = 5 * 60;

/// What the governor decided this tick.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct UsageVerdict {
    /// True when the loop must not dispatch.
    pub blocked: bool,
    /// The window that is closest to the ceiling, whether or not it blocks.
    pub worst_key: Option<String>,
    pub worst_pct: f64,
    /// Minutes until the worst window resets, when the endpoint stated one.
    pub resets_in_minutes: Option<i64>,
    /// **The expectation.** Minutes until the worst window is projected to
    /// reach the stop threshold at the burn rate measured over this session's
    /// recent samples. `None` when there is not enough history, when nothing
    /// is burning, or when the threshold is already reached.
    pub minutes_to_stop: Option<i64>,
    /// Set when the gauge could not be read; the governor fails open and this
    /// says why.
    pub unavailable_reason: Option<String>,
}

impl UsageVerdict {
    /// One line for the tick summary and the ledger.
    pub fn summary(&self, stop_pct: f64) -> String {
        if let Some(reason) = &self.unavailable_reason {
            return format!("usage gauge unreadable ({reason}) — not blocking on an unread gauge");
        }
        let key = self.worst_key.as_deref().unwrap_or("unknown");
        let mut s = format!("{key} at {:.0}% of {stop_pct:.0}% stop", self.worst_pct);
        if let Some(m) = self.resets_in_minutes {
            s.push_str(&format!(", resets in {m}m"));
        }
        match (self.blocked, self.minutes_to_stop) {
            (true, _) => s.push_str(" — DISPATCH STOPPED"),
            (false, Some(m)) => s.push_str(&format!(", ~{m}m of dispatch left at this rate")),
            (false, None) => {}
        }
        s
    }
}

/// The stop threshold, read from settings and clamped.
pub(crate) fn stop_pct(pool: &DbPool) -> f64 {
    settings::get(pool, SETTING_STOP_PCT)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(MIN_STOP_PCT, MAX_STOP_PCT))
        .unwrap_or(DEFAULT_STOP_PCT)
}

/// The fleet-worker margin, read from settings and clamped.
pub(crate) fn fleet_start_margin_pct(pool: &DbPool) -> f64 {
    settings::get(pool, SETTING_FLEET_START_MARGIN_PCT)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(MIN_FLEET_START_MARGIN_PCT, MAX_FLEET_START_MARGIN_PCT))
        .unwrap_or(DEFAULT_FLEET_START_MARGIN_PCT)
}

/// One utilisation reading of one window.
#[derive(Debug, Clone, Copy)]
struct Sample {
    at: Instant,
    pct: f64,
}

type History = Vec<(String, Vec<Sample>)>;

fn history() -> &'static Mutex<History> {
    static H: OnceLock<Mutex<History>> = OnceLock::new();
    H.get_or_init(|| Mutex::new(Vec::new()))
}

/// Record a reading and return the minutes until this window reaches
/// `stop_pct` at the rate measured across the retained samples.
///
/// The slope is taken from the OLDEST retained sample to the newest rather
/// than from the last pair, because the endpoint reports whole percents: two
/// adjacent readings differ by 0 or 1 and their slope is rounding noise, while
/// a span of many minutes averages it out. A window whose utilisation is flat
/// or falling — the normal state of a rolling window between bursts — projects
/// `None`, which reads as "not on course to stop" rather than as "never".
fn project(key: &str, pct: f64, stop_pct: f64, now: Instant) -> Option<i64> {
    let mut guard = history().lock().unwrap_or_else(|e| e.into_inner());
    let entry = match guard.iter_mut().find(|(k, _)| k == key) {
        Some(e) => e,
        None => {
            guard.push((key.to_string(), Vec::new()));
            guard.last_mut()?
        }
    };
    let samples = &mut entry.1;
    samples.retain(|s| now.duration_since(s.at).as_secs() <= SAMPLE_TTL_SECS);
    samples.push(Sample { at: now, pct });

    let first = *samples.first()?;
    let span = now.duration_since(first.at).as_secs();
    if span < MIN_SPAN_SECS {
        return None;
    }
    let climbed = pct - first.pct;
    if climbed <= 0.0 {
        return None; // flat or draining — a rolling window between bursts
    }
    let remaining = stop_pct - pct;
    if remaining <= 0.0 {
        return None; // already there; `blocked` says so
    }
    let pct_per_min = climbed / (span as f64 / 60.0);
    if pct_per_min <= 0.0 {
        return None;
    }
    Some((remaining / pct_per_min).ceil() as i64)
}

/// Read the live gauge and decide whether the loop may dispatch this tick.
pub(crate) async fn verdict(pool: &DbPool) -> UsageVerdict {
    let stop = stop_pct(pool);
    let snap = cached_snapshot().await;
    verdict_from(&snap, stop, Instant::now())
}

/// Read the live gauge and decide whether a headless FLEET WORKER may be
/// started now (G42). Same gauge, same worst-window rule, a stricter line:
/// `stop - margin`. Returns the verdict and the effective line so the
/// refusal can name both numbers.
pub(crate) async fn fleet_worker_verdict(pool: &DbPool) -> (UsageVerdict, f64) {
    let line = stop_pct(pool) - fleet_start_margin_pct(pool);
    let snap = cached_snapshot().await;
    (verdict_from(&snap, line, Instant::now()), line)
}

/// The pure half, so the thresholds and the projection are testable without a
/// network or a database.
fn verdict_from(snap: &ClaudeUsageSnapshot, stop_pct: f64, now: Instant) -> UsageVerdict {
    if !snap.available || snap.windows.is_empty() {
        return UsageVerdict {
            unavailable_reason: Some(snap.reason.clone().unwrap_or_else(|| "no windows".into())),
            ..Default::default()
        };
    }

    // The worst window governs: a 7-day window at 98 % stops the loop even
    // when the 5-hour one is empty, because the week is what runs out next.
    let worst = snap
        .windows
        .iter()
        .max_by(|a, b| {
            a.utilization_pct
                .partial_cmp(&b.utilization_pct)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .expect("windows is non-empty above");

    // Every window is sampled, not only the worst: the 5-hour window is the
    // one a burst moves, and it is often not the highest when the burst
    // starts. Projecting only the leader would miss the window that is
    // actually about to stop the loop.
    let mut soonest: Option<i64> = None;
    for w in &snap.windows {
        if let Some(m) = project(&w.key, w.utilization_pct, stop_pct, now) {
            soonest = Some(soonest.map_or(m, |cur: i64| cur.min(m)));
        }
    }

    let resets_in_minutes = worst.resets_at_ms.map(|ms| {
        let now_ms = chrono::Utc::now().timestamp_millis();
        ((ms - now_ms) / 60_000).max(0)
    });

    UsageVerdict {
        blocked: worst.utilization_pct >= stop_pct,
        worst_key: Some(worst.key.clone()),
        worst_pct: worst.utilization_pct,
        resets_in_minutes,
        minutes_to_stop: soonest,
        unavailable_reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fleet::claude_usage::ClaudeUsageWindow;
    use std::time::Duration;

    fn snap(windows: Vec<(&str, f64, Option<i64>)>) -> ClaudeUsageSnapshot {
        ClaudeUsageSnapshot {
            available: true,
            reason: None,
            subscription_type: Some("max".into()),
            rate_limit_tier: Some("default_claude_max_20x".into()),
            windows: windows
                .into_iter()
                .map(|(k, p, r)| ClaudeUsageWindow {
                    key: k.into(),
                    utilization_pct: p,
                    resets_at_ms: r,
                    window_ms: 18_000_000,
                })
                .collect(),
            fetched_at_ms: 0,
        }
    }

    /// A key nobody else uses, so the process-global history cannot be
    /// polluted by a sibling test running in the same binary.
    fn unique(prefix: &str) -> String {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        format!("{prefix}_{}", N.fetch_add(1, Ordering::Relaxed))
    }

    #[test]
    fn the_worst_window_governs_even_when_the_other_is_empty() {
        let now = Instant::now();
        let v = verdict_from(
            &snap(vec![("five_hour", 2.0, None), ("seven_day", 98.0, None)]),
            97.0,
            now,
        );
        assert!(v.blocked, "the week is what runs out next");
        assert_eq!(v.worst_key.as_deref(), Some("seven_day"));
        assert_eq!(v.worst_pct, 98.0);
    }

    #[test]
    fn below_the_threshold_the_loop_runs() {
        let now = Instant::now();
        let v = verdict_from(
            &snap(vec![("five_hour", 57.0, None), ("seven_day", 83.0, None)]),
            97.0,
            now,
        );
        assert!(!v.blocked, "83 % is not 97 %");
        assert_eq!(v.worst_pct, 83.0);
        assert!(v.summary(97.0).contains("seven_day at 83%"));
    }

    /// The measured shape of 2026-09-09: exactly at the stop, which must
    /// block. Stopping only ABOVE the threshold means the threshold is never
    /// the stop.
    #[test]
    fn exactly_at_the_threshold_blocks() {
        let now = Instant::now();
        let v = verdict_from(&snap(vec![("five_hour", 97.0, None)]), 97.0, now);
        assert!(v.blocked);
        assert!(v.summary(97.0).contains("DISPATCH STOPPED"));
    }

    /// An unreadable gauge must not freeze the organisation — the governor
    /// exists to avoid a wall, and inventing one would be worse.
    #[test]
    fn an_unreadable_gauge_fails_open() {
        let mut s = snap(vec![]);
        s.available = false;
        s.reason = Some("no_credentials".into());
        let v = verdict_from(&s, 97.0, Instant::now());
        assert!(
            !v.blocked,
            "a gauge that cannot be read is not an empty tank"
        );
        assert_eq!(v.unavailable_reason.as_deref(), Some("no_credentials"));
        assert!(v.summary(97.0).contains("not blocking on an unread gauge"));
    }

    /// An available snapshot carrying no windows is the same state as an
    /// unavailable one, and must not read as "0 %, all clear".
    #[test]
    fn an_empty_window_list_is_unavailable_not_idle() {
        let v = verdict_from(&snap(vec![]), 97.0, Instant::now());
        assert!(!v.blocked);
        assert_eq!(v.unavailable_reason.as_deref(), Some("no windows"));
    }

    #[test]
    fn the_projection_needs_a_span_before_it_speaks() {
        let key = unique("span");
        let t0 = Instant::now();
        assert_eq!(
            project(&key, 10.0, 97.0, t0),
            None,
            "one sample is not a slope"
        );
        // Inside the minimum span, still silent.
        assert_eq!(
            project(&key, 20.0, 97.0, t0 + Duration::from_secs(60)),
            None
        );
    }

    /// The expectation the operator asked for: at a measured burn rate, how
    /// long until the loop stops itself.
    #[test]
    fn the_projection_reports_minutes_at_the_measured_burn_rate() {
        let key = unique("burn");
        let t0 = Instant::now();
        assert_eq!(project(&key, 50.0, 97.0, t0), None);
        // +20 points over 10 minutes = 2 %/min; 27 points remain to 97 %.
        let m = project(&key, 70.0, 97.0, t0 + Duration::from_secs(600))
            .expect("a rising window projects");
        assert_eq!(m, 14, "27 points at 2 %/min, rounded up");
    }

    /// A rolling window between bursts drains. That is not "stopping in
    /// negative minutes" — it is not on course to stop at all.
    #[test]
    fn a_draining_window_projects_nothing() {
        let key = unique("drain");
        let t0 = Instant::now();
        project(&key, 80.0, 97.0, t0);
        assert_eq!(
            project(&key, 60.0, 97.0, t0 + Duration::from_secs(600)),
            None
        );
    }

    /// Once the threshold is reached the projection is silent and `blocked`
    /// carries the fact — two fields must not both claim to be the answer.
    #[test]
    fn past_the_threshold_the_projection_is_silent() {
        let key = unique("past");
        let t0 = Instant::now();
        project(&key, 90.0, 97.0, t0);
        assert_eq!(
            project(&key, 98.0, 97.0, t0 + Duration::from_secs(600)),
            None
        );
    }

    #[test]
    fn the_soonest_window_wins_the_projection() {
        // Two windows climbing at different rates: the report is the sooner.
        let fast = unique("fast");
        let slow = unique("slow");
        let t0 = Instant::now();
        project(&fast, 50.0, 97.0, t0);
        project(&slow, 50.0, 97.0, t0);
        let f = project(&fast, 90.0, 97.0, t0 + Duration::from_secs(600)).unwrap();
        let s = project(&slow, 60.0, 97.0, t0 + Duration::from_secs(600)).unwrap();
        assert!(f < s, "the faster window stops the loop first ({f} vs {s})");
    }
}
