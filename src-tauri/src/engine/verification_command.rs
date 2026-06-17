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
        Self { passed: false, exit_code: None, output_tail, timed_out: false }
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
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return VerificationResult::failure(format!("failed to spawn verification command: {e}")),
    };

    // Drain stdout+stderr concurrently with the wait so a chatty command can't
    // deadlock on a full pipe buffer.
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut combined = Vec::new();

    let run = async {
        let status = child.wait().await;
        if let Some(mut out) = stdout.take() {
            let _ = out.read_to_end(&mut combined).await;
        }
        if let Some(mut err) = stderr.take() {
            let _ = err.read_to_end(&mut combined).await;
        }
        status
    };

    match tokio::time::timeout(timeout, run).await {
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

fn shell_command(command: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
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
    let mut idx = start;
    while idx < text.len() && !text.is_char_boundary(idx) {
        idx += 1;
    }
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
        assert!(r.output_tail.contains("verification_marker"), "tail missing output: {:?}", r.output_tail);
    }

    #[tokio::test]
    async fn times_out() {
        let dir = std::env::temp_dir();
        // `sleep 5` on unix; `ping` delay on windows.
        let cmd = if cfg!(target_os = "windows") { "ping -n 6 127.0.0.1" } else { "sleep 5" };
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
