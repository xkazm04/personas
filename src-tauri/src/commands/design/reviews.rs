use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};

use crate::db::models::{CreateDesignReviewInput, CreatePersonaInput, PersonaDesignReview, PersonaManualReview};
use crate::db::repos::communication::{manual_reviews as manual_repo, reviews as repo};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::{connectors as connector_repo, tools as tool_repo};
use crate::engine::design;
use crate::error::AppError;
use crate::AppState;

// ── Event payload ───────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct DesignReviewStatusEvent {
    run_id: String,
    test_case_index: usize,
    total: usize,
    status: String,
    test_case_name: String,
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

    tokio::spawn(async move {
        for (i, test_case) in test_cases.iter().enumerate() {
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

            let _ = app.emit(
                "design-review-status",
                DesignReviewStatusEvent {
                    run_id: run_id_clone.clone(),
                    test_case_index: i,
                    total,
                    status: "running".into(),
                    test_case_name: test_case_name.clone(),
                },
            );

            // Build design prompt for this test case
            let design_prompt = design::build_design_prompt(
                &persona,
                &tools,
                &connectors,
                &instruction,
                persona.design_context.as_deref(),
                None,
            );

            // Score based on whether the design result has the right structure
            let (status, structural_score, semantic_score, design_result_str) =
                score_design_prompt(&design_prompt, &tool_names, &connector_names);

            let now = chrono::Utc::now().to_rfc3339();
            let _ = repo::create_review(
                &pool,
                &CreateDesignReviewInput {
                    test_case_id,
                    test_case_name: test_case_name.clone(),
                    instruction,
                    status: status.clone(),
                    structural_score: Some(structural_score),
                    semantic_score: Some(semantic_score),
                    connectors_used: None,
                    trigger_types: None,
                    design_result: design_result_str.clone(),
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

            let _ = app.emit(
                "design-review-status",
                DesignReviewStatusEvent {
                    run_id: run_id_clone.clone(),
                    test_case_index: i,
                    total,
                    status: status.clone(),
                    test_case_name,
                },
            );
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
            },
        );
    });

    Ok(json!({ "run_id": run_id, "total": total }))
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
        None => {
            // Aggregate across all personas
            let personas = persona_repo::get_all(&state.db)?;
            let mut all = Vec::new();
            for p in &personas {
                let reviews = manual_repo::get_by_persona(&state.db, &p.id, status.as_deref())?;
                all.extend(reviews);
            }
            all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            Ok(all)
        }
    }
}

#[tauri::command]
pub fn update_manual_review_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: String,
    reviewer_notes: Option<String>,
) -> Result<PersonaManualReview, AppError> {
    manual_repo::update_status(&state.db, &id, &status, reviewer_notes)?;
    manual_repo::get_by_id(&state.db, &id)
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
    let now = chrono::Utc::now().to_rfc3339();

    let review_input = CreateDesignReviewInput {
        test_case_id: input
            .get("test_case_id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        test_case_name: input
            .get("test_case_name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unnamed")
            .to_string(),
        instruction: input
            .get("instruction")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        status: input
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("passed")
            .to_string(),
        structural_score: input
            .get("structural_score")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        semantic_score: input
            .get("semantic_score")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        connectors_used: input
            .get("connectors_used")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        trigger_types: input
            .get("trigger_types")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        design_result: input
            .get("design_result")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        structural_evaluation: input
            .get("structural_evaluation")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        semantic_evaluation: input
            .get("semantic_evaluation")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        test_run_id: input
            .get("test_run_id")
            .and_then(|v| v.as_str())
            .unwrap_or("imported")
            .to_string(),
        had_references: input
            .get("had_references")
            .and_then(|v| v.as_bool()),
        suggested_adjustment: None,
        adjustment_generation: None,
        use_case_flows: input
            .get("use_case_flows")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        reviewed_at: input
            .get("reviewed_at")
            .and_then(|v| v.as_str())
            .unwrap_or(&now)
            .to_string(),
    };

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

    // Extract fields from the design result
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

    let structured_prompt = design
        .get("structured_prompt")
        .map(|v| v.to_string());

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

/// Score a design prompt based on structural completeness.
/// Returns (status, structural_score, semantic_score, design_result_json).
fn score_design_prompt(
    prompt: &str,
    tool_names: &[String],
    connector_names: &[String],
) -> (String, i32, i32, Option<String>) {
    // Structural score: check prompt has key sections
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

    // Semantic score: check prompt references available resources
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
