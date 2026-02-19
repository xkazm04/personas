// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Initialize Sentry before anything else so panics during startup are captured.
    // Returns a no-op guard when SENTRY_DSN is absent (local dev).
    let _sentry_guard = sentry::init(sentry_options());

    app_lib::run();
}

fn sentry_options() -> sentry::ClientOptions {
    sentry::ClientOptions {
        dsn: option_env!("SENTRY_DSN").and_then(|s| s.parse().ok()),
        release: Some(env!("CARGO_PKG_VERSION").into()),
        traces_sample_rate: 0.0,
        send_default_pii: false,
        // Track app sessions for Release Health (active user counts per version).
        // Sessions use anonymous device IDs — no PII.
        auto_session_tracking: true,
        session_mode: sentry::SessionMode::Application,
        before_send: Some(std::sync::Arc::new(|mut event| {
            if let Some(ref mut user) = event.user {
                user.email = None;
                user.ip_address = None;
                user.username = None;
            }
            if let Some(ref mut request) = event.request {
                request.data = None;
            }
            Some(event)
        })),
        ..Default::default()
    }
}
