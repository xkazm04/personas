//! MCP Server implementation for Personas.
//!
//! Implements JSON-RPC 2.0 with MCP protocol methods:
//! - initialize / notifications/initialized
//! - tools/list
//! - tools/call

pub mod auth;
pub mod db;
pub mod install;
pub mod tools;
mod vault;

#[cfg(test)]
mod obsidian_vault_tests;
#[cfg(test)]
mod auth_tests;

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
        "tools/list" => {
            let tool_list = tools::list_tools(pool);
            Some(json!({ "jsonrpc": "2.0", "result": { "tools": tool_list }, "id": id }))
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
