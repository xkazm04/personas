use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// Initialize tracing with stdout (colored) and file (JSON) layers.
///
/// - Stdout: colored, human-readable for dev console
/// - File: JSON lines, daily rotation (future: via tracing-appender)
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

    tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer)
        .init();

    tracing::debug!("Tracing initialized");
}
