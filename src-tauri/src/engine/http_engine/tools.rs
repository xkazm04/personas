//! Tool-calling loop (Phase 3 bridge) + safe built-in tools + in-process MCP
//! tool execution. The remote model requests a tool, the desktop runs it
//! locally, and the result is fed back until a final answer.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use reqwest::Client;
use serde_json::{json, Value};

use crate::daemon::lock::default_data_dir;
use crate::engine::events::ExecutionEventEmitter;
use crate::engine::types::{ExecutionResult, ExecutionState};
use crate::mcp_server;

use super::config::{cost_of, tool_allowed, HTTP_GET_MAX_BYTES, HTTP_TIMEOUT_SECS, MAX_TOOL_ITERS};
use super::events::{emit_output, emit_status, fail};

/// Multi-turn tool loop: send prompt + the allowed tool schemas; when the model
/// returns `tool_calls`, execute them LOCALLY and feed results back, looping
/// until a final answer or the iteration cap. Non-streaming (tool-call deltas
/// are awkward to stream).
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_tool_loop(
    emitter: &dyn ExecutionEventEmitter,
    execution_id: &str,
    provider: &str,
    model: &str,
    base_url: &str,
    api_key: &str,
    prompt_text: &str,
    cancelled: &Arc<AtomicBool>,
    start_time: Instant,
) -> ExecutionResult {
    let url = format!("{base_url}/chat/completions");
    let client = match Client::builder().timeout(Duration::from_secs(HTTP_TIMEOUT_SECS)).build() {
        Ok(c) => c,
        Err(e) => return fail(emitter, execution_id, &format!("HTTP client init failed: {e}"), start_time),
    };

    // Tool catalog = safe built-ins + the remote-safe MCP tools (run in-process
    // via mcp_server::tools::call_tool against a read connection to the same DB).
    let mcp_pool = mcp_server::db::open_pool(&default_data_dir().join("personas.db")).ok();
    let connectors_on = mcp_pool.as_ref().map(connector_tools_enabled).unwrap_or(false);
    let mut schemas = builtin_tool_schemas();
    if mcp_pool.is_some() {
        for t in mcp_server::tools::list_tools() {
            let name = t.get("name").and_then(Value::as_str).unwrap_or("");
            if tool_allowed(name, connectors_on) {
                schemas.push(json!({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": t.get("description").cloned().unwrap_or_else(|| json!("")),
                        "parameters": t.get("inputSchema").cloned().unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                    }
                }));
            }
        }
    }
    let tools_value = Value::Array(schemas);
    let mut messages: Vec<Value> = vec![json!({ "role": "user", "content": prompt_text })];
    let mut in_tok: u64 = 0;
    let mut out_tok: u64 = 0;

    for iter in 0..MAX_TOOL_ITERS {
        if cancelled.load(Ordering::Relaxed) {
            let duration_ms = start_time.elapsed().as_millis() as u64;
            emit_status(emitter, execution_id, ExecutionState::Cancelled, Some("Cancelled"), duration_ms, None);
            return ExecutionResult { success: false, error: Some("Cancelled".into()), duration_ms, model_used: Some(model.to_string()), ..Default::default() };
        }

        let body = json!({ "model": model, "messages": messages, "tools": tools_value, "tool_choice": "auto" });
        let resp = match client.post(&url).bearer_auth(api_key).json(&body).send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                return fail(emitter, execution_id, &format!("{provider} API error ({status}): {}", &text[..text.len().min(300)]), start_time);
            }
            Err(e) => return fail(emitter, execution_id, &format!("Cannot reach {provider}: {e}"), start_time),
        };
        let data: Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return fail(emitter, execution_id, &format!("Invalid JSON from {provider}: {e}"), start_time),
        };
        if let Some(u) = data.get("usage") {
            in_tok += u.get("prompt_tokens").and_then(Value::as_u64).unwrap_or(0);
            out_tok += u.get("completion_tokens").and_then(Value::as_u64).unwrap_or(0);
        }

        let msg = data["choices"][0]["message"].clone();
        let tool_calls = msg.get("tool_calls").and_then(Value::as_array).cloned().unwrap_or_default();

        if tool_calls.is_empty() {
            let content = msg.get("content").and_then(Value::as_str).unwrap_or("").to_string();
            for line in content.split('\n') {
                emit_output(emitter, execution_id, line);
            }
            let duration_ms = start_time.elapsed().as_millis() as u64;
            let cost_usd = cost_of(model, in_tok, out_tok);
            emit_status(emitter, execution_id, ExecutionState::Completed, None, duration_ms, Some(cost_usd));
            tracing::info!(execution_id, provider, model, iters = iter + 1, in_tok, out_tok, cost_usd, "[http_engine] tool loop completed");
            return ExecutionResult {
                success: true,
                output: (!content.is_empty()).then_some(content),
                duration_ms,
                model_used: Some(model.to_string()),
                input_tokens: in_tok,
                output_tokens: out_tok,
                cost_usd,
                ..Default::default()
            };
        }

        // Append the assistant turn (carrying tool_calls), then execute each
        // tool locally and feed the result back as a `tool` message.
        messages.push(msg.clone());
        for call in &tool_calls {
            let id = call.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let name = call["function"]["name"].as_str().unwrap_or("").to_string();
            let args_str = call["function"]["arguments"].as_str().unwrap_or("{}");
            let args: Value = serde_json::from_str(args_str).unwrap_or_else(|_| json!({}));
            emit_output(emitter, execution_id, &format!("🔧 {name}({})", args.to_string().chars().take(120).collect::<String>()));
            let result = if name == "get_current_time" || name == "http_get" {
                execute_builtin_tool(&client, &name, &args).await
            } else if tool_allowed(&name, connectors_on) {
                match &mcp_pool {
                    Some(pool) => mcp_call_text(&name, &args, pool),
                    None => format!("error: tool '{name}' backend unavailable"),
                }
            } else {
                format!("error: tool '{name}' is not available to the remote engine")
            };
            emit_output(emitter, execution_id, &format!("   ↳ {}", result.chars().take(200).collect::<String>()));
            messages.push(json!({ "role": "tool", "tool_call_id": id, "content": result }));
        }
    }

    fail(emitter, execution_id, &format!("Tool loop exceeded {MAX_TOOL_ITERS} iterations without a final answer"), start_time)
}

/// Read the connector opt-in (default false) from app_settings via the MCP pool.
fn connector_tools_enabled(pool: &mcp_server::db::McpDbPool) -> bool {
    pool.get()
        .ok()
        .and_then(|c| {
            c.query_row(
                "SELECT value FROM app_settings WHERE key = 'qwen_connector_tools'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
        })
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

/// Safe built-in tools exposed to remote (Qwen) tool-using personas.
/// Credential-free and side-effect-light.
fn builtin_tool_schemas() -> Vec<Value> {
    vec![
        json!({ "type": "function", "function": {
            "name": "get_current_time",
            "description": "Get the current UTC date and time in ISO 8601 format.",
            "parameters": { "type": "object", "properties": {}, "required": [] }
        }}),
        json!({ "type": "function", "function": {
            "name": "http_get",
            "description": "Fetch the text body of a PUBLIC https:// URL via GET. Use for reading public web pages or public JSON APIs. Cannot reach private/internal/loopback addresses.",
            "parameters": { "type": "object", "properties": {
                "url": { "type": "string", "description": "An https:// URL" }
            }, "required": ["url"] }
        }}),
    ]
}

/// Invoke an in-process MCP tool and flatten its `{content:[{text}], isError}`
/// result to a plain string for the model.
fn mcp_call_text(name: &str, args: &Value, pool: &mcp_server::db::McpDbPool) -> String {
    let res = mcp_server::tools::call_tool(name, args, pool);
    let text = res["content"][0]["text"].as_str().unwrap_or("").to_string();
    if res["isError"].as_bool().unwrap_or(false) {
        format!("error: {}", if text.is_empty() { "tool failed" } else { text.as_str() })
    } else if text.is_empty() {
        "(empty result)".to_string()
    } else {
        text
    }
}

async fn execute_builtin_tool(client: &Client, name: &str, args: &Value) -> String {
    match name {
        "get_current_time" => Utc::now().to_rfc3339(),
        "http_get" => {
            let url = args.get("url").and_then(Value::as_str).unwrap_or("");
            match http_get_guarded(client, url).await {
                Ok(body) => body,
                Err(e) => format!("error: {e}"),
            }
        }
        other => format!("error: unknown tool '{other}'"),
    }
}

/// GET a public URL with SSRF egress guards: https-only, and the resolved host
/// must not map to a loopback / private / link-local / unspecified address.
/// Pragmatic guard (not full DNS-rebinding protection, since reqwest re-resolves)
/// — it enforces and documents the egress boundary.
async fn http_get_guarded(client: &Client, raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("invalid url: {e}"))?;
    if url.scheme() != "https" {
        return Err("only https:// URLs are allowed".into());
    }
    let host = url.host_str().ok_or_else(|| "missing host".to_string())?.to_string();
    let port = url.port_or_known_default().unwrap_or(443);

    // Resolve off the async runtime and reject internal targets.
    let host_for_resolve = host.clone();
    let addrs = tokio::task::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        (host_for_resolve.as_str(), port)
            .to_socket_addrs()
            .map(|it| it.map(|s| s.ip()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| format!("resolve task failed: {e}"))?
    .map_err(|e| format!("dns resolution failed: {e}"))?;

    if addrs.is_empty() {
        return Err("host did not resolve".into());
    }
    if addrs.iter().any(is_blocked_ip) {
        return Err("destination resolves to a private/internal address (blocked)".into());
    }

    let resp = client
        .get(url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| format!("read failed: {e}"))?;
    let slice = &bytes[..bytes.len().min(HTTP_GET_MAX_BYTES)];
    let truncated = if bytes.len() > HTTP_GET_MAX_BYTES { " …[truncated]" } else { "" };
    Ok(format!("HTTP {status}\n{}{truncated}", String::from_utf8_lossy(slice)))
}

fn is_blocked_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00 // fc00::/7 unique-local
        }
    }
}
