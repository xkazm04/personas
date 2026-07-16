//! Clipboard intelligence: search knowledge bases for error resolutions.
//!
//! When an error is detected in clipboard content, this module searches across
//! all knowledge bases in the vector store for similar past resolutions.
//!
//! The actual scan lives in [`crate::engine::kb_scan`] — ONE shared
//! implementation used by both this command path and the clipboard-watcher
//! subscription (`engine::subscription`), which previously carried a drifted
//! copy of the same logic.

use std::sync::Arc;

use tauri::State;

use crate::error::AppError;
use crate::AppState;

// Re-exported so existing callers (and the generated TS binding) keep their
// import path; the type itself now lives beside the shared scan.
pub use crate::engine::kb_scan::KbMatch;

/// Search all knowledge bases for content similar to the given error query.
///
/// Returns up to `limit` matches sorted by similarity (best first).
/// Thin AppState adapter over [`crate::engine::kb_scan::search_all_kbs`].
/// Called internally by the clipboard watcher and by the command below.
pub fn search_kb_for_error(
    state: &AppState,
    query: &str,
    limit: usize,
) -> Result<Vec<KbMatch>, AppError> {
    let embedding_manager = state
        .embedding_manager
        .as_ref()
        .ok_or_else(|| AppError::Internal("Embedding manager not available".into()))?;
    let vector_store = state
        .vector_store
        .as_ref()
        .ok_or_else(|| AppError::Internal("Vector store not available".into()))?;

    crate::engine::kb_scan::search_all_kbs(
        &state.user_db,
        embedding_manager,
        vector_store,
        query,
        limit,
    )
}

/// Tauri command wrapper for manual KB error search from the frontend.
#[tauri::command]
pub async fn search_kb_for_clipboard_error(
    state: State<'_, Arc<AppState>>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<KbMatch>, AppError> {
    let limit = limit.unwrap_or(3);
    search_kb_for_error(&state, &query, limit)
}
