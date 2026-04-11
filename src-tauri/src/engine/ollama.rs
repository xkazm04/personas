//! Native Ollama execution path.
//!
//! Calls Ollama's HTTP API directly instead of spawning a CLI process.
//! This enables local model execution for personas without requiring
//! Claude Code CLI (which only supports Anthropic models).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::db::DbPool;
use crate::db::models::Persona;
use crate::db::repos::execution::executions as exec_repo;
use crate::engine::event_registry::event_name;
use crate::engine::types::{
    ExecutionOutputEvent, ExecutionResult, ExecutionState, ExecutionStatusEvent, ModelProfile,
};

// ── Ollama API types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatChunk {
    message: Option<ChunkMessage>,
    done: bool,
    #[serde(default)]
    total_duration: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ChunkMessage {
    #[serde(default)]
    content: String,
}

// ── System prompt assembly ───────────────────────────────────────────────

fn build_system_prompt(persona: &Persona) -> String {
    let mut prompt = String::with_capacity(2048);

    prompt.push_str(&format!("You are {}.", persona.name));
    if let Some(ref desc) = persona.description {
        if !desc.is_empty() {
            prompt.push(' ');
            prompt.push_str(desc);
        }
    }
    prompt.push_str("\n\n");

    if !persona.system_prompt.is_empty() {
        prompt.push_str(&persona.system_prompt);
        prompt.push_str("\n\n");
    }

    prompt.push_str("Be concise and direct. If the task requires structured output (JSON, code, lists), use the appropriate format.\n");
    prompt
}

// ── Main execution function ──────────────────────────────────────────────

/// Execute a persona using the native Ollama HTTP path.
///
/// Bypasses Claude Code CLI entirely — makes a streaming HTTP request to
/// the Ollama server and emits `EXECUTION_OUTPUT` events for each chunk.
pub async fn execute_native(
    app: &AppHandle,
    pool: &DbPool,
    execution_id: &str,
    persona: &Persona,
    model_profile: &ModelProfile,
    prompt_text: &str,
    cancelled: &Arc<AtomicBool>,
) -> ExecutionResult {
    let start_time = Instant::now();

    let base_url = model_profile
        .base_url
        .as_deref()
        .unwrap_or("http://localhost:11434");
    let model = model_profile
        .model
        .as_deref()
        .unwrap_or("gemma4");
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

    // Announce start
    emit_output(app, execution_id, &format!(
        "[OLLAMA] Using model '{}' at {}", model, base_url
    ));

    // Build request
    let body = ChatRequest {
        model: model.to_string(),
        messages: vec![
            Message { role: "system".to_string(), content: build_system_prompt(persona) },
            Message { role: "user".to_string(), content: prompt_text.to_string() },
        ],
        stream: true,
    };

    // Send request
    let client = Client::new();
    let response = match client.post(&url).json(&body).send().await {
        Ok(resp) if resp.status().is_success() => resp,
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let err = format!("Ollama API error ({}): {}", status, &text[..text.len().min(200)]);
            return fail(app, pool, execution_id, &err, &start_time).await;
        }
        Err(e) => {
            let err = format!("Cannot connect to Ollama at {}: {}", url, e);
            return fail(app, pool, execution_id, &err, &start_time).await;
        }
    };

    // Stream response line-by-line (Ollama sends newline-delimited JSON)
    let mut full_output = String::new();
    let mut eval_tokens: u64 = 0;
    let mut prompt_tokens: u64 = 0;

    let mut byte_buf = Vec::new();
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;

    while let Some(chunk_result) = stream.next().await {
        if cancelled.load(Ordering::Relaxed) {
            emit_output(app, execution_id, "[CANCELLED] Execution cancelled");
            let duration_ms = start_time.elapsed().as_millis() as u64;
            let _ = exec_repo::update_status(pool, execution_id, crate::db::models::UpdateExecutionStatus {
                status: ExecutionState::Cancelled,
                duration_ms: Some(duration_ms as i64),
                ..Default::default()
            });
            return ExecutionResult {
                success: false,
                error: Some("Cancelled".into()),
                output: if full_output.is_empty() { None } else { Some(full_output) },
                duration_ms,
                model_used: Some(model.to_string()),
                ..default_result()
            };
        }

        match chunk_result {
            Ok(bytes) => {
                byte_buf.extend_from_slice(&bytes);

                // Process complete lines
                while let Some(newline_pos) = byte_buf.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = byte_buf.drain(..=newline_pos).collect();
                    let line_str = String::from_utf8_lossy(&line);
                    let trimmed = line_str.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    if let Ok(chunk) = serde_json::from_str::<ChatChunk>(trimmed) {
                        if let Some(ref msg) = chunk.message {
                            if !msg.content.is_empty() {
                                full_output.push_str(&msg.content);
                                emit_output(app, execution_id, &msg.content);
                            }
                        }
                        if chunk.done {
                            eval_tokens = chunk.eval_count.unwrap_or(0);
                            prompt_tokens = chunk.prompt_eval_count.unwrap_or(0);
                        }
                    }
                }
            }
            Err(e) => {
                let err = format!("Stream error: {}", e);
                return fail(app, pool, execution_id, &err, &start_time).await;
            }
        }
    }

    // Success
    let duration_ms = start_time.elapsed().as_millis() as u64;

    let _ = app.emit(event_name::EXECUTION_STATUS, ExecutionStatusEvent {
        execution_id: execution_id.to_string(),
        status: ExecutionState::Completed,
        error: None,
        duration_ms: Some(duration_ms),
        cost_usd: Some(0.0),
    });

    let _ = exec_repo::update_status(pool, execution_id, crate::db::models::UpdateExecutionStatus {
        status: ExecutionState::Completed,
        output_data: if full_output.is_empty() { None } else { Some(full_output.clone()) },
        duration_ms: Some(duration_ms as i64),
        output_tokens: Some(eval_tokens as i64),
        input_tokens: Some(prompt_tokens as i64),
        cost_usd: Some(0.0),
        ..Default::default()
    });

    tracing::info!(
        execution_id, model, duration_ms, eval_tokens, prompt_tokens,
        output_len = full_output.len(),
        "[OLLAMA] Execution completed"
    );

    ExecutionResult {
        success: true,
        output: Some(full_output),
        duration_ms,
        model_used: Some(model.to_string()),
        input_tokens: prompt_tokens,
        output_tokens: eval_tokens,
        cost_usd: 0.0,
        ..default_result()
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn emit_output(app: &AppHandle, execution_id: &str, line: &str) {
    let _ = app.emit(event_name::EXECUTION_OUTPUT, ExecutionOutputEvent {
        execution_id: execution_id.to_string(),
        line: line.to_string(),
    });
}

async fn fail(
    app: &AppHandle,
    pool: &DbPool,
    execution_id: &str,
    error_msg: &str,
    start_time: &Instant,
) -> ExecutionResult {
    let duration_ms = start_time.elapsed().as_millis() as u64;

    emit_output(app, execution_id, &format!("[OLLAMA ERROR] {}", error_msg));
    let _ = app.emit(event_name::EXECUTION_STATUS, ExecutionStatusEvent {
        execution_id: execution_id.to_string(),
        status: ExecutionState::Failed,
        error: Some(error_msg.to_string()),
        duration_ms: Some(duration_ms),
        cost_usd: None,
    });
    let _ = exec_repo::update_status(pool, execution_id, crate::db::models::UpdateExecutionStatus {
        status: ExecutionState::Failed,
        error_message: Some(error_msg.to_string()),
        duration_ms: Some(duration_ms as i64),
        ..Default::default()
    });

    ExecutionResult {
        success: false,
        error: Some(error_msg.to_string()),
        duration_ms,
        ..default_result()
    }
}

fn default_result() -> ExecutionResult {
    ExecutionResult {
        success: false,
        output: None,
        error: None,
        session_limit_reached: false,
        log_file_path: None,
        claude_session_id: None,
        duration_ms: 0,
        execution_flows: None,
        model_used: None,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0.0,
        tool_steps: None,
        trace_id: None,
        execution_config: None,
        log_truncated: false,
    }
}
