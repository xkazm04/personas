//! The three commands the WebView shell itself calls: a liveness probe, the
//! log sink for frontend errors, and the time-to-interactive report.
//!
//! Moved verbatim out of `lib.rs` (Rust refactor W1). The command *names* are
//! part of the IPC contract and are derived from these fn names, so all three
//! keep their identifiers exactly — only the module path in
//! `generate_handler![…]` changed.

use crate::{logging, startup_timing};

/// Hello world IPC command -- verifies the Rust <-> React bridge works.
#[tauri::command]
#[tracing::instrument]
pub fn greet(name: String) -> String {
    tracing::info!(name = %name, "greet command called");
    format!("Hello from Rust, {}! Personas desktop is alive.", name)
}

/// Called from the WebView to persist frontend errors to the Rust log file.
#[tauri::command]
pub fn log_frontend_error(level: String, message: String) {
    logging::webview_log(&level, &message);
    match level.as_str() {
        "error" => tracing::error!(target: "webview", "{}", message),
        "warn" => tracing::warn!(target: "webview", "{}", message),
        _ => tracing::info!(target: "webview", "{}", message),
    }
}

/// Called by the frontend to report its time-to-interactive.
#[tauri::command]
pub fn report_frontend_ready(tti_ms: f64) {
    startup_timing::set_frontend_tti(tti_ms);
    tracing::info!(tti_ms = tti_ms, "Frontend time-to-interactive reported");
}
