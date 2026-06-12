//! MCP endpoint for browser-test turns (`POST /browser-bridge/mcp`).
//!
//! JSON-RPC 2.0 subset, cloned from the proven fleet endpoint
//! (`companion/orchestration/mcp`): `initialize`, `notifications/initialized`,
//! `tools/list`, `tools/call`. The CLI discovers it via the per-turn
//! `--mcp-config` written by [`super::build_browser_mcp_config`].
//!
//! Every `tools/call` (a) authenticates the `X-Browser-Session` token against
//! the registered test session and (b) for navigation, enforces the session's
//! origin allowlist BEFORE relaying to the extension. The model never gets to
//! choose the origin — the approval did.

use axum::http::HeaderMap;
use axum::Json;
use serde_json::{json, Value};
use std::time::Duration;

/// Header carrying the per-test-session token (set in the turn's mcp.json).
pub const SESSION_HEADER: &str = "x-browser-session";

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "personas-browser-bridge";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Default per-command relay timeout. Screenshots and waits get more.
const RELAY_TIMEOUT: Duration = Duration::from_secs(30);
const RELAY_TIMEOUT_SLOW: Duration = Duration::from_secs(60);

// ── JSON-RPC plumbing (mirrors orchestration/mcp) ───────────────────────────

#[derive(serde::Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    method: String,
    #[serde(default)]
    params: Value,
    id: Option<Value>,
}

mod codes {
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const UNAUTHORIZED: i32 = -32001;
}

fn rpc_error(id: Value, code: i32, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message.into() }
    })
}

fn rpc_ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub async fn rpc_handler(headers: HeaderMap, Json(body): Json<Value>) -> Json<Value> {
    let req: JsonRpcRequest = match serde_json::from_value(body.clone()) {
        Ok(r) => r,
        Err(e) => {
            return Json(rpc_error(
                body.get("id").cloned().unwrap_or(Value::Null),
                codes::INVALID_REQUEST,
                format!("invalid request: {e}"),
            ));
        }
    };
    let Some(id) = req.id else {
        // Notification — no response body.
        return Json(Value::Null);
    };

    match req.method.as_str() {
        "initialize" => Json(rpc_ok(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION }
            }),
        )),
        "tools/list" => Json(rpc_ok(id, json!({ "tools": tool_descriptors() }))),
        "tools/call" => {
            let (origin, target_url) = match require_session(&headers) {
                Ok(s) => s,
                Err(msg) => return Json(rpc_error(id, codes::UNAUTHORIZED, msg)),
            };
            match call_tool(&origin, &target_url, req.params).await {
                Ok(result) => Json(rpc_ok(id, result)),
                Err((code, msg)) => Json(rpc_error(id, code, msg)),
            }
        }
        other => Json(rpc_error(
            id,
            codes::METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        )),
    }
}

fn require_session(headers: &HeaderMap) -> Result<(String, String), String> {
    let token = headers
        .get(SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("missing {SESSION_HEADER} header"))?;
    super::resolve_session(token)
        .ok_or_else(|| "unknown or expired browser-test session token".to_string())
}

// ── Tools ────────────────────────────────────────────────────────────────────

fn tool_descriptors() -> Value {
    let no_args = json!({ "type": "object", "properties": {} });
    json!([
        {
            "name": "browser_status",
            "description": "Bridge + extension status: whether the user's Chrome extension is connected, the approved test origin, and (when attached) the current tab URL/title. Call this FIRST to confirm the browser is reachable.",
            "inputSchema": no_args
        },
        {
            "name": "browser_navigate",
            "description": "Navigate the test tab to a URL. Only URLs on the approved test origin are allowed — the bridge rejects everything else. Opens/attaches the test tab on first use.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Absolute http(s) URL on the approved test origin. Omit to open the approved target URL itself." }
                }
            }
        },
        {
            "name": "browser_snapshot",
            "description": "Accessibility-tree snapshot of the current page — roles, names, values, element refs. Prefer this over screenshots for inspecting structure and finding elements to interact with.",
            "inputSchema": no_args
        },
        {
            "name": "browser_click",
            "description": "Click an element, located by CSS selector or by its visible text (provide at least one).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector of the element to click." },
                    "text": { "type": "string", "description": "Visible text of the element to click (exact or close match)." }
                }
            }
        },
        {
            "name": "browser_type",
            "description": "Type text into an input/textarea located by CSS selector, optionally submitting the enclosing form afterwards.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector of the input." },
                    "text": { "type": "string", "description": "Text to type." },
                    "submit": { "type": "boolean", "description": "Press Enter / submit the form after typing (default false)." }
                },
                "required": ["selector", "text"]
            }
        },
        {
            "name": "browser_screenshot",
            "description": "Screenshot of the visible viewport of the test tab (PNG). Use for visual verification a DOM snapshot can't answer (styling, layout, rendering).",
            "inputSchema": no_args
        },
        {
            "name": "browser_console",
            "description": "Console messages buffered since the test tab was attached (errors, warnings, logs) plus failed network requests when available.",
            "inputSchema": no_args
        },
        {
            "name": "browser_wait_for",
            "description": "Wait until the page contains the given visible text, or until the timeout elapses.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "Visible text to wait for." },
                    "timeout_ms": { "type": "number", "description": "Max wait in milliseconds (default 5000, cap 30000)." }
                },
                "required": ["text"]
            }
        },
        {
            "name": "browser_detach",
            "description": "Release the test tab (detach the debugger, stop console capture). Call when the test is done.",
            "inputSchema": no_args
        }
    ])
}

fn text_result(text: impl Into<String>) -> Value {
    json!({ "content": [ { "type": "text", "text": text.into() } ], "isError": false })
}

fn error_result(text: impl Into<String>) -> Value {
    json!({ "content": [ { "type": "text", "text": text.into() } ], "isError": true })
}

async fn call_tool(
    origin: &str,
    target_url: &str,
    params: Value,
) -> Result<Value, (i32, String)> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or((codes::INVALID_PARAMS, "missing tool name".to_string()))?
        .to_string();
    let mut args = params.get("arguments").cloned().unwrap_or(json!({}));

    // `browser_status` answers even with no extension — that's its job.
    if name == "browser_status" {
        if !super::extension_connected() {
            return Ok(text_result(format!(
                "{{\"connected\": false, \"approved_origin\": \"{origin}\", \"hint\": \"No Chrome extension is connected to the bridge — the test cannot drive the user's browser this turn. Report this instead of guessing.\"}}"
            )));
        }
        let status = relay_or_tool_error("browser_status", json!({}), RELAY_TIMEOUT).await;
        return Ok(augment_status(status, origin));
    }

    // Everything else needs the extension.
    if !super::extension_connected() {
        return Ok(error_result(
            "No Chrome extension is connected to the bridge. Use browser_status for details; report the situation to the user rather than retrying.",
        ));
    }

    // Origin policy: navigation may only stay on the approved origin. The
    // check happens HERE (trusted side), not in the extension or the model.
    if name == "browser_navigate" {
        let url = match args.get("url").and_then(|v| v.as_str()) {
            Some(u) if !u.trim().is_empty() => u.trim().to_string(),
            _ => target_url.to_string(),
        };
        match super::origin_of(&url) {
            Ok(o) if o == origin => {
                args = json!({ "url": url });
            }
            Ok(o) => {
                return Ok(error_result(format!(
                    "Navigation to `{url}` refused: origin `{o}` is outside the approved test origin `{origin}`. Stay on the approved origin."
                )));
            }
            Err(e) => return Ok(error_result(format!("Navigation refused: {e}"))),
        }
    }

    if name == "browser_click"
        && args.get("selector").and_then(|v| v.as_str()).is_none()
        && args.get("text").and_then(|v| v.as_str()).is_none()
    {
        return Err((
            codes::INVALID_PARAMS,
            "browser_click needs `selector` or `text`".to_string(),
        ));
    }

    let timeout = match name.as_str() {
        "browser_screenshot" | "browser_snapshot" => RELAY_TIMEOUT_SLOW,
        "browser_wait_for" => {
            let ms = args
                .get("timeout_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(5000)
                .min(30_000);
            Duration::from_millis(ms) + Duration::from_secs(10)
        }
        _ => RELAY_TIMEOUT,
    };

    let known = [
        "browser_navigate",
        "browser_snapshot",
        "browser_click",
        "browser_type",
        "browser_screenshot",
        "browser_console",
        "browser_wait_for",
        "browser_detach",
    ];
    if !known.contains(&name.as_str()) {
        return Err((codes::METHOD_NOT_FOUND, format!("unknown tool `{name}`")));
    }

    let result = relay_or_tool_error(&name, args, timeout).await;

    // Screenshots come back as an MCP image block so the model can SEE them.
    if name == "browser_screenshot" {
        if let Some(data) = result
            .get("__relay_ok")
            .and_then(|r| r.get("data"))
            .and_then(|v| v.as_str())
        {
            let mime = result
                .get("__relay_ok")
                .and_then(|r| r.get("mimeType"))
                .and_then(|v| v.as_str())
                .unwrap_or("image/png");
            return Ok(json!({
                "content": [ { "type": "image", "data": data, "mimeType": mime } ],
                "isError": false
            }));
        }
    }

    Ok(unwrap_relay(result))
}

/// Relay a frame; encode success as `{"__relay_ok": <result>}` and failure as
/// `{"__relay_err": "<msg>"}` so callers can post-process before flattening.
async fn relay_or_tool_error(method: &str, args: Value, timeout: Duration) -> Value {
    match super::relay::send_command(method, args, timeout).await {
        Ok(result) => json!({ "__relay_ok": result }),
        Err(e) => json!({ "__relay_err": e }),
    }
}

/// Flatten a relay envelope into the MCP text/error content shape.
fn unwrap_relay(envelope: Value) -> Value {
    if let Some(err) = envelope.get("__relay_err").and_then(|v| v.as_str()) {
        return error_result(format!("Browser command failed: {err}"));
    }
    let payload = envelope
        .get("__relay_ok")
        .cloned()
        .unwrap_or(Value::Null);
    let text = match payload {
        Value::String(s) => s,
        other => serde_json::to_string_pretty(&other).unwrap_or_else(|_| other.to_string()),
    };
    text_result(text)
}

/// browser_status: merge the extension's own report with the bridge's
/// policy context so the model sees one coherent status blob.
fn augment_status(envelope: Value, origin: &str) -> Value {
    if let Some(err) = envelope.get("__relay_err").and_then(|v| v.as_str()) {
        return error_result(format!("Status check failed: {err}"));
    }
    let mut merged = json!({ "connected": true, "approved_origin": origin });
    if let (Some(obj), Some(ext)) = (
        merged.as_object_mut(),
        envelope.get("__relay_ok").and_then(|v| v.as_object()),
    ) {
        for (k, v) in ext {
            obj.entry(k.clone()).or_insert(v.clone());
        }
    }
    text_result(serde_json::to_string_pretty(&merged).unwrap_or_default())
}
