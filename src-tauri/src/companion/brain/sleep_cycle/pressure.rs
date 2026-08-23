//! The gauge as a wire shape — what the UI reads when it asks how full she
//! is. Derived from the same [`super::admission::measure`] + `verdict` pair the
//! admission decision uses, never a parallel calculation.
//!
//! Moved verbatim out of the former single-file `sleep_cycle.rs`.

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use super::admission::{measure, verdict};
use super::limits::{
    MIN_INTERVAL_HOURS, MIN_STALENESS_CHARS, PRESSURE_THRESHOLD_CHARS, STALENESS_HOURS,
};
use crate::db::UserDbPool;
use crate::error::AppError;

// ── The gauge, as a wire shape ─────────────────────────────────────────────

/// What the last completed cycle was, for the gauge.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SleepPressureLastCycle {
    pub id: String,
    pub finished_at: String,
    /// Whole hours since it finished. `null` when its timestamp is unparseable.
    pub hours_ago: Option<i32>,
    /// True when a cap left episodes of that cycle's window unread — the
    /// residue this cycle's boundary is now positioned to drain.
    pub truncated: bool,
}

/// How overdue a cycle is on the clock, when there is a clock to measure from.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SleepPressureStaleness {
    pub hours_since: i32,
    pub fires_at_hours: i32,
}

/// The sleep-pressure gauge — what `companion_get_sleep_pressure` answers.
///
/// Deliberately the SAME computation the admission runs, not a parallel
/// estimate: [`sleep_pressure`] calls [`measure`] and [`verdict`], so
/// `would_admit` is a prediction only in the sense that time may pass before
/// the next call. A read-only gauge that could disagree with the gate it
/// describes would be worse than no gauge.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SleepPressure {
    /// New conversation chars accumulated since `boundary`.
    pub pressure_chars: usize,
    pub threshold_chars: usize,
    /// Conversation episodes past `boundary` (a true COUNT).
    pub episodes_waiting: usize,
    /// The exclusive `created_at` boundary the measurement starts after.
    pub boundary: String,
    pub floor_satisfied: bool,
    pub floor_hours: i32,
    pub min_chars: usize,
    pub staleness: Option<SleepPressureStaleness>,
    pub last_cycle: Option<SleepPressureLastCycle>,
    pub would_admit: bool,
    /// The verdict in the operator's words — the same string a skip toast shows.
    pub would_admit_reason: String,
}

/// Read the gauge without touching anything.
///
/// Never takes the single-flight lock, so asking cannot block or perturb a
/// cycle. `would_admit` therefore excludes the "already running" case by
/// construction — that one is only knowable at the moment of admission, and the
/// trigger reports it honestly when it happens.
pub fn sleep_pressure(pool: &UserDbPool) -> Result<SleepPressure, AppError> {
    let r = measure(pool)?;
    let v = verdict(&r, false);
    Ok(SleepPressure {
        pressure_chars: r.pressure_chars,
        threshold_chars: PRESSURE_THRESHOLD_CHARS,
        episodes_waiting: r.available,
        boundary: r.boundary.clone(),
        floor_satisfied: r.floor_satisfied,
        // Hours are `i32` on the wire, not `i64`: ts-rs renders `i64` as
        // TypeScript `bigint`, but Tauri's JSON transport delivers a plain
        // `number` — a type that lies about its own runtime value is worse than
        // a narrower one, and 2 billion hours is 245,000 years.
        floor_hours: MIN_INTERVAL_HOURS as i32,
        min_chars: MIN_STALENESS_CHARS,
        staleness: r.hours_since.map(|hours_since| SleepPressureStaleness {
            hours_since: hours_since as i32,
            fires_at_hours: STALENESS_HOURS as i32,
        }),
        last_cycle: r.last.as_ref().map(|l| SleepPressureLastCycle {
            id: l.id.clone(),
            finished_at: l.finished_at.clone(),
            hours_ago: r.hours_since.map(|h| h as i32),
            truncated: serde_json::from_str::<Value>(&l.stats_json)
                .ok()
                .and_then(|v| v.get("truncated").and_then(|t| t.as_bool()))
                .unwrap_or(false),
        }),
        would_admit: v.is_admit(),
        would_admit_reason: v.reason().to_string(),
    })
}

/// `42310` → `42,310`. The gauge's numbers are read by a human in a toast, and
/// six unseparated digits are the difference between a figure and a smear.
pub(super) fn thousands(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}
