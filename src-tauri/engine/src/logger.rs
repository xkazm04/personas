use personas_core::utils::sanitization::sanitize_secrets;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;

/// Tag the runner writes before every subprocess stdout line
/// (`logger.log(&format!("[STDOUT] {}", ..))` in `runner/mod.rs`).
pub const STDOUT_TAG: &str = "[STDOUT] ";

/// Split one on-disk log line into its `[rfc3339] ` stamp and the stdout text
/// after [`STDOUT_TAG`]. `None` for every line that is not subprocess stdout.
///
/// The reader lives beside the writer because the two drifted once already:
/// the paged log command kept only the text after the tag, so the replay's
/// first page reached the timeline with no stamps. The timeline then fell back
/// to spreading lines evenly across the run, and no silence could render. On
/// 2026-09-26 that was every one of 523 stdout-bearing logs on the operator's
/// machine; keeping the stamp gave all 523 their recorded tempo back.
pub fn split_stdout_line(line: &str) -> Option<(&str, &str)> {
    let pos = line.find(STDOUT_TAG)?;
    Some((&line[..pos], &line[pos + STDOUT_TAG.len()..]))
}

pub struct ExecutionLogger {
    writer: Option<BufWriter<std::fs::File>>,
    path: PathBuf,
    /// Set to `true` after the first I/O error so callers know the log may be incomplete.
    write_failed: bool,
}

impl ExecutionLogger {
    /// Deterministic on-disk path for an execution's log file.
    ///
    /// Exposed so callers that need the path *without* opening the file (e.g.
    /// the engine ceiling synthesizing a result after the runner future was
    /// dropped) derive it from the same single source of truth as `new`.
    pub fn log_path(log_dir: &std::path::Path, execution_id: &str) -> PathBuf {
        log_dir.join(format!("{execution_id}.log"))
    }

    pub fn new(log_dir: &std::path::Path, execution_id: &str) -> std::io::Result<Self> {
        fs::create_dir_all(log_dir)?;
        let path = Self::log_path(log_dir, execution_id);
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            writer: Some(BufWriter::new(file)),
            path,
            write_failed: false,
        })
    }

    /// Append one line to this execution's log file.
    ///
    /// SECRETS ARE MASKED HERE, and this is the only place that can do it.
    /// `runner/mod.rs` writes every subprocess stdout line through this method
    /// verbatim, so whatever a persona's tool prints — an `.env` dump, a
    /// `git remote -v` with a token in the URL, a file it was asked to read —
    /// lands on disk unaltered.
    ///
    /// Measured 2026-08-14 against the operator's real log directory: 3,018
    /// files / 410.6 MB going back 130 days, containing GitHub PATs, Google API
    /// keys, a service-account private key and a JWT. Verified twice, by an
    /// agent and independently by counting file hits per credential shape.
    ///
    /// The repo already had FIVE redaction layers (`pii::scrub`,
    /// `sanitize_secrets`, `sanitize_error_message`, `redact_clipboard_content`,
    /// `SecureString`) and every one of them guards egress or the UI. None
    /// guarded the durable file sink — the one surface with no retention policy.
    /// `sanitize_secrets` compiles its patterns in a `OnceLock` precisely
    /// because it is expected on hot paths, so calling it per line is the
    /// intended usage, not a cost.
    ///
    /// NOTE: this masks NEW writes only. Existing files must be purged
    /// separately, and any credential already on disk should be treated as
    /// compromised and rotated.
    pub fn log(&mut self, msg: &str) {
        if let Some(ref mut w) = self.writer {
            let timestamp = chrono::Utc::now().to_rfc3339();
            let msg = sanitize_secrets(msg);
            if let Err(e) = writeln!(w, "[{timestamp}] {msg}") {
                if !self.write_failed {
                    self.write_failed = true;
                    tracing::warn!(
                        error = %e,
                        "ExecutionLogger write error; log may be truncated"
                    );
                }
            }
        }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// Returns `true` if any write or flush error occurred during the logger's lifetime.
    pub fn had_write_errors(&self) -> bool {
        self.write_failed
    }

    pub fn close(&mut self) {
        if let Some(w) = self.writer.take() {
            match w.into_inner() {
                Ok(mut f) => {
                    if let Err(e) = f.flush() {
                        if !self.write_failed {
                            self.write_failed = true;
                            tracing::warn!(error = %e, "ExecutionLogger flush error on close");
                        }
                    }
                }
                Err(e) => {
                    if !self.write_failed {
                        self.write_failed = true;
                        tracing::warn!(error = %e, "ExecutionLogger buffer flush error on close");
                    }
                }
            }
        }
    }
}

impl Drop for ExecutionLogger {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The stamp a reader gets back is the one the writer put down, in a shape
    /// the replay's `LOG_TIMESTAMP_RE` (`useReplayTimeline.ts`) anchors on.
    #[test]
    fn split_returns_the_written_stamp_and_the_stdout_text() -> std::io::Result<()> {
        let dir = std::env::temp_dir().join(format!("personas-logger-{}", std::process::id()));
        let mut logger = ExecutionLogger::new(&dir, "split-roundtrip")?;
        logger.log(&format!("{STDOUT_TAG}{{\"type\":\"result\"}}"));
        logger.log("engine line with no stdout tag");
        logger.close();
        let content = fs::read_to_string(ExecutionLogger::log_path(&dir, "split-roundtrip"))?;
        let _ = fs::remove_dir_all(&dir);

        let mut lines = content.lines();
        let (stamp, text) = lines
            .next()
            .and_then(split_stdout_line)
            .ok_or_else(|| std::io::Error::other("stdout line did not split"))?;
        assert_eq!(text, "{\"type\":\"result\"}");
        let inner = stamp
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix("] "))
            .ok_or_else(|| std::io::Error::other("stamp is not `[..] `"))?;
        assert!(
            chrono::DateTime::parse_from_rfc3339(inner).is_ok(),
            "stamp {inner:?}"
        );
        assert_eq!(lines.next().and_then(split_stdout_line), None);
        Ok(())
    }
}
