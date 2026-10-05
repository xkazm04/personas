//! The three commands the WebView shell itself calls: a liveness probe, the
//! log sink for frontend errors, and the time-to-interactive report.
//!
//! Moved verbatim out of `lib.rs` (Rust refactor W1). The command *names* are
//! part of the IPC contract and are derived from these fn names, so all three
//! keep their identifiers exactly — only the module path in
//! `generate_handler![…]` changed.

use serde::Deserialize;
use ts_rs::TS;

use crate::error::AppError;
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

/// What a [`DevlogRecord`] reports. The WebView's producers are fixed: each
/// kind is one instrument in `src/lib/devlog/`, and the record lands in the
/// rolling JSONL file with target `webview::<kind>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DevlogKind {
    Error,
    IpcSlow,
    IpcWindow,
    LongTask,
    Commit,
    Freeze,
    StoreAlert,
    SwallowRollup,
}

/// Severity of a [`DevlogRecord`], with the same meaning as the Rust levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DevlogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// One record the WebView sends into the app's log sink through
/// [`devlog_ingest`]. `msg` is a constant string; everything variable goes in
/// `fields`, so the sink can fingerprint and group it.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DevlogRecord {
    pub kind: DevlogKind,
    pub lvl: DevlogLevel,
    /// The producer's scope, e.g. `ipc`, `global-error`, `silentFailures`.
    pub scope: String,
    pub msg: String,
    /// Client clock at the moment the record was made, epoch milliseconds.
    pub cts: f64,
    /// The active sidebar section, when the shell has one.
    #[serde(default)]
    #[ts(optional)]
    pub route: Option<String>,
    /// Named fields; always a JSON object.
    #[ts(type = "Record<string, unknown>")]
    pub fields: serde_json::Value,
}

/// Batched sink for WebView records (see `src/lib/devlog/`). Each record is
/// re-emitted as a tracing event so it shares the file, envelope, fingerprint
/// and rate limit of every Rust record.
#[tauri::command]
pub fn devlog_ingest(records: Vec<DevlogRecord>) -> Result<(), AppError> {
    // WP0 contract stub: WP1 replaces this body with the real emitter.
    let _ = records;
    Ok(())
}

/// Called by the frontend to report its time-to-interactive.
#[tauri::command]
pub fn report_frontend_ready(tti_ms: f64) {
    startup_timing::set_frontend_tti(tti_ms);
    tracing::info!(tti_ms = tti_ms, "Frontend time-to-interactive reported");
}
