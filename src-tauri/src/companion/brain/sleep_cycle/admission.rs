//! Should a cycle run at all — the gauge, the verdict, and the one-at-a-time
//! guard. `measure` reads the window once; `verdict` turns that reading into
//! admit-or-skip; `admit` / `trigger` are the two entry points that act on it.
//!
//! Moved verbatim out of the former single-file `sleep_cycle.rs`.

use std::sync::atomic::{AtomicBool, Ordering};

use chrono::{Duration as ChronoDuration, Utc};
use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use super::limits::{
    EPISODE_FETCH_LIMIT, FIRST_CYCLE_LOOKBACK_DAYS, MIN_INTERVAL_HOURS, MIN_STALENESS_CHARS,
    PRESSURE_THRESHOLD_CHARS, STALENESS_HOURS,
};
use super::parse::parse_ts;
use super::pressure::thousands;
use crate::companion::brain::{cycle_report, episodic};
use crate::db::UserDbPool;
use crate::error::AppError;

// ── Outcomes ───────────────────────────────────────────────────────────────

/// What a call to [`run_sleep_cycle`] did.
///
/// Skipping is an outcome, not an error: the scheduler calls this on every tick
/// and "not yet" is the correct answer almost every time. Returning `Err` for it
/// would make a normal tick log a warning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CycleOutcome {
    /// A cycle ran to its end. `status` is `completed` or `failed` — a failed
    /// cycle still *ran*, and its report still exists.
    Ran { cycle_id: String, status: String },
    /// Nothing ran, and why.
    Skipped { reason: String },
}

/// What the manual trigger command answers.
///
/// A tagged shape rather than a string so the caller can branch on `status`
/// instead of pattern-matching prose: the UI needs "did a cycle start, and
/// which one" as data.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SleepCycleTrigger {
    /// `started` | `skipped`.
    pub status: String,
    /// The new cycle's id — present exactly when `status == "started"`.
    pub cycle_id: Option<String>,
    /// Why nothing started — present exactly when `status == "skipped"`.
    pub skipped_reason: Option<String>,
}

impl SleepCycleTrigger {
    pub fn started(cycle_id: String) -> Self {
        Self {
            status: "started".into(),
            cycle_id: Some(cycle_id),
            skipped_reason: None,
        }
    }
    pub fn skipped(reason: String) -> Self {
        Self {
            status: "skipped".into(),
            cycle_id: None,
            skipped_reason: Some(reason),
        }
    }
}

// ── Single-flight admission ────────────────────────────────────────────────

/// True while a cycle is running in THIS process.
pub(super) static CYCLE_RUNNING: AtomicBool = AtomicBool::new(false);

/// RAII half of the in-process single-flight lock. Releasing on drop is what
/// makes a panicking or early-returning cycle unable to wedge every future one.
#[derive(Debug)]
struct CycleGuard;

impl CycleGuard {
    fn acquire() -> Option<Self> {
        CYCLE_RUNNING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| CycleGuard)
    }
}

impl Drop for CycleGuard {
    fn drop(&mut self) {
        CYCLE_RUNNING.store(false, Ordering::Release);
    }
}

/// An admitted cycle: the single-flight lock, the row that has already been
/// opened, and **the episodes this pass is responsible for**.
///
/// It exists so the manual trigger can answer with a real cycle id *before* the
/// work starts — admission is synchronous, the phases are not. Carrying the
/// guard inside means the lock is held from admission to the end of the spawned
/// task, with no window where a second caller could slip in.
///
/// It carries the episodes rather than the boundary because admission already
/// read them to weigh the pressure. Re-querying in compress would mean two
/// reads that are *supposed* to agree — and a boundary that drifts between the
/// gauge and the work is precisely the bug class this module keeps finding.
#[derive(Debug)]
pub struct AdmittedCycle {
    _guard: CycleGuard,
    pub(super) cycle_id: String,
    /// The exclusive `created_at` boundary this window was measured from.
    pub(super) boundary: String,
    /// The window, oldest-first, already hydrated. Fetch-capped; `available`
    /// is the honest denominator.
    pub(super) episodes: Vec<episodic::Episode>,
    /// TRUE count of conversation episodes past the boundary.
    pub(super) available: usize,
}

impl AdmittedCycle {
    pub fn cycle_id(&self) -> &str {
        &self.cycle_id
    }
}

/// The answer to "may a cycle start right now".
#[derive(Debug)]
pub enum CycleAdmission {
    Admitted(AdmittedCycle),
    Skipped(String),
}

/// The state of the sleep-pressure gauge at one instant — everything both the
/// admission decision and the UI readout are derived from, computed once.
///
/// Not `Serialize`: [`SleepPressure`] is the wire shape. This is the internal
/// reading, and it owns the episodes so an admitted cycle can take them.
pub(super) struct Reading {
    /// Exclusive RFC3339 `created_at` boundary this window starts after.
    pub(super) boundary: String,
    pub(super) episodes: Vec<episodic::Episode>,
    /// TRUE count past the boundary (a COUNT, not the fetch length).
    pub(super) available: usize,
    /// Sum of body chars over the fetched window.
    pub(super) pressure_chars: usize,
    pub(super) last: Option<cycle_report::LastCompleted>,
    /// Whole hours since the last completed cycle finished; `None` when no
    /// cycle has ever completed or its timestamp is unparseable.
    pub(super) hours_since: Option<i64>,
    /// `false` only when a completed cycle finished inside [`MIN_INTERVAL_HOURS`].
    pub(super) floor_satisfied: bool,
}

/// What the pressure gauge says about admitting right now.
pub(super) enum Verdict {
    Admit(String),
    Skip(String),
}

impl Verdict {
    pub(super) fn reason(&self) -> &str {
        match self {
            Verdict::Admit(r) | Verdict::Skip(r) => r,
        }
    }
    pub(super) fn is_admit(&self) -> bool {
        matches!(self, Verdict::Admit(_))
    }
}

/// Resolve where this cycle's window starts: the last completed cycle's
/// `consumed_through`, else its `started_at`, else a week back.
///
/// **The single boundary function.** Pressure and the compress window both come
/// from here, through one call in [`measure`], so they cannot disagree.
///
/// The three tiers are a migration path, not a preference. `consumed_through`
/// is the truthful answer — the newest episode the previous cycle actually fed
/// to compress — and it is what makes a truncated window drain forward instead
/// of orphaning its residue. Cycles written before L1c have no such key, so
/// they fall back to `started_at` (the L1b behaviour: re-read anything that
/// arrived while that cycle was thinking rather than skipping it). With no
/// completed cycle at all, a week is the same slice `consolidation`'s
/// 80-episode window approximates, and it bounds the one cycle that would
/// otherwise face the whole archive.
pub(super) fn boundary_for(last: Option<&cycle_report::LastCompleted>) -> String {
    match last {
        Some(l) => consumed_through_of(&l.stats_json).unwrap_or_else(|| l.started_at.clone()),
        None => (Utc::now() - ChronoDuration::days(FIRST_CYCLE_LOOKBACK_DAYS)).to_rfc3339(),
    }
}

/// `consumed_through` out of a cycle's `stats_json`, if it carries one.
fn consumed_through_of(stats_json: &str) -> Option<String> {
    serde_json::from_str::<Value>(stats_json)
        .ok()?
        .get("consumed_through")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Read the gauge: resolve the boundary, fetch the window past it once, and sum
/// its conversation volume.
///
/// **Pressure is summed over hydrated episode BODIES, deliberately, and not out
/// of SQL.** The obvious cheap implementation — `SUM(LENGTH(body_excerpt))` on
/// `companion_node` — is wrong by roughly a factor of two: `body_excerpt` is
/// capped at `retrieval::EPISODE_EXCERPT_CAP` (500 chars), and measured against
/// the same 790-message export that [`PRESSURE_THRESHOLD_CHARS`] was calibrated
/// on, a 500-cap captures **45%** of real conversation volume — with the ratio
/// swinging 0.42–0.90 day to day, so it is not even a stable scale factor. A
/// gauge on that column would silently redefine the threshold to ~90,000 real
/// chars and would drift against the operator's own measured baseline. The
/// hydrated read costs a file read per episode whose body outgrew the excerpt;
/// that is the price of the number meaning what it says.
///
/// Costs one indexed COUNT plus one bounded window fetch. Cheap enough for the
/// manual trigger and a UI hover; the night-shift tick fires every 30s and
/// throttles itself before calling in (see `night_shift::maybe_run_sleep_cycle`).
// `Option::is_none_or` is stable since 1.82.0 and the manifests declare
// `rust-version = "1.80.0"`. Nothing in this workspace actually requires
// 1.80 — all five crates are `publish = false` and CI pins no toolchain — so
// the honest fix is to correct the manifest, which is a policy call for the
// Director rather than this lane's to make. Allowed here, narrowly, until
// that decision lands. See the W0 clippy lane report.
#[allow(clippy::incompatible_msrv)]
pub(super) fn measure(pool: &UserDbPool) -> Result<Reading, AppError> {
    let last = cycle_report::last_completed(pool)?;

    let hours_since = last.as_ref().and_then(|l| match parse_ts(&l.finished_at) {
        Some(fin) => Some(Utc::now().signed_duration_since(fin).num_hours().max(0)),
        // An unparseable timestamp must not wedge cycles forever. Treat the
        // floor as satisfied and say so — a noisy log beats a memory that
        // silently stops reconciling because one row is malformed.
        None => {
            tracing::warn!(
                finished_at = %l.finished_at,
                "sleep_cycle: unparseable finished_at on the last completed cycle; \
                 treating the interval floor as satisfied"
            );
            None
        }
    });
    let floor_satisfied = hours_since.is_none_or(|h| h >= MIN_INTERVAL_HOURS);

    let boundary = boundary_for(last.as_ref());
    let available = episodic::count_conversation_after(pool, &boundary)?;
    let episodes = episodic::list_conversation_after(pool, &boundary, EPISODE_FETCH_LIMIT)?;
    let pressure_chars = episodes.iter().map(|e| e.content.chars().count()).sum();

    Ok(Reading {
        boundary,
        episodes,
        available,
        pressure_chars,
        last,
        hours_since,
        floor_satisfied,
    })
}

/// The admission decision, stated in numbers the operator can act on.
///
/// Every branch names the figures it decided on, because this string is what a
/// toast shows him when he presses the button and nothing happens. "Not due yet"
/// is an answer that teaches nobody anything.
pub(super) fn verdict(r: &Reading, force: bool) -> Verdict {
    let waiting = format!(
        "{} of {} chars",
        thousands(r.pressure_chars),
        thousands(PRESSURE_THRESHOLD_CHARS)
    );

    if force {
        return Verdict::Admit(format!(
            "forced: running regardless of pressure ({waiting}) and the {MIN_INTERVAL_HOURS}h floor"
        ));
    }

    if !r.floor_satisfied {
        let h = r.hours_since.unwrap_or(0);
        return Verdict::Skip(format!(
            "the last cycle completed {h}h ago and the {MIN_INTERVAL_HOURS}h floor has not \
             elapsed; pressure {waiting}"
        ));
    }

    // Nothing to compress. Checked before both release paths — a staleness that
    // fired on an empty window would spend a real LLM call to distil nothing.
    if r.pressure_chars < MIN_STALENESS_CHARS {
        return Verdict::Skip(format!(
            "only {} chars of new conversation are waiting, under the {} minimum; there is \
             nothing worth compressing",
            thousands(r.pressure_chars),
            thousands(MIN_STALENESS_CHARS)
        ));
    }

    if r.pressure_chars >= PRESSURE_THRESHOLD_CHARS {
        return Verdict::Admit(format!(
            "sleep pressure reached: {waiting} across {} episodes",
            r.available
        ));
    }

    // Staleness. `None` means no cycle has EVER completed, which is at least as
    // overdue as 72h — the first cycle on a new brain should not have to wait
    // for a heavy day before the heartbeat proves it beats.
    match r.hours_since {
        None => Verdict::Admit(format!(
            "no cycle has ever completed and {} chars are waiting; running under threshold \
             ({waiting})",
            thousands(r.pressure_chars)
        )),
        Some(h) if h >= STALENESS_HOURS => Verdict::Admit(format!(
            "{h}h since the last cycle (staleness fires at {STALENESS_HOURS}h) with {} chars \
             waiting; running under threshold ({waiting})",
            thousands(r.pressure_chars)
        )),
        Some(h) => Verdict::Skip(format!(
            "pressure {waiting}; the {MIN_INTERVAL_HOURS}h floor is satisfied ({h}h since the \
             last cycle) and staleness fires at {STALENESS_HOURS}h"
        )),
    }
}

/// Take the single-flight lock, weigh the sleep pressure, and open a cycle row.
///
/// Synchronous — safe to call from a scheduler tick, though that caller
/// throttles itself because the measurement is a window fetch rather than a
/// single row. On `Skipped` the lock is already released (the guard drops on the
/// early return), so a skip costs nothing and blocks nothing.
///
/// `force` bypasses pressure, the floor and staleness. It does **not** bypass
/// the single-flight guard, and cannot: the guard is taken first, and a `force`
/// that could run a second cycle concurrently would have two passes writing
/// facts from overlapping windows.
pub fn admit(pool: &UserDbPool, force: bool) -> Result<CycleAdmission, AppError> {
    let Some(guard) = CycleGuard::acquire() else {
        return Ok(CycleAdmission::Skipped(
            "a sleep cycle is already running in this process".into(),
        ));
    };

    let reading = measure(pool)?;
    let verdict = verdict(&reading, force);
    if !verdict.is_admit() {
        return Ok(CycleAdmission::Skipped(verdict.reason().to_string()));
    }

    let cycle_id = cycle_report::begin_cycle(pool)?;
    tracing::info!(
        cycle_id = %cycle_id,
        pressure_chars = reading.pressure_chars,
        episodes = reading.available,
        reason = verdict.reason(),
        "sleep_cycle: admitted"
    );
    Ok(CycleAdmission::Admitted(AdmittedCycle {
        _guard: guard,
        cycle_id,
        boundary: reading.boundary,
        episodes: reading.episodes,
        available: reading.available,
    }))
}

/// Decide whether a cycle starts and describe the verdict, handing the
/// admission back for the caller to run in the background.
///
/// Split this way because a fire-and-forget trigger has to answer *before* the
/// work begins: the verdict is computed on the caller's thread — including the
/// real cycle id, which already exists by then — and the caller owns the spawn.
/// It also makes the decision testable without a runtime.
pub fn trigger(
    pool: &UserDbPool,
    force: bool,
) -> Result<(SleepCycleTrigger, Option<AdmittedCycle>), AppError> {
    Ok(match admit(pool, force)? {
        CycleAdmission::Skipped(reason) => (SleepCycleTrigger::skipped(reason), None),
        CycleAdmission::Admitted(a) => (
            SleepCycleTrigger::started(a.cycle_id().to_string()),
            Some(a),
        ),
    })
}
