use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::db::models::{
    ConnectorWithCount, CreateDesignReviewInput, ImportDesignReviewInput, PersonaDesignReview,
    PersonaManualReview,
};
use crate::db::repos::communication::{manual_reviews as manual_repo, reviews as repo};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::{connectors as connector_repo, tools as tool_repo};
use crate::engine::design;
use crate::engine::prompt;
use crate::error::AppError;
use crate::AppState;

use super::analysis::extract_display_text;

// ── Event payloads ──────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct DesignReviewStatusEvent {
    run_id: String,
    test_case_index: usize,
    total: usize,
    status: String,
    test_case_name: String,
    error_message: Option<String>,
    elapsed_ms: Option<u64>,
}

#[derive(Clone, Serialize)]
struct DesignReviewOutputEvent {
    run_id: String,
    test_case_index: usize,
    line: String,
}

// ── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub fn list_design_reviews(
    state: State<'_, Arc<AppState>>,
    test_run_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<PersonaDesignReview>, AppError> {
    repo::get_reviews(&state.db, test_run_id.as_deref(), limit)
}

#[tauri::command]
pub fn get_design_review(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaDesignReview, AppError> {
    repo::get_review_by_id(&state.db, &id)
}

#[tauri::command]
pub fn delete_design_review(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete_review(&state.db, &id)
}

#[tauri::command]
pub fn list_design_reviews_paginated(
    state: State<'_, Arc<AppState>>,
    search: Option<String>,
    connector_filter: Option<Vec<String>>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    page: Option<i64>,
    per_page: Option<i64>,
) -> Result<serde_json::Value, AppError> {
    let result = repo::get_reviews_paginated(
        &state.db,
        search.as_deref(),
        connector_filter.as_deref(),
        sort_by.as_deref(),
        sort_dir.as_deref(),
        page.unwrap_or(0),
        per_page.unwrap_or(10),
    )?;
    Ok(serde_json::json!({
        "items": result.items,
        "total": result.total,
    }))
}

#[tauri::command]
pub fn list_review_connectors(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ConnectorWithCount>, AppError> {
    repo::get_distinct_connectors(&state.db)
}

#[tauri::command]
pub async fn start_design_review_run(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    test_cases: Vec<serde_json::Value>,
) -> Result<serde_json::Value, AppError> {
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_all_definitions(&state.db)?;
    let connectors = connector_repo::get_all(&state.db)?;

    let run_id = uuid::Uuid::new_v4().to_string();
    let total = test_cases.len();

    let pool = state.db.clone();
    let run_id_clone = run_id.clone();
    let tool_names: Vec<String> = tools.iter().map(|t| t.name.clone()).collect();
    let connector_names: Vec<String> = connectors.iter().map(|c| c.name.clone()).collect();

    // Register cancellation flag
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = state.active_test_run_cancelled.lock().unwrap();
        map.insert(run_id.clone(), cancel_flag.clone());
    }
    let cancel_map = state.active_test_run_cancelled.clone();
    let child_pids = state.active_review_child_pids.clone();

    tokio::spawn(async move {
        for (i, test_case) in test_cases.iter().enumerate() {
            // Check cancellation
            if cancel_flag.load(Ordering::Relaxed) {
                let _ = app.emit(
                    "design-review-status",
                    DesignReviewStatusEvent {
                        run_id: run_id_clone.clone(),
                        test_case_index: i,
                        total,
                        status: "cancelled".into(),
                        test_case_name: String::new(),
                        error_message: None,
                        elapsed_ms: None,
                    },
                );
                break;
            }

            let test_case_id = test_case
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let test_case_name = test_case
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unnamed test")
                .to_string();
            let instruction = test_case
                .get("instruction")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Extract optional metadata hints from test case
            let tools_hint = test_case
                .get("tools")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let trigger_hint = test_case
                .get("trigger")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let category_hint = test_case
                .get("category")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            // Emit "generating" status
            let _ = app.emit(
                "design-review-status",
                DesignReviewStatusEvent {
                    run_id: run_id_clone.clone(),
                    test_case_index: i,
                    total,
                    status: "generating".into(),
                    test_case_name: test_case_name.clone(),
                    error_message: None,
                    elapsed_ms: None,
                },
            );

            let start_time = std::time::Instant::now();

            // Enrich instruction with metadata hints
            let enriched_instruction = enrich_instruction(
                &instruction,
                tools_hint.as_deref(),
                trigger_hint.as_deref(),
                category_hint.as_deref(),
            );

            // Build design prompt
            let design_prompt = design::build_design_prompt(
                &persona,
                &tools,
                &connectors,
                &enriched_instruction,
                persona.design_context.as_deref(),
                None,
            );

            // Spawn Claude CLI and collect output
            let cli_args = prompt::build_cli_args(None, None);
            let cli_result = run_cli_for_template(
                &cli_args,
                &design_prompt,
                &app,
                &run_id_clone,
                i,
                &child_pids,
            )
            .await;

            let elapsed = start_time.elapsed().as_millis() as u64;

            let now = chrono::Utc::now().to_rfc3339();
            let mut input = CreateDesignReviewInput::base(
                test_case_id,
                test_case_name.clone(),
                instruction,
                run_id_clone.clone(),
                now,
            );

            match cli_result {
                Ok(full_output) => {
                    // Check for a question (skip in batch mode)
                    if design::extract_design_question(&full_output).is_some() {
                        tracing::warn!(
                            test_case = %test_case_name,
                            "Claude asked a question during batch generation — skipping"
                        );
                        input.structural_score = Some(0);
                        input.semantic_score = Some(0);
                        input.suggested_adjustment = Some(
                            "Claude asked a clarification question instead of generating. Re-run with a more specific instruction.".into()
                        );
                        let _ = repo::create_review(&pool, &input);
                        emit_status(
                            &app, &run_id_clone, i, total,
                            "error", &test_case_name,
                            Some("Claude asked a question instead of generating".into()),
                            Some(elapsed),
                        );
                        continue;
                    }

                    // Extract design result
                    match design::extract_design_result(&full_output) {
                        Some(mut result) => {
                            // Attach feasibility
                            let feasibility = design::check_feasibility(
                                &result.to_string(),
                                &tool_names,
                                &connector_names,
                            );
                            if let Some(obj) = result.as_object_mut() {
                                obj.insert(
                                    "feasibility".into(),
                                    json!({
                                        "confirmed_capabilities": feasibility.confirmed_capabilities,
                                        "issues": feasibility.issues,
                                        "overall_feasibility": feasibility.overall,
                                    }),
                                );
                            }

                            let result_json = result.to_string();
                            let connectors_used = extract_connectors_from_result(&result);
                            let trigger_types = extract_triggers_from_result(&result);
                            let (structural_score, semantic_score) =
                                score_design_result(&result, &tool_names, &connector_names);

                            let status = if structural_score >= 55 {
                                "passed"
                            } else {
                                "failed"
                            };

                            input.status = status.into();
                            input.structural_score = Some(structural_score);
                            input.semantic_score = Some(semantic_score);
                            input.connectors_used = Some(connectors_used);
                            input.trigger_types = Some(trigger_types);
                            input.design_result = Some(result_json);
                            input.use_case_flows = extract_use_case_flows_from_result(&result);
                            let _ = repo::create_review(&pool, &input);

                            emit_status(
                                &app, &run_id_clone, i, total,
                                status, &test_case_name,
                                None, Some(elapsed),
                            );
                        }
                        None => {
                            tracing::warn!(
                                test_case = %test_case_name,
                                "Failed to extract design result from Claude output"
                            );
                            input.structural_score = Some(0);
                            input.semantic_score = Some(0);
                            input.suggested_adjustment = Some(
                                "Failed to extract valid JSON from Claude output".into(),
                            );
                            let _ = repo::create_review(&pool, &input);
                            emit_status(
                                &app, &run_id_clone, i, total,
                                "error", &test_case_name,
                                Some("Failed to extract design result".into()),
                                Some(elapsed),
                            );
                        }
                    }
                }
                Err(error_msg) => {
                    tracing::error!(
                        test_case = %test_case_name,
                        error = %error_msg,
                        "CLI failed for template generation"
                    );
                    input.structural_score = Some(0);
                    input.semantic_score = Some(0);
                    input.semantic_evaluation = Some(error_msg.clone());
                    let _ = repo::create_review(&pool, &input);
                    emit_status(
                        &app, &run_id_clone, i, total,
                        "error", &test_case_name,
                        Some(error_msg), Some(elapsed),
                    );
                }
            }
        }

        // Cleanup cancellation flag and child PID
        {
            let mut map = cancel_map.lock().unwrap();
            map.remove(&run_id_clone);
        }
        {
            let mut pids = child_pids.lock().unwrap();
            pids.remove(&run_id_clone);
        }

        // Emit completion
        let _ = app.emit(
            "design-review-status",
            DesignReviewStatusEvent {
                run_id: run_id_clone,
                test_case_index: total,
                total,
                status: "completed".into(),
                test_case_name: String::new(),
                error_message: None,
                elapsed_ms: None,
            },
        );
    });

    Ok(json!({ "run_id": run_id, "total": total }))
}

#[tauri::command]
pub fn cancel_design_review_run(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<(), AppError> {
    let map = state.active_test_run_cancelled.lock().unwrap();
    if let Some(flag) = map.get(&run_id) {
        flag.store(true, Ordering::Relaxed);
    }

    // Kill the currently-running CLI child process to stop API credit consumption immediately.
    if let Some(pid) = state.active_review_child_pids.lock().unwrap().remove(&run_id) {
        tracing::info!(run_id = %run_id, pid = pid, "Killing review CLI child process");
        crate::engine::kill_process(pid);
    }

    Ok(())
}

// ── Rebuild ─────────────────────────────────────────────────────

fn build_rebuild_prompt(
    test_case_name: &str,
    instruction: &str,
    user_direction: Option<&str>,
    existing_design_result: Option<&str>,
    tools: &[crate::db::models::PersonaToolDefinition],
    connectors: &[crate::db::models::ConnectorDefinition],
) -> String {
    let user_direction_section = user_direction
        .filter(|d| !d.trim().is_empty())
        .map(|d| format!("\n## User Custom Direction\nThe user has provided specific requirements for this rebuild:\n{d}\nHonor these requirements when generating the persona design.\n"))
        .unwrap_or_default();

    let existing_design_section = existing_design_result
        .filter(|d| !d.trim().is_empty())
        .map(|d| format!(
            "\n## Current Design (preserve and improve)\nThe template already has a design. Preserve what works, fix what's incomplete, and enhance based on the instructions. Pay special attention to filling in missing dimensions (flows, events, notifications, structured_prompt).\n```json\n{d}\n```\n"
        ))
        .unwrap_or_default();

    let mut tools_section = String::new();
    if !tools.is_empty() {
        tools_section.push_str("\n## Available Tools\n");
        for tool in tools {
            tools_section.push_str(&format!(
                "- **{}** ({}): {}\n",
                tool.name, tool.category, tool.description
            ));
        }
    }

    let mut connectors_section = String::new();
    if !connectors.is_empty() {
        connectors_section.push_str("\n## Available Connectors\n");
        for conn in connectors {
            connectors_section.push_str(&format!(
                "- **{}** ({}): {}\n",
                conn.name, conn.category, conn.label
            ));
        }
    }

    format!(
        r##"You are a senior Personas architect. Analyze the template concept below and generate a complete, production-ready persona design with ALL data dimensions filled.

## Template: {test_case_name}

## App Capabilities (Personas Platform)
- Personas has a built-in LLM execution engine. Do NOT suggest external LLM API tools.
  No Anthropic API, no OpenAI API calls. The persona's system_prompt IS the AI brain.
- Tools are external scripts that interact with APIs (Gmail, Slack, HTTP, etc.)
- Triggers start the persona (schedule, webhook, polling, manual)
- Each tool can reference a connector (credential type) it requires

## Persona Protocol System (CRITICAL — embed these in the structured_prompt)

During execution, the persona can output special JSON protocol messages to communicate
with the user, persist knowledge, and request human approval. You MUST reference these
in the structured_prompt instructions and toolGuidance wherever the design involves
human interaction, data storage, notifications, or approval gates.

### Protocol 1: User Messages (notify the user)
Output: {{"user_message": {{"title": "string", "content": "string", "content_type": "text|markdown", "priority": "low|normal|high|critical"}}}}

Use for: status updates, summaries, alerts, draft previews, completion reports.

### Protocol 2: Agent Memory (ACTIVE business knowledge — improves every run)
Output: {{"agent_memory": {{"title": "string", "content": "string", "category": "fact|preference|instruction|context|learned", "importance": 1-10, "tags": ["tag1"]}}}}

CRITICAL: Memory is the persona's competitive advantage. Each execution should
make the persona smarter at its business domain. Memory must be ACTIVE (consulted
before decisions) and PROGRESSIVE (each run builds on previous knowledge).

Categories:
- "fact": Business facts extracted from data (e.g., "Client X prefers morning meetings")
- "preference": Stakeholder and system preferences (e.g., "Marketing team wants Slack over email")
- "instruction": Learned procedures and rules (e.g., "Always CC legal on contracts above $10k")
- "context": Ongoing business situations (e.g., "Q4 budget freeze — hold non-critical purchases")
- "learned": Patterns and optimizations discovered through operation

### Protocol 3: Manual Review (human-in-the-loop approval gate)
Output: {{"manual_review": {{"title": "string", "description": "string", "severity": "info|warning|error|critical", "context_data": "string", "suggested_actions": ["Approve", "Reject", "Edit"]}}}}

Use for: draft review before sending, data deletion confirmation, high-stakes decisions.

### Protocol 4: Events (inter-persona communication)
Output: {{"emit_event": {{"type": "event_name", "data": {{}}}}}}

Use for: multi-agent coordination, triggering downstream workflows.

## Design Pattern Mapping

Apply these patterns when designing:

1. HUMAN-IN-THE-LOOP: If the persona sends emails, posts messages, modifies databases,
   or performs any externally-visible action → add manual_review BEFORE the action.
   Include a "human_in_the_loop" customSection in structured_prompt.

2. KNOWLEDGE EXTRACTION: If the persona processes data (emails, documents, API responses)
   → add agent_memory instructions to extract and store BUSINESS-RELEVANT information.

3. PROGRESSIVE LEARNING: For recurring tasks → instruct the persona to CHECK memories
   before acting and STORE new patterns after. Create a feedback loop:
   CHECK → ACT → LEARN → IMPROVE.
   ALWAYS include a "memory_strategy" customSection describing what to capture and when.

4. NOTIFICATIONS: Map status updates to user_message with appropriate priority levels.

5. ERROR ESCALATION: Map critical errors to user_message with priority "critical".

## Composition Philosophy
1. Produce robust prompt architecture (identity, instructions, toolGuidance, examples, errorHandling, customSections).
2. Keep instructions deterministic, testable, and failure-aware.
3. Ensure ALL 9 data dimensions are filled: structured_prompt, tools, triggers, connectors, flows, events, notifications, summary, service_flow.
4. ALWAYS include a "memory_strategy" customSection.
5. ALWAYS include a "human_in_the_loop" customSection when external actions are involved.
6. Use the protocol system throughout the instructions and examples.
{tools_section}{connectors_section}{existing_design_section}{user_direction_section}
## Template Instruction
{instruction}

{DESIGN_OUTPUT_SCHEMA}
"##,
        DESIGN_OUTPUT_SCHEMA = crate::engine::design::DESIGN_OUTPUT_SCHEMA,
    )
}

#[tauri::command]
pub async fn rebuild_design_review(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    user_instruction: Option<String>,
) -> Result<serde_json::Value, AppError> {
    use crate::commands::design::n8n_transform::job_state as n8n_job_state;
    use crate::commands::design::n8n_transform::run_claude_prompt_text;
    use tokio_util::sync::CancellationToken;

    let review = repo::get_review_by_id(&state.db, &id)?;
    let tools = tool_repo::get_all_definitions(&state.db)?;
    let connectors = connector_repo::get_all(&state.db)?;

    let rebuild_id = format!("rebuild-{}", id);
    let pool = state.db.clone();
    let tool_names: Vec<String> = tools.iter().map(|t| t.name.clone()).collect();
    let connector_names: Vec<String> = connectors.iter().map(|c| c.name.clone()).collect();

    // Initialize job in n8n job_state for background tracking
    let cancel_token = CancellationToken::new();
    {
        let mut jobs = n8n_job_state::lock_jobs()?;
        n8n_job_state::evict_stale_n8n_jobs(&mut jobs);
        jobs.insert(
            rebuild_id.clone(),
            n8n_job_state::N8nTransformJobState {
                status: "running".into(),
                cancel_token: Some(cancel_token.clone()),
                ..Default::default()
            },
        );
    }
    n8n_job_state::set_n8n_transform_status(&app, &rebuild_id, "running", None);

    let rebuild_id_ret = rebuild_id.clone();

    tokio::spawn(async move {
        n8n_job_state::emit_n8n_transform_line(&app, &rebuild_id, "[Milestone] Building design prompt...");

        // Build the rich rebuild prompt
        let design_prompt = build_rebuild_prompt(
            &review.test_case_name,
            &review.instruction,
            user_instruction.as_deref(),
            review.design_result.as_deref(),
            &tools,
            &connectors,
        );

        n8n_job_state::emit_n8n_transform_line(&app, &rebuild_id, "[Milestone] Running Claude CLI...");

        // Use the n8n CLI runner with streaming output
        let cli_args = prompt::build_cli_args(None, None);
        let cli_result = run_claude_prompt_text(
            design_prompt,
            &cli_args,
            Some((&app, &rebuild_id)),
        )
        .await;

        let now = chrono::Utc::now().to_rfc3339();

        match cli_result {
            Ok((full_output, _session_id)) => {
                n8n_job_state::emit_n8n_transform_line(&app, &rebuild_id, "[Milestone] Extracting design result...");

                match design::extract_design_result(&full_output) {
                    Some(mut result) => {
                        // Attach feasibility
                        let feasibility = design::check_feasibility(
                            &result.to_string(),
                            &tool_names,
                            &connector_names,
                        );
                        if let Some(obj) = result.as_object_mut() {
                            obj.insert(
                                "feasibility".into(),
                                json!({
                                    "confirmed_capabilities": feasibility.confirmed_capabilities,
                                    "issues": feasibility.issues,
                                    "overall_feasibility": feasibility.overall,
                                }),
                            );
                        }

                        let result_json = result.to_string();
                        let connectors_used = extract_connectors_from_result(&result);
                        let trigger_types = extract_triggers_from_result(&result);
                        let use_case_flows = extract_use_case_flows_from_result(&result);
                        let (structural_score, semantic_score) =
                            score_design_result(&result, &tool_names, &connector_names);

                        let status = if structural_score >= 55 {
                            "passed"
                        } else {
                            "failed"
                        };

                        let _ = repo::update_review_result(
                            &pool,
                            &review.id,
                            status,
                            Some(structural_score),
                            Some(semantic_score),
                            Some(&connectors_used),
                            Some(&trigger_types),
                            Some(&result_json),
                            use_case_flows.as_deref(),
                            None,
                            &now,
                        );

                        n8n_job_state::emit_n8n_transform_line(
                            &app, &rebuild_id,
                            format!("[Milestone] Rebuild complete — quality: {}%", structural_score),
                        );
                        n8n_job_state::set_n8n_transform_status(&app, &rebuild_id, "completed", None);
                    }
                    None => {
                        let _ = repo::update_review_result(
                            &pool,
                            &review.id,
                            "error",
                            Some(0),
                            Some(0),
                            None,
                            None,
                            None,
                            None,
                            Some("Failed to extract valid JSON from Claude output"),
                            &now,
                        );
                        n8n_job_state::set_n8n_transform_status(
                            &app, &rebuild_id, "failed",
                            Some("Failed to extract design result from Claude output".into()),
                        );
                    }
                }
            }
            Err(error_msg) => {
                let _ = repo::update_review_result(
                    &pool,
                    &review.id,
                    "error",
                    Some(0),
                    Some(0),
                    None,
                    None,
                    None,
                    None,
                    Some(&error_msg),
                    &now,
                );
                n8n_job_state::set_n8n_transform_status(
                    &app, &rebuild_id, "failed",
                    Some(error_msg),
                );
            }
        }
    });

    Ok(json!({ "rebuild_id": rebuild_id_ret }))
}

#[tauri::command]
pub fn get_rebuild_snapshot(rebuild_id: String) -> Result<serde_json::Value, AppError> {
    crate::commands::design::n8n_transform::job_state::get_n8n_transform_snapshot(rebuild_id)
}

#[tauri::command]
pub fn cancel_rebuild(app: tauri::AppHandle, rebuild_id: String) -> Result<(), AppError> {
    crate::commands::design::n8n_transform::job_state::cancel_n8n_transform(app, rebuild_id)
}

// ── Manual Review Commands ───────────────────────────────────

#[tauri::command]
pub fn list_manual_reviews(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<PersonaManualReview>, AppError> {
    match persona_id {
        Some(pid) => manual_repo::get_by_persona(&state.db, &pid, status.as_deref()),
        None => manual_repo::get_all(&state.db, status.as_deref()),
    }
}

#[derive(Clone, Serialize)]
struct ManualReviewResolvedEvent {
    review_id: String,
    execution_id: String,
    persona_id: String,
    status: String,
}

#[tauri::command]
pub fn update_manual_review_status(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
    status: String,
    reviewer_notes: Option<String>,
) -> Result<PersonaManualReview, AppError> {
    manual_repo::update_status(&state.db, &id, &status, reviewer_notes)?;
    let review = manual_repo::get_by_id(&state.db, &id)?;

    if matches!(review.status.as_str(), "approved" | "rejected" | "resolved") {
        let _ = app.emit(
            "manual-review-resolved",
            ManualReviewResolvedEvent {
                review_id: review.id.clone(),
                execution_id: review.execution_id.clone(),
                persona_id: review.persona_id.clone(),
                status: review.status.clone(),
            },
        );
    }

    Ok(review)
}

#[tauri::command]
pub fn get_pending_review_count(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<i64, AppError> {
    manual_repo::get_pending_count(&state.db, persona_id.as_deref())
}

#[tauri::command]
pub fn import_design_review(
    state: State<'_, Arc<AppState>>,
    input: serde_json::Value,
) -> Result<PersonaDesignReview, AppError> {
    let import_input: ImportDesignReviewInput = serde_json::from_value(input)
        .map_err(|e| AppError::Validation(format!("Invalid design review input: {e}")))?;
    let review_input: CreateDesignReviewInput = import_input.into();
    repo::create_review(&state.db, &review_input)
}

// ── CLI Runner ─────────────────────────────────────────────────

/// Spawn Claude CLI for a single template and return the full output string.
async fn run_cli_for_template(
    cli_args: &crate::engine::types::CliArgs,
    prompt_text: &str,
    app: &tauri::AppHandle,
    run_id: &str,
    test_case_index: usize,
    child_pids: &Arc<Mutex<HashMap<String, u32>>>,
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
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return if e.kind() == std::io::ErrorKind::NotFound {
                Err("Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code".into())
            } else {
                Err(format!("Failed to spawn Claude CLI: {e}"))
            };
        }
    };

    // Register child PID so cancel can kill it immediately
    if let Some(pid) = child.id() {
        child_pids.lock().unwrap().insert(run_id.to_string(), pid);
    }

    // Write prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt_text.as_bytes().to_vec();
        let _ = stdin.write_all(&prompt_bytes).await;
        let _ = stdin.shutdown().await;
    }

    // Read stdout line by line, emit output events
    let stdout = child.stdout.take().expect("stdout was piped");
    let mut reader = BufReader::new(stdout).lines();
    let mut full_output = String::new();

    let timeout_duration = std::time::Duration::from_secs(180); // 3 min per template
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            // Emit display text for streaming progress
            if let Some(text) = extract_display_text(&line) {
                let _ = app.emit(
                    "design-review-output",
                    DesignReviewOutputEvent {
                        run_id: run_id.to_string(),
                        test_case_index,
                        line: text,
                    },
                );
            }

            full_output.push_str(&line);
            full_output.push('\n');
        }
    })
    .await;

    // Wait for process and clear the PID (process has exited)
    let _ = child.wait().await;
    child_pids.lock().unwrap().remove(run_id);

    if stream_result.is_err() {
        let _ = child.kill().await;
        return Err("Template generation timed out after 3 minutes".into());
    }

    if full_output.is_empty() {
        // Read stderr for error info
        if let Some(mut stderr) = child.stderr.take() {
            let mut err_buf = String::new();
            let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr, &mut err_buf).await;
            if !err_buf.is_empty() {
                return Err(format!("Claude CLI produced no output. Stderr: {}", err_buf.chars().take(500).collect::<String>()));
            }
        }
        return Err("Claude CLI produced no output".into());
    }

    Ok(full_output)
}

// ── Helper Functions ───────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn emit_status(
    app: &tauri::AppHandle,
    run_id: &str,
    index: usize,
    total: usize,
    status: &str,
    test_case_name: &str,
    error_message: Option<String>,
    elapsed_ms: Option<u64>,
) {
    let _ = app.emit(
        "design-review-status",
        DesignReviewStatusEvent {
            run_id: run_id.to_string(),
            test_case_index: index,
            total,
            status: status.into(),
            test_case_name: test_case_name.to_string(),
            error_message,
            elapsed_ms,
        },
    );
}

/// Enrich instruction with metadata hints from list.md format.
fn enrich_instruction(
    instruction: &str,
    tools_hint: Option<&str>,
    trigger_hint: Option<&str>,
    category_hint: Option<&str>,
) -> String {
    let mut enriched = instruction.to_string();

    let has_hints = tools_hint.is_some() || trigger_hint.is_some() || category_hint.is_some();
    if has_hints {
        enriched.push_str("\n\n--- Template Metadata ---");
    }

    if let Some(tools) = tools_hint {
        enriched.push_str(&format!("\nSuggested tools to use: {tools}"));
    }
    if let Some(trigger) = trigger_hint {
        enriched.push_str(&format!("\nSuggested trigger type: {trigger}"));
    }
    if let Some(category) = category_hint {
        enriched.push_str(&format!("\nCategory: {category}"));
    }

    enriched
}

/// Extract connector names from a parsed DesignAnalysisResult as a JSON array string.
fn extract_connectors_from_result(result: &serde_json::Value) -> String {
    let names: Vec<String> = result
        .get("suggested_connectors")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    serde_json::to_string(&names).unwrap_or_else(|_| "[]".to_string())
}

/// Extract trigger types from a parsed DesignAnalysisResult as a JSON array string.
fn extract_triggers_from_result(result: &serde_json::Value) -> String {
    let types: Vec<String> = result
        .get("suggested_triggers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    t.get("trigger_type")
                        .and_then(|v| v.as_str())
                        .map(String::from)
                })
                .collect()
        })
        .unwrap_or_default();
    serde_json::to_string(&types).unwrap_or_else(|_| "[]".to_string())
}

/// Extract use_case_flows array from a parsed DesignAnalysisResult as a JSON string.
fn extract_use_case_flows_from_result(result: &serde_json::Value) -> Option<String> {
    result
        .get("use_case_flows")
        .filter(|v| v.is_array())
        .map(|v| v.to_string())
}

/// Score a generated DesignAnalysisResult for quality based on dimension completion.
/// Measures 9 Persona data dimensions. Returns (score, score) where score is 0-100
/// representing the percentage of dimensions that pass validation.
fn score_design_result(
    result: &serde_json::Value,
    _tool_names: &[String],
    _connector_names: &[String],
) -> (i32, i32) {
    let mut passed = 0i32;
    let total = 9i32;

    // 1. Prompt dimension — structured_prompt with meaningful identity + instructions
    if let Some(sp) = result.get("structured_prompt") {
        let identity_ok = sp
            .get("identity")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.len() > 20);
        let instructions_ok = sp
            .get("instructions")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.len() > 50);
        let has_guidance = sp
            .get("toolGuidance")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty())
            || sp
                .get("errorHandling")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.is_empty());
        if identity_ok && instructions_ok && has_guidance {
            passed += 1;
        }
    }

    // 2. Tools dimension — non-empty suggested_tools array
    if result
        .get("suggested_tools")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| !arr.is_empty())
    {
        passed += 1;
    }

    // 3. Triggers dimension — items with valid trigger_type
    if result
        .get("suggested_triggers")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| {
            !arr.is_empty()
                && arr
                    .iter()
                    .any(|t| t.get("trigger_type").and_then(|v| v.as_str()).is_some())
        })
    {
        passed += 1;
    }

    // 4. Connectors dimension — items with credential_fields + auth_type
    if result
        .get("suggested_connectors")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| {
            !arr.is_empty()
                && arr.iter().any(|c| {
                    c.get("credential_fields")
                        .and_then(|v| v.as_array())
                        .is_some_and(|f| !f.is_empty())
                        && c.get("auth_type").and_then(|v| v.as_str()).is_some()
                })
        })
    {
        passed += 1;
    }

    // 5. Flows dimension — at least one flow with start/end nodes and ≥5 nodes
    if result
        .get("use_case_flows")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| {
            !arr.is_empty()
                && arr.iter().any(|flow| {
                    let nodes = flow.get("nodes").and_then(|v| v.as_array());
                    let has_start = nodes.as_ref().is_some_and(|n| {
                        n.iter()
                            .any(|node| node.get("type").and_then(|v| v.as_str()) == Some("start"))
                    });
                    let has_end = nodes.as_ref().is_some_and(|n| {
                        n.iter()
                            .any(|node| node.get("type").and_then(|v| v.as_str()) == Some("end"))
                    });
                    let enough_nodes = nodes.is_some_and(|n| n.len() >= 5);
                    has_start && has_end && enough_nodes
                })
        })
    {
        passed += 1;
    }

    // 6. Events dimension — non-empty suggested_event_subscriptions
    if result
        .get("suggested_event_subscriptions")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| !arr.is_empty())
    {
        passed += 1;
    }

    // 7. Notifications dimension — non-empty suggested_notification_channels
    if result
        .get("suggested_notification_channels")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| !arr.is_empty())
    {
        passed += 1;
    }

    // 8. Summary dimension — summary string >50 chars
    if result
        .get("summary")
        .and_then(|v| v.as_str())
        .is_some_and(|s| s.len() > 50)
    {
        passed += 1;
    }

    // 9. Service Flow dimension — non-empty service_flow array
    if result
        .get("service_flow")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| !arr.is_empty())
    {
        passed += 1;
    }

    let score = ((passed as f64 / total as f64) * 100.0).round() as i32;
    (score, score)
}

/// Score a design prompt based on structural completeness (legacy pre-check).
/// Returns (status, structural_score, semantic_score, design_result_json).
#[allow(dead_code)]
fn score_design_prompt(
    prompt: &str,
    tool_names: &[String],
    connector_names: &[String],
) -> (String, i32, i32, Option<String>) {
    let mut structural = 0i32;
    if prompt.contains("## Target Persona") {
        structural += 20;
    }
    if prompt.contains("## User Instruction") {
        structural += 20;
    }
    if prompt.contains("## Required Output Format") {
        structural += 20;
    }
    if prompt.contains("## Available Tools") {
        structural += 20;
    }
    if prompt.contains("## Available Connectors") {
        structural += 20;
    }

    let total_refs = tool_names.len() + connector_names.len();
    let semantic = if total_refs > 0 {
        let mut found = 0;
        for name in tool_names {
            if prompt.contains(name.as_str()) {
                found += 1;
            }
        }
        for name in connector_names {
            if prompt.contains(name.as_str()) {
                found += 1;
            }
        }
        ((found as f64 / total_refs as f64) * 100.0) as i32
    } else {
        100
    };

    let status = if structural >= 60 && semantic >= 50 {
        "passed"
    } else {
        "failed"
    };

    (status.into(), structural, semantic, None)
}
