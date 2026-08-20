//! Bring a knowledge-registry working copy up to date with its remote.
//!
//! ## Why this is an error-first command, not a background refresh
//!
//! Everything downstream of the library assumes the clone is current. The drift
//! model now distinguishes `stale` from `diverged` by comparing against the
//! source on disk — so a clone that is behind its remote makes that model
//! *confidently wrong*: it reports "in sync" against a library that moved weeks
//! ago. A share commits onto the clone; committing onto a stale one puts a
//! branch on top of history the remote has already advanced past.
//!
//! So every condition that prevents a clean sync is an **error the operator
//! reviews**, never a silent skip:
//!
//! - the remote is unreachable → connectivity or the mapping is wrong, and both
//!   are things a person fixes, not something to retry around;
//! - the working copy is dirty, or the branch carries local commits → someone is
//!   mid-work in a directory several sessions and both apps share, and moving it
//!   under them is exactly the class of damage this system exists to avoid.
//!
//! ## Fast-forward only
//!
//! Never merge, never rebase, never stash. A fast-forward cannot lose work and
//! cannot produce a conflict; anything that could is refused and reported. That
//! is the whole safety argument, and it is why the dirty and diverged cases are
//! errors rather than "we handled it".

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::validation::require_non_empty;
use crate::AppState;

/// Outcome of a successful sync. Every failure is an `Err`, so this type has no
/// "it did not work" variant to ignore.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySync {
    /// `up_to_date` or `fast_forwarded` — the only two ways this returns Ok.
    pub state: String,
    /// Branch the clone is on.
    pub branch: String,
    /// Commit before the sync.
    pub local_before: String,
    /// Commit after it (equal to `local_before` when already current).
    pub head: String,
    /// How many commits were taken. Zero when already up to date.
    pub commits: u32,
}

/// Run a git subcommand in `dir`, returning `(success, stdout, stderr)`.
fn git(dir: &Path, args: &[&str]) -> Result<(bool, String, String), AppError> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| {
            AppError::Execution(format!(
                "git is not available on this machine ({e}) — a registry clone cannot be synced without it"
            ))
        })?;
    Ok((
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).trim().to_string(),
        String::from_utf8_lossy(&out.stderr).trim().to_string(),
    ))
}

/// Fast-forward a registry working copy to its remote.
///
/// Errors — each one naming what a person should look at:
/// not a directory · not a git repo · no `origin` · unreachable remote ·
/// dirty working copy · branch not an ancestor of the remote.
#[tauri::command]
pub fn dev_tools_registry_sync(
    state: State<'_, Arc<AppState>>,
    clone_path: String,
) -> Result<RegistrySync, AppError> {
    require_auth_sync(&state)?;
    sync_clone(&clone_path)
}

/// The whole command minus the IPC shell, so every refusal above is reachable
/// from a test. A gate nobody can fault-inject is a gate nobody has checked.
fn sync_clone(clone_path: &str) -> Result<RegistrySync, AppError> {
    // The shared vocabulary owns "this input is blank" — open-coding it here
    // would throw away the field identity and leave only a sentence.
    require_non_empty("clonePath", clone_path)?;

    let dir = PathBuf::from(clone_path.trim());
    if !dir.is_dir() {
        return Err(AppError::Validation(format!(
            "No registry working copy at \"{}\". Re-pair the registry, or point it at an existing clone.",
            dir.display()
        )));
    }

    let (is_repo, _, _) = git(&dir, &["rev-parse", "--is-inside-work-tree"])?;
    if !is_repo {
        return Err(AppError::Validation(format!(
            "\"{}\" is not a git working copy. The registry is a repository — pair it with a clone, not a plain folder.",
            dir.display()
        )));
    }

    // Dirty first. Reporting "unreachable" for a tree we were never going to
    // touch would send someone to debug their network over a local edit.
    let (_, dirty, _) = git(&dir, &["status", "--porcelain"])?;
    if !dirty.is_empty() {
        let n = dirty.lines().count();
        return Err(AppError::Validation(format!(
            "The registry working copy has {n} uncommitted change(s). Sync only fast-forwards, so it will not move a tree someone is working in — commit or revert them first.\n{}",
            dirty.lines().take(5).collect::<Vec<_>>().join("\n")
        )));
    }

    let (_, branch, _) = git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if branch.is_empty() || branch == "HEAD" {
        return Err(AppError::Validation(
            "The registry working copy is not on a branch (detached HEAD). Check out its default branch before syncing.".into(),
        ));
    }

    let (has_origin, _, _) = git(&dir, &["remote", "get-url", "origin"])?;
    if !has_origin {
        return Err(AppError::Validation(
            "The registry working copy has no `origin` remote, so there is nothing to sync from. Re-pair the registry against its repository.".into(),
        ));
    }

    // The network step. Its stderr is the most useful thing we can hand back —
    // auth, DNS and a wrong repo name all look different in it.
    let (fetched, _, fetch_err) = git(&dir, &["fetch", "origin", &branch])?;
    if !fetched {
        return Err(AppError::Execution(format!(
            "Could not reach the registry remote. Check the connection, and that the mapped repository still exists and is readable with this credential.\n{fetch_err}"
        )));
    }

    let (_, local_before, _) = git(&dir, &["rev-parse", "HEAD"])?;
    let (_, remote, _) = git(&dir, &["rev-parse", "FETCH_HEAD"])?;

    if local_before == remote {
        return Ok(RegistrySync {
            state: "up_to_date".into(),
            branch,
            head: local_before.clone(),
            local_before,
            commits: 0,
        });
    }

    // Ancestor check BEFORE the merge, so the refusal explains itself instead of
    // surfacing as a git error nobody reads.
    let (is_ancestor, _, _) = git(&dir, &["merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"])?;
    if !is_ancestor {
        let (_, ahead, _) = git(&dir, &["rev-list", "--count", "FETCH_HEAD..HEAD"])?;
        return Err(AppError::Validation(format!(
            "The registry working copy has {} commit(s) the remote does not, so it cannot be fast-forwarded. Push or drop them before syncing — this never rebases or stashes a shared clone.",
            if ahead.is_empty() { "local".into() } else { ahead }
        )));
    }

    let (_, count, _) = git(&dir, &["rev-list", "--count", "HEAD..FETCH_HEAD"])?;
    let (merged, _, merge_err) = git(&dir, &["merge", "--ff-only", "FETCH_HEAD"])?;
    if !merged {
        return Err(AppError::Execution(format!(
            "The fast-forward failed even though the remote is ahead. The working copy may have changed since this check started.\n{merge_err}"
        )));
    }

    let (_, head, _) = git(&dir, &["rev-parse", "HEAD"])?;
    Ok(RegistrySync {
        state: "fast_forwarded".into(),
        branch,
        local_before,
        head,
        commits: count.parse().unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// Run git in `dir`, panicking with its stderr — a silently failed setup step
    /// would make these tests assert against a repo that is not what they think.
    fn g(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git must be available to run these tests");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn commit(dir: &Path, name: &str, body: &str) {
        std::fs::write(dir.join(name), body).unwrap();
        g(dir, &["add", name]);
        g(dir, &["commit", "-m", &format!("add {name}")]);
    }

    /// A bare "remote" plus a clone of it, both local — so these tests exercise
    /// real fetch/merge plumbing with no network.
    fn remote_and_clone() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let origin = root.path().join("origin.git");
        let seed = root.path().join("seed");
        let clone = root.path().join("clone");

        std::fs::create_dir_all(&origin).unwrap();
        g(&origin, &["init", "--bare", "--initial-branch=main"]);

        std::fs::create_dir_all(&seed).unwrap();
        g(&seed, &["init", "--initial-branch=main"]);
        g(&seed, &["config", "user.email", "t@example.invalid"]);
        g(&seed, &["config", "user.name", "T"]);
        commit(&seed, "a.md", "one\n");
        g(&seed, &["remote", "add", "origin", origin.to_str().unwrap()]);
        g(&seed, &["push", "origin", "main"]);

        let out = Command::new("git")
            .args(["clone", origin.to_str().unwrap(), clone.to_str().unwrap()])
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        g(&clone, &["config", "user.email", "t@example.invalid"]);
        g(&clone, &["config", "user.name", "T"]);

        (root, seed, clone)
    }

    /// Advance the remote by one commit, via the seed working copy.
    fn advance_remote(seed: &Path) {
        commit(seed, "b.md", "two\n");
        g(seed, &["push", "origin", "main"]);
    }

    #[test]
    fn a_current_clone_reports_up_to_date_and_moves_nothing() {
        let (_root, _seed, clone) = remote_and_clone();
        let before = std::fs::read_dir(&clone).unwrap().count();
        let r = sync_clone(clone.to_str().unwrap()).expect("a current clone must sync cleanly");
        assert_eq!(r.state, "up_to_date");
        assert_eq!(r.commits, 0);
        assert_eq!(r.local_before, r.head, "up_to_date must not move HEAD");
        assert_eq!(std::fs::read_dir(&clone).unwrap().count(), before);
    }

    #[test]
    fn a_behind_clone_fast_forwards_and_the_new_files_land() {
        // The point of the whole command: a scan that runs after this sees the
        // library the remote has, not the one it had at clone time.
        let (_root, seed, clone) = remote_and_clone();
        advance_remote(&seed);
        assert!(!clone.join("b.md").exists(), "precondition: the clone is behind");

        let r = sync_clone(clone.to_str().unwrap()).expect("a behind clone must fast-forward");
        assert_eq!(r.state, "fast_forwarded");
        assert_eq!(r.commits, 1);
        assert_ne!(r.local_before, r.head);
        assert!(clone.join("b.md").exists(), "the fetched commit must be checked out");
    }

    #[test]
    fn an_unreachable_remote_is_an_error_not_a_silent_skip() {
        // The user's rule: a scan must never quietly proceed against a clone we
        // could not confirm is current.
        let (_root, _seed, clone) = remote_and_clone();
        g(&clone, &["remote", "set-url", "origin", "https://127.0.0.1:1/nope.git"]);
        let err = sync_clone(clone.to_str().unwrap()).expect_err("unreachable must fail");
        let msg = err.to_string();
        assert!(
            msg.contains("Could not reach"),
            "the message must point at connectivity/mapping, got: {msg}"
        );
    }

    #[test]
    fn a_dirty_working_copy_is_refused_before_any_network_call() {
        // Refused rather than stashed: this directory is shared with other
        // sessions and with Ascent, and moving it under them is the damage.
        let (_root, _seed, clone) = remote_and_clone();
        std::fs::write(clone.join("a.md"), "edited in place\n").unwrap();
        let err = sync_clone(clone.to_str().unwrap()).expect_err("a dirty tree must fail");
        let msg = err.to_string();
        assert!(msg.contains("uncommitted"), "got: {msg}");
        assert_eq!(
            std::fs::read_to_string(clone.join("a.md")).unwrap(),
            "edited in place\n",
            "the refusal must leave the edit untouched"
        );
    }

    #[test]
    fn local_commits_are_refused_rather_than_rebased() {
        let (_root, seed, clone) = remote_and_clone();
        advance_remote(&seed);
        commit(&clone, "mine.md", "local work\n");
        let head_before = {
            let out = Command::new("git").arg("-C").arg(&clone).args(["rev-parse", "HEAD"]).output().unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };

        let err = sync_clone(clone.to_str().unwrap()).expect_err("diverged must fail");
        assert!(err.to_string().contains("cannot be fast-forwarded"), "got: {err}");

        let head_after = {
            let out = Command::new("git").arg("-C").arg(&clone).args(["rev-parse", "HEAD"]).output().unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        assert_eq!(head_before, head_after, "a refusal must not move HEAD");
        assert!(clone.join("mine.md").exists(), "local work must survive the refusal");
    }

    #[test]
    fn a_clone_without_an_origin_names_the_mapping_not_the_network() {
        let (_root, _seed, clone) = remote_and_clone();
        g(&clone, &["remote", "remove", "origin"]);
        let err = sync_clone(clone.to_str().unwrap()).expect_err("no origin must fail");
        assert!(err.to_string().contains("no `origin`"), "got: {err}");
    }

    #[test]
    fn a_plain_directory_is_not_a_registry_working_copy() {
        let dir = tempfile::tempdir().unwrap();
        let err = sync_clone(dir.path().to_str().unwrap()).expect_err("a non-repo must fail");
        assert!(err.to_string().contains("not a git working copy"), "got: {err}");
    }

    #[test]
    fn a_missing_path_is_reported_as_missing() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("no-such-clone");
        let err = sync_clone(gone.to_str().unwrap()).expect_err("a missing path must fail");
        assert!(err.to_string().contains("No registry working copy"), "got: {err}");
        // An empty path is the "never paired" case and must not read as cwd.
        assert!(sync_clone("   ").is_err(), "an empty path must never resolve");
    }
}
