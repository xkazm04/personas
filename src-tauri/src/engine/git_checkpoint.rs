//! Git checkpoint-per-stage for the dev-tools plugin (fabro F5 lesson).
//!
//! Personas' dev-tools plugin runs agents in real git repositories with zero
//! checkpointing — a run that goes sideways mid-task has no clean rewind. Fabro
//! commits each stage to a per-run branch, enabling rollback and fork-a-new-
//! attempt-from-here with plain git. This module ports the run-branch half (the
//! stage→SHA index lives in SQLite, not a second git branch): each checkpoint is
//! a commit on `personas/run/<run_id>` with trailers carrying the run id + stage.
//!
//! All operations shell out to the real `git` binary with auto-maintenance and
//! signing disabled so checkpoints stay fast and deterministic inside an agent
//! workspace.

use std::path::Path;

use tokio::process::Command;

/// Flags that keep checkpoint commits fast + deterministic in an agent workspace.
const HARDENING: &[&str] = &[
    "-c",
    "maintenance.auto=0",
    "-c",
    "gc.auto=0",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
];

fn branch_name(run_id: &str) -> String {
    format!("personas/run/{run_id}")
}

async fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd.args(HARDENING);
    cmd.args(args);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let out = cmd
        .output()
        .await
        .map_err(|e| format!("failed to run git {args:?}: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Commit the current working tree as a checkpoint on the run branch and return
/// the commit SHA. Creates/switches to `personas/run/<run_id>` on first call.
/// Returns `Ok(None)` when there is nothing to commit (clean tree).
pub async fn checkpoint_stage(
    dir: &Path,
    run_id: &str,
    stage: &str,
    status: &str,
) -> Result<Option<String>, String> {
    let branch = branch_name(run_id);

    // Switch to (or create) the run branch without disturbing the working tree.
    if git(dir, &["rev-parse", "--verify", "--quiet", &branch]).await.is_ok() {
        git(dir, &["checkout", &branch]).await?;
    } else {
        git(dir, &["checkout", "-B", &branch]).await?;
    }

    git(dir, &["add", "-A"]).await?;

    // Nothing staged → nothing to checkpoint.
    if git(dir, &["diff", "--cached", "--quiet"]).await.is_ok() {
        return Ok(None);
    }

    let subject = format!("personas({run_id}): {stage} ({status})");
    let trailer = format!("Personas-Run: {run_id}\nPersonas-Stage: {stage}");
    git(dir, &["commit", "--no-verify", "-m", &subject, "-m", &trailer]).await?;

    let sha = git(dir, &["rev-parse", "HEAD"]).await?;
    Ok(Some(sha))
}

/// Non-disruptive checkpoint for a **live** repo the user is actively working in.
/// Captures the working tree as a dangling commit via `git stash create` — which
/// does NOT touch HEAD, the index, or the working tree — and keeps it reachable
/// under `refs/personas/checkpoints/<run_id>/<checkpoint_id>` (invisible to
/// `git branch`/`status`). Returns the snapshot SHA, or `None` when the tree is
/// clean. Use this (not [`checkpoint_stage`], which switches branches) for
/// auto-checkpointing inside a repo the user owns.
///
/// Limitation: `git stash create` captures tracked changes only, not untracked
/// files — acceptable for a non-disruptive snapshot; noted for future work.
pub async fn snapshot_stage(
    dir: &Path,
    run_id: &str,
    checkpoint_id: &str,
) -> Result<Option<String>, String> {
    let sha = git(dir, &["stash", "create", &format!("personas checkpoint {run_id}")]).await?;
    if sha.is_empty() {
        return Ok(None); // clean tree — nothing to snapshot
    }
    let refname = format!("refs/personas/checkpoints/{run_id}/{checkpoint_id}");
    git(dir, &["update-ref", &refname, &sha]).await?;
    Ok(Some(sha))
}

/// Create a fresh run branch from a checkpoint SHA (fork-a-new-attempt). Verifies
/// the SHA is an ancestor of the current branch tip before forking.
pub async fn fork_from_checkpoint(
    dir: &Path,
    sha: &str,
    new_run_id: &str,
) -> Result<(), String> {
    // Ancestry guard: refuse to fork from a SHA not reachable from HEAD.
    git(dir, &["merge-base", "--is-ancestor", sha, "HEAD"])
        .await
        .map_err(|_| format!("checkpoint {sha} is not an ancestor of HEAD"))?;
    git(dir, &["checkout", "-B", &branch_name(new_run_id), sha]).await?;
    Ok(())
}

/// Hard-reset the working tree to a checkpoint SHA (rollback).
pub async fn rollback_to(dir: &Path, sha: &str) -> Result<(), String> {
    git(dir, &["reset", "--hard", sha]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn init_repo(dir: &Path) {
        git(dir, &["init", "-q"]).await.unwrap();
        git(dir, &["config", "user.email", "t@t.test"]).await.unwrap();
        git(dir, &["config", "user.name", "test"]).await.unwrap();
        tokio::fs::write(dir.join("seed.txt"), "seed").await.unwrap();
        git(dir, &["add", "-A"]).await.unwrap();
        git(dir, &["commit", "--no-verify", "-m", "seed"]).await.unwrap();
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        // Deterministic per-test path under the OS temp dir (no Date/random).
        let d = std::env::temp_dir().join(format!("personas_ckpt_{tag}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[tokio::test]
    async fn checkpoint_creates_commit_and_rollback_restores() {
        let dir = temp_dir("ckpt");
        init_repo(&dir).await;

        tokio::fs::write(dir.join("work.txt"), "v1").await.unwrap();
        let sha1 = checkpoint_stage(&dir, "run1", "implement", "succeeded")
            .await
            .unwrap()
            .expect("expected a checkpoint commit");
        assert_eq!(sha1.len(), 40, "expected a full SHA: {sha1}");

        tokio::fs::write(dir.join("work.txt"), "v2-broken").await.unwrap();
        checkpoint_stage(&dir, "run1", "verify", "failed").await.unwrap();

        // Roll back to the good checkpoint.
        rollback_to(&dir, &sha1).await.unwrap();
        let restored = tokio::fs::read_to_string(dir.join("work.txt")).await.unwrap();
        assert_eq!(restored, "v1", "rollback should restore the checkpointed content");
    }

    #[tokio::test]
    async fn clean_tree_yields_no_checkpoint() {
        let dir = temp_dir("clean");
        init_repo(&dir).await;
        let r = checkpoint_stage(&dir, "run2", "noop", "succeeded").await.unwrap();
        assert!(r.is_none(), "clean tree should produce no checkpoint");
    }

    #[tokio::test]
    async fn fork_rejects_non_ancestor() {
        let dir = temp_dir("fork");
        init_repo(&dir).await;
        // A bogus all-zero SHA is not an ancestor.
        let err = fork_from_checkpoint(&dir, "0000000000000000000000000000000000000000", "run3").await;
        assert!(err.is_err(), "fork from non-ancestor should fail");
    }

    #[tokio::test]
    async fn snapshot_is_non_disruptive() {
        let dir = temp_dir("snap");
        init_repo(&dir).await;
        let branch_before = git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).await.unwrap();
        let head_before = git(&dir, &["rev-parse", "HEAD"]).await.unwrap();

        tokio::fs::write(dir.join("seed.txt"), "modified").await.unwrap();
        let sha = snapshot_stage(&dir, "run9", "ckpt9").await.unwrap().expect("snapshot of dirty tree");
        assert_eq!(sha.len(), 40);

        // HEAD, branch, and working tree must all be untouched.
        assert_eq!(git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).await.unwrap(), branch_before);
        assert_eq!(git(&dir, &["rev-parse", "HEAD"]).await.unwrap(), head_before);
        assert_eq!(tokio::fs::read_to_string(dir.join("seed.txt")).await.unwrap(), "modified");

        // The hidden ref keeps the snapshot reachable.
        let refsha = git(&dir, &["rev-parse", "refs/personas/checkpoints/run9/ckpt9"]).await.unwrap();
        assert_eq!(refsha, sha);
    }

    #[tokio::test]
    async fn snapshot_clean_tree_is_none() {
        let dir = temp_dir("snapclean");
        init_repo(&dir).await;
        assert!(snapshot_stage(&dir, "run10", "c10").await.unwrap().is_none());
    }
}
