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

pub mod mcp;
pub mod relay;

use std::io::Write;
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, Instant};

use axum::routing::{get, post};
use axum::Router;
use serde_json::json;

/// A registered browser-test session expires after this long. Sessions are
/// single-slot (one browser test at a time — turns are serialized by the
/// companion TURN_LOCK anyway) and replaced by the next `run_browser_test`
/// approval; the TTL is the backstop for a slot nobody replaced.
const SESSION_TTL: Duration = Duration::from_secs(30 * 60);

/// One approved browser-test session: the MCP auth token the CLI presents,
/// and the origin the test is allowed to operate on.
struct TestSession {
    token: String,
    origin: String,
    target_url: String,
    created: Instant,
}

static SESSION: OnceLock<RwLock<Option<TestSession>>> = OnceLock::new();

fn session_slot() -> &'static RwLock<Option<TestSession>> {
    SESSION.get_or_init(|| RwLock::new(None))
}

/// Pairing token the extension must present on the WS handshake.
///
/// Threat model: browsers allow arbitrary web pages to open WebSockets to
/// 127.0.0.1, so an unauthenticated `/ws` would let any visited site become
/// "the extension" and receive Athena's browse commands. The token never
/// reaches page JS — only the extension's service worker holds it.
///
/// Resolution order: `PERSONAS_BROWSER_BRIDGE_TOKEN` env override (dev/test
/// harnesses; the isolated-instance launcher passes env through) → random
/// per-run UUID. A persisted token + pairing UI ships with the extension
/// (Phase 2); until then the env override is the only practical client.
pub fn pairing_token() -> &'static str {
    static TOKEN: OnceLock<String> = OnceLock::new();
    TOKEN.get_or_init(|| {
        std::env::var("PERSONAS_BROWSER_BRIDGE_TOKEN")
            .ok()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string())
    })
}

/// Register the single active browser-test session for `target_url` and
/// return the per-session MCP token. Called by `execute_run_browser_test`
/// right before it spawns the proactive turn; replaces any prior slot.
pub fn register_test_session(target_url: &str) -> Result<String, String> {
    let origin = origin_of(target_url)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let mut guard = session_slot().write().unwrap_or_else(|p| p.into_inner());
    *guard = Some(TestSession {
        token: token.clone(),
        origin,
        target_url: target_url.to_string(),
        created: Instant::now(),
    });
    Ok(token)
}

/// Resolve a presented MCP token to `(allowed_origin, target_url)`.
/// `None` = unknown token or expired session.
pub(crate) fn resolve_session(token: &str) -> Option<(String, String)> {
    let guard = session_slot().read().unwrap_or_else(|p| p.into_inner());
    guard
        .as_ref()
        .filter(|s| s.token == token && s.created.elapsed() < SESSION_TTL)
        .map(|s| (s.origin.clone(), s.target_url.clone()))
}

fn current_session_token() -> Option<String> {
    let guard = session_slot().read().unwrap_or_else(|p| p.into_inner());
    guard
        .as_ref()
        .filter(|s| s.created.elapsed() < SESSION_TTL)
        .map(|s| s.token.clone())
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
            let config = json!({
                "mcpServers": {
                    "browser": {
                        "type": "http",
                        "url": format!("http://127.0.0.1:{port}/browser-bridge/mcp"),
                        "headers": { "X-Browser-Session": token }
                    }
                }
            });
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

    #[test]
    fn session_roundtrip_and_replacement() {
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
}
