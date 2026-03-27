pub mod binary_probe;
pub mod crash_telemetry;
pub mod health;
pub mod mcp_integration;

// Re-export everything (including Tauri-generated `__cmd__*` items) so that
// `commands::infrastructure::system::*` paths in lib.rs continue to work.
pub use binary_probe::*;
pub use crash_telemetry::*;
pub use health::*;
pub use mcp_integration::*;

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

    open::that(trimmed)
        .map_err(|e| AppError::Internal(format!("Failed to open URL: {e}")))?;

    Ok(())
}

#[tauri::command]
#[tracing::instrument]
pub fn get_db_performance() -> crate::db::perf::DbPerfSnapshot {
    crate::db::perf::get_snapshot()
}
