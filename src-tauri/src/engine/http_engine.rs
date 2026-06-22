//! Remote HTTP inference path — Phase 1 of the split engine architecture.
//!
//! Runs a persona's inference against a remote, OpenAI-compatible HTTP LLM
//! provider (Qwen via the DashScope compatible-mode API) instead of spawning the
//! local Claude CLI. Orchestration (Mode A/B, team memory, goals) stays local;
//! only the model call is remote.
//!
//! # Phase 1 is text-only
//! Tools / MCP / connector credentials execute as local child processes of the
//! Claude CLI (`cli_mcp_config.rs`); a remote model cannot reach them. So this
//! path refuses any persona/capability that carries tools (the caller routes
//! tool-using capabilities to the Claude engine). The tool-execution bridge is
//! a later phase.
//!
//! # Routing
//! Dispatched from `runner::run_execution` when the per-capability
//! `ModelProfile.provider` is a remote HTTP provider (see
//! [`is_remote_http_provider`]). Routing on the provider string avoids touching
//! the `EngineKind` enum (and its ts-rs bindings / compile guard).
//!
//! # Contract with the runner
//! Like the CLI path, this only emits `EXECUTION_OUTPUT` / `EXECUTION_STATUS`
//! events and returns an [`ExecutionResult`]; the caller
//! (`engine::handle_execution_result`) persists the terminal DB row. It must NOT
//! write terminal status itself.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::engine::event_registry::event_name;
use crate::engine::events::{emit_to, ExecutionEventEmitter};
use crate::engine::types::{
    ExecutionOutputEvent, ExecutionResult, ExecutionState, ExecutionStatusEvent, ModelProfile,
};
use crate::daemon::lock::default_data_dir;
use crate::mcp_server;

/// Default DashScope (international) OpenAI-compatible endpoint.
pub const DEFAULT_BASE_URL: &str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
/// Default model when a capability/persona doesn't pin one.
pub const DEFAULT_MODEL: &str = "qwen3-coder-plus";
/// Generous timeout — LLM generations (esp. reasoning models) are slow; the
/// outer `run_execution_with_ceiling` still caps total wall time.
const HTTP_TIMEOUT_SECS: u64 = 600;

/// Whether a `ModelProfile.provider` string selects this remote HTTP path.
/// Phase 1: Qwen / DashScope only. Adding OpenAI/Gemini later is a one-line
/// extension here plus a price-table entry.
pub fn is_remote_http_provider(provider: &str) -> bool {
    matches!(provider.trim().to_ascii_lowercase().as_str(), "qwen" | "dashscope")
}

// ── Per-1M-token USD pricing (verified Sep-2025 SKUs) ─────────────────────
// Unknown models -> cost stamped 0 (configure when the price is confirmed).
fn price_per_million(model: &str) -> Option<(f64, f64)> {
    match model {
        "qwen3-coder-plus" => Some((0.65, 3.25)),
        "qwen3-max" => Some((0.78, 3.90)),
        _ => None,
    }
}

// ── OpenAI-compatible chat-completions wire types ─────────────────────────

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct StreamOptions {
    include_usage: bool,
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    #[serde(default)]
    delta: Delta,
}

#[derive(Debug, Default, Deserialize)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Usage {
    #[serde(default)]
    prompt_tokens: u64,
    #[serde(default)]
    completion_tokens: u64,
}

// ── Secret / config resolution ────────────────────────────────────────────

#[cfg(feature = "desktop")]
fn load_keyring_qwen_key() -> Option<String> {
    let v = keyring::Entry::new("personas-desktop", "qwen-api-key")
        .ok()?
        .get_password()
        .ok()?;
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

#[cfg(not(feature = "desktop"))]
fn load_keyring_qwen_key() -> Option<String> {
    None
}

/// Store the Qwen API key in the OS keyring. (no-op on mobile)
#[cfg(feature = "desktop")]
pub fn store_qwen_api_key(api_key: &str) -> Result<(), String> {
    keyring::Entry::new("personas-desktop", "qwen-api-key")
        .map_err(|e| format!("keyring entry error: {e}"))?
        .set_password(api_key)
        .map_err(|e| format!("failed to store qwen api key: {e}"))
}

#[cfg(not(feature = "desktop"))]
pub fn store_qwen_api_key(_api_key: &str) -> Result<(), String> {
    Ok(())
}

/// Remove the stored Qwen API key from the OS keyring. (no-op on mobile)
#[cfg(feature = "desktop")]
pub fn clear_qwen_api_key() {
    if let Ok(entry) = keyring::Entry::new("personas-desktop", "qwen-api-key") {
        let _ = entry.delete_credential();
    }
}

#[cfg(not(feature = "desktop"))]
pub fn clear_qwen_api_key() {}

/// Whether a Qwen API key is configured (keyring or env) — never reveals it.
pub fn qwen_key_configured() -> bool {
    load_keyring_qwen_key().is_some()
        || std::env::var("QWEN_API_KEY").is_ok_and(|v| !v.is_empty())
        || std::env::var("DASHSCOPE_API_KEY").is_ok_and(|v| !v.is_empty())
}

/// Resolve the provider API key: profile override → OS keyring → env.
fn resolve_api_key(model_profile: &ModelProfile) -> Option<String> {
    if let Some(t) = model_profile.auth_token.as_deref() {
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    if let Some(k) = load_keyring_qwen_key() {
        return Some(k);
    }
    for var in ["QWEN_API_KEY", "DASHSCOPE_API_KEY"] {
        if let Ok(v) = std::env::var(var) {
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

// ── Main entry ─────────────────────────────────────────────────────────────

/// Execute a persona via the remote HTTP provider. Emits live output + a single
/// terminal status event, and returns the `ExecutionResult` for the caller to
/// persist. Never writes terminal DB status itself.
#[allow(clippy::too_many_arguments)]
pub async fn run_http_execution(
    emitter: &dyn ExecutionEventEmitter,
    execution_id: &str,
    persona_name: &str,
    model_profile: &ModelProfile,
    prompt_text: &str,
    tools_enabled: bool,
    cancelled: &Arc<AtomicBool>,
    start_time: Instant,
) -> ExecutionResult {
    let provider = model_profile.provider.as_deref().unwrap_or("qwen");
    let model = model_profile.model.as_deref().unwrap_or(DEFAULT_MODEL).to_string();

    let api_key = match resolve_api_key(model_profile) {
        Some(k) => k,
        None => {
            return fail(
                emitter,
                execution_id,
                &format!(
                    "No API key for remote provider '{provider}'. Set it in the keyring \
                     (qwen-api-key) or QWEN_API_KEY/DASHSCOPE_API_KEY."
                ),
                start_time,
            );
        }
    };

    let base_url = model_profile
        .base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_BASE_URL)
        .trim_end_matches('/')
        .to_string();
    let url = format!("{base_url}/chat/completions");

    tracing::info!(execution_id, provider, model, persona = persona_name, %base_url, tools_enabled, "[http_engine] starting remote inference");

    // Phase 3: tool-using personas run the tool-calling loop (with the safe
    // built-in toolset). Pure-text personas keep the Phase-1 streaming path.
    if tools_enabled {
        return run_tool_loop(
            emitter, execution_id, provider, &model, &base_url, &api_key, prompt_text, cancelled, start_time,
        )
        .await;
    }

    let body = ChatRequest {
        model: model.clone(),
        // The assembled prompt_text is the full instruction (system + protocol +
        // input), mirroring what the CLI receives on stdin. Send as one user turn.
        messages: vec![Message {
            role: "user".to_string(),
            content: prompt_text.to_string(),
        }],
        stream: true,
        stream_options: Some(StreamOptions { include_usage: true }),
    };

    let client = match Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(e) => return fail(emitter, execution_id, &format!("HTTP client init failed: {e}"), start_time),
    };

    let response = match client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp,
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return fail(
                emitter,
                execution_id,
                &format!("{provider} API error ({status}): {}", &text[..text.len().min(300)]),
                start_time,
            );
        }
        Err(e) => {
            return fail(
                emitter,
                execution_id,
                &format!("Cannot reach {provider} at {url}: {e}"),
                start_time,
            );
        }
    };

    // ── Stream SSE: lines like `data: {json}` and a terminal `data: [DONE]` ──
    let mut full_output = String::new();
    let mut prompt_tokens: u64 = 0;
    let mut completion_tokens: u64 = 0;
    let mut byte_buf: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        if cancelled.load(Ordering::Relaxed) {
            let duration_ms = start_time.elapsed().as_millis() as u64;
            emit_status(emitter, execution_id, ExecutionState::Cancelled, Some("Cancelled"), duration_ms, None);
            return ExecutionResult {
                success: false,
                error: Some("Cancelled".into()),
                output: (!full_output.is_empty()).then(|| full_output.clone()),
                duration_ms,
                model_used: Some(model.clone()),
                ..Default::default()
            };
        }

        let bytes = match chunk_result {
            Ok(b) => b,
            Err(e) => return fail(emitter, execution_id, &format!("Stream error: {e}"), start_time),
        };
        byte_buf.extend_from_slice(&bytes);

        while let Some(nl) = byte_buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = byte_buf.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) {
                if let Some(choice) = chunk.choices.first() {
                    if let Some(ref delta) = choice.delta.content {
                        if !delta.is_empty() {
                            full_output.push_str(delta);
                            emit_output(emitter, execution_id, delta);
                        }
                    }
                }
                if let Some(usage) = chunk.usage {
                    prompt_tokens = usage.prompt_tokens;
                    completion_tokens = usage.completion_tokens;
                }
            }
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;
    let cost_usd = match price_per_million(&model) {
        Some((pin, pout)) => {
            (prompt_tokens as f64 / 1e6) * pin + (completion_tokens as f64 / 1e6) * pout
        }
        None => 0.0,
    };

    emit_status(emitter, execution_id, ExecutionState::Completed, None, duration_ms, Some(cost_usd));

    tracing::info!(
        execution_id,
        provider,
        model,
        duration_ms,
        prompt_tokens,
        completion_tokens,
        cost_usd,
        output_len = full_output.len(),
        "[http_engine] completed"
    );

    ExecutionResult {
        success: true,
        output: (!full_output.is_empty()).then_some(full_output),
        duration_ms,
        model_used: Some(model),
        input_tokens: prompt_tokens,
        output_tokens: completion_tokens,
        cost_usd,
        ..Default::default()
    }
}

// ── Tool-calling loop (Phase 3 bridge) ─────────────────────────────────────

/// Max model⇄tool round-trips before we give up (prevents runaway loops).
const MAX_TOOL_ITERS: usize = 6;
/// Cap on a single http_get response fed back to the model.
const HTTP_GET_MAX_BYTES: usize = 16 * 1024;

/// MCP tools safe to expose to a REMOTE model: read-only DB / knowledge /
/// context queries with no external side effects. Write/exec/connector tools
/// (personas_execute, *_write_*, drive_*, gmail_*/gdrive_*/gcalendar_*,
/// llm_delegate) are deliberately withheld — a prompt-injected remote model must
/// not be able to trigger them, and connector tools also need the local
/// credential bridge (Phase 3b-connectors).
const REMOTE_SAFE_MCP_TOOLS: &[&str] = &[
    "personas_list", "personas_get", "personas_status", "personas_result", "personas_health",
    "personas_knowledge_search", "personas_search_executions", "personas_list_templates",
    "context_list_groups", "context_search_by_keyword", "context_get_by_file_path", "context_neighbors",
    "arena_list_models", "arena_list_runs", "arena_run_status", "arena_get_results",
    "obsidian_vault_search",
    // Bounded write: lets a running persona post its own summary to Messages.
    "post_message",
];

/// Connector MCP tools (Gmail/Drive/Calendar) — opt-in via the
/// `qwen_connector_tools` setting (default OFF). They route through the desktop
/// credential proxy on :9420 (credentials stay local; only args + results cross
/// to the model). Off by default because enabling sends connector RESULTS (e.g.
/// email content) to the remote provider — a per-team data-residency decision.
const CONNECTOR_TOOLS: &[&str] = &[
    "gmail_list_messages", "gmail_get_message",
    "gdrive_list_files", "gdrive_get_file",
    "gcalendar_list_events",
];

/// Whether a tool name may be exposed to the remote engine.
fn tool_allowed(name: &str, connectors_on: bool) -> bool {
    REMOTE_SAFE_MCP_TOOLS.contains(&name) || (connectors_on && CONNECTOR_TOOLS.contains(&name))
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

fn cost_of(model: &str, in_tok: u64, out_tok: u64) -> f64 {
    match price_per_million(model) {
        Some((pin, pout)) => (in_tok as f64 / 1e6) * pin + (out_tok as f64 / 1e6) * pout,
        None => 0.0,
    }
}

/// Multi-turn tool loop: send prompt + built-in tool schemas; when the model
/// returns `tool_calls`, execute them LOCALLY and feed results back, looping
/// until a final answer or the iteration cap. Non-streaming (tool-call deltas
/// are awkward to stream). Phase 3a exposes a fixed SAFE built-in toolset;
/// per-persona connector/MCP tools are bridged in Phase 3b (see design doc).
#[allow(clippy::too_many_arguments)]
async fn run_tool_loop(
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

/// Safe built-in tools exposed to remote (Qwen) tool-using personas in Phase 3a.
/// Credential-free and side-effect-light; per-persona connector tools are Phase 3b.
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
/// — it enforces and documents the egress boundary for the Phase 3a PoC.
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

// ── Event helpers ────────────────────────────────────────────────────────

fn emit_output(emitter: &dyn ExecutionEventEmitter, execution_id: &str, line: &str) {
    emit_to(
        emitter,
        event_name::EXECUTION_OUTPUT,
        &ExecutionOutputEvent {
            execution_id: execution_id.to_string(),
            line: line.to_string(),
        },
    );
}

fn emit_status(
    emitter: &dyn ExecutionEventEmitter,
    execution_id: &str,
    status: ExecutionState,
    error: Option<&str>,
    duration_ms: u64,
    cost_usd: Option<f64>,
) {
    emit_to(
        emitter,
        event_name::EXECUTION_STATUS,
        &ExecutionStatusEvent {
            execution_id: execution_id.to_string(),
            status,
            error: error.map(str::to_string),
            duration_ms: Some(duration_ms),
            cost_usd,
        },
    );
}

fn fail(
    emitter: &dyn ExecutionEventEmitter,
    execution_id: &str,
    error_msg: &str,
    start_time: Instant,
) -> ExecutionResult {
    let duration_ms = start_time.elapsed().as_millis() as u64;
    tracing::warn!(execution_id, error = error_msg, "[http_engine] failed");
    emit_status(emitter, execution_id, ExecutionState::Failed, Some(error_msg), duration_ms, None);
    ExecutionResult {
        success: false,
        error: Some(error_msg.to_string()),
        duration_ms,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_only_remote_providers() {
        assert!(is_remote_http_provider("qwen"));
        assert!(is_remote_http_provider("Qwen"));
        assert!(is_remote_http_provider("  dashscope  "));
        assert!(!is_remote_http_provider("claude"));
        assert!(!is_remote_http_provider("anthropic"));
        assert!(!is_remote_http_provider("ollama"));
        assert!(!is_remote_http_provider(""));
    }

    #[test]
    fn prices_known_models_only() {
        assert_eq!(price_per_million("qwen3-coder-plus"), Some((0.65, 3.25)));
        assert!(price_per_million("qwen3-max").is_some());
        assert_eq!(price_per_million("qwen3.7-plus"), None); // unverified SKU -> $0 stamp
        assert_eq!(price_per_million("unknown"), None);
    }

    #[test]
    fn connector_tools_gated_and_disjoint() {
        // Safe read-only MCP tools are always allowed.
        assert!(tool_allowed("personas_health", false));
        // Connector tools only when explicitly opted in.
        assert!(!tool_allowed("gmail_list_messages", false));
        assert!(tool_allowed("gmail_list_messages", true));
        // Write/exec tools are never exposed, even with connectors on.
        assert!(!tool_allowed("personas_execute", true));
        assert!(!tool_allowed("drive_write_text", true));
        // The safe and connector lists must not overlap.
        for t in CONNECTOR_TOOLS {
            assert!(!REMOTE_SAFE_MCP_TOOLS.contains(t), "{t} double-listed");
        }
    }

    /// Live end-to-end check against the real Qwen API. Ignored by default
    /// (needs a key + network). Run with:
    ///   QWEN_API_KEY=... cargo test --features desktop --lib http_engine -- --ignored
    #[tokio::test]
    #[ignore = "hits the live Qwen API; set QWEN_API_KEY/DASHSCOPE_API_KEY and run with --ignored"]
    async fn live_qwen_roundtrip() {
        use crate::engine::events::NoOpEmitter;

        let mp = ModelProfile {
            model: Some(DEFAULT_MODEL.to_string()),
            provider: Some("qwen".to_string()),
            base_url: None,
            auth_token: None,
            prompt_cache_policy: None,
            effort: None,
        };
        let emitter = NoOpEmitter::new();
        let cancelled = Arc::new(AtomicBool::new(false));

        let result = run_http_execution(
            &emitter,
            "live-test-exec",
            "Live Test",
            &mp,
            "Reply with exactly the single word: PONG",
            false, // text-only path
            &cancelled,
            Instant::now(),
        )
        .await;

        assert!(result.success, "expected success, got error: {:?}", result.error);
        let out = result.output.unwrap_or_default();
        assert!(!out.trim().is_empty(), "expected non-empty output");
        eprintln!(
            "[live_qwen_roundtrip] model={:?} cost=${:.6} duration={}ms output={}",
            result.model_used, result.cost_usd, result.duration_ms, out.trim()
        );
    }

    /// Live tool-calling loop (Phase 3): the model must call the built-in
    /// `get_current_time` tool and report the result. Ignored by default.
    ///   QWEN_API_KEY=... cargo test --features desktop --lib http_engine -- --ignored
    #[tokio::test]
    #[ignore = "hits the live Qwen API + does a tool-calling round-trip; run with --ignored"]
    async fn live_qwen_tool_loop() {
        use crate::engine::events::NoOpEmitter;

        let mp = ModelProfile {
            model: Some(DEFAULT_MODEL.to_string()),
            provider: Some("qwen".to_string()),
            base_url: None,
            auth_token: None,
            prompt_cache_policy: None,
            effort: None,
        };
        let emitter = NoOpEmitter::new();
        let cancelled = Arc::new(AtomicBool::new(false));

        let result = run_http_execution(
            &emitter,
            "live-tool-exec",
            "Tool Test",
            &mp,
            "What is the current UTC time? You MUST call the get_current_time tool, then state the time you got.",
            true, // tools enabled -> tool-calling loop
            &cancelled,
            Instant::now(),
        )
        .await;

        assert!(result.success, "expected success, got error: {:?}", result.error);
        let out = result.output.unwrap_or_default();
        assert!(!out.trim().is_empty(), "expected non-empty output");
        eprintln!(
            "[live_qwen_tool_loop] cost=${:.6} duration={}ms output={}",
            result.cost_usd, result.duration_ms, out.trim()
        );
    }

    /// Capturing emitter so the MCP test can assert which tool actually fired.
    struct CapturingEmitter {
        events: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
    }
    impl CapturingEmitter {
        fn new() -> Self {
            Self { events: std::sync::Mutex::new(Vec::new()) }
        }
        fn output_lines(&self) -> Vec<String> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter_map(|(_, p)| p.get("line").and_then(|v| v.as_str()).map(String::from))
                .collect()
        }
    }
    impl ExecutionEventEmitter for CapturingEmitter {
        fn emit_json(&self, event: &str, payload: serde_json::Value) {
            self.events.lock().unwrap().push((event.to_string(), payload));
        }
    }

    /// Live Phase-3b bridge: the model calls the in-process MCP tool
    /// `personas_health`; the desktop executes it against the local DB and feeds
    /// the result back. Requires the app DB to exist at the default data dir.
    ///   QWEN_API_KEY=... cargo test --features desktop --lib http_engine -- --ignored
    #[tokio::test]
    #[ignore = "hits live Qwen + calls an in-process MCP tool against the local DB; run with --ignored"]
    async fn live_qwen_mcp_tool() {
        let mp = ModelProfile {
            model: Some(DEFAULT_MODEL.to_string()),
            provider: Some("qwen".to_string()),
            base_url: None,
            auth_token: None,
            prompt_cache_policy: None,
            effort: None,
        };
        let cap = CapturingEmitter::new();
        let cancelled = Arc::new(AtomicBool::new(false));

        let result = run_http_execution(
            &cap,
            "live-mcp-exec",
            "MCP Test",
            &mp,
            "Call the personas_health tool and report how many personas exist. You MUST use the tool.",
            true,
            &cancelled,
            Instant::now(),
        )
        .await;

        let lines = cap.output_lines();
        eprintln!("[live_qwen_mcp_tool] success={} output:\n{}", result.success, lines.join("\n"));
        assert!(result.success, "expected success, got error: {:?}", result.error);
        assert!(
            lines.iter().any(|l| l.contains("personas_health")),
            "expected a personas_health tool call to fire; got lines: {lines:?}"
        );
    }
}
