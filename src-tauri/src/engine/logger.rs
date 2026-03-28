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
    pub fn new(log_dir: &std::path::Path, execution_id: &str) -> std::io::Result<Self> {
        fs::create_dir_all(log_dir)?;
        let path = log_dir.join(format!("{execution_id}.log"));
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        Ok(Self {
            writer: Some(BufWriter::new(file)),
            path,
            write_failed: false,
        })
    }

    pub fn log(&mut self, msg: &str) {
        if let Some(ref mut w) = self.writer {
            let timestamp = chrono::Utc::now().to_rfc3339();
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
