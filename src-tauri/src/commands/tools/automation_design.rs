use std::sync::Arc;

use serde_json::json;
use tauri::State;

use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::automations as automation_repo;
use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

use crate::commands::credentials::ai_artifact_flow::{
    AiArtifactMessages, AiArtifactParams, run_ai_artifact_task,
};
use crate::commands::credentials::shared::build_credential_task_cli_args;

// ── Messages ────────────────────────────────────────────────────

const AUTOMATION_DESIGN_MESSAGES: AiArtifactMessages = AiArtifactMessages {
    status_event: "automation-design-status",
    progress_event: "automation-design-output",
    id_field: "design_id",
    initial_status: "analyzing",
    init_progress: "Analyzing automation requirements...",
    streaming_progress: "Designing automation configuration...",
    complete_prefix: "Design complete",
    success_progress: "Automation designed successfully",
    extraction_failed_error:
        "Failed to extract automation design from Claude output. Try describing the automation more specifically.",
    log_label: "automation_design",
    timeout_secs: 300,
};

// ── Prompt builder ──────────────────────────────────────────────

fn build_automation_design_prompt(
    description: &str,
    persona_name: &str,
    tools_summary: &str,
    connectors_summary: &str,
    credentials_summary: &str,
    existing_automations_summary: &str,
) -> String {
    format!(
        r#"You are an automation design assistant. A user wants to add an external workflow automation to their AI agent named "{persona_name}".

## User's description
{description}

## Agent's current setup

### Tools configured
{tools_summary}

### Connectors (credential types) available
{connectors_summary}

### Credentials on file
{credentials_summary}

### Existing automations
{existing_automations_summary}

## Your task

Design an automation configuration that will be AUTOMATICALLY DEPLOYED via the platform's API. You must generate a complete, deployable workflow definition — not just instructions.

Return ONLY a JSON object (no markdown fences, no explanation outside) with this exact structure:

{{
  "name": "Short descriptive name for the automation",
  "description": "What this automation does, written for a non-technical user",
  "platform": "n8n" | "github_actions" | "zapier" | "custom",
  "webhook_url": null,
  "webhook_method": "POST",
  "input_schema": "JSON string describing expected input, e.g. {{ \"file_url\": \"string\" }}",
  "output_schema": "JSON string describing expected output, or null",
  "timeout_secs": 30,
  "fallback_mode": "connector" | "fail" | "skip",
  "platform_reasoning": "Why you chose this platform and how the workflow design achieves the goal",
  "setup_steps": [
    "Step 1: Brief summary of what was auto-configured",
    "Step 2: Any manual steps the user still needs to do (if any)"
  ],
  "suggested_credential_type": "Name of an existing connector/credential type to authenticate, or null",
  "handles_connectors": ["List of connector names this automation would replace/supplement"],
  "workflow_definition": <platform-specific deployable definition — see below>
}}

## Platform-specific workflow_definition

### For n8n:
Generate a COMPLETE n8n workflow JSON object with "name", "nodes" array, and "connections" object.
The first node MUST be a Webhook trigger node so the workflow is trigger-ready.
Example minimal structure:
{{
  "name": "My Automation",
  "nodes": [
    {{
      "parameters": {{ "httpMethod": "POST", "path": "automation-slug", "responseMode": "responseNode" }},
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [250, 300],
      "name": "Webhook"
    }},
    {{
      "parameters": {{ ... }},
      "type": "n8n-nodes-base.someNode",
      "typeVersion": 1,
      "position": [450, 300],
      "name": "Process"
    }}
  ],
  "connections": {{
    "Webhook": {{ "main": [[{{ "node": "Process", "type": "main", "index": 0 }}]] }}
  }}
}}

### For github_actions:
Generate an object with:
{{
  "event_type": "personas-<descriptive-slug>",
  "workflow_yaml": "name: ...\non:\n  repository_dispatch:\n    types: [personas-<slug>]\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - ..."
}}
The workflow MUST trigger on repository_dispatch with the matching event_type.

### For zapier:
Generate: {{ "catch_hook_url": "<url if the user provided one, otherwise null>" }}
Zapier hooks must be created in the Zapier UI — provide helpful setup_steps explaining this.

### For custom:
Set workflow_definition to null.

## Guidelines
- Choose the platform that best fits the description. Default to n8n for data processing, GitHub Actions for CI/CD, Zapier for simple integrations.
- If the user mentions a specific platform, use that.
- webhook_url should be null — it will be resolved automatically during deployment.
- Keep input_schema minimal — only include fields the workflow actually needs.
- Use "connector" fallback_mode when the agent has matching connectors that could do the same work.
- setup_steps should explain what was auto-configured and any remaining manual steps.
- If existing credentials match what the automation needs, reference them in suggested_credential_type.
- For n8n workflow nodes, use real n8n node types (n8n-nodes-base.webhook, n8n-nodes-base.httpRequest, n8n-nodes-base.code, etc.)."#
    )
}

// ── Extractor ───────────────────────────────────────────────────

fn extract_automation_design_result(text: &str) -> Option<serde_json::Value> {
    // Try to find JSON object in the text
    let trimmed = text.trim();

    // Direct parse first
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if val.is_object() && val.get("name").is_some() {
            return Some(val);
        }
    }

    // Look for JSON between curly braces (skip markdown fences)
    let mut depth = 0i32;
    let mut start = None;
    for (i, ch) in trimmed.char_indices() {
        match ch {
            '{' => {
                if depth == 0 {
                    start = Some(i);
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(s) = start {
                        let candidate = &trimmed[s..=i];
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(candidate) {
                            if val.is_object() && val.get("name").is_some() {
                                return Some(val);
                            }
                        }
                    }
                    start = None;
                }
            }
            _ => {}
        }
    }

    None
}

// ── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_automation_design(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    description: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    // Gather persona context
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    let connectors = connector_repo::get_all(&state.db)?;
    let credentials = cred_repo::get_all(&state.db)?;
    let automations = automation_repo::get_by_persona(&state.db, &persona_id).unwrap_or_default();

    let tools_summary = if tools.is_empty() {
        "None configured".to_string()
    } else {
        tools
            .iter()
            .map(|t| format!("- {} ({}): {}", t.name, t.category, t.description))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let connectors_summary = if connectors.is_empty() {
        "None available".to_string()
    } else {
        connectors
            .iter()
            .map(|c| format!("- {} ({})", c.label, c.name))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let credentials_summary = if credentials.is_empty() {
        "None on file".to_string()
    } else {
        credentials
            .iter()
            .map(|c| format!("- {} (type: {})", c.name, c.service_type))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let existing_automations_summary = if automations.is_empty() {
        "None configured".to_string()
    } else {
        automations
            .iter()
            .map(|a| format!("- {} ({}, {})", a.name, a.platform, a.deployment_status))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let prompt_text = build_automation_design_prompt(
        &description,
        &persona.name,
        &tools_summary,
        &connectors_summary,
        &credentials_summary,
        &existing_automations_summary,
    );

    let cli_args = build_credential_task_cli_args();
    let design_id = uuid::Uuid::new_v4().to_string();
    let active_id = state.active_automation_design_id.clone();
    let active_child_pid = state.active_automation_design_child_pid.clone();

    {
        let mut guard = active_id.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        *guard = Some(design_id.clone());
    }

    let design_id_clone = design_id.clone();

    tokio::spawn(async move {
        run_ai_artifact_task(AiArtifactParams {
            app,
            task_id: design_id_clone,
            prompt_text,
            cli_args,
            active_id,
            active_child_pid: Some(active_child_pid),
            messages: AUTOMATION_DESIGN_MESSAGES,
            extractor: extract_automation_design_result,
        })
        .await;
    });

    Ok(json!({ "design_id": design_id }))
}

#[tauri::command]
pub fn cancel_automation_design(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let mut guard = state.active_automation_design_id.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    *guard = None;

    let pid = state.active_automation_design_child_pid.lock().map_err(|_| AppError::Internal("Lock poisoned".into()))?.take();
    if let Some(pid) = pid {
        tracing::info!(pid = pid, "Killing automation design CLI child process");
        crate::engine::kill_process(pid);
    }

    Ok(())
}
