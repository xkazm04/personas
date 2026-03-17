//! Unified CLI process lifecycle driver.
//!
//! Extracts the shared subprocess spawning, line-by-line streaming,
//! PID registration, and cancellation patterns that were previously
//! duplicated across `runner.rs` and `test_runner.rs`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use super::types::CliArgs;

// =============================================================================
// Constants
// =============================================================================

/// Maximum bytes read for a single stdout line before truncation.
/// Prevents OOM from CLI processes that emit huge single-line output
/// (binary data, base64 blobs, minified JSON, infinite loops without newlines).
pub(crate) const MAX_LINE_BYTES: usize = 64 * 1024; // 64 KB

/// Watchdog timeout: if no newline arrives within this duration, the line
/// read is aborted and whatever has been buffered so far is returned.
/// Prevents indefinite hangs from processes that produce output without newlines.
/// Set generously to accommodate initial API latency + model reasoning time.
pub(crate) const LINE_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

// =============================================================================
// read_line_limited -- robust per-line reader with size + time guards
// =============================================================================

/// Read the next line from a buffered reader with per-line size and time limits.
///
/// Returns `Ok(Some(line))` for each line, `Ok(None)` at EOF.
/// Lines exceeding `MAX_LINE_BYTES` are truncated with a `...[truncated]` suffix.
/// If no newline arrives within `LINE_READ_TIMEOUT`, returns whatever has been
/// accumulated so far (with a `...[timeout]` suffix if non-empty).
pub(crate) async fn read_line_limited<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<String>> {
    let mut line_buf = Vec::with_capacity(4096);
    let mut truncated = false;

    loop {
        // Apply watchdog timeout to each fill_buf call
        let fill_result = tokio::time::timeout(LINE_READ_TIMEOUT, reader.fill_buf()).await;

        let available = match fill_result {
            Ok(Ok(buf)) => buf,
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                // Watchdog timeout -- no newline within the time limit
                if line_buf.is_empty() {
                    // Nothing buffered and timed out -- treat as EOF
                    return Ok(None);
                }
                let mut s = String::from_utf8_lossy(&line_buf).into_owned();
                s.push_str("...[timeout]");
                return Ok(Some(s));
            }
        };

        if available.is_empty() {
            // EOF
            if line_buf.is_empty() {
                return Ok(None);
            }
            return Ok(Some(String::from_utf8_lossy(&line_buf).into_owned()));
        }

        // Search for newline in the available buffer
        let (consumed, found_newline) = if let Some(nl_pos) = available.iter().position(|&b| b == b'\n') {
            // Copy up to newline (excluding the newline itself)
            let take = nl_pos;
            if !truncated && line_buf.len() + take <= MAX_LINE_BYTES {
                line_buf.extend_from_slice(&available[..take]);
            } else if !truncated {
                // Partial fit -- fill up to the limit
                let remaining = MAX_LINE_BYTES - line_buf.len();
                line_buf.extend_from_slice(&available[..remaining]);
                truncated = true;
            }
            (nl_pos + 1, true) // +1 to consume the newline
        } else {
            // No newline found -- take the whole buffer
            let take = available.len();
            if !truncated && line_buf.len() + take <= MAX_LINE_BYTES {
                line_buf.extend_from_slice(available);
            } else if !truncated {
                let remaining = MAX_LINE_BYTES.saturating_sub(line_buf.len());
                if remaining > 0 {
                    line_buf.extend_from_slice(&available[..remaining]);
                }
                truncated = true;
            }
            (take, false)
        };

        reader.consume(consumed);

        if found_newline {
            let mut s = String::from_utf8_lossy(&line_buf).into_owned();
            if truncated {
                s.push_str("...[truncated]");
            }
            return Ok(Some(s));
        }
    }
}

// =============================================================================
// CliProcessDriver -- unified CLI subprocess lifecycle
// =============================================================================

/// A running CLI subprocess with helpers for PID tracking, stdin delivery,
/// stdout streaming, and cancellation-aware cleanup.
///
/// Created via [`CliProcessDriver::spawn`] or [`CliProcessDriver::spawn_temp`].
pub(crate) struct CliProcessDriver {
    pub child: tokio::process::Child,
    pub exec_dir: PathBuf,
    /// Whether `exec_dir` is a temp dir that should be cleaned up on finish.
    owns_exec_dir: bool,
    /// Cached PID (if available).
    pid: Option<u32>,
}

impl CliProcessDriver {
    /// Build and spawn a CLI process, using a caller-provided working directory.
    ///
    /// The directory is NOT cleaned up automatically (the caller manages it).
    pub fn spawn(cli_args: &CliArgs, exec_dir: PathBuf) -> Result<Self, std::io::Error> {
        let child = Self::build_and_spawn(cli_args, &exec_dir)?;
        let pid = child.id();
        Ok(Self {
            child,
            exec_dir,
            owns_exec_dir: false,
            pid,
        })
    }

    /// Build and spawn a CLI process in a fresh temp directory.
    ///
    /// The temp directory is automatically removed when [`finish`] or [`cleanup`]
    /// is called.
    pub fn spawn_temp(cli_args: &CliArgs, temp_prefix: &str) -> Result<Self, String> {
        let exec_dir = std::env::temp_dir().join(format!(
            "{}-{}",
            temp_prefix,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&exec_dir)
            .map_err(|e| format!("Failed to create temp dir: {e}"))?;

        let child = Self::build_and_spawn(cli_args, &exec_dir)
            .map_err(|e| format!("Failed to spawn CLI: {e}"))?;
        let pid = child.id();
        Ok(Self {
            child,
            exec_dir,
            owns_exec_dir: true,
            pid,
        })
    }

    /// Internal: configure and spawn a `tokio::process::Command` from `CliArgs`.
    ///
    /// stderr is sent to null to prevent buffer-full deadlocks on Windows
    /// (the ~4 KB pipe buffer fills up if nobody reads stderr, causing the
    /// child process to block on its next stderr write and hang forever).
    fn build_and_spawn(cli_args: &CliArgs, exec_dir: &PathBuf) -> Result<tokio::process::Child, std::io::Error> {
        let mut cmd = Command::new(&cli_args.command);
        cmd.args(&cli_args.args)
            .current_dir(exec_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        #[cfg(windows)]
        {
            #[allow(unused_imports)]
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        for key in &cli_args.env_removals {
            cmd.env_remove(key);
        }
        for (key, val) in &cli_args.env_overrides {
            cmd.env(key, val);
        }

        cmd.spawn()
    }

    /// Build and spawn with stderr discarded (piped to null).
    /// Useful for test/lab runners that don't need stderr.
    pub fn spawn_temp_no_stderr(cli_args: &CliArgs, temp_prefix: &str) -> Result<Self, String> {
        let exec_dir = std::env::temp_dir().join(format!(
            "{}-{}",
            temp_prefix,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&exec_dir)
            .map_err(|e| format!("Failed to create temp dir: {e}"))?;

        let mut cmd = Command::new(&cli_args.command);
        cmd.args(&cli_args.args)
            .current_dir(&exec_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        #[cfg(windows)]
        {
            #[allow(unused_imports)]
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        for key in &cli_args.env_removals {
            cmd.env_remove(key);
        }
        for (key, val) in &cli_args.env_overrides {
            cmd.env(key, val);
        }

        let child = cmd.spawn().map_err(|e| format!("Failed to spawn CLI: {e}"))?;
        let pid = child.id();
        Ok(Self {
            child,
            exec_dir,
            owns_exec_dir: true,
            pid,
        })
    }

    /// Returns the PID of the child process (if available).
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Register this process's PID in a shared map (for external cancellation).
    pub async fn register_pid(
        &self,
        pids: &Mutex<HashMap<String, u32>>,
        key: &str,
    ) {
        if let Some(pid) = self.pid {
            pids.lock().await.insert(key.to_string(), pid);
        }
    }

    /// Unregister this process's PID from the shared map.
    pub async fn unregister_pid(
        &self,
        pids: &Mutex<HashMap<String, u32>>,
        key: &str,
    ) {
        pids.lock().await.remove(key);
    }

    /// Write data to the child's stdin and shut it down.
    pub async fn write_stdin(&mut self, data: &[u8]) {
        if let Some(mut stdin) = self.child.stdin.take() {
            let _ = stdin.write_all(data).await;
            let _ = stdin.shutdown().await;
        }
    }

    /// Write a line to the child's stdin without consuming or closing it.
    /// Suitable for multi-turn Q&A where stdin must remain open for subsequent writes.
    pub async fn write_stdin_line(&mut self, data: &[u8]) -> Result<(), std::io::Error> {
        if let Some(stdin) = self.child.stdin.as_mut() {
            stdin.write_all(data).await?;
            stdin.write_all(b"\n").await?;
            stdin.flush().await?;
            Ok(())
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "stdin already consumed or closed",
            ))
        }
    }

    /// Close stdin without writing anything.
    pub async fn close_stdin(&mut self) {
        if let Some(mut stdin) = self.child.stdin.take() {
            let _ = stdin.shutdown().await;
        }
    }

    /// Take stdout, returning a `BufReader` suitable for `read_line_limited`.
    pub fn take_stdout_reader(&mut self) -> Option<BufReader<tokio::process::ChildStdout>> {
        self.child.stdout.take().map(BufReader::new)
    }

    /// Take stderr for background collection.
    pub fn take_stderr(&mut self) -> Option<tokio::process::ChildStderr> {
        self.child.stderr.take()
    }

    /// Check whether a cancellation flag is set.
    pub fn is_cancelled(cancelled: &Arc<AtomicBool>) -> bool {
        cancelled.load(Ordering::Acquire)
    }

    /// Kill the child process and wait for it to exit.
    pub async fn kill(&mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }

    /// Wait for the child to exit naturally.
    pub async fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.child.wait().await
    }

    /// Clean up the temp directory (if owned). Called automatically by `finish`.
    pub fn cleanup_dir(&self) {
        if self.owns_exec_dir {
            let _ = std::fs::remove_dir_all(&self.exec_dir);
        }
    }

    /// Wait for exit and clean up temp dir. Returns exit status.
    pub async fn finish(mut self) -> std::io::Result<std::process::ExitStatus> {
        let status = self.child.wait().await;
        self.cleanup_dir();
        status
    }

    /// Collect all stdout as lines using `AsyncBufReadExt::next_line` with a timeout.
    /// Simpler than `read_line_limited` -- suited for test/lab runners that don't
    /// need per-line truncation guards.
    pub async fn collect_lines_with_timeout<F>(
        &mut self,
        timeout: std::time::Duration,
        mut on_line: F,
    ) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let stdout = self.child.stdout.take().ok_or("No stdout")?;
        let mut reader = BufReader::new(stdout).lines();

        let result = tokio::time::timeout(timeout, async {
            while let Ok(Some(line)) = reader.next_line().await {
                on_line(&line);
            }
        })
        .await;

        if result.is_err() {
            return Err(format!(
                "CLI timed out after {} seconds",
                timeout.as_secs()
            ));
        }

        Ok(())
    }
}
