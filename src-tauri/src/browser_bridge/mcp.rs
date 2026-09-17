//! MCP endpoint for browser turns (`POST /browser-bridge/mcp`).
//!
//! JSON-RPC 2.0 subset, cloned from the proven fleet endpoint
//! (`companion/orchestration/mcp`): `initialize`, `notifications/initialized`,
//! `tools/list`, `tools/call`. The CLI discovers it via the per-turn
//! `--mcp-config` written by [`super::build_browser_mcp_config`].
//!
//! **Every `tools/call` goes through the same five gates, in this order**
//! ([`super::policy`]), and the first refusal wins:
//!
//! ```text
//! token -> session -> check_navigation -> check_tool -> charge_budget -> lease -> backend
//! ```
//!
//! Two properties of that line are the whole design. (a) The gate runs in
//! THIS process, before any backend, so the model never chooses the origin,
//! the class or the budget — the approval and the Whitelist row did. (b) A
//! refusal is returned as the JSON of [`super::backend::Refusal`] with
//! `isError: true`, never as a driver's own error string: the closed
//! vocabulary plus a mandatory `hint` is what makes a refusal something the
//! agent can act on alone (agent-actionable-errors).
//!
//! The browser-test lane (`AllowPolicy::Pinned`) keeps its Phase 1 behaviour
//! exactly: its origin was approved when `run_browser_test` was approved, so
//! its writes are not held for a second decision. A Whitelist session's
//! writes are, and in WP1 that hold is a `pending_approval` refusal — WP3
//! wires the approval itself.

use axum::http::HeaderMap;
use axum::Json;
use serde_json::{json, Value};
use std::time::Duration;

use super::backend::{self, Action, Refusal, RefusalCode, SNAPSHOT_CAP_CHARS};
use super::policy::{self, AllowPolicy, ToolClass};
use super::SessionInfo;

/// Header carrying the per-session token (set in the turn's mcp.json).
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
        // MCP 2026-07-28: mandatory stateless discovery / dual-era probe.
        // Not session-gated — identity + capabilities only, like `initialize`.
        "server/discover" => Json(rpc_ok(
            id,
            json!({
                "resultType": "complete",
                "supportedVersions": ["2026-07-28", PROTOCOL_VERSION],
                "capabilities": { "tools": {} },
                "instructions": "Personas browser-bridge MCP endpoint. Tool calls require the per-turn X-Browser-Session header.",
                "_meta": {
                    "io.modelcontextprotocol/serverInfo": {
                        "name": SERVER_NAME,
                        "version": SERVER_VERSION
                    }
                },
                "ttlMs": 3_600_000,
                "cacheScope": "private"
            }),
        )),
        "tools/list" => Json(rpc_ok(
            id,
            // ttlMs/cacheScope: 2026-07-28 CacheableResult — descriptors are
            // static per build.
            json!({ "tools": tool_descriptors(), "ttlMs": 3_600_000, "cacheScope": "private" }),
        )),
        "tools/call" => {
            let (token, session) = match require_session(&headers) {
                Ok(s) => s,
                Err(msg) => return Json(rpc_error(id, codes::UNAUTHORIZED, msg)),
            };
            match call_tool(&token, &session, req.params).await {
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

fn require_session(headers: &HeaderMap) -> Result<(String, SessionInfo), String> {
    let token = headers
        .get(SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("missing {SESSION_HEADER} header"))?;
    let session = super::session_info(token)
        .ok_or_else(|| "unknown or expired browser session token".to_string())?;
    Ok((token.to_string(), session))
}

// ── Tools ────────────────────────────────────────────────────────────────────

fn tool_descriptors() -> Value {
    let no_args = json!({ "type": "object", "properties": {} });
    let mut tools = legacy_tool_descriptors();
    if let Some(list) = tools.as_array_mut() {
        list.extend(whitelist_tool_descriptors(&no_args));
    }
    tools
}

fn legacy_tool_descriptors() -> Value {
    let no_args = json!({ "type": "object", "properties": {} });
    json!([
        {
            "name": "browser_status",
            "description": "Bridge + backend status: which backend is available (embedded webview, paired Chrome extension, or none), the origins this session may reach, and (when attached) the current tab URL/title. Call this FIRST to confirm the browser is reachable.",
            "inputSchema": no_args
        },
        {
            "name": "browser_navigate",
            "description": "Navigate the current tab to a URL. Only origins this session is allowed to reach are accepted — a whitelisted, enabled origin, or the approved test origin. Everything else is refused with a code and a hint.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Absolute http(s) URL. Omit to open the session's approved target URL." },
                    "tab": { "type": "number", "description": "Tab to act on. Omit for the current tab." }
                }
            }
        },
        {
            "name": "browser_snapshot",
            "description": "Accessibility-tree snapshot of the current page — roles, names, values, element refs. Prefer this over screenshots for inspecting structure and finding elements to interact with. Long snapshots are truncated and say so.",
            "inputSchema": no_args
        },
        {
            "name": "browser_click",
            "description": "Click an element, located by ref, CSS selector, or its visible text (provide at least one).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ref": { "type": "string", "description": "Element ref from the last browser_snapshot." },
                    "selector": { "type": "string", "description": "CSS selector of the element to click." },
                    "text": { "type": "string", "description": "Visible text of the element to click (exact or close match)." },
                    "tab": { "type": "number", "description": "Tab to act on. Omit for the current tab." }
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
                    "submit": { "type": "boolean", "description": "Press Enter / submit the form after typing (default false)." },
                    "tab": { "type": "number", "description": "Tab to act on. Omit for the current tab." }
                },
                "required": ["selector", "text"]
            }
        },
        {
            "name": "browser_screenshot",
            "description": "Screenshot of the visible viewport of the current tab (PNG). Use for visual verification a DOM snapshot can't answer (styling, layout, rendering).",
            "inputSchema": no_args
        },
        {
            "name": "browser_console",
            "description": "Console messages buffered since the tab was attached (errors, warnings, logs) plus failed network requests when available.",
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
            "description": "Release the tab (detach the debugger, stop console capture). Call when the work is done.",
            "inputSchema": no_args
        }
    ])
}

fn whitelist_tool_descriptors(no_args: &Value) -> Vec<Value> {
    vec![
        json!({
            "name": "browser_tabs",
            "description": "List the open tabs: id, url, title, origin, which is focused, and which principal holds each tab's lease. Call this before acting on a tab you did not open.",
            "inputSchema": no_args
        }),
        json!({
            "name": "browser_select",
            "description": "Choose an option in a <select>, located by ref or CSS selector.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ref": { "type": "string", "description": "Element ref from the last browser_snapshot." },
                    "selector": { "type": "string", "description": "CSS selector of the select element." },
                    "value": { "type": "string", "description": "Option value (or visible label) to choose." },
                    "tab": { "type": "number" }
                },
                "required": ["value"]
            }
        }),
        json!({
            "name": "browser_submit",
            "description": "Submit a form, located by ref or CSS selector. A write: it goes to the operator unless the page's own manifest proves it reversible and internal.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ref": { "type": "string" },
                    "selector": { "type": "string", "description": "CSS selector of the form." },
                    "tab": { "type": "number" }
                }
            }
        }),
        json!({
            "name": "browser_page_tools",
            "description": "List the tools the current page declares for itself (WebMCP native or polyfill), with each tool's declared reversibility, side effects, and the class the gate derived. A page that declares none reads as zero tools — use the generic hands instead.",
            "inputSchema": no_args
        }),
        json!({
            "name": "browser_call_page_tool",
            "description": "Call one of the tools browser_page_tools listed, by name, with its arguments. The gate re-derives the class from the page's manifest: reversible + non-external side effects run; everything else goes to the operator.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Tool name exactly as browser_page_tools reported it." },
                    "arguments": { "type": "object", "description": "Arguments object for that tool." },
                    "tab": { "type": "number" }
                },
                "required": ["name"]
            }
        }),
        json!({
            "name": "browser_login",
            "description": "Log in to the current origin using the credential the operator bound to it in Browser > Whitelist. Personas fills the fields — you never see and never need the values. Always goes to the operator for a decision.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab": { "type": "number" }
                }
            }
        }),
        json!({
            "name": "browser_request_site",
            "description": "Ask the operator to add an origin to the Whitelist, with a one-line reason. This is how you unblock yourself THROUGH the operator after an origin_not_allowed refusal — file it once and continue with other work; do not resend it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "origin": { "type": "string", "description": "scheme://host[:port] you need." },
                    "reason": { "type": "string", "description": "One line: what you need it for." }
                },
                "required": ["origin", "reason"]
            }
        }),
    ]
}

fn text_result(text: impl Into<String>) -> Value {
    json!({ "content": [ { "type": "text", "text": text.into() } ], "isError": false })
}

fn error_result(text: impl Into<String>) -> Value {
    json!({ "content": [ { "type": "text", "text": text.into() } ], "isError": true })
}

/// A refusal, as the agent receives it: the closed vocabulary plus its hint,
/// serialised as JSON. Never a driver string — see the module note.
fn refusal_result(refusal: Refusal) -> Value {
    let body = serde_json::to_string(&refusal).unwrap_or_else(|_| {
        // Refusal is a plain struct of owned strings, so this is unreachable;
        // degrading to the code itself still leaves the agent something
        // actionable, which is the property that matters.
        format!("{{\"reason\":\"{:?}\"}}", refusal.reason)
    });
    error_result(body)
}

/// Honest truncation: a read that does not fit says how much it is showing.
fn cap_text(text: String) -> String {
    if text.chars().count() <= SNAPSHOT_CAP_CHARS {
        return text;
    }
    let total = text.chars().count();
    let head: String = text.chars().take(SNAPSHOT_CAP_CHARS).collect();
    format!("{head}\n\n(showing {SNAPSHOT_CAP_CHARS} of {total})")
}

// ── The gate ─────────────────────────────────────────────────────────────────

/// Build the action vocabulary entry for a tool name. `None` = not a tool
/// this bridge serves.
fn action_for(name: &str, args: &Value) -> Option<Action> {
    let a = args.clone();
    Some(match name {
        "browser_status" => Action::Status,
        "browser_navigate" => Action::Navigate(a),
        "browser_snapshot" => Action::Snapshot(a),
        "browser_click" => Action::Click(a),
        "browser_type" => Action::Type(a),
        "browser_select" => Action::Select(a),
        "browser_submit" => Action::Submit(a),
        "browser_screenshot" => Action::Screenshot(a),
        "browser_console" => Action::Console(a),
        "browser_wait_for" => Action::WaitFor(a),
        "browser_tabs" => Action::Tabs,
        "browser_page_tools" => Action::PageTools(a),
        "browser_call_page_tool" => Action::CallPageTool(a),
        "browser_login" => Action::Login(a),
        "browser_detach" => Action::Detach,
        _ => return None,
    })
}

fn tab_arg(args: &Value) -> Option<u32> {
    args.get("tab")
        .and_then(|v| v.as_u64())
        .and_then(|n| u32::try_from(n).ok())
}

/// Which origin this call is decided against.
///
/// Navigation names its own; everything else acts on where the session
/// already is. A Whitelist session that has not navigated has no origin to
/// decide against, and saying so (with the next command in the hint) is the
/// honest answer — guessing one would be the gate choosing a target for the
/// model.
fn call_origin(session: &SessionInfo, name: &str, args: &Value) -> Result<String, Refusal> {
    if name == "browser_navigate" {
        let url = match args.get("url").and_then(|v| v.as_str()) {
            Some(u) if !u.trim().is_empty() => u.trim().to_string(),
            _ => session.target_url.clone(),
        };
        return super::origin_of(&url).map_err(|e| {
            Refusal::new(RefusalCode::ValidatorFailed)
                .with_hint(format!("{e}; pass an absolute http(s) URL"))
        });
    }
    if let Some(origin) = session.current_origin.clone() {
        return Ok(origin);
    }
    match &session.allow {
        AllowPolicy::Pinned(origin) => Ok(origin.clone()),
        AllowPolicy::Whitelist => Err(Refusal::new(RefusalCode::OriginNotAllowed).with_hint(
            "this session has not opened a page yet; call browser_navigate with a whitelisted origin first",
        )),
    }
}

/// The class a page tool carries, from the manifest fields the caller echoed
/// back. Absent fields mean the page did not prove anything, and unproven is
/// `GATED` — the manifest is untrusted input, so silence is never consent.
fn declared_page_tool_class(args: &Value) -> ToolClass {
    let reversible = args
        .get("reversible")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let side_effects = args
        .get("side_effects")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_value(Value::String(s.to_string())).ok())
        .unwrap_or(personas_core::models::BrowserSideEffects::External);
    policy::derive_page_tool_class(reversible, side_effects)
}

/// Run rules 1-5 for one call and return the class that stands.
fn gate(
    token: &str,
    session: &SessionInfo,
    name: &str,
    args: &Value,
    action: &Action,
) -> Result<(String, ToolClass), Refusal> {
    let origin = call_origin(session, name, args)?;

    // Rules 1-2 (navigation only; check_tool re-checks them for the rest).
    if name == "browser_navigate" {
        policy::check_navigation(&session.allow, &origin, &session.principal)?;
    }

    // Rule 3.
    let derived = match name {
        "browser_call_page_tool" => Some(declared_page_tool_class(args)),
        _ => None,
    };
    let class = policy::check_tool(&session.allow, &origin, name, action.effect(), derived)?;

    // Rule 4.
    policy::charge_budget(token, &origin)?;

    // Rule 5.
    if let Some(tab) = tab_arg(args) {
        policy::check_lease(tab, &session.principal)?;
    }

    if name == "browser_navigate" {
        super::set_session_origin(token, &origin);
    }
    Ok((origin, class))
}

/// Does a `GATED` class stop this call in WP1?
///
/// For a Whitelist session, yes: the approval it needs is the operator's and
/// WP3 builds it, so the honest answer today is `pending_approval` with a
/// hint that says not to resend. For the browser-test lane the decision
/// already happened — the operator approved `run_browser_test` for this
/// origin — so its writes run, exactly as they did in Phase 1.
fn approval_hold(session: &SessionInfo, class: ToolClass, name: &str) -> Option<Refusal> {
    if class != ToolClass::Gated || matches!(session.allow, AllowPolicy::Pinned(_)) {
        return None;
    }
    Some(
        Refusal::new(RefusalCode::PendingApproval).with_hint(format!(
            "`{name}` is a gated write; it is filed for the operator's decision on the orb. Do not resend it — continue with reads or other work."
        )),
    )
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

async fn call_tool(
    token: &str,
    session: &SessionInfo,
    params: Value,
) -> Result<Value, (i32, String)> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or((codes::INVALID_PARAMS, "missing tool name".to_string()))?
        .to_string();
    let mut args = params.get("arguments").cloned().unwrap_or(json!({}));

    // `browser_status` answers even with no backend — that's its job, and it
    // is the tool the hint of every NoBackend refusal points at.
    if name == "browser_status" {
        return Ok(status_result(session).await);
    }

    // A write that only the operator can authorise. WP3 files the approval;
    // WP1 answers honestly that it is not wired rather than pretending.
    if name == "browser_request_site" || name == "browser_login" {
        return Ok(refusal_result(pending_write_refusal(&name, &args)));
    }

    let Some(action) = action_for(&name, &args) else {
        return Err((codes::METHOD_NOT_FOUND, format!("unknown tool `{name}`")));
    };

    if name == "browser_click"
        && args.get("selector").and_then(|v| v.as_str()).is_none()
        && args.get("text").and_then(|v| v.as_str()).is_none()
        && args.get("ref").and_then(|v| v.as_str()).is_none()
    {
        return Err((
            codes::INVALID_PARAMS,
            "browser_click needs `ref`, `selector` or `text`".to_string(),
        ));
    }

    let (origin, class) = match gate(token, session, &name, &args, &action) {
        Ok(v) => v,
        Err(refusal) => return Ok(refusal_result(refusal)),
    };
    if let Some(hold) = approval_hold(session, class, &name) {
        return Ok(refusal_result(hold.with_origin(origin)));
    }

    // Navigation is normalised to the URL the gate actually approved, so the
    // backend cannot be handed something the gate did not read.
    if name == "browser_navigate" {
        let url = match args.get("url").and_then(|v| v.as_str()) {
            Some(u) if !u.trim().is_empty() => u.trim().to_string(),
            _ => session.target_url.clone(),
        };
        args = json!({ "url": url });
    }

    // WHO is acting travels with the action. The gate above ran rules 1-5 for
    // the call it can see; the backend re-runs rule 1 for the navigations it
    // causes itself (a redirect, a `window.open`, a page rewriting its own
    // location) against this, never against a principal of its own choosing.
    let ctx = backend::CallContext {
        principal: session.principal.clone(),
        policy: session.allow.clone(),
    };
    dispatch(&name, args, action, &ctx).await
}

/// Send the action to whichever backend can take it.
///
/// Order: a registered backend (the embedded webview, then the extension —
/// `backend::preferred_backend`), then the Phase 1 relay for the tools the
/// paired extension already implements, then `NoBackend`.
async fn dispatch(
    name: &str,
    args: Value,
    action: Action,
    ctx: &backend::CallContext,
) -> Result<Value, (i32, String)> {
    let tab = tab_arg(&args);

    if let Some(b) = backend::preferred_backend() {
        return Ok(match b.call(tab, action, ctx).await {
            Ok(outcome) => outcome_result(name, outcome.output),
            Err(refusal) => refusal_result(refusal),
        });
    }

    if !super::extension_connected() || !RELAY_TOOLS.contains(&name) {
        return Ok(refusal_result(Refusal::new(RefusalCode::NoBackend)));
    }

    let result = relay_or_tool_error(name, args.clone(), relay_timeout(name, &args)).await;

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

/// The tools the paired Chrome extension implements. The Whitelist vocabulary
/// (tabs, select, submit, page tools) reaches it only once a backend is
/// registered for it — routing a name the extension does not know would
/// produce a driver error string, which is exactly what the refusal
/// vocabulary exists to prevent.
const RELAY_TOOLS: [&str; 8] = [
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_screenshot",
    "browser_console",
    "browser_wait_for",
    "browser_detach",
];

fn relay_timeout(name: &str, args: &Value) -> Duration {
    match name {
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
    }
}

fn outcome_result(name: &str, output: Value) -> Value {
    if name == "browser_screenshot" {
        if let Some(data) = output.get("data").and_then(|v| v.as_str()) {
            let mime = output
                .get("mimeType")
                .and_then(|v| v.as_str())
                .unwrap_or("image/png");
            return json!({
                "content": [ { "type": "image", "data": data, "mimeType": mime } ],
                "isError": false
            });
        }
    }
    let text = match output {
        Value::String(s) => s,
        other => serde_json::to_string_pretty(&other).unwrap_or_else(|_| other.to_string()),
    };
    text_result(cap_text(text))
}

fn pending_write_refusal(name: &str, args: &Value) -> Refusal {
    let refusal = Refusal::new(RefusalCode::PendingApproval);
    if name == "browser_request_site" {
        let origin = args
            .get("origin")
            .and_then(|v| v.as_str())
            .unwrap_or("that origin");
        return refusal.with_origin(origin).with_hint(format!(
            "the request for {origin} is the operator's to decide, on the orb or under Browser > Whitelist. Do not resend it — continue with other work."
        ));
    }
    refusal.with_hint(
        "browser_login is executed by Personas with the credential the operator bound to this origin, after their decision. Do not resend it, and never ask the user for the values.",
    )
}

/// Status answers with the policy context the agent needs to plan, whether or
/// not a backend is up.
async fn status_result(session: &SessionInfo) -> Value {
    let backend_kind = backend::preferred_backend().map(|b| b.kind());
    let reach = match &session.allow {
        AllowPolicy::Pinned(origin) => json!({ "mode": "pinned", "origin": origin }),
        AllowPolicy::Whitelist => json!({ "mode": "whitelist" }),
    };

    if backend_kind.is_none() && !super::extension_connected() {
        let mut refusal = Refusal::new(RefusalCode::NoBackend);
        if let AllowPolicy::Pinned(origin) = &session.allow {
            refusal = refusal.with_origin(origin);
        }
        return refusal_result(refusal);
    }

    let mut merged = json!({
        "connected": true,
        "backend": backend_kind.map(|k| serde_json::to_value(k).unwrap_or(Value::Null)),
        "principal": session.principal.as_wire(),
        "reach": reach,
        "current_origin": session.current_origin,
    });

    if backend_kind.is_none() {
        let envelope = relay_or_tool_error("browser_status", json!({}), RELAY_TIMEOUT).await;
        if let (Some(obj), Some(ext)) = (
            merged.as_object_mut(),
            envelope.get("__relay_ok").and_then(|v| v.as_object()),
        ) {
            for (k, v) in ext {
                obj.entry(k.clone()).or_insert(v.clone());
            }
        }
    }
    text_result(serde_json::to_string_pretty(&merged).unwrap_or_default())
}

/// Relay a frame; encode success as `{"__relay_ok": <result>}` and failure as
/// `{"__relay_err": "<msg>"}` so callers can post-process before flattening.
async fn relay_or_tool_error(method: &str, args: Value, timeout: Duration) -> Value {
    match super::relay::send_command(method, args, timeout).await {
        Ok(result) => json!({ "__relay_ok": result }),
        Err(e) => json!({ "__relay_err": e }),
    }
}

/// Flatten a relay envelope into the MCP text/error content shape. A relay
/// failure is normalised to the `timeout` code rather than surfaced as the
/// driver's own text (agent-actionable-errors).
fn unwrap_relay(envelope: Value) -> Value {
    if let Some(err) = envelope.get("__relay_err").and_then(|v| v.as_str()) {
        tracing::debug!(error = %err, "browser bridge: relay command failed");
        return refusal_result(Refusal::new(RefusalCode::Timeout));
    }
    let payload = envelope.get("__relay_ok").cloned().unwrap_or(Value::Null);
    let text = match payload {
        Value::String(s) => s,
        other => serde_json::to_string_pretty(&other).unwrap_or_else(|_| other.to_string()),
    };
    text_result(cap_text(text))
}

#[cfg(test)]
mod tests {
    use super::super::backend::{Effect, Principal};
    use super::*;

    fn whitelist_session(current: Option<&str>) -> SessionInfo {
        SessionInfo {
            principal: Principal::Operator,
            allow: AllowPolicy::Whitelist,
            target_url: String::new(),
            current_origin: current.map(|s| s.to_string()),
        }
    }

    fn pinned_session() -> SessionInfo {
        SessionInfo {
            principal: Principal::Athena,
            allow: AllowPolicy::Pinned("http://localhost:8765".into()),
            target_url: "http://localhost:8765/app".into(),
            current_origin: None,
        }
    }

    #[test]
    fn every_descriptor_is_a_tool_the_bridge_can_route() {
        let tools = tool_descriptors();
        let names: Vec<String> = tools
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();
        for expected in [
            "browser_tabs",
            "browser_select",
            "browser_submit",
            "browser_page_tools",
            "browser_call_page_tool",
            "browser_login",
            "browser_request_site",
        ] {
            assert!(names.contains(&expected.to_string()), "missing {expected}");
        }
        for name in &names {
            // The two operator-decided writes are answered before dispatch.
            if name == "browser_request_site" {
                continue;
            }
            assert!(
                action_for(name, &json!({})).is_some(),
                "{name} has a descriptor but no action"
            );
        }
        // Every descriptor carries a description an agent can act on.
        for t in tools.as_array().unwrap() {
            assert!(t["description"].as_str().unwrap().len() > 40);
        }
    }

    #[test]
    fn a_refusal_is_json_never_a_driver_string() {
        let result = refusal_result(
            Refusal::new(RefusalCode::OriginNotAllowed).with_origin("https://evil.example"),
        );
        assert_eq!(result["isError"], true);
        let body: Refusal =
            serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(body.reason, RefusalCode::OriginNotAllowed);
        assert_eq!(body.origin.as_deref(), Some("https://evil.example"));
        assert!(
            !body.hint.is_empty(),
            "a refusal always names the next step"
        );
    }

    #[test]
    fn a_relay_failure_is_normalised_to_the_closed_vocabulary() {
        let out = unwrap_relay(json!({ "__relay_err": "chrome.debugger: Cannot attach" }));
        assert_eq!(out["isError"], true);
        let text = out["content"][0]["text"].as_str().unwrap();
        assert!(
            !text.contains("chrome.debugger"),
            "the driver's own text must never reach the model: {text}"
        );
        let body: Refusal = serde_json::from_str(text).unwrap();
        assert_eq!(body.reason, RefusalCode::Timeout);
    }

    #[test]
    fn reads_are_capped_and_say_so() {
        let short = "x".repeat(10);
        assert_eq!(cap_text(short.clone()), short);
        let long = "y".repeat(SNAPSHOT_CAP_CHARS + 500);
        let capped = cap_text(long);
        assert!(capped.contains(&format!(
            "(showing {SNAPSHOT_CAP_CHARS} of {})",
            SNAPSHOT_CAP_CHARS + 500
        )));
    }

    #[test]
    fn a_whitelist_session_that_has_not_navigated_is_told_what_to_call() {
        let err =
            call_origin(&whitelist_session(None), "browser_snapshot", &json!({})).unwrap_err();
        assert_eq!(err.reason, RefusalCode::OriginNotAllowed);
        assert!(err.hint.contains("browser_navigate"));

        assert_eq!(
            call_origin(
                &whitelist_session(Some("https://app.example")),
                "browser_snapshot",
                &json!({})
            )
            .unwrap(),
            "https://app.example"
        );
        // The pinned lane never needs one — its origin IS the session.
        assert_eq!(
            call_origin(&pinned_session(), "browser_snapshot", &json!({})).unwrap(),
            "http://localhost:8765"
        );
        // Navigation names its own, and a non-URL is a validator failure.
        assert_eq!(
            call_origin(
                &pinned_session(),
                "browser_navigate",
                &json!({ "url": "http://localhost:8765/x" })
            )
            .unwrap(),
            "http://localhost:8765"
        );
        assert_eq!(
            call_origin(
                &pinned_session(),
                "browser_navigate",
                &json!({ "url": "file:///etc/passwd" })
            )
            .unwrap_err()
            .reason,
            RefusalCode::ValidatorFailed
        );
    }

    /// REGRESSION: the browser-test lane's writes were approved when the run
    /// was approved. Holding them again would break `run_browser_test`.
    #[test]
    fn only_a_whitelist_session_holds_a_gated_write() {
        assert!(approval_hold(&pinned_session(), ToolClass::Gated, "browser_click").is_none());
        let held = approval_hold(&whitelist_session(None), ToolClass::Gated, "browser_click")
            .expect("a whitelist write is held");
        assert_eq!(held.reason, RefusalCode::PendingApproval);
        assert!(held.hint.contains("Do not resend"));
        assert!(approval_hold(
            &whitelist_session(None),
            ToolClass::Read,
            "browser_snapshot"
        )
        .is_none());
        assert!(
            approval_hold(&whitelist_session(None), ToolClass::Auto, "browser_click").is_none()
        );
    }

    #[test]
    fn a_page_tool_is_auto_only_when_the_page_proved_it() {
        assert_eq!(
            declared_page_tool_class(&json!({ "reversible": true, "side_effects": "internal" })),
            ToolClass::Auto
        );
        assert_eq!(
            declared_page_tool_class(&json!({ "reversible": true, "side_effects": "external" })),
            ToolClass::Gated
        );
        // Silence is never consent.
        assert_eq!(declared_page_tool_class(&json!({})), ToolClass::Gated);
        assert_eq!(
            declared_page_tool_class(&json!({ "reversible": true })),
            ToolClass::Gated
        );
    }

    #[test]
    fn the_write_pair_answers_with_pending_approval_and_a_do_not_resend_hint() {
        let r = pending_write_refusal(
            "browser_request_site",
            &json!({ "origin": "https://new.example", "reason": "invoices" }),
        );
        assert_eq!(r.reason, RefusalCode::PendingApproval);
        assert_eq!(r.origin.as_deref(), Some("https://new.example"));
        assert!(r.hint.contains("Do not resend"));

        let r = pending_write_refusal("browser_login", &json!({}));
        assert_eq!(r.reason, RefusalCode::PendingApproval);
        assert!(r.hint.contains("never ask the user"));
    }

    #[test]
    fn effects_are_what_the_gate_decides_on() {
        assert_eq!(
            action_for("browser_submit", &json!({})).unwrap().effect(),
            Effect::Write
        );
        assert_eq!(
            action_for("browser_tabs", &json!({})).unwrap().effect(),
            Effect::Meta
        );
        assert_eq!(
            action_for("browser_page_tools", &json!({}))
                .unwrap()
                .effect(),
            Effect::Read
        );
        assert!(action_for("rm_rf", &json!({})).is_none());
    }
}
