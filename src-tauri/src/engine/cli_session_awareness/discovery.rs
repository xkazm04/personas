//! Discovery of the user's currently-active Claude CLI session.
//!
//! Claude Code CLI writes a JSONL transcript per session under
//! `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. The
//! "active" session is the most-recently-modified jsonl file across
//! all project directories, gated by a freshness cutoff.
//!
//! This module is pure filesystem walking — no parsing, no I/O on
//! the file content. The transcript reader (`transcript.rs`, step 2)
//! handles the actual content. Keeping discovery and reading in
//! separate modules makes both unit-testable in isolation.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Default freshness cutoff: 10 minutes.
///
/// Sessions whose newest transcript file is older than this are
/// treated as not-active. A daemon-fired persona at 3am won't
/// pick up the user's afternoon debugging session.
pub const DEFAULT_FRESHNESS_CUTOFF: Duration = Duration::from_secs(10 * 60);

/// A discovered active CLI session reference.
///
/// Carries everything the transcript reader and audit logger need
/// to do their work without a second filesystem traversal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveSession {
    /// Absolute path to the JSONL transcript file.
    pub path: PathBuf,
    /// Name of the project directory (the encoded-cwd component).
    /// Used for the rendered prompt block's "**Project**:" line and
    /// for the audit row's project label.
    pub project_dir_name: String,
    /// File modification time. Lets the renderer compute "Nm ago"
    /// for the active-since line and lets the audit log dedupe by
    /// (path, mtime).
    pub mtime: SystemTime,
}

/// Walk `~/.claude/projects/<*>/<*.jsonl>` and return the newest
/// transcript whose mtime is within `freshness_cutoff` of `now`.
///
/// Returns `None` when:
/// - `~/.claude/projects/` does not exist (Claude CLI never run)
/// - No project directories contain `.jsonl` files
/// - All discovered transcripts are older than the cutoff
/// - Any I/O error during the walk (logged at debug, not surfaced)
///
/// The `home` parameter is injectable for testing — production
/// callers pass `dirs::home_dir()`.
pub fn discover_active_session(
    home: &Path,
    now: SystemTime,
    freshness_cutoff: Duration,
) -> Option<ActiveSession> {
    let projects_root = home.join(".claude").join("projects");
    if !projects_root.is_dir() {
        return None;
    }

    let mut best: Option<ActiveSession> = None;
    let project_entries = match fs::read_dir(&projects_root) {
        Ok(it) => it,
        Err(e) => {
            tracing::debug!(
                error = %e,
                root = ?projects_root,
                "cli_session_awareness: failed to read projects root"
            );
            return None;
        }
    };

    for project_entry in project_entries.flatten() {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let project_dir_name = match project_path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        let jsonl_entries = match fs::read_dir(&project_path) {
            Ok(it) => it,
            Err(_) => continue,
        };
        for jsonl_entry in jsonl_entries.flatten() {
            let path = jsonl_entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }

            let mtime = match jsonl_entry.metadata().and_then(|m| m.modified()) {
                Ok(t) => t,
                Err(_) => continue,
            };

            // Freshness gate.
            let age = now.duration_since(mtime).unwrap_or(Duration::ZERO);
            if age > freshness_cutoff {
                continue;
            }

            // Best-so-far tracking: keep the newest mtime overall.
            let beats_current = best
                .as_ref()
                .map(|b| mtime > b.mtime)
                .unwrap_or(true);
            if beats_current {
                best = Some(ActiveSession {
                    path,
                    project_dir_name: project_dir_name.clone(),
                    mtime,
                });
            }
        }
    }

    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Per-test scratch home — uses a unique subdir under the system
    /// temp dir so parallel tests don't collide. Caller is responsible
    /// for not relying on cleanup; the OS evicts /tmp eventually and
    /// the per-test counter prevents same-run reuse.
    fn scratch_home() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let mut p = std::env::temp_dir();
        p.push(format!("personas_cli_disc_test_{pid}_{id}"));
        std::fs::create_dir_all(&p).expect("create scratch home");
        p
    }

    fn write_session_file(home: &Path, project: &str, name: &str, content: &str) -> PathBuf {
        let dir = home.join(".claude").join("projects").join(project);
        std::fs::create_dir_all(&dir).expect("create project dir");
        let path = dir.join(name);
        let mut f = File::create(&path).expect("create jsonl");
        f.write_all(content.as_bytes()).expect("write jsonl");
        path
    }

    fn set_mtime(path: &Path, mtime: SystemTime) {
        // Use filetime-equivalent via the std `set_modified` (rust 1.75+
        // has `File::set_modified`).
        let f = std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .expect("open for set_modified");
        f.set_modified(mtime).expect("set_modified");
    }

    #[test]
    fn returns_none_when_projects_root_missing() {
        let home = scratch_home();
        // No .claude/projects/ created at all.
        let result = discover_active_session(
            &home,
            SystemTime::now(),
            DEFAULT_FRESHNESS_CUTOFF,
        );
        assert!(result.is_none());
    }

    #[test]
    fn returns_none_when_only_stale_files() {
        let home = scratch_home();
        let path = write_session_file(&home, "proj-stale", "s.jsonl", "{}\n");
        // Stale by a day.
        let stale = SystemTime::now() - Duration::from_secs(60 * 60 * 24);
        set_mtime(&path, stale);

        let result = discover_active_session(
            &home,
            SystemTime::now(),
            DEFAULT_FRESHNESS_CUTOFF,
        );
        assert!(result.is_none(), "stale file should be filtered out");
    }

    #[test]
    fn picks_newest_across_projects() {
        let home = scratch_home();
        let path_a = write_session_file(&home, "proj-a", "a.jsonl", "{}\n");
        let path_b = write_session_file(&home, "proj-b", "b.jsonl", "{}\n");

        // a is older, b is newer — both within the freshness window.
        let now = SystemTime::now();
        set_mtime(&path_a, now - Duration::from_secs(120));
        set_mtime(&path_b, now - Duration::from_secs(30));

        let result = discover_active_session(&home, now, DEFAULT_FRESHNESS_CUTOFF)
            .expect("should find a session");
        assert_eq!(result.project_dir_name, "proj-b");
        assert_eq!(result.path, path_b);
    }

    #[test]
    fn picks_newest_within_same_project() {
        let home = scratch_home();
        let path_old = write_session_file(&home, "proj", "old.jsonl", "{}\n");
        let path_new = write_session_file(&home, "proj", "new.jsonl", "{}\n");

        let now = SystemTime::now();
        set_mtime(&path_old, now - Duration::from_secs(300));
        set_mtime(&path_new, now - Duration::from_secs(60));

        let result = discover_active_session(&home, now, DEFAULT_FRESHNESS_CUTOFF)
            .expect("should find a session");
        assert_eq!(result.path, path_new);
    }

    #[test]
    fn ignores_non_jsonl_files() {
        let home = scratch_home();
        let path_jsonl = write_session_file(&home, "proj", "real.jsonl", "{}\n");
        let _decoy = write_session_file(&home, "proj", "settings.json", "{}\n");
        let now = SystemTime::now();
        set_mtime(&path_jsonl, now - Duration::from_secs(60));

        let result = discover_active_session(&home, now, DEFAULT_FRESHNESS_CUTOFF)
            .expect("should find a session");
        assert_eq!(result.path, path_jsonl);
    }

    #[test]
    fn freshness_cutoff_is_applied() {
        let home = scratch_home();
        let path = write_session_file(&home, "proj", "s.jsonl", "{}\n");
        let now = SystemTime::now();
        // 8 minutes old, well within the default 10 min cutoff.
        set_mtime(&path, now - Duration::from_secs(8 * 60));

        // With 5-min cutoff, file is too old.
        let tight = discover_active_session(&home, now, Duration::from_secs(5 * 60));
        assert!(tight.is_none(), "8 min old should miss a 5 min cutoff");

        // With default 10-min cutoff, file is fresh.
        let loose = discover_active_session(&home, now, DEFAULT_FRESHNESS_CUTOFF);
        assert!(loose.is_some(), "8 min old should pass a 10 min cutoff");
    }
}
