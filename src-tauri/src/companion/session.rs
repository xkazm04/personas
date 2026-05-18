//! CLI session orchestration for Athena.
//!
//! Each turn: spawn `claude --print --output-format stream-json` (with
//! `--resume <id>` if we already have one), pipe the user message into
//! stdin, parse stream-json lines from stdout, emit them as Tauri events
//! for the panel UI, accumulate the assistant's final text, persist the
//! turn as episodes, and update the persistent claude_session_id pointer.
//!
//! Phase 1: minimal viable loop. Approval cards / op dispatch / dev
//! feedback land in later phases. The companion_session row holds a single
//! `id='default'` pointer; multi-companion support is deferred.

use std::collections::HashSet;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::prompt;
use crate::db::{DbPool, UserDbPool};
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// The single-instance companion session id (Phase 1).
pub const DEFAULT_SESSION_ID: &str = "default";

/// Synthetic user message used to drive autonomous continuation turns.
/// The prompt builder swaps it out for a turn-specific directive; the
/// dispatcher persists it as a `[autonomous]` system episode rather
/// than a regular user turn so the chat transcript stays readable.
///
/// Treat this string as a sentinel — never display it raw, never use
/// it as a real user prompt.
pub const AUTONOMOUS_CONTINUATION_MARKER: &str = "<<athena-autonomous-continuation>>";

/// Delay before the autonomous continuation tick fires. Long enough
/// for the user to interject ("stop", or any new turn) without a
/// race, short enough that long-running tasks don't feel paused.
const AUTONOMOUS_CONTINUATION_DELAY: Duration = Duration::from_secs(15);

/// Hard cap on consecutive autonomous turns to prevent a runaway loop
/// (Athena keeps emitting `continue_autonomously` indefinitely). Once
/// reached, the system stops scheduling continuations until the user
/// sends a fresh message.
const MAX_AUTONOMOUS_CHAIN: u32 = 20;

/// Why a turn was triggered. Drives prompt assembly (different
/// addendum for autonomous ticks), episode persistence (user turns
/// land as User episodes, autonomous ticks as System), and the
/// continuation-loop counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnOrigin {
    /// User typed a message into the panel composer.
    User,
    /// Athena's `continue_autonomously` op triggered a follow-up turn.
    /// `chain_index` is 1-based — the first continuation is 1, second is
    /// 2, etc. Resets to 0 when a User turn lands.
    Autonomous { chain_index: u32 },
}

/// In-flight turn ids that the user has asked to interrupt. `run_cli`
/// polls this set every ~200ms via `tokio::select!`; on hit, it
/// `start_kill()`s the child CLI and returns whatever text was streamed
/// so far so the partial reply still becomes the persisted assistant
/// turn (annotated with `[interrupted]`).
///
/// A plain `Mutex<HashSet<String>>` is fine here — contention is one
/// insert per Stop click, one read every 200ms during a streaming
/// turn; the lock is held for microseconds.
static INTERRUPTED_TURNS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Mark a turn for interruption. The streaming loop will detect it on
/// its next ~200ms tick, kill the child, and finalize whatever text
/// it already received.
pub fn request_interrupt(turn_id: &str) {
    if let Ok(mut g) = INTERRUPTED_TURNS.lock() {
        g.insert(turn_id.to_string());
    }
}

fn was_interrupted(turn_id: &str) -> bool {
    INTERRUPTED_TURNS
        .lock()
        .map(|g| g.contains(turn_id))
        .unwrap_or(false)
}

fn clear_interrupt(turn_id: &str) {
    if let Ok(mut g) = INTERRUPTED_TURNS.lock() {
        g.remove(turn_id);
    }
}

/// Cancellation flag for the in-flight autonomous-continuation tick.
///
/// We use a flag (not a `JoinHandle::abort`) for two reasons:
///
/// 1. `send_turn`'s future is `!Send` (multiple captures across awaits
///    that the Tauri command path tolerates but `tauri::async_runtime
///    ::spawn` doesn't), so we can't put it inside a `spawn` and rely
///    on `abort()` anyway. The scheduler uses `spawn_blocking` with a
///    fresh single-threaded tokio runtime instead — `abort()` on a
///    blocking task is a soft signal, so we'd need a flag here either
///    way.
///
/// 2. The semantics from Q3 are "stop = next user input"; that's a
///    cooperative pause, not a process-kill. A flag the spawned task
///    checks before each potentially-blocking step is exactly that.
static AUTONOMOUS_CANCEL: AtomicBool = AtomicBool::new(false);

/// Set the cancel flag so any pending continuation tick bails out on
/// its next check. No-op if nothing's pending — the flag self-clears
/// when a fresh continuation is scheduled.
pub fn cancel_pending_autonomy() {
    AUTONOMOUS_CANCEL.store(true, Ordering::SeqCst);
}

/// Reset the cancel flag in preparation for a freshly-scheduled tick.
fn reset_autonomous_cancel() {
    AUTONOMOUS_CANCEL.store(false, Ordering::SeqCst);
}

/// Was the in-flight tick cancelled while it was waiting / running?
fn autonomous_was_cancelled() -> bool {
    AUTONOMOUS_CANCEL.load(Ordering::SeqCst)
}

/// Tauri event channel that streams every CLI line to the frontend.
pub const STREAM_EVENT: &str = "companion://stream";

/// Tauri event channel for approval-card creation (Phase 3). Fires once
/// per turn that produced any new approvals.
pub const APPROVALS_EVENT: &str = "companion://approvals";

/// Tauri event channel for direct sidebar navigations triggered by
/// Athena's `open_route` op. Fires once per navigation. Frontend
/// listens and calls `setSidebarSection(route)` without collapsing
/// the chat panel — chat-driven nav is meant to feel transparent.
pub const NAVIGATE_EVENT: &str = "companion://navigate";

/// Tauri event for "open this persona's lab tab and select mode X" —
/// Athena's `open_lab` op. Payload: `{ personaId, mode }`. Bypasses
/// approval like NAVIGATE_EVENT; the persona editor reads this and
/// jumps the user there.
pub const OPEN_LAB_EVENT: &str = "companion://open-lab";

/// Tauri event for `compose_dashboard` auto-fire. Payload is empty —
/// the spec is already persisted server-side; the frontend just needs
/// to navigate to the Companion → Dashboard tab so the user sees it.
pub const COMPOSE_DASHBOARD_EVENT: &str = "companion://compose-dashboard";

/// Tauri event for `compose_cockpit` auto-fire. Same shape as
/// `COMPOSE_DASHBOARD_EVENT` — empty payload; the spec is already
/// persisted; the frontend navigates to Home → Cockpit on receipt.
pub const COMPOSE_COCKPIT_EVENT: &str = "companion://compose-cockpit";

/// Tauri event for inline chat-cards emitted via `show_persona_overview`,
/// `show_connected_services`, `show_decisions`. Payload is the list of cards
/// for this turn; the frontend appends them to the latest assistant bubble.
/// Auto-fire — no approval, no server-side persistence (transient UI).
pub const CHAT_CARDS_EVENT: &str = "companion://chat-cards";

/// Per-turn rollup of what Athena's brain pulled into the system prompt:
/// counts + glanceable titles per memory kind. Emitted once per turn, right
/// after the prompt is built and right before the CLI spawn. Payload is a
/// `RecallPreviewEvent { sessionId, turnId, preview }`. The frontend renders
/// a small "Athena consulted N memories" strip above the streaming bubble.
pub const RECALL_PREVIEW_EVENT: &str = "companion://recall-preview";

/// Wire shape for `RECALL_PREVIEW_EVENT`. `preview` is the same shape as
/// `prompt::RecallPreview` (serialized camelCase). Carrying `turn_id` lets
/// the frontend correlate the strip with the streaming bubble that's
/// about to fill in for this turn; carrying `session_id` mirrors every
/// other companion event for forward compatibility (multi-session is on
/// the roadmap, even though Phase 1 ships a single default session).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallPreviewEvent {
    pub session_id: String,
    pub turn_id: String,
    pub preview: crate::companion::prompt::RecallPreview,
}

/// Per-turn rollup of side-effects the dispatcher produced from Athena's
/// reply: how many approvals were filed, how many direct nav/lab/dashboard/
/// cockpit/chat-card auto-fires happened, and whether she requested an
/// autonomous continuation. Emitted once after the dispatcher block, with
/// `assistant_episode_id` already known so the frontend can key the chip
/// directly under the persisted bubble. No persistence — the chip is
/// session-scoped UI, same lifecycle as `RECALL_PREVIEW_EVENT`.
pub const TURN_SUMMARY_EVENT: &str = "companion://turn-summary";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSummaryEvent {
    pub session_id: String,
    pub turn_id: String,
    pub assistant_episode_id: String,
    pub approvals: u32,
    pub navigations: u32,
    pub lab_opens: u32,
    pub dashboards: u32,
    pub cockpits: u32,
    pub chat_cards: u32,
    /// Athena emitted `OP: continue_autonomously` — the next tick is
    /// either scheduled or capped (caller decides). Surfaced as a flag
    /// because "she said she'd keep going" is its own glanceable signal.
    pub continuation: bool,
}

/// What `send_turn` returns to the chat command. The IDs let the UI
/// reconcile the optimistic bubble with persisted episodes; the
/// `quick_replies` carry Athena's QR offerings for this specific turn
/// (transient — UI shows them on the latest assistant bubble until the
/// next send fires); `tts_text` carries her spoken-version line if she
/// emitted one (frontend feeds this into ElevenLabs playback).
#[derive(Debug, Clone)]
pub struct TurnResult {
    pub user_episode_id: String,
    pub assistant_episode_id: String,
    pub quick_replies: Vec<String>,
    pub tts_text: Option<String>,
    /// Athena emitted `OP: continue_autonomously` this turn. The caller
    /// (or the post-turn scheduler in this module) inspects this to
    /// decide whether to fire a continuation tick.
    pub requests_continuation: bool,
}

/// Hard ceiling per turn — Athena is designed to run long background
/// tasks (codebase scans, idea generation, multi-step reasoning).
/// 15 minutes is enough for the longest realistic flow without
/// holding a stuck CLI forever. Mirrors the frontend's
/// `COMPANION_TURN_TIMEOUT_MS`; if you change one, change the other.
const TURN_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// One streamed event sent to the frontend. The JSON `payload` is the raw
/// stream-json line so the UI can render thinking/tool-use/text indicators
/// as they arrive without a server-side state machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub session_id: String,
    pub turn_id: String,
    pub kind: StreamEventKind,
    /// Raw stream-json line for `kind=Cli`, free-form text otherwise.
    pub payload: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamEventKind {
    /// Spawn started, persisted user episode id is in payload.
    Started,
    /// One stream-json line from the CLI.
    Cli,
    /// Final assistant episode persisted, payload is the assistant episode id.
    Finished,
    /// Anything that prevented finishing.
    Error,
}

/// Run one full turn: persist the user message, call Claude, stream events,
/// persist the assistant reply. Returns (user_episode_id, assistant_episode_id).
///
/// Streams progress via Tauri events on `STREAM_EVENT` so the UI updates
/// incrementally. The final returned ids let the caller link UI state to
/// persisted episodes.
pub async fn send_turn(
    app: &AppHandle,
    user_db: Arc<UserDbPool>,
    sys_db: Arc<DbPool>,
    #[cfg(feature = "ml")] embedder: Option<Arc<EmbeddingManager>>,
    user_message: String,
    origin: TurnOrigin,
    voice_enabled: bool,
    recall_synthesis_enabled: bool,
    autonomous_mode: bool,
) -> Result<TurnResult, AppError> {
    let session_id = DEFAULT_SESSION_ID.to_string();
    let turn_id = format!("turn_{}", short_random());

    // Sweep any orphaned self-improve runs so their outcome shows up in
    // this turn's transcript (the detached CLI may have finished after
    // the previous parent-restart). Best-effort: a failure here doesn't
    // block the chat turn.
    #[cfg(feature = "ml")]
    {
        let _ =
            crate::companion::dev_session::recover_orphan_improvements(&user_db, embedder.as_ref())
                .await;
    }
    #[cfg(not(feature = "ml"))]
    {
        let _ = crate::companion::dev_session::recover_orphan_improvements(&user_db).await;
    }

    // Persist the turn-opening episode. User turns land as `User`;
    // autonomous continuation ticks land as `System` with a marker so
    // the transcript visibly distinguishes "the user typed this" from
    // "Athena gave herself another turn". For autonomous, the CLI
    // receives a directive (see `effective_user_message` below) — we
    // never persist the marker token verbatim.
    let (open_role, open_content) = match origin {
        TurnOrigin::User => (EpisodeRole::User, user_message.clone()),
        TurnOrigin::Autonomous { chain_index } => (
            EpisodeRole::System,
            format!("[autonomous continuation #{chain_index}]"),
        ),
    };
    let user_ep_id = {
        #[cfg(feature = "ml")]
        {
            match &embedder {
                Some(emb) => {
                    episodic::append_episode_and_embed(
                        &user_db,
                        emb,
                        &session_id,
                        open_role,
                        &open_content,
                    )
                    .await?
                }
                None => episodic::append_episode(
                    &user_db,
                    &session_id,
                    open_role,
                    &open_content,
                )?,
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            episodic::append_episode(&user_db, &session_id, open_role, &open_content)?
        }
    };

    emit(
        app,
        StreamEvent {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            kind: StreamEventKind::Started,
            payload: user_ep_id.clone(),
        },
    );

    // Read the prior claude session id (if any) for --resume.
    let claude_session_id = read_claude_session_id(&user_db, &session_id)?;

    // What the CLI actually receives on stdin. For user turns, that's
    // the raw message. For autonomous ticks, the marker token never
    // reaches the model — it's a sentinel only the persistence layer
    // sees; the CLI gets a real directive crafted here.
    let effective_user_message: String = match origin {
        TurnOrigin::User => user_message.clone(),
        TurnOrigin::Autonomous { chain_index } => format!(
            "Continue your autonomous work. This is continuation turn #{chain_index} of up to {max}. \
             Review what you've done so far. Either make concrete progress on the open task or, if \
             you've reached a natural stopping point or need user input, finalize without emitting \
             another `continue_autonomously` op.",
            max = MAX_AUTONOMOUS_CHAIN
        ),
    };

    let (system_prompt, recall_preview) = {
        #[cfg(feature = "ml")]
        {
            prompt::build_system_prompt(
                &user_db,
                &sys_db,
                embedder.as_ref(),
                &session_id,
                &effective_user_message,
                voice_enabled,
                recall_synthesis_enabled,
                autonomous_mode,
            )
            .await?
        }
        #[cfg(not(feature = "ml"))]
        {
            prompt::build_system_prompt(
                &user_db,
                &sys_db,
                &session_id,
                &effective_user_message,
                voice_enabled,
                recall_synthesis_enabled,
                autonomous_mode,
            )
            .await?
        }
    };

    // Surface what the brain pulled into the prompt so the panel can show
    // a "Athena consulted N memories" strip above the streaming bubble.
    // Best-effort: a failed emit just means no strip this turn — never
    // block the actual chat reply on UI bookkeeping.
    if let Err(e) = app.emit(
        RECALL_PREVIEW_EVENT,
        RecallPreviewEvent {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            preview: recall_preview,
        },
    ) {
        tracing::warn!(error = %e, "companion recall preview event emit failed");
    }

    let assistant_text = match timeout(
        TURN_TIMEOUT,
        run_cli(
            app,
            &turn_id,
            &session_id,
            claude_session_id.as_deref(),
            &system_prompt,
            &effective_user_message,
            &user_db,
        ),
    )
    .await
    {
        Ok(Ok(text)) => text,
        // Self-heal: if Claude can't find the resumed session id (deleted,
        // expired, or never existed), clear the stale pointer and retry
        // once with a fresh session. Every prior episode is still in the
        // system prompt via retrieval, so context isn't lost — only the
        // CLI's internal session continuity is.
        Ok(Err(e)) if is_stale_session_error(&e) && claude_session_id.is_some() => {
            tracing::warn!(
                stale_id = ?claude_session_id,
                "companion: --resume failed (stale session), retrying with fresh CLI session"
            );
            clear_claude_session_id(&user_db, &session_id)?;
            match timeout(
                TURN_TIMEOUT,
                run_cli(
                    app,
                    &turn_id,
                    &session_id,
                    None,
                    &system_prompt,
                    &user_message,
                    &user_db,
                ),
            )
            .await
            {
                Ok(Ok(text)) => text,
                Ok(Err(e2)) => {
                    emit_error(app, &session_id, &turn_id, &e2.to_string());
                    return Err(e2);
                }
                Err(_) => {
                    let msg = "Turn exceeded 5-minute timeout (after session reset)";
                    emit_error(app, &session_id, &turn_id, msg);
                    return Err(AppError::Internal(msg.into()));
                }
            }
        }
        Ok(Err(e)) => {
            emit_error(app, &session_id, &turn_id, &e.to_string());
            return Err(e);
        }
        Err(_) => {
            let msg = "Turn exceeded 5-minute timeout";
            emit_error(app, &session_id, &turn_id, msg);
            return Err(AppError::Internal(msg.into()));
        }
    };

    // Phase 3: extract any `{"op":...}` proposals from Athena's reply,
    // persist them as approval rows, and strip them from the displayed
    // text. The episode stores the cleaned text — what the user sees in
    // the chat — so future turns' transcript is clean too.
    let dispatched =
        match crate::companion::dispatcher::dispatch(&user_db, &session_id, &assistant_text) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(error = %e, "companion dispatcher failed; using raw text");
                crate::companion::dispatcher::Dispatched {
                    cleaned_text: assistant_text.clone(),
                    approvals: Vec::new(),
                    navigations: Vec::new(),
                    lab_opens: Vec::new(),
                    dashboards: Vec::new(),
                    cockpits: Vec::new(),
                    chat_cards: Vec::new(),
                    quick_replies: Vec::new(),
                    tts_text: None,
                    requests_continuation: false,
                    warnings: vec![format!("dispatcher error: {e}")],
                }
            }
        };
    let display_text = if dispatched.cleaned_text.trim().is_empty() {
        // The whole reply was ops with no prose. Don't render an empty
        // bubble — replace with a tiny placeholder.
        "(proposing actions — see cards below)".to_string()
    } else {
        dispatched.cleaned_text.clone()
    };

    let assistant_ep_id = {
        #[cfg(feature = "ml")]
        {
            match &embedder {
                Some(emb) => {
                    episodic::append_episode_and_embed(
                        &user_db,
                        emb,
                        &session_id,
                        EpisodeRole::Assistant,
                        &display_text,
                    )
                    .await?
                }
                None => episodic::append_episode(
                    &user_db,
                    &session_id,
                    EpisodeRole::Assistant,
                    &display_text,
                )?,
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            episodic::append_episode(&user_db, &session_id, EpisodeRole::Assistant, &display_text)?
        }
    };

    if !dispatched.approvals.is_empty() {
        if let Err(e) = app.emit(APPROVALS_EVENT, &dispatched.approvals) {
            tracing::warn!(error = %e, "companion approvals event emit failed");
        }
    }

    // Fire navigation events for any open_route ops Athena emitted.
    // The frontend handles them inline (sidebar switch, panel stays
    // open). One event per navigation in case Athena ever chains them
    // (rare, but supported).
    for route in &dispatched.navigations {
        if let Err(e) = app.emit(NAVIGATE_EVENT, route) {
            tracing::warn!(error = %e, route = %route, "companion navigate event emit failed");
        }
    }

    // Phase F: open_lab ops — fire one event per (persona_id, mode).
    // The persona editor listens and switches tabs without nagging the
    // user with an approval card, same UX as open_route.
    for (persona_id, mode) in &dispatched.lab_opens {
        let payload = serde_json::json!({
            "personaId": persona_id,
            "mode": mode,
        });
        if let Err(e) = app.emit(OPEN_LAB_EVENT, payload) {
            tracing::warn!(error = %e, "companion open_lab event emit failed");
        }
    }

    // Phase F: compose_dashboard auto-fire. Persist each spec, then
    // emit a compose-dashboard event so the frontend navigates the
    // user straight to the Dashboard tab. If multiple specs landed in
    // one turn (rare — Athena should pick the latest), we save and
    // emit for each, but the singleton write naturally collapses.
    for spec_json in &dispatched.dashboards {
        if let Err(e) = crate::companion::brain::dashboard::save_dashboard(&user_db, spec_json) {
            tracing::warn!(error = %e, "companion compose_dashboard save failed");
            continue;
        }
        if let Err(e) = app.emit(COMPOSE_DASHBOARD_EVENT, serde_json::json!({})) {
            tracing::warn!(error = %e, "companion compose_dashboard event emit failed");
        }
    }

    // compose_cockpit auto-fire. Same shape as dashboards above — persist
    // each spec then emit the navigate event so the frontend jumps to
    // Home → Cockpit on receipt.
    //
    // Uses `save_cockpit_preserving_pinned` so any user-pinned widgets
    // from the prior spec carry through. Without that, the user would
    // pin a widget → Athena composes anything → pin disappears.
    for spec_json in &dispatched.cockpits {
        if let Err(e) =
            crate::companion::brain::cockpit::save_cockpit_preserving_pinned(&user_db, spec_json)
        {
            tracing::warn!(error = %e, "companion compose_cockpit save failed");
            continue;
        }
        if let Err(e) = app.emit(COMPOSE_COCKPIT_EVENT, serde_json::json!({})) {
            tracing::warn!(error = %e, "companion compose_cockpit event emit failed");
        }
    }

    // Inline chat-cards. Transient (no persistence) — emit once per turn
    // with the full list so the frontend appends to the latest bubble.
    if !dispatched.chat_cards.is_empty() {
        let payload = serde_json::json!({
            "turnId": turn_id.clone(),
            "cards": dispatched.chat_cards,
        });
        if let Err(e) = app.emit(CHAT_CARDS_EVENT, payload) {
            tracing::warn!(error = %e, "companion chat_cards event emit failed");
        }
    }

    // Per-turn rollup of dispatcher side-effects. The chip on each
    // completed bubble reads this; total=0 turns get nothing. Best-effort —
    // a missed emit just means no chip for that turn.
    {
        let summary = TurnSummaryEvent {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            assistant_episode_id: assistant_ep_id.clone(),
            approvals: dispatched.approvals.len() as u32,
            navigations: dispatched.navigations.len() as u32,
            lab_opens: dispatched.lab_opens.len() as u32,
            dashboards: dispatched.dashboards.len() as u32,
            cockpits: dispatched.cockpits.len() as u32,
            chat_cards: dispatched.chat_cards.len() as u32,
            continuation: dispatched.requests_continuation,
        };
        if let Err(e) = app.emit(TURN_SUMMARY_EVENT, summary) {
            tracing::warn!(error = %e, "companion turn summary event emit failed");
        }
    }

    emit(
        app,
        StreamEvent {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            kind: StreamEventKind::Finished,
            payload: assistant_ep_id.clone(),
        },
    );

    // A2 — autonomous continuation. Schedule the next tick if:
    //   1. The session is in autonomous mode.
    //   2. Athena emitted `OP: continue_autonomously` this turn.
    //   3. We haven't hit MAX_AUTONOMOUS_CHAIN yet.
    // User-message arrivals call `cancel_pending_autonomy` first
    // (see commands/companion/chat.rs::companion_send_message), so a
    // pending handle here is always for a chain Athena requested and
    // the user hasn't intercepted.
    if autonomous_mode && dispatched.requests_continuation {
        let next_chain = match origin {
            TurnOrigin::User => 1,
            TurnOrigin::Autonomous { chain_index } => chain_index + 1,
        };
        if next_chain > MAX_AUTONOMOUS_CHAIN {
            tracing::info!(
                next_chain,
                max = MAX_AUTONOMOUS_CHAIN,
                "autonomous chain hit hard ceiling — not scheduling another tick"
            );
        } else {
            schedule_autonomous_tick(
                app.clone(),
                user_db.clone(),
                sys_db.clone(),
                #[cfg(feature = "ml")]
                embedder.clone(),
                next_chain,
                voice_enabled,
                recall_synthesis_enabled,
            );
        }
    }

    Ok(TurnResult {
        user_episode_id: user_ep_id,
        assistant_episode_id: assistant_ep_id,
        quick_replies: dispatched.quick_replies,
        tts_text: dispatched.tts_text,
        requests_continuation: dispatched.requests_continuation,
    })
}

/// Schedule the next autonomous turn on a dedicated blocking thread
/// with its own single-threaded tokio runtime.
///
/// Why blocking + current-thread: `send_turn` returns a `!Send` future
/// (Tauri command path tolerates that; `tauri::async_runtime::spawn`
/// does not). A blocking thread isn't bound by Send because no work-
/// stealing happens — the future runs on one thread for its lifetime.
///
/// Cancellation: the body polls `AUTONOMOUS_CANCEL` every 200ms
/// during the delay and before kicking off `send_turn`. A user message
/// sets the flag (`cancel_pending_autonomy`) so the tick aborts before
/// spinning up CLI work. Once `send_turn` is in flight, `A5`'s mid-
/// stream interrupt handles cancellation of the CLI process itself.
fn schedule_autonomous_tick(
    app: AppHandle,
    user_db: Arc<UserDbPool>,
    sys_db: Arc<DbPool>,
    #[cfg(feature = "ml")] embedder: Option<Arc<EmbeddingManager>>,
    chain_index: u32,
    voice_enabled: bool,
    recall_synthesis_enabled: bool,
) {
    reset_autonomous_cancel();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        // Poll the cancel flag while waiting out the delay. A coarse
        // 200ms tick is plenty — the delay itself is 15s; finer polling
        // wouldn't change the user's experience.
        let started = Instant::now();
        while started.elapsed() < AUTONOMOUS_CONTINUATION_DELAY {
            if autonomous_was_cancelled() {
                tracing::debug!("autonomous tick cancelled during delay");
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        if autonomous_was_cancelled() {
            tracing::debug!("autonomous tick cancelled at delay boundary");
            return;
        }

        // Single-threaded tokio runtime for this tick. send_turn awaits
        // multiple `!Send` futures (rusqlite-touching helpers, the CLI
        // child process); current-thread doesn't require Send.
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                tracing::warn!(error = %e, "autonomous tick: failed to build runtime");
                return;
            }
        };
        rt.block_on(async move {
            let res = send_turn(
                &app,
                user_db,
                sys_db,
                #[cfg(feature = "ml")]
                embedder,
                AUTONOMOUS_CONTINUATION_MARKER.to_string(),
                TurnOrigin::Autonomous { chain_index },
                voice_enabled,
                recall_synthesis_enabled,
                true, // autonomous_mode — by definition true for a tick
            )
            .await;
            if let Err(e) = res {
                tracing::warn!(error = %e, "autonomous continuation tick failed");
            }
        });
    });
}

async fn run_cli(
    app: &AppHandle,
    turn_id: &str,
    session_id: &str,
    claude_session_id: Option<&str>,
    system_prompt: &str,
    user_message: &str,
    pool: &UserDbPool,
) -> Result<String, AppError> {
    let (cmd_program, mut argv) = base_cli_invocation();

    // Resume if we have a session id, otherwise fresh.
    if let Some(sid) = claude_session_id {
        argv.extend(["--resume".into(), sid.into()]);
    }

    // Write the system prompt to a temp file. Inline `--system-prompt`
    // works on small prompts but breaks at the OS arg-length limit
    // (Windows ~32k); the prompt grows fast once retrieval kicks in.
    // The file is removed after the CLI exits.
    let prompt_file = write_temp_prompt(system_prompt)?;

    // --system-prompt-file fully replaces Claude Code's default identity
    // prompt. We avoid `--bare` because it disables OAuth/keychain auth
    // and would force the user to set ANTHROPIC_API_KEY explicitly.
    // Default Claude Code framework loads, but our prompt dominates.
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        "claude-opus-4-7".into(),
        "--system-prompt-file".into(),
        prompt_file.to_string_lossy().to_string(),
    ]);

    // Spawn from the user's home directory (or a benign fallback) so we
    // don't auto-pick up the Personas project's CLAUDE.md as context.
    let cwd = dirs::home_dir().unwrap_or_else(|| std::env::temp_dir());

    let mut child = Command::new(&cmd_program)
        .args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .env("CLAUDE_CODE_DISABLE_TERMINAL_TITLE", "1")
        // Enable fork-style subagent dispatch (2.1.117+) — when Athena
        // uses the Task tool, the child inherits her full conversation
        // history, runs in background, and shares the prompt cache.
        // Cheaper than a named subagent and gives the autonomous loop
        // a way to "send a copy of herself to investigate" without
        // re-priming context. Harmless on older CLI versions (env var
        // is ignored if the feature isn't recognized).
        .env("CLAUDE_CODE_FORK_SUBAGENT", "1")
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude: {e}")))?;

    // Pipe the user message in via stdin.
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(user_message.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("write claude stdin: {e}")))?;
        // Closing stdin signals end-of-prompt.
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("claude stdout missing".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    // Drain stderr concurrently into a buffer so we can include it in
    // any failure message. Without this, exit-1 produces a useless
    // "claude exited with status 1" with no diagnostic context.
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("claude stderr missing".into()))?;
    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stderr_handle = {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut g = buf.lock().await;
                if !g.is_empty() {
                    g.push('\n');
                }
                g.push_str(&line);
            }
        })
    };

    let mut assistant_text = String::new();
    let mut new_claude_session_id: Option<String> = None;
    let mut interrupt_tick = tokio::time::interval(Duration::from_millis(200));
    // Skip the immediate first tick — `interval` fires once at t=0 by
    // default, which would race the kill check before we've read a
    // single line.
    interrupt_tick.tick().await;
    let mut interrupted = false;

    loop {
        tokio::select! {
            // Favor stdout reads over the interrupt tick — we never want
            // to miss a line just because the timer happened to fire on
            // the same loop iteration.
            biased;
            line_result = reader.next_line() => {
                match line_result {
                    Ok(Some(line)) => {
                        emit(
                            app,
                            StreamEvent {
                                session_id: session_id.to_string(),
                                turn_id: turn_id.to_string(),
                                kind: StreamEventKind::Cli,
                                payload: line.clone(),
                            },
                        );

                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                            if value.get("type").and_then(|v| v.as_str()) == Some("system") {
                                if let Some(sid) = value.get("session_id").and_then(|v| v.as_str()) {
                                    new_claude_session_id = Some(sid.to_string());
                                }
                            }
                            if value.get("type").and_then(|v| v.as_str()) == Some("assistant") {
                                if let Some(content) = value
                                    .get("message")
                                    .and_then(|m| m.get("content"))
                                    .and_then(|c| c.as_array())
                                {
                                    for block in content {
                                        if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                                if !assistant_text.is_empty() {
                                                    assistant_text.push('\n');
                                                }
                                                assistant_text.push_str(text);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Ok(None) => break, // EOF — CLI finished naturally
                    Err(e) => {
                        return Err(AppError::Internal(format!("read claude stdout: {e}")));
                    }
                }
            }
            _ = interrupt_tick.tick() => {
                if was_interrupted(turn_id) {
                    interrupted = true;
                    // Best-effort kill — if it fails the CLI will still
                    // finish on its own; we just stop reading.
                    let _ = child.start_kill();
                    break;
                }
            }
        }
    }

    // Clear the registry entry whether we hit it or not so a future
    // turn with a coincidentally-similar id isn't pre-cancelled.
    clear_interrupt(turn_id);

    if interrupted {
        // Drain whatever's still queued so the child can exit cleanly
        // and we don't leak a zombie. Don't surface read errors here —
        // a killed child often EOFs partway through a frame.
        while let Ok(Some(_)) = reader.next_line().await {}
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("wait claude: {e}")))?;
    let _ = stderr_handle.await;
    let stderr_text = stderr_buf.lock().await.clone();
    // Best-effort: clean up the temp prompt file. Failure is harmless.
    let _ = std::fs::remove_file(&prompt_file);

    // Interrupt path: the user clicked Stop. We killed the child, so a
    // non-success exit is expected. Persist whatever streamed (or a
    // placeholder if nothing did) and tag it so the transcript shows
    // the partial nature. The CLI session pointer is also persisted —
    // an interrupted turn still counts toward conversation continuity.
    if interrupted {
        if let Some(sid) = new_claude_session_id {
            upsert_claude_session_id(pool, session_id, &sid)?;
        }
        let body = if assistant_text.trim().is_empty() {
            "_(interrupted before any reply was generated)_".to_string()
        } else {
            format!("{assistant_text}\n\n_[interrupted by user]_")
        };
        return Ok(body);
    }

    if !status.success() {
        let trimmed = if stderr_text.len() > 600 {
            format!("{}…", &stderr_text[..600])
        } else {
            stderr_text.clone()
        };
        return Err(AppError::Internal(format!(
            "claude exited with status {status}: {trimmed}"
        )));
    }

    // Persist the (possibly new) claude session id for next turn's --resume.
    if let Some(sid) = new_claude_session_id {
        upsert_claude_session_id(pool, session_id, &sid)?;
    }

    if assistant_text.is_empty() {
        return Err(AppError::Internal(
            "claude produced no assistant text".into(),
        ));
    }

    Ok(assistant_text)
}

/// Was this CLI failure caused by an expired/missing --resume session id?
/// We match liberally on the known message patterns the CLI emits so this
/// keeps working across CLI version drift.
fn is_stale_session_error(e: &AppError) -> bool {
    let msg = e.to_string().to_lowercase();
    msg.contains("no conversation found")
        || msg.contains("session id")
            && (msg.contains("not found") || msg.contains("does not exist"))
}

/// Clear the persisted claude_session_id so the next turn starts a fresh
/// CLI session. The episodic transcript is untouched — every prior turn is
/// still on disk and re-enters the prompt via retrieval.
pub fn clear_claude_session_id(pool: &UserDbPool, session_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_session SET claude_session_id = NULL, last_active_at = datetime('now') WHERE id = ?1",
        params![session_id],
    )?;
    Ok(())
}

/// Wipe the conversation transcript so Athena starts fresh.
///
/// Scope (deliberate):
///   - SQL: deletes episode rows from `companion_node`, plus their
///     companion_fts and companion_embedding entries. **Doctrine, identity,
///     and any other node kinds are preserved** — earlier versions of this
///     function blindly truncated all FTS / vec0 rows, which silently
///     wiped doctrine and forced a full re-ingest on the next start.
///   - Disk: renames `<brain>/episodes/` to `<brain>/episodes-archive-<ts>/`
///     so the markdown source-of-truth isn't actually destroyed (no-data-
///     loss principle), but the next turn sees an empty episodes dir.
///     A fresh empty `episodes/` is recreated.
///   - Identity, constitution, doctrine, semantic facts: untouched.
pub fn wipe_transcript(pool: &UserDbPool) -> Result<(), AppError> {
    let conn = pool.get()?;

    // Collect episode IDs first; we need them for the FTS + vec0 deletes
    // before we drop the parent node rows.
    let episode_ids: Vec<String> =
        match conn.prepare("SELECT id FROM companion_node WHERE kind = 'episode'") {
            Ok(mut stmt) => stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        };

    if !episode_ids.is_empty() {
        let placeholders = episode_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let p: Vec<&dyn rusqlite::ToSql> = episode_ids
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();

        let _ = conn.execute(
            &format!("DELETE FROM companion_fts WHERE node_id IN ({placeholders})"),
            p.as_slice(),
        );
        // vec0 table is created lazily; this is best-effort.
        let _ = conn.execute(
            &format!("DELETE FROM companion_embedding WHERE node_id IN ({placeholders})"),
            p.as_slice(),
        );
        let _ = conn.execute(
            &format!("DELETE FROM companion_node WHERE id IN ({placeholders})"),
            p.as_slice(),
        );
    }

    // Archive the on-disk episodes folder. Failure here is non-fatal —
    // SQL has already been wiped, which is what the UI binds to.
    if let Ok(root) = crate::companion::disk::brain_root() {
        let episodes = root.join("episodes");
        if episodes.exists() {
            let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S");
            let archived = root.join(format!("episodes-archive-{stamp}"));
            if std::fs::rename(&episodes, &archived).is_ok() {
                let _ = std::fs::create_dir_all(&episodes);
                tracing::info!(archive = %archived.display(), "companion: wiped episodes — old set archived");
            }
        }
    }

    Ok(())
}

fn write_temp_prompt(content: &str) -> Result<std::path::PathBuf, AppError> {
    let path = std::env::temp_dir().join(format!("athena-prompt-{}.md", short_random()));
    std::fs::write(&path, content)
        .map_err(|e| AppError::Internal(format!("write prompt file: {e}")))?;
    Ok(path)
}

/// Resolve the platform-correct invocation for the Claude CLI.
/// On Windows we go via `cmd.exe /C claude.cmd` because the CLI is a
/// .cmd shim and a direct spawn doesn't see PATH the way the shell does.
/// On Unix the binary itself is on PATH.
///
/// Public so the consolidation + reflection one-shots can reuse the
/// same invocation pattern instead of duplicating the platform check.
pub fn base_cli_invocation() -> (String, Vec<String>) {
    if cfg!(windows) {
        ("cmd".into(), vec!["/C".into(), "claude.cmd".into()])
    } else {
        ("claude".into(), vec![])
    }
}

fn read_claude_session_id(pool: &UserDbPool, session_id: &str) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let val = conn
        .query_row(
            "SELECT claude_session_id FROM companion_session WHERE id = ?1",
            params![session_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    Ok(val.flatten())
}

fn upsert_claude_session_id(
    pool: &UserDbPool,
    session_id: &str,
    claude_session_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_session (id, claude_session_id, last_active_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           claude_session_id = excluded.claude_session_id,
           last_active_at    = datetime('now')",
        params![session_id, claude_session_id],
    )?;
    Ok(())
}

fn emit(app: &AppHandle, ev: StreamEvent) {
    if let Err(e) = app.emit(STREAM_EVENT, &ev) {
        tracing::warn!(error = %e, "companion stream emit failed");
    }
}

fn emit_error(app: &AppHandle, session_id: &str, turn_id: &str, msg: &str) {
    emit(
        app,
        StreamEvent {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            kind: StreamEventKind::Error,
            payload: msg.to_string(),
        },
    );
}

fn short_random() -> String {
    uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect()
}
