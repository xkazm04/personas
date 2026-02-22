use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

use std::sync::Arc;

use crate::db::repos::core::personas as persona_repo;
use crate::db::models::CreatePersonaInput;
use crate::engine::prompt;
use crate::error::AppError;
use crate::AppState;

use super::n8n_transform::{
    extract_first_json_object, normalize_n8n_persona_draft, run_claude_prompt_text,
    run_claude_prompt_text_inner, N8nPersonaOutput,
};

// ── Event payloads ──────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct TemplateAdoptOutputEvent {
    adopt_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct TemplateAdoptStatusEvent {
    adopt_id: String,
    status: String,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
struct TemplateAdoptSnapshot {
    adopt_id: String,
    status: String,
    error: Option<String>,
    lines: Vec<String>,
    draft: Option<serde_json::Value>,
}

const JOB_TTL_SECS: u64 = 30 * 60; // 30 minutes

#[derive(Clone)]
struct TemplateAdoptJobState {
    status: String,
    error: Option<String>,
    lines: Vec<String>,
    draft: Option<serde_json::Value>,
    cancel_token: Option<CancellationToken>,
    created_at: Instant,
}

impl Default for TemplateAdoptJobState {
    fn default() -> Self {
        Self {
            status: String::new(),
            error: None,
            lines: Vec::new(),
            draft: None,
            cancel_token: None,
            created_at: Instant::now(),
        }
    }
}

static TEMPLATE_ADOPT_JOBS: OnceLock<Mutex<HashMap<String, TemplateAdoptJobState>>> =
    OnceLock::new();

fn adopt_jobs() -> &'static Mutex<HashMap<String, TemplateAdoptJobState>> {
    TEMPLATE_ADOPT_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_adopt_jobs() -> Result<std::sync::MutexGuard<'static, HashMap<String, TemplateAdoptJobState>>, AppError> {
    adopt_jobs()
        .lock()
        .map_err(|_| AppError::Internal("template adopt job lock poisoned".into()))
}

/// Remove non-running job entries older than `JOB_TTL_SECS`.
/// Called on each new job insert to prevent unbounded memory growth.
fn evict_stale_adopt_jobs(jobs: &mut HashMap<String, TemplateAdoptJobState>) {
    let cutoff = std::time::Duration::from_secs(JOB_TTL_SECS);
    jobs.retain(|_, job| job.status == "running" || job.created_at.elapsed() < cutoff);
}

fn set_adopt_status(
    app: &tauri::AppHandle,
    adopt_id: &str,
    status: &str,
    error: Option<String>,
) {
    if let Ok(mut jobs) = lock_adopt_jobs() {
        let entry = jobs
            .entry(adopt_id.to_string())
            .or_insert_with(TemplateAdoptJobState::default);
        entry.status = status.to_string();
        entry.error = error.clone();
    }

    let _ = app.emit(
        "template-adopt-status",
        TemplateAdoptStatusEvent {
            adopt_id: adopt_id.to_string(),
            status: status.to_string(),
            error,
        },
    );
}

fn emit_adopt_line(app: &tauri::AppHandle, adopt_id: &str, line: impl Into<String>) {
    let line = line.into();
    if let Ok(mut jobs) = lock_adopt_jobs() {
        let entry = jobs
            .entry(adopt_id.to_string())
            .or_insert_with(TemplateAdoptJobState::default);
        if entry.lines.len() < 500 {
            entry.lines.push(line.clone());
        }
    }

    let _ = app.emit(
        "template-adopt-output",
        TemplateAdoptOutputEvent {
            adopt_id: adopt_id.to_string(),
            line,
        },
    );
}

fn set_adopt_draft(adopt_id: &str, draft: &N8nPersonaOutput) {
    if let Ok(serialized) = serde_json::to_value(draft) {
        if let Ok(mut jobs) = lock_adopt_jobs() {
            let entry = jobs
                .entry(adopt_id.to_string())
                .or_insert_with(TemplateAdoptJobState::default);
            entry.draft = Some(serialized);
        }
    }
}

fn get_adopt_snapshot_internal(adopt_id: &str) -> Option<TemplateAdoptSnapshot> {
    let jobs = lock_adopt_jobs().ok()?;
    jobs.get(adopt_id).map(|job| TemplateAdoptSnapshot {
        adopt_id: adopt_id.to_string(),
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

// ── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_template_adopt_background(
    app: tauri::AppHandle,
    adopt_id: String,
    template_name: String,
    design_result_json: String,
    adjustment_request: Option<String>,
    previous_draft_json: Option<String>,
    user_answers_json: Option<String>,
) -> Result<serde_json::Value, AppError> {
    if design_result_json.trim().is_empty() {
        return Err(AppError::Validation(
            "Design result JSON cannot be empty".into(),
        ));
    }

    let cancel_token = CancellationToken::new();

    {
        let mut jobs = lock_adopt_jobs()?;
        evict_stale_adopt_jobs(&mut jobs);
        if let Some(existing) = jobs.get(&adopt_id) {
            if existing.status == "running" {
                return Err(AppError::Validation(
                    "Adoption transform is already running".into(),
                ));
            }
        }
        jobs.insert(
            adopt_id.clone(),
            TemplateAdoptJobState {
                status: "running".into(),
                error: None,
                lines: Vec::new(),
                draft: None,
                cancel_token: Some(cancel_token.clone()),
                created_at: Instant::now(),
            },
        );
    }

    set_adopt_status(&app, &adopt_id, "running", None);

    let app_handle = app.clone();
    let adopt_id_for_task = adopt_id.clone();
    let token_for_task = cancel_token.clone();
    let template_name_clone = template_name.clone();

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Adoption cancelled by user".into()))
            }
            res = run_template_adopt_job(
                &app_handle,
                &adopt_id_for_task,
                &template_name,
                &design_result_json,
                adjustment_request.as_deref(),
                previous_draft_json.as_deref(),
                user_answers_json.as_deref(),
            ) => res
        };

        match result {
            Ok(draft) => {
                set_adopt_draft(&adopt_id_for_task, &draft);
                set_adopt_status(&app_handle, &adopt_id_for_task, "completed", None);
                crate::notifications::notify_n8n_transform_completed(
                    &app_handle,
                    &template_name_clone,
                    true,
                );
            }
            Err(err) => {
                let msg = err.to_string();
                set_adopt_status(&app_handle, &adopt_id_for_task, "failed", Some(msg));
                crate::notifications::notify_n8n_transform_completed(
                    &app_handle,
                    &template_name_clone,
                    false,
                );
            }
        }
    });

    Ok(json!({ "adopt_id": adopt_id }))
}

#[tauri::command]
pub fn get_template_adopt_snapshot(adopt_id: String) -> Result<serde_json::Value, AppError> {
    let snapshot = get_adopt_snapshot_internal(&adopt_id)
        .ok_or_else(|| AppError::NotFound("Template adoption not found".into()))?;
    Ok(serde_json::to_value(snapshot).unwrap_or_else(|_| json!({})))
}

#[tauri::command]
pub fn clear_template_adopt_snapshot(adopt_id: String) -> Result<(), AppError> {
    let mut jobs = lock_adopt_jobs()?;
    jobs.remove(&adopt_id);
    Ok(())
}

#[tauri::command]
pub fn cancel_template_adopt(
    app: tauri::AppHandle,
    adopt_id: String,
) -> Result<(), AppError> {
    let token = {
        let jobs = lock_adopt_jobs()?;
        jobs.get(&adopt_id)
            .and_then(|job| job.cancel_token.clone())
    };

    if let Some(token) = token {
        token.cancel();
    }

    set_adopt_status(&app, &adopt_id, "failed", Some("Cancelled by user".into()));
    Ok(())
}

#[tauri::command]
pub fn confirm_template_adopt_draft(
    state: State<'_, Arc<AppState>>,
    draft_json: String,
) -> Result<serde_json::Value, AppError> {
    let draft: N8nPersonaOutput = serde_json::from_str(&draft_json)
        .map_err(|e| AppError::Validation(format!("Invalid draft JSON: {e}")))?;

    let draft = normalize_n8n_persona_draft(draft, "Adopted Template");

    if draft.system_prompt.trim().is_empty() {
        return Err(AppError::Validation(
            "Draft system_prompt cannot be empty".into(),
        ));
    }

    let created = persona_repo::create(
        &state.db,
        CreatePersonaInput {
            name: draft
                .name
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| "Adopted Template".into()),
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

// ── Question Generation ─────────────────────────────────────────

#[tauri::command]
pub async fn generate_template_adopt_questions(
    template_name: String,
    design_result_json: String,
) -> Result<serde_json::Value, AppError> {
    if design_result_json.trim().is_empty() {
        return Err(AppError::Validation(
            "Design result JSON cannot be empty".into(),
        ));
    }

    let design_preview = if design_result_json.len() > 8000 {
        &design_result_json[..design_result_json.floor_char_boundary(8000)]
    } else {
        &design_result_json
    };

    let prompt = format!(
        r##"Analyze this template design and generate 4-8 clarifying questions for the user
before adopting it into a Personas agent.

The Personas platform has these unique capabilities:
- A built-in LLM execution engine (no external LLM API tools needed)
- Protocol messages that let the persona communicate with the user mid-execution
- A memory system where the persona stores knowledge for future runs (self-improvement)
- Manual review gates where the persona pauses for human approval before acting
- Inter-persona events for multi-agent coordination

Generate questions across these categories:

## 1. Credential Mapping
Which existing credentials or connectors should be used for each service?
Only ask if the template references external services or connectors.

## 2. Configuration Parameters
Template-specific settings the user should customize
(e.g., scheduling preferences, notification thresholds, output formats).

## 3. Architecture Decisions
How should the persona handle its core tasks? Ask about operational
preferences like batch vs. real-time processing, concurrency limits, etc.

## 4. Human-in-the-Loop (IMPORTANT)
For any template action that has external consequences (sending emails, posting messages,
modifying databases, calling external APIs that change state), ask whether the user wants
the persona to request manual approval before executing that action.
Example: "Should the persona draft emails and wait for your approval before sending,
or send automatically?"
Example: "Should data modifications be reviewed before applying?"

## 5. Memory & Learning (IMPORTANT)
For templates that process data, ask what information the user wants the persona
to remember across runs for self-improvement.
Example: "Should the persona remember key patterns from processed data?"
Example: "Should the persona learn and remember rules it discovers during operation?"

## 6. Notification Preferences
How should the persona notify the user about important events?
Example: "Should you receive a summary message after each run, or only on errors?"
Example: "What priority level should status updates use?"

Template name: {template_name}
Design analysis (first 8000 chars): {design_preview}

Return ONLY valid JSON (no markdown fences), with this exact shape:
[{{
  "id": "unique_id",
  "question": "Which credential should be used for Gmail access?",
  "type": "select",
  "options": ["Option 1", "Option 2"],
  "default": "Option 1",
  "context": "The template uses Gmail integration for 3 tools"
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
    );

    let mut cli_args = crate::engine::prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-haiku-4-5-20251001".to_string());

    let (output, _session_id) = run_claude_prompt_text(prompt, &cli_args, None)
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
        .ok_or_else(|| {
            AppError::Internal("No valid JSON in question generation output".into())
        })?;

    let questions: serde_json::Value = serde_json::from_str(&json_str)?;
    Ok(questions)
}

// ── Template adopt job ──────────────────────────────────────────

fn build_template_adopt_prompt(
    template_name: &str,
    design_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
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

    let user_answers_section = user_answers_json
        .filter(|a| !a.trim().is_empty() && a.trim() != "{}")
        .map(|a| format!(
            "\n## User Configuration Answers\nThe user has provided these answers to clarify the adoption. Honor these answers when generating the persona configuration:\n{}\n", a
        ))
        .unwrap_or_default();

    format!(
        r##"You are a senior Personas architect.

Transform the following template design into a production-ready Persona configuration.
The template includes a complete design analysis with structured prompt sections,
suggested tools, triggers, connectors, notification channels, and event subscriptions.

## App Capabilities (Personas Platform)
- Personas has a built-in LLM execution engine. Do NOT suggest external LLM API tools.
- Protocol messages let the persona communicate with the user mid-execution
- A memory system where the persona stores knowledge for future runs (self-improvement)
- Manual review gates where the persona pauses for human approval before acting
- Inter-persona events for multi-agent coordination

## Persona Protocol System (use these in the system prompt)

### Protocol 1: User Messages (notify the user)
Output this JSON on its own line to send a message to the user:
{{"user_message": {{"title": "string", "content": "string", "content_type": "text|markdown", "priority": "low|normal|high|critical"}}}}

### Protocol 2: Agent Memory (persist knowledge for future runs)
Output this JSON on its own line to save a memory:
{{"agent_memory": {{"title": "string", "content": "string", "category": "fact|preference|instruction|context|learned", "importance": 1-10, "tags": ["tag1"]}}}}

### Protocol 3: Manual Review (human-in-the-loop approval gate)
Output this JSON on its own line to request human approval:
{{"manual_review": {{"title": "string", "description": "string", "severity": "info|warning|error|critical", "context_data": "string", "suggested_actions": ["Approve", "Reject", "Edit"]}}}}

### Protocol 4: Events (inter-persona communication)
Output this JSON to trigger other personas or emit custom events:
{{"emit_event": {{"type": "event_name", "data": {{}}}}}}

Your job:
1. Analyze the template's character, purpose, and operational requirements.
2. Preserve the structured prompt architecture (identity, instructions, toolGuidance,
   examples, errorHandling, customSections) — these are the core of the persona's behavior.
3. Incorporate all suggested tools, triggers, and connector references into the design context.
4. Use the full_prompt_markdown as the system_prompt foundation.
5. Ensure the persona is self-contained and actionable.
6. Apply any user adjustment requests and configuration answers to customize the template.
7. Embed protocol message instructions (user_message, agent_memory, manual_review) in the
   system_prompt and structured_prompt wherever the template involves human interaction,
   knowledge persistence, or approval gates.
8. Add a "Human-in-the-Loop" customSection when the template performs externally-visible actions.
9. Add a "Memory Strategy" customSection when the template processes data that could inform future runs.

Return ONLY valid JSON (no markdown fences, no commentary), with this exact shape:
{{
  "persona": {{
    "name": "string",
    "description": "string (2-3 sentence summary)",
    "system_prompt": "string (the full_prompt_markdown content, preserving all formatting, with protocol instructions woven in)",
    "structured_prompt": {{
      "identity": "string",
      "instructions": "string — core logic with protocol messages woven in",
      "toolGuidance": "string — how to use each tool, including when to request manual_review",
      "examples": "string — include examples of protocol message usage",
      "errorHandling": "string — include user_message notifications for critical errors",
      "customSections": [{{ "key": "string", "label": "string", "content": "string" }}]
    }},
    "icon": "string (lucide icon name)",
    "color": "#hex",
    "model_profile": null,
    "max_budget_usd": null,
    "max_turns": null,
    "design_context": "string (brief summary of the template's capabilities and integrations)"
  }}
}}

Template name:
{template_name}

Design Analysis Result JSON:
{design_result_json}

{adjustment_section}
{previous_draft_section}
{user_answers_section}
"##
    )
}

async fn run_template_adopt_job(
    app: &tauri::AppHandle,
    adopt_id: &str,
    template_name: &str,
    design_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
    user_answers_json: Option<&str>,
) -> Result<N8nPersonaOutput, AppError> {
    let prompt_text = build_template_adopt_prompt(
        template_name,
        design_result_json,
        adjustment_request,
        previous_draft_json,
        user_answers_json,
    );

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Preparing Claude transformation prompt for template adoption...",
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Claude CLI started. Generating persona draft from template...",
    );

    let app_for_emit = app.clone();
    let adopt_id_for_emit = adopt_id.to_string();
    let on_line = move |line: &str| {
        emit_adopt_line(&app_for_emit, &adopt_id_for_emit, line.to_string());
    };
    let (output_text, _session_id) =
        run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&on_line), 420)
            .await
            .map_err(AppError::Internal)?;

    let parsed_json = extract_first_json_object(&output_text)
        .ok_or_else(|| {
            AppError::Internal("Claude did not return valid JSON persona output".into())
        })?;

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let parsed_value: serde_json::Value = serde_json::from_str(&parsed_json)?;

    let persona_payload = parsed_value
        .get("persona")
        .cloned()
        .unwrap_or(parsed_value);

    let output: N8nPersonaOutput = serde_json::from_value(persona_payload).map_err(|e| {
        AppError::Internal(format!(
            "Failed to parse adopted persona output: {e}"
        ))
    })?;
    let draft = normalize_n8n_persona_draft(output, template_name);

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Draft ready for review. Confirm save is required to persist.",
    );

    Ok(draft)
}

