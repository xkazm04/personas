//! Stale-entry sweep for the stable per-persona scratch workspace.
//!
//! A run with no worktree and no home project executes in
//! `<temp>/personas-workspace/<persona_id>`, and that directory is kept across
//! runs on purpose: Claude Code keys its per-project session store and memory
//! on the working directory, so a retry that resumes a session (`--resume`)
//! must land in the SAME cwd. A per-run subdirectory would break exactly that.
//!
//! What it must not do is keep everything forever. Logs, `target/` dirs and
//! drafts from runs days ago sat unlabelled in every later run's cwd, where
//! the next run reads them as if they were current work. This sweep removes
//! top-level entries nothing has touched for [`STALE_AFTER`], keeps the CLI's
//! own state, and runs at most once per [`SWEEP_INTERVAL`] per persona so a
//! busy persona does not pay a directory walk on every run.

use std::path::Path;
use std::time::{Duration, SystemTime};

/// An entry whose newest file is older than this is left over from a run the
/// persona has long moved on from.
pub(crate) const STALE_AFTER: Duration = Duration::from_secs(3 * 24 * 60 * 60);

/// Minimum spacing between sweeps of one workspace.
pub(crate) const SWEEP_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Marker whose mtime records the last sweep. Itself protected.
const SWEEP_MARKER: &str = ".personas-workspace-gc";

/// Entries that are the CLI's or the engine's own state, never swept.
const PROTECTED: &[&str] = &[
    SWEEP_MARKER,
    ".claude",
    ".personas",
    ".mcp.json",
    "CLAUDE.md",
];

/// Upper bound on files inspected while deciding whether one entry is stale.
/// Past it the entry is treated as live: a huge tree is not worth the walk,
/// and keeping it is the safe mistake.
const MAX_FILES_PER_ENTRY: usize = 200_000;

/// What a sweep did, for the run log.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct SweepReport {
    pub removed: Vec<String>,
    pub failed: Vec<String>,
}

/// Sweep `dir` if it is due. Returns `None` when the last sweep was recent
/// (or the directory cannot be read), `Some(report)` when a sweep ran.
/// Best-effort throughout: no failure here may fail a run.
pub(crate) fn sweep_if_due(dir: &Path, now: SystemTime) -> Option<SweepReport> {
    let marker = dir.join(SWEEP_MARKER);
    if let Ok(last) = std::fs::metadata(&marker).and_then(|m| m.modified()) {
        if now.duration_since(last).unwrap_or_default() < SWEEP_INTERVAL {
            return None;
        }
    }
    let entries = std::fs::read_dir(dir).ok()?;
    let mut report = SweepReport::default();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if PROTECTED.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        if !is_stale(&path, now) {
            continue;
        }
        let removed = match entry.file_type() {
            Ok(ft) if ft.is_dir() => std::fs::remove_dir_all(&path),
            _ => std::fs::remove_file(&path),
        };
        match removed {
            Ok(()) => report.removed.push(name),
            Err(_) => report.failed.push(name),
        }
    }
    // Stamp the sweep even when some removals failed (a locked file stays
    // locked for a while; retrying on every run would only repeat the walk).
    let _ = std::fs::write(&marker, b"");
    Some(report)
}

/// True when nothing under `path` was modified within [`STALE_AFTER`].
fn is_stale(path: &Path, now: SystemTime) -> bool {
    let fresh = |p: &Path| -> bool {
        std::fs::symlink_metadata(p)
            .and_then(|m| m.modified())
            .map(|t| now.duration_since(t).unwrap_or_default() < STALE_AFTER)
            // Unreadable metadata: assume live.
            .unwrap_or(true)
    };
    if fresh(path) {
        return false;
    }
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !meta.is_dir() {
        return true;
    }
    let mut stack = vec![path.to_path_buf()];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            return false;
        };
        for child in rd.flatten() {
            seen += 1;
            if seen > MAX_FILES_PER_ENTRY {
                return false;
            }
            let p = child.path();
            if fresh(&p) {
                return false;
            }
            // Do not follow symlinked or junctioned directories out of the
            // workspace; their own mtime was checked above.
            if child.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                stack.push(p);
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn later(days: u64) -> SystemTime {
        SystemTime::now() + Duration::from_secs(days * 24 * 60 * 60)
    }

    #[test]
    fn stale_leftovers_go_and_cli_state_and_fresh_work_stay() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        std::fs::create_dir_all(dir.join("target/debug")).unwrap();
        std::fs::write(dir.join("target/debug/big.bin"), b"x").unwrap();
        std::fs::write(dir.join("draft.md"), b"old draft").unwrap();
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(dir.join(".claude/settings.json"), b"{}").unwrap();
        std::fs::write(dir.join("CLAUDE.md"), b"memory").unwrap();

        // Four days on, everything written above is stale.
        let report = sweep_if_due(dir, later(4)).expect("first sweep runs");
        let mut removed = report.removed.clone();
        removed.sort();
        assert_eq!(removed, vec!["draft.md".to_string(), "target".to_string()]);
        assert!(report.failed.is_empty());
        assert!(dir.join(".claude/settings.json").exists());
        assert!(dir.join("CLAUDE.md").exists());
        assert!(!dir.join("target").exists());
    }

    #[test]
    fn work_touched_recently_is_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        std::fs::write(dir.join("notes/today.md"), b"live").unwrap();
        let report = sweep_if_due(dir, SystemTime::now()).expect("sweep runs");
        assert!(report.removed.is_empty());
        assert!(dir.join("notes/today.md").exists());
    }

    #[test]
    fn a_recent_sweep_is_not_repeated() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        assert!(sweep_if_due(dir, SystemTime::now()).is_some());
        // The marker was just written; an hour later nothing runs.
        let an_hour_on = SystemTime::now() + Duration::from_secs(3600);
        assert!(sweep_if_due(dir, an_hour_on).is_none());
        // A day and a bit later the sweep is due again.
        assert!(sweep_if_due(dir, later(2)).is_some());
    }
}
