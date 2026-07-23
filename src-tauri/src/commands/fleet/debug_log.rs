//! Fleet debug recorder — a DEV-only, operator-armed high-level session log.
//!
//! ## Why this exists
//!
//! Debugging a running fleet is hard for a specific reason: the interesting
//! decisions are made in places the operator cannot see. A session's state is
//! decided by four independent signal sources (hooks, the PTY reader, the
//! transcript watcher, the staleness ticker); hibernations are decided by a
//! background ticker that runs whether or not the UI is open; and Athena's
//! orchestration reasons about a screen the operator never sees, on a path
//! that is deliberately silent in the chat. By the time something looks wrong
//! on the grid, the *why* has already scrolled past.
//!
//! So this records the causal spine — one line per meaningful thing that
//! happened, with the reason attached — to a file the operator can hand over
//! afterwards. It is not a trace: PTY bytes, per-tool hooks and transcript
//! deltas are deliberately absent. The target is "readable end-to-end after a
//! 30-minute four-terminal run", not completeness.
//!
//! ## What it deliberately does NOT record
//!
//! - **Terminal contents.** Athena's wake line notes the *size* of the screen
//!   she read, never the screen itself. Those frames carry the user's code,
//!   prompts and paths, and this file is meant to be shareable.
//! - **Anything at all while disarmed.** [`is_armed`] is a relaxed atomic load,
//!   so every call site costs one non-atomic-ish read when the recorder is off,
//!   which it is by default and in every non-DEV build.
//!
//! ## Concurrency contract (important)
//!
//! [`record`] is called from inside the fleet's hot paths, and some callers
//! hold the registry lock. `std::sync::Mutex` is not reentrant, so resolving a
//! session's label **must not block**: `session_label` uses the registry's
//! `try_lookup_label` and degrades to the short id rather than risk a deadlock
//! in a debugging tool. Same rule for any future field this file resolves.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use super::registry::{now_ms, registry};

/// Fast disarmed check. Read on every fleet state transition, so it stays a
/// plain relaxed load — correctness here is "eventually stops logging after
/// stop()", not strict ordering.
static ARMED: AtomicBool = AtomicBool::new(false);

static RECORDER: OnceLock<Mutex<Option<Recorder>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<Recorder>> {
    RECORDER.get_or_init(|| Mutex::new(None))
}

/// Event classes, rendered as the log's second column. Kept short and
/// fixed-width so the file scans vertically.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Session lifecycle: spawned / killed / exited.
    Life,
    /// A lifecycle state transition (the `FLEET_SESSION_STATE` spine).
    State,
    /// A session was put to sleep, or woken back up.
    Sleep,
    /// Athena woke on a session, decided, deferred, or acted.
    Athena,
}

impl Kind {
    fn label(self) -> &'static str {
        match self {
            Kind::Life => "LIFE",
            Kind::State => "STATE",
            Kind::Sleep => "SLEEP",
            Kind::Athena => "ATHENA",
        }
    }
}

struct Recorder {
    file: BufWriter<File>,
    path: PathBuf,
    started_ms: i64,
    events: u32,
}

/// Recorder state as the Grid button renders it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetDebugLogStatus {
    /// True while events are being written.
    pub active: bool,
    /// Absolute path of the current (or most recently finished) log file.
    pub path: Option<String>,
    /// Events written so far in this recording.
    pub events: u32,
    /// Epoch ms the recording started; `None` when it never has.
    pub started_at_ms: Option<i64>,
}

/// Cheap "should I bother?" check for call sites in hot paths.
#[inline]
pub fn is_armed() -> bool {
    ARMED.load(Ordering::Relaxed)
}

/// Where recordings land: `<app-data>/fleet-debug/`. Outside the repo on
/// purpose — a debug log is machine state, not source.
fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("fleet-debug");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// `2026-07-23_14-05-31` — sortable, filename-safe, no external date crate.
fn stamp_for_filename(ms: i64) -> String {
    let (y, mo, d, h, mi, s) = civil_from_ms(ms);
    format!("{y:04}-{mo:02}-{d:02}_{h:02}-{mi:02}-{s:02}")
}

/// `2026-07-23 14:05:31` — the human-facing form in the banners.
fn stamp_human(ms: i64) -> String {
    let (y, mo, d, h, mi, s) = civil_from_ms(ms);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}")
}

/// Epoch-ms → local-ish civil time. Uses UTC (no tz database dependency); the
/// log's primary axis is the *elapsed* column anyway, and both banners state
/// UTC explicitly so nobody misreads a wall-clock comparison.
fn civil_from_ms(ms: i64) -> (i64, u32, u32, u32, u32, u32) {
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (
        y,
        m,
        d,
        (tod / 3600) as u32,
        ((tod % 3600) / 60) as u32,
        (tod % 60) as u32,
    )
}

/// `HH:MM:SS.mmm` since the recording started — the log's primary time axis.
fn elapsed(started_ms: i64, now: i64) -> String {
    let delta = (now - started_ms).max(0);
    let ms = delta % 1000;
    let total_s = delta / 1000;
    format!(
        "{:02}:{:02}:{:02}.{:03}",
        total_s / 3600,
        (total_s % 3600) / 60,
        total_s % 60,
        ms
    )
}

/// `pof·a1b2c3` — project label + short id, so a line identifies a session
/// without a 36-char UUID. Never blocks (see the module's concurrency note).
fn session_label(session_id: &str) -> String {
    let short: String = session_id.chars().take(6).collect();
    match registry().try_lookup_label(session_id) {
        Some(label) if !label.is_empty() => format!("{label}·{short}"),
        _ => short,
    }
}

/// Arm the recorder and open a fresh file. Re-arming while active is a no-op
/// that returns the running recording, so a double-click can't split a run
/// across two files.
pub fn start(app: &AppHandle) -> Result<FleetDebugLogStatus, String> {
    let mut guard = slot().lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        drop(guard);
        return Ok(status());
    }

    let now = now_ms();
    let path = log_dir(app)?.join(format!("fleet-{}.log", stamp_for_filename(now)));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;

    let mut rec = Recorder {
        file: BufWriter::new(file),
        path: path.clone(),
        started_ms: now,
        events: 0,
    };
    write_banner(&mut rec, now);
    *guard = Some(rec);
    drop(guard);

    ARMED.store(true, Ordering::Relaxed);
    tracing::info!(path = %path.display(), "fleet debug log: started");
    Ok(status())
}

/// Disarm, write the summary banner and close the file. Idempotent.
pub fn stop() -> Result<FleetDebugLogStatus, String> {
    ARMED.store(false, Ordering::Relaxed);
    let mut guard = slot().lock().unwrap_or_else(|e| e.into_inner());
    let Some(mut rec) = guard.take() else {
        drop(guard);
        return Ok(status());
    };

    let now = now_ms();
    let _ = writeln!(rec.file, "\n{}", "-".repeat(96));
    let _ = writeln!(
        rec.file,
        "STOPPED  {}  ·  ran {}  ·  {} events",
        stamp_human(now),
        elapsed(rec.started_ms, now),
        rec.events
    );
    let _ = rec.file.flush();

    let finished = FleetDebugLogStatus {
        active: false,
        path: Some(rec.path.to_string_lossy().into_owned()),
        events: rec.events,
        started_at_ms: Some(rec.started_ms),
    };
    // Keep the finished recording visible to `status()` so the UI can still
    // show "here's where it landed" after the operator stops it.
    *guard = None;
    drop(guard);
    let mut last = last_status().lock().unwrap_or_else(|e| e.into_inner());
    *last = Some(finished.clone());
    tracing::info!(events = finished.events, "fleet debug log: stopped");
    Ok(finished)
}

/// Remembers the most recent finished recording so the UI keeps showing its
/// path after `stop()` (the live recorder is dropped at that point).
fn last_status() -> &'static Mutex<Option<FleetDebugLogStatus>> {
    static LAST: OnceLock<Mutex<Option<FleetDebugLogStatus>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(None))
}

pub fn status() -> FleetDebugLogStatus {
    if let Some(rec) = slot().lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        return FleetDebugLogStatus {
            active: true,
            path: Some(rec.path.to_string_lossy().into_owned()),
            events: rec.events,
            started_at_ms: Some(rec.started_ms),
        };
    }
    last_status()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .unwrap_or(FleetDebugLogStatus {
            active: false,
            path: None,
            events: 0,
            started_at_ms: None,
        })
}

fn write_banner(rec: &mut Recorder, now: i64) {
    let sessions = registry().try_session_summaries().unwrap_or_default();
    let _ = writeln!(rec.file, "{}", "=".repeat(96));
    let _ = writeln!(rec.file, "PERSONAS FLEET DEBUG LOG");
    let _ = writeln!(rec.file, "started   {} UTC", stamp_human(now));
    let _ = writeln!(
        rec.file,
        "columns   [elapsed] KIND  session  headline  | detail"
    );
    let _ = writeln!(
        rec.file,
        "note      terminal contents are never recorded; Athena wakes log the screen SIZE only"
    );
    if sessions.is_empty() {
        let _ = writeln!(rec.file, "sessions  (none tracked yet)");
    } else {
        let _ = writeln!(rec.file, "sessions  {} tracked at start:", sessions.len());
        for (id, label, state) in &sessions {
            let short: String = id.chars().take(6).collect();
            let _ = writeln!(rec.file, "            {label}·{short}  {state}");
        }
    }
    let _ = writeln!(rec.file, "{}", "=".repeat(96));
    let _ = rec.file.flush();
}

/// Write one event. Silently no-ops when disarmed — call sites don't branch.
///
/// `detail` is free-form and goes after the `|` separator; `continuation`
/// lines are indented under it (used for Athena's sent text and rationale,
/// which are too long and too quote-heavy for the detail column).
pub fn record(kind: Kind, session_id: Option<&str>, headline: &str, detail: &str) {
    record_with(kind, session_id, headline, detail, &[]);
}

pub fn record_with(
    kind: Kind,
    session_id: Option<&str>,
    headline: &str,
    detail: &str,
    continuation: &[(&str, String)],
) {
    if !is_armed() {
        return;
    }
    let label = session_id.map(session_label).unwrap_or_default();
    let mut guard = slot().lock().unwrap_or_else(|e| e.into_inner());
    let Some(rec) = guard.as_mut() else { return };

    let line = format!(
        "[{}] {:<6}  {:<22} {:<26}{}",
        elapsed(rec.started_ms, now_ms()),
        kind.label(),
        label,
        headline,
        if detail.is_empty() {
            String::new()
        } else {
            format!("| {}", one_line(detail))
        }
    );
    let _ = writeln!(rec.file, "{}", line.trim_end());
    for (tag, value) in continuation {
        let _ = writeln!(rec.file, "{:>13}  {tag}: {}", "", one_line(value));
    }
    rec.events = rec.events.saturating_add(1);
    // Flush per event: the whole point is to survive whatever we're debugging,
    // including a hang or a hard exit. Volume is high-level only, so the cost
    // is irrelevant next to losing the tail of a run.
    let _ = rec.file.flush();
}

/// Collapse a value to one line and cap it — a hook reason or an Athena
/// rationale can arrive with embedded newlines, which would break the columns.
fn one_line(s: &str) -> String {
    const MAX: usize = 300;
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= MAX {
        return flat;
    }
    let head: String = flat.chars().take(MAX).collect();
    format!("{head}…")
}

// ---------------------------------------------------------------------------
// Typed helpers — the call sites read as intent, not formatting.
// ---------------------------------------------------------------------------

/// A lifecycle state transition. `from` is `None` when the previous state
/// wasn't captured by the caller (the transition already landed in the
/// registry by then).
pub fn state_change(session_id: &str, from: Option<&str>, to: &str, reason: &str) {
    if !is_armed() {
        return;
    }
    // Hibernations are the operator's most-asked question ("who slept my
    // session and why?"), so they get their own column value instead of
    // hiding inside the state stream.
    let kind = if to == "hibernated" { Kind::Sleep } else { Kind::State };
    let headline = match from {
        Some(f) if f != to => format!("{f} → {to}"),
        _ => to.to_string(),
    };
    record(kind, Some(session_id), &headline, reason);
}

pub fn lifecycle(session_id: &str, headline: &str, detail: &str) {
    record(Kind::Life, Some(session_id), headline, detail);
}

pub fn sleep_event(session_id: &str, headline: &str, detail: &str) {
    record(Kind::Sleep, Some(session_id), headline, detail);
}

pub fn athena(session_id: &str, headline: &str, detail: &str) {
    record(Kind::Athena, Some(session_id), headline, detail);
}

pub fn athena_with(
    session_id: &str,
    headline: &str,
    detail: &str,
    continuation: &[(&str, String)],
) {
    record_with(Kind::Athena, Some(session_id), headline, detail, continuation);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elapsed_renders_hms_millis() {
        assert_eq!(elapsed(0, 0), "00:00:00.000");
        assert_eq!(elapsed(0, 1_234), "00:00:01.234");
        assert_eq!(elapsed(0, 3_723_456), "01:02:03.456");
        // Clock skew must not produce a negative, column-breaking value.
        assert_eq!(elapsed(5_000, 1_000), "00:00:00.000");
    }

    #[test]
    fn one_line_flattens_and_caps() {
        assert_eq!(one_line("a\n  b\tc "), "a b c");
        let long = "x".repeat(400);
        let out = one_line(&long);
        assert_eq!(out.chars().count(), 301);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn civil_time_matches_known_epochs() {
        assert_eq!(civil_from_ms(0), (1970, 1, 1, 0, 0, 0));
        // 2026-07-23T14:05:31Z
        assert_eq!(civil_from_ms(1_784_988_331_000), (2026, 7, 23, 14, 5, 31));
    }

    #[test]
    fn disarmed_recorder_writes_nothing() {
        // Default state is disarmed, and every helper must be a no-op then —
        // this is what makes the call sites free in production.
        assert!(!is_armed());
        state_change("nope", Some("idle"), "running", "test");
        athena("nope", "wake", "test");
        assert_eq!(status().events, 0);
    }
}
