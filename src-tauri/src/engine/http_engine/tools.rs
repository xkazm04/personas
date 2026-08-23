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

use super::config::{
    cost_of, tool_allowed, HTTP_GET_MAX_BYTES, HTTP_GET_TIMEOUT_SECS, HTTP_TIMEOUT_SECS,
    MAX_TOOL_ITERS,
};
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
    // TWO clients, because there are two trust contexts and they must not share
    // one. Until 2026-08-22 this function built one client for the chat endpoint
    // and then handed the same client to `execute_builtin_tool` — so the
    // model-supplied `http_get` URL inherited a client with the system resolver
    // and reqwest's default ten-hop redirect follow.
    //
    // 1. `chat_client` — talks to `base_url`, the user's BYOM endpoint. Same
    //    deliberate choice as `openai.rs`: it must be able to reach a LOCAL
    //    inference server, so no SSRF-safe resolver, and 600 s is the tool
    //    loop's real deadline.
    let chat_client = match Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return fail(
                emitter,
                execution_id,
                &format!("HTTP client init failed: {e}"),
                start_time,
            )
        }
    };
    // 2. `tool_client` — executes `http_get`, whose URL comes from the MODEL
    //    (scheme + host + path), which in turn reads third-party text through
    //    its own tools. That is an untrusted target and the response body is fed
    //    back into the conversation, so it egresses to the provider on the next
    //    iteration. SSRF-safe resolver (blocks DNS rebinding at connect time)
    //    plus per-hop redirect re-validation (blocks a `Location:` carrying a
    //    raw private IP, which skips DNS entirely).
    let tool_client = crate::engine::url_safety::build_ssrf_safe_client(Duration::from_secs(
        HTTP_GET_TIMEOUT_SECS,
    ));

    // Tool catalog = safe built-ins + the remote-safe MCP tools (run in-process
    // via mcp_server::tools::call_tool against a read connection to the same DB).
    let mcp_pool = mcp_server::db::open_pool(&default_data_dir().join("personas.db")).ok();
    let connectors_on = mcp_pool
        .as_ref()
        .map(connector_tools_enabled)
        .unwrap_or(false);
    let mut schemas = builtin_tool_schemas();
    if let Some(mcp_pool) = mcp_pool.as_ref() {
        for t in mcp_server::tools::list_tools(mcp_pool) {
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
            emit_status(
                emitter,
                execution_id,
                ExecutionState::Cancelled,
                Some("Cancelled"),
                duration_ms,
                None,
            );
            return ExecutionResult {
                success: false,
                error: Some("Cancelled".into()),
                duration_ms,
                model_used: Some(model.to_string()),
                ..Default::default()
            };
        }

        let body = json!({ "model": model, "messages": messages, "tools": tools_value, "tool_choice": "auto" });
        let resp = match chat_client
            .post(&url)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                return fail(
                    emitter,
                    execution_id,
                    &format!(
                        "{provider} API error ({status}): {}",
                        crate::utils::text::truncate_on_char_boundary(&text, 300)
                    ),
                    start_time,
                );
            }
            Err(e) => {
                return fail(
                    emitter,
                    execution_id,
                    &format!("Cannot reach {provider}: {e}"),
                    start_time,
                )
            }
        };
        let data: Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => {
                return fail(
                    emitter,
                    execution_id,
                    &format!("Invalid JSON from {provider}: {e}"),
                    start_time,
                )
            }
        };
        if let Some(u) = data.get("usage") {
            in_tok += u.get("prompt_tokens").and_then(Value::as_u64).unwrap_or(0);
            out_tok += u
                .get("completion_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0);
        }

        let msg = data["choices"][0]["message"].clone();
        let tool_calls = msg
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if tool_calls.is_empty() {
            let content = msg
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            for line in content.split('\n') {
                emit_output(emitter, execution_id, line);
            }
            let duration_ms = start_time.elapsed().as_millis() as u64;
            let cost_usd = cost_of(model, in_tok, out_tok);
            emit_status(
                emitter,
                execution_id,
                ExecutionState::Completed,
                None,
                duration_ms,
                Some(cost_usd),
            );
            tracing::info!(
                execution_id,
                provider,
                model,
                iters = iter + 1,
                in_tok,
                out_tok,
                cost_usd,
                "[http_engine] tool loop completed"
            );
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
            let id = call
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let name = call["function"]["name"].as_str().unwrap_or("").to_string();
            let args_str = call["function"]["arguments"].as_str().unwrap_or("{}");
            let args: Value = serde_json::from_str(args_str).unwrap_or_else(|_| json!({}));
            emit_output(
                emitter,
                execution_id,
                &format!(
                    "🔧 {name}({})",
                    args.to_string().chars().take(120).collect::<String>()
                ),
            );
            let result = if name == "get_current_time" || name == "http_get" {
                execute_builtin_tool(&tool_client, &name, &args).await
            } else if tool_allowed(&name, connectors_on) {
                match &mcp_pool {
                    Some(pool) => mcp_call_text(&name, &args, pool),
                    None => format!("error: tool '{name}' backend unavailable"),
                }
            } else {
                format!("error: tool '{name}' is not available to the remote engine")
            };
            emit_output(
                emitter,
                execution_id,
                &format!("   ↳ {}", result.chars().take(200).collect::<String>()),
            );
            messages.push(json!({ "role": "tool", "tool_call_id": id, "content": result }));
        }
    }

    fail(
        emitter,
        execution_id,
        &format!("Tool loop exceeded {MAX_TOOL_ITERS} iterations without a final answer"),
        start_time,
    )
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
        format!(
            "error: {}",
            if text.is_empty() {
                "tool failed"
            } else {
                text.as_str()
            }
        )
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

/// GET a public URL with SSRF egress guards.
///
/// Three layers, because no one of them covers the others:
///
/// 1. **https-only** here — stricter than `validate_url_safety`, which permits
///    plain http. The tool's contract says public https.
/// 2. **`validate_url_safety`** — the pre-flight check covering everything DNS
///    never sees: an IP literal (no lookup happens, so no resolver can veto it),
///    a non-http scheme, a cloud-metadata hostname that fails to resolve locally
///    but resolves inside a cloud network, and fail-closed on DNS error.
/// 3. **the client itself** (`build_ssrf_safe_client`, built by the caller) —
///    a connect-time resolver that closes the DNS-rebinding window between this
///    check and the request, plus a redirect policy that re-validates EVERY hop.
///    Layer 3 is what this function was missing: it checked hop 1, threw the
///    resolved addresses away without pinning them, and then issued the request
///    through a client that would follow ten redirects with the system resolver.
async fn http_get_guarded(client: &Client, raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("invalid url: {e}"))?;
    if url.scheme() != "https" {
        return Err("only https:// URLs are allowed".into());
    }

    // Blocking DNS inside; keep it off the async runtime. The handle is bound
    // and its outcome inspected — a detached validation task would report
    // neither a panic nor a verdict.
    let raw_owned = raw.to_string();
    let verdict = tokio::task::spawn_blocking(move || {
        crate::engine::url_safety::validate_url_safety(&raw_owned)
    })
    .await
    .map_err(|e| format!("url validation task failed: {e}"))?;
    verdict?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read failed: {e}"))?;
    let slice = &bytes[..bytes.len().min(HTTP_GET_MAX_BYTES)];
    let truncated = if bytes.len() > HTTP_GET_MAX_BYTES {
        " …[truncated]"
    } else {
        ""
    };
    Ok(format!(
        "HTTP {status}\n{}{truncated}",
        String::from_utf8_lossy(slice)
    ))
}

// The private-IP predicate that used to live here (`is_blocked_ip`) was deleted
// on 2026-08-22. It was a third, weaker fork of the same idea: it omitted CGNAT
// (`100.64.0.0/10`), the RFC 5737 documentation ranges, and the cloud-metadata
// hostname list, all of which `personas_core::url_safety::is_private_ip` covers.
// Its two call sites (here and `engine::platforms::zapier`) now go through
// `url_safety` directly.

#[cfg(test)]
mod tests {
    use super::*;

    /// The client the tool loop hands to `http_get`. Same construction as
    /// production — this IS `build_ssrf_safe_client`, not a re-typed copy.
    /// The falsification arm's deadline. Named so it is not a bare literal at
    /// the site that applies it.
    const FALSIFICATION_DEADLINE: Duration = Duration::from_secs(3);

    fn tool_client() -> Client {
        crate::engine::url_safety::build_ssrf_safe_client(Duration::from_secs(
            HTTP_GET_TIMEOUT_SECS,
        ))
    }

    /// An IP literal never reaches a DNS resolver, so the client's resolver
    /// cannot veto it. `validate_url_safety` is the only layer that sees it.
    #[tokio::test]
    async fn blocks_ip_literal_targets() {
        let client = tool_client();
        for url in [
            "https://127.0.0.1:9420/webhook",
            "https://169.254.169.254/latest/meta-data/",
            "https://10.0.0.1/admin",
            "https://192.168.1.1/",
            "https://[::1]/admin",
            "https://0.0.0.0/",
            // CGNAT + documentation ranges — the deleted local fork missed both.
            "https://100.64.0.1/",
            "https://192.0.2.1/",
        ] {
            let err = match http_get_guarded(&client, url).await {
                Ok(body) => panic!("{url} must be blocked, but it returned: {body}"),
                Err(e) => e,
            };
            assert!(
                err.contains("Blocked") || err.contains("blocked"),
                "{url} rejected for the wrong reason: {err}"
            );
        }
    }

    /// Cloud-metadata + internal hostnames are blocked by NAME, before any
    /// lookup — they may fail to resolve on a dev box and resolve fine inside a
    /// cloud network, which is the whole bypass.
    #[tokio::test]
    async fn blocks_internal_hostnames_without_resolving() {
        let client = tool_client();
        for url in [
            "https://metadata.google.internal/computeMetadata/v1/",
            "https://metadata.goog/computeMetadata/v1/",
            "https://anything.internal/secret",
            "https://service.local/api",
        ] {
            assert!(
                http_get_guarded(&client, url).await.is_err(),
                "{url} must be blocked"
            );
        }
    }

    #[tokio::test]
    async fn enforces_https_only() {
        let client = tool_client();
        for url in [
            "http://example.com/",
            "file:///etc/passwd",
            "gopher://evil.tld/",
        ] {
            assert!(
                http_get_guarded(&client, url).await.is_err(),
                "{url} must be blocked"
            );
        }
    }

    /// A redirect whose `Location` is a private address must be refused.
    ///
    /// Driven through the PRODUCTION policy (`ssrf_redirect_policy`) paired with
    /// a `resolve` override so the first hop can be a local test server — the
    /// SSRF-safe resolver would otherwise refuse to reach it, and there is no
    /// public address to bind to in a hermetic test.
    #[tokio::test]
    async fn redirect_to_a_private_address_is_refused() {
        let (addr, _srv) =
            redirect_server(|_| "http://169.254.169.254/latest/meta-data/".to_string()).await;

        let guarded = Client::builder()
            .redirect(crate::engine::url_safety::ssrf_redirect_policy())
            .resolve("first-hop.test", addr)
            .build()
            .expect("client");
        let err = guarded
            .get(format!("http://first-hop.test:{}/start", addr.port()))
            .send()
            .await
            .expect_err("the redirect hop must be refused");
        assert!(
            error_chain(&err).contains("private/internal address"),
            "refused for the wrong reason: {}",
            error_chain(&err)
        );

        // Falsification, in-test: the PRE-FIX client — no redirect policy, which
        // is exactly what `tools.rs` built and handed to `http_get` — does NOT
        // refuse this hop. It will still fail on a dev box (nothing answers at
        // 169.254.169.254), but it fails while FOLLOWING, which is the whole
        // difference.
        let unguarded = Client::builder()
            .resolve("first-hop.test", addr)
            .build()
            .expect("client");
        let followed = unguarded
            .get(format!("http://first-hop.test:{}/start", addr.port()))
            .timeout(FALSIFICATION_DEADLINE)
            .send()
            .await;
        if let Err(e) = followed {
            assert!(
                !error_chain(&e).contains("private/internal address"),
                "the unguarded client must not refuse the hop; it must follow it: {}",
                error_chain(&e)
            );
        }
    }

    /// Flatten an error and its `source` chain — a reqwest redirect refusal
    /// carries the policy's message one level down, not in its own `Display`.
    fn error_chain(err: &(dyn std::error::Error + 'static)) -> String {
        let mut out = err.to_string();
        let mut src = err.source();
        while let Some(e) = src {
            out.push_str(" | ");
            out.push_str(&e.to_string());
            src = e.source();
        }
        out
    }

    /// The other half of the same policy: a PUBLIC redirect target is still
    /// followed. A guard that blocks everything is not a fix.
    #[tokio::test]
    async fn redirect_to_a_public_address_is_followed() {
        // The port must be in the `Location` itself: reqwest's `.resolve()`
        // override supplies an IP only and ignores the port it is given, so a
        // portless second hop would be dialled on 80.
        let (addr, _srv) =
            redirect_server(|port| format!("http://public-hop.test:{port}/ok")).await;

        let guarded = Client::builder()
            .redirect(crate::engine::url_safety::ssrf_redirect_policy())
            .resolve("first-hop.test", addr)
            .resolve("public-hop.test", addr)
            .build()
            .expect("client");
        let resp = guarded
            .get(format!("http://first-hop.test:{}/start", addr.port()))
            .send()
            .await
            .expect("a public redirect target must still be followed");
        assert!(resp.status().is_success(), "status: {}", resp.status());
        assert_eq!(resp.text().await.unwrap_or_default(), "ok");
    }

    /// Minimal HTTP/1.1 server: `/start` 302s to the `Location` built from its
    /// own bound port, anything else 200s with `ok`. Returns its address and the
    /// task handle (dropping it stops it).
    ///
    /// Deliberately ONE task serving connections sequentially: a redirect chain
    /// is sequential anyway, and spawning per connection would detach tasks
    /// whose panics nothing could report.
    async fn redirect_server(
        make_location: impl FnOnce(u16) -> String,
    ) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        let location = make_location(addr.port());
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = [0u8; 2048];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let resp = if req.starts_with("GET /start") {
                    format!(
                        "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                } else {
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                        .to_string()
                };
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.flush().await;
            }
        });
        (addr, handle)
    }
}
