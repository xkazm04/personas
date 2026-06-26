//! Claude Code hook receiver — axum routes mounted under `/fleet/hooks/*`.
//!
//! Claude Code's hooks system can POST arbitrary JSON to an HTTP endpoint
//! on every lifecycle event we care about: `SessionStart`, `Notification`
//! (CC waiting for user input), `Stop` (turn ended), `PreToolUse` (active
//! processing), `SessionEnd`. We install one route per event type.
//!
//! The installer (phase 5) writes URLs like
//! `http://127.0.0.1:<port>/fleet/hooks/notification` into
//! `~/.claude/settings.json` with a `_fleet: true` marker so we can
//! uninstall without disturbing user-authored hooks.
//!
//! Hook bodies vary by CC version, so every field on
//! [`super::types::FleetHookEvent`] is `Option` + `serde(default)`. The
//! URL path is the source of truth for **which** event fired.

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::engine::event_registry::event_name;

use super::registry::{now_ms, registry};
use super::types::FleetSessionState;

/// Returns the axum Router to be registered under `/fleet`. Hits:
///   POST /fleet/hooks/sessionstart
///   POST /fleet/hooks/notification
///   POST /fleet/hooks/stop
///   POST /fleet/hooks/pretooluse
///   POST /fleet/hooks/sessionend
pub fn router(app: AppHandle) -> Router {
    Router::new()
        .route("/hooks/{event}", post(receive_hook))
        .with_state(app)
}

/// Single receiver for all five hook events. Dispatches on the URL `:event`
/// path segment so the installer can wire one Claude Code hook command per
/// event type without us having to add a dedicated handler each time.
async fn receive_hook(
    axum::extract::State(app): axum::extract::State<AppHandle>,
    Path(event): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<HookAck>, (StatusCode, String)> {
    // Extract opportunistically — never fail on missing fields. CC ships
    // different shapes across versions; we'd rather log "unknown" than
    // 500 the hook (which would surface as a noisy error in the user's
    // terminal where CC is running).
    let claude_session_id = body
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let cwd = body
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    // Notification hooks carry a human message describing what Claude wants
    // (e.g. "Claude needs your permission to use Bash"). Surface it so the
    // "Needs you" banner + desktop alert can say what each session needs.
    let message = body
        .get("message")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    tracing::debug!(
        event = %event,
        claude_session_id = ?claude_session_id,
        cwd = ?cwd,
        "fleet hook received",
    );

    // Resolve which Fleet session this hook belongs to.
    let session_id = resolve_session_id(&claude_session_id, &cwd);

    // Update state + emit.
    let event_kind = event.to_ascii_lowercase();
    if let Some(sid) = session_id.as_deref() {
        // Tool events feed operative memory directly (Rust path —
        // they're volume-heavy and don't need the JS roundtrip the
        // lifecycle events take). Lifecycle events still go through
        // apply_hook so the FleetSessionState machine + FE event
        // emission stay in one place.
        if event_kind == "pretooluse" || event_kind == "posttooluse" {
            let tool_name = body
                .get("tool_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let empty = serde_json::Value::Null;
            let tool_input = body.get("tool_input").unwrap_or(&empty);
            let tool_result = body.get("tool_result");
            if !tool_name.is_empty() {
                crate::companion::orchestration::operative_memory::memory()
                    .record_tool_event(
                        sid,
                        tool_name,
                        tool_input,
                        event_kind == "posttooluse",
                        tool_result,
                    );
            }
            // A running tool is proof the session is working, not waiting on the
            // user. Correct a stale `AwaitingInput`/`Idle`/`Stale` immediately
            // (Claude Code's idle Notification can wrongly park an in-progress
            // session). Only emits on a real transition, so per-tool volume stays
            // low — see `revive_to_running_on_activity`.
            if registry().revive_to_running_on_activity(sid) {
                let _ = app.emit(
                    event_name::FLEET_SESSION_STATE,
                    FleetStatePayload {
                        session_id: sid.to_string(),
                        state: state_to_token(FleetSessionState::Running),
                        reason: Some("Tool activity — session is working".to_string()),
                    },
                );
            }
        } else {
            apply_hook(sid, &event_kind, claude_session_id.clone(), message.as_deref(), &app);
        }
    } else {
        tracing::debug!(
            event = %event_kind,
            claude_session_id = ?claude_session_id,
            cwd = ?cwd,
            "fleet hook: no matching session — ignoring",
        );
    }

    // Force a manager use to ensure AppHandle stays linked; lints would
    // strip the import otherwise.
    let _ = app.path();

    Ok(Json(HookAck {
        ok: true,
        matched_session_id: session_id,
    }))
}

/// Resolve which Fleet session this hook belongs to.
///
/// Strategy:
/// 1. If we've already bound `claude_session_id` to a Fleet session
///    (i.e. SessionStart fired before this hook), match on that. This
///    is the steady-state path — unambiguous regardless of how many
///    sessions share the same cwd.
/// 2. Otherwise fall back to `cwd`. Multiple non-Exited sessions can
///    coexist for the same cwd (parallel claude runs on one project),
///    so we need a tiebreaker: prefer the most-recently-spawned
///    session that doesn't yet have a `claude_session_id` bound. That
///    is by construction the session currently in its bootstrap window
///    — the one this unbound SessionStart most likely belongs to.
/// 3. If every cwd-matching session is already bound (or none exist),
///    return `None` and the hook is logged + dropped.
fn resolve_session_id(
    claude_session_id: &Option<String>,
    cwd: &Option<String>,
) -> Option<String> {
    let map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());

    if let Some(csid) = claude_session_id {
        for sess in map.values() {
            if sess.claude_session_id.as_deref() == Some(csid.as_str()) {
                return Some(sess.id.clone());
            }
        }
    }
    if let Some(cwd_str) = cwd {
        let cwd_path = std::path::Path::new(cwd_str);

        // Pass 1: most-recently-created unbound session for this cwd
        // (the bootstrap-window candidate).
        let mut best_unbound: Option<&super::registry::FleetSessionInner> = None;
        for sess in map.values() {
            if matches!(sess.state, FleetSessionState::Exited) { continue; }
            if sess.cwd != cwd_path { continue; }
            if sess.claude_session_id.is_some() { continue; }
            if best_unbound.is_none()
                || sess.created_at_ms > best_unbound.unwrap().created_at_ms
            {
                best_unbound = Some(sess);
            }
        }
        if let Some(s) = best_unbound {
            return Some(s.id.clone());
        }

        // Pass 2: every cwd-matching session is already bound. Fall back
        // to the most-recently-active one so we still apply *some* state
        // update (better than dropping the hook entirely).
        let mut best_bound: Option<&super::registry::FleetSessionInner> = None;
        for sess in map.values() {
            if matches!(sess.state, FleetSessionState::Exited) { continue; }
            if sess.cwd != cwd_path { continue; }
            if best_bound.is_none()
                || sess.last_activity_ms > best_bound.unwrap().last_activity_ms
            {
                best_bound = Some(sess);
            }
        }
        if let Some(s) = best_bound {
            return Some(s.id.clone());
        }
    }
    None
}

/// Apply a hook to the registry — flip state + bind claude_session_id
/// if it's the first time we've seen one for this session.
fn apply_hook(
    session_id: &str,
    event_kind: &str,
    claude_session_id: Option<String>,
    message: Option<&str>,
    app: &AppHandle,
) {
    let mut map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
    let Some(session) = map.get_mut(session_id) else {
        return;
    };

    // Bind claude session id if we haven't yet.
    if session.claude_session_id.is_none() {
        if let Some(csid) = claude_session_id {
            session.claude_session_id = Some(csid);
        }
    }

    let (new_state, reason) = match event_kind {
        // SessionStart means Claude LAUNCHED, not that it's working — a fresh
        // session with no task sits idle at the prompt. Reserve Running for real
        // progress: UserPromptSubmit, a tool firing (revive_to_running_on_activity),
        // or transcript growth (the stale ticker). This is what stops a
        // just-spawned session from reading "Working".
        "sessionstart" => (
            FleetSessionState::Idle,
            "SessionStart — Claude launched, ready".to_string(),
        ),
        "notification" => (
            FleetSessionState::AwaitingInput,
            // The notification message says *what* Claude wants — surface it
            // verbatim so the banner/alert is actionable; fall back generically.
            message
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty())
                .unwrap_or_else(|| "Claude is waiting for input".to_string()),
        ),
        "stop" => (
            FleetSessionState::Idle,
            "Stop hook — turn finished".to_string(),
        ),
        "pretooluse" => (
            FleetSessionState::Running,
            "PreToolUse hook".to_string(),
        ),
        "userpromptsubmit" => (
            FleetSessionState::Running,
            "UserPromptSubmit hook".to_string(),
        ),
        "sessionend" => (
            FleetSessionState::Exited,
            "SessionEnd hook".to_string(),
        ),
        other => {
            tracing::debug!(event = %other, "fleet hook: unrecognized event kind");
            return;
        }
    };

    // Don't downgrade an Exited session — process death is authoritative.
    if matches!(session.state, FleetSessionState::Exited)
        && !matches!(new_state, FleetSessionState::Exited)
    {
        return;
    }

    session.state = new_state;
    session.last_activity_ms = now_ms();
    session.state_reason = Some(reason.clone());
    let project_label = session.project_label.clone();

    // Release the registry lock before emitting (events go through Tauri's
    // own bus and we don't want to risk reentry).
    drop(map);

    let _ = app.emit(
        event_name::FLEET_SESSION_STATE,
        FleetStatePayload {
            session_id: session_id.to_string(),
            state: state_to_token(new_state),
            reason: Some(reason),
        },
    );

    // Active fleet orchestration, fired Rust-direct (no frontend dependency):
    // when this hook puts a session into AwaitingInput, wake Athena to manage
    // the fleet. Gated on autonomous mode + throttled per session inside.
    if matches!(new_state, FleetSessionState::AwaitingInput) {
        if let Some(state) = app.try_state::<std::sync::Arc<crate::AppState>>() {
            crate::commands::companion::fleet_bridge::orchestrate_on_awaiting(
                app,
                &state,
                session_id,
                &project_label,
            );
        }
    }
}

fn state_to_token(s: FleetSessionState) -> &'static str {
    match s {
        FleetSessionState::Spawning => "spawning",
        FleetSessionState::Running => "running",
        FleetSessionState::AwaitingInput => "awaiting_input",
        FleetSessionState::Idle => "idle",
        FleetSessionState::Stale => "stale",
        FleetSessionState::Hibernated => "hibernated",
        FleetSessionState::Exited => "exited",
    }
}

#[derive(Serialize)]
struct HookAck {
    ok: bool,
    matched_session_id: Option<String>,
}

#[derive(Serialize, Clone)]
struct FleetStatePayload {
    session_id: String,
    state: &'static str,
    reason: Option<String>,
}
