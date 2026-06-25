//! Bridge command — frontend pushes Fleet lifecycle events into Athena's
//! episodic memory.
//!
//! The Fleet plugin emits `FLEET_SESSION_STATE`, `FLEET_SESSION_EXITED`
//! and `FLEET_REGISTRY_CHANGED` Tauri events. The companion store
//! subscribes to those events in the frontend and calls this command to
//! persist a System episode + (optionally) raise a proactive nudge.
//!
//! Persistence (not nudges) is the unconditional behaviour — every
//! relevant fleet event becomes a single episode. Nudge gating is the
//! "adaptive noise floor": quiet by default; the dispatch loop already
//! reads `companion_autonomous_mode` and the proactive evaluator chooses
//! whether to fire (see `proactive::fleet_triggers`).
//!
//! The command shape is intentionally narrow — frontend already has the
//! session metadata (project label, cwd, state) from its FleetSession
//! cache, so it ships everything in one call and the Rust side avoids
//! a second round-trip to the fleet registry.
//!
//! All fields are owned strings to keep the command shape simple. Volume
//! is low (state transitions happen on hook events, capped by Claude
//! Code's hook firing rate).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use tauri::{Emitter, State};

use crate::commands::fleet::types::FleetSessionState;
use crate::companion::brain::fleet::{record_fleet_event, FleetEpisodeInput, FleetEventKind};
use crate::companion::orchestration::operative_memory::OperationStatus;
use crate::error::AppError;
use crate::AppState;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionRecordFleetEventInput {
    pub session_id: String,
    pub claude_session_id: Option<String>,
    pub project_label: String,
    pub cwd: String,
    /// Discriminator: "state_changed" | "exited" | "spawned".
    pub kind: String,
    /// For `state_changed`: the new lifecycle state token.
    pub state: Option<String>,
    /// For `state_changed`: optional reason (last hook reason).
    pub reason: Option<String>,
    /// For `exited`: process exit code, or null on signal/crash.
    pub exit_code: Option<i32>,
    /// For `spawned`: true when Athena spawned the session via
    /// `fleet_spawn` (skips proactive nudges to avoid feedback loops).
    pub athena_owned: Option<bool>,
}

#[tauri::command]
pub async fn companion_record_fleet_event(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    input: CompanionRecordFleetEventInput,
) -> Result<String, AppError> {
    crate::ipc_auth::require_auth(&state).await?;

    let kind = match input.kind.as_str() {
        "spawned" => FleetEventKind::Spawned {
            athena_owned: input.athena_owned.unwrap_or(false),
        },
        "exited" => FleetEventKind::Exited {
            exit_code: input.exit_code,
        },
        "state_changed" => {
            let st = parse_state_token(input.state.as_deref().unwrap_or(""))
                .ok_or_else(|| AppError::Validation(format!(
                    "unknown fleet state token: {:?}", input.state,
                )))?;
            FleetEventKind::StateChanged {
                state: st,
                reason: input.reason.as_deref(),
            }
        }
        other => {
            return Err(AppError::Validation(format!(
                "unknown fleet event kind: {other}",
            )));
        }
    };

    let event = FleetEpisodeInput {
        session_id: &input.session_id,
        claude_session_id: input.claude_session_id.as_deref(),
        project_label: &input.project_label,
        cwd: &input.cwd,
        kind: kind.clone(),
    };

    // Update operative memory alongside the episode write. Operative
    // memory is in-process, no DB; the call is sync and cheap. Doing
    // it here (not in a separate command) keeps Athena's "what's
    // happening now" view consistent with her "what happened" memory.
    let mem = crate::companion::orchestration::operative_memory::memory();
    match &kind {
        FleetEventKind::StateChanged { state: fs_state, .. } => {
            mem.record_session_event(
                &input.session_id,
                input.claude_session_id.as_deref(),
                &input.project_label,
                &input.cwd,
                *fs_state,
            );
            // Active fleet orchestration: when a session pauses for input,
            // wake Athena (autonomous mode only) to decide its next step.
            // (Also fired Rust-direct from apply_hook for headless reliability;
            // the per-session throttle dedups the two paths.)
            if matches!(*fs_state, FleetSessionState::AwaitingInput) {
                orchestrate_on_awaiting(&app, &state, &input.session_id, &input.project_label);
            }
        }
        FleetEventKind::Spawned { .. } => {
            mem.record_session_event(
                &input.session_id,
                input.claude_session_id.as_deref(),
                &input.project_label,
                &input.cwd,
                crate::commands::fleet::types::FleetSessionState::Spawning,
            );
        }
        FleetEventKind::Exited { exit_code } => {
            // Run the synthesizer first so the SessionRef.summary is
            // populated before record_fleet_event reads it for the
            // episode body (Direction 4 — replaces UUID-only episodes
            // with synthesized work logs).
            let synthesized = mem.synthesize_session_summary(&input.session_id, *exit_code);
            mem.record_session_event(
                &input.session_id,
                input.claude_session_id.as_deref(),
                &input.project_label,
                &input.cwd,
                crate::commands::fleet::types::FleetSessionState::Exited,
            );
            // The synthesized summary is available via SessionRef but
            // not currently propagated into the episode body — that
            // path requires record_fleet_event to consult operative
            // memory. We pull that thread inline below.
            //
            // After writing the per-session summary, run the operation
            // reconciler — if this session was the last one in a
            // dispatched_by_athena operation to exit, synthesize the
            // cross-session wrap-up and surface it (Direction 5 v2).
            let episode_id_result = if let Some(summary) = synthesized {
                write_episode_with_summary(&state.user_db, &input, *exit_code, &summary)
            } else {
                record_fleet_event(&state.user_db, event)
            };
            reconcile_if_dispatched(&state.user_db, &app, &input.session_id);
            crate::companion::orchestration::emit_digest_changed(&app);
            return episode_id_result;
        }
    }

    let result = record_fleet_event(&state.user_db, event);
    // D7 — notify the live-ops strip that the digest changed. Cheap;
    // frontend debounces and re-fetches via
    // `companion_get_operative_memory_digest`.
    crate::companion::orchestration::emit_digest_changed(&app);
    result
}

/// Per-session throttle for fleet-attention wakeups — don't re-wake Athena
/// about the same session more than once per window (a session can bounce
/// AwaitingInput↔Running, and Athena's own writes change state, so without
/// this an orchestration turn could loop).
fn attention_throttle() -> &'static Mutex<HashMap<String, i64>> {
    static T: OnceLock<Mutex<HashMap<String, i64>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(HashMap::new()))
}
const ATTENTION_MIN_INTERVAL_MS: i64 = 60_000;

/// Per-session signature of the last on-screen decision we assessed. An
/// unchanged prompt must NOT re-wake Athena — re-asking the same question yields
/// the same answer and just spams. The 60s throttle catches rapid bounces; this
/// catches a session that simply sits on one prompt for minutes.
fn decision_signatures() -> &'static Mutex<HashMap<String, u64>> {
    static S: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Active fleet orchestration (autonomous mode only): when a session enters
/// `AwaitingInput` — it finished its turn / is paused waiting for the next
/// instruction — wake Athena with the live fleet digest so she decides the
/// next step. She either proposes a `fleet_send_input` (auto-applied via the
/// autonomous allowlist) or surfaces a decision to the user via the orb. Gated
/// on autonomous mode + throttled per session so it can't spam or loop.
pub fn orchestrate_on_awaiting(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: &str,
    project_label: &str,
) {
    if !crate::commands::companion::chat::autonomous_mode_enabled(&state.db) {
        return;
    }
    let now = crate::commands::fleet::registry::now_ms();
    {
        let mut t = attention_throttle().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(&last) = t.get(session_id) {
            if now - last < ATTENTION_MIN_INTERVAL_MS {
                return;
            }
        }
        t.insert(session_id.to_string(), now);
        // Light GC so the map doesn't grow unbounded across many sessions.
        t.retain(|_, &mut last| now - last < 10 * ATTENTION_MIN_INTERVAL_MS);
    }

    tracing::info!(
        target: "fleet_orchestration",
        session_id = %session_id,
        project = %project_label,
        "waking Athena to assess the fleet (session entered AwaitingInput)"
    );
    let digest = crate::companion::orchestration::operative_memory::memory().digest_for_prompt();

    // (A) Capture what's actually on this session's screen — the prompt or
    // decision it's blocked on — so Athena can evaluate a real single/multi-select
    // question and pick or defer, instead of reasoning blind from the fleet
    // digest. RECONSTRUCTED via a VT emulator (`render_screen_for`) from the
    // always-on PTY ring, so it works regardless of UI subscription AND renders
    // an interactive cursor-addressed TUI (an AskUserQuestion menu, a permission
    // prompt) as the operator sees it — the old line-cooker collapsed those to
    // empty/fragments, so Athena saw nothing and refused to decide.
    let screen_text = crate::commands::fleet::registry::registry()
        .render_screen_for(session_id)
        .map(|(_, lines)| lines.join("\n"))
        .unwrap_or_default();
    // Content-aware dedup: if this session's on-screen decision is unchanged
    // since we last assessed it, don't wake her again. (The cooked tail strips
    // ANSI/cursor, so the same prompt hashes stably.) This is what stops the
    // "still parked, your checkpoint" loop on a session that sits on one prompt.
    {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        screen_text.hash(&mut h);
        let sig = h.finish();
        let mut sigs = decision_signatures().lock().unwrap_or_else(|e| e.into_inner());
        if sigs.insert(session_id.to_string(), sig) == Some(sig) {
            return; // same decision as last assessment — nothing new to decide
        }
    }

    // (B) Feed the on-screen decision to her — only when there's something to show.
    let screen_block = if screen_text.trim().is_empty() {
        String::new()
    } else {
        format!(
            "\n\nWhat this session's terminal currently shows — the prompt/decision it's waiting on:\n\
             ```\n{screen_text}\n```\n"
        )
    };

    let directive = format!(
        "Fleet orchestration check. Session \"{project_label}\" (project {project_label}) just entered \
         AwaitingInput — it finished its turn, or it's blocked on a prompt/decision (a single- or \
         multiple-select question, a permission, or free-text input).{screen_block}\n\
         Fleet (brief background only):\n\n{digest}\n\n\
         Focus on THIS session only and decide its single next step. This is a quick orchestration \
         check, NOT a fleet status report — do NOT summarize, list, or re-flag the other sessions.\n\
         • (C) If the screen above shows a QUESTION or a SELECT decision, read the options and judge \
         whether one is clearly best. If so, ANSWER it: propose a fleet_send_input whose `text` is \
         exactly what to type to choose that option — the option's number, or its text — with \
         press_enter true.\n\
         • Every fleet_send_input MUST carry a `confidence` param (\"high\", \"medium\", or \"low\"), \
         the exact `text`, and a one-line `rationale`.\n\
         • \"high\" = obvious, safe, you'd stake your judgment on it with no second opinion — applied \
         automatically with no human check, so reserve it for the genuinely unambiguous.\n\
         • \"medium\"/\"low\" = any real doubt, a judgment call, or a wrong move would cost rework. \
         NOT auto-applied: they surface to the user as a decision on the orb, so make `rationale` a \
         crisp one-liner and still include your recommended `text`.\n\
         • (D) If it's genuinely the USER's call — a personal preference, a risk you shouldn't take on \
         their behalf, or the work looks finished — do NOT propose a send-input. Instead surface a \
         concise decision on the orb telling them you're leaving this one to them; and if you have a \
         lean, name your recommended option in one line so they can decide at a glance.\n\
         • If this session is just progressing fine, do nothing at all.\n\
         Keep your reply to AT MOST two short sentences — it's a brief orb note, not a chat essay; \
         no preamble, no fleet-wide recap.",
    );

    // P3 — show the operator that Athena has TAKEN this ticket and is reasoning:
    // flip the tile to the light-blue "Athena's on it" state for her work window.
    // Cleared automatically once she acts (→ Running) or the window lapses.
    if crate::commands::fleet::registry::registry().mark_athena_active(session_id) {
        crate::commands::fleet::pty::emit_registry_changed(app, "updated", session_id);
    }

    crate::companion::session::spawn_proactive_turn(
        app.clone(),
        Arc::new(state.user_db.clone()),
        Arc::new(state.db.clone()),
        #[cfg(feature = "ml")]
        state.embedding_manager.clone(),
        "fleet_orchestration".to_string(),
        Some(session_id.to_string()),
        directive,
    );
}

/// Surface a fleet-orchestration **defer note** as an orb card instead of a
/// chat episode. The companion turn for `fleet_orchestration` suppresses every
/// chat side-effect (see `session::send_turn`'s `suppress_chat`), so when Athena
/// leaves a decision to the user with a prose note — and has no `fleet_send_input`
/// approval to carry it onto the orb — that note would otherwise vanish. Route it
/// through the same proactive-nudge path the op-wrap-up reconciler uses: a card
/// the user can engage/dismiss. `turn_ref` is the per-turn id, so the
/// (kind, ref) dedupe never collides across sequential decisions. Best-effort.
pub fn surface_fleet_orb_note(
    app: &tauri::AppHandle,
    pool: &crate::db::UserDbPool,
    turn_ref: &str,
    message: &str,
) {
    let nudge = crate::companion::proactive::Nudge {
        trigger_kind: "fleet_orchestration".to_string(),
        trigger_ref: Some(turn_ref.to_string()),
        message: message.to_string(),
    };
    match crate::companion::proactive::enqueue_external(pool, &nudge) {
        Ok(Some(msg)) => {
            if let Err(e) = crate::companion::proactive::mark_delivered(pool, &msg.id) {
                tracing::warn!(id = %msg.id, error = %e, "fleet orb note: mark_delivered failed");
            }
            let delivered = crate::companion::proactive::ProactiveMessage {
                status: "delivered".into(),
                ..msg
            };
            let payload = crate::commands::companion::proactive::ProactiveDelivery {
                messages: vec![delivered],
            };
            if let Err(e) = app.emit(
                crate::commands::companion::proactive::PROACTIVE_EVENT,
                payload,
            ) {
                tracing::warn!(error = %e, "fleet orb note: proactive emit failed");
            }
        }
        Ok(None) => {
            // Dedupe — this exact turn already surfaced a card. Shouldn't
            // happen (turn ids are unique) but harmless if it does.
        }
        Err(e) => tracing::warn!(error = %e, "fleet orb note: enqueue failed"),
    }
}

/// Public re-export so the PTY reaper (`commands::fleet::pty`) can fire
/// the same reconciliation path the frontend bridge takes when a
/// session exits before the JS-side `useFleetCompanionBridge` has
/// primed its store. Both call sites are idempotent — see the
/// `op.completion_summary.is_none()` guard inside.
pub fn reconcile_if_dispatched_public(
    pool: &crate::db::UserDbPool,
    app: &tauri::AppHandle,
    fleet_session_id: &str,
) {
    reconcile_if_dispatched(pool, app, fleet_session_id);
}

/// Direction 5 v2 reconciler — fired after each session-exit event.
/// When the exiting session belongs to a `dispatched_by_athena`
/// operation whose every session has reached a terminal state,
/// synthesize the operation-level wrap-up, write it as an episode,
/// and emit a Tauri event so the chat panel can render an inline
/// notice. No-op for ad-hoc operations or partial completions.
fn reconcile_if_dispatched(
    pool: &crate::db::UserDbPool,
    app: &tauri::AppHandle,
    fleet_session_id: &str,
) {
    let mem = crate::companion::orchestration::operative_memory::memory();
    let Some(op_id) = mem.find_operation_for_session(fleet_session_id) else {
        return;
    };
    let Some(op) = mem.snapshot_operation(&op_id) else {
        return;
    };
    if !op.dispatched_by_athena {
        return; // ad-hoc ops don't get cross-session wrap-ups
    }
    if !matches!(op.status, OperationStatus::Completed | OperationStatus::Failed) {
        return; // sessions still running
    }
    // Idempotency: only synthesize once. The summary field is set by
    // synthesize_operation_summary; if it's already populated, this
    // op has been reconciled.
    if op.completion_summary.is_some() {
        return;
    }

    let Some(summary) = mem.synthesize_operation_summary(&op_id) else {
        return;
    };

    // Write an episode so Athena's next turn can recall the wrap-up
    // even after the operative-memory entry ages out. Same marker
    // shape as per-session summaries so retrieval is uniform.
    use crate::companion::brain::episodic::{append_episode, EpisodeRole};
    use crate::companion::session::DEFAULT_SESSION_ID;
    let status_token = match op.status {
        OperationStatus::Completed => "op_completed",
        OperationStatus::Failed => "op_failed",
        OperationStatus::Active => "op_active",
    };
    let body = format!(
        "fleet-orchestration op:{op_id} state:{status_token} intent:{intent}\n\n{summary}",
        op_id = op.id,
        intent = op.user_intent.replace('\n', " "),
    );
    if let Err(e) = append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, &body) {
        tracing::warn!(error = %e, op_id = %op.id, "reconcile: episode append failed");
    }

    // Notify the frontend so the chat panel can render an inline
    // "operation X just wrapped" card. Payload is structured so the
    // panel can choose its own affordance (expand/collapse summary,
    // click-through to the brain viewer for the underlying episode).
    let payload = ReconciledPayload {
        operation_id: op.id.clone(),
        intent: op.user_intent.clone(),
        status: status_token,
        summary: summary.clone(),
    };
    if let Err(e) = app.emit("athena://orchestration/operation-completed", &payload) {
        tracing::warn!(error = %e, op_id = %op.id, "reconcile: emit failed");
    }

    // D6 — also enqueue a proactive message so Athena surfaces the
    // wrap-up in the chat panel even when the user isn't watching the
    // live ops view. `enqueue_external` skips the daily budget gate
    // because this isn't a speculative trigger — the user explicitly
    // dispatched the op and should always hear how it landed. The
    // (trigger_kind, trigger_ref) dedupe still applies, so a duplicate
    // exit-event firing the reconciler twice can't double-deliver.
    let proactive_message = format_proactive_wrap_up(&op.user_intent, status_token, &summary);
    let nudge = crate::companion::proactive::Nudge {
        trigger_kind: crate::companion::proactive::FLEET_OP_COMPLETED_TRIGGER_KIND.to_string(),
        trigger_ref: Some(op.id.clone()),
        message: proactive_message,
    };
    match crate::companion::proactive::enqueue_external(pool, &nudge) {
        Ok(Some(msg)) => {
            // Snappy delivery — don't wait for the 5-minute scheduler
            // tick. Transition queued→delivered immediately and emit
            // the same `companion://proactive` event the scheduler
            // would. The frontend's existing proactive subscription
            // renders the card without code changes.
            if let Err(e) = crate::companion::proactive::mark_delivered(pool, &msg.id) {
                tracing::warn!(id = %msg.id, error = %e, "reconcile: mark_delivered failed");
            }
            let delivered = crate::companion::proactive::ProactiveMessage {
                status: "delivered".into(),
                ..msg
            };
            let payload = crate::commands::companion::proactive::ProactiveDelivery {
                messages: vec![delivered],
            };
            if let Err(e) = app.emit(
                crate::commands::companion::proactive::PROACTIVE_EVENT,
                payload,
            ) {
                tracing::warn!(error = %e, op_id = %op.id, "reconcile: proactive emit failed");
            }
        }
        Ok(None) => {
            // Dedupe — same op_id already has an unresolved wrap-up
            // queued/delivered. Expected when reconcile_if_dispatched
            // fires twice (Rust reaper path + JS bridge path).
        }
        Err(e) => {
            tracing::warn!(error = %e, op_id = %op.id, "reconcile: enqueue_external failed");
        }
    }
}

/// Build the user-facing chat-card body for a fleet wrap-up. Keep it
/// short — the proactive card shows it in a constrained surface; the
/// full synthesized summary lives in the episode body for Athena to
/// retrieve when the user asks for details.
fn format_proactive_wrap_up(
    intent: &str,
    status_token: &'static str,
    summary: &str,
) -> String {
    let outcome = match status_token {
        "op_completed" => "completed",
        "op_failed" => "failed",
        _ => "finished",
    };
    // Take the first non-empty line of the summary as the headline;
    // everything else stays in episodic memory for retrieval. This
    // keeps the proactive card glance-readable.
    let headline = summary
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();
    let headline = if headline.chars().count() > 240 {
        let mut s: String = headline.chars().take(240).collect();
        s.push('…');
        s
    } else {
        headline.to_string()
    };
    format!(
        "Operation \"{intent}\" {outcome}. {headline}"
    )
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReconciledPayload {
    operation_id: String,
    intent: String,
    status: &'static str,
    summary: String,
}

/// Direction 4 helper — write an Exited episode whose body uses the
/// operative-memory synthesized summary instead of the bare
/// "exited code N" line. The marker tokens stay so retrieval still
/// works; the human-readable summary is appended below.
fn write_episode_with_summary(
    pool: &crate::db::UserDbPool,
    input: &CompanionRecordFleetEventInput,
    exit_code: Option<i32>,
    summary: &str,
) -> Result<String, AppError> {
    use crate::companion::brain::episodic::{append_episode, EpisodeRole};
    use crate::companion::session::DEFAULT_SESSION_ID;

    let csid = input.claude_session_id.as_deref().unwrap_or("-");
    let exit_token = match exit_code {
        Some(0) => "exited_clean",
        Some(_) => "exited_failed",
        None => "exited_abnormal",
    };
    let body = format!(
        "fleet-event session:{sid} cc:{csid} state:{tok} project:{proj}\n\nSession **{sid}** ({proj}) {summary}",
        sid = input.session_id,
        tok = exit_token,
        proj = input.project_label,
    );
    append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, &body)
}

fn parse_state_token(s: &str) -> Option<FleetSessionState> {
    match s {
        "spawning"       => Some(FleetSessionState::Spawning),
        "running"        => Some(FleetSessionState::Running),
        "awaiting_input" => Some(FleetSessionState::AwaitingInput),
        "idle"           => Some(FleetSessionState::Idle),
        "stale"          => Some(FleetSessionState::Stale),
        "hibernated"     => Some(FleetSessionState::Hibernated),
        "exited"         => Some(FleetSessionState::Exited),
        _ => None,
    }
}

/// Read-only inspector for the in-process operative-memory digest.
/// Same string that lands in Athena's prompt every turn — useful for
/// debugging the orchestration view from the chat panel or from
/// integration tests without taking a turn.
#[tauri::command]
pub async fn companion_get_operative_memory_digest(
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    crate::ipc_auth::require_auth(&state).await?;
    Ok(crate::companion::orchestration::operative_memory::memory().digest_for_prompt())
}

/// D10 — run the rule-based fleet pattern extractor on demand. Reads
/// recent dispatched-op episodes from episodic memory, aggregates by
/// role combination, and writes one low-confidence procedural per
/// combo that has at least the minimum-sample threshold of runs.
/// Returns the ids of any procedurals written this pass.
///
/// Not auto-scheduled in v1 — Athena (or the user via the brain
/// viewer) invokes it when fresh patterns would be useful.
#[tauri::command]
pub async fn companion_extract_fleet_patterns(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<String>, AppError> {
    crate::ipc_auth::require_auth(&state).await?;
    crate::companion::brain::fleet_patterns::extract_patterns(&state.user_db)
}
