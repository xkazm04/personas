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
    // When set (non-empty), the message is a *synthetic* prompt forwarded by a
    // frontend surface (e.g. Fleet's "Ask Athena" button), not the user's own
    // words. It persists as a `System` turn tagged with this source label
    // instead of impersonating a user turn. Omitted/empty → a normal user turn.
    system_source: Option<String>,
) -> Result<SendTurnResult, AppError> {
    require_auth(&state).await?;
    let user_db = Arc::new(state.user_db.clone());
    let sys_db = Arc::new(state.db.clone());
    #[cfg(feature = "ml")]
    let embedder = state.embedding_manager.clone();
    let origin = match system_source.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => session::TurnOrigin::External { source: s.to_string() },
        _ => session::TurnOrigin::User,
    };
    // Genuine user input cancels any in-flight autonomous continuation
    // scheduling ("Stop" semantics: user types anything → autonomy yields).
    // A forwarded system request is not the user speaking, so it leaves an
    // autonomous chain alone.
    if matches!(origin, session::TurnOrigin::User) {
        session::cancel_pending_autonomy();
    }
    let turn = session::send_turn(
        &app,
        user_db,
        sys_db,
        #[cfg(feature = "ml")]
        embedder,
        message,
        origin,
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

/// Persist the autonomous-mode toggle server-side. The chat header keeps
/// its own Zustand state for instant UI feedback and passes the flag per
/// `companion_send_message`, but the backend proactive scheduler runs
/// with no frontend call in the loop — it reads this row to decide
/// whether to spawn self-initiated reasoning turns (execution review,
/// etc.). The frontend calls this whenever the toggle flips. Toggling
/// OFF here pairs with `companion_cancel_autonomy` (the panel calls both).
#[tauri::command]
pub fn companion_set_autonomous_mode(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    crate::db::repos::core::settings::set(
        &state.db,
        crate::db::settings_keys::COMPANION_AUTONOMOUS_MODE,
        if enabled { "true" } else { "false" },
    )
}

/// Wake-window setting + last-24h autonomy-impact aggregates
/// (docs/plans/athena-wake-window.md) for the Companion cadence UI.
#[tauri::command]
pub fn companion_wake_stats(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    crate::companion::wake_window::stats_24h(&state.db)
}

/// Read the persisted autonomous-mode flag. Used by the backend
/// proactive scheduler; defaults to `false` (mode off) when the row was
/// never written. Not exposed as an IPC command — the frontend owns the
/// authoritative toggle UI state; this is the scheduler's read path.
pub fn autonomous_mode_enabled(db: &crate::db::DbPool) -> bool {
    matches!(
        crate::db::repos::core::settings::get(db, crate::db::settings_keys::COMPANION_AUTONOMOUS_MODE),
        Ok(Some(v)) if v == "true"
    )
}

/// Run the execution-review pass on demand, bypassing the 5-min scheduler
/// cadence. Runs the batched headless triage over qualifying recent
/// executions (digest card + at most one deep-dive `TurnOrigin::Proactive`
/// turn) and returns how many findings it surfaced. Used by the test
/// harness to drive a deterministic review, and usable as a "review my
/// recent runs now" affordance. Async: the triage awaits one headless CLI
/// decision before returning the count.
#[tauri::command]
pub async fn companion_review_recent_executions_now(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<usize, AppError> {
    crate::ipc_auth::require_auth(&state).await?;
    crate::companion::proactive::execution_review::review_recent_executions(
        &state.user_db,
        &state.db,
        &app,
        #[cfg(feature = "ml")]
        state.embedding_manager.as_ref(),
    )
    .await
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
        // Fleet lifecycle events are written as System episodes here purely so
        // recall/FTS can find them (`fleet-event session:… cc:… state:…`); they
        // are machine logs, not chat content, so they must not render in the
        // transcript. Filtered from display only — still searchable in memory.
        .filter(|e| !e.content.starts_with("fleet-event "))
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
