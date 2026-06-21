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
use std::sync::atomic::{AtomicU64, Ordering};
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnOrigin {
    /// User typed a message into the panel composer.
    User,
    /// Athena's `continue_autonomously` op triggered a follow-up turn.
    /// `chain_index` is 1-based — the first continuation is 1, second is
    /// 2, etc. Resets to 0 when a User turn lands.
    Autonomous { chain_index: u32 },
    /// A backend trigger (the proactive scheduler, or an app-event
    /// subscriber) woke Athena to reason about something that happened
    /// on its own — e.g. a persona execution finished and she should
    /// analyze it. Distinct from `Autonomous`: this is the FIRST turn
    /// of a self-initiated thread, not a continuation of a user chain.
    /// The caller builds the synthetic directive and passes it as
    /// `user_message`; the opening episode persists as `System` with a
    /// `[proactive: <trigger_kind>]` marker so the transcript shows the
    /// turn was machine-initiated, not user-typed.
    ///
    /// `trigger_kind` / `trigger_ref` mirror the proactive `Nudge`
    /// fields so a turn can be traced back to what woke it (and deduped
    /// against re-firing on the same execution).
    Proactive {
        trigger_kind: String,
        trigger_ref: Option<String>,
    },
    /// A frontend surface forwarded a *synthetic* prompt that is NOT the
    /// user's own words — e.g. Fleet's "Ask Athena" button sends a crafted
    /// stale-session directive. The user clicked a button, but the text is the
    /// system's, so it must not impersonate a user turn: it persists as
    /// `System` with a `[<source>]` marker (the chat renders it as a system
    /// divider, not a user bubble) and the model is told the provenance.
    /// `source` is a short human label, e.g. "Fleet".
    External { source: String },
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
/// Monotonic generation counter for autonomous continuation ticks. Each
/// scheduled tick captures the current value; cancelling advances it. A tick
/// aborts as soon as the global value no longer matches the one it captured.
///
/// This replaces a single `AtomicBool` that was *reset* on every new schedule:
/// a user "stop" set the bool, but if that same turn's reply also emitted
/// `continue_autonomously`, `schedule_autonomous_tick` reset the bool and the
/// originally-pending tick — still polling — saw `cancelled == false` and fired,
/// so the loop the user halted kept running (bug-hunt 2026-06-07 companion #1).
/// A generation token is never reset (only advanced), so a stale tick can never
/// be revived by a later schedule.
static AUTONOMOUS_GEN: AtomicU64 = AtomicU64::new(0);

/// Cancel every pending continuation tick by advancing the generation. Any tick
/// that captured an earlier generation aborts on its next check.
pub fn cancel_pending_autonomy() {
    AUTONOMOUS_GEN.fetch_add(1, Ordering::SeqCst);
}

/// Snapshot the current generation when scheduling a tick.
fn current_autonomy_gen() -> u64 {
    AUTONOMOUS_GEN.load(Ordering::SeqCst)
}

/// Has a newer schedule or a cancel superseded the tick that captured `my_gen`?
fn autonomous_superseded(my_gen: u64) -> bool {
    AUTONOMOUS_GEN.load(Ordering::SeqCst) != my_gen
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

/// Tauri event for `start_guided_walkthrough` auto-fire. Payload is
/// `{ topic }`. The frontend runner (`useGuidanceRunner`) starts the
/// registry-defined walkthrough — orb glides + element glow + narration.
pub const GUIDE_EVENT: &str = "companion://guide";

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

/// Tauri event for `explain_in_cockpit` auto-fire. UNLIKE compose, the
/// payload carries the full spec JSON (`{ "spec": "<json string>" }`) and
/// nothing is persisted — the frontend renders it as a contextual overlay
/// (Home → Cockpit) that dies with dismissal, leaving the user's
/// persistent cockpit untouched.
pub const EXPLAIN_COCKPIT_EVENT: &str = "companion://explain-cockpit";

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

/// Single process-wide turn lock. `send_turn` must be the unit of mutual
/// exclusion: the user path (`companion_send_message`) and the background
/// spawners (`schedule_autonomous_tick`, `spawn_proactive_turn`) have independent
/// entry points, and two turns running at once both `--resume` the same Claude
/// session id (clobbering each other's session-id write) and interleave brain
/// reads/writes (decisions on half-updated state). Sessions are currently always
/// DEFAULT_SESSION_ID, so one lock suffices; key by session id if that changes.
static TURN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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

    // Serialize turns (see TURN_LOCK). The user path waits for any in-flight turn;
    // background spawners skip rather than queue, so autonomous/proactive work
    // never preempts the user and two turns never --resume the session at once.
    let _turn_guard = match &origin {
        TurnOrigin::User => TURN_LOCK.lock().await,
        _ => match TURN_LOCK.try_lock() {
            Ok(g) => g,
            Err(_) => {
                tracing::info!(
                    "companion: a turn is already in flight — skipping this background turn"
                );
                return Err(AppError::Internal(
                    "A companion turn is already in progress; background turn skipped".into(),
                ));
            }
        },
    };

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
    let (open_role, open_content) = match &origin {
        TurnOrigin::User => (EpisodeRole::User, user_message.clone()),
        TurnOrigin::Autonomous { chain_index } => (
            EpisodeRole::System,
            format!("[autonomous continuation #{chain_index}]"),
        ),
        TurnOrigin::Proactive { trigger_kind, .. } => (
            EpisodeRole::System,
            format!("[proactive: {trigger_kind}]"),
        ),
        TurnOrigin::External { source } => (EpisodeRole::System, format!("[{source}]")),
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
    let effective_user_message: String = match &origin {
        TurnOrigin::User => user_message.clone(),
        TurnOrigin::Autonomous { chain_index } => format!(
            "Continue your autonomous work. This is continuation turn #{chain_index} of up to {max}. \
             Review what you've done so far. Either make concrete progress on the open task or, if \
             you've reached a natural stopping point or need user input, finalize without emitting \
             another `continue_autonomously` op.",
            max = MAX_AUTONOMOUS_CHAIN
        ),
        // Proactive turns: the caller already built the full directive
        // (it has the execution details / trigger context), so the
        // `user_message` IS the directive — pass it straight through.
        TurnOrigin::Proactive { .. } => user_message.clone(),
        // External turns: the body is the directive, but prepend an explicit
        // provenance tag so the model treats it as an automated system request
        // (not the operator typing) — stdin carries no role of its own.
        TurnOrigin::External { source } => {
            format!("[Automated request from {source} — not the user]\n\n{user_message}")
        }
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

    // Browser-test turns get Playwright MCP tools for this single CLI spawn
    // (see execute_run_browser_test in commands/companion/approvals.rs).
    // Derived from the trigger kind so no extra parameter threads through
    // every proactive spawner.
    let browser_tools = matches!(
        &origin,
        TurnOrigin::Proactive { trigger_kind, .. } if trigger_kind == "browser_test"
    );

    let (assistant_text, segments, cli_usage) = match timeout(
        TURN_TIMEOUT,
        run_cli(
            app,
            &turn_id,
            &session_id,
            claude_session_id.as_deref(),
            &system_prompt,
            &effective_user_message,
            &user_db,
            browser_tools,
            None,
            None,
        ),
    )
    .await
    {
        Ok(Ok(out)) => out,
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
                    // Must be effective_user_message, NOT user_message — the
                    // first call (above) uses it. For Autonomous/External/
                    // Proactive turns user_message is the raw sentinel /
                    // unframed body; sending it on the stale-session retry feeds
                    // the model `<<athena-autonomous-continuation>>` verbatim or
                    // drops the "not the user" provenance framing.
                    &effective_user_message,
                    &user_db,
                    browser_tools,
                    None,
                    None,
                ),
            )
            .await
            {
                Ok(Ok(out)) => out,
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
                    explain_cockpits: Vec::new(),
                    chat_cards: Vec::new(),
                    guide_walkthroughs: Vec::new(),
                    point_ats: Vec::new(),
                    composed_walkthroughs: Vec::new(),
                    quick_replies: Vec::new(),
                    tts_text: None,
                    requests_continuation: false,
                    warnings: vec![format!("dispatcher error: {e}")],
                    progress_beats: Vec::new(),
                }
            }
        };

    // Persist each conversational PROGRESS beat as its own lightweight
    // assistant episode BEFORE the final reply, so the transcript reads as
    // a progressive back-and-forth (the user chose "persist as messages").
    // The `PROGRESS:` sentinel prefix is how the frontend renders them as
    // asides; they're append-only (no embedding) — ephemeral conversational
    // texture, not memory-worthy facts.
    for beat in &dispatched.progress_beats {
        if let Err(e) = episodic::append_episode(
            &user_db,
            &session_id,
            EpisodeRole::Assistant,
            &format!("PROGRESS: {beat}"),
        ) {
            tracing::warn!(error = %e, "failed to persist progress beat episode");
        }
    }

    // Phase B — progressive prose segments. In a multi-step (tool-using) turn
    // the CLI emits one `assistant` message per agentic step; each carries the
    // prose Athena "said" at that step. Surface every NON-FINAL step's prose as
    // its own interim message (persisted before the reply, non-embedded — it's
    // the journey, not a memory-worthy fact), and let the LAST step be the
    // considered final reply. A single-segment turn (a quick answer, no tool
    // loop) produces no interim messages — quick answers stay one-shot. Ops
    // were already dispatched from the full blob above, so nothing is dropped.
    let seg_clean: Vec<String> = segments
        .iter()
        .map(|s| clean_segment_for_display(s))
        .filter(|s| !s.trim().is_empty())
        .collect();
    let reply_text: String = if seg_clean.len() >= 2 {
        for interim in &seg_clean[..seg_clean.len() - 1] {
            if let Err(e) =
                episodic::append_episode(&user_db, &session_id, EpisodeRole::Assistant, interim)
            {
                tracing::warn!(error = %e, "failed to persist interim segment episode");
            }
        }
        seg_clean[seg_clean.len() - 1].clone()
    } else {
        // 0–1 prose segments: keep today's behavior (full cleaned blob).
        dispatched.cleaned_text.clone()
    };

    let display_text = if reply_text.trim().is_empty() {
        // The whole reply was ops with no prose. Don't render an empty
        // bubble — replace with a tiny placeholder.
        "(proposing actions — see cards below)".to_string()
    } else {
        reply_text
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

    // Athena value expansion / A1: record this turn's usage + dispatcher
    // side-effect counts in the companion_turn ledger so the Overview
    // dashboards can show what Athena costs and for what kind of work.
    // Best-effort — never blocks the turn.
    {
        let (origin_str, trigger_kind) = match &origin {
            TurnOrigin::User => ("chat", None),
            TurnOrigin::Autonomous { .. } => ("autonomous", None),
            TurnOrigin::Proactive { trigger_kind, .. } => {
                ("proactive", Some(trigger_kind.clone()))
            }
            TurnOrigin::External { source } => ("external", Some(source.clone())),
        };
        let outcome_json = serde_json::to_string(&serde_json::json!({
            "approvals": dispatched.approvals.len(),
            "cards": dispatched.chat_cards.len(),
            "navigations": dispatched.navigations.len(),
            "lab_opens": dispatched.lab_opens.len(),
            "dashboards": dispatched.dashboards.len(),
            "cockpits": dispatched.cockpits.len(),
            "continuation": dispatched.requests_continuation,
        }))
        .ok();
        crate::companion::turn_ledger::record_turn(
            &user_db,
            &crate::companion::turn_ledger::TurnRecord {
                origin: origin_str.to_string(),
                trigger_kind,
                model: Some(COMPANION_TURN_MODEL.to_string()),
                usage: cli_usage,
                voice: voice_enabled,
                assistant_episode_id: Some(assistant_ep_id.clone()),
                outcome_json,
            },
        );
    }

    // Goal 3 — conservative autoapprove. When autonomous mode is on,
    // walk this turn's new approvals and resolve the ones on the
    // conservative allowlist (memory writes, scan jobs, future
    // self-nudges) immediately, the same way a user click would. Anything
    // else (external writes, DB mutations, agent creation, team work)
    // stays pending for a deliberate human click. Runs BEFORE the
    // APPROVALS_EVENT emit so the frontend's refetch sees the
    // already-resolved state and doesn't render a card that's about to
    // disappear.
    if autonomous_mode && !dispatched.approvals.is_empty() {
        for approval in &dispatched.approvals {
            match crate::commands::companion::approvals::auto_resolve_if_allowed(
                app, approval,
            )
            .await
            {
                Ok(true) => tracing::info!(
                    approval_id = %approval.id,
                    action = %approval.action,
                    "autonomous-mode autoapprove: resolved"
                ),
                Ok(false) => {} // not on allowlist — stays pending, normal user click
                Err(e) => tracing::warn!(
                    approval_id = %approval.id,
                    action = %approval.action,
                    error = %e,
                    "autonomous-mode autoapprove: failed (left in pending/running)"
                ),
            }
        }
    }

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

    // Guided walkthroughs (`start_guided_walkthrough`). Auto-fire — one event
    // per topic; the frontend runner walks the registry-defined steps.
    for topic in &dispatched.guide_walkthroughs {
        if let Err(e) = app.emit(GUIDE_EVENT, serde_json::json!({ "topic": topic })) {
            tracing::warn!(error = %e, topic = %topic, "companion guide event emit failed");
        }
    }

    // Ad-hoc pointing (`point_at`). Same channel as walkthroughs — the frontend
    // discriminates on `topic` vs `pointAt` and rings one allow-listed anchor.
    for pa in &dispatched.point_ats {
        if let Err(e) = app.emit(
            GUIDE_EVENT,
            serde_json::json!({ "pointAt": { "anchor": pa.anchor, "narration": pa.narration } }),
        ) {
            tracing::warn!(error = %e, anchor = %pa.anchor, "companion point_at event emit failed");
        }
    }

    // Runtime-composed multi-step tours (`compose_walkthrough`). Same channel;
    // the frontend builds an ad-hoc walkthrough from the catalog-mapped steps.
    for cw in &dispatched.composed_walkthroughs {
        let steps: Vec<_> = cw
            .steps
            .iter()
            .map(|s| serde_json::json!({ "anchor": s.anchor, "narration": s.narration }))
            .collect();
        let payload =
            serde_json::json!({ "composeWalkthrough": { "title": cw.title, "steps": steps } });
        if let Err(e) = app.emit(GUIDE_EVENT, payload) {
            tracing::warn!(error = %e, steps = cw.steps.len(), "companion compose_walkthrough event emit failed");
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

    // explain_in_cockpit auto-fire. Ephemeral sibling of compose_cockpit:
    // the spec rides in the event payload and is deliberately NEVER
    // persisted — it renders as a contextual overlay over the cockpit and
    // dismissal restores the user's own board. No save call by design.
    for spec_json in &dispatched.explain_cockpits {
        let payload = serde_json::json!({ "spec": spec_json });
        if let Err(e) = app.emit(EXPLAIN_COCKPIT_EVENT, payload) {
            tracing::warn!(error = %e, "companion explain_in_cockpit event emit failed");
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
        let next_chain = match &origin {
            // User and Proactive turns are both chain-roots: the next
            // continuation is #1. A Proactive turn that emits
            // `continue_autonomously` (e.g. "I found a failed run, let me
            // dig deeper") starts its own chain just like a user ask.
            TurnOrigin::User | TurnOrigin::Proactive { .. } | TurnOrigin::External { .. } => 1,
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
    // Capture the generation this tick belongs to. A user "stop" (or any newer
    // schedule) advances the global generation, after which this tick aborts —
    // and, unlike the old reset-the-bool scheme, it can never be revived.
    let my_gen = current_autonomy_gen();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        // Poll the generation while waiting out the delay. A coarse
        // 200ms tick is plenty — the delay itself is 15s; finer polling
        // wouldn't change the user's experience.
        let started = Instant::now();
        while started.elapsed() < AUTONOMOUS_CONTINUATION_DELAY {
            if autonomous_superseded(my_gen) {
                tracing::debug!("autonomous tick superseded during delay");
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        if autonomous_superseded(my_gen) {
            tracing::debug!("autonomous tick superseded at delay boundary");
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

/// Spawn a self-initiated reasoning turn — the entry point for the
/// proactive scheduler (Goal 2: analyze recent executions) and, later,
/// the execution-finished event subscriber (Goal 1). `directive` is the
/// fully-formed prompt the caller built from the trigger context (e.g.
/// "Execution X failed with <error>; analyze and propose an improvement").
///
/// Runs on a blocking thread with a current-thread runtime for the same
/// `!Send` reason as `schedule_autonomous_tick`. Fire-and-forget: the
/// turn streams to the panel and persists like any other; the caller
/// (a 5-min tick) doesn't await it. `autonomous_mode` is passed through
/// so the turn can chain via `continue_autonomously` if it needs more
/// than one pass — by the time we call this, the caller has already
/// confirmed autonomous mode is on.
pub fn spawn_proactive_turn(
    app: AppHandle,
    user_db: Arc<UserDbPool>,
    sys_db: Arc<DbPool>,
    #[cfg(feature = "ml")] embedder: Option<Arc<EmbeddingManager>>,
    trigger_kind: String,
    trigger_ref: Option<String>,
    directive: String,
) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                tracing::warn!(error = %e, "proactive turn: failed to build runtime");
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
                directive,
                TurnOrigin::Proactive {
                    trigger_kind,
                    trigger_ref,
                },
                false, // voice off for machine-initiated turns
                false, // no recall synthesis budget on background turns
                true,  // autonomous_mode on — caller gated on this
            )
            .await;
            if let Err(e) = res {
                tracing::warn!(error = %e, "proactive reasoning turn failed");
            }
        });
    });
}

/// The model every full companion turn runs on. Recorded into the turn ledger
/// (`companion_turn.model`) and passed to the CLI `--model` flag — one source so
/// the two never drift.
const COMPANION_TURN_MODEL: &str = "claude-opus-4-8";

/// Reasoning effort for web-build (Studio) turns. Build sessions prefer quality
/// over speed/cost — non-technical users can't specify the quality bars a dev
/// would, so we lean on the model's deepest thinking. Applied only to build
/// turns (cwd_override present), not normal companion chat.
const BUILD_TURN_EFFORT: &str = "xhigh";

/// `run_cli`'s output: the display text plus the parsed terminal `result`
/// usage (`None` when the CLI emitted no result event — older CLI, or the turn
/// errored before the result line).
/// `(full_text, segments, usage)`. `segments` is the per-assistant-message
/// text in emission order — in a multi-step (tool-using) turn the CLI emits a
/// separate `assistant` message per agentic step (talk → tool → talk → …), so
/// each entry is one "she talked here" beat of prose. `full_text` is the
/// concatenation (what the dispatcher parses for ops/beats — unchanged);
/// `segments` lets send_turn surface non-final steps as interim messages.
type CliRunOutput = (String, Vec<String>, Option<crate::companion::turn_ledger::CliUsage>);

/// Strip machine-grammar lines from one assistant-message segment so it can be
/// shown as an interim message. Mirrors the frontend `stripModelDirectives`
/// (OP: / QR: / TTS: / raw `{"op"`) and also drops `PROGRESS:` lines — those
/// are persisted separately as their own beat-asides, so a segment's prose
/// must not duplicate them. Display-only: the dispatcher remains the authority
/// for ops/beats, run on the full concatenated text.
fn clean_segment_for_display(seg: &str) -> String {
    let kept: Vec<&str> = seg
        .lines()
        .filter(|line| {
            let t = line.trim_start();
            !(t.starts_with("OP:")
                || t.starts_with("QR:")
                || t.starts_with("TTS:")
                || t.starts_with("PROGRESS:")
                || t.starts_with("{\"op\""))
        })
        .collect();
    kept.join("\n").trim().to_string()
}

/// Concise coding-agent system prompt for a web-build session. Kept lean for
/// v0 — the full web-build doctrine + Vision/checklist machinery land in P3.
/// The full web-build doctrine, embedded so a build session carries the whole
/// playbook (P3). Cost is real (~12KB/turn); a later pass can switch to
/// retrieval, but full injection keeps fidelity to the doctrine for now.
const WEB_BUILD_DOCTRINE: &str =
    include_str!("../../../docs/concepts/web-build-best-practices.md");

/// Static planning + rules block appended after the doctrine. Kept as a raw
/// string so the `BUILD_PLAN:` JSON example needs no brace-escaping.
const BUILD_PLAN_INSTRUCTION: &str = r#"
# Build plan — surface it
Maintain a short build plan following the doctrine's Spine, then a project-specific tail. Whenever the plan changes — you finish a phase, start one, or revise the set — emit it as the VERY LAST line of your reply, as ONE line of compact JSON (no code fence), in exactly this shape:
BUILD_PLAN: {"phases":[{"id":"vision","title":"Vision","status":"done","note":"short"},{"id":"foundation","title":"Foundation","status":"active","note":""}]}
- status is one of "done" | "active" | "pending"; exactly one phase is "active".
- Keep to <=8 phases, titles <=24 chars, notes <=40 chars. Only emit BUILD_PLAN when the plan actually changed.

# When to ask — this is the user's product, don't assume
Reserve questions for things ONLY THE USER KNOWS: real content (names, copy, projects, prices, contact details), target audience, brand voice, business model, or which real data/integration to wire. For those, STOP and ASK instead of inventing it — emit it as the VERY LAST line:
NEEDS_INPUT: {"question":"<one short question, 1-2 sentences>","options":["<short concrete choice>","<short concrete choice>"]}
Give 2-4 SHORT, concrete options whenever the choice is between knowable alternatives — the user clicks one. Omit "options" (send {"question":"..."}) only for genuinely open-ended free text like a business name. No markdown inside the JSON. When the question is about a specific part of the page, add "area":"top"|"middle"|"bottom" so the user's eye is drawn to that region of the preview.
Keep it short and skimmable — a non-technical person is answering, one focused question at a time. Make ALL low-stakes, reversible, or technical choices yourself (spacing, colours, layout, library choices). Do NOT ask which section/feature to build next, what order to work in, or for permission to keep going — those are YOUR calls; decide and proceed. Early on (vision, brand, audience, real content) lean toward asking; once those are settled, lean hard toward building. Budget your questions: aim for only a handful of decisions across the ENTIRE build (roughly one per major phase, at most one per turn). When unsure but the choice is low-stakes or reversible, pick a sensible default, proceed, and note it in one line rather than asking.

# Visual quality — best in class, never "AI-generated"
Hold the bar of Linear, Vercel, Stripe, Apple, Framer. Obsess over typography (scale, weight, tracking, leading), spacing rhythm, colour + contrast, hierarchy, depth, and cohesion; add tasteful hover/focus/transition micro-interactions and motion where it earns its place. Generic, templated, centred-everything, "AI-looking" output is a FAILURE — every surface must feel intentional, premium, and crafted by someone who cares.

# Design direction — show 3, don't guess
At the Design Direction phase, while the look is still open, build 2-3 GENUINELY DIFFERENT visual directions for the most important surface (usually the hero / first screen) behind a temporary in-page tab switcher so they can be compared live, then ask which to commit to or adjust (NEEDS_INPUT with options like "A / B / C"). Once chosen, delete the switcher + the losing variants and carry the winner through the rest. Prototype the LOOK only (type, colour, layout mood) — not logic or structure.

# Navigation
Every multi-page site includes a footer with cross-page navigation linking all its main pages, so the whole product is clickable end-to-end and easy to review.

# Self-critique before "done"
Before marking a phase done, review it as a demanding design lead would and fix the weak spots — alignment, spacing rhythm, type hierarchy, empty/hover/focus states, mobile. Run a typecheck (tsc --noEmit) and fix errors. "Builds + typechecks" is the floor, not the bar.

# Rules
- Edit files directly with your tools; keep the change scoped to the request.
- The dev server is ALREADY running — never start it, run a dev/build command, or install unrelated dependencies.
- Reply with a SHORT (1-2 sentence) summary of what changed, then the BUILD_PLAN line, then a NEEDS_INPUT line last if you need a decision. The user watches the live preview, so don't over-explain or paste large diffs."#;

fn build_system_prompt(project_path: &std::path::Path, style: Option<&str>) -> String {
    let base = format!(
        "You are Athena's web-build engine — a focused coding agent working inside the local \
web project at {path}. It is a Next.js + TypeScript + Tailwind app with a live dev server \
already running that hot-reloads on every file save, so the user sees your changes \
immediately in an embedded preview. Follow your web-build doctrine below for planning and \
quality.\n\n\
===== WEB-BUILD DOCTRINE =====\n{doctrine}\n===== END DOCTRINE =====\n{instruction}",
        path = project_path.display(),
        doctrine = WEB_BUILD_DOCTRINE,
        instruction = BUILD_PLAN_INSTRUCTION,
    );
    // Optional user-chosen voice (the C4 style picker). Balanced / None = default.
    let voice = match style {
        Some("concise") => "\n\n# Voice\nKeep replies terse — one-sentence summaries, minimal explanation. The user watches the live preview, so show rather than tell.",
        Some("teaching") => "\n\n# Voice\nBriefly explain your key choices in plain language as you go, so a non-technical user learns what's happening — keep it skimmable, never a lecture.",
        _ => "",
    };
    format!("{base}{voice}")
}

/// Run one build-session turn: a project-rooted Claude Code turn that edits the
/// project's files (P2 of the web-dev companion). A distinct, independently
/// resumable session from Athena's main chat — session id `webbuild:<project_id>`,
/// spawned at the project cwd with a coding system prompt. Streams on
/// `STREAM_EVENT` keyed by that session id; returns the assistant's summary text.
pub async fn run_build_turn(
    app: &AppHandle,
    user_db: &UserDbPool,
    project_id: &str,
    project_path: &std::path::Path,
    user_message: &str,
    // Per-turn build controls (C1 effort knob, C4 voice/style picker). `None` →
    // defaults (deepest effort, balanced voice).
    effort: Option<&str>,
    style: Option<&str>,
) -> Result<crate::webbuild::plan::BuildTurnResult, AppError> {
    let session_id = format!("webbuild:{project_id}");
    let turn_id = format!("wbturn_{}", uuid::Uuid::new_v4().simple());
    let claude_session_id = read_claude_session_id(user_db, &session_id)?;
    let system_prompt = build_system_prompt(project_path, style);

    let text = match timeout(
        TURN_TIMEOUT,
        run_cli(
            app,
            &turn_id,
            &session_id,
            claude_session_id.as_deref(),
            &system_prompt,
            user_message,
            user_db,
            false,
            Some(project_path),
            effort,
        ),
    )
    .await
    {
        Ok(Ok((text, _, _))) => text,
        // Self-heal a stale `--resume` (deleted/expired CLI session): clear the
        // pointer and retry once with a fresh session.
        Ok(Err(e)) if is_stale_session_error(&e) && claude_session_id.is_some() => {
            clear_claude_session_id(user_db, &session_id)?;
            let (text, _, _) = timeout(
                TURN_TIMEOUT,
                run_cli(
                    app,
                    &turn_id,
                    &session_id,
                    None,
                    &system_prompt,
                    user_message,
                    user_db,
                    false,
                    Some(project_path),
                    effort,
                ),
            )
            .await
            .map_err(|_| AppError::Internal("build turn timed out".into()))??;
            text
        }
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(AppError::Internal("build turn timed out".into())),
    };

    // Parse out trailing BUILD_PLAN / NEEDS_INPUT markers (stripped from the reply).
    let (reply, phases, question, options, area) = crate::webbuild::plan::extract_build_turn(&text);
    // C7 — snapshot this turn into the project's git history (best-effort).
    crate::webbuild::versions::commit_snapshot(project_path, &reply);
    Ok(crate::webbuild::plan::BuildTurnResult { reply, phases, question, options, area })
}

async fn run_cli(
    app: &AppHandle,
    turn_id: &str,
    session_id: &str,
    claude_session_id: Option<&str>,
    system_prompt: &str,
    user_message: &str,
    pool: &UserDbPool,
    browser_tools: bool,
    // Working directory for the spawned CLI. `None` = the user's home dir (the
    // default — so a normal Athena turn doesn't auto-pick up the Personas
    // project's CLAUDE.md). `Some(path)` roots the turn in a project directory
    // (web-build build sessions — P2 of the web-dev companion).
    cwd_override: Option<&std::path::Path>,
    // Reasoning effort for build turns (cwd_override present). `None` → the
    // default `BUILD_TURN_EFFORT`. Ignored for non-build (companion-chat) turns.
    build_effort: Option<&str>,
) -> Result<CliRunOutput, AppError> {
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
        // Token-level streaming. With this flag the CLI additionally emits
        // `{"type":"stream_event", ...}` lines carrying `content_block_delta`
        // / `text_delta` chunks *before* the final whole `assistant` message.
        // The frontend renders those deltas live so Athena's reply flows in
        // token-by-token instead of appearing in whole-message jumps. Purely
        // additive on this side: the loop below already forwards every line
        // verbatim as a `Cli` event, and the final `assistant` message still
        // arrives unchanged to drive `assistant_text` accumulation /
        // persistence. Harmless on older CLIs that don't recognize the flag's
        // event type — they simply emit no `stream_event` lines.
        "--include-partial-messages".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        COMPANION_TURN_MODEL.into(),
        "--system-prompt-file".into(),
        prompt_file.to_string_lossy().to_string(),
    ]);

    // Build-session turns prioritise quality — pin reasoning effort. User-tunable
    // per turn via the effort knob (C1); defaults to the deepest level. Validated
    // against the known levels so we never inject an arbitrary flag value.
    if cwd_override.is_some() {
        let effort = match build_effort {
            Some(e) if matches!(e, "low" | "medium" | "high" | "xhigh") => e,
            _ => BUILD_TURN_EFFORT,
        };
        argv.push("--effort".into());
        argv.push(effort.into());
    }

    // Browser-test turns: hand this single CLI spawn browser tools via MCP —
    // the browser-bridge endpoint (user's real Chrome through the paired
    // extension) when one is connected, else the bundled Playwright MCP.
    // Continuation/regular turns never get it (startup cost + tool surface
    // stay scoped to the test). The temp config must outlive the child —
    // NamedTempFile deletes on drop.
    let mut _mcp_config_file: Option<tempfile::NamedTempFile> = None;
    if browser_tools {
        match crate::browser_bridge::build_browser_mcp_config() {
            Ok((f, mode)) => {
                tracing::info!(?mode, "browser-test turn: browser MCP config ready");
                argv.push("--mcp-config".into());
                argv.push(f.path().to_string_lossy().to_string());
                _mcp_config_file = Some(f);
            }
            Err(e) => tracing::warn!(
                error = %e,
                "browser-test turn: failed to build browser MCP config; running without browser tools"
            ),
        }
    }

    // Spawn from the user's home directory (or a benign fallback) by default so
    // a normal turn doesn't auto-pick up the Personas project's CLAUDE.md. A
    // build session overrides this to root the turn in its project directory.
    let cwd = cwd_override
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| std::env::temp_dir()));

    let mut cmd = Command::new(&cmd_program);
    cmd.args(&argv)
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
        .env("CLAUDE_CODE_FORK_SUBAGENT", "1");
    // Athena (and every persona execution/evaluation) runs on the Claude
    // monthly subscription — strip any ANTHROPIC_* API-account auth so the CLI
    // uses its OAuth/keychain credentials, never billing the API.
    crate::engine::cli_process::force_subscription_auth(&mut cmd);
    // No console window on Windows — see apply_no_console_window. Without
    // this the GUI app's `cmd /C claude.cmd` child drains the desktop heap
    // and eventually dies on spawn with 0xC0000142.
    apply_no_console_window(&mut cmd);
    let mut child = cmd
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
    // Per-assistant-message text, in emission order (Phase B interim segments).
    let mut segments: Vec<String> = Vec::new();
    let mut new_claude_session_id: Option<String> = None;
    // The CLI's terminal `result` event carries this turn's real cost / token
    // usage / duration; captured here for the companion_turn ledger.
    let mut result_usage: Option<crate::companion::turn_ledger::CliUsage> = None;
    let mut interrupt_tick = tokio::time::interval(Duration::from_millis(200));
    // Skip the immediate first tick — `interval` fires once at t=0 by
    // default, which would race the kill check before we've read a
    // single line.
    interrupt_tick.tick().await;
    let mut interrupted = false;
    // Mid-stream read failure preserved here so the loop can break and
    // the partial-reply tail handling below can tag whatever we
    // accumulated rather than losing the work to a hard error return.
    let mut stdout_read_error: Option<String> = None;

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
                                    // Collect THIS message's text blocks into one
                                    // segment, then fold into the running full text.
                                    let mut msg_text = String::new();
                                    for block in content {
                                        if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                                if !msg_text.is_empty() {
                                                    msg_text.push('\n');
                                                }
                                                msg_text.push_str(text);
                                            }
                                        }
                                    }
                                    if !msg_text.is_empty() {
                                        if !assistant_text.is_empty() {
                                            assistant_text.push('\n');
                                        }
                                        assistant_text.push_str(&msg_text);
                                        segments.push(msg_text);
                                    }
                                }
                            }
                            if let Some(u) =
                                crate::companion::turn_ledger::CliUsage::from_result_event(&value)
                            {
                                result_usage = Some(u);
                            }
                        }
                    }
                    Ok(None) => break, // EOF — CLI finished naturally
                    Err(e) => {
                        // Don't hard-error and lose accumulated text.
                        // Record the failure, break, and let the
                        // partial-reply tail tag it for the user.
                        stdout_read_error = Some(format!("read claude stdout: {e}"));
                        break;
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
        return Ok((body, Vec::new(), result_usage.take()));
    }

    // Stdout-mid-stream failure path: the CLI was producing output and
    // then the pipe broke (process crashed, signal, OOM, etc.). We
    // already accumulated some text — preserve it rather than dropping
    // the whole turn. Tag with the underlying error so the user sees
    // what went wrong without losing the partial reply.
    if let Some(err_msg) = stdout_read_error {
        if let Some(sid) = new_claude_session_id {
            upsert_claude_session_id(pool, session_id, &sid)?;
        }
        let body = if assistant_text.trim().is_empty() {
            format!("_(stream ended before any reply: {err_msg})_")
        } else {
            format!("{assistant_text}\n\n_[interrupted by error: {err_msg}]_")
        };
        return Ok((body, Vec::new(), result_usage.take()));
    }

    if !status.success() {
        let trimmed = if stderr_text.len() > 600 {
            format!("{}…", crate::utils::text::truncate_on_char_boundary(&stderr_text, 600))
        } else {
            stderr_text.clone()
        };
        // Non-zero exit AFTER partial text streamed: preserve the
        // partial — same logic as stdout_read_error above. The stderr
        // tail goes into the tag so the user (and Athena, next turn)
        // sees the diagnostic context.
        if !assistant_text.trim().is_empty() {
            if let Some(sid) = new_claude_session_id {
                upsert_claude_session_id(pool, session_id, &sid)?;
            }
            let body = format!(
                "{assistant_text}\n\n_[interrupted by error: claude exited with status {status}{}]_",
                if trimmed.is_empty() { String::new() } else { format!(": {trimmed}") }
            );
            return Ok((body, Vec::new(), result_usage.take()));
        }
        // No partial — fall through to hard error as before.
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

    Ok((assistant_text, segments, result_usage))
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
    // Shared resolver — verified absolute claude.exe on Windows so a broken
    // or missing claude.cmd shim on PATH can't break the spawn.
    crate::engine::cli_process::claude_cli_invocation()
}

/// Apply the Windows "no console window" creation flag to a CLI command.
///
/// The Personas app is a GUI process with no console of its own. A console-
/// subsystem child — the `cmd /C claude.cmd` chain from [`base_cli_invocation`]
/// — spawned without this flag gets a fresh `conhost.exe` allocated on the
/// interactive desktop. That both flashes a black window on every turn AND,
/// multiplied across the fleet PTYs + build sessions + back-to-back
/// proactive / brain / consolidation turns, drains the window-station desktop
/// heap. Once that heap is exhausted, new console children fail to initialize
/// and exit immediately with `STATUS_DLL_INIT_FAILED` (`0xC0000142`) — observed
/// in the wild on a fleet-orchestration proactive turn ("claude exited with
/// status exit code: 0xc0000142"). Running `claude` from an existing console
/// (cmd.exe / Windows Terminal) never hits this, which is why it only reproduces
/// inside the app.
///
/// The `CliArgs` / [`crate::engine::cli_process`] spawn family already sets this
/// on every spawn; the `base_cli_invocation` family historically did not. This
/// helper centralizes the flag so the two families can't drift apart again. All
/// of these calls pipe stdin/stdout/stderr, so the child never needs a console.
/// No-op on non-Windows.
pub fn apply_no_console_window(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
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
