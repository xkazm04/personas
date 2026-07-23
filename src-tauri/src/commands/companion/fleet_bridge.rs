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

/// What prompted a per-session orchestration wake — selects the decision framing
/// Athena receives. The surrounding machinery (autonomous gate, 60 s throttle,
/// screen render + hash dedupe, "Athena's on it" tile, suppress_chat spawn) is
/// identical across every situation; only the directive's framing and the action
/// she's asked to propose differ. So the screen-hash dedupe still guarantees an
/// unchanged screen never re-wakes her, whichever situation surfaced the session.
enum FleetSituation {
    /// Session entered `AwaitingInput` — it finished its turn or is blocked on a
    /// prompt/decision. She answers with a `fleet_send_input`, or defers.
    AwaitingInput,
    /// Phase 3a — a dispatched session finished its turn and is idling at the
    /// prompt (`Stop → Idle`) with a live objective. She judges done-vs-needs-next
    /// and, if work remains, sends the next step via `fleet_send_input`; if the
    /// objective looks complete she leaves it alone.
    IdleNeedsNext,
    /// Phase 3b — a dispatched session looks stuck: its last action failed and it
    /// has made no progress for a few minutes. She proposes a `fleet_intervene`
    /// to unblock it, or defers. Carries the truncated failure tail so she reasons
    /// from the concrete error, not a blind "it's stuck".
    Stuck { failure: String },
}

impl FleetSituation {
    fn label(&self) -> &'static str {
        match self {
            FleetSituation::AwaitingInput => "awaiting_input",
            FleetSituation::IdleNeedsNext => "idle_needs_next",
            FleetSituation::Stuck { .. } => "stuck",
        }
    }
}

/// Active fleet orchestration (autonomous mode only): when a session enters
/// `AwaitingInput` — it finished its turn / is paused waiting for the next
/// instruction — wake Athena with the live fleet digest so she decides the
/// next step. She either proposes a `fleet_send_input` (auto-applied via the
/// autonomous allowlist) or surfaces a decision to the user via the orb. Thin
/// wrapper over [`orchestrate_session`]; see there for the shared machinery.
pub fn orchestrate_on_awaiting(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: &str,
    project_label: &str,
) {
    orchestrate_session(
        app,
        state,
        session_id,
        project_label,
        FleetSituation::AwaitingInput,
    );
}

/// Shared per-session orchestration wake used by every fleet trigger — the
/// hook-path + timer re-check pass `AwaitingInput`, the proactive tick's
/// stuck-recovery passes `Stuck`. Gated on autonomous mode + a 60 s per-session
/// throttle + a screen-hash dedupe so it can't spam or loop, whichever situation
/// surfaced the session.
fn orchestrate_session(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: &str,
    project_label: &str,
    situation: FleetSituation,
) {
    use crate::commands::fleet::debug_log;
    if !crate::commands::companion::chat::autonomous_mode_enabled(&state.db) {
        // The single most common "why did Athena do nothing?" answer. Worth a
        // line — silence here is indistinguishable from a bug otherwise.
        debug_log::athena(
            session_id,
            "skipped",
            &format!("autonomous mode is OFF · situation={}", situation.label()),
        );
        return;
    }
    let now = crate::commands::fleet::registry::now_ms();
    {
        let mut t = attention_throttle().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(&last) = t.get(session_id) {
            if now - last < ATTENTION_MIN_INTERVAL_MS {
                debug_log::athena(
                    session_id,
                    "skipped",
                    &format!(
                        "throttled · woken {}s ago (min {}s) · situation={}",
                        (now - last) / 1000,
                        ATTENTION_MIN_INTERVAL_MS / 1000,
                        situation.label()
                    ),
                );
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
        situation = situation.label(),
        "waking Athena to assess the fleet"
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
        // Phase 5a — durable cross-restart dedupe: if she already AUTO-FIRED on
        // this exact screen (same STABLE conversation id), don't re-wake her. The
        // in-memory map below is lost on restart; this ledger check isn't. Only
        // auto-fires suppress — a prior defer can still get a fresh look.
        if let Some(csid) = claude_session_id_for(session_id) {
            let hex = format!("{sig:016x}");
            if crate::db::repos::fleet_decisions::has_prior_autofire(&state.db, &csid, &hex)
                .unwrap_or(false)
            {
                debug_log::athena(
                    session_id,
                    "skipped",
                    &format!("already auto-fired on this exact screen (hash {hex}) — durable dedupe"),
                );
                return;
            }
        }
        let mut sigs = decision_signatures().lock().unwrap_or_else(|e| e.into_inner());
        if sigs.insert(session_id.to_string(), sig) == Some(sig) {
            debug_log::athena(
                session_id,
                "skipped",
                "screen unchanged since the last assessment — nothing new to decide",
            );
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

    // (B.1) Phase 5b — the session's objective (from operative memory), so she
    // judges the next step against what this session is actually FOR — done vs
    // needs-next — instead of reasoning only from the current screen. Empty for a
    // session with no tracked goal (an ad-hoc user spawn).
    let objective = session_objective(session_id);
    let objective_block = match &objective {
        Some(obj) => format!("\nThis session's objective: {obj}\n"),
        None => String::new(),
    };

    // Past every gate — she is actually being woken. The screen is reported by
    // SIZE only; its contents are the user's code and never enter the log. An
    // empty screen here is itself a finding: it means she reasoned blind.
    debug_log::athena(
        session_id,
        "wake",
        &format!(
            "situation={} · screen={} · objective={}",
            situation.label(),
            if screen_text.trim().is_empty() {
                "EMPTY (reasoning blind)".to_string()
            } else {
                format!("{}ch", screen_text.chars().count())
            },
            objective.as_deref().unwrap_or("(none tracked)"),
        ),
    );

    let directive = match &situation {
        FleetSituation::AwaitingInput => format!(
        "Fleet orchestration check. Session \"{project_label}\" (project {project_label}) just entered \
         AwaitingInput — it finished its turn, or it's blocked on a prompt/decision (a single- or \
         multiple-select question, a permission, or free-text input).{screen_block}{objective_block}\n\
         Fleet (brief background only):\n\n{digest}\n\n\
         Focus on THIS session only and decide its single next step. This is a quick orchestration \
         check, NOT a fleet status report — do NOT summarize, list, or re-flag the other sessions.\n\
         • (C) If the screen above shows a QUESTION or a SELECT decision, read the options and judge \
         whether one is clearly best. If so, ANSWER it: propose a fleet_send_input whose `text` is \
         exactly what to type to choose that option — the option's number, or its text — with \
         press_enter true.\n\
         • Every fleet_send_input MUST set `session_id` to EXACTLY \"{session_id}\" — copy that id \
         verbatim; it's THIS session, and the action can't run without it — plus the exact `text`, a \
         one-line `rationale`, a `confidence` (\"high\" | \"medium\" | \"low\"), and a `decision_class`.\n\
         • `decision_class` = \"drive_forward\" when your answer just moves the session along a path \
         already set — continue, proceed, the obvious or only next step, a reversible tweak. = \
         \"choice\" when it's irreversible, a real fork between materially different directions, or \
         genuinely the user's preference to make.\n\
         • `confidence` is your honest read, independent of class: \"high\" = obvious, you'd stake \
         your judgment on it with no second opinion; \"medium\" = a sound call but a wrong move would \
         cost some rework; \"low\" = real doubt. The system — not you — decides whether to apply it \
         automatically or surface it as an orb consult, from your class + confidence + the user's \
         autonomy setting (\"low\" is never auto-applied). Rate confidence honestly; don't inflate it \
         to force an action through.\n\
         • (D) If it's genuinely the USER's call — a personal preference, a risk you shouldn't take on \
         their behalf, or the work looks finished — do NOT propose a send-input. Instead surface a \
         concise decision on the orb telling them you're leaving this one to them; and if you have a \
         lean, name your recommended option in one line so they can decide at a glance.\n\
         • If this session is just progressing fine, do nothing at all.\n\
         Keep your reply to AT MOST two short sentences — it's a brief orb note, not a chat essay; \
         no preamble, no fleet-wide recap.",
        ),
        FleetSituation::IdleNeedsNext => format!(
        "Fleet orchestration — idle session. Session \"{project_label}\" (project {project_label}) \
         finished its last turn and is idling at the prompt.{screen_block}{objective_block}\n\
         Fleet (brief background only):\n\n{digest}\n\n\
         Focus on THIS session only. Against its objective above, judge whether it's DONE or has a \
         clear next step. This is a quick orchestration check, NOT a fleet status report — do NOT \
         summarize the other sessions.\n\
         • If concrete work remains toward the objective, propose a fleet_send_input whose `text` is \
         exactly the next instruction to type to advance it — one focused step, not a re-plan.\n\
         • Every fleet_send_input MUST set `session_id` to EXACTLY \"{session_id}\" — copy that id \
         verbatim; it's THIS session, and the action can't run without it — plus the exact `text`, a \
         one-line `rationale`, a `confidence` (\"high\" | \"medium\" | \"low\"), and a `decision_class`.\n\
         • `decision_class` = \"drive_forward\" when the next step is the obvious or only sensible \
         continuation. = \"choice\" when advancing means picking between materially different \
         directions, or it's really the user's call.\n\
         • `confidence` is your honest read: \"high\" = the next step is unambiguous; \"medium\" = a \
         sound call but a wrong move costs rework; \"low\" = real doubt. The system — not you — decides \
         auto-apply vs orb consult from your class + confidence + the user's autonomy setting (\"low\" \
         is never auto-applied).\n\
         • If the objective looks COMPLETE, or the next move is genuinely the USER's call, do NOT send \
         input. If it's done, do nothing at all; if it's their call, surface a concise one-line note \
         on the orb with your read.\n\
         Keep your reply to AT MOST two short sentences — it's a brief orb note, not a chat essay.",
        ),
        FleetSituation::Stuck { failure } => format!(
        "Fleet orchestration — stuck session. Session \"{project_label}\" (project {project_label}) is \
         in one of your dispatched operations and looks STUCK: its last action failed and it's made no \
         progress for a few minutes. The failure was:\n\n{failure}\n{screen_block}{objective_block}\n\
         Fleet (brief background only):\n\n{digest}\n\n\
         Focus on THIS session only. Judge whether one concrete nudge can get it moving again. This is \
         a quick orchestration check, NOT a fleet status report — do NOT summarize the other sessions.\n\
         • If you can see a concrete unblock — a corrected command, an answer to what it's stuck on, a \
         \"try X instead\" — propose a fleet_intervene whose `message` is exactly the one-line \
         instruction to type into the session to get it moving.\n\
         • Every fleet_intervene MUST set `session_id` to EXACTLY \"{session_id}\" — copy that id \
         verbatim; the action can't run without it — plus the exact `message`, a one-line `rationale`, \
         a `confidence` (\"high\" | \"medium\" | \"low\"), and a `decision_class`.\n\
         • `decision_class` = \"drive_forward\" when your nudge just gets it un-stuck along the path it \
         was already on — a retry, correcting an obvious mistake, the clear next step. = \"choice\" \
         when unblocking means picking between materially different directions, or it's really the \
         user's call.\n\
         • `confidence` is your honest read: \"high\" = you're confident this unblocks it; \"medium\" = \
         a sound guess that might not land; \"low\" = real doubt. The system — not you — decides \
         auto-apply vs orb consult from your class + confidence + the user's autonomy setting (\"low\" \
         is never auto-applied). You get ONE intervention per session — don't spend it on a guess you \
         don't believe in.\n\
         • If it genuinely needs the USER — a real fork, a risk you shouldn't take on their behalf, or \
         you can't tell what's wrong — do NOT propose an intervene. Surface a concise one-line note on \
         the orb with your best read so they can step in.\n\
         • If the session actually looks like it's recovering on its own, do nothing at all.\n\
         Keep your reply to AT MOST two short sentences — it's a brief orb note, not a chat essay.",
        ),
    };

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

/// Phase 2.4 execution-time re-check. `confidence` is uncalibrated self-report
/// and a live CLI screen can move between the moment Athena reasoned on it and
/// the moment her auto-fired `fleet_send_input` actually types — so before
/// applying one, confirm the screen still matches what she decided on. Re-renders
/// the current screen and compares its hash to the one recorded in
/// `decision_signatures` when she was last woken for this session. Returns:
///   `Some(true)`  — screen unchanged since she reasoned (safe to auto-fire),
///   `Some(false)` — screen changed (defer — the decision may target a stale prompt),
///   `None`        — no recorded decision hash to compare against (can't verify).
pub fn screen_matches_last_decision(session_id: &str) -> Option<bool> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let recorded = {
        let sigs = decision_signatures().lock().unwrap_or_else(|e| e.into_inner());
        *sigs.get(session_id)?
    };
    // Re-render the same way orchestrate_on_awaiting captured it, so the hashes
    // are directly comparable (cooked tail strips ANSI/cursor → stable hash).
    let screen_text = crate::commands::fleet::registry::registry()
        .render_screen_for(session_id)
        .map(|(_, lines)| lines.join("\n"))
        .unwrap_or_default();
    let mut h = DefaultHasher::new();
    screen_text.hash(&mut h);
    Some(h.finish() == recorded)
}

/// Phase 5a — the screen-hash (hex) Athena last reasoned on for a session, from
/// the in-memory decision signatures. Used to stamp the durable decision ledger
/// with the exact screen a decision was made on. `None` if she hasn't been woken
/// for this session yet.
pub fn recorded_decision_hash_hex(session_id: &str) -> Option<String> {
    let sigs = decision_signatures().lock().unwrap_or_else(|e| e.into_inner());
    sigs.get(session_id).map(|h| format!("{h:016x}"))
}

/// Phase 5a — the stable Claude conversation id for a live fleet session, if
/// bound. Unlike the ephemeral registry `id` (regenerated each launch), this
/// survives restarts, so it's the durable dedupe key for the decision ledger.
pub fn claude_session_id_for(session_id: &str) -> Option<String> {
    crate::commands::fleet::registry::registry()
        .list_dto()
        .into_iter()
        .find(|s| s.id == session_id)
        .and_then(|s| s.claude_session_id)
}

/// How long a session must sit in `AwaitingInput` before the proactive tick
/// re-assesses it. Below this, the hook-driven `orchestrate_on_awaiting` (fired
/// on the AwaitingInput transition) is the authoritative handler; this timer
/// path only catches sessions the event path couldn't resolve — a first screen
/// render that came back empty (the PTY ring hadn't captured the alt-screen TUI
/// yet) or a screen that changed without emitting a fresh `Notification` hook.
const REASSESS_AFTER_MS: i64 = 2 * 60 * 1000;

/// Proactive-tick re-assessment of parked `AwaitingInput` sessions (autonomous
/// mode only). Replaces the old blind `fleet_awaiting` "want me to peek?" nudge:
/// rather than asking the user for permission to look at a session Athena can
/// already read, re-run the real screen-reading orchestration.
///
/// Safe to call every tick — it delegates to `orchestrate_on_awaiting`, whose
/// 60s throttle + screen-hash dedupe skip any session whose *current* screen was
/// already assessed. So a genuinely-deferred session is NOT re-nagged; only a
/// session whose screen changed — or whose first render was empty and has since
/// rendered — is re-reasoned.
pub fn reassess_stale_awaiting(app: &tauri::AppHandle) {
    use tauri::Manager;
    // The app manages `Arc<AppState>`, not `AppState` — `app.state::<AppState>()`
    // would panic ("state not managed"). Mirror the hook-path lookup
    // (`hooks.rs` `orchestrate_on_awaiting` caller). `&state` deref-coerces
    // State<Arc<AppState>> → &AppState for `orchestrate_on_awaiting`.
    let Some(state) = app.try_state::<std::sync::Arc<AppState>>() else {
        return;
    };
    if !crate::commands::companion::chat::autonomous_mode_enabled(&state.db) {
        return;
    }
    let now = crate::commands::fleet::registry::now_ms();
    for s in crate::commands::fleet::registry::registry().list_dto() {
        if !matches!(
            s.state,
            crate::commands::fleet::types::FleetSessionState::AwaitingInput
        ) {
            continue;
        }
        // Fresh transitions were just handled by the hook-driven path.
        if now - s.last_activity_ms < REASSESS_AFTER_MS {
            continue;
        }
        orchestrate_on_awaiting(app, &state, &s.id, &s.project_label);
    }
}

/// How long a dispatched session must sit failed + event-silent before the
/// proactive tick routes it through stuck-orchestration. Matches the 4-minute
/// threshold of the retired `fleet_session_stuck` nudge it replaces.
const STUCK_REASSESS_AFTER_MS: i64 = 4 * 60 * 1000;

/// Phase 3b — proactive-tick stuck-session recovery (autonomous mode only).
/// Replaces the old informational `fleet_session_stuck` "want me to propose a
/// fleet_intervene?" nudge: instead of asking the user to green-light a look,
/// wake Athena on the stuck session's real screen + failure so she proposes a
/// confidence-gated `fleet_intervene` (auto-applied per the boldness dial) or
/// defers to the user with a one-line read.
///
/// Detection mirrors the retired nudge exactly — a session in a
/// `dispatched_by_athena` op that (a) is still live (not Exited/Idle), (b) has a
/// stamped `recent_failure`, (c) hasn't been intervened on yet (operative memory
/// caps interventions at one per session), and (d) has been event-silent for
/// `STUCK_REASSESS_AFTER_MS`. Safe to call every tick: the shared 60 s throttle +
/// screen-hash dedupe inside `orchestrate_session` skip a session whose screen was
/// already assessed, and the one-intervention cap stops any loop.
pub fn reassess_stuck_sessions(app: &tauri::AppHandle) {
    use tauri::Manager;
    // App manages `Arc<AppState>` (see `reassess_stale_awaiting`).
    let Some(state) = app.try_state::<std::sync::Arc<AppState>>() else {
        return;
    };
    if !crate::commands::companion::chat::autonomous_mode_enabled(&state.db) {
        return;
    }
    // Operative-memory timestamps (`last_event_at_ms`) are chrono epoch millis,
    // so compare against the same clock rather than `registry::now_ms()`.
    let now = chrono::Utc::now().timestamp_millis();
    let mem = crate::companion::orchestration::operative_memory::memory();
    for op in mem.snapshot_all_operations() {
        if !op.dispatched_by_athena {
            continue;
        }
        for s in &op.sessions {
            if matches!(
                s.last_state,
                crate::commands::fleet::types::FleetSessionState::Exited
                    | crate::commands::fleet::types::FleetSessionState::Idle
            ) {
                continue; // not a live, working session
            }
            let Some(failure) = s.recent_failure.as_ref() else {
                continue;
            };
            if s.interventions > 0 {
                continue; // already spent this session's one intervention
            }
            if now - s.last_event_at_ms < STUCK_REASSESS_AFTER_MS {
                continue;
            }
            // Human-facing label: prefer the live registry's project label, fall
            // back to the session's operative-memory role.
            let project_label = crate::commands::fleet::registry::registry()
                .lookup_meta(&s.fleet_session_id)
                .map(|(label, _cwd)| label)
                .or_else(|| s.role.clone())
                .unwrap_or_else(|| "session".to_string());
            orchestrate_session(
                app,
                &state,
                &s.fleet_session_id,
                &project_label,
                FleetSituation::Stuck {
                    failure: truncate_failure_tail(failure, 400),
                },
            );
        }
    }
}

/// How long a dispatched session must sit `Idle` before the proactive tick asks
/// Athena whether it needs its next step — long enough that a session genuinely
/// between turns isn't poked mid-thought (the hook path owns fresh transitions).
const IDLE_REASSESS_AFTER_MS: i64 = 90 * 1000;

/// Phase 3a — proactive-tick idle-needs-next (autonomous mode only). A session
/// that finished its turn and idles at the prompt (`Stop → Idle`) had no
/// event-driven trigger — orchestration only fired on `AwaitingInput`. This wakes
/// Athena on an Idle session that (a) is part of one of HER dispatched operations
/// (never a user's own ad-hoc CLI — she must not drive those), and (b) has idled
/// past `IDLE_REASSESS_AFTER_MS`, so she judges done-vs-needs-next against the
/// session's objective and either sends the next step via a confidence-gated
/// `fleet_send_input` or leaves a finished session alone.
///
/// Safe every tick: the shared 60 s throttle + screen-hash dedupe skip a session
/// whose idle screen is unchanged (a genuinely-done session is woken at most
/// once), and a session only re-triggers once real work has moved its screen — so
/// the loop is bounded by actual progress, not the timer.
pub fn reassess_idle_needs_next(app: &tauri::AppHandle) {
    use tauri::Manager;
    // App manages `Arc<AppState>` (see `reassess_stale_awaiting`).
    let Some(state) = app.try_state::<std::sync::Arc<AppState>>() else {
        return;
    };
    if !crate::commands::companion::chat::autonomous_mode_enabled(&state.db) {
        return;
    }
    let now = crate::commands::fleet::registry::now_ms();
    let mem = crate::companion::orchestration::operative_memory::memory();
    for s in crate::commands::fleet::registry::registry().list_dto() {
        if !matches!(
            s.state,
            crate::commands::fleet::types::FleetSessionState::Idle
        ) {
            continue;
        }
        if now - s.last_activity_ms < IDLE_REASSESS_AFTER_MS {
            continue; // fresh idle — leave it a moment before poking
        }
        // Only auto-continue sessions Athena herself dispatched — never the user's
        // own ad-hoc CLIs (they're driving those). Membership in a
        // `dispatched_by_athena` op is the gate.
        let Some(op_id) = mem.find_operation_for_session(&s.id) else {
            continue;
        };
        let dispatched = mem
            .snapshot_operation(&op_id)
            .map(|op| op.dispatched_by_athena)
            .unwrap_or(false);
        if !dispatched {
            continue;
        }
        orchestrate_session(
            app,
            &state,
            &s.id,
            &s.project_label,
            FleetSituation::IdleNeedsNext,
        );
    }
}

/// Phase 5b — the objective for a fleet session, pulled from operative memory for
/// the orchestration directive. Prefers the session's self-reported `intent` (set
/// via the MCP `athena.report_intent` path), falls back to its `role`, always
/// paired with the owning operation's `user_intent` for context. `None` when the
/// session isn't part of a tracked operation (an ad-hoc user spawn with no
/// recorded goal) — the directive then omits the objective line.
fn session_objective(session_id: &str) -> Option<String> {
    let mem = crate::companion::orchestration::operative_memory::memory();
    let op_id = mem.find_operation_for_session(session_id)?;
    let op = mem.snapshot_operation(&op_id)?;
    let session_goal = op
        .sessions
        .iter()
        .find(|s| s.fleet_session_id == session_id)
        .and_then(|s| s.intent.clone().or_else(|| s.role.clone()));
    match session_goal {
        Some(goal) => Some(format!("{goal} — part of the operation: {}", op.user_intent)),
        None => Some(op.user_intent.clone()),
    }
}

/// One-line, length-bounded rendering of a failure tail for the stuck-session
/// directive (a multi-line stack trace would bloat the orchestration prompt).
fn truncate_failure_tail(s: &str, max: usize) -> String {
    let one_line = s.replace('\n', " / ").replace('\r', "");
    if one_line.chars().count() <= max {
        one_line
    } else {
        let mut out: String = one_line.chars().take(max).collect();
        out.push('…');
        out
    }
}

/// DEV MODE — reflection turn after a `dev_improve` run (the per-op
/// reflection the dev-mode policy requires). Feeds Athena the op wrap-up
/// plus fresh git evidence from the run's workspace and asks for an
/// honest review; for backend runs she recommends (or argues against)
/// the `dev_merge` handshake — which itself remains a click-approval.
/// Chat-visible on purpose (unlike `fleet_orchestration`'s suppress_chat
/// turns): the reflection IS the user-facing outcome report.
fn spawn_dev_reflection(
    app: &tauri::AppHandle,
    op: &crate::companion::orchestration::operative_memory::Operation,
    dev: &crate::companion::dev_mode::DevOpMeta,
    status_token: &str,
    summary: &str,
) {
    use tauri::Manager;
    let state = app.state::<Arc<crate::AppState>>();
    let evidence = crate::companion::dev_mode::workspace_evidence(&dev.workspace);
    let apply_block = if dev.backend {
        format!(
            "This was a BACKEND run in an isolated worktree (branch stays unapplied until the \
             merge handshake). If the work looks right and committed, propose the merge:\n\
             OP: {{\"op\": \"propose_action\", \"action\": \"dev_merge\", \"params\": \
             {{\"op_id\": \"{op_id}\", \"rationale\": \"<one line>\"}}}}\n\
             If it looks wrong, incomplete, or the tree was left dirty — do NOT propose the \
             merge; say what's off and the next step instead. Merging triggers a dev-server \
             rebuild, so mention the app will restart.",
            op_id = op.id
        )
    } else {
        "This was a FRONTEND run in the live checkout — the edits are already hot-reloaded. \
         Tell Michal concretely what to try in the UI to see the change."
            .to_string()
    };
    let directive = format!(
        "Dev-mode reflection. Your dev_improve session just finished ({status_token}).\n\n\
         The request was:\n{request}\n\n\
         Operation wrap-up:\n{summary}\n\n\
         Git evidence from the workspace:\n{evidence}\n\n\
         Review this honestly for Michal: did the change match the request, what actually \
         changed, and any risk you see. If the run failed or drifted, say so plainly — never \
         gloss a bad run. {apply_block}\n\
         Keep it tight: a few sentences plus the OP line if you propose one.",
        request = dev.request,
    );
    crate::companion::session::spawn_proactive_turn(
        app.clone(),
        Arc::new(state.user_db.clone()),
        Arc::new(state.db.clone()),
        #[cfg(feature = "ml")]
        state.embedding_manager.clone(),
        "dev_improve_review".to_string(),
        Some(op.id.clone()),
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

    // DEV MODE — a dev_improve op gets a REFLECTION TURN instead of the
    // generic wrap-up card: Athena reviews the run's git evidence and
    // reports what changed vs what was asked, plus (backend runs) the
    // merge-handshake recommendation. Strictly richer than the
    // deterministic D6 nudge below, so return once it's spawned. Per
    // user policy every dev operation ends in this reflection, and any
    // apply-step (dev_merge) is still a separate click-approval.
    if let Some(dev) = crate::companion::dev_mode::get_dev_op(pool, &op_id) {
        spawn_dev_reflection(app, &op, &dev, status_token, &summary);
        // Ledger transition (Phase 4): record the run's resulting commit
        // and move the row out of the boot-recovery sweep. Frontend runs
        // are terminal here (`closed` — nothing to merge); backend rows
        // stay `completed` until the dev_merge handshake consumes them.
        let commit = crate::companion::dev_mode::latest_commit_short(&dev.workspace);
        let next = if dev.backend { "completed" } else { "closed" };
        crate::companion::dev_mode::mark_dev_op(pool, &op_id, next, commit.as_deref());
        return;
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
