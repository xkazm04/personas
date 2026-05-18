//! Athena as MCP server — Direction 3.
//!
//! Claude Code sessions discover Athena via `--mcp-config <file>` at
//! spawn time. The config points at this HTTP endpoint, mounted by
//! [`router`] on the same axum server that hosts `/fleet/hooks/*`.
//!
//! Why MCP on top of hooks: hooks are *passive*, one-way, and only
//! emit lifecycle / tool-call shapes. We infer from them what each
//! session is doing. With MCP, the session **tells** us — and Athena
//! can answer back synchronously. `request_guidance` turns a stuck
//! session into a question Athena can resolve before the session burns
//! tokens guessing.
//!
//! ## Transport
//!
//! Single POST endpoint `/mcp/rpc` speaking JSON-RPC 2.0. No SSE — we
//! don't currently push server→client notifications, so the simpler
//! request/response transport is enough. The MCP "streamable HTTP"
//! transport spec allows this subset.
//!
//! ## Session identity
//!
//! Per-Fleet-session tokens minted at spawn time and passed to the
//! child claude via the config file's HTTP headers entry. Every MCP
//! tool call carries `X-Athena-Session: <token>` and we look up the
//! Fleet session id from there. Tokens are released when the session
//! exits.
//!
//! ## Tools
//!
//! Four tools, defined in [`handlers`]:
//!
//! | Tool                       | Effect                                                        | Blocking |
//! |----------------------------|---------------------------------------------------------------|----------|
//! | `athena.report_intent`     | Claim or join an Operation; set role + intent string         | No       |
//! | `athena.checkpoint`        | Append progress / blockers to operative memory               | No       |
//! | `athena.request_guidance`  | Ask Athena a question; block until she answers               | **Yes**  |
//! | `athena.request_approval`  | Propose a destructive action; block until user approves      | **Yes**  |
//!
//! The blocking handlers register a pending request, emit a Tauri
//! event so the frontend can render it, then await a oneshot from
//! [`pending`]. Resolution comes back through the
//! `companion_mcp_resolve_request` Tauri command.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

pub mod handlers;
pub mod pending;

/// Header that carries the per-session token, set in each session's
/// generated mcp.json so claude includes it on every JSON-RPC call.
pub const SESSION_HEADER: &str = "x-athena-session";

/// MCP protocol version we advertise on `initialize`. Bumped when the
/// schema for the four tools changes shape; the wire protocol itself
/// is JSON-RPC 2.0 which is stable.
const PROTOCOL_VERSION: &str = "2024-11-05";

/// Server identification returned on `initialize`.
const SERVER_NAME: &str = "athena";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

// ---------------------------------------------------------------------------
// Session token registry
// ---------------------------------------------------------------------------

#[derive(Default)]
struct TokenRegistry {
    /// token → fleet_session_id
    tokens: HashMap<String, String>,
}

static TOKENS: OnceLock<RwLock<TokenRegistry>> = OnceLock::new();

fn tokens() -> &'static RwLock<TokenRegistry> {
    TOKENS.get_or_init(|| RwLock::new(TokenRegistry::default()))
}

/// Mint a fresh per-session MCP token. The caller writes it into the
/// session's `mcp.json` headers entry and remembers the token so it
/// can be released on session exit.
pub fn mint_session_token(fleet_session_id: &str) -> String {
    let token = Uuid::new_v4().simple().to_string();
    let mut reg = tokens().write().unwrap_or_else(|p| p.into_inner());
    reg.tokens.insert(token.clone(), fleet_session_id.to_string());
    token
}

/// Drop every token that maps to this Fleet session id. Idempotent.
pub fn release_session_tokens(fleet_session_id: &str) {
    let mut reg = tokens().write().unwrap_or_else(|p| p.into_inner());
    reg.tokens.retain(|_, sid| sid != fleet_session_id);
}

/// Look up the Fleet session id for a given token.
fn resolve_token(token: &str) -> Option<String> {
    let reg = tokens().read().unwrap_or_else(|p| p.into_inner());
    reg.tokens.get(token).cloned()
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/// axum Router to mount under `/mcp`. Resulting URL is
/// `http://127.0.0.1:<local_http_port>/mcp/rpc`.
pub fn router(app: AppHandle) -> Router {
    Router::new()
        .route("/rpc", post(rpc_handler))
        .with_state(app)
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 wire types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    method: String,
    #[serde(default)]
    params: Value,
    /// Optional per JSON-RPC 2.0 (notifications omit it). When absent,
    /// the call is a notification and we do not respond.
    id: Option<Value>,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

impl JsonRpcError {
    fn new(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }
}

/// Standard JSON-RPC error codes.
mod codes {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
    // Server-reserved range -32099..-32000
    pub const UNAUTHORIZED: i32 = -32001;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async fn rpc_handler(
    State(app): State<AppHandle>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    // Parse as JSON-RPC request. Bail with -32600 if the shape is
    // wrong; the MCP client sees the error and surfaces it cleanly.
    let req: JsonRpcRequest = match serde_json::from_value(body.clone()) {
        Ok(r) => r,
        Err(e) => {
            let resp = error_response(
                body.get("id").cloned().unwrap_or(Value::Null),
                JsonRpcError::new(codes::INVALID_REQUEST, format!("invalid request: {e}")),
            );
            return Ok(Json(resp));
        }
    };

    // Notifications (no id) we ack with 204 — JSON-RPC says no body.
    let id = match req.id {
        Some(v) => v,
        None => {
            // Still dispatch the side effects, just don't return a response.
            let _ = dispatch(&app, &headers, &req.method, req.params).await;
            return Ok(Json(json!(null)));
        }
    };

    match dispatch(&app, &headers, &req.method, req.params).await {
        Ok(result) => Ok(Json(serde_json::to_value(JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }).unwrap_or_default())),
        Err(err) => Ok(Json(error_response(id, err))),
    }
}

fn error_response(id: Value, err: JsonRpcError) -> Value {
    serde_json::to_value(JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(err),
    }).unwrap_or_default()
}

async fn dispatch(
    app: &AppHandle,
    headers: &HeaderMap,
    method: &str,
    params: Value,
) -> Result<Value, JsonRpcError> {
    match method {
        "initialize" => Ok(initialize_result()),

        // MCP clients send this once they've accepted `initialize` —
        // it's a notification, so dispatch returns Ok but the wrapper
        // skips the response.
        "notifications/initialized" => Ok(Value::Null),

        "tools/list" => Ok(json!({ "tools": handlers::tool_descriptors() })),

        "tools/call" => {
            let session_id = require_session(headers)?;
            handlers::call_tool(app, &session_id, params).await
        }

        // Optional server endpoints we may add later (resources, prompts).
        // For now, anything else is unknown.
        other => Err(JsonRpcError::new(
            codes::METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        )),
    }
}

fn initialize_result() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": SERVER_VERSION
        }
    })
}

fn require_session(headers: &HeaderMap) -> Result<String, JsonRpcError> {
    let token = headers
        .get(SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            JsonRpcError::new(
                codes::UNAUTHORIZED,
                format!("missing {SESSION_HEADER} header"),
            )
        })?;
    resolve_token(token).ok_or_else(|| {
        JsonRpcError::new(codes::UNAUTHORIZED, "unknown or revoked session token")
    })
}

// ---------------------------------------------------------------------------
// Internal helpers exposed to siblings
// ---------------------------------------------------------------------------

/// Construct a tools/call result envelope wrapping a JSON value as a
/// single text-content block. MCP defines `content` as an array of
/// typed blocks; for our purposes "text + json-stringified payload" is
/// the canonical shape — opaque to the LLM, machine-readable to any
/// scripted consumer.
pub(crate) fn text_result(text: impl Into<String>) -> Value {
    json!({
        "content": [
            { "type": "text", "text": text.into() }
        ],
        "isError": false
    })
}

pub(crate) fn invalid_params(msg: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(codes::INVALID_PARAMS, msg)
}

pub(crate) fn internal_error(msg: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(codes::INTERNAL_ERROR, msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_round_trip() {
        let t = mint_session_token("fleet-sess-abc");
        assert_eq!(resolve_token(&t).as_deref(), Some("fleet-sess-abc"));
    }

    #[test]
    fn release_drops_all_tokens_for_session() {
        let _t1 = mint_session_token("fleet-sess-xyz");
        let _t2 = mint_session_token("fleet-sess-xyz");
        let other = mint_session_token("fleet-sess-other");
        release_session_tokens("fleet-sess-xyz");
        assert!(resolve_token(&_t1).is_none());
        assert!(resolve_token(&_t2).is_none());
        assert_eq!(resolve_token(&other).as_deref(), Some("fleet-sess-other"));
    }

    #[test]
    fn missing_header_errors_unauthorized() {
        let headers = HeaderMap::new();
        let err = require_session(&headers).unwrap_err();
        assert_eq!(err.code, codes::UNAUTHORIZED);
    }

    #[test]
    fn unknown_token_errors_unauthorized() {
        let mut headers = HeaderMap::new();
        headers.insert(SESSION_HEADER, "never-minted".parse().unwrap());
        let err = require_session(&headers).unwrap_err();
        assert_eq!(err.code, codes::UNAUTHORIZED);
    }

    #[test]
    fn initialize_advertises_tools_capability() {
        let r = initialize_result();
        assert_eq!(r["protocolVersion"], PROTOCOL_VERSION);
        assert!(r["capabilities"]["tools"].is_object());
        assert_eq!(r["serverInfo"]["name"], SERVER_NAME);
    }
}
