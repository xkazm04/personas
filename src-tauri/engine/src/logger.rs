use personas_core::utils::sanitization::sanitize_secrets;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;

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
                    eprintln!("[ExecutionLogger] write error (log may be truncated): {e}");
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
                            eprintln!("[ExecutionLogger] flush error on close: {e}");
                        }
                    }
                }
                Err(e) => {
                    if !self.write_failed {
                        self.write_failed = true;
                        eprintln!("[ExecutionLogger] buffer flush error on close: {e}");
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
