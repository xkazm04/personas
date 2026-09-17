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
/// commit since `since`.
///
/// **A failure is an `Err`, not an empty tick.** Binary missing, not a repo,
/// or a non-zero exit all used to return `Ok(vec![])`, which the scheduler
/// could not tell apart from "this repo had a quiet hour" — so it stamped
/// `last_pulse_at` and the next tick's `watch_since` started after the commits
/// it never read. They were gone for good. The scheduler still continues with
/// the project's other watchers; it just declines to advance the stamp.
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
                "project_tracking git watcher: spawn failed (binary missing or not on PATH); tick is blind",
            );
            return Err(AppError::ProcessSpawn(format!(
                "git log in {}: {e}",
                project_path.display()
            )));
        }
    };

    if !output.status.success() {
        warn!(
            project = %project_path.display(),
            stderr = %String::from_utf8_lossy(&output.stderr),
            "project_tracking git watcher: git log non-zero exit; tick is blind",
        );
        return Err(AppError::External(format!(
            "git log in {}: {}",
            project_path.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A path git refuses (not a repository) is an unreadable source, not a
    /// quiet one. It used to return `Ok(vec![])`, which the scheduler stamped
    /// over — see `scheduler::TickReadState`.
    #[tokio::test]
    async fn a_non_repository_is_an_error_not_an_empty_poll() {
        let dir = std::env::temp_dir().join(format!(
            "personas_git_watcher_not_a_repo_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");

        let result = poll(&dir, Utc::now() - chrono::Duration::hours(1)).await;

        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            result.is_err(),
            "a path git cannot read must not look like a project with no commits",
        );
    }
}
