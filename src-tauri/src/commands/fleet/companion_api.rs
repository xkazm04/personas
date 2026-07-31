//! LAN companion API + PWA host — Fleet Command Anywhere v1.
//!
//! A dedicated axum server, separate from `local_http` (which is loopback-only
//! by design), bound to `0.0.0.0` on a port near [`PREFERRED_PORT`] so a phone
//! on the same network can reach it. It exists ONLY after the operator has
//! explicitly paired a device (`fleet_pair_device` starts it; app restarts
//! re-start it via [`start_if_paired`] when live pairings exist).
//!
//! Security is the product here — the rules, in order:
//!
//! 1. **LAN-only.** Every request's peer address must be loopback, RFC-1918
//!    private, or link-local ([`is_lan_peer`]). No relay, no tunnel, nothing
//!    outbound. (A user-supplied Tailscale-style network appears as RFC-1918
//!    and works; the open internet does not.)
//! 2. **Device-scoped tokens.** `/api/*` requires `Authorization: Bearer
//!    <token>`; tokens resolve to one paired device via constant-time SHA-256
//!    comparison (`pairing::verify_token`). Failed auth answers 401 after a
//!    fixed delay. Revocation is effective on the next request.
//! 3. **Per-action allowlist.** `/api/act` accepts exactly five verbs:
//!    approve / reject an Athena *fleet* proposal, a short reply to an
//!    `awaiting_input` session, wake, kill. Nothing else parses.
//! 4. **Audited.** Every act — success or failure — is appended to the
//!    `fleet_decisions` ledger with the device id in the rationale.
//! 5. **Projection only.** `/api/state` is a compact projection (labels,
//!    states, attention, Athena approvals with their rationale). It carries
//!    NO PTY bytes, no transcripts, no cwd paths, no credentials — the same
//!    hard rule the pairing panel promises.
//!
//! The static `/m/*` routes serve the installable PWA (plain HTML/CSS/JS,
//! compiled into the binary via `include_str!` from `resources/mobile/`).
//! Static assets contain no data and are served unauthenticated; the token
//! travels in the URL *fragment* (never in request lines or logs) and the
//! page stores it locally on the phone.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, OnceLock};

use axum::extract::{ConnectInfo, State as AxumState};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::pairing;
use super::registry::registry;
use super::types::{state_to_token, FleetSessionState};
use crate::AppState;

/// First candidate port; scans upward. Distinct from local_http (17400+) and
/// the test-automation server (17320).
const PREFERRED_PORT: u16 = 17500;
const PORT_SCAN_LIMIT: u16 = 16;

/// Fixed penalty applied to failed auth before the 401 leaves — makes online
/// brute force glacial without a lockout table.
const AUTH_FAIL_DELAY_MS: u64 = 350;

/// Reply length cap — the companion sends short verdicts, not documents.
const MAX_REPLY_CHARS: usize = 500;

static PORT: OnceLock<u16> = OnceLock::new();

/// Bound port when the companion server is running.
pub fn port() -> Option<u16> {
    PORT.get().copied()
}

/// Start the server if at least one live pairing exists. Called once from app
/// setup; waits briefly for `AppState` to be managed (setup ordering) before
/// reading the device store.
pub fn start_if_paired(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        for _ in 0..30 {
            if let Some(state) = app.try_state::<Arc<AppState>>() {
                if pairing::any_active_device(&state.db) {
                    if let Err(e) = ensure_started(&app) {
                        tracing::warn!(error = %e, "fleet companion: restart-time server start failed");
                    }
                }
                return;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}

/// Idempotently bind + serve. Returns the bound port.
pub fn ensure_started(app: &AppHandle) -> Result<u16, String> {
    if let Some(p) = PORT.get() {
        return Ok(*p);
    }
    let port = pick_free_port()?;
    PORT.set(port).map_err(|_| "companion port already set".to_string())?;

    let router = build_router(app.clone());
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port)).await {
            Ok(listener) => {
                tracing::info!(port, "fleet companion server listening (LAN)");
                if let Err(e) = axum::serve(
                    listener,
                    router.into_make_service_with_connect_info::<SocketAddr>(),
                )
                .await
                {
                    tracing::error!(error = %e, "fleet companion serve loop exited");
                }
            }
            Err(e) => {
                tracing::error!(error = %e, port, "fleet companion server failed to bind");
            }
        }
    });
    Ok(port)
}

fn pick_free_port() -> Result<u16, String> {
    for offset in 0..PORT_SCAN_LIMIT {
        let candidate = PREFERRED_PORT.saturating_add(offset);
        if std::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, candidate)).is_ok()
        {
            return Ok(candidate);
        }
    }
    Err(format!(
        "Could not find a free companion port near {PREFERRED_PORT}"
    ))
}

fn build_router(app: AppHandle) -> Router {
    Router::new()
        .route("/", get(|| async { Redirect::temporary("/m/") }))
        .route("/m/", get(serve_index))
        .route("/m/index.html", get(serve_index))
        .route("/m/styles.css", get(serve_css))
        .route("/m/app.js", get(serve_js))
        .route("/m/manifest.webmanifest", get(serve_manifest))
        .route("/m/sw.js", get(serve_sw))
        .route("/m/icon.svg", get(serve_icon))
        .route("/api/state", get(api_state))
        .route("/api/act", post(api_act))
        .with_state(app)
}

// ── static assets ───────────────────────────────────────────────────────

fn asset(body: &'static str, content_type: &'static str) -> Response {
    ([(header::CONTENT_TYPE, content_type)], body).into_response()
}

async fn serve_index() -> Html<&'static str> {
    Html(include_str!("../../../resources/mobile/index.html"))
}
async fn serve_css() -> Response {
    asset(
        include_str!("../../../resources/mobile/styles.css"),
        "text/css; charset=utf-8",
    )
}
async fn serve_js() -> Response {
    asset(
        include_str!("../../../resources/mobile/app.js"),
        "text/javascript; charset=utf-8",
    )
}
async fn serve_manifest() -> Response {
    asset(
        include_str!("../../../resources/mobile/manifest.webmanifest"),
        "application/manifest+json",
    )
}
async fn serve_sw() -> Response {
    asset(
        include_str!("../../../resources/mobile/sw.js"),
        "text/javascript; charset=utf-8",
    )
}
async fn serve_icon() -> Response {
    asset(
        include_str!("../../../resources/mobile/icon.svg"),
        "image/svg+xml",
    )
}

// ── auth ────────────────────────────────────────────────────────────────

/// Loopback / RFC-1918 / link-local peers only. Guard #1 — evaluated before
/// any token work so an internet-exposed misconfiguration answers 403 with
/// zero secret-bearing computation.
pub fn is_lan_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6
                    .to_ipv4_mapped()
                    .map(|m| m.is_loopback() || m.is_private() || m.is_link_local())
                    .unwrap_or(false)
        }
    }
}

/// Extract the bearer token from `Authorization: Bearer <t>`.
fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

type ApiErr = (StatusCode, Json<serde_json::Value>);

fn err(status: StatusCode, code: &str) -> ApiErr {
    (status, Json(serde_json::json!({ "ok": false, "code": code })))
}

/// Full request gate: LAN peer → bearer token → constant-time device match.
/// Returns the authenticated device id.
async fn authorize(
    app: &AppHandle,
    peer: SocketAddr,
    headers: &HeaderMap,
) -> Result<String, ApiErr> {
    if !is_lan_peer(peer.ip()) {
        return Err(err(StatusCode::FORBIDDEN, "lan_only"));
    }
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "starting"));
    };
    let Some(token) = bearer_token(headers) else {
        return Err(err(StatusCode::UNAUTHORIZED, "missing_token"));
    };
    let devices = pairing::load_devices(&state.db);
    match pairing::verify_token(&devices, &token) {
        Some(device_id) => {
            pairing::touch_device(&state.db, &device_id);
            Ok(device_id)
        }
        None => {
            tokio::time::sleep(std::time::Duration::from_millis(AUTH_FAIL_DELAY_MS)).await;
            Err(err(StatusCode::UNAUTHORIZED, "bad_token"))
        }
    }
}

// ── /api/state — the remote projection ──────────────────────────────────

/// Athena proposal actions the phone may see and answer. Mirrors the tile
/// actions in `fleetAttention.ts` (`approvalsForSession`).
const REMOTE_APPROVAL_ACTIONS: [&str; 2] = ["fleet_send_input", "fleet_intervene"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteSession {
    id: String,
    /// Display label — title > user name > project label (same preference as
    /// the desktop tiles). Never a filesystem path.
    label: String,
    project: String,
    state: &'static str,
    state_reason: Option<String>,
    /// Mirror of `sessionAttention` in `fleetAttention.ts`.
    attention: &'static str,
    last_activity_ms: i64,
    dozing: bool,
    athena_active: bool,
    exit_code: Option<i32>,
    limit_reset_at_ms: Option<i64>,
    can_reply: bool,
    can_wake: bool,
    can_kill: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteApproval {
    id: String,
    action: String,
    session_id: Option<String>,
    rationale: String,
    /// The exact text Athena proposes to type. A proposal, not terminal output.
    text: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteState {
    app: &'static str,
    v: u32,
    generated_at_ms: i64,
    sessions: Vec<RemoteSession>,
    approvals: Vec<RemoteApproval>,
}

/// Rust mirror of `sessionAttention` (fleetAttention.ts) — keep in sync.
fn attention_of(state: FleetSessionState, exit_code: Option<i32>, athena_active: bool) -> &'static str {
    if athena_active {
        return "athena";
    }
    match state {
        FleetSessionState::AwaitingInput => "waiting",
        FleetSessionState::Stale => "stale",
        FleetSessionState::Exited => match exit_code {
            Some(c) if c != 0 => "failed",
            _ => "none",
        },
        _ => "none",
    }
}

fn project_state(app: &AppHandle) -> RemoteState {
    let sessions: Vec<RemoteSession> = registry()
        .list_dto()
        .into_iter()
        .map(|s| {
            let can_reply = matches!(s.state, FleetSessionState::AwaitingInput) && !s.dozing;
            let can_wake = s.dozing || matches!(s.state, FleetSessionState::Hibernated);
            let can_kill = !matches!(
                s.state,
                FleetSessionState::Exited | FleetSessionState::Hibernated
            );
            RemoteSession {
                label: s
                    .title
                    .clone()
                    .or_else(|| s.name.clone())
                    .unwrap_or_else(|| s.project_label.clone()),
                project: s.project_label,
                state: state_to_token(s.state),
                state_reason: s.state_reason,
                attention: attention_of(s.state, s.exit_code, s.athena_active),
                last_activity_ms: s.last_activity_ms,
                dozing: s.dozing,
                athena_active: s.athena_active,
                exit_code: s.exit_code,
                limit_reset_at_ms: s.limit_reset_at_ms,
                can_reply,
                can_wake,
                can_kill,
                id: s.id,
            }
        })
        .collect();

    let approvals = fleet_pending_approvals(app)
        .into_iter()
        .map(|(a, session_id, text)| RemoteApproval {
            id: a.id,
            action: a.action,
            session_id,
            rationale: a.rationale,
            text,
            created_at: a.created_at,
        })
        .collect();

    RemoteState {
        app: "personas-fleet-companion",
        v: 1,
        generated_at_ms: super::registry::now_ms(),
        sessions,
        approvals,
    }
}

/// Pending Athena approvals filtered to the remote-answerable fleet actions,
/// with `(approval, session_id, proposed_text)` extracted from params — the
/// Rust mirror of `approvalsForSession`.
fn fleet_pending_approvals(
    app: &AppHandle,
) -> Vec<(
    crate::commands::companion::approvals::PendingApproval,
    Option<String>,
    String,
)> {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return Vec::new();
    };
    let all = match crate::commands::companion::approvals::companion_list_pending_approvals(state) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "fleet companion: pending-approvals read failed");
            return Vec::new();
        }
    };
    all.into_iter()
        .filter(|a| REMOTE_APPROVAL_ACTIONS.contains(&a.action.as_str()))
        .map(|a| {
            let params: serde_json::Value =
                serde_json::from_str(&a.params_json).unwrap_or(serde_json::Value::Null);
            let session_id = params
                .get("session_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let text = params
                .get("text")
                .or_else(|| params.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            (a, session_id, text)
        })
        .collect()
}

async fn api_state(
    AxumState(app): AxumState<AppHandle>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<RemoteState>, ApiErr> {
    authorize(&app, peer, &headers).await?;
    Ok(Json(project_state(&app)))
}

// ── /api/act — the allowlisted write surface ────────────────────────────

/// The complete verb set. Anything else fails to deserialize → 422.
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum CompanionAct {
    Approve {
        approval_id: String,
    },
    Reject {
        approval_id: String,
        reason: Option<String>,
    },
    Reply {
        session_id: String,
        text: String,
    },
    Wake {
        session_id: String,
    },
    Kill {
        session_id: String,
    },
}

impl CompanionAct {
    fn name(&self) -> &'static str {
        match self {
            CompanionAct::Approve { .. } => "companion_approve",
            CompanionAct::Reject { .. } => "companion_reject",
            CompanionAct::Reply { .. } => "companion_reply",
            CompanionAct::Wake { .. } => "companion_wake",
            CompanionAct::Kill { .. } => "companion_kill",
        }
    }
    fn target(&self) -> &str {
        match self {
            CompanionAct::Approve { approval_id } | CompanionAct::Reject { approval_id, .. } => {
                approval_id
            }
            CompanionAct::Reply { session_id, .. }
            | CompanionAct::Wake { session_id }
            | CompanionAct::Kill { session_id } => session_id,
        }
    }
}

/// Keep printable text + newlines; drop every other control char (no ESC — a
/// remote reply must never be able to smuggle terminal control sequences).
fn sanitize_reply(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(MAX_REPLY_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Append one row to the `fleet_decisions` ledger for a remote act. Rule #4:
/// every act is audited, success or failure, with the device id.
fn audit(app: &AppHandle, device_id: &str, act_name: &str, target: &str, result: &Result<String, String>) {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let (outcome, detail) = match result {
        Ok(msg) => ("remote_fired", msg.clone()),
        Err(e) => ("remote_failed", e.clone()),
    };
    crate::db::repos::fleet_decisions::record(
        &state.db,
        &crate::db::repos::fleet_decisions::FleetDecisionInsert {
            session_id: target.to_string(),
            claude_session_id: None,
            screen_hash: "companion_remote".to_string(),
            action: act_name.to_string(),
            outcome: outcome.to_string(),
            confidence: None,
            decision_class: Some("companion_remote".to_string()),
            defer_reason: None,
            rationale: Some(format!("device {device_id}: {detail}")),
        },
    );
}

async fn api_act(
    AxumState(app): AxumState<AppHandle>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(act): Json<CompanionAct>,
) -> Result<Json<serde_json::Value>, ApiErr> {
    let device_id = authorize(&app, peer, &headers).await?;
    let act_name = act.name();
    let target = act.target().to_string();

    let result: Result<String, String> = execute_act(&app, &act).await;
    audit(&app, &device_id, act_name, &target, &result);

    match result {
        Ok(message) => Ok(Json(serde_json::json!({ "ok": true, "message": message }))),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "code": "act_failed", "message": e })),
        )),
    }
}

async fn execute_act(app: &AppHandle, act: &CompanionAct) -> Result<String, String> {
    match act {
        CompanionAct::Approve { approval_id } => {
            require_remote_approval(app, approval_id)?;
            let state = app
                .try_state::<Arc<AppState>>()
                .ok_or_else(|| "app state unavailable".to_string())?;
            crate::commands::companion::approvals::companion_approve_action(
                state,
                app.clone(),
                approval_id.clone(),
            )
            .await
            .map(|o| o.message)
            .map_err(|e| e.to_string())
        }
        CompanionAct::Reject { approval_id, reason } => {
            require_remote_approval(app, approval_id)?;
            let state = app
                .try_state::<Arc<AppState>>()
                .ok_or_else(|| "app state unavailable".to_string())?;
            crate::commands::companion::approvals::companion_reject_action(
                state,
                approval_id.clone(),
                reason.clone(),
            )
            .await
            .map(|o| o.message)
            .map_err(|e| e.to_string())
        }
        CompanionAct::Reply { session_id, text } => {
            let clean = sanitize_reply(text);
            if clean.is_empty() {
                return Err("empty reply".to_string());
            }
            // Only a session that is actually waiting accepts a remote reply —
            // typing into a working terminal from a phone is never right.
            let waiting = registry()
                .list_dto()
                .into_iter()
                .any(|s| s.id == *session_id && matches!(s.state, FleetSessionState::AwaitingInput));
            if !waiting {
                return Err("session is not awaiting input".to_string());
            }
            super::commands::fleet_write_input(session_id.clone(), format!("{clean}\n"))
                .await
                .map(|_| "reply sent".to_string())
        }
        CompanionAct::Wake { session_id } => {
            super::commands::fleet_wake_session(app.clone(), session_id.clone(), None, None)
                .await
                .map(|new_id| format!("woken as {new_id}"))
        }
        CompanionAct::Kill { session_id } => {
            super::commands::fleet_kill_session(app.clone(), session_id.clone())
                .await
                .map(|_| "session killed".to_string())
        }
    }
}

/// The remote allowlist for approvals: the id must resolve to a CURRENTLY
/// pending approval whose action is one of [`REMOTE_APPROVAL_ACTIONS`]. The
/// phone can never approve an arbitrary approval id it did not see in its own
/// projection.
fn require_remote_approval(app: &AppHandle, approval_id: &str) -> Result<(), String> {
    let allowed = fleet_pending_approvals(app)
        .iter()
        .any(|(a, _, _)| a.id == approval_id);
    if allowed {
        Ok(())
    } else {
        Err("approval is not remote-answerable (unknown, resolved, or not a fleet proposal)".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_gate_accepts_private_rejects_public() {
        for ok in ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.44", "169.254.7.7"] {
            assert!(is_lan_peer(ok.parse().unwrap()), "{ok} should pass");
        }
        for bad in ["8.8.8.8", "1.1.1.1", "203.0.113.5", "2001:4860:4860::8888"] {
            assert!(!is_lan_peer(bad.parse().unwrap()), "{bad} should be refused");
        }
        assert!(is_lan_peer("::1".parse().unwrap()));
    }

    #[test]
    fn sanitize_strips_control_sequences_and_caps() {
        // ESC and other control bytes are dropped; newline survives.
        assert_eq!(sanitize_reply("yes\u{1b}[2Jplease\n"), "yes[2Jplease");
        assert_eq!(sanitize_reply("  1  "), "1");
        assert_eq!(sanitize_reply("\u{7}\u{0}"), "");
        let long = "a".repeat(2 * MAX_REPLY_CHARS);
        assert_eq!(sanitize_reply(&long).chars().count(), MAX_REPLY_CHARS);
    }

    #[test]
    fn act_grammar_is_closed() {
        // The five allowlisted verbs parse…
        for body in [
            r#"{"action":"approve","approval_id":"x"}"#,
            r#"{"action":"reject","approval_id":"x","reason":"no"}"#,
            r#"{"action":"reply","session_id":"s","text":"1"}"#,
            r#"{"action":"wake","session_id":"s"}"#,
            r#"{"action":"kill","session_id":"s"}"#,
        ] {
            assert!(serde_json::from_str::<CompanionAct>(body).is_ok(), "{body}");
        }
        // …and anything else does not.
        for body in [
            r#"{"action":"spawn","cwd":"C:/"}"#,
            r#"{"action":"broadcast","text":"hi"}"#,
            r#"{"action":"write_raw","session_id":"s","bytes":"\u001b[A"}"#,
        ] {
            assert!(serde_json::from_str::<CompanionAct>(body).is_err(), "{body}");
        }
    }

    #[test]
    fn attention_mirrors_frontend_rules() {
        assert_eq!(attention_of(FleetSessionState::AwaitingInput, None, true), "athena");
        assert_eq!(attention_of(FleetSessionState::AwaitingInput, None, false), "waiting");
        assert_eq!(attention_of(FleetSessionState::Stale, None, false), "stale");
        assert_eq!(attention_of(FleetSessionState::Exited, Some(1), false), "failed");
        assert_eq!(attention_of(FleetSessionState::Exited, Some(0), false), "none");
        assert_eq!(attention_of(FleetSessionState::Running, None, false), "none");
    }
}
