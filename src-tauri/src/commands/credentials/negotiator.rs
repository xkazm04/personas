use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};

use crate::engine::credential_negotiator;
use crate::engine::prompt;
use crate::engine::types::StreamLineType;
use crate::error::AppError;
use crate::AppState;

use super::credential_design::{spawn_claude_and_collect, run_claude_prompt};

const NEGOTIATOR_MODEL: &str = "claude-sonnet-4-6";

// ── Event payloads ──────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct NegotiatorProgressEvent {
    negotiation_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct NegotiatorStatusEvent {
    negotiation_id: String,
    status: String,
    result: Option<serde_json::Value>,
    error: Option<String>,
}

// ── Commands ────────────────────────────────────────────────────

/// Start a credential negotiation — generates a step-by-step provisioning plan.
#[tauri::command]
pub async fn start_credential_negotiation(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    service_name: String,
    connector: serde_json::Value,
    field_keys: Vec<String>,
) -> Result<serde_json::Value, AppError> {
    let negotiation_prompt = credential_negotiator::build_negotiation_prompt(
        &service_name,
        &connector,
        &field_keys,
    );

    let cli_args = build_negotiator_cli_args();
    let negotiation_id = uuid::Uuid::new_v4().to_string();

    // Use the active_credential_design_id mutex to track active negotiation too
    // (only one credential operation at a time)
    let active_id = state.active_credential_design_id.clone();
    {
        let mut guard = active_id.lock().unwrap();
        *guard = Some(negotiation_id.clone());
    }

    let neg_id = negotiation_id.clone();

    tokio::spawn(async move {
        run_negotiation(NegotiationRunParams {
            app,
            negotiation_id: neg_id,
            prompt_text: negotiation_prompt,
            cli_args,
            active_id,
        })
        .await;
    });

    Ok(json!({ "negotiation_id": negotiation_id }))
}

/// Cancel an active credential negotiation.
#[tauri::command]
pub fn cancel_credential_negotiation(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let mut guard = state.active_credential_design_id.lock().unwrap();
    *guard = None;
    Ok(())
}

/// Get contextual help for a specific provisioning step.
#[tauri::command]
pub async fn get_negotiation_step_help(
    _state: State<'_, Arc<AppState>>,
    service_name: String,
    step_index: u32,
    step_title: String,
    user_question: String,
) -> Result<serde_json::Value, AppError> {
    let prompt_text = credential_negotiator::build_step_help_prompt(
        &service_name,
        step_index as usize,
        &step_title,
        &user_question,
    );

    let cli_args = build_negotiator_cli_args();
    let output_text = run_claude_prompt(prompt_text, &cli_args, 120, "Claude produced no output for step help")
        .await
        .map_err(AppError::Internal)?;

    let help_result = credential_negotiator::extract_step_help_result(&output_text)
        .ok_or_else(|| AppError::Internal("Failed to extract step help from Claude output".into()))?;

    Ok(help_result)
}

// ── Negotiation runner ──────────────────────────────────────────

struct NegotiationRunParams {
    app: tauri::AppHandle,
    negotiation_id: String,
    prompt_text: String,
    cli_args: crate::engine::types::CliArgs,
    active_id: Arc<std::sync::Mutex<Option<String>>>,
}

fn emit_negotiation_progress(app: &tauri::AppHandle, negotiation_id: &str, line: &str) {
    let _ = app.emit(
        "credential-negotiation-progress",
        NegotiatorProgressEvent {
            negotiation_id: negotiation_id.to_string(),
            line: line.to_string(),
        },
    );
}

async fn run_negotiation(params: NegotiationRunParams) {
    let NegotiationRunParams {
        app,
        negotiation_id,
        prompt_text,
        cli_args,
        active_id,
    } = params;

    let _ = app.emit(
        "credential-negotiation-status",
        NegotiatorStatusEvent {
            negotiation_id: negotiation_id.clone(),
            status: "planning".into(),
            result: None,
            error: None,
        },
    );

    emit_negotiation_progress(&app, &negotiation_id, "Connecting to Claude...");

    let mut emitted_analyzing = false;
    let result = spawn_claude_and_collect(
        &cli_args,
        prompt_text,
        300,
        |line_type, _raw_line| match line_type {
            StreamLineType::SystemInit { model, .. } => {
                emit_negotiation_progress(&app, &negotiation_id, &format!("Connected ({})", model));
                emit_negotiation_progress(&app, &negotiation_id, "Analyzing developer portal...");
            }
            StreamLineType::AssistantText { .. } => {
                if !emitted_analyzing {
                    emitted_analyzing = true;
                    emit_negotiation_progress(
                        &app,
                        &negotiation_id,
                        "Generating provisioning steps...",
                    );
                }
            }
            StreamLineType::AssistantToolUse { tool_name, .. } => {
                emit_negotiation_progress(
                    &app,
                    &negotiation_id,
                    &format!("Researching: {}", tool_name),
                );
            }
            StreamLineType::Result {
                duration_ms,
                total_cost_usd,
                ..
            } => {
                let mut msg = "Plan ready".to_string();
                if let Some(ms) = duration_ms {
                    let secs = *ms as f64 / 1000.0;
                    msg = format!("Plan ready ({:.1}s", secs);
                    if let Some(cost) = total_cost_usd {
                        msg.push_str(&format!(", ${:.4}", cost));
                    }
                    msg.push(')');
                }
                emit_negotiation_progress(&app, &negotiation_id, &msg);
            }
            _ => {}
        },
    )
    .await;

    // Check if cancelled
    let is_cancelled = {
        let guard = active_id.lock().unwrap();
        guard.as_deref() != Some(&negotiation_id)
    };

    if is_cancelled {
        tracing::info!(negotiation_id = %negotiation_id, "Credential negotiation cancelled");
        return;
    }

    match result {
        Err(error_msg) => {
            tracing::error!(negotiation_id = %negotiation_id, error = %error_msg, "Negotiation Claude CLI failed");
            let _ = app.emit(
                "credential-negotiation-status",
                NegotiatorStatusEvent {
                    negotiation_id,
                    status: "failed".into(),
                    result: None,
                    error: Some(error_msg),
                },
            );
        }
        Ok(spawn_result) => {
            if !spawn_result.stderr_output.trim().is_empty() {
                tracing::warn!(
                    negotiation_id = %negotiation_id,
                    stderr = %spawn_result.stderr_output.trim(),
                    "Negotiation Claude CLI stderr"
                );
            }

            match credential_negotiator::extract_negotiation_result(&spawn_result.text_output) {
                Some(plan_result) => {
                    {
                        let mut guard = active_id.lock().unwrap();
                        if guard.as_deref() == Some(&negotiation_id) {
                            *guard = None;
                        }
                    }
                    emit_negotiation_progress(
                        &app,
                        &negotiation_id,
                        "Provisioning plan generated",
                    );
                    let _ = app.emit(
                        "credential-negotiation-status",
                        NegotiatorStatusEvent {
                            negotiation_id,
                            status: "completed".into(),
                            result: Some(plan_result),
                            error: None,
                        },
                    );
                }
                None => {
                    {
                        let mut guard = active_id.lock().unwrap();
                        if guard.as_deref() == Some(&negotiation_id) {
                            *guard = None;
                        }
                    }
                    tracing::warn!(
                        negotiation_id = %negotiation_id,
                        "Failed to extract negotiation plan from Claude output"
                    );
                    let _ = app.emit(
                        "credential-negotiation-status",
                        NegotiatorStatusEvent {
                            negotiation_id,
                            status: "failed".into(),
                            result: None,
                            error: Some("Failed to generate provisioning plan. Try again.".into()),
                        },
                    );
                }
            }
        }
    }
}

// ── CLI helpers ─────────────────────────────────────────────────

fn build_negotiator_cli_args() -> crate::engine::types::CliArgs {
    let mut cli_args = prompt::build_default_cli_args();
    if !cli_args.args.iter().any(|arg| arg == "--model") {
        cli_args.args.push("--model".to_string());
        cli_args.args.push(NEGOTIATOR_MODEL.to_string());
    }
    cli_args
}
