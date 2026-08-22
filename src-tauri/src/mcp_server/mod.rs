//! MCP Server implementation for Personas.
//!
//! Implements JSON-RPC 2.0 with MCP protocol methods:
//! - initialize / notifications/initialized (legacy handshake, ≤2025-11-25 clients)
//! - server/discover (MCP 2026-07-28 stateless discovery)
//! - tools/list
//! - tools/call
//!
//! This server is dual-era per the 2026-07-28 versioning rules: legacy clients
//! open with `initialize`; modern clients skip the handshake entirely and MAY
//! probe `server/discover`. Requests were never gated on a completed handshake
//! here, so modern per-request `_meta` clients work unchanged.

pub mod auth;
pub mod db;
pub mod install;
pub mod tools;
mod vault;

#[cfg(test)]
mod auth_tests;
#[cfg(test)]
mod obsidian_vault_tests;

use serde_json::{json, Value};

/// Process a single JSON-RPC request and return a response (or None for notifications).
///
/// `auth_token` is the capability token supplied to the binary (via
/// `PERSONAS_MCP_TOKEN` or `--token`). `initialize` / `tools/list` are answered
/// without it so a client can complete the handshake; `tools/call` is gated by
/// [`auth::authorize_tool_call`] against the shared `external_api_keys` registry.
pub fn handle_jsonrpc(line: &str, pool: &db::McpDbPool, auth_token: Option<&str>) -> Option<Value> {
    let request: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => {
            return Some(json!({
                "jsonrpc": "2.0",
                "error": { "code": -32700, "message": "Parse error" },
                "id": null
            }));
        }
    };

    let id = request.get("id").cloned();
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(json!({}));

    match method {
        "initialize" => {
            let result = json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": { "listChanged": false }
                },
                "serverInfo": {
                    "name": "personas-mcp",
                    "version": env!("CARGO_PKG_VERSION")
                }
            });
            Some(json!({ "jsonrpc": "2.0", "result": result, "id": id }))
        }
        "notifications/initialized" => None, // notification, no response
        // MCP 2026-07-28: mandatory stateless discovery. Also serves as the
        // dual-era probe for modern clients (Claude Code CLI as it migrates).
        "server/discover" => {
            let result = json!({
                "resultType": "complete",
                "supportedVersions": ["2026-07-28", "2024-11-05"],
                "capabilities": {
                    "tools": { "listChanged": false }
                },
                "instructions": "Personas desktop control surface: list, inspect, and execute AI personas. Call personas_execute to trigger a run and poll with the returned execution id.",
                "_meta": {
                    "io.modelcontextprotocol/serverInfo": {
                        "name": "personas-mcp",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                },
                "ttlMs": 3_600_000,
                "cacheScope": "private"
            });
            Some(json!({ "jsonrpc": "2.0", "result": result, "id": id }))
        }
        "tools/list" => {
            let tool_list = tools::list_tools(pool);
            // ttlMs/cacheScope: 2026-07-28 CacheableResult freshness hint. The
            // tool set depends on DB state, so advertise a modest 60s window.
            Some(json!({
                "jsonrpc": "2.0",
                "result": { "tools": tool_list, "ttlMs": 60_000, "cacheScope": "private" },
                "id": id
            }))
        }
        "tools/call" => {
            let tool_name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");

            // Gate every tool invocation on a valid capability token. The
            // handshake methods above stay open so the client can render this
            // error in its tool UI rather than failing opaquely.
            if let auth::AuthDecision::Deny(reason) =
                auth::authorize_tool_call(pool, auth_token, tool_name)
            {
                return Some(json!({
                    "jsonrpc": "2.0",
                    "error": { "code": -32001, "message": reason },
                    "id": id
                }));
            }

            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

            let result = tools::call_tool(tool_name, &arguments, pool);
            Some(json!({ "jsonrpc": "2.0", "result": result, "id": id }))
        }
        _ => Some(json!({
            "jsonrpc": "2.0",
            "error": { "code": -32601, "message": format!("Method not found: {method}") },
            "id": id
        })),
    }
}
