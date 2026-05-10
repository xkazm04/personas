//! Obsidian watcher — scans a configured vault for note files modified
//! since the last poll. Phase 6, opt-in per project.
//!
//! Scope is scoped to three Personas-Obsidian conventions:
//!   - `Lessons/*.md` — `/explorer`, `/research`, `/architect` self-reflections
//!   - `Explorer/sweeps/*.md` — per-run sweep records
//!   - `Architect/scans/*.md` — design-scan records
//!
//! For each modified note, we emit one [`EventPayload::Note`] with the
//! file path, the H1 title (or filename fallback), and a one-paragraph
//! summary (the first non-blank chunk after the frontmatter, capped at
//! 600 chars). Bigger notes get truncated; we don't run any LLM here.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use tokio::fs;
use tracing::warn;

use crate::engine::project_tracking::events::EventPayload;
use crate::error::AppError;

/// Subdirectories of the vault we read. Each one is optional — missing
/// dirs are quietly skipped.
const WATCH_SUBDIRS: &[&str] = &[
    "Lessons",
    "Explorer/sweeps",
    "Architect/scans",
];

/// Hard ceiling on notes returned per poll. A multi-day backfill could
/// surface hundreds; we cap so the consolidator's prompt stays bounded.
const MAX_NOTES_PER_POLL: usize = 50;

/// Cap on summary bytes. Sized for "fits in one paragraph of the
/// consolidator prompt without dominating it".
const SUMMARY_BYTE_CAP: usize = 600;

pub async fn poll(
    vault_path: &Path,
    since: DateTime<Utc>,
) -> Result<Vec<EventPayload>, AppError> {
    let mut events = Vec::new();
    for sub in WATCH_SUBDIRS {
        let dir = vault_path.join(sub);
        match scan_dir(&dir, since).await {
            Ok(found) => {
                for path in found {
                    if events.len() >= MAX_NOTES_PER_POLL {
                        warn!(
                            vault = %vault_path.display(),
                            cap = MAX_NOTES_PER_POLL,
                            "obsidian watcher: hit per-poll cap; some notes not surfaced this tick",
                        );
                        return Ok(events);
                    }
                    match build_note_payload(&path).await {
                        Ok(payload) => events.push(payload),
                        Err(e) => warn!(
                            path = %path.display(),
                            error = %e,
                            "obsidian watcher: failed to render note; skipping",
                        ),
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Subdir is optional — vault may not have all three.
            }
            Err(e) => warn!(
                vault = %vault_path.display(),
                subdir = sub,
                error = %e,
                "obsidian watcher: dir scan failed; skipping",
            ),
        }
    }
    Ok(events)
}

async fn scan_dir(dir: &Path, since: DateTime<Utc>) -> std::io::Result<Vec<PathBuf>> {
    let mut entries = fs::read_dir(dir).await?;
    let since_unix = since.timestamp();
    let mut out = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if ext.to_lowercase() != "md" {
            continue;
        }
        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !metadata.is_file() {
            continue;
        }
        let modified = match metadata.modified() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let modified_unix = modified
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        if modified_unix < since_unix {
            continue;
        }
        out.push(path);
    }
    Ok(out)
}

async fn build_note_payload(path: &Path) -> Result<EventPayload, AppError> {
    let body = fs::read_to_string(path).await.map_err(AppError::Io)?;
    let (title, summary) = extract_title_and_summary(&body);
    Ok(EventPayload::Note {
        path: path.to_string_lossy().into_owned(),
        title,
        summary: Some(summary),
    })
}

/// Pull the H1 title (first `# ...` line outside frontmatter) plus a
/// short summary (first non-blank prose chunk after frontmatter, capped
/// at [`SUMMARY_BYTE_CAP`]).
fn extract_title_and_summary(body: &str) -> (Option<String>, String) {
    let mut lines = body.lines().peekable();
    // Skip YAML frontmatter (---...---) if present.
    if lines.peek().copied() == Some("---") {
        lines.next();
        for line in lines.by_ref() {
            if line == "---" {
                break;
            }
        }
    }

    let mut title: Option<String> = None;
    let mut summary = String::new();
    for line in lines {
        let trimmed = line.trim_start();
        if title.is_none() && trimmed.starts_with("# ") {
            title = Some(trimmed[2..].trim().to_string());
            continue;
        }
        if title.is_some() {
            // After the title, accumulate the first prose paragraph.
            if trimmed.is_empty() {
                if !summary.is_empty() {
                    break;
                }
                continue;
            }
            // Skip headings beneath the H1.
            if trimmed.starts_with('#') {
                continue;
            }
            if !summary.is_empty() {
                summary.push(' ');
            }
            summary.push_str(trimmed);
            if summary.len() >= SUMMARY_BYTE_CAP {
                break;
            }
        }
    }
    if summary.len() > SUMMARY_BYTE_CAP {
        let mut end = SUMMARY_BYTE_CAP;
        while !summary.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        summary.truncate(end);
        summary.push('…');
    }
    (title, summary)
}
