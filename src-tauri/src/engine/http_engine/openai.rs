//! OpenAI-compatible streaming text path (no tools) — the Phase-1 inference.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::engine::events::ExecutionEventEmitter;
use crate::engine::types::{ExecutionResult, ExecutionState};

use super::config::{price_per_million, HTTP_TIMEOUT_SECS};
use super::events::{emit_output, emit_status, fail};

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

/// Stream a single user turn and emit output deltas. The assembled `prompt_text`
/// is the full instruction (mirroring the CLI stdin); sent as one user message.
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_streaming(
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
    let body = ChatRequest {
        model: model.to_string(),
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

    let response = match client.post(&url).bearer_auth(api_key).json(&body).send().await {
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
            return fail(emitter, execution_id, &format!("Cannot reach {provider} at {url}: {e}"), start_time);
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
                model_used: Some(model.to_string()),
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
    let cost_usd = match price_per_million(model) {
        Some((pin, pout)) => (prompt_tokens as f64 / 1e6) * pin + (completion_tokens as f64 / 1e6) * pout,
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
        model_used: Some(model.to_string()),
        input_tokens: prompt_tokens,
        output_tokens: completion_tokens,
        cost_usd,
        ..Default::default()
    }
}
