use std::sync::Arc;

use serde_json::json;
use tauri::State;

use crate::db::repos::resources::audit_log;
use crate::engine::credential_negotiator;
use crate::error::AppError;

use crate::AppState;

use super::ai_artifact_flow::{
    run_ai_artifact_task, run_claude_prompt, AiArtifactMessages, AiArtifactParams,
};
use super::shared::build_credential_task_cli_args;
use crate::engine::event_registry::event_name;
use personas_macros::requires;

// -- Negotiation messages ----------------------------------------

const NEGOTIATION_MESSAGES: AiArtifactMessages = AiArtifactMessages {
    status_event: event_name::CREDENTIAL_NEGOTIATION_STATUS,
    progress_event: event_name::CREDENTIAL_NEGOTIATION_PROGRESS,
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

// -- Commands ----------------------------------------------------

/// Start a credential negotiation -- generates a step-by-step provisioning plan.
///
/// `authenticated_services` is an optional list of auth detection results that
/// inform the AI prompt to skip account-creation / sign-in steps for services
/// the user is already authenticated to.
#[tauri::command]
#[requires(privileged)]
pub async fn start_credential_negotiation(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    service_name: String,
    connector: serde_json::Value,
    field_keys: Vec<String>,
    authenticated_services: Option<Vec<serde_json::Value>>,
) -> Result<serde_json::Value, AppError> {
    let auth_services = authenticated_services.unwrap_or_default();
    let negotiation_prompt = credential_negotiator::build_negotiation_prompt(
        &service_name,
        &connector,
        &field_keys,
        &auth_services,
    );

    let cli_args = build_credential_task_cli_args();
    let negotiation_id = uuid::Uuid::new_v4().to_string();

    // Use a dedicated domain so negotiation and credential design don't
    // corrupt each other's state when a user switches between flows.
    let registry = state.process_registry.clone();
    // begin_run (not set_id): atomically install this run, cancel the previous
    // one's token, and take its PID to kill. A get_id()-then-set_id() pair lets
    // two concurrent starts both pass the guard, spawning a duplicate CLI while
    // the first's completion check sees the displaced id and returns without
    // emitting (silently discarded result). Mirrors design/analysis.rs.
    let (old_pid, _cancelled) = registry.begin_run("negotiation", negotiation_id.clone());
    if let Some(pid) = old_pid {
        crate::engine::kill_process(pid);
    }

    let _ = audit_log::insert(
        &state.db,
        &negotiation_id,
        &service_name,
        "negotiation_started",
        None,
        None,
        Some(&format!("provisioning plan for '{service_name}'")),
    );

    let neg_id = negotiation_id.clone();

    tokio::spawn(async move {
        run_ai_artifact_task(AiArtifactParams {
            app,
            task_id: neg_id,
            prompt_text: negotiation_prompt,
            cli_args,
            registry,
            domain: "negotiation".into(),
            track_pid: true,
            messages: NEGOTIATION_MESSAGES,
            extractor: credential_negotiator::extract_negotiation_result,
            spend: None,
        })
        .await;
    });

    Ok(json!({ "negotiation_id": negotiation_id }))
}

/// Cancel an active credential negotiation.
#[tauri::command]
#[requires(privileged)]
pub fn cancel_credential_negotiation(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    // Cancel the active negotiation and kill the CLI child process.
    if let Some(pid) = state.process_registry.cancel("negotiation") {
        tracing::info!(
            pid = pid,
            "Killing credential negotiation CLI child process"
        );
        crate::engine::kill_process(pid);
    }

    Ok(())
}

/// Get contextual help for a specific provisioning step.
#[tauri::command]
#[requires(privileged)]
pub async fn get_negotiation_step_help(
    state: State<'_, Arc<AppState>>,
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

    let cli_args = build_credential_task_cli_args();
    let output_text = run_claude_prompt(
        prompt_text,
        &cli_args,
        120,
        "Claude produced no output for step help",
    )
    .await
    .map_err(AppError::Internal)?;

    let help_result =
        credential_negotiator::extract_step_help_result(&output_text).ok_or_else(|| {
            AppError::Internal("Failed to extract step help from Claude output".into())
        })?;

    Ok(help_result)
}
