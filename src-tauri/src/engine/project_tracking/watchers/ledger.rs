//! Active-runs ledger watcher — parses
//! `<project>/.claude/active-runs.md` and emits `RunStarted` /
//! `RunCompleted` events for entries with timestamps newer than `since`.
//!
//! Format conventions (from the ledger header):
//! - `## Active` section holds in-progress entries.
//! - `## Recently completed` section holds finished entries.
//! - Each entry's first line is shaped like:
//!   `- **[YYYY-MM-DD HH:MM] /<skill> — <slug>**`
//!   or sometimes `- **[YYYY-MM-DD HH:MM] <session-name> — <description>**`.
//! - The status line carries `**Status:** completed (commit: <sha>)` /
//!   `started` / `aborted (<reason>)` for completed entries.
//!
//! This is a forgiving parser: malformed lines are skipped with a
//! tracing::warn; we don't break the tick for one bad entry.

use std::path::{Path, PathBuf};

use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use tokio::fs;
use tracing::warn;

use crate::engine::project_tracking::events::EventPayload;
use crate::error::AppError;

/// Where the ledger lives relative to a project root.
const LEDGER_RELATIVE_PATH: &str = ".claude/active-runs.md";

pub async fn poll(
    project_path: &Path,
    since: DateTime<Utc>,
) -> Result<Vec<EventPayload>, AppError> {
    let ledger_path: PathBuf = project_path.join(LEDGER_RELATIVE_PATH);
    let body = match fs::read_to_string(&ledger_path).await {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Ledger is optional — projects without it just emit no events.
            return Ok(vec![]);
        }
        Err(e) => {
            warn!(
                project = %project_path.display(),
                ledger = %ledger_path.display(),
                error = %e,
                "project_tracking ledger watcher: read failed; skipping",
            );
            return Ok(vec![]);
        }
    };

    let mut events = Vec::new();
    let mut section: Section = Section::Header;

    // Per-entry accumulator. We collect the full block for an entry so
    // the status line is matched against the same timestamp/slug header.
    let mut current: Option<EntryAccumulator> = None;

    for line in body.lines() {
        // Section transitions.
        if line.starts_with("## Active") {
            flush_entry(&mut current, &mut events, since, /* assume_started */ true);
            section = Section::Active;
            continue;
        }
        if line.starts_with("## Recently completed")
            || line.starts_with("## Recent")
        {
            flush_entry(&mut current, &mut events, since, /* assume_started */ true);
            section = Section::Completed;
            continue;
        }
        if line.starts_with("## ") {
            flush_entry(&mut current, &mut events, since, /* assume_started */ true);
            section = Section::Other;
            continue;
        }

        // Entry header line — starts a new accumulator.
        if line.starts_with("- **[") {
            flush_entry(&mut current, &mut events, since, /* assume_started */ section == Section::Active);
            current = parse_header(line, section);
            continue;
        }

        // Status line — only meaningful inside an entry block.
        if let Some(acc) = current.as_mut() {
            if let Some(rest) = line.trim().strip_prefix("- **Status:**") {
                acc.status_line = Some(rest.trim().to_string());
            }
        }
    }
    flush_entry(&mut current, &mut events, since, /* assume_started */ section == Section::Active);

    Ok(events)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Section {
    Header,
    Active,
    Completed,
    Other,
}

#[derive(Debug)]
struct EntryAccumulator {
    timestamp_iso: String,
    slug: String,
    section: Section,
    status_line: Option<String>,
}

fn parse_header(line: &str, section: Section) -> Option<EntryAccumulator> {
    // Expected shape: `- **[YYYY-MM-DD HH:MM] /<skill> — <slug>**` or
    // `- **[YYYY-MM-DD HH:MM] something else** ...`. Tolerant of `~`
    // prefix on the time (`~17:35`) used informally for approximate
    // start times.
    let after_open = line.trim_start_matches("- **[")
        .splitn(2, ']')
        .collect::<Vec<_>>();
    if after_open.len() != 2 {
        return None;
    }
    let raw_ts = after_open[0].trim_start_matches('~').trim();
    let timestamp_iso = parse_local_timestamp(raw_ts).map(|dt| dt.to_rfc3339())?;
    let slug_rest = after_open[1].trim().trim_end_matches("**").trim();
    Some(EntryAccumulator {
        timestamp_iso,
        slug: slug_rest.to_string(),
        section,
        status_line: None,
    })
}

fn parse_local_timestamp(raw: &str) -> Option<DateTime<Utc>> {
    // Ledger convention is local time; we don't have the user's offset
    // here so we treat the wall-clock as UTC. Drift relative to true
    // UTC is small (an hour or two), and the only consumer is the
    // since-filter — close enough that no event gets stuck in the past
    // forever and no stale event resurfaces. Better than failing-closed.
    NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M")
        .ok()
        .and_then(|naive| Utc.from_local_datetime(&naive).single())
}

fn flush_entry(
    current: &mut Option<EntryAccumulator>,
    events: &mut Vec<EventPayload>,
    since: DateTime<Utc>,
    assume_started: bool,
) {
    let Some(acc) = current.take() else { return };
    let Ok(parsed) = DateTime::parse_from_rfc3339(&acc.timestamp_iso) else {
        return;
    };
    let entry_ts = parsed.with_timezone(&Utc);
    if entry_ts < since {
        return;
    }

    match acc.section {
        Section::Active => {
            // Active entries are running; emit `run_started`.
            events.push(EventPayload::RunStarted {
                slug: acc.slug,
                timestamp: acc.timestamp_iso,
                source: None,
            });
        }
        Section::Completed => {
            let (status, commit_sha) = parse_status(acc.status_line.as_deref());
            events.push(EventPayload::RunCompleted {
                slug: acc.slug,
                commit_sha,
                status,
            });
        }
        _ => {
            // Header / Other — only emit if we'd otherwise lose the entry
            // and the caller is treating the section as Active-equivalent.
            if assume_started {
                events.push(EventPayload::RunStarted {
                    slug: acc.slug,
                    timestamp: acc.timestamp_iso,
                    source: None,
                });
            }
        }
    }
}

fn parse_status(status_line: Option<&str>) -> (String, Option<String>) {
    let Some(line) = status_line else {
        return ("completed".to_string(), None);
    };
    // Look for `commit: <sha>` token.
    if let Some(idx) = line.find("commit:") {
        let rest = &line[idx + "commit:".len()..];
        let sha = rest.trim().split(|c: char| !c.is_ascii_alphanumeric())
            .next()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        return ("completed".to_string(), sha);
    }
    if line.to_lowercase().contains("aborted") {
        return ("aborted".to_string(), None);
    }
    ("completed".to_string(), None)
}
