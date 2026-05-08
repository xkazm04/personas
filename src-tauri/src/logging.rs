use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::OnceLock;
use tracing_appender::non_blocking::NonBlocking;
use tracing_appender::rolling;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// Global crash log directory, set during init.
static CRASH_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Global tracing log directory, set when the file layer is wired up.
/// Used by `get_log_directory_stats` so the diagnostics surface doesn't have
/// to re-derive the path.
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Guard that must be held alive for the file logger to flush on shutdown.
static FILE_LOG_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

/// Non-blocking writer for the rolling file layer. Populated by `add_file_layer`
/// after the app data directory is known. Writes before that are silently
/// discarded by `DeferredFileWriter` so early-boot tracing doesn't have to wait.
static FILE_WRITER: OnceLock<NonBlocking> = OnceLock::new();

/// Non-blocking writer for WebView console messages (same underlying appender
/// as `FILE_WRITER`, kept as a separate handle so the WebView path can format
/// messages independently).
static WEBVIEW_LOG_WRITER: OnceLock<NonBlocking> = OnceLock::new();

/// Cap on the number of crash log files retained on disk. Older files are
/// pruned at startup. The full backtrace + last few hundred KB of context per
/// crash is small, so 20 retained files keeps a useful history without ever
/// reaching tens of MB.
const CRASH_LOG_RETENTION: usize = 20;

/// Cap on the number of rolling daily tracing files retained.
/// `tracing_appender::rolling::RollingFileAppender` enforces this on rotation;
/// also enforced at startup by `prune_orphan_personas_logs` to handle cases
/// where the cap was reduced between runs.
const TRACING_LOG_RETENTION: usize = 7;

/// Initialize tracing with stdout (colored), Sentry, and a deferred file layer.
///
/// The file layer is wired through `DeferredFileMakeWriter`, which silently
/// discards writes until `add_file_layer` populates `FILE_WRITER`. This lets
/// the subscriber be installed once, before the Tauri app data directory is
/// resolved, while still capturing every Rust-side `tracing::*!` call to disk
/// from boot onward (everything emitted between `init()` and `add_file_layer()`
/// is dropped — that window is short and stdout still receives it).
///
/// - Stdout: colored, human-readable for dev console
/// - File: rolling daily, no ANSI, bounded by `TRACING_LOG_RETENTION`
/// - Sentry: captures ERROR events as issues, WARN as breadcrumbs
/// - Default level: INFO, override via RUST_LOG env
pub fn init() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,personas_desktop=debug"));

    let stdout_layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_file(true)
        .with_line_number(true)
        .compact();

    let file_layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_file(true)
        .with_line_number(true)
        .with_ansi(false)
        .with_writer(DeferredFileMakeWriter);

    // Routes existing tracing::error!/warn! calls to Sentry automatically.
    // No-op when Sentry DSN is not configured.
    let sentry_layer = sentry_tracing::layer().event_filter(|meta| match *meta.level() {
        tracing::Level::ERROR => sentry_tracing::EventFilter::Event,
        tracing::Level::WARN => sentry_tracing::EventFilter::Breadcrumb,
        _ => sentry_tracing::EventFilter::Ignore,
    });

    tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer)
        .with(file_layer)
        .with(sentry_layer)
        .init();

    tracing::debug!("Tracing initialized");
}

/// Add a file-based log layer after the app data directory is known.
/// Writes Rust `tracing::*!` events and WebView console messages to a daily
/// rolling file in `<app_data>/logs/`, capped at `TRACING_LOG_RETENTION` files.
/// Gracefully degrades if the directory is not writable.
pub fn add_file_layer(app_data_dir: &std::path::Path) {
    let log_dir = app_data_dir.join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        tracing::warn!("Cannot create logs directory, file logging disabled");
        return;
    }

    LOG_DIR.set(log_dir.clone()).ok();

    // Write a startup marker for diagnostics
    let boot_log = log_dir.join("last_boot.log");
    let info = format!(
        "=== Personas Boot ===\nTime: {}\nVersion: {}\nPlatform: {}\n",
        chrono::Local::now().to_rfc3339(),
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
    );
    let _ = std::fs::write(&boot_log, &info);

    // Belt-and-braces: the rolling appender enforces retention on rotation,
    // but if the cap was reduced between runs (or someone copied old files
    // in) we want to claw back disk before the new appender starts writing.
    prune_orphan_personas_logs(&log_dir, TRACING_LOG_RETENTION);

    // Try to open a rolling log file; skip if permissions deny it
    match rolling::RollingFileAppender::builder()
        .rotation(rolling::Rotation::DAILY)
        .filename_prefix("personas")
        .filename_suffix("log")
        .max_log_files(TRACING_LOG_RETENTION)
        .build(&log_dir)
    {
        Ok(file_appender) => {
            let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
            FILE_LOG_GUARD.set(guard).ok();
            // Wire the same writer into both the deferred tracing layer (so
            // Rust tracing calls reach disk) and the WebView path (so console
            // messages land in the same file).
            FILE_WRITER.set(non_blocking.clone()).ok();
            WEBVIEW_LOG_WRITER.set(non_blocking).ok();
            tracing::info!("File logging enabled at {}", log_dir.display());
        }
        Err(e) => {
            tracing::warn!("File logging disabled: {}", e);
        }
    }
}

/// Append a WebView console message to the log file.
pub fn webview_log(level: &str, message: &str) {
    if let Some(writer) = WEBVIEW_LOG_WRITER.get() {
        let timestamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
        let line = format!("[{timestamp}] [WebView/{level}] {message}\n");
        let mut w = writer.clone();
        let _ = w.write_all(line.as_bytes());
    }
}

/// Writer wrapper that forwards to the rolling file appender once it's been
/// installed via `add_file_layer`, and silently discards writes before then.
/// `NonBlocking` handles its own internal buffering and is `Clone`, so each
/// `make_writer` call produces a fresh handle that drops cheaply.
struct DeferredFileWriter;

impl Write for DeferredFileWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if let Some(writer) = FILE_WRITER.get() {
            let mut w = writer.clone();
            w.write(buf)
        } else {
            Ok(buf.len())
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        if let Some(writer) = FILE_WRITER.get() {
            let mut w = writer.clone();
            w.flush()
        } else {
            Ok(())
        }
    }
}

struct DeferredFileMakeWriter;

impl<'a> MakeWriter<'a> for DeferredFileMakeWriter {
    type Writer = DeferredFileWriter;
    fn make_writer(&'a self) -> Self::Writer {
        DeferredFileWriter
    }
}

/// Remove all but the `keep` most-recent daily rolling files matching the
/// `personas.*.log` naming convention. Safe to call before the rolling
/// appender starts because it ignores everything that doesn't match the
/// prefix/suffix (preserves `last_boot.log`, execution logs named with UUIDs,
/// freeze monitor dumps, etc.).
fn prune_orphan_personas_logs(log_dir: &std::path::Path, keep: usize) {
    let mut rolling_files: Vec<(String, PathBuf)> = match std::fs::read_dir(log_dir) {
        Ok(rd) => rd
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                let name = path.file_name()?.to_str()?.to_string();
                if name.starts_with("personas.") && name.ends_with(".log") {
                    Some((name, path))
                } else {
                    None
                }
            })
            .collect(),
        Err(_) => return,
    };

    if rolling_files.len() <= keep {
        return;
    }

    // Filenames embed the rotation date (`personas.YYYY-MM-DD.log`), so a
    // descending lexical sort puts the newest first.
    rolling_files.sort_by(|a, b| b.0.cmp(&a.0));

    for (_, path) in rolling_files.into_iter().skip(keep) {
        if let Err(e) = std::fs::remove_file(&path) {
            tracing::warn!("Failed to prune old log {}: {}", path.display(), e);
        }
    }
}

/// Install a panic hook that writes crash details to a file before aborting.
/// Must be called after the app data directory is known.
pub fn install_crash_hook(app_data_dir: &std::path::Path) {
    // Ensure backtraces are captured with full symbols
    if std::env::var("RUST_BACKTRACE").is_err() {
        std::env::set_var("RUST_BACKTRACE", "full");
    }

    let crash_dir = app_data_dir.join("crash_logs");
    let _ = std::fs::create_dir_all(&crash_dir);

    // Bound the crash directory before we set the hook so a long-lived install
    // can't accumulate unbounded crash files. Done synchronously so the
    // diagnostics surface starts in a known state.
    prune_crash_logs(&crash_dir, CRASH_LOG_RETENTION);

    CRASH_LOG_DIR.set(crash_dir).ok();

    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Write crash log to file
        if let Some(dir) = CRASH_LOG_DIR.get() {
            let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
            let path = dir.join(format!("crash_{timestamp}.log"));

            let mut report = String::new();
            report.push_str(&format!(
                "=== PERSONAS CRASH REPORT ===\n\
                 Time: {}\n\
                 Version: {}\n\n",
                chrono::Local::now().to_rfc3339(),
                env!("CARGO_PKG_VERSION"),
            ));

            // Panic message
            if let Some(msg) = info.payload().downcast_ref::<&str>() {
                report.push_str(&format!("Panic: {msg}\n"));
            } else if let Some(msg) = info.payload().downcast_ref::<String>() {
                report.push_str(&format!("Panic: {msg}\n"));
            } else {
                report.push_str("Panic: <unknown payload>\n");
            }

            // Location
            if let Some(loc) = info.location() {
                report.push_str(&format!(
                    "Location: {}:{}:{}\n",
                    loc.file(),
                    loc.line(),
                    loc.column()
                ));
            }

            // Backtrace
            report.push_str(&format!(
                "\nBacktrace:\n{}\n",
                std::backtrace::Backtrace::force_capture()
            ));

            // Thread info
            let thread = std::thread::current();
            report.push_str(&format!(
                "\nThread: {:?} (id: {:?})\n",
                thread.name(),
                thread.id()
            ));

            let _ = std::fs::write(&path, &report);
            eprintln!("[CRASH] Report written to: {}", path.display());
        }

        // Call the previous hook (Sentry, default, etc.)
        prev_hook(info);
    }));

    tracing::info!("Crash hook installed");
}

/// Read crash logs from disk (most recent first, max 10).
pub fn read_crash_logs(app_data_dir: &std::path::Path) -> Vec<CrashLogEntry> {
    let crash_dir = app_data_dir.join("crash_logs");
    let mut entries = Vec::new();

    if let Ok(dir) = std::fs::read_dir(&crash_dir) {
        for entry in dir.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "log").unwrap_or(false) {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    entries.push(CrashLogEntry {
                        filename: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into(),
                        content,
                    });
                }
            }
        }
    }

    // Sort by filename descending (newest first since filenames contain timestamps)
    entries.sort_by(|a, b| b.filename.cmp(&a.filename));
    entries.truncate(10);
    entries
}

/// Clear all crash logs.
pub fn clear_crash_logs(app_data_dir: &std::path::Path) {
    let crash_dir = app_data_dir.join("crash_logs");
    if let Ok(dir) = std::fs::read_dir(&crash_dir) {
        for entry in dir.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Remove all but the `keep` most recent `.log` files in `crash_dir`.
/// Used at startup to bound the crash directory.
fn prune_crash_logs(crash_dir: &std::path::Path, keep: usize) {
    let mut files: Vec<(String, PathBuf)> = match std::fs::read_dir(crash_dir) {
        Ok(rd) => rd
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension().map(|e| e == "log").unwrap_or(false) {
                    let name = path.file_name()?.to_str()?.to_string();
                    Some((name, path))
                } else {
                    None
                }
            })
            .collect(),
        Err(_) => return,
    };

    if files.len() <= keep {
        return;
    }

    // Crash filenames are timestamp-prefixed (`crash_YYYYMMDD_HHMMSS.log`,
    // `autocred_…`), so lexical descending sort puts the newest first.
    files.sort_by(|a, b| b.0.cmp(&a.0));

    for (_, path) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}

/// Aggregate stats for the diagnostics surface in Settings.
/// Reports the total bytes and file count for the tracing log directory and
/// the crash log directory separately so users can see which is growing.
#[derive(serde::Serialize, Clone, ts_rs::TS)]
#[ts(export)]
pub struct LogDirectoryStats {
    pub log_dir: String,
    pub log_bytes: u64,
    pub log_file_count: u32,
    pub crash_dir: String,
    pub crash_bytes: u64,
    pub crash_file_count: u32,
    /// Combined retention cap on rolling tracing files (max files, not bytes).
    pub tracing_log_retention: u32,
    /// Combined retention cap on crash log files (max files, not bytes).
    pub crash_log_retention: u32,
}

/// Sum all `.log` (and `.gz`/no-extension rotation) file sizes under `dir`.
/// Walks one level deep — the tracing/crash directories are flat.
fn directory_stats(dir: &std::path::Path) -> (u64, u32) {
    let mut bytes: u64 = 0;
    let mut count: u32 = 0;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    bytes = bytes.saturating_add(meta.len());
                    count = count.saturating_add(1);
                }
            }
        }
    }
    (bytes, count)
}

/// Build a `LogDirectoryStats` snapshot. Public so the Tauri command in
/// `commands/infrastructure/system/crash_telemetry.rs` can call it.
pub fn log_directory_stats(app_data_dir: &std::path::Path) -> LogDirectoryStats {
    let log_dir = LOG_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| app_data_dir.join("logs"));
    let crash_dir = CRASH_LOG_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| app_data_dir.join("crash_logs"));

    let (log_bytes, log_file_count) = directory_stats(&log_dir);
    let (crash_bytes, crash_file_count) = directory_stats(&crash_dir);

    LogDirectoryStats {
        log_dir: log_dir.to_string_lossy().into_owned(),
        log_bytes,
        log_file_count,
        crash_dir: crash_dir.to_string_lossy().into_owned(),
        crash_bytes,
        crash_file_count,
        tracing_log_retention: TRACING_LOG_RETENTION as u32,
        crash_log_retention: CRASH_LOG_RETENTION as u32,
    }
}

#[derive(serde::Serialize, Clone, ts_rs::TS)]
#[ts(export)]
pub struct CrashLogEntry {
    pub filename: String,
    pub content: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn prune_crash_logs_keeps_newest() {
        let dir = tempdir().unwrap();
        // 5 timestamp-named crash files
        for ts in [
            "20260101_120000",
            "20260102_120000",
            "20260103_120000",
            "20260104_120000",
            "20260105_120000",
        ] {
            std::fs::write(dir.path().join(format!("crash_{ts}.log")), b"x").unwrap();
        }
        // unrelated file should survive
        std::fs::write(dir.path().join("note.txt"), b"keep me").unwrap();

        prune_crash_logs(dir.path(), 2);

        let mut remaining: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        remaining.sort();
        assert_eq!(
            remaining,
            vec![
                "crash_20260104_120000.log".to_string(),
                "crash_20260105_120000.log".to_string(),
                "note.txt".to_string(),
            ]
        );
    }

    #[test]
    fn prune_orphan_personas_logs_ignores_other_files() {
        let dir = tempdir().unwrap();
        for date in [
            "2026-01-01",
            "2026-01-02",
            "2026-01-03",
            "2026-01-04",
            "2026-01-05",
            "2026-01-06",
            "2026-01-07",
            "2026-01-08",
            "2026-01-09",
        ] {
            std::fs::write(dir.path().join(format!("personas.{date}.log")), b"x").unwrap();
        }
        std::fs::write(dir.path().join("last_boot.log"), b"boot").unwrap();
        std::fs::write(
            dir.path().join("00000000-0000-0000-0000-000000000001.log"),
            b"exec",
        )
        .unwrap();

        prune_orphan_personas_logs(dir.path(), 3);

        let names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        // 3 newest personas.* files + last_boot + execution log = 5
        assert_eq!(names.len(), 5);
        assert!(names.iter().any(|n| n == "personas.2026-01-09.log"));
        assert!(names.iter().any(|n| n == "personas.2026-01-08.log"));
        assert!(names.iter().any(|n| n == "personas.2026-01-07.log"));
        assert!(names.iter().any(|n| n == "last_boot.log"));
        assert!(names
            .iter()
            .any(|n| n == "00000000-0000-0000-0000-000000000001.log"));
    }

    #[test]
    fn directory_stats_sums_files() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.log"), b"hello").unwrap();
        std::fs::write(dir.path().join("b.log"), b"world!").unwrap();

        let (bytes, count) = directory_stats(dir.path());
        assert_eq!(count, 2);
        assert_eq!(bytes, 11); // 5 + 6
    }
}
