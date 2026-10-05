//! Deterministic verification command (fabro F8 lesson).
//!
//! Fabro's `command` node runs a script (tests / lint / typecheck) in the run
//! sandbox and turns its **exit code** into a graph outcome, appending the last
//! few KB of output as the failure reason a downstream fix node reads. Personas'
//! existing `quality_gate` only pattern-matches output text; it cannot run a
//! deterministic check. This module is the missing primitive: run an
//! operator-configured command in the execution's working directory, capture its
//! exit code and a bounded output tail. The result feeds the F7 fix-loop.
//!
//! The command is operator-authored (a persona `verification_command` parameter),
//! so it inherits the host environment like any dev tool — it is trusted input,
//! unlike untrusted agent output.
//!
//! ## The second door: a detached operator server ([`spawn_detached`])
//!
//! Server control (Browser > Server control) runs a project's dev server from
//! an operator-configured command line (`npm run dev -- --port 3001`). Same
//! trust boundary as above, so it goes through the same shell vehicle rather
//! than opening a second one; what differs is the lifetime. A verification
//! command is a bounded child the caller waits on. A dev server must OUTLIVE
//! the app: no `kill_on_drop`, stdio null, its own process group, and on
//! Windows a breakaway from any job object the app was launched in (when the
//! job allows it). Its caller validates the command first (no `& | ; < >`,
//! backticks, `$`, parentheses, `%` or newlines), so the shell only ever sees
//! one simple command line, never a chain.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Last N bytes of combined output kept for the fix prompt.
pub const MAX_TAIL_BYTES: usize = 4096;

/// Outcome of running a verification command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationResult {
    /// Exit code 0 (and not timed out).
    pub passed: bool,
    /// Process exit code, when the process ran to completion.
    pub exit_code: Option<i32>,
    /// Last `MAX_TAIL_BYTES` of combined stdout+stderr (for the fix prompt).
    pub output_tail: String,
    /// The command exceeded its timeout and was killed.
    pub timed_out: bool,
}

impl VerificationResult {
    fn failure(output_tail: String) -> Self {
        Self {
            passed: false,
            exit_code: None,
            output_tail,
            timed_out: false,
        }
    }
}

/// Run `command` in `dir`, returning its pass/fail + a bounded output tail.
/// Uses the platform shell so operators can write natural command lines
/// (`npm test && tsc --noEmit`).
pub async fn run_verification(dir: &Path, command: &str, timeout: Duration) -> VerificationResult {
    let mut cmd = shell_command(command);
    cmd.current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return VerificationResult::failure(format!(
                "failed to spawn verification command: {e}"
            ))
        }
    };

    // Drain stdout+stderr CONCURRENTLY with the wait so a chatty command can't
    // deadlock on a full pipe buffer. (The previous code awaited wait() first
    // and only then read the pipes — a command emitting more than the ~64KB
    // pipe buffer blocked on write, wait() never returned, and every chatty
    // verification ran to its full timeout.)
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut out_buf = Vec::new();
    let mut err_buf = Vec::new();

    let run = async {
        let (status, (), ()) = tokio::join!(
            child.wait(),
            async {
                if let Some(mut out) = stdout.take() {
                    let _ = out.read_to_end(&mut out_buf).await;
                }
            },
            async {
                if let Some(mut err) = stderr.take() {
                    let _ = err.read_to_end(&mut err_buf).await;
                }
            },
        );
        status
    };

    let outcome = tokio::time::timeout(timeout, run).await;
    // `run` is dropped either way — safe to reclaim the (possibly partial) buffers.
    let mut combined = out_buf;
    combined.extend_from_slice(&err_buf);

    match outcome {
        Ok(Ok(status)) => {
            let code = status.code();
            VerificationResult {
                passed: code == Some(0),
                exit_code: code,
                output_tail: tail(&combined),
                timed_out: false,
            }
        }
        Ok(Err(e)) => VerificationResult::failure(format!("verification command I/O error: {e}")),
        Err(_) => {
            // Timed out — kill the child so it doesn't linger.
            let _ = child.start_kill();
            VerificationResult {
                passed: false,
                exit_code: None,
                output_tail: tail(&combined),
                timed_out: true,
            }
        }
    }
}

/// Variables of THIS process a detached server must not inherit. The app sets
/// its own bridge token on itself at boot (`boot::finalize`); a dev server is a
/// long-lived process running a repository's code and has no business holding it.
const DETACHED_SCRUBBED_ENV: &[&str] = &["PERSONAS_API_KEY"];

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(target_os = "windows")]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
/// `ERROR_ACCESS_DENIED`: what `CreateProcess` answers when the job object the
/// app runs in does not allow `CREATE_BREAKAWAY_FROM_JOB`.
#[cfg(target_os = "windows")]
const ERROR_ACCESS_DENIED: i32 = 5;

/// Start an operator-authored command as a long-lived, DETACHED process in
/// `dir` and return its handle immediately (see the module note).
///
/// The returned child is the shell (`cmd` / `sh`), the root of the tree the
/// caller later kills; it is never killed on drop, so dropping the handle, or
/// the whole app exiting, leaves the server running. `vars` are set on top of
/// the inherited environment (`PORT`), minus [`DETACHED_SCRUBBED_ENV`].
pub fn spawn_detached(
    dir: &Path,
    command: &str,
    vars: &[(&str, String)],
) -> std::io::Result<tokio::process::Child> {
    let mut cmd = shell_command(command);
    cmd.current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false)
        .envs(vars.iter().map(|(var, value)| (*var, value.as_str())));
    for var in DETACHED_SCRUBBED_ENV {
        cmd.env_remove(var);
    }
    #[cfg(unix)]
    {
        // Its own process group: a terminal's SIGINT/SIGHUP to the app's group
        // does not reach it, and the caller can kill the whole tree by group.
        cmd.process_group(0);
    }
    #[cfg(target_os = "windows")]
    {
        // A new process group keeps the app's console Ctrl+C away from it; the
        // breakaway takes it out of a job object whose closing would kill it.
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) if e.raw_os_error() == Some(ERROR_ACCESS_DENIED) => {
                // The job forbids breakaway. Spawn inside it: the server then
                // lives as long as that job, which is the best this host allows.
                cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
            }
            Err(e) => return Err(e),
        }
    }
    cmd.spawn()
}

fn shell_command(command: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        // `/S /C "<command>"`, appended RAW: with `/S`, cmd.exe strips exactly
        // the outer pair of quotes and runs the rest verbatim. Passing the
        // command through `.arg()` instead applies MSVCRT escaping (`\"`),
        // which cmd's own quote parser does not understand, so a command line
        // that itself contained a quoted argument reached the shell mangled.
        let mut c = Command::new("cmd");
        c.args(["/S", "/C"]).raw_arg(format!("\"{command}\""));
        c
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c
    }
}

/// Keep the last `MAX_TAIL_BYTES` of output, on a UTF-8 char boundary.
fn tail(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    if text.len() <= MAX_TAIL_BYTES {
        return text.into_owned();
    }
    let start = text.len() - MAX_TAIL_BYTES;
    // Advance to the next char boundary so we never split a multi-byte char.
    let idx = personas_core::utils::text::ceil_char_boundary(&text, start);
    format!("…{}", &text[idx..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn passing_command_passes() {
        let dir = std::env::temp_dir();
        let r = run_verification(&dir, "exit 0", Duration::from_secs(10)).await;
        assert!(r.passed);
        assert_eq!(r.exit_code, Some(0));
        assert!(!r.timed_out);
    }

    #[tokio::test]
    async fn failing_command_fails_with_code() {
        let dir = std::env::temp_dir();
        let r = run_verification(&dir, "exit 7", Duration::from_secs(10)).await;
        assert!(!r.passed);
        assert_eq!(r.exit_code, Some(7));
    }

    #[tokio::test]
    async fn captures_output_tail() {
        let dir = std::env::temp_dir();
        let r = run_verification(&dir, "echo verification_marker", Duration::from_secs(10)).await;
        assert!(r.passed);
        assert!(
            r.output_tail.contains("verification_marker"),
            "tail missing output: {:?}",
            r.output_tail
        );
    }

    #[tokio::test]
    async fn times_out() {
        let dir = std::env::temp_dir();
        // `sleep 5` on unix; `ping` delay on windows.
        let cmd = if cfg!(target_os = "windows") {
            "ping -n 6 127.0.0.1"
        } else {
            "sleep 5"
        };
        let r = run_verification(&dir, cmd, Duration::from_millis(300)).await;
        assert!(r.timed_out);
        assert!(!r.passed);
    }

    #[test]
    fn tail_keeps_last_bytes_on_char_boundary() {
        let big = "x".repeat(MAX_TAIL_BYTES + 500);
        let t = tail(big.as_bytes());
        assert!(t.len() <= MAX_TAIL_BYTES + 4); // marker + boundary slack
        assert!(t.starts_with('…'));
    }
}
