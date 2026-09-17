//! Browser bridge — Phase 1 of the Athena × Chrome tester arc.
//!
//! Lets a browser-test turn drive the **user's real Chrome** through a
//! companion extension instead of the bundled Playwright browser:
//!
//! ```text
//! Athena CLI turn ──MCP (http)──▶ /browser-bridge/mcp ──WS frame──▶ extension
//!                                        │                              │
//!                                  policy: origin                 chrome.debugger /
//!                                  allowlist + tokens             chrome.scripting
//! ```
//!
//! Mounted on the shared [`crate::local_http`] axum server (same host as
//! `/mcp/rpc` and `/fleet/hooks/*`). Two endpoints:
//!
//! - `GET  /browser-bridge/ws`  — WebSocket the Chrome extension connects to.
//!   Authenticated by the **pairing token** (see [`pairing_token`]): any web
//!   page's JS can open a socket to 127.0.0.1, so the handshake must carry a
//!   secret a page can't know.
//! - `POST /browser-bridge/mcp` — JSON-RPC 2.0 MCP endpoint the browser-test
//!   turn's CLI discovers via `--mcp-config`. Authenticated by a **per-test
//!   session token** minted in `execute_run_browser_test` and carried in the
//!   `X-Browser-Session` header (mirrors the fleet `/mcp/rpc` pattern).
//!
//! Policy lives HERE, not in the model and not in the extension: `register_
//! test_session` pins the approved target origin, and `mcp.rs` refuses
//! navigation outside it. The extension is hands and eyes; the bridge is the
//! gate.
//!
//! When no extension is connected, [`build_browser_mcp_config`] falls back to
//! the bundled `@playwright/mcp` (the proven Phase 0 path), so browser tests
//! keep working before the extension ships / when the user hasn't paired it.

pub mod backend;
pub mod mcp;
pub mod policy;
pub mod relay;
pub mod webview;

use std::collections::HashMap;
use std::io::Write;
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, Instant};

use axum::routing::{get, post};
use axum::Router;

use backend::Principal;
use policy::AllowPolicy;

/// A registered session expires after this long. The TTL is the backstop for
/// a session nobody revoked; the browser-test path additionally replaces its
/// own session on every `run_browser_test` approval.
const SESSION_TTL: Duration = Duration::from_secs(30 * 60);

/// One registered session: who is acting, what they may reach, and what they
/// have spent.
///
/// Until the Whitelist landed there was ONE slot here, pinned to one origin
/// (`TestSession`), because a browser test is one turn against one app. That
/// shape survives unchanged as [`AllowPolicy::Pinned`] — `register_test_session`
/// still replaces it and `resolve_session` still answers only for it — and the
/// map is what lets an operator session, an Athena turn and a fleet run hold
/// Whitelist sessions beside it at the same time.
struct Session {
    principal: Principal,
    allow: AllowPolicy,
    created: Instant,
    /// Calls charged against each origin this turn (rule 4).
    budget_used: HashMap<String, u32>,
    /// The approved target of a browser-test session; empty for Whitelist
    /// sessions, which have no single target.
    target_url: String,
    /// Where the session's page currently is. Set by an allowed navigation
    /// and read by every later call, so a Whitelist session's non-navigation
    /// tools (click, snapshot, a page tool) are charged and gated against a
    /// real origin instead of an argument the model could choose.
    current_origin: Option<String>,
}

/// A session as a caller outside this module sees it.
pub(crate) struct SessionInfo {
    pub principal: Principal,
    pub allow: AllowPolicy,
    pub target_url: String,
    pub current_origin: Option<String>,
}

static SESSIONS: OnceLock<RwLock<HashMap<String, Session>>> = OnceLock::new();

/// Constant-time token lookup. A session token is a credential a remote
/// party presents, so it is never resolved by hash-map equality (whose timing
/// depends on the secret) but by `constant_time_eq` over every live key.
/// The map stays small (one entry per live agent session), so the scan is
/// cheap, and the compare is the same primitive `ipc_auth` uses.
fn find_key<'a, V>(map: &'a HashMap<String, V>, token: &str) -> Option<&'a str> {
    let mut hit: Option<&'a str> = None;
    for key in map.keys() {
        if crate::ipc_auth::constant_time_eq(key, token) {
            hit = Some(key.as_str());
        }
    }
    hit
}

fn sessions() -> &'static RwLock<HashMap<String, Session>> {
    SESSIONS.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Pairing token the extension must present on the WS handshake.
///
/// Threat model: browsers allow arbitrary web pages to open WebSockets to
/// 127.0.0.1, so an unauthenticated `/ws` would let any visited site become
/// "the extension" and receive Athena's browse commands. The token never
/// reaches page JS — only the extension's service worker holds it.
///
/// Resolution order: `PERSONAS_BROWSER_BRIDGE_TOKEN` env override (dev/test
/// harnesses; the isolated-instance launcher passes env through) → the
/// persisted token installed at startup via [`init_pairing_token`] → a
/// random per-run UUID (first run before persistence lands). The Companion
/// Setup panel surfaces it (Phase 3) and can rotate it via
/// [`set_pairing_token`].
fn pairing_slot() -> &'static RwLock<String> {
    static TOKEN: OnceLock<RwLock<String>> = OnceLock::new();
    TOKEN.get_or_init(|| {
        RwLock::new(
            env_pairing_token().unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string()),
        )
    })
}

fn env_pairing_token() -> Option<String> {
    std::env::var("PERSONAS_BROWSER_BRIDGE_TOKEN")
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

pub fn pairing_token() -> String {
    pairing_slot()
        .read()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

/// Install the persisted pairing token at app startup. The env override
/// (QA harnesses) always wins; an empty persisted value is ignored.
pub fn init_pairing_token(persisted: &str) {
    if env_pairing_token().is_some() || persisted.trim().is_empty() {
        return;
    }
    *pairing_slot().write().unwrap_or_else(|p| p.into_inner()) = persisted.trim().to_string();
}

/// Rotate the pairing token (Companion Setup → regenerate). A connected
/// extension keeps its socket — the token is only checked at handshake —
/// but its next reconnect needs the new value.
pub fn set_pairing_token(token: &str) {
    *pairing_slot().write().unwrap_or_else(|p| p.into_inner()) = token.trim().to_string();
}

/// Register the single active browser-test session for `target_url` and
/// return the per-session MCP token. Called by `execute_run_browser_test`
/// right before it spawns the proactive turn; replaces any prior
/// browser-test session, and leaves Whitelist sessions alone.
pub fn register_test_session(target_url: &str) -> Result<String, String> {
    let origin = origin_of(target_url)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let mut guard = sessions().write().unwrap_or_else(|p| p.into_inner());
    prune(&mut guard);
    // The browser-test lane is still single-slot: one test at a time, and the
    // next approval supersedes the last. Only Pinned sessions are evicted.
    guard.retain(|_, s| !matches!(s.allow, AllowPolicy::Pinned(_)));
    guard.insert(
        token.clone(),
        Session {
            principal: Principal::Athena,
            allow: AllowPolicy::Pinned(origin),
            created: Instant::now(),
            budget_used: HashMap::new(),
            target_url: target_url.to_string(),
            current_origin: None,
        },
    );
    Ok(token)
}

/// Register a session for `principal` under `allow` and return its token.
///
/// No production caller yet: a Whitelist session is minted when the operator
/// opens a tab (WP2) or a persona run binds the `browser` connector (WP4).
/// The mechanism lands here because the gate it feeds does.
/// The Whitelist path's door; unlike [`register_test_session`] it evicts
/// nothing, because many principals hold sessions at once.
#[allow(dead_code)] // caller lands in WP2/WP4 — see the doc comment
pub fn register_session(principal: Principal, allow: AllowPolicy) -> String {
    let token = uuid::Uuid::new_v4().simple().to_string();
    let mut guard = sessions().write().unwrap_or_else(|p| p.into_inner());
    prune(&mut guard);
    guard.insert(
        token.clone(),
        Session {
            principal,
            allow,
            created: Instant::now(),
            budget_used: HashMap::new(),
            target_url: String::new(),
            current_origin: None,
        },
    );
    token
}

/// Drop a session. Returns whether one was there — a revoke of an already
/// expired token is not an error, it is the same outcome.
#[allow(dead_code)] // caller lands in WP2/WP4, beside register_session
pub fn revoke_session(token: &str) -> bool {
    let mut guard = sessions().write().unwrap_or_else(|p| p.into_inner());
    let key = find_key(&guard, token).map(str::to_owned);
    let had = key.and_then(|k| guard.remove(&k)).is_some();
    prune(&mut guard);
    had
}

/// Resolve a presented MCP token to `(allowed_origin, target_url)`.
/// `None` = unknown token, expired session, or a session that is not pinned
/// to one origin. The browser-test path's resolution, unchanged.
#[allow(dead_code)] // the browser-test lane's published resolution, kept as
                    // the contract `execute_run_browser_test` and its tests were written against;
                    // `mcp.rs` reads the richer `session_info` instead.
pub(crate) fn resolve_session(token: &str) -> Option<(String, String)> {
    let guard = sessions().read().unwrap_or_else(|p| p.into_inner());
    guard
        .get(find_key(&guard, token).unwrap_or(""))
        .filter(|s| s.created.elapsed() < SESSION_TTL)
        .and_then(|s| match &s.allow {
            AllowPolicy::Pinned(origin) => Some((origin.clone(), s.target_url.clone())),
            AllowPolicy::Whitelist => None,
        })
}

/// The principal and policy behind a token — what the gate decides with.
pub(crate) fn session_info(token: &str) -> Option<SessionInfo> {
    let guard = sessions().read().unwrap_or_else(|p| p.into_inner());
    guard
        .get(find_key(&guard, token).unwrap_or(""))
        .filter(|s| s.created.elapsed() < SESSION_TTL)
        .map(|s| SessionInfo {
            principal: s.principal.clone(),
            allow: s.allow.clone(),
            target_url: s.target_url.clone(),
            current_origin: s.current_origin.clone(),
        })
}

/// Outcome of charging one call against a session's per-origin budget.
pub(crate) enum BudgetOutcome {
    /// Charged; the value is the number of calls spent including this one.
    Charged(u32),
    /// The limit was already reached; nothing was charged.
    Exhausted,
    /// Unknown or expired token.
    NoSession,
}

/// Charge one call against `origin`'s budget in this session (rule 4).
///
/// The counter lives with the session rather than in the row, because the
/// budget is per TURN: a new session starts at zero without anything having
/// to reset a column, which is the failure mode a persisted counter has.
pub(crate) fn charge_session_budget(token: &str, origin: &str, limit: u32) -> BudgetOutcome {
    let mut guard = sessions().write().unwrap_or_else(|p| p.into_inner());
    prune(&mut guard);
    let Some(session) = find_key(&guard, token)
        .map(str::to_owned)
        .and_then(|k| guard.get_mut(&k))
    else {
        return BudgetOutcome::NoSession;
    };
    let used = session.budget_used.entry(origin.to_string()).or_insert(0);
    if *used >= limit {
        return BudgetOutcome::Exhausted;
    }
    *used += 1;
    BudgetOutcome::Charged(*used)
}

/// Record where an allowed navigation put the session's page.
pub(crate) fn set_session_origin(token: &str, origin: &str) {
    let mut guard = sessions().write().unwrap_or_else(|p| p.into_inner());
    if let Some(session) = find_key(&guard, token)
        .map(str::to_owned)
        .and_then(|k| guard.get_mut(&k))
    {
        session.current_origin = Some(origin.to_string());
    }
}

fn prune(map: &mut HashMap<String, Session>) {
    map.retain(|_, s| s.created.elapsed() < SESSION_TTL);
}

fn current_session_token() -> Option<String> {
    let guard = sessions().read().unwrap_or_else(|p| p.into_inner());
    guard
        .iter()
        .find(|(_, s)| {
            s.created.elapsed() < SESSION_TTL && matches!(s.allow, AllowPolicy::Pinned(_))
        })
        .map(|(token, _)| token.clone())
}

/// Scheme+host+port origin of an http(s) URL, in ascii serialization
/// (`http://localhost:8765`). Errors on other schemes — a browser test
/// target is always a web origin.
pub fn origin_of(u: &str) -> Result<String, String> {
    let parsed = url::Url::parse(u).map_err(|e| format!("invalid URL `{u}`: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!(
            "browser-test target must be http(s), got `{}`",
            parsed.scheme()
        ));
    }
    Ok(parsed.origin().ascii_serialization())
}

/// Is a (paired) extension currently connected over the WS relay?
pub fn extension_connected() -> bool {
    relay::is_connected()
}

/// Which browser backend a browser-test turn will drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserToolMode {
    /// The user's real Chrome, via the paired extension + this bridge.
    Extension,
    /// The bundled `@playwright/mcp` browser (Phase 0 path / fallback).
    Playwright,
}

/// Build the `--mcp-config` temp file for a browser-test CLI spawn.
///
/// Extension mode when (a) an extension is connected on the relay AND (b) a
/// test session is registered AND (c) the local_http server is up; otherwise
/// the Playwright fallback. The returned `NamedTempFile` must outlive the
/// CLI child (drop deletes it).
pub fn build_browser_mcp_config() -> Result<(tempfile::NamedTempFile, BrowserToolMode), String> {
    if extension_connected() {
        if let (Some(token), Some(port)) = (current_session_token(), crate::local_http::port()) {
            let config = personas_core::mcp_config::mcp_config_json([(
                "browser",
                personas_core::mcp_config::McpServer::http(format!(
                    "http://127.0.0.1:{port}/browser-bridge/mcp"
                ))
                .with_header("X-Browser-Session", token),
            )]);
            let mut tmp = tempfile::Builder::new()
                .prefix("personas_mcp_")
                .suffix(".json")
                .tempfile()
                .map_err(|e| format!("Failed to create temp MCP config: {e}"))?;
            tmp.write_all(
                serde_json::to_string_pretty(&config)
                    .map_err(|e| format!("Failed to serialize MCP config: {e}"))?
                    .as_bytes(),
            )
            .map_err(|e| format!("Failed to write temp MCP config: {e}"))?;
            tmp.flush()
                .map_err(|e| format!("Failed to flush temp MCP config: {e}"))?;
            return Ok((tmp, BrowserToolMode::Extension));
        }
    }
    crate::commands::credentials::auto_cred_browser::build_playwright_mcp_config()
        .map(|f| (f, BrowserToolMode::Playwright))
}

/// axum Router to mount under `/browser-bridge` on the shared local_http
/// server. Stateless — all state lives in module statics (OnceLock pattern,
/// same as the fleet MCP token registry).
pub fn router() -> Router {
    Router::new()
        .route("/ws", get(relay::ws_handler))
        // The embedded pages' answer channel (WP2). Same reasoning as `/ws`
        // above, one rung lower: a page webview cannot invoke a Tauri command
        // at all (Tauri ACL-checks every invoke from a REMOTE origin whether or
        // not the app declares an ACL manifest -- `tauri-2.11.2/src/webview/
        // mod.rs:1822`), so the socket this module already relies on is also
        // the only way an answer gets out of a page. Authenticated per TAB by
        // the same per-tab token its initialization script closed over, not by
        // the pairing token -- a page is not the extension and must never be
        // able to present the extension's credential.
        .route("/page-ws", get(webview::relay::page_ws_handler))
        .route("/mcp", post(mcp::rpc_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_of_normalizes() {
        assert_eq!(
            origin_of("http://localhost:8765/some/page?q=1").unwrap(),
            "http://localhost:8765"
        );
        assert_eq!(
            origin_of("https://staging.example.com/").unwrap(),
            "https://staging.example.com"
        );
        assert!(origin_of("file:///etc/passwd").is_err());
        assert!(origin_of("not a url").is_err());
    }

    /// The session map is a process-wide static and `register_test_session`
    /// deliberately evicts every other browser-test session, so the two tests
    /// that exercise it must not interleave.
    static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn session_roundtrip_and_replacement() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let t1 = register_test_session("http://localhost:8765/app").unwrap();
        let (origin, target) = resolve_session(&t1).expect("registered session resolves");
        assert_eq!(origin, "http://localhost:8765");
        assert_eq!(target, "http://localhost:8765/app");

        // Second registration replaces the slot; the old token dies.
        let t2 = register_test_session("https://staging.example.com/x").unwrap();
        assert!(resolve_session(&t1).is_none());
        assert!(resolve_session(&t2).is_some());
        assert!(resolve_session("bogus").is_none());
    }

    /// REGRESSION (spark browser-control, WP1): the single `SESSION` slot
    /// became a map so the Whitelist path can hold many sessions at once.
    /// The browser-test lane must be untouched by that — its session is
    /// still replaced by the next approval, it still resolves to
    /// `(origin, target_url)`, and a Whitelist session registered beside it
    /// must neither be evicted by it nor answer `resolve_session`.
    #[test]
    fn whitelist_sessions_coexist_without_disturbing_the_pinned_lane() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());

        let wl = register_session(Principal::Operator, AllowPolicy::Whitelist);
        let t1 = register_test_session("http://localhost:8765/app").unwrap();
        // Replacing the browser-test session evicts t1 and nothing else.
        let t2 = register_test_session("https://staging.example.com/x").unwrap();

        assert!(
            resolve_session(&t1).is_none(),
            "the pinned lane still replaces"
        );
        assert_eq!(
            resolve_session(&t2).unwrap().0,
            "https://staging.example.com"
        );
        assert!(
            session_info(&wl).is_some(),
            "a Whitelist session survives a browser-test registration"
        );
        assert!(
            resolve_session(&wl).is_none(),
            "a Whitelist session is pinned to no origin, so it resolves to none"
        );
        assert!(matches!(
            session_info(&wl).unwrap().allow,
            AllowPolicy::Whitelist
        ));
        assert_eq!(session_info(&t2).unwrap().principal, Principal::Athena);

        assert!(revoke_session(&wl));
        assert!(!revoke_session(&wl), "a second revoke is a no-op");
        assert!(session_info(&wl).is_none());
        revoke_session(&t2);
    }

    #[test]
    fn budget_is_charged_per_origin_and_stops_at_the_limit() {
        let token = register_session(Principal::Operator, AllowPolicy::Whitelist);
        for expected in 1..=2u32 {
            match charge_session_budget(&token, "https://a.example", 2) {
                BudgetOutcome::Charged(n) => assert_eq!(n, expected),
                _ => panic!("charge {expected} should have been allowed"),
            }
        }
        assert!(matches!(
            charge_session_budget(&token, "https://a.example", 2),
            BudgetOutcome::Exhausted
        ));
        // A different origin has its own counter.
        assert!(matches!(
            charge_session_budget(&token, "https://b.example", 2),
            BudgetOutcome::Charged(1)
        ));
        assert!(matches!(
            charge_session_budget("bogus", "https://a.example", 2),
            BudgetOutcome::NoSession
        ));
        revoke_session(&token);
    }
}
