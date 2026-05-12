//! Phase 1 chat commands.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::companion::brain::episodic;
use crate::companion::session::{self, DEFAULT_SESSION_ID};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTurnResult {
    pub user_episode_id: String,
    pub assistant_episode_id: String,
    /// Quick-reply chips Athena offered on this turn. Empty when she
    /// didn't emit any. Frontend renders them under the latest
    /// assistant bubble until the next send fires.
    pub quick_replies: Vec<String>,
    /// Spoken summary suitable for ElevenLabs synthesis. Present when
    /// voice playback is on AND Athena emitted a TTS line. Frontend
    /// auto-plays this if voice is enabled, or stashes it as the
    /// latest unread playback for the footer Play button.
    pub tts_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

/// Send a user message; returns once Claude finishes. Streaming progress
/// arrives on the `companion://stream` Tauri event channel.
///
/// `voice_enabled` controls whether Athena is asked to emit a `TTS:`
/// line in her reply (frontend toggle in the Voice setup or chat
/// toolbar).
///
/// `recall_synthesis_enabled` controls whether the brain's recall
/// retrieval is folded through a one-shot Claude call into a focused
/// briefing when raw recall exceeds the budget threshold. Adds runtime
/// Claude-call cost on dense-recall turns; off by default.
#[tauri::command]
pub async fn companion_send_message(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    message: String,
    voice_enabled: Option<bool>,
    recall_synthesis_enabled: Option<bool>,
    autonomous_mode: Option<bool>,
) -> Result<SendTurnResult, AppError> {
    require_auth(&state).await?;
    let user_db = Arc::new(state.user_db.clone());
    let sys_db = Arc::new(state.db.clone());
    #[cfg(feature = "ml")]
    let embedder = state.embedding_manager.clone();
    // Any new user input cancels any in-flight autonomous continuation
    // scheduling. This is the "Stop" semantics from Q3: user types
    // anything → autonomy yields. (If a continuation is already mid-
    // stream, the user calls `companion_interrupt_turn` separately;
    // here we only drop the pending tokio handle.)
    session::cancel_pending_autonomy();
    let turn = session::send_turn(
        &app,
        user_db,
        sys_db,
        #[cfg(feature = "ml")]
        embedder,
        message,
        session::TurnOrigin::User,
        voice_enabled.unwrap_or(false),
        recall_synthesis_enabled.unwrap_or(false),
        autonomous_mode.unwrap_or(false),
    )
    .await?;
    Ok(SendTurnResult {
        user_episode_id: turn.user_episode_id,
        assistant_episode_id: turn.assistant_episode_id,
        quick_replies: turn.quick_replies,
        tts_text: turn.tts_text,
    })
}

/// Cancel any pending autonomous-continuation tick. Idempotent: a no-
/// op if no continuation is scheduled. Does NOT interrupt an in-flight
/// stream — use `companion_interrupt_turn` for that.
#[tauri::command]
pub async fn companion_cancel_autonomy(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    session::cancel_pending_autonomy();
    Ok(())
}

/// Read the most recent N messages oldest-first for the panel transcript.
#[tauri::command]
pub fn companion_list_recent_messages(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<CompanionMessage>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let limit = limit.unwrap_or(50).min(500);
    let episodes = episodic::list_recent(&state.user_db, DEFAULT_SESSION_ID, limit)?;
    Ok(episodes
        .into_iter()
        .map(|e| CompanionMessage {
            id: e.id,
            role: e.role,
            content: e.content,
            created_at: e.created_at,
        })
        .collect())
}

/// Request that an in-flight turn be interrupted. Idempotent and
/// best-effort: the streaming loop polls the registry every ~200ms,
/// so a click registered between the `Started` event and the first
/// CLI line will land on the next tick. The partial reply is persisted
/// as the assistant episode (tagged `[interrupted by user]`); the CLI
/// session continuity is preserved so the next turn can resume.
///
/// Calling with a turn id that doesn't exist or already finished is a
/// no-op — the registry is cleared by `run_cli` on natural exit.
#[tauri::command]
pub async fn companion_interrupt_turn(
    state: State<'_, Arc<AppState>>,
    turn_id: String,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    crate::companion::session::request_interrupt(&turn_id);
    Ok(())
}

/// Reset the companion conversation.
///
/// Always clears the persistent Claude CLI session id so the next turn
/// starts a fresh server-side session. If `wipe_transcript` is true, also
/// clears the SQL/FTS/vec0 indexes — Athena starts blank. Markdown
/// episodes on disk are preserved either way (no-data-loss principle).
#[tauri::command]
pub fn companion_reset_conversation(
    state: State<'_, Arc<AppState>>,
    wipe_transcript: Option<bool>,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    crate::companion::session::clear_claude_session_id(&state.user_db, DEFAULT_SESSION_ID)?;
    if wipe_transcript.unwrap_or(false) {
        crate::companion::session::wipe_transcript(&state.user_db)?;
    }
    Ok(())
}
