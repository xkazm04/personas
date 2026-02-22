use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::db::models::{
    CreateDesignReviewInput, CreatePersonaInput, ImportDesignReviewInput, PersonaDesignReview,
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
            )
            .await;

            let elapsed = start_time.elapsed().as_millis() as u64;

            let now = chrono::Utc::now().to_rfc3339();

            match cli_result {
                Ok(full_output) => {
                    // Check for a question (skip in batch mode)
                    if design::extract_design_question(&full_output).is_some() {
                        tracing::warn!(
                            test_case = %test_case_name,
                            "Claude asked a question during batch generation — skipping"
                        );
                        let _ = repo::create_review(
                            &pool,
                            &CreateDesignReviewInput {
                                test_case_id,
                                test_case_name: test_case_name.clone(),
                                instruction,
                                status: "error".into(),
                                structural_score: Some(0),
                                semantic_score: Some(0),
                                connectors_used: None,
                                trigger_types: None,
                                design_result: None,
                                structural_evaluation: None,
                                semantic_evaluation: None,
                                test_run_id: run_id_clone.clone(),
                                had_references: None,
                                suggested_adjustment: Some(
                                    "Claude asked a clarification question instead of generating. Re-run with a more specific instruction.".into()
                                ),
                                adjustment_generation: None,
                                use_case_flows: None,
                                reviewed_at: now,
                            },
                        );
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

                            let status = if structural_score >= 60 && semantic_score >= 40 {
                                "passed"
                            } else {
                                "failed"
                            };

                            let _ = repo::create_review(
                                &pool,
                                &CreateDesignReviewInput {
                                    test_case_id,
                                    test_case_name: test_case_name.clone(),
                                    instruction,
                                    status: status.into(),
                                    structural_score: Some(structural_score),
                                    semantic_score: Some(semantic_score),
                                    connectors_used: Some(connectors_used),
                                    trigger_types: Some(trigger_types),
                                    design_result: Some(result_json),
                                    structural_evaluation: None,
                                    semantic_evaluation: None,
                                    test_run_id: run_id_clone.clone(),
                                    had_references: None,
                                    suggested_adjustment: None,
                                    adjustment_generation: None,
                                    use_case_flows: None,
                                    reviewed_at: now,
                                },
                            );

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
                            let _ = repo::create_review(
                                &pool,
                                &CreateDesignReviewInput {
                                    test_case_id,
                                    test_case_name: test_case_name.clone(),
                                    instruction,
                                    status: "error".into(),
                                    structural_score: Some(0),
                                    semantic_score: Some(0),
                                    connectors_used: None,
                                    trigger_types: None,
                                    design_result: None,
                                    structural_evaluation: None,
                                    semantic_evaluation: None,
                                    test_run_id: run_id_clone.clone(),
                                    had_references: None,
                                    suggested_adjustment: Some(
                                        "Failed to extract valid JSON from Claude output".into(),
                                    ),
                                    adjustment_generation: None,
                                    use_case_flows: None,
                                    reviewed_at: now,
                                },
                            );
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
                    let _ = repo::create_review(
                        &pool,
                        &CreateDesignReviewInput {
                            test_case_id,
                            test_case_name: test_case_name.clone(),
                            instruction,
                            status: "error".into(),
                            structural_score: Some(0),
                            semantic_score: Some(0),
                            connectors_used: None,
                            trigger_types: None,
                            design_result: None,
                            structural_evaluation: None,
                            semantic_evaluation: Some(error_msg.clone()),
                            test_run_id: run_id_clone.clone(),
                            had_references: None,
                            suggested_adjustment: None,
                            adjustment_generation: None,
                            use_case_flows: None,
                            reviewed_at: now,
                        },
                    );
                    emit_status(
                        &app, &run_id_clone, i, total,
                        "error", &test_case_name,
                        Some(error_msg), Some(elapsed),
                    );
                }
            }
        }

        // Cleanup cancellation flag
        {
            let mut map = cancel_map.lock().unwrap();
            map.remove(&run_id_clone);
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
    Ok(())
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

// ── Adopt Design Review as Persona ────────────────────────────

#[tauri::command]
pub fn adopt_design_review(
    state: State<'_, Arc<AppState>>,
    review_id: String,
) -> Result<serde_json::Value, AppError> {
    let review = repo::get_review_by_id(&state.db, &review_id)?;

    let design_result_str = review
        .design_result
        .as_deref()
        .ok_or_else(|| AppError::Validation("No design data available for this template".into()))?;

    let design: serde_json::Value = serde_json::from_str(design_result_str)
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
        .or_else(|| Some(format!("Adopted from template: {}", review.test_case_name)));

    let structured_prompt = design.get("structured_prompt").map(|v| v.to_string());

    let persona = persona_repo::create(
        &state.db,
        CreatePersonaInput {
            name: review.test_case_name,
            system_prompt: full_prompt,
            project_id: None,
            description: summary,
            structured_prompt,
            icon: None,
            color: None,
            enabled: Some(false),
            max_concurrent: None,
            timeout_ms: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: Some(design_result_str.to_string()),
            group_id: None,
        },
    )?;

    Ok(json!({ "persona": persona }))
}

// ── CLI Runner ─────────────────────────────────────────────────

/// Spawn Claude CLI for a single template and return the full output string.
async fn run_cli_for_template(
    cli_args: &crate::engine::types::CliArgs,
    prompt_text: &str,
    app: &tauri::AppHandle,
    run_id: &str,
    test_case_index: usize,
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

    // Wait for process
    let _ = child.wait().await;

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

/// Score a generated DesignAnalysisResult for quality.
/// Returns (structural_score, semantic_score) each 0-100.
fn score_design_result(
    result: &serde_json::Value,
    tool_names: &[String],
    connector_names: &[String],
) -> (i32, i32) {
    let mut structural = 0i32;

    // Top-level fields
    if result.get("structured_prompt").is_some() {
        structural += 20;
    }
    if result.get("suggested_tools").is_some() {
        structural += 15;
    }
    if result.get("suggested_triggers").is_some() {
        structural += 15;
    }
    if result.get("full_prompt_markdown").is_some() {
        structural += 20;
    }
    if result.get("summary").is_some() {
        structural += 10;
    }

    // Structured prompt sub-fields
    if let Some(sp) = result.get("structured_prompt") {
        if sp
            .get("identity")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.len() > 20)
        {
            structural += 5;
        }
        if sp
            .get("instructions")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.len() > 50)
        {
            structural += 5;
        }
        if sp
            .get("toolGuidance")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty())
        {
            structural += 5;
        }
        if sp
            .get("errorHandling")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty())
        {
            structural += 5;
        }
    }

    // Semantic score: tool/connector matching
    let mut semantic = 0i32;

    if let Some(tools) = result.get("suggested_tools").and_then(|v| v.as_array()) {
        if !tools.is_empty() {
            let matched = tools
                .iter()
                .filter_map(|t| t.as_str())
                .filter(|name| tool_names.iter().any(|tn| tn == name))
                .count();
            semantic += ((matched as f64 / tools.len() as f64) * 50.0) as i32;
        }
    }

    if let Some(conns) = result.get("suggested_connectors").and_then(|v| v.as_array()) {
        if !conns.is_empty() {
            let matched = conns
                .iter()
                .filter_map(|c| c.get("name").and_then(|n| n.as_str()))
                .filter(|name| connector_names.iter().any(|cn| cn == name))
                .count();
            semantic += ((matched as f64 / conns.len() as f64) * 50.0) as i32;
        }
    } else {
        // No connectors suggested — give full marks for connector portion
        semantic += 50;
    }

    (structural, semantic)
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
