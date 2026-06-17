pub mod binary_probe;
pub mod crash_telemetry;
pub mod health;
pub mod mcp_integration;
pub mod storage;

// Re-export everything (including Tauri-generated `__cmd__*` items) so that
// `commands::infrastructure::system::*` paths in lib.rs continue to work.
pub use binary_probe::*;
pub use crash_telemetry::*;
pub use health::*;
pub use mcp_integration::*;
pub use storage::*;

use crate::error::AppError;

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), AppError> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err(AppError::Validation(
            "Only http/https URLs are allowed".into(),
        ));
    }

    tracing::info!(url = %trimmed, "open_external_url requested");

    open::that(trimmed).map_err(|e| AppError::Internal(format!("Failed to open URL: {e}")))?;

    Ok(())
}

/// Open an arbitrary local path or known-safe URL scheme via the host OS
/// (Explorer / Finder / xdg-open). Accepts existing files and folders on
/// disk, plus a small allowlist of editor protocols (`vscode://`,
/// `vscode-insiders://`, `cursor://`, `windsurf://`). Used by the dev-tools
/// Projects tab for "Open in VS Code" + "Open project folder" actions.
///
/// We intentionally don't ship `@tauri-apps/plugin-shell` in this app
/// (no `tauri-plugin-shell` crate in Cargo.toml, no `shell:allow-open`
/// capability), so this command is the canonical surface for the frontend
/// to ask the OS to open something local.
#[tauri::command]
pub async fn open_local_path(target: String) -> Result<(), AppError> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Empty path".into()));
    }

    // Allowlist of editor protocols — these launch a known IDE with a file.
    const ALLOWED_SCHEMES: &[&str] = &[
        "vscode://",
        "vscode-insiders://",
        "cursor://",
        "windsurf://",
    ];

    let is_known_scheme = ALLOWED_SCHEMES.iter().any(|s| trimmed.starts_with(s));

    if !is_known_scheme {
        // Treat as a filesystem path. Must exist on disk so we don't double
        // as an arbitrary-scheme launcher (mailto:, file:, http(s):, ...).
        let path = std::path::Path::new(trimmed);
        if !path.exists() {
            return Err(AppError::NotFound(format!("Path does not exist: {trimmed}")));
        }
    }

    tracing::info!(target = %trimmed, "open_local_path requested");

    open::that(trimmed)
        .map_err(|e| AppError::Internal(format!("Failed to open path: {e}")))?;

    Ok(())
}

#[tauri::command]
#[tracing::instrument]
pub fn get_db_performance() -> crate::db::perf::DbPerfSnapshot {
    crate::db::perf::get_snapshot()
}
