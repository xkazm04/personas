//! One turn, end to end. [`send_turn`] is the wrapper that owns the failure
//! ledger row; `send_turn_inner` is the turn itself, and **the order of its
//! statements is behaviour** — it moved here as one unbroken block.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::time::timeout;

use super::autonomy::schedule_autonomous_tick;
use super::cli::{is_stale_session_error, run_cli};
use super::events::{
    emit, emit_error, is_remote_device_source, RecallPreviewEvent, StreamEvent, StreamEventKind,
    TurnResult, TurnSummaryEvent, APPROVALS_EVENT, CANVAS_CONTROL_EVENT, CHAT_CARDS_EVENT,
    COMPOSE_CANVAS_PANEL_EVENT, COMPOSE_COCKPIT_EVENT, COMPOSE_DASHBOARD_EVENT,
    EXPLAIN_COCKPIT_EVENT, GUIDE_EVENT, NAVIGATE_EVENT, OPEN_LAB_EVENT, RECALL_PREVIEW_EVENT,
    TURN_SUMMARY_EVENT, TURN_TIMEOUT,
};
use super::failure::FailedTurnCtx;
use super::locks::{ledger_origin_of, turn_lock_for, FLEET_TURN_QUEUE_DEPTH};
use super::model::companion_turn_model;
use super::origin::{TurnOrigin, MAX_AUTONOMOUS_CHAIN};
use super::stream::clean_segment_for_display;
use super::transcript::{clear_claude_session_id, read_claude_session_id};
use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::prompt;
use crate::companion::turn_ledger::CliUsage;
use crate::db::{DbPool, UserDbPool};
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Run one full turn: persist the user message, call Claude, stream events,
/// persist the assistant reply. Returns (user_episode_id, assistant_episode_id).
///
/// Streams progress via Tauri events on `STREAM_EVENT` so the UI updates
/// incrementally. The final returned ids let the caller link UI state to
/// persisted episodes.
///
/// This is a thin wrapper over [`send_turn_inner`] whose only job is to make a
/// failed turn *visible*: any `Err` the body returns, from any exit, lands one
/// `is_error = 1` row in `companion_turn`. See [`FailedTurnCtx`].
#[allow(clippy::too_many_arguments)] // mirrors send_turn_inner's param list
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
    conversation_id: String,
) -> Result<TurnResult, AppError> {
    let ctx = FailedTurnCtx::new(&origin, voice_enabled);
    // Best-effort cost capture on the failure path. `run_cli` mirrors every
    // terminal `result` event it parses into this sink, so a turn that errors
    // — or whose future is dropped outright by the 25-minute timeout, losing
    // `run_cli`'s own locals — still records what it actually spent.
    let usage_sink: std::sync::Mutex<Option<CliUsage>> = std::sync::Mutex::new(None);
    let pool = user_db.clone();
    let res = send_turn_inner(
        app,
        user_db,
        sys_db,
        #[cfg(feature = "ml")]
        embedder,
        user_message,
        origin,
        voice_enabled,
        recall_synthesis_enabled,
        autonomous_mode,
        conversation_id,
        &ctx,
        &usage_sink,
    )
    .await;
    if let Err(e) = &res {
        let usage = usage_sink.lock().ok().and_then(|mut g| g.take());
        ctx.record(&pool, e, usage);
    }
    res
}

#[allow(clippy::too_many_arguments)] // +conversation_id; a params struct is more churn than it's worth
async fn send_turn_inner(
    app: &AppHandle,
    user_db: Arc<UserDbPool>,
    sys_db: Arc<DbPool>,
    #[cfg(feature = "ml")] embedder: Option<Arc<EmbeddingManager>>,
    user_message: String,
    origin: TurnOrigin,
    voice_enabled: bool,
    recall_synthesis_enabled: bool,
    autonomous_mode: bool,
    // Which conversation (thread) this turn belongs to. Its own transcript,
    // its own Claude `--resume` continuity, its own recency lane, its own turn
    // lock. Callers pass DEFAULT_SESSION_ID for the migrated 'General' thread.
    conversation_id: String,
    // Failure bookkeeping owned by the `send_turn` wrapper — armed below, once
    // this turn actually holds the lock.
    ledger: &FailedTurnCtx,
    // Where `run_cli` mirrors the CLI's terminal `result` usage so the wrapper
    // can still bill a turn that errored or timed out.
    usage_sink: &std::sync::Mutex<Option<CliUsage>>,
) -> Result<TurnResult, AppError> {
    let session_id = conversation_id;
    let turn_id = format!("turn_{}", crate::companion::util::short_id(12));

    // Serialize turns (see TURN_LOCK). User-initiated paths wait for any
    // in-flight turn; background spawners skip rather than queue, so
    // autonomous/proactive work never preempts the user and two turns never
    // --resume the session at once.
    //
    // `External` ("Ask Athena" and similar frontend surfaces) is genuinely
    // user-initiated — a real button press carrying the user's intent, even
    // though the prompt text is system-crafted — so it block-acquires like
    // `User`. If it used `try_lock`, a request would be silently dropped
    // whenever a turn is in flight (common: autonomous mode keeps a 15s-spaced
    // tick chain alive), with no reply, error, or queue entry. Awaiting can't
    // deadlock: the lock is only ever held within a single `send_turn` body,
    // which is bounded by TURN_TIMEOUT, and no code path re-enters `send_turn`
    // synchronously while holding it (the autonomous/proactive spawners are
    // fire-and-forget on their own threads).
    //
    // Background origins (`Autonomous` ticks, `Proactive` turns) keep
    // `try_lock` and self-skip when busy: a missed autonomous tick self-heals
    // on the next one, and queuing them would let machine work pile up.
    let turn_lock = turn_lock_for(&session_id);
    // Fleet orchestration turns QUEUE on the lock instead of self-skipping.
    // The 30-terminal live test (2026-07-24) showed why: a completion burst
    // parked ~25 sessions near-simultaneously, the try_lock dropped 27 of 57
    // wakes silently, and the doze pass swept those sessions before the
    // 2-minute re-check could retry — half the fleet was never assessed. A
    // parked CLI session is exactly the caller that can afford to wait its
    // turn; the queue drains at one verdict per ~10s. Bounded: past
    // MAX_QUEUED_FLEET_TURNS waiters, new wakes still skip (the re-check +
    // pending-assessment doze guard pick them up later) so a wedged turn
    // can't accumulate unbounded blocked tasks.
    let is_fleet_orchestration = matches!(
        &origin,
        TurnOrigin::Proactive { trigger_kind, .. } if trigger_kind == "fleet_orchestration"
    );
    let _turn_guard = match &origin {
        TurnOrigin::User | TurnOrigin::External { .. } => turn_lock.lock().await,
        _ if is_fleet_orchestration => {
            const MAX_QUEUED_FLEET_TURNS: usize = 32;
            match turn_lock.try_lock() {
                Ok(g) => g,
                Err(_) => {
                    let queued =
                        FLEET_TURN_QUEUE_DEPTH.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if queued >= MAX_QUEUED_FLEET_TURNS {
                        FLEET_TURN_QUEUE_DEPTH.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                        tracing::warn!(
                            queued,
                            "companion: fleet turn queue full — skipping wake (re-check will retry)"
                        );
                        return Err(AppError::Internal(
                            "fleet turn queue full; wake skipped".into(),
                        ));
                    }
                    if let TurnOrigin::Proactive {
                        trigger_ref: Some(sid),
                        ..
                    } = &origin
                    {
                        crate::commands::fleet::debug_log::athena(
                            sid,
                            "queued",
                            &format!("turn in flight — waiting (depth {})", queued + 1),
                        );
                    }
                    let g = turn_lock.lock().await;
                    FLEET_TURN_QUEUE_DEPTH.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                    g
                }
            }
        }
        _ => match turn_lock.try_lock() {
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

    // Past both `try_lock` skip returns above — this turn is really running,
    // so from here on any `Err` is a failure the ledger should show, not
    // backpressure. (A skip must NOT count as an error; background ticks skip
    // constantly by design.)
    ledger.arm();

    // The legacy self-improve orphan sweep that ran here every turn is
    // retired with the wrench-send pipeline; `companion_init` still runs
    // one recovery sweep per process for any historical run dirs.

    // Persist the turn-opening episode. User turns land as `User`;
    // autonomous continuation ticks land as `System` with a marker so
    // the transcript visibly distinguishes "the user typed this" from
    // "Athena gave herself another turn". For autonomous, the CLI
    // receives a directive (see `effective_user_message` below) — we
    // never persist the marker token verbatim.
    // Fleet orchestration runs as a background proactive turn whose *only*
    // user-facing output should be the orb (her decision/approval, surfaced via
    // the global dispatcher emits below) — never a chat transcript essay tagged
    // `[proactive: fleet_orchestration]`. When this is set we skip every
    // session-keyed chat side-effect (opening marker, Started/Finished events,
    // progress/interim/final persists, the turn-summary chip); the dispatcher's
    // global orb emits (approvals, navigations, …) run unconditionally, so she
    // still surfaces — just on the orb, not in chat. False for every other turn,
    // so the normal chat path is byte-for-byte unchanged.
    //
    // A remote-device instruction is suppressed for the same reason: it is
    // someone else's errand running on this machine. Its answer belongs to the
    // device that asked (it travels back over the job's own wire, and the orb
    // announces it via REMOTE_JOB_TURN_EVENT) — not to THIS user's transcript,
    // which would otherwise fill with half-conversations he never started.
    let suppress_chat = matches!(
        &origin,
        TurnOrigin::Proactive { trigger_kind, .. } if trigger_kind == "fleet_orchestration"
    ) || matches!(
        &origin,
        TurnOrigin::External { source } if is_remote_device_source(source)
    );

    let (open_role, open_content) = match &origin {
        TurnOrigin::User => (EpisodeRole::User, user_message.clone()),
        TurnOrigin::Autonomous { chain_index } => (
            EpisodeRole::System,
            format!("[autonomous continuation #{chain_index}]"),
        ),
        TurnOrigin::Proactive { trigger_kind, .. } => {
            (EpisodeRole::System, format!("[proactive: {trigger_kind}]"))
        }
        TurnOrigin::External { source } => (EpisodeRole::System, format!("[{source}]")),
    };
    let user_ep_id = if suppress_chat {
        String::new()
    } else {
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
                None => episodic::append_episode(&user_db, &session_id, open_role, &open_content)?,
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            episodic::append_episode(&user_db, &session_id, open_role, &open_content)?
        }
    };

    if !suppress_chat {
        emit(
            app,
            StreamEvent {
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
                kind: StreamEventKind::Started,
                payload: user_ep_id.clone(),
            },
        );
    }

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

    let (system_prompt, recall_preview, prompt_blocks) = {
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
                None,
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
            &[],
            !suppress_chat,
            Some(usage_sink),
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
                    &[],
                    !suppress_chat,
                    Some(usage_sink),
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
                    let msg = "Turn exceeded 25-minute timeout (after session reset)";
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
            let msg = "Turn exceeded 25-minute timeout";
            emit_error(app, &session_id, &turn_id, msg);
            return Err(AppError::Internal(msg.into()));
        }
    };

    // Phase 3: extract any `{"op":...}` proposals from Athena's reply,
    // persist them as approval rows, and strip them from the displayed
    // text. The episode stores the cleaned text — what the user sees in
    // the chat — so future turns' transcript is clean too.
    let mut dispatched = match crate::companion::dispatcher::dispatch_with_sys(
        &user_db,
        Some(&sys_db),
        &session_id,
        &assistant_text,
    ) {
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
                canvas_panels: Vec::new(),
                canvas_controls: Vec::new(),
                chat_cards: Vec::new(),
                guide_walkthroughs: Vec::new(),
                point_ats: Vec::new(),
                composed_walkthroughs: Vec::new(),
                composed_tours: Vec::new(),
                quick_replies: Vec::new(),
                tts_text: None,
                requests_continuation: false,
                warnings: vec![format!("dispatcher error: {e}")],
                progress_beats: Vec::new(),
            }
        }
    };

    // NOTE: conversational `PROGRESS:` beats and non-final prose segments are
    // no longer flushed here in an end-of-turn loop. `run_cli` persists each one
    // INCREMENTALLY as it streams in (see `persist_stream_progress`), so the
    // transcript fills in as the work happens — with each episode carrying its
    // real emission time instead of a shared turn-end timestamp. This block only
    // still SELECTS the considered final reply; it persists nothing extra.
    //
    // Phase B — progressive prose segments. In a multi-step (tool-using) turn
    // the CLI emits one `assistant` message per agentic step; each carries the
    // prose Athena "said" at that step. Every NON-FINAL step's prose was already
    // surfaced as its own interim message by `run_cli`; the LAST step is the
    // considered final reply, selected here (and persisted below, embedded). A
    // single-segment turn (a quick answer, no tool loop) produced no interim
    // messages. Ops were dispatched from the full blob above, so nothing is
    // dropped. The `seg_clean` split MUST match `run_cli`'s so the last segment
    // isn't double-persisted: interim = all-but-last, final = last.
    let seg_clean: Vec<String> = segments
        .iter()
        .map(|s| clean_segment_for_display(s))
        .filter(|s| !s.trim().is_empty())
        .collect();
    let reply_text: String = if seg_clean.len() >= 2 {
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
        // Clone (not move) — `reply_text` is read again below for the fleet
        // orb-note routing.
        reply_text.clone()
    };

    let assistant_ep_id = if suppress_chat {
        String::new()
    } else {
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

    // Fleet orchestration routes to the orb, not chat. Her DEFER note (prose,
    // "I'm leaving this one to you") has no fleet_send_input approval to carry it
    // onto the orb, and chat is suppressed — so surface it as a proactive orb
    // card. Skip when she produced an approval (the orb already shows that) or
    // said nothing actionable (a "progressing fine" no-op stays quiet).
    // Fleet orchestration turns are BATCHED (trigger_ref = "batch"): each
    // dispatched fleet action must name one of the batch's sessions. The model
    // occasionally truncates or hallucinates ids and the executor fails closed
    // (types nothing, silently) — repair prefix matches against the batch set,
    // drop the rest, before anything reads the approvals.
    let is_fleet_turn = matches!(
        &origin,
        TurnOrigin::Proactive { trigger_kind, .. } if trigger_kind == "fleet_orchestration"
    );
    if is_fleet_turn && !dispatched.approvals.is_empty() {
        let allowed = crate::commands::companion::fleet_bridge::current_batch_ids();
        crate::commands::companion::fleet_bridge::validate_fleet_session_ids(
            &user_db,
            &mut dispatched.approvals,
            &allowed,
        );
    }

    // A remote-device errand has its own announcement channel
    // (REMOTE_JOB_TURN_EVENT, carrying the source device and the outcome), so it
    // must NOT also take the fleet-framed orb-note path below — that would show
    // the same reply twice, once labelled as fleet work it isn't.
    let is_remote_device_turn = matches!(
        &origin,
        TurnOrigin::External { source } if is_remote_device_source(source)
    );
    if suppress_chat
        && !is_fleet_turn
        && !is_remote_device_turn
        && dispatched.approvals.is_empty()
        && !reply_text.trim().is_empty()
    {
        // Non-fleet suppressed turns keep the generic orb-note path. Fleet
        // turns are handled per-session in `finish_assessment_turn` below —
        // their reply carries one verdict line per batched session.
        crate::commands::companion::fleet_bridge::surface_fleet_orb_note(
            app,
            &user_db,
            &turn_id,
            &reply_text,
        );
    }

    // Fleet orchestration completion: route the batch's outcome — per-session
    // verdict lines, dispatched actions, and the unanswered — through the
    // single finish hook, which also releases the doze guards and re-drains
    // the wake queue for the next batch.
    if is_fleet_turn {
        let acted: std::collections::HashSet<String> = dispatched
            .approvals
            .iter()
            .filter(|a| matches!(a.action.as_str(), "fleet_send_input" | "fleet_intervene"))
            .filter_map(|a| {
                serde_json::from_str::<serde_json::Value>(&a.params_json)
                    .ok()
                    .and_then(|v| {
                        v.get("session_id")
                            .and_then(|x| x.as_str())
                            .map(String::from)
                    })
            })
            .collect();
        crate::commands::companion::fleet_bridge::finish_assessment_turn(
            app,
            &user_db,
            &turn_id,
            &reply_text,
            &acted,
        );
    }

    // Athena value expansion / A1: record this turn's usage + dispatcher
    // side-effect counts in the companion_turn ledger so the Overview
    // dashboards can show what Athena costs and for what kind of work.
    // Best-effort — never blocks the turn.
    {
        let (origin_str, trigger_kind) = ledger_origin_of(&origin);
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
                model: Some(companion_turn_model()),
                usage: cli_usage,
                voice: voice_enabled,
                assistant_episode_id: Some(assistant_ep_id.clone()),
                outcome_json,
                prompt_blocks_json: prompt_blocks.to_json(),
                prompt_block_hashes_json: prompt_blocks.hashes_json(),
                total_prompt_chars: Some(prompt_blocks.total() as u32),
                // The turn completed. `CliUsage.is_error` still flags the row
                // if the CLI itself reported an error result.
                failed: false,
                error_reason: None,
            },
        );
        // This turn is now on the ledger. Any later error must not add a
        // second row for it.
        ledger.disarm();
    }

    // Autonomous autoapprove. When autonomous mode is on, walk this turn's new
    // approvals and resolve them immediately, the same way a user click would —
    // the mode IS the standing consent, so there is no per-action allowlist any
    // more (2026-08-10; see `approval_autopilot`). The only proposals still left
    // pending are the ones their own rule defers: a fleet action below the
    // boldness × class × confidence bar, and a `remote_instruct` the device rule
    // refuses. Runs BEFORE the APPROVALS_EVENT emit so the frontend's refetch
    // sees the already-resolved state and doesn't render a card that's about to
    // disappear.
    if autonomous_mode && !dispatched.approvals.is_empty() {
        for approval in &dispatched.approvals {
            match crate::commands::companion::approvals::auto_resolve_if_allowed(app, approval)
                .await
            {
                Ok(true) => tracing::info!(
                    approval_id = %approval.id,
                    action = %approval.action,
                    "autonomous-mode autoapprove: resolved"
                ),
                Ok(false) => {} // its own rule deferred it — stays pending, normal user click
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

    // compose_tour auto-fire (Generative Tours). Every spec in this vec
    // already passed the anchor-manifest validation in the dispatcher, so
    // persistence is a plain save; the tour surfaces in Home → Learning
    // (composed-by-Athena lane) rather than interrupting the current turn.
    for spec_json in &dispatched.composed_tours {
        let persist = serde_json::from_str::<serde_json::Value>(spec_json)
            .map_err(|e| e.to_string())
            .and_then(|spec| {
                let topic = spec
                    .get("topic")
                    .and_then(|v| v.as_str())
                    .unwrap_or("walkthrough")
                    .to_string();
                let title = spec
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Walkthrough")
                    .to_string();
                let description = spec
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let steps = spec
                    .get("steps")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                crate::companion::tours::save_tour(&user_db, &topic, &title, &description, &steps)
                    .map_err(|e| e.to_string())
            });
        if let Err(e) = persist {
            tracing::warn!(error = %e, "companion compose_tour save failed");
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

    // compose_canvas_panel auto-fire (WP3). No server-side persistence by
    // design: the panel lands in the canvas LAYOUT document, which the frontend
    // owns — that is where a panel is keyed per project and where its reset
    // control can remove it. The slug in each entry was already resolved
    // against the published scene, so the listener can trust it.
    for panel in &dispatched.canvas_panels {
        let payload = serde_json::json!({
            "slug": panel.slug,
            "specVersion": panel.spec_version,
            "spec": panel.spec,
        });
        if let Err(e) = app.emit(COMPOSE_CANVAS_PANEL_EVENT, payload) {
            tracing::warn!(error = %e, "companion compose_canvas_panel event emit failed");
        }
    }

    // canvas_control auto-fire (WP4). One event per validated steering action,
    // in emission order — the frontend grammar queue executes them serially,
    // so a focus-then-open sequence lands as she wrote it. The session id in
    // the payload is what lets the bridge report the settled result back to
    // THIS conversation via `companion_canvas_control_result`.
    for control in &dispatched.canvas_controls {
        let payload = serde_json::json!({
            "sessionId": session_id,
            "action": control.action,
        });
        if let Err(e) = app.emit(CANVAS_CONTROL_EVENT, payload) {
            tracing::warn!(error = %e, "companion canvas_control event emit failed");
        }
    }

    // Inline chat-cards. Emitted once per turn with the full list so the
    // frontend appends to the latest bubble.
    //
    // INFORMATIONAL kinds stay transient — they are UI snippets riding along
    // with a reply, and clearing them on the next send is the intent.
    // ACTIONABLE kinds (fleet_plan / ship_milestone) are proposals that WRITE
    // on confirm, and their plan JSON is stripped from the assistant text
    // before episode persistence — so a transient-only card meant a refresh
    // destroyed the proposal unrecoverably. Those get a durable row FIRST and
    // the row id rides in the payload, which is what lets the frontend resolve
    // (and re-hydrate) them. A persistence failure degrades to the old
    // transient behaviour rather than dropping the card.
    if !dispatched.chat_cards.is_empty() {
        let cards: Vec<serde_json::Value> = dispatched
            .chat_cards
            .iter()
            .map(|card| {
                let mut value = serde_json::json!({
                    "kind": card.kind,
                    "title": card.title,
                    "config": card.config,
                });
                if crate::commands::companion::chat_cards::is_actionable_kind(&card.kind) {
                    let config_json = card.config.to_string();
                    match crate::commands::companion::chat_cards::insert_card(
                        &user_db,
                        &session_id,
                        Some(assistant_ep_id.as_str()),
                        &card.kind,
                        card.title.as_deref(),
                        config_json,
                    ) {
                        Ok(id) => {
                            value["id"] = serde_json::Value::String(id);
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, kind = %card.kind, "companion chat card persist failed");
                        }
                    }
                }
                value
            })
            .collect();
        let payload = serde_json::json!({
            "turnId": turn_id.clone(),
            "cards": cards,
        });
        if let Err(e) = app.emit(CHAT_CARDS_EVENT, payload) {
            tracing::warn!(error = %e, "companion chat_cards event emit failed");
        }
    }

    // Per-turn rollup of dispatcher side-effects. The chip on each
    // completed bubble reads this; total=0 turns get nothing. Best-effort —
    // a missed emit just means no chip for that turn.
    if !suppress_chat {
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

    if !suppress_chat {
        emit(
            app,
            StreamEvent {
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
                kind: StreamEventKind::Finished,
                payload: assistant_ep_id.clone(),
            },
        );
    }

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
                // The chain stays in the conversation that spawned it.
                session_id.clone(),
            );
        }
    }

    Ok(TurnResult {
        user_episode_id: user_ep_id,
        assistant_episode_id: assistant_ep_id,
        assistant_text: display_text,
        quick_replies: dispatched.quick_replies,
        tts_text: dispatched.tts_text,
    })
}
