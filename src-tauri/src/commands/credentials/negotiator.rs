use std::sync::Arc;

use serde_json::json;
use tauri::State;

use crate::db::repos::resources::audit_log;
use crate::engine::credential_negotiator;
use crate::error::AppError;
use crate::ipc_auth::{require_privileged, require_privileged_sync};
use crate::AppState;

use super::ai_artifact_flow::{
    AiArtifactMessages, AiArtifactParams, run_ai_artifact_task, run_claude_prompt,
};
use super::shared::build_credential_task_cli_args;

// ── Negotiation messages ────────────────────────────────────────

const NEGOTIATION_MESSAGES: AiArtifactMessages = AiArtifactMessages {
    status_event: "credential-negotiation-status",
    progress_event: "credential-negotiation-progress",
    id_field: "negotiation_id",
    initial_status: "planning",
    init_progress: "Analyzing developer portal...",
    streaming_progress: "Generating provisioning steps...",
    complete_prefix: "Plan ready",
    success_progress: "Provisioning plan generated",
    extraction_failed_error: "Failed to generate provisioning plan. Try again.",
    log_label: "negotiation",
    timeout_secs: 300,
};

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
    require_privileged(&state, "start_credential_negotiation").await?;
    let negotiation_prompt = credential_negotiator::build_negotiation_prompt(
        &service_name,
        &connector,
        &field_keys,
    );

    let cli_args = build_credential_task_cli_args();
    let negotiation_id = uuid::Uuid::new_v4().to_string();

    // Use a dedicated mutex so negotiation and credential design don't
    // corrupt each other's state when a user switches between flows.
    let active_id = state.active_negotiation_id.clone();
    {
        let mut guard = active_id.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        *guard = Some(negotiation_id.clone());
    }

    let _ = audit_log::insert(
        &state.db, &negotiation_id, &service_name,
        "negotiation_started", None, None,
        Some(&format!("provisioning plan for '{service_name}'")),
    );

    let neg_id = negotiation_id.clone();
    let active_child_pid = state.active_negotiation_child_pid.clone();

    tokio::spawn(async move {
        run_ai_artifact_task(AiArtifactParams {
            app,
            task_id: neg_id,
            prompt_text: negotiation_prompt,
            cli_args,
            active_id,
            active_child_pid: Some(active_child_pid),
            messages: NEGOTIATION_MESSAGES,
            extractor: credential_negotiator::extract_negotiation_result,
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
    require_privileged_sync(&state, "cancel_credential_negotiation")?;
    let mut guard = state.active_negotiation_id.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    *guard = None;

    // Kill the CLI child process to stop API credit consumption immediately.
    let pid = state.active_negotiation_child_pid.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?.take();
    if let Some(pid) = pid {
        tracing::info!(pid = pid, "Killing credential negotiation CLI child process");
        crate::engine::kill_process(pid);
    }

    Ok(())
}

/// Get contextual help for a specific provisioning step.
#[tauri::command]
pub async fn get_negotiation_step_help(
    state: State<'_, Arc<AppState>>,
    service_name: String,
    step_index: u32,
    step_title: String,
    user_question: String,
) -> Result<serde_json::Value, AppError> {
    require_privileged(&state, "get_negotiation_step_help").await?;
    let prompt_text = credential_negotiator::build_step_help_prompt(
        &service_name,
        step_index as usize,
        &step_title,
        &user_question,
    );

    let cli_args = build_credential_task_cli_args();
    let output_text = run_claude_prompt(prompt_text, &cli_args, 120, "Claude produced no output for step help")
        .await
        .map_err(AppError::Internal)?;

    let help_result = credential_negotiator::extract_step_help_result(&output_text)
        .ok_or_else(|| AppError::Internal("Failed to extract step help from Claude output".into()))?;

    Ok(help_result)
}
