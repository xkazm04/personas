//! Tauri command surface for the Companion (Athena) plugin.
//!
//! Phase 0 ships only `companion_init` — the rest of the surface
//! (chat send, stream, approve/reject, brain queries, consolidation,
//! dev feedback, observability digest) lands in Phase 1+.

pub mod brain;
pub mod chat;
pub mod consolidate;
pub mod feedback;
pub mod observability;

use std::sync::Arc;
use tauri::State;

use crate::companion::disk;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Initialize the companion-brain disk layout. Idempotent — safe to call
/// on every app start. Returns the absolute path to the brain root for
/// debugging / display purposes.
#[tauri::command]
pub fn companion_init(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let root = disk::ensure_initialized()?;
    Ok(root.display().to_string())
}
