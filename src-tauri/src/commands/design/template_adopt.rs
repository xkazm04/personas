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
    extract_first_json_object, extract_questions_output, normalize_n8n_persona_draft,
    parse_persona_output, run_claude_prompt_text_inner, N8nPersonaOutput,
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
    questions: Option<serde_json::Value>,
}

const JOB_TTL_SECS: u64 = 30 * 60; // 30 minutes

#[derive(Clone)]
struct TemplateAdoptJobState {
    status: String,
    error: Option<String>,
    lines: Vec<String>,
    draft: Option<serde_json::Value>,
    cancel_token: Option<CancellationToken>,
    claude_session_id: Option<String>,
    questions: Option<serde_json::Value>,
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
            claude_session_id: None,
            questions: None,
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

fn set_adopt_questions(adopt_id: &str, questions: serde_json::Value) {
    if let Ok(mut jobs) = lock_adopt_jobs() {
        let entry = jobs
            .entry(adopt_id.to_string())
            .or_insert_with(TemplateAdoptJobState::default);
        entry.questions = Some(questions);
    }
}

fn set_adopt_claude_session(adopt_id: &str, session_id: String) {
    if let Ok(mut jobs) = lock_adopt_jobs() {
        let entry = jobs
            .entry(adopt_id.to_string())
            .or_insert_with(TemplateAdoptJobState::default);
        entry.claude_session_id = Some(session_id);
    }
}

fn get_adopt_claude_session(adopt_id: &str) -> Option<String> {
    let jobs = lock_adopt_jobs().ok()?;
    jobs.get(adopt_id)?.claude_session_id.clone()
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
        questions: job.questions.clone(),
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
                claude_session_id: None,
                questions: None,
                created_at: Instant::now(),
            },
        );
    }

    set_adopt_status(&app, &adopt_id, "running", None);

    // Determine if this is an adjustment re-run or initial transform
    let is_adjustment = adjustment_request.as_ref().is_some_and(|a| !a.trim().is_empty())
        || previous_draft_json.as_ref().is_some_and(|d| !d.trim().is_empty());

    let app_handle = app.clone();
    let adopt_id_for_task = adopt_id.clone();
    let token_for_task = cancel_token.clone();
    let template_name_clone = template_name.clone();

    tokio::spawn(async move {
        if is_adjustment {
            // ── Adjustment re-run: single-prompt path (no interactive questions) ──
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

            handle_adopt_result(
                result.map(|d| (d, false)),
                &app_handle,
                &adopt_id_for_task,
                &template_name_clone,
            );
        } else {
            // ── Initial transform: unified prompt (may produce questions or persona) ──
            let result = tokio::select! {
                _ = token_for_task.cancelled() => {
                    Err(AppError::Internal("Adoption cancelled by user".into()))
                }
                res = run_unified_adopt_turn1(
                    &app_handle,
                    &adopt_id_for_task,
                    &template_name,
                    &design_result_json,
                ) => res
            };

            match result {
                Ok((Some(draft), _)) => {
                    // Model skipped questions and produced persona directly
                    handle_adopt_result(
                        Ok((draft, false)),
                        &app_handle,
                        &adopt_id_for_task,
                        &template_name_clone,
                    );
                }
                Ok((None, true)) => {
                    // Questions were produced and stored — status is awaiting_answers
                    // Frontend will poll and pick up the questions
                }
                Ok((None, false)) => {
                    // No questions and no persona — unusual, treat as failure
                    handle_adopt_result(
                        Err(AppError::Internal("No output from unified transform".into())),
                        &app_handle,
                        &adopt_id_for_task,
                        &template_name_clone,
                    );
                }
                Err(err) => {
                    handle_adopt_result(
                        Err(err),
                        &app_handle,
                        &adopt_id_for_task,
                        &template_name_clone,
                    );
                }
            }
        }
    });

    Ok(json!({ "adopt_id": adopt_id }))
}

/// Turn 2: resume the Claude session with user answers.
#[tauri::command]
pub async fn continue_template_adopt(
    app: tauri::AppHandle,
    adopt_id: String,
    user_answers_json: String,
) -> Result<serde_json::Value, AppError> {
    let claude_session_id = get_adopt_claude_session(&adopt_id)
        .ok_or_else(|| AppError::NotFound("No Claude session found for this adoption".into()))?;

    // Update job state
    {
        let mut jobs = lock_adopt_jobs()?;
        if let Some(job) = jobs.get_mut(&adopt_id) {
            job.status = "running".into();
            job.error = None;
        }
    }
    set_adopt_status(&app, &adopt_id, "running", None);

    let cancel_token = CancellationToken::new();
    {
        let mut jobs = lock_adopt_jobs()?;
        if let Some(job) = jobs.get_mut(&adopt_id) {
            job.cancel_token = Some(cancel_token.clone());
        }
    }

    let app_handle = app.clone();
    let adopt_id_for_task = adopt_id.clone();
    let token_for_task = cancel_token;

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Adoption cancelled by user".into()))
            }
            res = run_continue_adopt(
                &app_handle,
                &adopt_id_for_task,
                &claude_session_id,
                &user_answers_json,
            ) => res
        };

        handle_adopt_result(
            result.map(|d| (d, false)),
            &app_handle,
            &adopt_id_for_task,
            "adopted template",
        );
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
                .as_ref()
                .filter(|n| !n.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| "Adopted Template".into()),
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
            notification_channels: draft.notification_channels.clone(),
        },
    )?;

    Ok(json!({ "persona": created }))
}

// ── Instant Adopt (no AI transform — creates persona directly from design) ──

#[tauri::command]
pub fn instant_adopt_template(
    state: State<'_, Arc<AppState>>,
    template_name: String,
    design_result_json: String,
) -> Result<serde_json::Value, AppError> {
    if design_result_json.trim().is_empty() {
        return Err(AppError::Validation(
            "Design result JSON cannot be empty".into(),
        ));
    }

    let design: serde_json::Value = serde_json::from_str(&design_result_json)
        .map_err(|e| AppError::Validation(format!("Invalid design result JSON: {e}")))?;

    let full_prompt = design
        .get("full_prompt_markdown")
        .and_then(|v| v.as_str())
        .unwrap_or("You are a helpful AI assistant.")
        .to_string();

    let summary = design
        .get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| Some(format!("Adopted from template: {}", template_name)));

    let structured_prompt = design.get("structured_prompt").map(|v| v.to_string());

    // Extract optional persona metadata from design result
    let persona_meta = design.get("persona_meta");
    let icon = persona_meta
        .and_then(|m| m.get("icon"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let color = persona_meta
        .and_then(|m| m.get("color"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let model_profile = persona_meta
        .and_then(|m| m.get("model_profile"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let persona_name = persona_meta
        .and_then(|m| m.get("name"))
        .and_then(|v| v.as_str())
        .filter(|n| !n.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or(template_name);

    let persona = persona_repo::create(
        &state.db,
        CreatePersonaInput {
            name: persona_name,
            system_prompt: full_prompt,
            project_id: None,
            description: summary,
            structured_prompt,
            icon,
            color,
            enabled: Some(true),
            max_concurrent: None,
            timeout_ms: None,
            model_profile,
            max_budget_usd: None,
            max_turns: None,
            design_context: Some(design_result_json),
            group_id: None,
            notification_channels: None,
        },
    )?;

    Ok(json!({ "persona": persona }))
}

// ── Question Generation (fallback for direct calls) ─────────────

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
        let mut end = 8000;
        while !design_result_json.is_char_boundary(end) {
            end -= 1;
        }
        &design_result_json[..end]
    } else {
        &design_result_json
    };

    let prompt_text = format!(
        r##"Analyze this template design and generate 4-8 clarifying questions for the user
before adopting it into a Personas agent.

The Personas platform has these unique capabilities:
- A built-in LLM execution engine (no external LLM API tools needed)
- Protocol messages that let the persona communicate with the user mid-execution
- A memory system where the persona stores knowledge for future runs (self-improvement)
- Manual review gates where the persona pauses for human approval before acting
- Inter-persona events for multi-agent coordination

Generate questions across these categories:

## 1. Credential Mapping (IMPORTANT)
For each connector listed in the template's suggested_connectors, ask which specific
credentials the user wants to use. Templates now include detailed connector information
with auth_type and credential_fields.

For each connector that uses http_request (e.g., Slack, GitHub, Jira, Stripe, Notion):
- Ask if the user has an existing API key/token for that service
- Present the specific credential fields needed (from the connector's credential_fields)
- Offer to help set up a new credential if they don't have one
- Ask which specific instance/workspace/project to connect to

Example: "This template uses the GitHub connector (Personal Access Token). Do you have
a GitHub PAT configured, or should we set one up? Which repository should it monitor?"
Example: "The Slack connector needs a Bot Token. Which Slack workspace should this
persona post to? Do you have an existing Slack Bot Token?"
Example: "This template connects to Notion (Integration Token). Which Notion workspace
and databases should it access?"

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

    let (output, _session_id) = run_claude_prompt_text_inner(prompt_text, &cli_args, None, 90)
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

// ── Helpers ─────────────────────────────────────────────────────

/// Handle the result from either adjustment or unified transform.
fn handle_adopt_result(
    result: Result<(N8nPersonaOutput, bool), AppError>,
    app: &tauri::AppHandle,
    adopt_id: &str,
    template_name: &str,
) {
    match result {
        Ok((draft, _)) => {
            set_adopt_draft(adopt_id, &draft);
            set_adopt_status(app, adopt_id, "completed", None);
            crate::notifications::notify_n8n_transform_completed(app, template_name, true);
        }
        Err(err) => {
            let msg = err.to_string();
            tracing::error!(adopt_id = %adopt_id, error = %msg, "template adoption failed");
            set_adopt_status(app, adopt_id, "failed", Some(msg));
            crate::notifications::notify_n8n_transform_completed(app, template_name, false);
        }
    }
}

// ── Unified prompt (Turn 1: may ask questions or generate persona) ──

fn build_template_adopt_unified_prompt(
    template_name: &str,
    design_result_json: &str,
) -> String {
    let design_preview = if design_result_json.len() > 8000 {
        &design_result_json[..8000]
    } else {
        design_result_json
    };

    format!(
        r##"You are a senior Personas architect. You will analyze a template design and either ask
clarifying questions OR generate a persona directly.

## PHASE 1: Analyze the template

Look at the design analysis below. Decide whether you need clarification from the user.

If the template is complex (has external service integrations, multiple connectors,
ambiguous configuration choices, or actions with external consequences), you MUST ask 4-8 questions.

If the template is simple and self-explanatory (e.g., a simple manual-triggered agent with
no external services), skip questions and go directly to PHASE 2.

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
1. Credential mapping — which credentials for each service (only if the template references external services)
2. Configuration parameters — template-specific settings to customize
3. Human-in-the-Loop — for actions with external consequences, ask about manual approval
4. Memory & Learning — what should the persona remember across runs
5. Notification preferences — how to notify the user

After outputting the TRANSFORM_QUESTIONS block, STOP. Do not output anything else.

## PHASE 2: Generate persona JSON

If you decided no questions are needed, or if the user has already answered your questions
(they will be provided in a follow-up message), generate the full persona.

The Personas platform capabilities:
- Built-in LLM execution engine (no external LLM API tools needed)
- Protocol messages: user_message, agent_memory, manual_review, emit_event
- Templates include structured prompts with identity, instructions, toolGuidance, examples, errorHandling, customSections

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

Your job:
1. Analyze the template's character, purpose, and operational requirements.
2. Preserve the structured prompt architecture (identity, instructions, toolGuidance,
   examples, errorHandling, customSections) — these are the core of the persona's behavior.
3. Incorporate all suggested tools, triggers, and connector references into the design context.
4. Use the full_prompt_markdown as the system_prompt foundation.
5. Ensure the persona is self-contained and actionable.
6. Embed protocol message instructions in the system_prompt and structured_prompt wherever
   the template involves human interaction, knowledge persistence, or approval gates.
7. Add a "Human-in-the-Loop" customSection when the template performs externally-visible actions.
8. Add a "Memory Strategy" customSection when the template processes data that could inform future runs.

Return ONLY valid JSON (no markdown fences, no commentary):
{{
  "persona": {{
    "name": "string",
    "description": "string (2-3 sentence summary)",
    "system_prompt": "string — must include protocol message instructions",
    "structured_prompt": {{
      "identity": "string",
      "instructions": "string — core logic with protocol messages woven in",
      "toolGuidance": "string",
      "examples": "string",
      "errorHandling": "string",
      "customSections": [{{"key": "string", "label": "string", "content": "string"}}]
    }},
    "icon": "string (lucide icon name)",
    "color": "#hex",
    "model_profile": null,
    "max_budget_usd": null,
    "max_turns": null,
    "design_context": "string (brief summary of the template's capabilities and integrations)"
  }}
}}

## Template Data

Template name: {template_name}
Design analysis (first 8000 chars): {design_preview}
"##
    )
}

/// Turn 1 of unified template adopt: sends unified prompt to Sonnet.
/// Returns Ok((Some(draft), false)) if persona generated directly,
/// Ok((None, true)) if questions were produced and stored,
/// Ok((None, false)) if neither (error case).
async fn run_unified_adopt_turn1(
    app: &tauri::AppHandle,
    adopt_id: &str,
    template_name: &str,
    design_result_json: &str,
) -> Result<(Option<N8nPersonaOutput>, bool), AppError> {
    tracing::info!(adopt_id = %adopt_id, "Starting unified adopt Turn 1");

    let prompt_text = build_template_adopt_unified_prompt(
        template_name,
        design_result_json,
    );

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Analyzing template and preparing transformation...",
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let app_for_emit = app.clone();
    let adopt_id_for_emit = adopt_id.to_string();
    let on_line = move |line: &str| {
        emit_adopt_line(&app_for_emit, &adopt_id_for_emit, line.to_string());
    };
    let (output_text, captured_session_id) =
        run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&on_line), 420)
            .await
            .map_err(AppError::Internal)?;

    // Store session ID for possible Turn 2
    if let Some(ref sid) = captured_session_id {
        set_adopt_claude_session(adopt_id, sid.clone());
    }

    // Check if output contains questions
    if let Some(questions) = extract_questions_output(&output_text) {
        tracing::info!(adopt_id = %adopt_id, "Turn 1 produced questions");
        set_adopt_questions(adopt_id, questions.clone());
        set_adopt_status(app, adopt_id, "awaiting_answers", None);
        emit_adopt_line(
            app,
            adopt_id,
            "[Milestone] Questions generated. Awaiting user answers...",
        );
        return Ok((None, true));
    }

    // No questions — try to parse persona output directly
    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let draft = parse_persona_output(&output_text, template_name)?;

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Draft ready for review.",
    );

    Ok((Some(draft), false))
}

/// Execute Turn 2 of the unified adopt: resume Claude session with user answers.
async fn run_continue_adopt(
    app: &tauri::AppHandle,
    adopt_id: &str,
    claude_session_id: &str,
    user_answers_json: &str,
) -> Result<N8nPersonaOutput, AppError> {
    tracing::info!(adopt_id = %adopt_id, "Starting unified adopt Turn 2 (resume)");

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Resuming session with your answers. Generating persona draft...",
    );

    let prompt_text = format!(
        r#"Here are the user's answers to your questions:

{}

Now proceed to PHASE 2. Generate the full persona JSON based on the template analysis and the user's answers above.
Remember: return ONLY valid JSON with the persona object, no markdown fences."#,
        user_answers_json
    );

    let mut cli_args = prompt::build_resume_cli_args(claude_session_id);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let app_for_emit2 = app.clone();
    let adopt_id_for_emit2 = adopt_id.to_string();
    let on_line2 = move |line: &str| {
        emit_adopt_line(&app_for_emit2, &adopt_id_for_emit2, line.to_string());
    };
    let (output_text, _) = run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&on_line2), 420)
        .await
        .map_err(AppError::Internal)?;

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let draft = parse_persona_output(&output_text, "adopted template")?;

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Draft ready for review. Confirm save is required to persist.",
    );

    Ok(draft)
}

// ── Direct transform job (used for adjustment re-runs) ──────────

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

// ══════════════════════════════════════════════════════════════════
// Template Generation (create new templates from user description)
// ══════════════════════════════════════════════════════════════════

#[derive(Clone, Serialize)]
struct TemplateGenOutputEvent {
    gen_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct TemplateGenStatusEvent {
    gen_id: String,
    status: String,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
struct TemplateGenSnapshot {
    gen_id: String,
    status: String,
    error: Option<String>,
    lines: Vec<String>,
    result_json: Option<String>,
}

#[derive(Clone)]
struct TemplateGenJobState {
    status: String,
    error: Option<String>,
    lines: Vec<String>,
    result_json: Option<String>,
    cancel_token: Option<CancellationToken>,
    created_at: Instant,
}

impl Default for TemplateGenJobState {
    fn default() -> Self {
        Self {
            status: String::new(),
            error: None,
            lines: Vec::new(),
            result_json: None,
            cancel_token: None,
            created_at: Instant::now(),
        }
    }
}

static TEMPLATE_GEN_JOBS: OnceLock<Mutex<HashMap<String, TemplateGenJobState>>> = OnceLock::new();

fn gen_jobs() -> &'static Mutex<HashMap<String, TemplateGenJobState>> {
    TEMPLATE_GEN_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_gen_jobs(
) -> Result<std::sync::MutexGuard<'static, HashMap<String, TemplateGenJobState>>, AppError> {
    gen_jobs()
        .lock()
        .map_err(|_| AppError::Internal("template gen job lock poisoned".into()))
}

fn evict_stale_gen_jobs(jobs: &mut HashMap<String, TemplateGenJobState>) {
    let cutoff = std::time::Duration::from_secs(JOB_TTL_SECS);
    jobs.retain(|_, job| job.status == "running" || job.created_at.elapsed() < cutoff);
}

fn set_gen_status(app: &tauri::AppHandle, gen_id: &str, status: &str, error: Option<String>) {
    if let Ok(mut jobs) = lock_gen_jobs() {
        let entry = jobs
            .entry(gen_id.to_string())
            .or_insert_with(TemplateGenJobState::default);
        entry.status = status.to_string();
        entry.error = error.clone();
    }
    let _ = app.emit(
        "template-generate-status",
        TemplateGenStatusEvent {
            gen_id: gen_id.to_string(),
            status: status.to_string(),
            error,
        },
    );
}

fn emit_gen_line(app: &tauri::AppHandle, gen_id: &str, line: impl Into<String>) {
    let line = line.into();
    if let Ok(mut jobs) = lock_gen_jobs() {
        let entry = jobs
            .entry(gen_id.to_string())
            .or_insert_with(TemplateGenJobState::default);
        if entry.lines.len() < 500 {
            entry.lines.push(line.clone());
        }
    }
    let _ = app.emit(
        "template-generate-output",
        TemplateGenOutputEvent {
            gen_id: gen_id.to_string(),
            line,
        },
    );
}

fn set_gen_result(gen_id: &str, result_json: String) {
    if let Ok(mut jobs) = lock_gen_jobs() {
        let entry = jobs
            .entry(gen_id.to_string())
            .or_insert_with(TemplateGenJobState::default);
        entry.result_json = Some(result_json);
    }
}

#[tauri::command]
pub async fn generate_template_background(
    app: tauri::AppHandle,
    gen_id: String,
    template_name: String,
    description: String,
) -> Result<serde_json::Value, AppError> {
    if description.trim().is_empty() {
        return Err(AppError::Validation(
            "Template description cannot be empty".into(),
        ));
    }

    let cancel_token = CancellationToken::new();

    {
        let mut jobs = lock_gen_jobs()?;
        evict_stale_gen_jobs(&mut jobs);
        if let Some(existing) = jobs.get(&gen_id) {
            if existing.status == "running" {
                return Err(AppError::Validation(
                    "Template generation is already running".into(),
                ));
            }
        }
        jobs.insert(
            gen_id.clone(),
            TemplateGenJobState {
                status: "running".into(),
                error: None,
                lines: Vec::new(),
                result_json: None,
                cancel_token: Some(cancel_token.clone()),
                created_at: Instant::now(),
            },
        );
    }

    set_gen_status(&app, &gen_id, "running", None);

    let app_handle = app.clone();
    let gen_id_for_task = gen_id.clone();
    let token_for_task = cancel_token;

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Template generation cancelled by user".into()))
            }
            res = run_template_generate_job(
                &app_handle,
                &gen_id_for_task,
                &template_name,
                &description,
            ) => res
        };

        match result {
            Ok(result_json) => {
                set_gen_result(&gen_id_for_task, result_json);
                set_gen_status(&app_handle, &gen_id_for_task, "completed", None);
            }
            Err(err) => {
                let msg = err.to_string();
                tracing::error!(gen_id = %gen_id_for_task, error = %msg, "template generation failed");
                set_gen_status(&app_handle, &gen_id_for_task, "failed", Some(msg));
            }
        }
    });

    Ok(json!({ "gen_id": gen_id }))
}

#[tauri::command]
pub fn get_template_generate_snapshot(gen_id: String) -> Result<serde_json::Value, AppError> {
    let jobs = lock_gen_jobs()?;
    let snapshot = jobs
        .get(&gen_id)
        .map(|job| TemplateGenSnapshot {
            gen_id: gen_id.clone(),
            status: if job.status.is_empty() {
                "idle".to_string()
            } else {
                job.status.clone()
            },
            error: job.error.clone(),
            lines: job.lines.clone(),
            result_json: job.result_json.clone(),
        })
        .ok_or_else(|| AppError::NotFound("Template generation not found".into()))?;
    Ok(serde_json::to_value(snapshot).unwrap_or_else(|_| json!({})))
}

#[tauri::command]
pub fn clear_template_generate_snapshot(gen_id: String) -> Result<(), AppError> {
    let mut jobs = lock_gen_jobs()?;
    jobs.remove(&gen_id);
    Ok(())
}

#[tauri::command]
pub fn cancel_template_generate(app: tauri::AppHandle, gen_id: String) -> Result<(), AppError> {
    let token = {
        let jobs = lock_gen_jobs()?;
        jobs.get(&gen_id)
            .and_then(|job| job.cancel_token.clone())
    };

    if let Some(token) = token {
        token.cancel();
    }

    set_gen_status(
        &app,
        &gen_id,
        "failed",
        Some("Cancelled by user".into()),
    );
    Ok(())
}

#[tauri::command]
pub fn save_custom_template(
    state: State<'_, Arc<AppState>>,
    template_name: String,
    instruction: String,
    design_result_json: String,
) -> Result<serde_json::Value, AppError> {
    if design_result_json.trim().is_empty() {
        return Err(AppError::Validation(
            "Design result JSON cannot be empty".into(),
        ));
    }

    // Extract connectors_used from the design result if available
    let connectors_used: Option<String> = serde_json::from_str::<serde_json::Value>(&design_result_json)
        .ok()
        .and_then(|design| {
            design.get("suggested_connectors").and_then(|conns| {
                let names: Vec<String> = conns
                    .as_array()?
                    .iter()
                    .filter_map(|c| c.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                    .collect();
                if names.is_empty() {
                    None
                } else {
                    Some(names.join(","))
                }
            })
        });

    let now = chrono::Utc::now().to_rfc3339();
    let test_case_id = uuid::Uuid::new_v4().to_string();

    use crate::db::models::CreateDesignReviewInput;
    use crate::db::repos::communication::reviews as review_repo;

    let review = review_repo::create_review(
        &state.db,
        &CreateDesignReviewInput {
            test_case_id,
            test_case_name: template_name,
            instruction,
            status: "passed".into(),
            structural_score: None,
            semantic_score: None,
            connectors_used,
            trigger_types: None,
            design_result: Some(design_result_json),
            structural_evaluation: None,
            semantic_evaluation: None,
            test_run_id: "custom-template".into(),
            had_references: None,
            suggested_adjustment: None,
            adjustment_generation: None,
            use_case_flows: None,
            reviewed_at: now,
        },
    )?;

    Ok(json!({ "review": review }))
}

/// Run the template generation job — prompts Claude to generate a DesignAnalysisResult.
async fn run_template_generate_job(
    app: &tauri::AppHandle,
    gen_id: &str,
    template_name: &str,
    description: &str,
) -> Result<String, AppError> {
    tracing::info!(gen_id = %gen_id, "Starting template generation");

    emit_gen_line(app, gen_id, "[Milestone] Preparing template generation prompt...");

    let prompt_text = format!(
        r##"You are a senior Personas architect. Generate a complete template design (DesignAnalysisResult)
from the user's description below.

## What You Must Generate

Create a JSON object with this exact structure (DesignAnalysisResult):

{{
  "structured_prompt": {{
    "identity": "Who this persona is and what role it plays",
    "instructions": "Step-by-step instructions for how to operate — include protocol message patterns",
    "toolGuidance": "How to use each tool and when to request manual_review",
    "examples": "Example interactions showing protocol message usage",
    "errorHandling": "How to handle errors with user_message notifications",
    "customSections": [
      {{"key": "unique_key", "label": "Section Label", "content": "Section content"}}
    ]
  }},
  "full_prompt_markdown": "Complete system prompt in markdown format — comprehensive and self-contained",
  "summary": "2-3 sentence description of the persona's purpose",
  "suggested_tools": [
    {{"name": "tool_name", "description": "What it does", "category": "http_request|system|utility"}}
  ],
  "suggested_triggers": [
    {{"type": "cron|webhook|event|manual", "config": "trigger configuration"}}
  ],
  "suggested_connectors": [
    {{
      "name": "ConnectorName",
      "auth_type": "api_key|oauth2|basic",
      "credential_fields": ["field1", "field2"],
      "purpose": "What this connector enables"
    }}
  ],
  "adoption_requirements": [
    {{
      "key": "variable_key",
      "label": "Human Readable Label",
      "description": "What this variable controls",
      "type": "text|select|url|cron",
      "required": true,
      "default_value": "optional default",
      "options": ["only for select type"],
      "source": "user_input"
    }}
  ],
  "feasibility": {{
    "score": 85,
    "notes": "Assessment of how feasible this template is"
  }},
  "persona_meta": {{
    "name": "{template_name}",
    "icon": "lucide-icon-name",
    "color": "#hex-color",
    "model_profile": null
  }}
}}

## Persona Protocol System

The Personas platform supports these protocol messages in system prompts:

1. User Messages: {{"user_message": {{"title": "string", "content": "string", "content_type": "text|markdown", "priority": "low|normal|high|critical"}}}}
2. Agent Memory: {{"agent_memory": {{"title": "string", "content": "string", "category": "fact|preference|instruction|context|learned", "importance": 1-10, "tags": ["tag1"]}}}}
3. Manual Review: {{"manual_review": {{"title": "string", "description": "string", "severity": "info|warning|error|critical", "context_data": "string", "suggested_actions": ["Approve", "Reject", "Edit"]}}}}
4. Events: {{"emit_event": {{"type": "event_name", "data": {{}}}}}}

## Variable Placeholders

For any user-specific values (email addresses, API endpoints, usernames, intervals, thresholds, etc.),
use {{{{variable_key}}}} placeholder syntax in the prompts and include a corresponding entry in
adoption_requirements. This lets users customize templates without AI transformation.

## Guidelines

- The full_prompt_markdown should be comprehensive (500+ words) and production-ready
- Include at least 2-3 adoption_requirements for meaningful template variables
- Suggest appropriate tools based on the description
- Include protocol messages in the instructions and examples
- Add a "Human-in-the-Loop" customSection for any external actions
- Add a "Memory Strategy" customSection for knowledge-building scenarios
- Pick appropriate lucide icon and a distinctive color

## User Request

Template name: {template_name}
Description: {description}

Return ONLY valid JSON (no markdown fences, no commentary).
"##
    );

    emit_gen_line(app, gen_id, "[Milestone] Starting Claude generation...");

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let app_for_emit = app.clone();
    let gen_id_for_emit = gen_id.to_string();
    let on_line = move |line: &str| {
        emit_gen_line(&app_for_emit, &gen_id_for_emit, line.to_string());
    };

    let (output_text, _session_id) =
        run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&on_line), 420)
            .await
            .map_err(AppError::Internal)?;

    emit_gen_line(app, gen_id, "[Milestone] Claude output received. Extracting design JSON...");

    // Extract JSON from output
    let json_str = extract_first_json_object(&output_text).ok_or_else(|| {
        AppError::Internal("No valid JSON found in template generation output".into())
    })?;

    // Validate it's valid JSON
    let _: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON in generation output: {e}")))?;

    emit_gen_line(app, gen_id, "[Milestone] Template design generated successfully.");

    Ok(json_str)
}

// ── Direct transform job (used for adjustment re-runs) ──────────

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

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let draft = parse_persona_output(&output_text, template_name)?;

    emit_adopt_line(
        app,
        adopt_id,
        "[Milestone] Draft ready for review. Confirm save is required to persist.",
    );

    Ok(draft)
}

