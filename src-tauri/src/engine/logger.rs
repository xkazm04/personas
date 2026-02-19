use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;

pub struct ExecutionLogger {
    writer: Option<BufWriter<std::fs::File>>,
    path: PathBuf,
}

impl ExecutionLogger {
    pub fn new(log_dir: &std::path::Path, execution_id: &str) -> std::io::Result<Self> {
        fs::create_dir_all(log_dir)?;
        let path = log_dir.join(format!("{}.log", execution_id));
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        Ok(Self {
            writer: Some(BufWriter::new(file)),
            path,
        })
    }

    pub fn log(&mut self, msg: &str) {
        if let Some(ref mut w) = self.writer {
            let timestamp = chrono::Utc::now().to_rfc3339();
            let _ = writeln!(w, "[{}] {}", timestamp, msg);
        }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    pub fn close(&mut self) {
        if let Some(w) = self.writer.take() {
            let _ = w.into_inner().map(|mut f| f.flush());
        }
    }
}

impl Drop for ExecutionLogger {
    fn drop(&mut self) {
        self.close();
    }
}
