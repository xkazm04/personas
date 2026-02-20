use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::db::repos::personas as persona_repo;
use crate::db::models::CreatePersonaInput;
use crate::engine::prompt;
use crate::error::AppError;
use crate::AppState;

use super::analysis::extract_display_text;

// ── Event payloads ──────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct N8nTransformOutputEvent {
    transform_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct N8nTransformStatusEvent {
    transform_id: String,
    status: String,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
struct N8nTransformSnapshot {
    transform_id: String,
    status: String,
    error: Option<String>,
    lines: Vec<String>,
    draft: Option<serde_json::Value>,
}

#[derive(Clone, Default)]
struct N8nTransformJobState {
    status: String,
    error: Option<String>,
    lines: Vec<String>,
    draft: Option<serde_json::Value>,
}

static N8N_TRANSFORM_JOBS: OnceLock<Mutex<HashMap<String, N8nTransformJobState>>> = OnceLock::new();

fn n8n_transform_jobs() -> &'static Mutex<HashMap<String, N8nTransformJobState>> {
    N8N_TRANSFORM_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn set_n8n_transform_status(
    app: &tauri::AppHandle,
    transform_id: &str,
    status: &str,
    error: Option<String>,
) {
    {
        let mut jobs = n8n_transform_jobs().lock().unwrap();
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        entry.status = status.to_string();
        entry.error = error.clone();
    }

    let _ = app.emit(
        "n8n-transform-status",
        N8nTransformStatusEvent {
            transform_id: transform_id.to_string(),
            status: status.to_string(),
            error,
        },
    );
}

fn emit_n8n_transform_line(app: &tauri::AppHandle, transform_id: &str, line: impl Into<String>) {
    let line = line.into();
    {
        let mut jobs = n8n_transform_jobs().lock().unwrap();
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        entry.lines.push(line.clone());
    }

    let _ = app.emit(
        "n8n-transform-output",
        N8nTransformOutputEvent {
            transform_id: transform_id.to_string(),
            line,
        },
    );
}

fn set_n8n_transform_draft(transform_id: &str, draft: &N8nPersonaOutput) {
    if let Ok(serialized) = serde_json::to_value(draft) {
        let mut jobs = n8n_transform_jobs().lock().unwrap();
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        entry.draft = Some(serialized);
    }
}

fn get_n8n_transform_snapshot_internal(transform_id: &str) -> Option<N8nTransformSnapshot> {
    let jobs = n8n_transform_jobs().lock().unwrap();
    jobs.get(transform_id).map(|job| N8nTransformSnapshot {
        transform_id: transform_id.to_string(),
        status: if job.status.is_empty() {
            "idle".to_string()
        } else {
            job.status.clone()
        },
        error: job.error.clone(),
        lines: job.lines.clone(),
        draft: job.draft.clone(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct N8nPersonaOutput {
    name: Option<String>,
    description: Option<String>,
    system_prompt: String,
    structured_prompt: Option<serde_json::Value>,
    icon: Option<String>,
    color: Option<String>,
    model_profile: Option<String>,
    max_budget_usd: Option<f64>,
    max_turns: Option<i32>,
    design_context: Option<String>,
}

// ── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn transform_n8n_to_persona(
    app: tauri::AppHandle,
    transform_id: String,
    workflow_name: String,
    workflow_json: String,
    parser_result_json: String,
    adjustment_request: Option<String>,
    previous_draft_json: Option<String>,
) -> Result<serde_json::Value, AppError> {
    if workflow_json.trim().is_empty() {
        return Err(AppError::Validation("Workflow JSON cannot be empty".into()));
    }

    set_n8n_transform_status(&app, &transform_id, "running", None);

    match run_n8n_transform_job(
        &app,
        &transform_id,
        &workflow_name,
        &workflow_json,
        &parser_result_json,
        adjustment_request.as_deref(),
        previous_draft_json.as_deref(),
    )
    .await
    {
        Ok(draft) => {
            set_n8n_transform_draft(&transform_id, &draft);
            set_n8n_transform_status(&app, &transform_id, "completed", None);
            Ok(json!({ "draft": draft }))
        }
        Err(err) => {
            let msg = err.to_string();
            set_n8n_transform_status(&app, &transform_id, "failed", Some(msg.clone()));
            Err(AppError::Internal(msg))
        }
    }
}

#[tauri::command]
pub fn start_n8n_transform_background(
    app: tauri::AppHandle,
    transform_id: String,
    workflow_name: String,
    workflow_json: String,
    parser_result_json: String,
    adjustment_request: Option<String>,
    previous_draft_json: Option<String>,
) -> Result<serde_json::Value, AppError> {
    if workflow_json.trim().is_empty() {
        return Err(AppError::Validation("Workflow JSON cannot be empty".into()));
    }

    {
        let mut jobs = n8n_transform_jobs().lock().unwrap();
        if let Some(existing) = jobs.get(&transform_id) {
            if existing.status == "running" {
                return Err(AppError::Validation("Transform is already running".into()));
            }
        }
        jobs.insert(
            transform_id.clone(),
            N8nTransformJobState {
                status: "running".into(),
                error: None,
                lines: Vec::new(),
                draft: None,
            },
        );
    }

    set_n8n_transform_status(&app, &transform_id, "running", None);

    let app_handle = app.clone();
    let transform_id_for_task = transform_id.clone();
    tokio::spawn(async move {
        let result = run_n8n_transform_job(
            &app_handle,
            &transform_id_for_task,
            &workflow_name,
            &workflow_json,
            &parser_result_json,
            adjustment_request.as_deref(),
            previous_draft_json.as_deref(),
        )
        .await;

        match result {
            Ok(draft) => {
                set_n8n_transform_draft(&transform_id_for_task, &draft);
                set_n8n_transform_status(&app_handle, &transform_id_for_task, "completed", None);
                crate::notifications::notify_n8n_transform_completed(
                    &app_handle,
                    &workflow_name,
                    true,
                );
            }
            Err(err) => {
                let msg = err.to_string();
                set_n8n_transform_status(&app_handle, &transform_id_for_task, "failed", Some(msg));
                crate::notifications::notify_n8n_transform_completed(
                    &app_handle,
                    &workflow_name,
                    false,
                );
            }
        }
    });

    Ok(json!({ "transform_id": transform_id }))
}

#[tauri::command]
pub fn get_n8n_transform_snapshot(transform_id: String) -> Result<serde_json::Value, AppError> {
    let snapshot = get_n8n_transform_snapshot_internal(&transform_id)
        .ok_or_else(|| AppError::NotFound("n8n transform not found".into()))?;
    Ok(serde_json::to_value(snapshot).unwrap_or_else(|_| json!({})))
}

#[tauri::command]
pub fn clear_n8n_transform_snapshot(transform_id: String) -> Result<(), AppError> {
    let mut jobs = n8n_transform_jobs().lock().unwrap();
    jobs.remove(&transform_id);
    Ok(())
}

#[tauri::command]
pub fn confirm_n8n_persona_draft(
    state: State<'_, Arc<AppState>>,
    draft_json: String,
) -> Result<serde_json::Value, AppError> {
    let draft: N8nPersonaOutput = serde_json::from_str(&draft_json)
        .map_err(|e| AppError::Validation(format!("Invalid draft JSON: {e}")))?;

    let draft = normalize_n8n_persona_draft(draft, "Imported n8n Workflow");

    if draft.system_prompt.trim().is_empty() {
        return Err(AppError::Validation("Draft system_prompt cannot be empty".into()));
    }

    let created = persona_repo::create(
        &state.db,
        CreatePersonaInput {
            name: draft
                .name
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| "Imported n8n Workflow".into()),
            description: draft.description,
            system_prompt: draft.system_prompt,
            structured_prompt: draft
                .structured_prompt
                .and_then(|v| serde_json::to_string(&v).ok()),
            icon: draft.icon,
            color: draft.color,
            project_id: None,
            enabled: Some(true),
            max_concurrent: None,
            timeout_ms: None,
            model_profile: draft.model_profile,
            max_budget_usd: draft.max_budget_usd,
            max_turns: draft.max_turns,
            design_context: draft.design_context,
            group_id: None,
        },
    )?;

    Ok(json!({ "persona": created }))
}

// ── N8n transform helpers ───────────────────────────────────────

fn build_n8n_transform_prompt(
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
) -> String {
    let adjustment_section = adjustment_request
        .filter(|a| !a.trim().is_empty())
        .map(|a| format!("\nUser adjustment request:\n{}\n", a))
        .unwrap_or_default();

    let previous_draft_section = previous_draft_json
        .filter(|d| !d.trim().is_empty())
        .map(|d| format!("\nPrevious draft JSON to refine:\n{}\n", d))
        .unwrap_or_default();

    format!(
        r##"You are a senior Personas architect.

Transform the following n8n workflow into a production-ready Personas agent.

Composition philosophy:
1. Preserve business intent and end-to-end flow from n8n.
2. Produce robust prompt architecture (identity, instructions, toolGuidance, examples, errorHandling, customSections).
3. Keep instructions deterministic, testable, and failure-aware.
4. Prefer explicit capability boundaries and clear operational behavior.
5. Ensure output is directly usable for saving a Persona in the app.
6. Do NOT assume auto-save. The user will confirm before persistence.

Return ONLY valid JSON (no markdown fences, no commentary), with this exact shape:
{{
  "persona": {{
    "name": "string",
    "description": "string",
    "system_prompt": "string",
    "structured_prompt": {{
      "identity": "string",
      "instructions": "string",
      "toolGuidance": "string",
      "examples": "string",
      "errorHandling": "string",
      "customSections": [{{ "key": "string", "label": "string", "content": "string" }}]
    }},
    "icon": "Sparkles",
    "color": "#8b5cf6",
    "model_profile": null,
    "max_budget_usd": null,
    "max_turns": null,
    "design_context": "string"
  }}
}}

Workflow name:
{workflow_name}

Static parser baseline JSON:
{parser_result_json}

Original n8n workflow JSON:
{workflow_json}

{adjustment_section}
{previous_draft_section}
"##
    )
}

fn normalize_n8n_persona_draft(mut draft: N8nPersonaOutput, workflow_name: &str) -> N8nPersonaOutput {
    if draft.name.as_deref().unwrap_or("").trim().is_empty() {
        draft.name = Some(format!("{} (n8n)", workflow_name.trim()));
    }
    if draft.color.as_deref().unwrap_or("").trim().is_empty() {
        draft.color = Some("#8b5cf6".into());
    }
    if draft.icon.as_deref().unwrap_or("").trim().is_empty() {
        draft.icon = Some("Sparkles".into());
    }
    draft
}

async fn run_n8n_transform_job(
    app: &tauri::AppHandle,
    transform_id: &str,
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
) -> Result<N8nPersonaOutput, AppError> {
    let prompt_text = build_n8n_transform_prompt(
        workflow_name,
        workflow_json,
        parser_result_json,
        adjustment_request,
        previous_draft_json,
    );

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Static workflow parsing complete. Preparing Claude transformation prompt...",
    );

    let mut cli_args = prompt::build_default_cli_args();
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Claude CLI started. Generating persona draft...",
    );

    let output_text = run_claude_prompt_text(prompt_text, &cli_args, Some((app, transform_id)))
        .await
        .map_err(AppError::Internal)?;

    let parsed_json = extract_first_json_object(&output_text)
        .ok_or_else(|| AppError::Internal("Claude did not return valid JSON persona output".into()))?;

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let parsed_value: serde_json::Value = serde_json::from_str(&parsed_json)?;

    let persona_payload = parsed_value
        .get("persona")
        .cloned()
        .unwrap_or(parsed_value);

    let output: N8nPersonaOutput = serde_json::from_value(persona_payload)
        .map_err(|e| AppError::Internal(format!("Failed to parse transformed persona output: {e}")))?;
    let draft = normalize_n8n_persona_draft(output, workflow_name);

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Draft ready for review. Confirm save is required to persist.",
    );

    Ok(draft)
}

fn should_surface_n8n_output_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }

    if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
        return false;
    }

    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && (trimmed.contains("\"persona\"") || trimmed.contains("\"system_prompt\""))
    {
        return false;
    }

    true
}

async fn run_claude_prompt_text(
    prompt_text: String,
    cli_args: &crate::engine::types::CliArgs,
    emit_ctx: Option<(&tauri::AppHandle, &str)>,
) -> Result<String, String> {
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                .to_string()
        } else {
            format!("Failed to spawn Claude CLI: {}", e)
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt_text.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let stderr = child.stderr.take().ok_or_else(|| "Missing stderr pipe".to_string())?;
    let stderr_task = tokio::spawn(async move {
        let mut stderr_reader = BufReader::new(stderr);
        let mut stderr_buf = String::new();
        let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr_reader, &mut stderr_buf).await;
        stderr_buf
    });

    let stdout = child.stdout.take().ok_or_else(|| "Missing stdout pipe".to_string())?;
    let mut reader = BufReader::new(stdout).lines();
    let mut text_output = String::new();
    let mut last_emitted_line: Option<String> = None;

    let timeout_duration = std::time::Duration::from_secs(420);
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            if let Some(text) = extract_display_text(&line) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    text_output.push_str(trimmed);
                    text_output.push('\n');

                    if !should_surface_n8n_output_line(trimmed) {
                        continue;
                    }

                    if last_emitted_line.as_deref() == Some(trimmed) {
                        continue;
                    }
                    if let Some((app, transform_id)) = emit_ctx {
                        emit_n8n_transform_line(app, transform_id, trimmed.to_string());
                    }
                    last_emitted_line = Some(trimmed.to_string());
                }
            }
        }
    })
    .await;

    let exit_status = child
        .wait()
        .await
        .map_err(|e| format!("Failed waiting for Claude CLI: {}", e))?;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if stream_result.is_err() {
        let _ = child.kill().await;
        return Err("Claude n8n transformation timed out after 7 minutes".into());
    }

    if !exit_status.success() {
        let msg = stderr_output
            .trim()
            .lines()
            .last()
            .unwrap_or("unknown error")
            .to_string();
        return Err(format!("Claude CLI exited with error: {}", msg));
    }

    if text_output.trim().is_empty() {
        return Err("Claude produced no output for n8n transformation".into());
    }

    Ok(text_output)
}

fn extract_first_json_object(input: &str) -> Option<String> {
    let candidates = [
        input.to_string(),
        input
            .replace("```json", "")
            .replace("```", "")
            .trim()
            .to_string(),
    ];

    for candidate in candidates {
        if serde_json::from_str::<serde_json::Value>(&candidate).is_ok() {
            return Some(candidate);
        }

        let start = candidate.find('{');
        let end = candidate.rfind('}');
        if let (Some(s), Some(e)) = (start, end) {
            if s < e {
                let slice = candidate[s..=e].to_string();
                if serde_json::from_str::<serde_json::Value>(&slice).is_ok() {
                    return Some(slice);
                }
            }
        }
    }

    None
}
