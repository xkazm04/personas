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
// Threading param (conversation_id) pushed this one arg over clippy's default;
// bundling the flags into a struct is a larger refactor than this warrants.
#[allow(clippy::too_many_arguments)]
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
    // Which conversation (thread) this message belongs to. Omitted → the
    // migrated 'default' ("General") thread, so pre-multiconv callers keep
    // working unchanged.
    conversation_id: Option<String>,
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
    let conversation_id = conversation_id.unwrap_or_else(|| DEFAULT_SESSION_ID.to_string());
    // Genuine user input cancels any in-flight autonomous continuation
    // scheduling in THIS conversation ("Stop" semantics: user types anything
    // → this thread's autonomy yields; other threads' chains keep running —
    // multiconv P1). A forwarded system request is not the user speaking, so
    // it leaves the autonomous chain alone.
    if matches!(origin, session::TurnOrigin::User) {
        session::cancel_pending_autonomy(&conversation_id);
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
        conversation_id,
    )
    .await?;
    Ok(SendTurnResult {
        user_episode_id: turn.user_episode_id,
        assistant_episode_id: turn.assistant_episode_id,
        quick_replies: turn.quick_replies,
        tts_text: turn.tts_text,
    })
}

/// Cancel any pending autonomous-continuation tick — in every conversation
/// (the explicit stop-button is a global brake, unlike the per-thread implicit
/// cancel a user message performs). Idempotent: a no-op if no continuation is
/// scheduled. Does NOT interrupt an in-flight stream — use
/// `companion_interrupt_turn` for that.
#[tauri::command]
pub async fn companion_cancel_autonomy(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    session::cancel_all_pending_autonomy();
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

/// Athena's fleet-orchestration boldness dial (Phase 2). Combines with the
/// self-reported `confidence` and `decision_class` on each `fleet_send_input`
/// proposal to decide auto-fire vs orb consult — see
/// `approvals::fleet_send_input_auto_fires`. `low` confidence never auto-fires
/// at any level. See [`crate::db::settings_keys::COMPANION_FLEET_BOLDNESS`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FleetBoldness {
    /// High-confidence only, both classes (the pre-Phase-2 behaviour).
    Cautious,
    /// `drive_forward` at high|medium; `choice` stays high-only.
    Balanced,
    /// Both classes at high|medium (default).
    Bold,
}

impl FleetBoldness {
    pub fn as_str(self) -> &'static str {
        match self {
            FleetBoldness::Cautious => "cautious",
            FleetBoldness::Balanced => "balanced",
            FleetBoldness::Bold => "bold",
        }
    }

    /// Parse a stored/incoming level string; unknown → the default (Bold).
    pub fn from_setting(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "cautious" => FleetBoldness::Cautious,
            "balanced" => FleetBoldness::Balanced,
            _ => FleetBoldness::Bold,
        }
    }
}

/// Read the persisted fleet-boldness dial; defaults to Bold when unset.
/// Autoapprove-gate read path (not the UI's authoritative state).
pub fn fleet_boldness(db: &crate::db::DbPool) -> FleetBoldness {
    match crate::db::repos::core::settings::get(
        db,
        crate::db::settings_keys::COMPANION_FLEET_BOLDNESS,
    ) {
        Ok(Some(v)) => FleetBoldness::from_setting(&v),
        _ => FleetBoldness::from_setting(crate::db::settings_keys::COMPANION_FLEET_BOLDNESS_DEFAULT),
    }
}

/// Persist the fleet-boldness dial server-side. The frontend keeps its own
/// state for instant UI feedback; the autoapprove gate reads this row. Rejects
/// an unknown level rather than silently coercing it, so the UI can't drift.
#[tauri::command]
pub fn companion_set_fleet_boldness(
    state: State<'_, Arc<AppState>>,
    level: String,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let lvl = level.trim().to_ascii_lowercase();
    let normalized = FleetBoldness::from_setting(&lvl);
    if normalized.as_str() != lvl.as_str() {
        return Err(AppError::Validation(format!(
            "unknown fleet boldness level: {level:?} (expected cautious|balanced|bold)"
        )));
    }
    crate::db::repos::core::settings::set(
        &state.db,
        crate::db::settings_keys::COMPANION_FLEET_BOLDNESS,
        normalized.as_str(),
    )
}

/// Read the persisted fleet-boldness dial so the UI can hydrate on mount.
#[tauri::command]
pub fn companion_get_fleet_boldness(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    Ok(fleet_boldness(&state.db).as_str().to_string())
}

/// Persist the DEV MODE toggle server-side (the wrench in the companion
/// header). Same split as autonomous mode: the frontend keeps Zustand
/// state for instant UI feedback; the backend prompt assembler and the
/// `dev_improve` executor read this row via [`dev_mode_enabled`].
#[tauri::command]
pub fn companion_set_dev_mode(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    crate::db::repos::core::settings::set(
        &state.db,
        crate::db::settings_keys::COMPANION_DEV_MODE,
        if enabled { "true" } else { "false" },
    )
}

/// Read the effective dev-mode flag. Hard-gated on debug builds — a
/// `true` row in a release build reports `false` (defense in depth,
/// mirroring the old self-improve gate in `feedback.rs`): Athena must
/// never treat an end user's installed app as her source workspace.
pub fn dev_mode_enabled(db: &crate::db::DbPool) -> bool {
    cfg!(debug_assertions)
        && matches!(
            crate::db::repos::core::settings::get(db, crate::db::settings_keys::COMPANION_DEV_MODE),
            Ok(Some(v)) if v == "true"
        )
}

/// DEV MODE experiment ledger (Phase 5): recent `dev_improve` runs + the
/// aggregate scoreboard the panel's dev-op strip renders. Returns an empty
/// ledger when dev mode is off (the strip only shows in dev mode anyway) so
/// a stray call in a release build can never leak the workspace history.
#[tauri::command]
pub fn companion_dev_op_ledger(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::companion::dev_mode::DevOpLedger, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    if !dev_mode_enabled(&state.db) {
        return Ok(crate::companion::dev_mode::DevOpLedger::default());
    }
    Ok(crate::companion::dev_mode::DevOpLedger {
        entries: crate::companion::dev_mode::list_dev_ops(&state.user_db, 20),
        metrics: crate::companion::dev_mode::dev_op_metrics(&state.user_db),
    })
}

/// Record (or clear) the user's 👍/👎 verdict on a dev op — the experiment
/// signal Phase 5 accumulates. `verdict` is `"up"`, `"down"`, or `None` to
/// clear; anything else is rejected by [`dev_mode::set_verdict`].
#[tauri::command]
pub fn companion_dev_op_set_verdict(
    state: State<'_, Arc<AppState>>,
    op_id: String,
    verdict: Option<String>,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    crate::companion::dev_mode::set_verdict(&state.user_db, &op_id, verdict.as_deref())
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
    conversation_id: Option<String>,
) -> Result<Vec<CompanionMessage>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let limit = limit.unwrap_or(50).min(500);
    let session_id = conversation_id.unwrap_or_else(|| DEFAULT_SESSION_ID.to_string());
    let episodes = episodic::list_recent(&state.user_db, &session_id, limit)?;
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
    conversation_id: Option<String>,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let session_id = conversation_id.unwrap_or_else(|| DEFAULT_SESSION_ID.to_string());
    crate::companion::session::clear_claude_session_id(&state.user_db, &session_id)?;
    if wipe_transcript.unwrap_or(false) {
        // Multiconv P1: the wipe is scoped to this conversation's episode
        // nodes — resetting one thread never erases the others.
        crate::companion::session::wipe_transcript(&state.user_db, Some(&session_id))?;
    }
    Ok(())
}
