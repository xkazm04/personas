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
}
