//! Git watcher — `git log --since=<iso> --no-merges` against a project
//! path, parsed into [`EventPayload::Commit`] events.
//!
//! Subprocess-based: we spawn the user's `git` binary on PATH. The cost
//! is one process spawn per polled project per tick (~once an hour); no
//! libgit2 dependency, no Cargo.toml addition.
//!
//! Format choice: `%H|%an|%aI|%s` is unit-separated by `|` then
//! line-separated. Subjects with `|` in them are rare; in the rare case
//! we treat extras as part of the subject (split into 4 max) so we never
//! lose the commit hash or the date.

use std::path::Path;

use chrono::{DateTime, Utc};
use tokio::process::Command;
use tracing::warn;

use crate::engine::project_tracking::events::EventPayload;
use crate::error::AppError;

/// Hard ceiling on commits returned per poll. Above this we truncate
/// with a warning rather than blow the consolidator's prompt budget.
/// Sized for the user's "10 CLIs × hundreds of commits/day" — at 1h
/// cadence and 10 projects this rarely triggers, but a backfill or a
/// weekend's-worth-of-commits import could.
const MAX_COMMITS_PER_POLL: usize = 500;

/// Spawn `git log` and parse output. Returns one event per non-merge
/// commit since `since`. Failure modes (binary missing, not a repo,
/// timeout) return Ok(vec![]) with a tracing::warn — the scheduler
/// continues with other watchers.
pub async fn poll(
    project_path: &Path,
    since: DateTime<Utc>,
) -> Result<Vec<EventPayload>, AppError> {
    let since_iso = since.to_rfc3339();
    let output = Command::new("git")
        .arg("-C")
        .arg(project_path)
        .args([
            "log",
            "--no-merges",
            "--pretty=format:%H|%an|%aI|%s",
            &format!("--since={since_iso}"),
            &format!("--max-count={MAX_COMMITS_PER_POLL}"),
        ])
        .output()
        .await;

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            warn!(
                project = %project_path.display(),
                error = %e,
                "project_tracking git watcher: spawn failed (binary missing or not on PATH); skipping",
            );
            return Ok(vec![]);
        }
    };

    if !output.status.success() {
        warn!(
            project = %project_path.display(),
            stderr = %String::from_utf8_lossy(&output.stderr),
            "project_tracking git watcher: git log non-zero exit; skipping",
        );
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut events = Vec::new();
    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() < 4 {
            warn!(
                project = %project_path.display(),
                line = %line,
                "project_tracking git watcher: malformed line; skipping",
            );
            continue;
        }
        events.push(EventPayload::Commit {
            hash: parts[0].to_string(),
            author: parts[1].to_string(),
            author_date: parts[2].to_string(),
            subject: parts[3].to_string(),
        });
    }

    if events.len() == MAX_COMMITS_PER_POLL {
        warn!(
            project = %project_path.display(),
            cap = MAX_COMMITS_PER_POLL,
            "project_tracking git watcher: hit max-count cap; some commits not surfaced this tick",
        );
    }

    Ok(events)
}
