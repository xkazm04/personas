use std::path::PathBuf;
use std::sync::OnceLock;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// Global crash log directory, set during init.
static CRASH_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Initialize tracing with stdout (colored) and Sentry layers.
///
/// - Stdout: colored, human-readable for dev console
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
        .with(sentry_layer)
        .init();

    tracing::debug!("Tracing initialized");
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
    CRASH_LOG_DIR.set(crash_dir).ok();

    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Write crash log to file
        if let Some(dir) = CRASH_LOG_DIR.get() {
            let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
            let path = dir.join(format!("crash_{}.log", timestamp));

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
                report.push_str(&format!("Panic: {}\n", msg));
            } else if let Some(msg) = info.payload().downcast_ref::<String>() {
                report.push_str(&format!("Panic: {}\n", msg));
            } else {
                report.push_str("Panic: <unknown payload>\n");
            }

            // Location
            if let Some(loc) = info.location() {
                report.push_str(&format!("Location: {}:{}:{}\n", loc.file(), loc.line(), loc.column()));
            }

            // Backtrace
            report.push_str(&format!("\nBacktrace:\n{}\n", std::backtrace::Backtrace::force_capture()));

            // Thread info
            let thread = std::thread::current();
            report.push_str(&format!("\nThread: {:?} (id: {:?})\n", thread.name(), thread.id()));

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
                        filename: path.file_name().unwrap_or_default().to_string_lossy().into(),
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

#[derive(serde::Serialize, Clone)]
pub struct CrashLogEntry {
    pub filename: String,
    pub content: String,
}
