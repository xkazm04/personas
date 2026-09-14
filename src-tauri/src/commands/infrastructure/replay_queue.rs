//! The replay queue — write-backs a worker could not deliver, drained by the
//! app instead of by a human.
//!
//! An App Master worker whose bridge is unreachable when it finishes (the app
//! was down, its port moved, the handshake was stale) queues its outcome under
//! `~/.personas/replay/` by a convention the workers established themselves:
//!
//! - `outcome-<idea id or prefix>[-<anything>].json` — the body of a
//!   `POST /dev-tools/ideas/{idea}/outcome` ([`IdeaOutcomeInput`]),
//! - `idea-<anything>.json` — the body of a `POST /dev-tools/ideas`
//!   ([`FileIdeaInput`]).
//!
//! Until 2026-09-14 nothing in the app read that directory. Seven outcomes
//! queued on 2026-09-10 were still there four days later; their ideas stayed
//! `accepted`, were re-dispatched, and the abandoned-dispatch sweep released
//! the original rows as *"worker ended without write-back"* — for work that
//! had been merged for three days. The queue existed precisely to prevent that
//! loop, and it could only prevent it if something drained it.
//!
//! [`drain`] is that something. It runs at boot (the first fleet rehydrate)
//! and again at the top of every abandoned-dispatch sweep, so a queued outcome
//! is applied BEFORE the sweep can read its absence as a death. Every file is
//! moved out of the queue exactly once: to `applied/` when the door accepted
//! it (or had already recorded the same outcome — the drain is idempotent, so
//! an outcome a human replayed by hand is filed, not re-applied), or to
//! `rejected/` with a `.reason.txt` beside it when it could not be applied.
//! Nothing is deleted and nothing is retried forever.

use std::path::{Path, PathBuf};

use crate::db::DbPool;

use super::app_master_writeback::{
    file_backlog_idea, outcome_already_recorded, record_idea_outcome, FileIdeaInput,
    IdeaOutcomeInput,
};

/// Where workers queue what they could not write back.
pub fn replay_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".personas").join("replay"))
}

/// What one drain did. Counts, not files — the log carries the names.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DrainReport {
    /// Outcomes and filings the door accepted this drain.
    pub applied: usize,
    /// Outcomes the store already carried (replayed by hand, or by an earlier
    /// drain whose move failed). Filed under `applied/` without a second write.
    pub already_applied: usize,
    /// Files that could not be applied — moved to `rejected/` with a reason.
    pub rejected: usize,
    /// Files that are not the queue's business (scripts, notes) — left alone.
    pub ignored: usize,
}

impl DrainReport {
    /// True when the drain changed the store.
    pub fn wrote_anything(&self) -> bool {
        self.applied > 0
    }
}

/// Drain the operator's replay queue. Best-effort throughout: an unreadable
/// directory is an empty queue, never an error the caller has to handle.
pub fn drain(pool: &DbPool) -> DrainReport {
    match replay_dir() {
        Some(dir) => drain_dir(pool, &dir),
        None => DrainReport::default(),
    }
}

/// [`drain`] against an explicit directory — the testable core.
pub fn drain_dir(pool: &DbPool, dir: &Path) -> DrainReport {
    let mut report = DrainReport::default();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return report;
    };
    // Sorted so two outcomes for one idea apply in a stable order and the
    // log reads the same way the directory listing does.
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    files.sort();

    for path in files {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            report.ignored += 1;
            continue;
        };
        match classify_file(name) {
            QueuedFile::Outcome { idea_ref } => match apply_outcome(pool, &path, &idea_ref) {
                Ok(Applied::Fresh) => {
                    report.applied += 1;
                    file_away(&path, dir, "applied", None);
                }
                Ok(Applied::Already) => {
                    report.already_applied += 1;
                    file_away(&path, dir, "applied", None);
                }
                Err(reason) => {
                    report.rejected += 1;
                    tracing::warn!(file = %name, reason = %reason,
                        "replay_queue: outcome could not be applied");
                    file_away(&path, dir, "rejected", Some(&reason));
                }
            },
            QueuedFile::Idea => match apply_idea(pool, &path) {
                Ok(()) => {
                    report.applied += 1;
                    file_away(&path, dir, "applied", None);
                }
                Err(reason) => {
                    report.rejected += 1;
                    tracing::warn!(file = %name, reason = %reason,
                        "replay_queue: idea filing could not be applied");
                    file_away(&path, dir, "rejected", Some(&reason));
                }
            },
            QueuedFile::NotOurs => report.ignored += 1,
        }
    }
    if report.applied > 0 || report.rejected > 0 || report.already_applied > 0 {
        tracing::info!(
            applied = report.applied,
            already_applied = report.already_applied,
            rejected = report.rejected,
            dir = %dir.display(),
            "replay_queue: drained"
        );
    }
    report
}

#[derive(Debug, PartialEq, Eq)]
enum QueuedFile {
    Outcome { idea_ref: String },
    Idea,
    NotOurs,
}

/// Read the queue's naming convention. The idea reference in an outcome file
/// name is either a whole UUID or the leading run of it the worker chose to
/// type — `outcome-2e06b79c-declined.json` names idea `2e06b79c…`, and the
/// `-declined` is the worker's own annotation.
fn classify_file(name: &str) -> QueuedFile {
    let Some(stem) = name.strip_suffix(".json") else {
        return QueuedFile::NotOurs;
    };
    if stem.starts_with("idea-") {
        return QueuedFile::Idea;
    }
    let Some(rest) = stem.strip_prefix("outcome-") else {
        return QueuedFile::NotOurs;
    };
    if rest.is_empty() {
        return QueuedFile::NotOurs;
    }
    // A full UUID first: its own hyphens must not be read as the annotation.
    if rest.len() >= 36 && looks_like_uuid(&rest[..36]) {
        return QueuedFile::Outcome {
            idea_ref: rest[..36].to_string(),
        };
    }
    let idea_ref = rest.split('-').next().unwrap_or("").to_string();
    if idea_ref.is_empty() {
        return QueuedFile::NotOurs;
    }
    QueuedFile::Outcome { idea_ref }
}

fn looks_like_uuid(s: &str) -> bool {
    s.len() == 36
        && s.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

enum Applied {
    Fresh,
    Already,
}

fn apply_outcome(pool: &DbPool, path: &Path, idea_ref: &str) -> Result<Applied, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("unreadable: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("not JSON: {e}"))?;
    // A body that names its idea wins over the file name — it is the more
    // deliberate of the two.
    let body_ref = value
        .get("idea_id")
        .or_else(|| value.get("ideaId"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let idea_ref = body_ref.unwrap_or(idea_ref);
    let input: IdeaOutcomeInput =
        serde_json::from_value(value.clone()).map_err(|e| format!("not an outcome body: {e}"))?;

    let idea = crate::db::repos::dev::ideas::find_idea_by_id_or_prefix(pool, idea_ref)
        .map_err(|e| format!("idea lookup failed: {e}"))?
        .ok_or_else(|| format!("no idea matches `{idea_ref}` (or more than one does)"))?;

    if outcome_already_recorded(pool, &idea.id, input.outcome.trim())
        .map_err(|e| format!("task lookup failed: {e}"))?
    {
        return Ok(Applied::Already);
    }
    record_idea_outcome(pool, &idea.id, &input)
        .map(|_| Applied::Fresh)
        .map_err(|e| format!("write-back door refused it: {e}"))
}

fn apply_idea(pool: &DbPool, path: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("unreadable: {e}"))?;
    let input: FileIdeaInput =
        serde_json::from_str(&text).map_err(|e| format!("not an idea filing: {e}"))?;
    // The door dedups by key, so a filing replayed twice creates one row.
    file_backlog_idea(pool, &input)
        .map(|_| ())
        .map_err(|e| format!("filing door refused it: {e}"))
}

/// Move a drained file under `<dir>/<bucket>/`, with an optional reason
/// beside it. A move that fails is logged and the file stays; the next drain
/// sees it again, which is safe because both doors are idempotent.
fn file_away(path: &Path, dir: &Path, bucket: &str, reason: Option<&str>) {
    let Some(name) = path.file_name() else { return };
    let target_dir = dir.join(bucket);
    if let Err(e) = std::fs::create_dir_all(&target_dir) {
        tracing::warn!(error = %e, bucket, "replay_queue: could not create bucket");
        return;
    }
    let target = target_dir.join(name);
    if let Err(e) = std::fs::rename(path, &target) {
        tracing::warn!(error = %e, file = %path.display(), "replay_queue: could not file away");
        return;
    }
    if let Some(reason) = reason {
        let mut sidecar = target.clone();
        let sidecar_name = format!("{}.reason.txt", name.to_string_lossy());
        sidecar.set_file_name(sidecar_name);
        if let Err(e) = std::fs::write(&sidecar, reason) {
            tracing::warn!(error = %e, "replay_queue: could not write the rejection reason");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::repos::dev::tasks;

    fn seed(pool: &DbPool) -> (String, String) {
        let project = crate::db::repos::dev_tools::create_project(
            pool,
            "replay",
            "/tmp/replay-queue",
            None,
            None,
            None,
            None,
            None,
        )
        .expect("project");
        let idea = crate::db::repos::dev_tools::create_idea(
            pool,
            Some(&project.id),
            None,
            "backlog",
            None,
            "Drain the replay queue",
            None,
            None,
            Some("accepted"),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("idea");
        (project.id, idea.id)
    }

    fn queue_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    #[test]
    fn file_names_follow_the_workers_convention() {
        assert_eq!(
            classify_file("outcome-2e06b79c-declined.json"),
            QueuedFile::Outcome {
                idea_ref: "2e06b79c".into()
            }
        );
        assert_eq!(
            classify_file("outcome-2ea07961.json"),
            QueuedFile::Outcome {
                idea_ref: "2ea07961".into()
            }
        );
        assert_eq!(
            classify_file("outcome-2ea07961-63a9-44d7-b529-4e59d635e062-delivered.json"),
            QueuedFile::Outcome {
                idea_ref: "2ea07961-63a9-44d7-b529-4e59d635e062".into()
            }
        );
        assert_eq!(
            classify_file("idea-empty-sentinel-class.json"),
            QueuedFile::Idea
        );
        assert_eq!(
            classify_file("replay-2026-09-10-bank-contracts-branch-19.sh"),
            QueuedFile::NotOurs
        );
        assert_eq!(classify_file("outcome-.json"), QueuedFile::NotOurs);
    }

    #[test]
    fn a_queued_outcome_reaches_the_idea_by_prefix_and_is_filed_once() {
        let pool = init_test_db().unwrap();
        let (_pid, idea_id) = seed(&pool);
        let dir = queue_dir();
        let name = format!("outcome-{}-declined.json", &idea_id[..8]);
        std::fs::write(
            dir.path().join(&name),
            r#"{"outcome":"declined","note":"already built on main"}"#,
        )
        .unwrap();

        let report = drain_dir(&pool, dir.path());
        assert_eq!(report.applied, 1, "{report:?}");
        assert!(dir.path().join("applied").join(&name).is_file());
        assert!(!dir.path().join(&name).exists());

        let idea = crate::db::repos::dev::ideas::get_idea_by_id(&pool, &idea_id).unwrap();
        assert_eq!(idea.status, "rejected");
        let task = tasks::latest_task_for_idea(&pool, &idea_id)
            .unwrap()
            .unwrap();
        assert_eq!(task.status, "cancelled", "declined maps onto cancelled");
        assert!(task
            .description
            .as_deref()
            .unwrap_or("")
            .contains("App Master outcome: declined"));

        // Drained again with the same file queued (a human re-queued it, or a
        // move failed): the store already carries it, so nothing is written twice.
        std::fs::write(
            dir.path().join(&name),
            r#"{"outcome":"declined","note":"already built on main"}"#,
        )
        .unwrap();
        let again = drain_dir(&pool, dir.path());
        assert_eq!(again.applied, 0);
        assert_eq!(again.already_applied, 1);
        let task = tasks::latest_task_for_idea(&pool, &idea_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            task.description
                .as_deref()
                .unwrap_or("")
                .matches("App Master outcome: declined")
                .count(),
            1,
            "the outcome block is appended once"
        );
    }

    #[test]
    fn an_outcome_nobody_can_place_is_rejected_with_its_reason_and_scripts_are_left_alone() {
        let pool = init_test_db().unwrap();
        seed(&pool);
        let dir = queue_dir();
        std::fs::write(
            dir.path().join("outcome-ffffffff.json"),
            r#"{"outcome":"delivered"}"#,
        )
        .unwrap();
        std::fs::write(dir.path().join("replay-branch-19.sh"), "#!/bin/sh\n").unwrap();
        std::fs::write(dir.path().join("outcome-garbage.json"), "not json").unwrap();

        let report = drain_dir(&pool, dir.path());
        assert_eq!(report.rejected, 2, "{report:?}");
        assert_eq!(report.ignored, 1);
        assert!(dir.path().join("replay-branch-19.sh").is_file());
        let rejected = dir.path().join("rejected");
        assert!(rejected.join("outcome-ffffffff.json").is_file());
        let reason =
            std::fs::read_to_string(rejected.join("outcome-ffffffff.json.reason.txt")).unwrap();
        assert!(reason.contains("no idea matches"), "{reason}");
    }

    #[test]
    fn a_queued_idea_filing_is_filed_and_deduped() {
        let pool = init_test_db().unwrap();
        let (pid, _idea) = seed(&pool);
        let dir = queue_dir();
        let body = format!(
            r#"{{"project_id":"{pid}","title":"Nothing refuses an empty value","description":"found by back-checking","risk":2}}"#
        );
        std::fs::write(dir.path().join("idea-empty-sentinel.json"), &body).unwrap();
        assert_eq!(drain_dir(&pool, dir.path()).applied, 1);
        std::fs::write(dir.path().join("idea-empty-sentinel.json"), &body).unwrap();
        assert_eq!(drain_dir(&pool, dir.path()).applied, 1);
        let ideas =
            crate::db::repos::dev::ideas::list_ideas(&pool, Some(&pid), None, None, None, None)
                .unwrap();
        assert_eq!(
            ideas
                .iter()
                .filter(|i| i.title == "Nothing refuses an empty value")
                .count(),
            1,
            "the door's dedup guard holds across a replay"
        );
    }

    #[test]
    fn a_missing_queue_is_an_empty_queue() {
        let pool = init_test_db().unwrap();
        let report = drain_dir(&pool, Path::new("/definitely/not/here"));
        assert_eq!(report, DrainReport::default());
    }
}
