use tracing_subscriber::{fmt, prelude::*, EnvFilter};

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
