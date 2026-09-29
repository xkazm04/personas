//! Per-turn version history for web-build projects (C7). Each build turn
//! snapshots the project onto a private ref; this lists those snapshots and
//! restores the working tree to one.
//!
//! Snapshots never touch the owner's branch, index or hooks. Studio also opens
//! repos it did not create (webbuild_register_existing), and a turn used to run
//! `git add -A` + `git commit --no-verify` there: the owner's unrelated work and
//! any untracked secret went into an "athena:" commit on their checked-out
//! branch, past their pre-commit checks. Every git call goes through the
//! engine's argv owner (`personas_engine::git_checkpoint`).

use crate::error::AppError;
use personas_engine::git_checkpoint::{run_git, run_git_blocking, snapshot_worktree};
use serde::Serialize;
use std::path::Path;
use ts_rs::TS;

/// Where build-turn snapshots live: invisible to `git branch` and `git status`,
/// and not sent by a default push.
pub const SNAPSHOT_REF: &str = "refs/athena/snapshots";

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BuildVersion {
    pub sha: String,
    pub message: String,
    pub when: String,
}

/// Snapshot the project's current state after a build turn. `Ok(None)` when it
/// is not a git repo or nothing changed since the last snapshot.
pub async fn commit_snapshot(
    project_dir: &Path,
    summary: &str,
) -> Result<Option<String>, AppError> {
    if run_git(project_dir, &["rev-parse", "--git-dir"])
        .await
        .is_err()
    {
        return Ok(None);
    }
    let first = summary.trim().lines().next().unwrap_or("build turn");
    let msg = format!("athena: {}", first.chars().take(72).collect::<String>());
    snapshot_worktree(project_dir, SNAPSHOT_REF, &msg)
        .await
        .map_err(|e| AppError::Internal(format!("snapshot the build turn: {e}")))
}

/// List recent turn snapshots (newest first, capped). Empty when not a repo.
/// A project snapshotted before the private ref existed lists its branch log.
pub fn list_versions(project_dir: &Path) -> Result<Vec<BuildVersion>, AppError> {
    let rev = if run_git_blocking(
        project_dir,
        &["rev-parse", "--verify", "--quiet", SNAPSHOT_REF],
    )
    .is_ok()
    {
        SNAPSHOT_REF
    } else {
        "HEAD"
    };
    let Ok(text) = run_git_blocking(
        project_dir,
        &[
            "log",
            "-n",
            "40",
            "--pretty=format:%h\u{1f}%s\u{1f}%cr",
            rev,
        ],
    ) else {
        return Ok(Vec::new());
    };
    let versions = text
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\u{1f}');
            let sha = parts.next()?.trim().to_string();
            if sha.is_empty() {
                return None;
            }
            Some(BuildVersion {
                sha,
                message: parts.next().unwrap_or("").trim().to_string(),
                when: parts.next().unwrap_or("").trim().to_string(),
            })
        })
        .collect();
    Ok(versions)
}

/// Restore the working tree to a prior snapshot (files only). The owner's index
/// and history are left alone, and `--overlay` never deletes a file: files
/// added after the snapshot stay (a deleting restore was declined in triage).
pub fn restore(project_dir: &Path, sha: &str) -> Result<(), AppError> {
    // Guard against arg injection — a git short-sha is hex-ish.
    if sha.is_empty() || sha.len() > 64 || !sha.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::Validation("invalid version id".into()));
    }
    run_git_blocking(
        project_dir,
        &[
            "restore",
            "--overlay",
            "--source",
            sha,
            "--worktree",
            "--",
            ".",
        ],
    )
    .map(|_| ())
    .map_err(|e| AppError::Internal(format!("restore version {sha}: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("personas_versions_{tag}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        for args in [
            &["init", "-q"][..],
            &["config", "user.email", "t@t.test"],
            &["config", "user.name", "test"],
        ] {
            run_git_blocking(&d, args).unwrap();
        }
        std::fs::write(d.join("page.tsx"), "v1").unwrap();
        run_git_blocking(&d, &["add", "-A"]).unwrap();
        run_git_blocking(&d, &["commit", "-q", "-m", "owner work"]).unwrap();
        d
    }

    #[tokio::test]
    async fn turns_are_listed_from_the_private_ref_and_restore_leaves_the_index_alone() {
        let d = repo("list_restore");
        let branch = run_git_blocking(&d, &["rev-parse", "HEAD"]).unwrap();
        std::fs::write(d.join("page.tsx"), "turn 1").unwrap();
        let first = commit_snapshot(&d, "Built the menu\nmore detail")
            .await
            .unwrap()
            .expect("a changed tree is snapshotted");
        std::fs::write(d.join("page.tsx"), "turn 2").unwrap();
        std::fs::write(d.join("later.tsx"), "added later").unwrap();
        commit_snapshot(&d, "Added a page").await.unwrap();

        // The owner's branch never moved; the turns are on the private ref.
        assert_eq!(
            run_git_blocking(&d, &["rev-parse", "HEAD"]).unwrap(),
            branch
        );
        let versions = list_versions(&d).unwrap();
        assert_eq!(versions[0].message, "athena: Added a page");
        assert_eq!(versions[1].message, "athena: Built the menu");

        let short = &first[..7];
        restore(&d, short).unwrap();
        assert_eq!(
            std::fs::read_to_string(d.join("page.tsx")).unwrap(),
            "turn 1"
        );
        // Overlay: nothing is deleted, and nothing was staged.
        assert!(d.join("later.tsx").exists());
        assert_eq!(
            run_git_blocking(&d, &["diff", "--cached", "--name-only"]).unwrap(),
            ""
        );
    }
}
