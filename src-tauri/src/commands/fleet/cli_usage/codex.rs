//! Codex usage, read passively from the CLI's own session logs.
//!
//! codex-cli appends a `token_count` event to the running session's rollout
//! log (`<codex home>/sessions/YYYY/MM/DD/rollout-*.jsonl`) after every model
//! turn, and that event carries the account's `rate_limits` as the server
//! last reported them. The newest such event on disk is therefore the newest
//! thing this machine knows about the plan - no request, no token, no spawn.
//!
//! The log shape is an UNDOCUMENTED INTERNAL of codex-cli (observed on
//! 0.153.x). Everything here reads it defensively: a shape that stops
//! matching degrades to a `reason`, never to an error.
//!
//! HARD RULES this file keeps: it opens `version.json` and
//! `sessions/**/rollout-*.jsonl` and nothing else (never `auth.json`); it
//! never logs file contents or paths; it never returns an `Err`.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::Value;

use super::super::claude_usage::{as_epoch_ms, now_ms};
use super::{CliProvider, CliProviderUsage, CliUsageReader, CliUsageReason, CliUsageWindow};

/// How much of a rollout log's END is read. Logs reach tens of MB; the last
/// `token_count` of a session sits within a few KB of the end.
const TAIL_BYTES: u64 = 256 * 1024;
/// How much of a log's START is read for the `session_meta` line.
const HEAD_BYTES: u64 = 64 * 1024;
/// Newest-first files inspected before giving up.
const MAX_FILES: usize = 20;

/// Reads `~/.codex` (or `$CODEX_HOME`).
pub struct CodexReader {
    home: Option<PathBuf>,
}

impl CodexReader {
    /// `$CODEX_HOME` when set, else `~/.codex` - the override codex honours.
    pub fn from_env() -> Self {
        std::env::var("CODEX_HOME")
            .ok()
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .or_else(|| dirs::home_dir().map(|h| h.join(".codex")))
            .map_or(Self { home: None }, Self::with_home)
    }

    /// A reader over an explicit codex home.
    pub fn with_home(home: PathBuf) -> Self {
        Self { home: Some(home) }
    }

    /// [`CliUsageReader::read`] with the clock injected.
    pub fn read_at(&self, now_ms: i64) -> CliProviderUsage {
        let Some(home) = self.home.as_deref().filter(|h| h.is_dir()) else {
            return CliProviderUsage::not_installed(CliProvider::Codex);
        };
        let mut card = match scan_sessions(&home.join("sessions")) {
            Scan::Found(reading) => reading.into_card(now_ms),
            Scan::Empty(reason) => CliProviderUsage::absent(CliProvider::Codex, true, reason),
        };
        if card.version.is_none() {
            card.version = version_from_file(&home.join("version.json"));
        }
        card
    }
}

impl CliUsageReader for CodexReader {
    fn read(&self) -> CliProviderUsage {
        self.read_at(now_ms())
    }
}

// ── The reading ─────────────────────────────────────────────────────────────

/// One `rate_limits` event as found on disk, before projection.
#[derive(Debug, Clone, PartialEq)]
struct Reading {
    plan_type: Option<String>,
    windows: Vec<CliUsageWindow>,
    as_of_ms: i64,
    version: Option<String>,
}

impl Reading {
    /// Carry the reading forward to `now_ms`.
    ///
    /// Mirrors `claude_accounts::projection::project_usage`: a window whose
    /// reset is still ahead keeps its figure (a floor - this machine cannot
    /// know about use elsewhere); a window whose reset has passed has reset,
    /// so it reads 0 with an unknown next reset. NOT mirrored: advancing a
    /// weekly window's reset by whole periods - Claude's weekly cadence is
    /// known to be fixed, Codex's is not evidenced, so every rolled window
    /// reports `resets_at_ms: None`.
    fn into_card(self, now_ms: i64) -> CliProviderUsage {
        let mut projected = false;
        let windows = self
            .windows
            .into_iter()
            .map(|w| match w.resets_at_ms {
                Some(reset) if reset <= now_ms => {
                    projected = true;
                    CliUsageWindow {
                        used_percent: 0.0,
                        resets_at_ms: None,
                        ..w
                    }
                }
                _ => w,
            })
            .collect();
        CliProviderUsage {
            provider: CliProvider::Codex,
            installed: true,
            version: self.version,
            plan_type: self.plan_type,
            windows,
            as_of_ms: Some(self.as_of_ms),
            projected,
            reason: None,
        }
    }
}

enum Scan {
    Found(Reading),
    Empty(CliUsageReason),
}

// ── Walking sessions/YYYY/MM/DD ─────────────────────────────────────────────

/// Sub-directories of `dir`, newest name first. The date directories are
/// zero-padded numbers, so a descending name sort is a descending date sort.
fn dirs_newest_first(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .collect();
    out.sort_unstable_by(|a, b| b.file_name().cmp(&a.file_name()));
    out
}

/// `rollout-*.jsonl` files directly inside `day`, newest mtime first.
fn rollouts_newest_first(day: &Path) -> Vec<(PathBuf, i64)> {
    let mut out: Vec<(PathBuf, i64)> = fs::read_dir(day)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name();
            let name = name.to_str()?;
            if !(name.starts_with("rollout-") && name.ends_with(".jsonl")) {
                return None;
            }
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            Some((e.path(), mtime))
        })
        .collect();
    out.sort_unstable_by_key(|f| std::cmp::Reverse(f.1));
    out
}

/// Newest day first, newest file first; stop at the first file that yields a
/// reading, give up after [`MAX_FILES`].
fn scan_sessions(sessions: &Path) -> Scan {
    let mut tried = 0usize;
    let mut any_parsed = false;
    for year in dirs_newest_first(sessions) {
        for month in dirs_newest_first(&year) {
            for day in dirs_newest_first(&month) {
                for (file, mtime) in rollouts_newest_first(&day) {
                    if tried >= MAX_FILES {
                        return Scan::Empty(empty_reason(tried, any_parsed));
                    }
                    tried += 1;
                    match read_tail(&file) {
                        Some(tail) => {
                            let (reading, parsed) = find_reading(&tail, mtime);
                            any_parsed |= parsed;
                            if let Some(mut reading) = reading {
                                reading.version = version_from_rollout(&file);
                                return Scan::Found(reading);
                            }
                        }
                        None => {
                            tracing::debug!("codex usage: a rollout log could not be read");
                        }
                    }
                }
            }
        }
    }
    Scan::Empty(empty_reason(tried, any_parsed))
}

/// Why the scan found nothing: no logs at all; logs that parse but carry no
/// quota (an API-key login never gets `rate_limits`); or logs we cannot parse.
fn empty_reason(tried: usize, any_parsed: bool) -> CliUsageReason {
    match (tried, any_parsed) {
        (0, _) => CliUsageReason::NoSessions,
        (_, true) => CliUsageReason::NoQuotaSource,
        (_, false) => CliUsageReason::Unreadable,
    }
}

// ── Reading one file ────────────────────────────────────────────────────────

/// The last [`TAIL_BYTES`] of `file`, whole lines only: when the window
/// starts mid-file its first (cut) line is dropped.
fn read_tail(file: &Path) -> Option<String> {
    let mut f = File::open(file).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    // `take`: a session still being written must not grow the read.
    f.take(TAIL_BYTES).read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    if start == 0 {
        return Some(text.into_owned());
    }
    Some(match text.split_once('\n') {
        Some((_cut, rest)) => rest.to_string(),
        None => String::new(),
    })
}

/// Scan `tail` backwards for the newest `token_count` event with usable
/// `rate_limits`. The bool says whether ANY line parsed as JSON, which is
/// what separates "no quota in here" from "cannot read this".
fn find_reading(tail: &str, mtime_ms: i64) -> (Option<Reading>, bool) {
    let mut any_parsed = false;
    for line in tail.lines().rev() {
        let line = line.trim();
        // Cheap reject before paying for a parse of a possibly huge line.
        if line.is_empty() || !line.contains("rate_limits") {
            any_parsed |= line.starts_with('{') && line.ends_with('}');
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        any_parsed = true;
        if let Some(reading) = parse_event(&v, mtime_ms) {
            return (Some(reading), true);
        }
    }
    (None, any_parsed)
}

/// One log line -> a reading, when it is a `token_count` event whose
/// `rate_limits` holds at least one window. The event type and the limits are
/// accepted under `payload` (0.153.x) or at the top level.
fn parse_event(v: &Value, mtime_ms: i64) -> Option<Reading> {
    let payload = v.get("payload").filter(|p| p.is_object());
    let is_token_count = [payload.and_then(|p| p.get("type")), v.get("type")]
        .into_iter()
        .flatten()
        .any(|t| t.as_str() == Some("token_count"));
    if !is_token_count {
        return None;
    }
    let limits = payload
        .and_then(|p| p.get("rate_limits"))
        .or_else(|| v.get("rate_limits"))
        .filter(|l| l.is_object())?;
    let as_of_ms = v.get("timestamp").and_then(as_epoch_ms).unwrap_or(mtime_ms);
    let windows: Vec<CliUsageWindow> = ["primary", "secondary"]
        .into_iter()
        .filter_map(|key| parse_window(key, limits.get(key)?, as_of_ms))
        .collect();
    if windows.is_empty() {
        return None;
    }
    Some(Reading {
        plan_type: limits
            .get("plan_type")
            .and_then(Value::as_str)
            .map(str::to_string),
        windows,
        as_of_ms,
        version: None,
    })
}

/// `{used_percent, window_minutes, resets_at | resets_in_seconds}`. A `null`
/// window (no secondary limit on the plan) is skipped by the caller's `?`.
fn parse_window(key: &str, w: &Value, as_of_ms: i64) -> Option<CliUsageWindow> {
    let used = w.get("used_percent").and_then(Value::as_f64)?;
    let resets_at_ms = w
        .get("resets_at")
        .filter(|r| !r.is_null())
        .and_then(as_epoch_ms)
        .or_else(|| {
            let secs = w.get("resets_in_seconds").and_then(Value::as_f64)?;
            Some(as_of_ms + (secs * 1000.0) as i64)
        });
    Some(CliUsageWindow {
        key: key.to_string(),
        // 0 = the log did not say.
        window_minutes: w
            .get("window_minutes")
            .and_then(Value::as_f64)
            .map(|m| m as i64)
            .unwrap_or(0),
        used_percent: used.clamp(0.0, 100.0),
        resets_at_ms,
    })
}

// ── Version ─────────────────────────────────────────────────────────────────

fn clean_version(v: &Value) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 32)
        .map(str::to_string)
}

/// The `cli_version` the log's own `session_meta` first line records - the
/// version that actually produced the numbers.
fn version_from_rollout(file: &Path) -> Option<String> {
    let f = File::open(file).ok()?;
    let mut buf = Vec::new();
    f.take(HEAD_BYTES).read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    let first = text.lines().next()?;
    let v: Value = serde_json::from_str(first).ok()?;
    let meta = v.get("payload").unwrap_or(&v);
    meta.get("cli_version").and_then(clean_version)
}

/// `version.json`, only for a key that names the INSTALLED version. On
/// 0.153.x the file holds the update checker's `latest_version`, which is the
/// newest release rather than this install - deliberately not accepted.
fn version_from_file(file: &Path) -> Option<String> {
    let raw = fs::read_to_string(file).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    [
        "version",
        "current_version",
        "installed_version",
        "cli_version",
    ]
    .iter()
    .find_map(|k| v.get(k).and_then(clean_version))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    const NOW: i64 = 1_800_000_000_000;
    const HOUR: i64 = 3_600_000;

    /// A synthetic `token_count` line in the 0.153.x shape.
    fn event(ts: &str, primary: Value, secondary: Value) -> String {
        json!({
            "timestamp": ts,
            "ordinal": 7,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": { "model_context_window": 1000 },
                "rate_limits": {
                    "limit_id": "synthetic",
                    "primary": primary,
                    "secondary": secondary,
                    "plan_type": "pro"
                }
            }
        })
        .to_string()
    }

    fn window(pct: f64, minutes: i64, resets_at_s: i64) -> Value {
        json!({ "used_percent": pct, "window_minutes": minutes, "resets_at": resets_at_s })
    }

    fn meta_line() -> String {
        json!({
            "timestamp": "2027-01-15T07:00:00Z",
            "type": "session_meta",
            "payload": { "id": "synthetic", "cli_version": "0.0.1" }
        })
        .to_string()
    }

    /// A codex home with one rollout log made of `lines`.
    fn home_with(lines: &[String]) -> tempfile::TempDir {
        let home = tempfile::tempdir().expect("tempdir");
        let day = home.path().join("sessions/2027/01/15");
        fs::create_dir_all(&day).expect("day dir");
        let mut f =
            File::create(day.join("rollout-2027-01-15T07-00-00-synthetic.jsonl")).expect("rollout");
        for l in lines {
            writeln!(f, "{l}").expect("write");
        }
        home
    }

    fn read(home: &tempfile::TempDir) -> CliProviderUsage {
        CodexReader::with_home(home.path().to_path_buf()).read_at(NOW)
    }

    #[test]
    fn primary_only_with_a_null_secondary() {
        let reset_s = (NOW + 2 * HOUR) / 1000;
        let home = home_with(&[
            meta_line(),
            event(
                "2027-01-15T08:00:00Z",
                window(37.5, 300, reset_s),
                Value::Null,
            ),
        ]);
        let card = read(&home);
        assert!(card.installed);
        assert_eq!(card.reason, None);
        assert_eq!(card.plan_type.as_deref(), Some("pro"));
        assert_eq!(card.version.as_deref(), Some("0.0.1"));
        assert!(!card.projected);
        assert_eq!(
            card.windows,
            vec![CliUsageWindow {
                key: "primary".into(),
                window_minutes: 300,
                used_percent: 37.5,
                resets_at_ms: Some(reset_s * 1000),
            }]
        );
        let expected = chrono::DateTime::parse_from_rfc3339("2027-01-15T08:00:00Z")
            .expect("ts")
            .timestamp_millis();
        assert_eq!(card.as_of_ms, Some(expected));
    }

    #[test]
    fn both_windows_in_order_and_the_newest_event_wins() {
        let reset_s = (NOW + HOUR) / 1000;
        let home = home_with(&[
            event(
                "2027-01-15T08:00:00Z",
                window(1.0, 300, reset_s),
                Value::Null,
            ),
            event(
                "2027-01-15T09:00:00Z",
                window(20.0, 300, reset_s),
                window(61.0, 10_080, reset_s + 86_400),
            ),
        ]);
        let card = read(&home);
        let keys: Vec<&str> = card.windows.iter().map(|w| w.key.as_str()).collect();
        assert_eq!(keys, ["primary", "secondary"]);
        assert_eq!(card.windows[0].used_percent, 20.0);
        assert_eq!(card.windows[1].window_minutes, 10_080);
        assert!(!card.projected);
    }

    #[test]
    fn a_passed_reset_is_projected_to_empty_and_a_future_one_is_kept() {
        let past_s = (NOW - HOUR) / 1000;
        let future_s = (NOW + 24 * HOUR) / 1000;
        let home = home_with(&[event(
            "2027-01-15T08:00:00Z",
            window(90.0, 300, past_s),
            window(55.0, 10_080, future_s),
        )]);
        let card = read(&home);
        assert!(card.projected);
        assert_eq!(card.windows[0].used_percent, 0.0);
        assert_eq!(card.windows[0].resets_at_ms, None);
        assert_eq!(card.windows[0].window_minutes, 300);
        assert_eq!(card.windows[1].used_percent, 55.0);
        assert_eq!(card.windows[1].resets_at_ms, Some(future_s * 1000));
    }

    #[test]
    fn resets_in_seconds_counts_from_the_event_and_top_level_shape_is_accepted() {
        let line = json!({
            "timestamp": NOW - HOUR,
            "type": "token_count",
            "rate_limits": {
                "primary": { "used_percent": 140.0, "resets_in_seconds": 7200 }
            }
        })
        .to_string();
        let card = read(&home_with(&[line]));
        assert_eq!(card.as_of_ms, Some(NOW - HOUR));
        assert_eq!(card.windows[0].used_percent, 100.0);
        assert_eq!(card.windows[0].window_minutes, 0);
        assert_eq!(card.windows[0].resets_at_ms, Some(NOW + HOUR));
        assert_eq!(card.plan_type, None);
    }

    #[test]
    fn a_missing_home_is_not_installed() {
        let home = tempfile::tempdir().expect("tempdir");
        let card = CodexReader::with_home(home.path().join("absent")).read_at(NOW);
        assert_eq!(card, CliProviderUsage::not_installed(CliProvider::Codex));
    }

    #[test]
    fn a_home_without_sessions_is_installed_with_no_sessions() {
        let home = tempfile::tempdir().expect("tempdir");
        let card = read(&home);
        assert!(card.installed);
        assert_eq!(card.reason, Some(CliUsageReason::NoSessions));
        assert!(card.windows.is_empty());
        assert_eq!(card.as_of_ms, None);

        // Date directories with no rollout log in them read the same.
        fs::create_dir_all(home.path().join("sessions/2027/01/15")).expect("dirs");
        assert_eq!(read(&home).reason, Some(CliUsageReason::NoSessions));
    }

    #[test]
    fn a_log_without_rate_limits_is_no_quota_source() {
        let no_limits = json!({
            "timestamp": "2027-01-15T08:00:00Z",
            "type": "event_msg",
            "payload": { "type": "token_count", "info": {}, "rate_limits": null }
        })
        .to_string();
        let card = read(&home_with(&[meta_line(), no_limits]));
        assert!(card.installed);
        assert_eq!(card.reason, Some(CliUsageReason::NoQuotaSource));
        assert!(card.windows.is_empty());
    }

    #[test]
    fn a_log_that_never_parses_is_unreadable() {
        let card = read(&home_with(&[
            "not json".into(),
            "{\"rate_limits\": tru".into(),
        ]));
        assert!(card.installed);
        assert_eq!(card.reason, Some(CliUsageReason::Unreadable));
    }

    #[test]
    fn malformed_tail_and_a_cut_first_line_are_tolerated_in_a_large_log() {
        let reset_s = (NOW + HOUR) / 1000;
        // One filler line far larger than the window, so the byte cut lands
        // inside it and the window opens on a truncated line.
        let filler = json!({ "type": "response_item", "payload": { "text": "x".repeat(400_000) } })
            .to_string();
        let home = home_with(&[
            meta_line(),
            // An older event OUTSIDE the window must not be what is found.
            event(
                "2027-01-15T06:00:00Z",
                window(99.0, 300, reset_s),
                Value::Null,
            ),
            filler,
            event(
                "2027-01-15T08:00:00Z",
                window(12.0, 300, reset_s),
                Value::Null,
            ),
            "{\"payload\":{\"type\":\"token_count\",\"rate_limits\":{\"prim".into(),
        ]);
        let card = read(&home);
        assert_eq!(card.reason, None);
        assert_eq!(card.windows[0].used_percent, 12.0);
        assert_eq!(card.version.as_deref(), Some("0.0.1"));
    }

    #[test]
    fn an_older_file_is_used_when_the_newest_has_no_event() {
        let reset_s = (NOW + HOUR) / 1000;
        let home = home_with(&[event(
            "2027-01-15T08:00:00Z",
            window(44.0, 300, reset_s),
            Value::Null,
        )]);
        let newer = home.path().join("sessions/2027/02/01");
        fs::create_dir_all(&newer).expect("dirs");
        fs::write(
            newer.join("rollout-2027-02-01-synthetic.jsonl"),
            meta_line(),
        )
        .expect("write");
        // Not a rollout log: never considered.
        fs::write(newer.join("notes.jsonl"), "garbage").expect("write");
        assert_eq!(read(&home).windows[0].used_percent, 44.0);
    }

    #[test]
    fn auth_json_is_never_opened() {
        let reset_s = (NOW + HOUR) / 1000;
        let home = home_with(&[event(
            "2027-01-15T08:00:00Z",
            window(5.0, 300, reset_s),
            Value::Null,
        )]);
        // A directory named auth.json: any attempt to read it as a file
        // fails, so a reader that touched it could not produce a clean card.
        fs::create_dir(home.path().join("auth.json")).expect("auth dir");
        let card = read(&home);
        assert_eq!(card.reason, None);
        assert_eq!(card.windows.len(), 1);
    }

    #[test]
    fn version_json_only_answers_for_an_installed_version_key() {
        let home = tempfile::tempdir().expect("tempdir");
        let file = home.path().join("version.json");
        fs::write(&file, r#"{"latest_version":"9.9.9","last_checked_at":"x"}"#).expect("write");
        assert_eq!(version_from_file(&file), None);
        fs::write(&file, r#"{"version":" 1.2.3 "}"#).expect("write");
        assert_eq!(version_from_file(&file).as_deref(), Some("1.2.3"));
        fs::write(&file, "[]").expect("write");
        assert_eq!(version_from_file(&file), None);
    }
}
