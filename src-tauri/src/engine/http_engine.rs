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
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::db::models::PersonaToolDefinition;
use crate::engine::event_registry::event_name;
use crate::engine::events::{emit_to, ExecutionEventEmitter};
use crate::engine::types::{
    ExecutionOutputEvent, ExecutionResult, ExecutionState, ExecutionStatusEvent, ModelProfile,
};

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
    tools: &[PersonaToolDefinition],
    cancelled: &Arc<AtomicBool>,
    start_time: Instant,
) -> ExecutionResult {
    let provider = model_profile.provider.as_deref().unwrap_or("qwen");
    let model = model_profile.model.as_deref().unwrap_or(DEFAULT_MODEL).to_string();

    // Phase-1 guard: remote path is text-only. Tool-using capabilities must run
    // on the Claude engine until the tool-execution bridge exists.
    if !tools.is_empty() {
        return fail(
            emitter,
            execution_id,
            &format!(
                "Remote provider '{provider}' is text-only in Phase 1, but persona \
                 '{}' has {} tool(s). Assign tool-using capabilities to the Claude engine.",
                persona_name,
                tools.len()
            ),
            start_time,
        );
    }

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

    tracing::info!(execution_id, provider, model, %base_url, "[http_engine] starting remote inference");

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
            &[],
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
}
