//! Athena multi-conversation commands — the conversation registry IPC surface.
//!
//! See `docs/features/companion/athena-multiconversation.md`. These wrap the
//! `companion::conversation` repo. The per-turn send/stream/reset commands that
//! also gain a `conversationId` live in `chat.rs`.

use std::sync::Arc;

use tauri::State;

use crate::companion::conversation::{self, ConversationRow};
use crate::error::AppError;
use crate::AppState;

/// List conversations (pinned first, then most-recently-active). Always
/// includes the system `default` + `athena-notices` threads (created lazily).
#[tauri::command]
pub fn companion_list_conversations(
    state: State<'_, Arc<AppState>>,
    include_archived: Option<bool>,
) -> Result<Vec<ConversationRow>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    conversation::list(&state.user_db, include_archived.unwrap_or(false))
}

/// Create a fresh conversation. `origin` defaults to `user`.
#[tauri::command]
pub fn companion_create_conversation(
    state: State<'_, Arc<AppState>>,
    title: Option<String>,
    origin: Option<String>,
) -> Result<ConversationRow, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    conversation::create(
        &state.user_db,
        title.as_deref(),
        origin.as_deref().unwrap_or("user"),
    )
}

/// Rename a conversation (user edit, or Athena's auto-title).
#[tauri::command]
pub fn companion_rename_conversation(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
    title: String,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    conversation::rename(&state.user_db, &conversation_id, &title)
}

/// Archive a conversation (soft — transcript stays on disk). The system
/// threads refuse.
#[tauri::command]
pub fn companion_archive_conversation(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    conversation::archive(&state.user_db, &conversation_id)
}

/// Clear a conversation's unread badge as of now.
#[tauri::command]
pub fn companion_mark_conversation_read(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    conversation::mark_read(&state.user_db, &conversation_id)
}
