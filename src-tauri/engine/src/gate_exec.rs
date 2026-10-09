//! **Gate execution, without a ledger.** Run a repository's own commands
//! against one revision in a throwaway detached worktree, timed, and hand back
//! raw results. Recording is the caller's business.
//!
//! Extracted from [`crate::app_master_gates`] (spark lifecycle-health WP1) so
//! two instruments share ONE runner instead of forking it:
//!
//! - the App Master's proposal / baseline gates, which record into
//!   `app_master_gate_runs` with its three-valued `passed | failed |
//!   did_not_run` vocabulary (a timeout is `did_not_run` there);
//! - Lifecycle's Measure, which records into `dev_lifecycle_runs` and keeps a
//!   timeout distinct from a command that never started.
//!
//! The behaviour every caller inherits, unchanged from the App Master path:
//! the worktree is created detached at `rev` (so no branch is checked out
//! under a concurrent session), it **borrows** the source checkout's installed
//! dependencies ([`borrow_installed_deps`]) and copies its env files, each
//! command runs through the platform shell with `CI=1` and the parent
//! environment, a command that obviously needs a dependency the source
//! checkout lacks too is not run (`deps_missing:<dir>`), the borrowed links are
//! unlinked BEFORE the worktree is removed, and cleanup is best-effort.
//!
//! Timing endpoints: `started_at` is taken immediately before the child is
//! spawned and `finished_at` when it exits (or is abandoned at the timeout),
//! so `duration_ms` excludes worktree creation and dependency linking.
//!
//! **Observed and cancellable** ([`exec_in_worktree_with`]): a caller that
//! shows progress is told as each command starts and finishes, and a caller
//! that lets a person stop the run passes a [`CancellationToken`]. Cancel is
//! checked before each command and raced against the running child; the child
//! is abandoned exactly as at a timeout (its future is dropped and
//! `kill_on_drop` kills it), and the worktree is still cleaned up. Nothing is
//! reported for the abandoned command or the ones after it: the caller records
//! them. [`exec_in_worktree`] is the unobserved, never-cancelled form.

use std::path::Path;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use tokio_util::sync::CancellationToken;

use crate::app_master_gates::{
    borrow_installed_deps, deps_missing_for, first_error_line, git, unlink_borrowed,
};

/// How much command output a result keeps, in bytes: the tail of stdout, then
/// the tail of stderr. Enough for a coverage summary table, bounded so a
/// chatty suite cannot balloon memory.
pub const STDOUT_TAIL_BYTES: usize = 48 * 1024;
pub const STDERR_TAIL_BYTES: usize = 16 * 1024;

/// One command to run and how long it may take before it is abandoned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecCommand {
    pub command: String,
    pub timeout: Duration,
}

/// What happened to one command. A timeout and a command that never started
/// are distinct from each other and from a failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecStatus {
    Passed,
    Failed,
    /// The child was killed at its timeout.
    TimedOut,
    /// The command was never given a chance to answer: it could not be
    /// spawned or waited on, or it needs a dependency nobody installed.
    DidNotRun,
}

/// One command's raw result.
#[derive(Debug, Clone, PartialEq)]
pub struct CommandExec {
    pub command: String,
    pub status: ExecStatus,
    /// `None` unless the child exited on its own.
    pub exit_code: Option<i32>,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    pub duration_ms: u64,
    /// The first real error line (bounded) on a failure; the reason on a
    /// `DidNotRun` / `TimedOut`; `None` on a pass.
    pub first_error: Option<String>,
    /// The timeout the command ran under, for callers that word the reason.
    pub timeout: Duration,
    /// Tail of stdout followed by the tail of stderr (see the byte bounds
    /// above). Empty when the command produced nothing or never ran.
    pub output_tail: String,
}

/// What one worktree run produced.
#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeExec {
    /// Names linked or copied in from the source checkout.
    pub linked_deps: Vec<String>,
    /// One result per command that ran to an answer, in input order. Shorter
    /// than the input only when `cancelled`.
    pub results: Vec<CommandExec>,
    /// The run was cancelled: the command at `results.len()` was abandoned
    /// (or never started) and no command after it ran.
    pub cancelled: bool,
}

/// What [`exec_in_worktree_with`] reports as the run goes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ExecEvent<'a> {
    /// Command `index` (input order) is about to run.
    Started { index: usize, at: DateTime<Utc> },
    /// Command `index` answered; sent before the next command starts.
    Finished { index: usize, exec: &'a CommandExec },
}

/// Run `commands` against `rev` in a throwaway detached worktree of
/// `root_path`. `on_result` is called as each command finishes, before the
/// next one starts, so a caller can persist row by row. Never cancelled.
///
/// `Err(reason)` means the worktree itself could not be created and NOTHING
/// ran; the caller records every command as not run with that reason.
pub async fn exec_in_worktree<F>(
    root_path: &Path,
    rev: &str,
    commands: &[ExecCommand],
    temp_prefix: &str,
    mut on_result: F,
) -> Result<WorktreeExec, String>
where
    F: FnMut(&CommandExec),
{
    exec_in_worktree_with(
        root_path,
        rev,
        commands,
        temp_prefix,
        &CancellationToken::new(),
        |event| {
            if let ExecEvent::Finished { exec, .. } = event {
                on_result(exec);
            }
        },
    )
    .await
}

/// [`exec_in_worktree`], observed and cancellable: `on_event` hears each
/// command start and finish, and `cancel` stops the run (see the module doc).
/// A cancelled run returns `Ok` with `cancelled: true`.
pub async fn exec_in_worktree_with<F>(
    root_path: &Path,
    rev: &str,
    commands: &[ExecCommand],
    temp_prefix: &str,
    cancel: &CancellationToken,
    mut on_event: F,
) -> Result<WorktreeExec, String>
where
    F: FnMut(ExecEvent<'_>),
{
    let wt_dir = tempfile::Builder::new()
        .prefix(temp_prefix)
        .tempdir()
        .map_err(|e| format!("could not create a temp dir for the gate worktree: {e}"))?;
    let wt_path = wt_dir.path().join("wt");
    let wt_str = wt_path.to_string_lossy().to_string();

    git(root_path, &["worktree", "add", "--detach", &wt_str, rev]).await?;

    // The commands must see the repository's own resolved environment, so
    // borrow it rather than rebuild it.
    let borrowed = borrow_installed_deps(root_path, &wt_path);
    if !borrowed.linked.is_empty() {
        tracing::info!(
            rev,
            mechanism = borrowed.mechanism,
            "gate_exec: worktree borrowed the source checkout's environment ({}) - not rebuilt",
            borrowed.linked.join(", ")
        );
    }

    let mut results = Vec::with_capacity(commands.len());
    let mut cancelled = false;
    for (index, cmd) in commands.iter().enumerate() {
        if cancel.is_cancelled() {
            cancelled = true;
            break;
        }
        on_event(ExecEvent::Started {
            index,
            at: Utc::now(),
        });
        let result = match deps_missing_for(&cmd.command, &borrowed) {
            // The source checkout has no such dependency either. Installing it
            // is a different blast radius (network, minutes, a lockfile write),
            // so the command never ran, and says so.
            Some(dir) => {
                let now = Utc::now();
                CommandExec {
                    command: cmd.command.clone(),
                    status: ExecStatus::DidNotRun,
                    exit_code: None,
                    started_at: now,
                    finished_at: now,
                    duration_ms: 0,
                    first_error: Some(format!(
                        "deps_missing:{dir} — the source checkout has no {dir}/ to borrow into the \
                         gate worktree, and nothing was installed. Not a pass and not a failure."
                    )),
                    timeout: cmd.timeout,
                    output_tail: String::new(),
                }
            }
            // The cancel arm drops the child's future, which is the timeout
            // path's kill (`kill_on_drop`). A finished command wins a tie.
            None => {
                let answered = tokio::select! {
                    biased;
                    exec = exec_one(&cmd.command, &wt_path, cmd.timeout) => Some(exec),
                    _ = cancel.cancelled() => None,
                };
                let Some(exec) = answered else {
                    cancelled = true;
                    break;
                };
                exec
            }
        };
        on_event(ExecEvent::Finished {
            index,
            exec: &result,
        });
        results.push(result);
    }

    // Unlink the borrowed environment BEFORE the worktree is removed. A
    // recursive delete that walked into a junction would delete the operator's
    // real `node_modules`.
    for name in &borrowed.linked {
        unlink_borrowed(&wt_path, name);
    }

    // Best-effort cleanup - a leaked worktree is a mess, but a failed cleanup
    // must not lose the readings just taken.
    let _ = git(root_path, &["worktree", "remove", "--force", &wt_str]).await;
    let _ = git(root_path, &["worktree", "prune"]).await;
    drop(wt_dir);

    Ok(WorktreeExec {
        linked_deps: borrowed.linked,
        results,
        cancelled,
    })
}

/// Run one command in `cwd` under `timeout`.
async fn exec_one(command: &str, cwd: &Path, timeout: Duration) -> CommandExec {
    let started_at = Utc::now();
    let start = Instant::now();
    // The parent environment passes through (that is how the repository's own
    // toolchain is found), plus `CI=1` so Next/Vite/Jest-style tools take their
    // non-interactive path instead of asking a question nobody can answer.
    let mut child_cmd = if cfg!(target_os = "windows") {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", command]);
        c
    };
    let spawn = child_cmd
        .current_dir(cwd)
        .env("CI", "1")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // The timeout drops the child future; without this the timed-out
        // command would keep running unattended after it was recorded.
        .kill_on_drop(true)
        .spawn();

    let finish = |status: ExecStatus,
                  exit_code: Option<i32>,
                  first_error: Option<String>,
                  output_tail: String| CommandExec {
        command: command.to_string(),
        status,
        exit_code,
        started_at,
        finished_at: Utc::now(),
        duration_ms: start.elapsed().as_millis() as u64,
        first_error,
        timeout,
        output_tail,
    };

    let child = match spawn {
        Ok(c) => c,
        Err(e) => {
            return finish(
                ExecStatus::DidNotRun,
                None,
                Some(format!("could not spawn the gate command: {e}")),
                String::new(),
            )
        }
    };

    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Err(_) => finish(
            ExecStatus::TimedOut,
            None,
            Some(format!("timed out after {}s", timeout.as_secs())),
            String::new(),
        ),
        Ok(Err(e)) => finish(
            ExecStatus::DidNotRun,
            None,
            Some(format!("the gate command could not be waited on: {e}")),
            String::new(),
        ),
        Ok(Ok(out)) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let mut tail = tail_bytes(&stdout, STDOUT_TAIL_BYTES).to_string();
            let err_tail = tail_bytes(&stderr, STDERR_TAIL_BYTES);
            if !err_tail.is_empty() {
                tail.push('\n');
                tail.push_str(err_tail);
            }
            if out.status.success() {
                finish(ExecStatus::Passed, out.status.code(), None, tail)
            } else {
                finish(
                    ExecStatus::Failed,
                    out.status.code(),
                    first_error_line(&stdout, &stderr),
                    tail,
                )
            }
        }
    }
}

/// The last `max` bytes of `s`, cut forward to a char boundary.
fn tail_bytes(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    &s[start..]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git_ok(dir: &Path, args: &[&str]) -> bool {
        crate::git_checkpoint::run_git_blocking(dir, args).is_ok()
    }

    /// A one-commit repo, or `None` when git is unavailable.
    fn repo() -> Option<tempfile::TempDir> {
        let dir = tempfile::tempdir().ok()?;
        let p = dir.path();
        for args in [
            &["init", "--initial-branch=main"][..],
            &["config", "user.email", "t@example.com"],
            &["config", "user.name", "T"],
            &["config", "commit.gpgsign", "false"],
        ] {
            if !git_ok(p, args) {
                return None;
            }
        }
        std::fs::write(p.join("README.md"), "hi").ok()?;
        if !git_ok(p, &["add", "README.md"]) || !git_ok(p, &["commit", "-m", "init"]) {
            return None;
        }
        Some(dir)
    }

    fn cmd(command: &str, secs: u64) -> ExecCommand {
        ExecCommand {
            command: command.to_string(),
            timeout: Duration::from_secs(secs),
        }
    }

    #[test]
    fn tail_bytes_keeps_the_end_on_a_char_boundary() {
        assert_eq!(tail_bytes("abc", 10), "abc");
        assert_eq!(tail_bytes("abcdef", 3), "def");
        // "é" is two bytes; a cut inside it moves forward.
        assert_eq!(tail_bytes("aéb", 2), "b");
    }

    #[tokio::test]
    async fn passed_failed_and_timed_out_are_three_different_answers() {
        let Some(repo) = repo() else { return };
        let stall = if cfg!(target_os = "windows") {
            "ping -n 4 127.0.0.1 > NUL"
        } else {
            "sleep 3"
        };
        let mut seen = 0;
        let run = exec_in_worktree(
            repo.path(),
            "main",
            &[cmd("exit 0", 60), cmd("exit 3", 60), cmd(stall, 1)],
            "personas-gate-exec-test-",
            |_| seen += 1,
        )
        .await
        .expect("worktree");
        assert_eq!(seen, 3, "on_result fires once per command");
        let r = &run.results;
        assert_eq!(r[0].status, ExecStatus::Passed);
        assert_eq!(r[0].exit_code, Some(0));
        assert!(r[0].finished_at >= r[0].started_at);
        assert_eq!(r[1].status, ExecStatus::Failed);
        assert_eq!(r[1].exit_code, Some(3));
        assert_eq!(r[2].status, ExecStatus::TimedOut);
        assert!(r[2].exit_code.is_none());
        assert!(r[2].duration_ms >= 900, "timed at the child, not at setup");
    }

    #[tokio::test]
    async fn every_command_is_announced_before_it_answers() {
        let Some(repo) = repo() else { return };
        let mut events: Vec<(char, usize)> = Vec::new();
        let run = exec_in_worktree_with(
            repo.path(),
            "main",
            &[cmd("exit 0", 60), cmd("exit 2", 60)],
            "personas-gate-exec-test-",
            &CancellationToken::new(),
            |e| match e {
                ExecEvent::Started { index, .. } => events.push(('s', index)),
                ExecEvent::Finished { index, .. } => events.push(('f', index)),
            },
        )
        .await
        .expect("worktree");
        assert_eq!(events, vec![('s', 0), ('f', 0), ('s', 1), ('f', 1)]);
        assert!(!run.cancelled);
        assert_eq!(run.results.len(), 2);
    }

    #[tokio::test]
    async fn a_cancel_abandons_the_running_command_and_runs_no_more() {
        let Some(repo) = repo() else { return };
        let stall = if cfg!(target_os = "windows") {
            "ping -n 30 127.0.0.1 > NUL"
        } else {
            "sleep 30"
        };
        let cancel = CancellationToken::new();
        // Raised when the stalled command starts; the canceller waits on it.
        let stalled = tokio::sync::Notify::new();
        let mut started: Vec<usize> = Vec::new();
        let mut finished: Vec<usize> = Vec::new();
        let begun = Instant::now();
        let plan = [cmd("exit 0", 60), cmd(stall, 60), cmd("exit 0", 60)];
        let runner = exec_in_worktree_with(
            repo.path(),
            "main",
            &plan,
            "personas-gate-exec-test-",
            &cancel,
            |e| match e {
                ExecEvent::Started { index, .. } => {
                    started.push(index);
                    if index == 1 {
                        stalled.notify_one();
                    }
                }
                ExecEvent::Finished { index, .. } => finished.push(index),
            },
        );
        let canceller = async {
            stalled.notified().await;
            tokio::time::sleep(Duration::from_millis(300)).await;
            cancel.cancel();
        };
        let (run, ()) = tokio::join!(runner, canceller);
        let run = run.expect("worktree");
        assert!(run.cancelled);
        assert_eq!(started, vec![0, 1], "the third command never started");
        assert_eq!(finished, vec![0], "the abandoned command reports nothing");
        assert_eq!(run.results.len(), 1);
        assert!(
            begun.elapsed() < Duration::from_secs(20),
            "the stalled child was not waited out"
        );
    }

    #[tokio::test]
    async fn a_cancel_before_the_first_command_runs_nothing() {
        let Some(repo) = repo() else { return };
        let cancel = CancellationToken::new();
        cancel.cancel();
        let mut seen = 0;
        let run = exec_in_worktree_with(
            repo.path(),
            "main",
            &[cmd("exit 0", 60)],
            "personas-gate-exec-test-",
            &cancel,
            |_| seen += 1,
        )
        .await
        .expect("worktree");
        assert!(run.cancelled);
        assert!(run.results.is_empty());
        assert_eq!(seen, 0);
    }

    #[tokio::test]
    async fn a_missing_root_is_an_error_and_runs_nothing() {
        let dir = tempfile::tempdir().expect("tmp");
        let gone = dir.path().join("does-not-exist");
        let mut seen = 0;
        let out = exec_in_worktree(&gone, "main", &[cmd("exit 0", 5)], "p-", |_| seen += 1).await;
        assert!(out.is_err());
        assert_eq!(seen, 0);
    }
}
