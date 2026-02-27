use std::sync::Arc;
use std::collections::HashMap;

use serde_json::json;
use tauri::State;

use crate::db::repos::resources::connectors as connector_repo;
use crate::engine::credential_design;
use crate::engine::healthcheck::{resolve_template, validate_healthcheck_url};
use crate::error::AppError;
use crate::AppState;

use super::ai_artifact_flow::{
    AiArtifactMessages, AiArtifactParams, run_ai_artifact_task, run_claude_prompt,
};
use super::shared::build_credential_task_cli_args;

// ── Credential design messages ──────────────────────────────────

const DESIGN_MESSAGES: AiArtifactMessages = AiArtifactMessages {
    status_event: "credential-design-status",
    progress_event: "credential-design-output",
    id_field: "design_id",
    initial_status: "analyzing",
    init_progress: "Analyzing service requirements...",
    streaming_progress: "Designing connector structure...",
    complete_prefix: "Analysis complete",
    success_progress: "Connector designed successfully",
    extraction_failed_error: "Failed to extract connector design from Claude output. Try describing the service more specifically.",
    log_label: "credential_design",
    timeout_secs: 600,
};

// ── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_credential_design(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    instruction: String,
) -> Result<serde_json::Value, AppError> {
    let connectors = connector_repo::get_all(&state.db)?;

    let design_prompt = credential_design::build_credential_design_prompt(
        &instruction,
        &connectors,
    );

    let cli_args = build_credential_task_cli_args();

    let design_id = uuid::Uuid::new_v4().to_string();
    let active_id = state.active_credential_design_id.clone();
    let active_child_pid = state.active_credential_design_child_pid.clone();

    {
        let mut guard = active_id.lock().unwrap();
        *guard = Some(design_id.clone());
    }

    let design_id_clone = design_id.clone();

    tokio::spawn(async move {
        run_ai_artifact_task(AiArtifactParams {
            app,
            task_id: design_id_clone,
            prompt_text: design_prompt,
            cli_args,
            active_id,
            active_child_pid: Some(active_child_pid),
            messages: DESIGN_MESSAGES,
            extractor: credential_design::extract_credential_design_result,
        })
        .await;
    });

    Ok(json!({ "design_id": design_id }))
}

#[tauri::command]
pub fn cancel_credential_design(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let mut guard = state.active_credential_design_id.lock().unwrap();
    *guard = None;

    // Kill the CLI child process to stop API credit consumption immediately.
    let pid = state.active_credential_design_child_pid.lock().unwrap().take();
    if let Some(pid) = pid {
        tracing::info!(pid = pid, "Killing credential design CLI child process");
        crate::engine::kill_process(pid);
    }

    Ok(())
}

#[tauri::command]
pub async fn test_credential_design_healthcheck(
    _state: State<'_, Arc<AppState>>,
    instruction: String,
    connector: serde_json::Value,
    field_values: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let values_map: HashMap<String, String> = serde_json::from_value(field_values)
        .map_err(|e| AppError::Validation(format!("Invalid field values: {}", e)))?;

    let field_keys: Vec<String> = values_map.keys().cloned().collect();
    let prompt_text = credential_design::build_credential_healthcheck_prompt(
        &instruction,
        &connector,
        &field_keys,
    );

    let cli_args = build_credential_task_cli_args();
    let output_text = run_claude_prompt(prompt_text, &cli_args, 300, "Claude produced no output for healthcheck generation")
        .await
        .map_err(AppError::Internal)?;

    let config = credential_design::extract_healthcheck_config_result(&output_text)
        .ok_or_else(|| AppError::Internal("Failed to extract healthcheck config from Claude output".into()))?;

    if config
        .get("skip")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let reason = config
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("No reliable test endpoint available");
        return Ok(json!({
            "success": false,
            "message": format!("Claude skipped automatic healthcheck: {}", reason),
            "healthcheck_config": config,
        }));
    }

    let endpoint = config
        .get("endpoint")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("Claude did not provide a valid healthcheck endpoint".into()))?;

    let method = config
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_uppercase();

    let expected_status = config
        .get("expected_status")
        .and_then(|v| v.as_u64())
        .map(|v| v as u16);

    let resolved_endpoint = resolve_template(endpoint, &values_map);

    // Validate the resolved URL to prevent SSRF via AI-generated endpoints
    validate_healthcheck_url(&resolved_endpoint)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {}", e)))?;

    let mut request = match method.as_str() {
        "POST" => client.post(&resolved_endpoint),
        "PUT" => client.put(&resolved_endpoint),
        "PATCH" => client.patch(&resolved_endpoint),
        _ => client.get(&resolved_endpoint),
    };

    if let Some(headers_obj) = config.get("headers").and_then(|v| v.as_object()) {
        for (key, val) in headers_obj {
            if let Some(raw) = val.as_str() {
                let resolved = resolve_template(raw, &values_map);
                request = request.header(key, resolved);
            }
        }
    }

    let response = request.send().await;

    match response {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let success = expected_status.map(|exp| exp == status).unwrap_or(resp.status().is_success());
            let message = if success {
                format!("Claude healthcheck passed (HTTP {})", status)
            } else if let Some(exp) = expected_status {
                format!("Claude healthcheck failed (HTTP {}, expected {})", status, exp)
            } else {
                format!("Claude healthcheck failed (HTTP {})", status)
            };

            Ok(json!({
                "success": success,
                "message": message,
                "healthcheck_config": config,
            }))
        }
        Err(e) => Ok(json!({
            "success": false,
            "message": format!("Claude healthcheck request failed: {}", e),
            "healthcheck_config": config,
        })),
    }
}
