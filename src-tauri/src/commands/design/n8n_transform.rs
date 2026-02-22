use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::n8n_sessions;
use crate::db::models::{CreatePersonaInput, UpdateN8nSessionInput};
use crate::engine::parser::parse_stream_line;
use crate::engine::prompt;
use crate::engine::types::StreamLineType;
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
    questions: Option<serde_json::Value>,
}

const JOB_TTL_SECS: u64 = 30 * 60; // 30 minutes

#[derive(Clone)]
struct N8nTransformJobState {
    status: String,
    error: Option<String>,
    lines: Vec<String>,
    draft: Option<serde_json::Value>,
    cancel_token: Option<CancellationToken>,
    claude_session_id: Option<String>,
    questions: Option<serde_json::Value>,
    created_at: Instant,
}

impl Default for N8nTransformJobState {
    fn default() -> Self {
        Self {
            status: String::new(),
            error: None,
            lines: Vec::new(),
            draft: None,
            cancel_token: None,
            claude_session_id: None,
            questions: None,
            created_at: Instant::now(),
        }
    }
}

static N8N_TRANSFORM_JOBS: OnceLock<Mutex<HashMap<String, N8nTransformJobState>>> = OnceLock::new();

fn n8n_transform_jobs() -> &'static Mutex<HashMap<String, N8nTransformJobState>> {
    N8N_TRANSFORM_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_jobs() -> Result<std::sync::MutexGuard<'static, HashMap<String, N8nTransformJobState>>, AppError> {
    n8n_transform_jobs()
        .lock()
        .map_err(|_| AppError::Internal("n8n transform job lock poisoned".into()))
}

/// Remove non-running job entries older than `JOB_TTL_SECS`.
/// Called on each new job insert to prevent unbounded memory growth.
fn evict_stale_n8n_jobs(jobs: &mut HashMap<String, N8nTransformJobState>) {
    let cutoff = std::time::Duration::from_secs(JOB_TTL_SECS);
    jobs.retain(|_, job| job.status == "running" || job.created_at.elapsed() < cutoff);
}

fn set_n8n_transform_status(
    app: &tauri::AppHandle,
    transform_id: &str,
    status: &str,
    error: Option<String>,
) {
    if let Ok(mut jobs) = lock_jobs() {
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
    if let Ok(mut jobs) = lock_jobs() {
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        // Cap stored lines at 500 to prevent unbounded memory growth
        if entry.lines.len() < 500 {
            entry.lines.push(line.clone());
        }
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
    match serde_json::to_value(draft) {
        Ok(serialized) => {
            if let Ok(mut jobs) = lock_jobs() {
                let entry = jobs
                    .entry(transform_id.to_string())
                    .or_insert_with(N8nTransformJobState::default);
                entry.draft = Some(serialized);
            }
        }
        Err(e) => {
            tracing::error!(transform_id = %transform_id, error = %e, "Failed to serialize n8n draft");
        }
    }
}

fn get_n8n_transform_snapshot_internal(transform_id: &str) -> Option<N8nTransformSnapshot> {
    let jobs = lock_jobs().ok()?;
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
        questions: job.questions.clone(),
    })
}

fn set_n8n_transform_questions(transform_id: &str, questions: serde_json::Value) {
    if let Ok(mut jobs) = lock_jobs() {
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        entry.questions = Some(questions);
    }
}

fn set_n8n_transform_claude_session(transform_id: &str, session_id: String) {
    if let Ok(mut jobs) = lock_jobs() {
        let entry = jobs
            .entry(transform_id.to_string())
            .or_insert_with(N8nTransformJobState::default);
        entry.claude_session_id = Some(session_id);
    }
}

fn get_n8n_transform_claude_session(transform_id: &str) -> Option<String> {
    let jobs = lock_jobs().ok()?;
    jobs.get(transform_id)?.claude_session_id.clone()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct N8nPersonaOutput {
    pub(super) name: Option<String>,
    pub(super) description: Option<String>,
    pub(super) system_prompt: String,
    pub(super) structured_prompt: Option<serde_json::Value>,
    pub(super) icon: Option<String>,
    pub(super) color: Option<String>,
    pub(super) model_profile: Option<String>,
    pub(super) max_budget_usd: Option<f64>,
    pub(super) max_turns: Option<i32>,
    pub(super) design_context: Option<String>,
    pub(super) notification_channels: Option<String>,
    // Entity fields — populated by connector-aware transform
    pub(super) triggers: Option<Vec<N8nTriggerDraft>>,
    pub(super) tools: Option<Vec<N8nToolDraft>>,
    pub(super) required_connectors: Option<Vec<N8nConnectorRef>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct N8nTriggerDraft {
    pub(super) trigger_type: String,
    pub(super) config: Option<serde_json::Value>,
    pub(super) description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct N8nToolDraft {
    pub(super) name: String,
    pub(super) category: String,
    pub(super) description: String,
    pub(super) requires_credential_type: Option<String>,
    pub(super) input_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct N8nConnectorRef {
    pub(super) name: String,
    pub(super) n8n_credential_type: String,
    pub(super) has_credential: bool,
}

// ── Commands ────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn transform_n8n_to_persona(
    app: tauri::AppHandle,
    transform_id: String,
    workflow_name: String,
    workflow_json: String,
    parser_result_json: String,
    adjustment_request: Option<String>,
    previous_draft_json: Option<String>,
    connectors_json: Option<String>,
    credentials_json: Option<String>,
    user_answers_json: Option<String>,
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
        connectors_json.as_deref(),
        credentials_json.as_deref(),
        user_answers_json.as_deref(),
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

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_n8n_transform_background(
    app: tauri::AppHandle,
    transform_id: String,
    workflow_name: String,
    workflow_json: String,
    parser_result_json: String,
    adjustment_request: Option<String>,
    previous_draft_json: Option<String>,
    connectors_json: Option<String>,
    credentials_json: Option<String>,
    user_answers_json: Option<String>,
    session_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    if workflow_json.trim().is_empty() {
        return Err(AppError::Validation("Workflow JSON cannot be empty".into()));
    }

    // Reject extremely large payloads early (>10MB combined)
    let total_size = workflow_json.len() + parser_result_json.len()
        + adjustment_request.as_ref().map_or(0, |s| s.len())
        + previous_draft_json.as_ref().map_or(0, |s| s.len());
    if total_size > 10 * 1024 * 1024 {
        return Err(AppError::Validation("Payload too large (>10MB). Use a smaller workflow.".into()));
    }

    let cancel_token = CancellationToken::new();

    {
        let mut jobs = lock_jobs()?;
        evict_stale_n8n_jobs(&mut jobs);
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
                cancel_token: Some(cancel_token.clone()),
                claude_session_id: None,
                questions: None,
                created_at: Instant::now(),
            },
        );
    }

    set_n8n_transform_status(&app, &transform_id, "running", None);

    // Persist 'transforming' status to DB session so startup recovery can detect it
    if let Some(ref sid) = session_id {
        let state = app.state::<Arc<AppState>>();
        let _ = n8n_sessions::update(&state.db, sid, &UpdateN8nSessionInput {
            status: Some("transforming".into()),
            step: Some("transform".into()),
            ..Default::default()
        });
    }

    // Determine if this is an adjustment re-run or initial transform
    let is_adjustment = adjustment_request.as_ref().is_some_and(|a| !a.trim().is_empty())
        || previous_draft_json.as_ref().is_some_and(|d| !d.trim().is_empty());

    let app_handle = app.clone();
    let transform_id_for_task = transform_id.clone();
    let token_for_task = cancel_token.clone();
    let session_id_for_task = session_id.clone();
    tokio::spawn(async move {
        if is_adjustment {
            // ── Adjustment re-run: single-prompt path (no interactive questions) ──
            let result = tokio::select! {
                _ = token_for_task.cancelled() => {
                    Err(AppError::Internal("Transform cancelled by user".into()))
                }
                res = run_n8n_transform_job(
                    &app_handle,
                    &transform_id_for_task,
                    &workflow_name,
                    &workflow_json,
                    &parser_result_json,
                    adjustment_request.as_deref(),
                    previous_draft_json.as_deref(),
                    connectors_json.as_deref(),
                    credentials_json.as_deref(),
                    user_answers_json.as_deref(),
                ) => res
            };

            handle_transform_result(
                result.map(|d| (d, false)),
                &app_handle,
                &transform_id_for_task,
                &workflow_name,
                session_id_for_task.as_deref(),
            );
        } else {
            // ── Initial transform: unified prompt (may produce questions or persona) ──
            let result = tokio::select! {
                _ = token_for_task.cancelled() => {
                    Err(AppError::Internal("Transform cancelled by user".into()))
                }
                res = run_unified_transform_turn1(
                    &app_handle,
                    &transform_id_for_task,
                    &workflow_name,
                    &workflow_json,
                    &parser_result_json,
                    connectors_json.as_deref(),
                    credentials_json.as_deref(),
                ) => res
            };

            // result: Ok((draft_option, produced_questions))
            match result {
                Ok((Some(draft), _)) => {
                    // Model skipped questions and produced persona directly
                    handle_transform_result(
                        Ok((draft, false)),
                        &app_handle,
                        &transform_id_for_task,
                        &workflow_name,
                        session_id_for_task.as_deref(),
                    );
                }
                Ok((None, true)) => {
                    // Questions were produced and stored — status is awaiting_answers
                    // Nothing else to do; frontend will poll and pick up the questions
                }
                Ok((None, false)) => {
                    // No questions and no persona — unusual, treat as failure
                    handle_transform_result(
                        Err(AppError::Internal("No output from unified transform".into())),
                        &app_handle,
                        &transform_id_for_task,
                        &workflow_name,
                        session_id_for_task.as_deref(),
                    );
                }
                Err(err) => {
                    handle_transform_result(
                        Err(err),
                        &app_handle,
                        &transform_id_for_task,
                        &workflow_name,
                        session_id_for_task.as_deref(),
                    );
                }
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
    let mut jobs = lock_jobs()?;
    jobs.remove(&transform_id);
    Ok(())
}

#[tauri::command]
pub fn cancel_n8n_transform(
    app: tauri::AppHandle,
    transform_id: String,
) -> Result<(), AppError> {
    let token = {
        let jobs = lock_jobs()?;
        jobs.get(&transform_id)
            .and_then(|job| job.cancel_token.clone())
    };

    if let Some(token) = token {
        token.cancel();
    }

    set_n8n_transform_status(&app, &transform_id, "failed", Some("Cancelled by user".into()));
    Ok(())
}

#[tauri::command]
pub fn confirm_n8n_persona_draft(
    state: State<'_, Arc<AppState>>,
    draft_json: String,
) -> Result<serde_json::Value, AppError> {
    use crate::db::repos::resources::triggers as trigger_repo;
    use crate::db::repos::resources::tools as tool_repo;
    use crate::db::models::{CreateTriggerInput, CreateToolDefinitionInput};

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
                .as_ref()
                .filter(|n| !n.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| "Imported n8n Workflow".into()),
            description: draft.description.clone(),
            system_prompt: draft.system_prompt.clone(),
            structured_prompt: draft
                .structured_prompt
                .as_ref()
                .and_then(|v| serde_json::to_string(v).ok()),
            icon: draft.icon.clone(),
            color: draft.color.clone(),
            project_id: None,
            enabled: Some(true),
            max_concurrent: None,
            timeout_ms: None,
            model_profile: draft.model_profile.clone(),
            max_budget_usd: draft.max_budget_usd,
            max_turns: draft.max_turns,
            design_context: draft.design_context.clone(),
            group_id: None,
        },
    )?;

    let persona_id = &created.id;

    // Save notification channels if provided
    if let Some(ref channels) = draft.notification_channels {
        if !channels.trim().is_empty() {
            let _ = persona_repo::update(
                &state.db,
                persona_id,
                crate::db::models::UpdatePersonaInput {
                    notification_channels: Some(channels.clone()),
                    ..Default::default()
                },
            );
        }
    }

    // Create triggers from draft
    let mut triggers_created = 0u32;
    if let Some(ref triggers) = draft.triggers {
        for trigger_draft in triggers {
            let valid_types = ["manual", "schedule", "polling", "webhook"];
            let trigger_type = if valid_types.contains(&trigger_draft.trigger_type.as_str()) {
                trigger_draft.trigger_type.clone()
            } else {
                "manual".to_string()
            };
            match trigger_repo::create(
                &state.db,
                CreateTriggerInput {
                    persona_id: persona_id.clone(),
                    trigger_type,
                    config: trigger_draft.config.as_ref().and_then(|c| serde_json::to_string(c).ok()),
                    enabled: Some(true),
                },
            ) {
                Ok(_) => triggers_created += 1,
                Err(e) => tracing::warn!(persona_id = %persona_id, error = %e, "Failed to create n8n trigger"),
            }
        }
    }

    // Create tool definitions and assign to persona
    let mut tools_created = 0u32;
    if let Some(ref tools) = draft.tools {
        for tool_draft in tools {
            // Check if tool definition already exists by name
            let tool_name = tool_draft.name.replace(' ', "_").to_lowercase();
            let existing = tool_repo::get_all_definitions(&state.db)
                .unwrap_or_default()
                .into_iter()
                .find(|d| d.name == tool_name);

            let tool_def_id = if let Some(existing_def) = existing {
                existing_def.id
            } else {
                match tool_repo::create_definition(
                    &state.db,
                    CreateToolDefinitionInput {
                        name: tool_name.clone(),
                        category: tool_draft.category.clone(),
                        description: tool_draft.description.clone(),
                        script_path: format!("tools/{}.sh", tool_name),
                        input_schema: tool_draft.input_schema.as_ref().and_then(|s| serde_json::to_string(s).ok()),
                        output_schema: None,
                        requires_credential_type: tool_draft.requires_credential_type.clone(),
                        is_builtin: Some(false),
                    },
                ) {
                    Ok(def) => def.id,
                    Err(e) => {
                        tracing::warn!(tool_name = %tool_name, error = %e, "Failed to create n8n tool definition");
                        continue;
                    }
                }
            };

            // Assign tool to persona
            match tool_repo::assign_tool(&state.db, persona_id, &tool_def_id, None) {
                Ok(_) => tools_created += 1,
                Err(e) => tracing::warn!(tool_name = %tool_name, error = %e, "Failed to assign n8n tool to persona"),
            }
        }
    }

    // Collect connectors needing setup
    let connectors_needing_setup: Vec<String> = draft
        .required_connectors
        .as_ref()
        .map(|connectors| {
            connectors
                .iter()
                .filter(|c| !c.has_credential)
                .map(|c| c.name.clone())
                .collect()
        })
        .unwrap_or_default();

    Ok(json!({
        "persona": created,
        "triggers_created": triggers_created,
        "tools_created": tools_created,
        "connectors_needing_setup": connectors_needing_setup,
    }))
}

// ── Question Generation ─────────────────────────────────────────

#[tauri::command]
pub async fn generate_n8n_transform_questions(
    workflow_name: String,
    workflow_json: String,
    parser_result_json: String,
    connectors_json: Option<String>,
    credentials_json: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let connectors_section = connectors_json
        .as_deref()
        .filter(|c| !c.trim().is_empty() && c.trim() != "[]")
        .map(|c| format!("User's available connectors: {c}"))
        .unwrap_or_default();

    let credentials_section = credentials_json
        .as_deref()
        .filter(|c| !c.trim().is_empty() && c.trim() != "[]")
        .map(|c| format!("User's available credentials: {c}"))
        .unwrap_or_default();

    let prompt = format!(
        r##"Analyze this n8n workflow and generate 4-8 clarifying questions for the user
before transforming it into a Personas agent.

The Personas platform has these unique capabilities that n8n does not:
- A built-in LLM execution engine (no external LLM API tools needed)
- Protocol messages that let the persona communicate with the user mid-execution
- A memory system where the persona stores knowledge for future runs (self-improvement)
- Manual review gates where the persona pauses for human approval before acting
- Inter-persona events for multi-agent coordination

Generate questions across these categories:

## 1. Credential Mapping
Which existing credentials should be used for each n8n service?
Only ask if the user has relevant credentials available.

## 2. Configuration Parameters
Workflow-specific settings the user should customize
(e.g., email filter rules, polling intervals, notification preferences).

## 3. Architecture Decisions
When n8n uses AI/LLM nodes, note that Personas has a built-in LLM engine.

## 4. Human-in-the-Loop (IMPORTANT)
For any workflow action that has external consequences (sending emails, posting messages,
modifying databases, calling external APIs that change state), ask whether the user wants
the persona to request manual approval before executing that action.
Example: "Should the persona draft emails and wait for your approval before sending,
or send automatically?"
Example: "Should Slack messages be reviewed before posting?"

## 5. Memory & Learning (IMPORTANT)
For workflows that process data (emails, documents, API responses, logs), ask what
information the user wants the persona to remember across runs for self-improvement.
Example: "Should the persona remember key information from processed emails
(sender patterns, important decisions, commitments)?"
Example: "Should the persona learn and remember categorization rules it discovers?"

## 6. Notification Preferences
How should the persona notify the user about important events?
Example: "Should you receive a summary message after each run, or only on errors?"

{connectors_section}
{credentials_section}

Workflow name: {workflow_name}
Parser result: {parser_result_json}
Original n8n JSON (first 5000 chars): {workflow_preview}

Return ONLY valid JSON (no markdown fences), with this exact shape:
[{{
  "id": "unique_id",
  "question": "Which Google credential should be used for Gmail access?",
  "type": "select",
  "options": ["Option 1", "Option 2"],
  "default": "Option 1",
  "context": "The workflow uses gmailOAuth2 credential for 4 nodes"
}}]

Rules:
- type must be one of: "select", "text", "boolean"
- For boolean type, options should be ["Yes", "No"]
- For select type, always include options array
- For text type, options is optional
- ALWAYS include at least one question about human-in-the-loop approval
- ALWAYS include at least one question about memory/learning strategy
- Order questions from most critical (credential/config) to strategic (memory/notifications)
- Each question must have a unique id
"##,
        workflow_preview = if workflow_json.len() > 5000 {
            &workflow_json[..5000]
        } else {
            &workflow_json
        },
    );

    let mut cli_args = crate::engine::prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-haiku-4-5-20251001".to_string());
    // Limit question generation to a single turn and tight budget
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let (output, _session_id) = run_claude_prompt_text_with_timeout(prompt, &cli_args, None, 90)
        .await
        .map_err(AppError::Internal)?;

    let json_str = extract_first_json_object(&output)
        .or_else(|| {
            // Try extracting array
            let start = output.find('[')?;
            let end = output.rfind(']')?;
            if start < end {
                let slice = &output[start..=end];
                if serde_json::from_str::<serde_json::Value>(slice).is_ok() {
                    return Some(slice.to_string());
                }
            }
            None
        })
        .ok_or_else(|| AppError::Internal("No valid JSON in question generation output".into()))?;

    let questions: serde_json::Value = serde_json::from_str(&json_str)?;
    Ok(questions)
}

// ── N8n transform helpers ───────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn build_n8n_transform_prompt(
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
    connectors_json: Option<&str>,
    credentials_json: Option<&str>,
    user_answers_json: Option<&str>,
) -> String {
    let adjustment_section = adjustment_request
        .filter(|a| !a.trim().is_empty())
        .map(|a| format!("\nUser adjustment request:\n{}\n", a))
        .unwrap_or_default();

    let previous_draft_section = previous_draft_json
        .filter(|d| !d.trim().is_empty())
        .map(|d| format!("\nPrevious draft JSON to refine:\n{}\n", d))
        .unwrap_or_default();

    let connectors_section = connectors_json
        .filter(|c| !c.trim().is_empty() && c.trim() != "[]")
        .map(|c| format!("\n## User's Available Connectors\n{}\n", c))
        .unwrap_or_default();

    let credentials_section = credentials_json
        .filter(|c| !c.trim().is_empty() && c.trim() != "[]")
        .map(|c| format!("\n## User's Available Credentials\n{}\n", c))
        .unwrap_or_default();

    let user_answers_section = user_answers_json
        .filter(|a| !a.trim().is_empty() && a.trim() != "{}")
        .map(|a| format!(
            "\n## User Configuration Answers\nThe user has provided these answers to clarify the transformation. Honor these answers when generating the persona configuration:\n{}\n", a
        ))
        .unwrap_or_default();

    format!(
        r##"You are a senior Personas architect.

Transform the following n8n workflow into a production-ready Personas agent.

## App Capabilities (Personas Platform)
- Personas has a built-in LLM execution engine. Do NOT suggest external LLM API tools.
  No Anthropic API, no OpenAI API calls. The persona's system_prompt IS the AI brain.
- n8n "AI Agent" nodes, "LLM Chat Model" nodes, and "Output Parser" nodes should be
  absorbed into the persona's prompt logic — NOT mapped as external tools.
- Tools are external scripts that interact with APIs (Gmail, Slack, HTTP, etc.)
- Triggers start the persona (schedule, webhook, polling, manual)
- Each tool can reference a connector (credential type) it requires

## Credential Mapping Rules
- "gmailOAuth2" in n8n maps to connector "google" (Google OAuth) in Personas
- "googleSheetsOAuth2Api" in n8n maps to connector "google" in Personas
- "slackOAuth2Api" or "slackApi" in n8n maps to connector "slack" in Personas
- "anthropicApi", "openAiApi" in n8n should NOT be mapped — Personas has built-in LLM
- For other n8n credential types, map to the closest connector by service name
{connectors_section}{credentials_section}
## Persona Protocol System (CRITICAL — use these in the system prompt)

During execution, the persona can output special JSON protocol messages to communicate
with the user, persist knowledge, and request human approval. You MUST weave these into
the system_prompt and structured_prompt instructions wherever the n8n workflow involves
human interaction, data storage, notifications, or approval gates.

### Protocol 1: User Messages (notify the user)
Output this JSON on its own line to send a message to the user:
{{"user_message": {{"title": "string", "content": "string", "content_type": "text|markdown", "priority": "low|normal|high|critical"}}}}

Use for: status updates, summaries, alerts, draft previews, completion reports.
Maps from n8n: "Send Email" notification nodes, Slack/Telegram notification nodes,
"Set" nodes that store status for display, any node whose purpose is to inform the user.

### Protocol 2: Agent Memory (persist knowledge for future runs)
Output this JSON on its own line to save a memory:
{{"agent_memory": {{"title": "string", "content": "string", "category": "fact|preference|instruction|context|learned", "importance": 1-10, "tags": ["tag1"]}}}}

Use for: learning from processed data, remembering decisions, storing extracted
information, tracking patterns over time, building contextual knowledge.
Maps from n8n: "Set" variable nodes that store state, data extraction results,
classification outputs, any node that captures information for reuse.

Memory categories:
- "fact": Concrete information extracted from data (e.g., "Client X prefers morning meetings")
- "preference": User or system preferences discovered during operation
- "instruction": Learned procedures or rules (e.g., "Always CC legal on contract emails")
- "context": Background information for ongoing situations
- "learned": Insights and patterns discovered through operation

### Protocol 3: Manual Review (human-in-the-loop approval gate)
Output this JSON on its own line to request human approval:
{{"manual_review": {{"title": "string", "description": "string", "severity": "info|warning|error|critical", "context_data": "string", "suggested_actions": ["Approve", "Reject", "Edit"]}}}}

Use for: draft review before sending, data deletion confirmation, high-stakes decisions,
content that needs human judgment before acting on it.
Maps from n8n: "Wait" nodes, "Approval" nodes, "IF" decision nodes where human judgment
is needed, any workflow step that pauses for confirmation.

IMPORTANT: When the n8n workflow sends emails, posts messages, modifies data, or performs
any action with external consequences, the persona should draft the action first and
request manual_review BEFORE executing it. This is the human-in-the-loop pattern.

### Protocol 4: Events (inter-persona communication)
Output this JSON to trigger other personas or emit custom events:
{{"emit_event": {{"type": "event_name", "data": {{}}}}}}

Use for: multi-agent coordination, triggering downstream workflows.
Maps from n8n: Webhook output nodes, "Execute Workflow" nodes, any node that chains
to other workflows.

## n8n → Persona Pattern Mapping

Apply these patterns when analyzing the n8n workflow:

1. HUMAN-IN-THE-LOOP: If the workflow sends emails, posts to Slack, modifies databases,
   or performs any externally-visible action → add manual_review before the action.
   The instructions should say: "Draft the action, send it as a user_message for preview,
   then create a manual_review. Only proceed with the action after approval."

2. KNOWLEDGE EXTRACTION: If the workflow processes data (emails, documents, API responses)
   → add agent_memory instructions to extract and store key information.
   Example: "After processing each email, evaluate if it contains key decisions,
   commitments, or important context. Store as agent_memory with appropriate category
   and importance."

3. PROGRESSIVE LEARNING: If the workflow handles recurring tasks → add instructions for
   the persona to check its memories before acting and to store new patterns it discovers.
   Example: "Before categorizing emails, review your memories for learned patterns about
   this sender. After processing, store any new patterns as memories."

4. NOTIFICATIONS: If the workflow has notification/alert nodes → map them to user_message
   protocol with appropriate priority levels.

5. ERROR ESCALATION: If the workflow has error handling → map critical errors to
   user_message with priority "critical" and non-critical to standard error handling.

Composition philosophy:
1. Preserve business intent and end-to-end flow from n8n.
2. Produce robust prompt architecture (identity, instructions, toolGuidance, examples, errorHandling, customSections).
3. Keep instructions deterministic, testable, and failure-aware.
4. Prefer explicit capability boundaries and clear operational behavior.
5. Ensure output is directly usable for saving a Persona in the app.
6. Do NOT assume auto-save. The user will confirm before persistence.
7. Absorb ALL n8n LLM/AI nodes into the persona prompt. Do NOT create tools for LLM calls.
8. Create tools only for external API interactions (email, HTTP, database, file, etc.)
9. Create triggers based on n8n trigger/schedule nodes.
10. Embed protocol message instructions (user_message, agent_memory, manual_review) in the
    system_prompt and structured_prompt wherever the workflow involves human interaction,
    knowledge persistence, or approval gates.
11. Add a "Human-in-the-Loop" customSection when the workflow performs externally-visible actions.
12. Add a "Memory Strategy" customSection when the workflow processes data that could inform future runs.

Return ONLY valid JSON (no markdown fences, no commentary), with this exact shape:
{{
  "persona": {{
    "name": "string",
    "description": "string",
    "system_prompt": "string — must include protocol message instructions for human-in-the-loop and memory",
    "structured_prompt": {{
      "identity": "string",
      "instructions": "string — core workflow logic with protocol messages woven in",
      "toolGuidance": "string — how to use each tool, including when to request manual_review before tool calls",
      "examples": "string — include examples of protocol message usage for this specific workflow",
      "errorHandling": "string — include user_message notifications for critical errors",
      "customSections": [
        {{ "key": "string", "label": "string", "content": "string" }}
      ]
    }},
    "icon": "Sparkles",
    "color": "#8b5cf6",
    "model_profile": null,
    "max_budget_usd": null,
    "max_turns": null,
    "design_context": "JSON string — see design_context instructions below",
    "triggers": [{{
      "trigger_type": "schedule|polling|webhook|manual",
      "config": {{ }},
      "description": "string"
    }}],
    "tools": [{{
      "name": "tool_name_snake_case",
      "category": "email|http|database|file|messaging|other",
      "description": "What this tool does",
      "requires_credential_type": "connector_name_or_null",
      "input_schema": null
    }}],
    "required_connectors": [{{
      "name": "connector_name",
      "n8n_credential_type": "original_n8n_type",
      "has_credential": false
    }}]
  }}
}}

Note on triggers: Array may be empty if workflow has no trigger nodes.
Note on tools: Only include tools for external API calls. Do NOT include LLM/AI tools.
Note on required_connectors: List all external service credentials needed. Set has_credential=true only if the user's available credentials include a matching service.
Note on customSections: ALWAYS include a "human_in_the_loop" section if the workflow performs externally-visible actions (sends emails, posts messages, modifies data). ALWAYS include a "memory_strategy" section if the workflow processes data that could inform future runs. These are critical for the persona to operate safely and improve over time.
Note on design_context: The value MUST be a valid JSON string (escaped within the outer JSON) with this structure:
{{"summary":"Brief 1-2 sentence overview of what this persona does","use_cases":[{{"id":"uc1","title":"Short use case title","description":"1-2 sentence description of what this use case does","category":"notification|data-sync|monitoring|automation|communication|reporting"}}]}}
Generate 3-6 use_cases that describe the key capabilities of this persona based on the n8n workflow analysis. Each use case should represent a distinct scenario the persona can handle.

Workflow name:
{workflow_name}

Static parser baseline JSON:
{parser_result_json}

Original n8n workflow JSON:
{workflow_json}

{adjustment_section}
{previous_draft_section}
{user_answers_section}
"##
    )
}

pub(super) fn normalize_n8n_persona_draft(mut draft: N8nPersonaOutput, workflow_name: &str) -> N8nPersonaOutput {
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

/// Build a unified prompt that handles both question generation and persona generation
/// in a single CLI session. The model decides if it needs clarification.
fn build_n8n_unified_prompt(
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    connectors_json: Option<&str>,
    credentials_json: Option<&str>,
) -> String {
    let connectors_section = connectors_json
        .filter(|c| !c.trim().is_empty() && c.trim() != "[]")
        .map(|c| format!("\n## User's Available Connectors\n{}\n", c))
        .unwrap_or_default();

    let credentials_section = credentials_json
        .filter(|c| !c.trim().is_empty() && c.trim() != "[]")
        .map(|c| format!("\n## User's Available Credentials\n{}\n", c))
        .unwrap_or_default();

    let workflow_preview = if workflow_json.len() > 5000 {
        &workflow_json[..5000]
    } else {
        workflow_json
    };

    format!(
        r##"You are a senior Personas architect. You will analyze an n8n workflow and either ask
clarifying questions OR generate a persona directly.

## PHASE 1: Analyze the workflow

Look at the workflow below. Decide whether you need clarification from the user.

If the workflow is complex (has external service integrations, multiple branches, ambiguous
configuration choices, or actions with external consequences), you MUST ask 4-8 questions.

If the workflow is simple and self-explanatory (e.g., a single-step manual trigger with
one action), skip questions and go directly to PHASE 2.

### When asking questions, output EXACTLY this format and then STOP:

TRANSFORM_QUESTIONS
[{{"id":"q1","question":"Your question here","type":"select","options":["Option A","Option B"],"default":"Option A","context":"Why this matters"}}]

Question rules:
- type must be one of: "select", "text", "boolean"
- For boolean type, options should be ["Yes", "No"]
- For select type, always include options array
- For text type, options is optional
- ALWAYS include at least one question about human-in-the-loop approval
- ALWAYS include at least one question about memory/learning strategy
- Order questions from most critical to strategic
- Each question must have a unique id

Question categories to cover:
1. Credential mapping — which credentials for each service (only if user has relevant ones)
2. Configuration parameters — workflow-specific settings to customize
3. Human-in-the-Loop — for actions with external consequences, ask about manual approval
4. Memory & Learning — what should the persona remember across runs
5. Notification preferences — how to notify the user

After outputting the TRANSFORM_QUESTIONS block, STOP. Do not output anything else.

## PHASE 2: Generate persona JSON

If you decided no questions are needed, or if the user has already answered your questions
(they will be provided in a follow-up message), generate the full persona.

The Personas platform capabilities:
- Built-in LLM execution engine (no external LLM API tools needed)
- n8n "AI Agent", "LLM Chat Model", and "Output Parser" nodes should be absorbed into prompt logic
- Tools are external scripts for APIs (Gmail, Slack, HTTP, etc.)
- Triggers start the persona (schedule, webhook, polling, manual)

Credential Mapping Rules:
- "gmailOAuth2" → connector "google"
- "googleSheetsOAuth2Api" → connector "google"
- "slackOAuth2Api" or "slackApi" → connector "slack"
- "anthropicApi", "openAiApi" → NOT mapped (built-in LLM)
{connectors_section}{credentials_section}
Persona Protocol System (use in system_prompt):

1. User Messages: {{"user_message": {{"title": "string", "content": "string", "content_type": "text|markdown", "priority": "low|normal|high|critical"}}}}
2. Agent Memory: {{"agent_memory": {{"title": "string", "content": "string", "category": "fact|preference|instruction|context|learned", "importance": 1-10, "tags": ["tag1"]}}}}
3. Manual Review: {{"manual_review": {{"title": "string", "description": "string", "severity": "info|warning|error|critical", "context_data": "string", "suggested_actions": ["Approve", "Reject", "Edit"]}}}}
4. Events: {{"emit_event": {{"type": "event_name", "data": {{}}}}}}

Pattern Mapping:
- External actions → manual_review before executing
- Data processing → agent_memory to extract and store knowledge
- Recurring tasks → check memories before acting, store new patterns
- Notifications → user_message with appropriate priority
- Error handling → user_message with priority "critical"

Return ONLY valid JSON (no markdown fences, no commentary):
{{
  "persona": {{
    "name": "string",
    "description": "string",
    "system_prompt": "string — must include protocol message instructions",
    "structured_prompt": {{
      "identity": "string",
      "instructions": "string — core workflow logic with protocol messages woven in",
      "toolGuidance": "string",
      "examples": "string",
      "errorHandling": "string",
      "customSections": [{{"key": "string", "label": "string", "content": "string"}}]
    }},
    "icon": "Sparkles",
    "color": "#8b5cf6",
    "model_profile": null,
    "max_budget_usd": null,
    "max_turns": null,
    "design_context": "JSON string — a valid JSON string with keys: summary (string), use_cases (array of {{id, title, description, category}}). Generate 3-6 use_cases describing key capabilities.",
    "triggers": [{{"trigger_type": "schedule|polling|webhook|manual", "config": {{}}, "description": "string"}}],
    "tools": [{{"name": "tool_name_snake_case", "category": "email|http|database|file|messaging|other", "description": "string", "requires_credential_type": "connector_name_or_null", "input_schema": null}}],
    "required_connectors": [{{"name": "connector_name", "n8n_credential_type": "original_n8n_type", "has_credential": false}}]
  }}
}}

## Workflow Data

Workflow name: {workflow_name}
Parser result: {parser_result_json}
Original n8n JSON (first 5000 chars): {workflow_preview}
"##
    )
}

/// Extract questions JSON from unified prompt output. Looks for TRANSFORM_QUESTIONS marker.
pub(super) fn extract_questions_output(text: &str) -> Option<serde_json::Value> {
    let marker = "TRANSFORM_QUESTIONS";
    let marker_pos = text.find(marker)?;
    let after_marker = &text[marker_pos + marker.len()..];

    // Find the JSON array start
    let arr_start = after_marker.find('[')?;
    let arr_end = after_marker.rfind(']')?;
    if arr_start >= arr_end {
        return None;
    }
    let slice = &after_marker[arr_start..=arr_end];
    serde_json::from_str::<serde_json::Value>(slice).ok()
}

/// Parse persona output from Claude CLI text. Extracts JSON and deserializes.
pub(super) fn parse_persona_output(output_text: &str, workflow_name: &str) -> Result<N8nPersonaOutput, AppError> {
    let parsed_json = extract_first_json_object(output_text)
        .ok_or_else(|| AppError::Internal("Claude did not return valid JSON persona output".into()))?;

    let parsed_value: serde_json::Value = serde_json::from_str(&parsed_json)?;

    let persona_payload = parsed_value
        .get("persona")
        .cloned()
        .unwrap_or(parsed_value);

    let output: N8nPersonaOutput = serde_json::from_value(persona_payload)
        .map_err(|e| AppError::Internal(format!("Failed to parse transformed persona output: {e}")))?;

    Ok(normalize_n8n_persona_draft(output, workflow_name))
}

/// Handle the result from either adjustment or unified transform.
/// Second element in the Ok tuple is unused (reserved).
fn handle_transform_result(
    result: Result<(N8nPersonaOutput, bool), AppError>,
    app: &tauri::AppHandle,
    transform_id: &str,
    workflow_name: &str,
    session_id: Option<&str>,
) {
    match result {
        Ok((draft, _)) => {
            set_n8n_transform_draft(transform_id, &draft);
            set_n8n_transform_status(app, transform_id, "completed", None);
            crate::notifications::notify_n8n_transform_completed(app, workflow_name, true);
            if let Some(sid) = session_id {
                let state = app.state::<Arc<AppState>>();
                let draft_str = serde_json::to_string(&draft).unwrap_or_default();
                let _ = n8n_sessions::update(&state.db, sid, &UpdateN8nSessionInput {
                    status: Some("editing".into()),
                    step: Some("edit".into()),
                    draft_json: Some(Some(draft_str)),
                    error: Some(None),
                    ..Default::default()
                });
            }
        }
        Err(err) => {
            let msg = err.to_string();
            tracing::error!(transform_id = %transform_id, error = %msg, "n8n transform failed");
            set_n8n_transform_status(app, transform_id, "failed", Some(msg.clone()));
            crate::notifications::notify_n8n_transform_completed(app, workflow_name, false);
            if let Some(sid) = session_id {
                let state = app.state::<Arc<AppState>>();
                let _ = n8n_sessions::update(&state.db, sid, &UpdateN8nSessionInput {
                    status: Some("failed".into()),
                    error: Some(Some(msg)),
                    ..Default::default()
                });
            }
        }
    }
}

/// Turn 1 of unified transform: sends unified prompt to Sonnet.
/// Returns Ok((Some(draft), false)) if persona generated directly,
/// Ok((None, true)) if questions were produced and stored,
/// Ok((None, false)) if neither (error case).
async fn run_unified_transform_turn1(
    app: &tauri::AppHandle,
    transform_id: &str,
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    connectors_json: Option<&str>,
    credentials_json: Option<&str>,
) -> Result<(Option<N8nPersonaOutput>, bool), AppError> {
    tracing::info!(transform_id = %transform_id, "Starting unified transform Turn 1");

    let prompt_text = build_n8n_unified_prompt(
        workflow_name,
        workflow_json,
        parser_result_json,
        connectors_json,
        credentials_json,
    );

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Analyzing workflow and preparing transformation...",
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let (output_text, captured_session_id) =
        run_claude_prompt_text(prompt_text, &cli_args, Some((app, transform_id)))
            .await
            .map_err(AppError::Internal)?;

    // Store session ID for possible Turn 2
    if let Some(ref sid) = captured_session_id {
        set_n8n_transform_claude_session(transform_id, sid.clone());
    }

    // Check if output contains questions
    if let Some(questions) = extract_questions_output(&output_text) {
        tracing::info!(transform_id = %transform_id, "Turn 1 produced questions");
        set_n8n_transform_questions(transform_id, questions.clone());
        set_n8n_transform_status(app, transform_id, "awaiting_answers", None);
        emit_n8n_transform_line(
            app,
            transform_id,
            "[Milestone] Questions generated. Awaiting user answers...",
        );
        return Ok((None, true));
    }

    // No questions — try to parse persona output directly
    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let draft = parse_persona_output(&output_text, workflow_name)?;

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Draft ready for review.",
    );

    Ok((Some(draft), false))
}

/// Turn 2: resume the Claude session with user answers.
#[tauri::command]
pub async fn continue_n8n_transform(
    app: tauri::AppHandle,
    transform_id: String,
    user_answers_json: String,
    session_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let claude_session_id = get_n8n_transform_claude_session(&transform_id)
        .ok_or_else(|| AppError::NotFound("No Claude session found for this transform".into()))?;

    // Update job state
    {
        let mut jobs = lock_jobs()?;
        if let Some(job) = jobs.get_mut(&transform_id) {
            job.status = "running".into();
            job.error = None;
        }
    }
    set_n8n_transform_status(&app, &transform_id, "running", None);

    let cancel_token = CancellationToken::new();
    {
        let mut jobs = lock_jobs()?;
        if let Some(job) = jobs.get_mut(&transform_id) {
            job.cancel_token = Some(cancel_token.clone());
        }
    }

    let app_handle = app.clone();
    let transform_id_for_task = transform_id.clone();
    let token_for_task = cancel_token;
    let session_id_for_task = session_id;

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Transform cancelled by user".into()))
            }
            res = run_continue_transform(
                &app_handle,
                &transform_id_for_task,
                &claude_session_id,
                &user_answers_json,
            ) => res
        };

        // Re-use handle_transform_result for standard success/failure handling
        handle_transform_result(
            result.map(|d| (d, false)),
            &app_handle,
            &transform_id_for_task,
            "n8n workflow", // workflow_name not available here, use generic
            session_id_for_task.as_deref(),
        );
    });

    Ok(json!({ "transform_id": transform_id }))
}

/// Execute Turn 2 of the unified transform: resume Claude session with user answers.
async fn run_continue_transform(
    app: &tauri::AppHandle,
    transform_id: &str,
    claude_session_id: &str,
    user_answers_json: &str,
) -> Result<N8nPersonaOutput, AppError> {
    tracing::info!(transform_id = %transform_id, "Starting unified transform Turn 2 (resume)");

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Resuming session with your answers. Generating persona draft...",
    );

    let prompt_text = format!(
        r#"Here are the user's answers to your questions:

{}

Now proceed to PHASE 2. Generate the full persona JSON based on the workflow analysis and the user's answers above.
Remember: return ONLY valid JSON with the persona object, no markdown fences."#,
        user_answers_json
    );

    let mut cli_args = prompt::build_resume_cli_args(claude_session_id);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let (output_text, _) = run_claude_prompt_text(prompt_text, &cli_args, Some((app, transform_id)))
        .await
        .map_err(AppError::Internal)?;

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let draft = parse_persona_output(&output_text, "n8n workflow")?;

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Draft ready for review. Confirm save is required to persist.",
    );

    Ok(draft)
}

#[allow(clippy::too_many_arguments)]
async fn run_n8n_transform_job(
    app: &tauri::AppHandle,
    transform_id: &str,
    workflow_name: &str,
    workflow_json: &str,
    parser_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
    connectors_json: Option<&str>,
    credentials_json: Option<&str>,
    user_answers_json: Option<&str>,
) -> Result<N8nPersonaOutput, AppError> {
    tracing::info!(
        transform_id = %transform_id,
        workflow_name = %workflow_name,
        workflow_json_len = workflow_json.len(),
        parser_result_len = parser_result_json.len(),
        "Starting n8n transform job"
    );

    let prompt_text = build_n8n_transform_prompt(
        workflow_name,
        workflow_json,
        parser_result_json,
        adjustment_request,
        previous_draft_json,
        connectors_json,
        credentials_json,
        user_answers_json,
    );

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Static workflow parsing complete. Preparing Claude transformation prompt...",
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    emit_n8n_transform_line(
        app,
        transform_id,
        "[Milestone] Claude CLI started. Generating persona draft...",
    );

    let (output_text, _session_id) = run_claude_prompt_text(prompt_text, &cli_args, Some((app, transform_id)))
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

pub(super) fn should_surface_n8n_output_line(line: &str) -> bool {
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

/// Convenience wrapper with a custom timeout in seconds.
/// Returns (text_output, captured_claude_session_id).
pub(super) async fn run_claude_prompt_text_with_timeout(
    prompt_text: String,
    cli_args: &crate::engine::types::CliArgs,
    emit_ctx: Option<(&tauri::AppHandle, &str)>,
    timeout_secs: u64,
) -> Result<(String, Option<String>), String> {
    #[allow(clippy::type_complexity)]
    let on_line: Option<Box<dyn Fn(&str) + Send + Sync>> = emit_ctx.map(|(app, id)| {
        let app = app.clone();
        let id = id.to_string();
        Box::new(move |line: &str| {
            emit_n8n_transform_line(&app, &id, line.to_string());
        }) as Box<dyn Fn(&str) + Send + Sync>
    });
    run_claude_prompt_text_inner(prompt_text, cli_args, on_line.as_deref(), timeout_secs).await
}

/// Returns (text_output, captured_claude_session_id).
pub(super) async fn run_claude_prompt_text(
    prompt_text: String,
    cli_args: &crate::engine::types::CliArgs,
    emit_ctx: Option<(&tauri::AppHandle, &str)>,
) -> Result<(String, Option<String>), String> {
    #[allow(clippy::type_complexity)]
    let on_line: Option<Box<dyn Fn(&str) + Send + Sync>> = emit_ctx.map(|(app, id)| {
        let app = app.clone();
        let id = id.to_string();
        Box::new(move |line: &str| {
            emit_n8n_transform_line(&app, &id, line.to_string());
        }) as Box<dyn Fn(&str) + Send + Sync>
    });
    run_claude_prompt_text_inner(prompt_text, cli_args, on_line.as_deref(), 420).await
}

/// Core Claude CLI process spawning with stdout streaming, timeout, and line emission.
///
/// The `on_line` callback is invoked for each surfaceable output line (after dedup
/// and filtering). Callers provide their own emission logic (e.g. template-adopt
/// events or n8n-transform events).
pub(super) async fn run_claude_prompt_text_inner(
    prompt_text: String,
    cli_args: &crate::engine::types::CliArgs,
    on_line: Option<&(dyn Fn(&str) + Send + Sync)>,
    timeout_secs: u64,
) -> Result<(String, Option<String>), String> {
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
    let mut captured_session_id: Option<String> = None;

    let timeout_duration = std::time::Duration::from_secs(timeout_secs);
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            // Try to capture session_id from stream-json events
            if captured_session_id.is_none() {
                let (line_type, _) = parse_stream_line(&line);
                match line_type {
                    StreamLineType::SystemInit { session_id: Some(sid), .. }
                    | StreamLineType::Result { session_id: Some(sid), .. } => {
                        captured_session_id = Some(sid);
                    }
                    _ => {}
                }
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
                    if let Some(emit) = on_line {
                        emit(trimmed);
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
        return Err(format!("Claude CLI timed out after {} seconds", timeout_secs));
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
        return Err("Claude produced no output".into());
    }

    Ok((text_output, captured_session_id))
}

pub(super) fn extract_first_json_object(input: &str) -> Option<String> {
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
