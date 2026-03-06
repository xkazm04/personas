use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::commands::credentials::ai_artifact_flow::spawn_claude_and_collect;
use crate::commands::design::n8n_transform::cli_runner::extract_first_json_object_matching;
use crate::db::repos::communication::reviews as repo;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Model for smart search — cheap and fast, this is a ranking task.
const SMART_SEARCH_MODEL: &str = "claude-haiku-4-5-20251001";
const SMART_SEARCH_TIMEOUT_SECS: u64 = 60;

// ============================================================================
// Types
// ============================================================================

/// Compact template summary sent to the LLM (not the full PersonaDesignReview).
#[derive(Serialize)]
struct TemplateSummary {
    id: String,
    name: String,
    instruction_snippet: String,
    category: Option<String>,
    connectors: Vec<String>,
    trigger_types: Vec<String>,
}

/// Response from smart search (camelCase for the TS/frontend boundary).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SmartSearchResult {
    pub ranked_ids: Vec<String>,
    pub rationale: String,
    /// CLI log lines captured during the search (for debugging UI).
    pub cli_log: Vec<String>,
}

/// Raw shape Claude outputs (snake_case) — used only for deserialization.
#[derive(Deserialize)]
struct RawSearchResult {
    ranked_ids: Vec<String>,
    rationale: String,
}

// ============================================================================
// Prompt builder
// ============================================================================

fn build_smart_search_prompt(query: &str, summaries_json: &str) -> String {
    format!(
        r#"You are an intelligent template search engine for an agentic automation platform.

## User Query
{query}

## Available Templates
Below is a JSON array of template summaries. Each has an id, name, instruction_snippet, category, connectors, and trigger_types.

{summaries_json}

## Task
Analyze the user's query to understand their intent. Then rank the templates that best match their needs. Consider:
1. Semantic similarity between the query intent and the template's purpose (instruction_snippet)
2. Connector/service alignment (if the user mentions specific services like "GitHub", "Slack", "Jira")
3. Category relevance
4. Trigger type compatibility (if the user implies polling, webhooks, schedules, etc.)

Return ONLY a JSON object with this exact shape:
{{
  "ranked_ids": ["id1", "id2", "id3"],
  "rationale": "Brief explanation of why these templates match"
}}

Rules:
- Return at most 10 template IDs, ordered by relevance (best match first)
- Only include templates with genuine relevance (don't pad with weak matches)
- If no templates match well, return an empty ranked_ids array
- Return ONLY the JSON object, no other text"#
    )
}

// ============================================================================
// Tauri command
// ============================================================================

#[tauri::command]
pub async fn smart_search_templates(
    state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<SmartSearchResult, AppError> {
    require_auth(&state).await?;
    let query = query.trim().to_string();
    if query.len() < 5 {
        return Err(AppError::Validation(
            "Query too short for AI search".into(),
        ));
    }

    // Load all templates (compact query — we only need summary fields)
    let reviews = repo::get_reviews(&state.db, None, Some(500))?;
    if reviews.is_empty() {
        return Ok(SmartSearchResult {
            ranked_ids: vec![],
            rationale: "No templates available in the gallery.".into(),
            cli_log: vec![],
        });
    }

    // Build compact summaries for the prompt
    let summaries: Vec<TemplateSummary> = reviews
        .iter()
        .map(|r| {
            let instruction_snippet = if r.instruction.len() > 200 {
                format!("{}...", &r.instruction[..200])
            } else {
                r.instruction.clone()
            };
            let connectors: Vec<String> = r
                .connectors_used
                .as_deref()
                .filter(|c| !c.is_empty())
                .map(|c| c.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default();
            let trigger_types: Vec<String> = r
                .trigger_types
                .as_deref()
                .filter(|t| !t.is_empty())
                .map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default();
            TemplateSummary {
                id: r.id.clone(),
                name: r.test_case_name.clone(),
                instruction_snippet,
                category: r.category.clone(),
                connectors,
                trigger_types,
            }
        })
        .collect();

    let summaries_json =
        serde_json::to_string_pretty(&summaries).unwrap_or_else(|_| "[]".into());
    let prompt_text = build_smart_search_prompt(&query, &summaries_json);

    // Build CLI args with haiku model
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(SMART_SEARCH_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    // Collect CLI log lines for debugging UI
    let cli_log = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let cli_log_ref = cli_log.clone();

    // Call Claude with spawn_claude_and_collect for log visibility
    let spawn_result = spawn_claude_and_collect(
        &cli_args,
        prompt_text,
        SMART_SEARCH_TIMEOUT_SECS,
        move |_line_type, raw_line| {
            // Capture each raw CLI line for the debug log
            let trimmed = raw_line.trim();
            if !trimmed.is_empty() {
                if let Ok(mut log) = cli_log_ref.lock() {
                    log.push(trimmed.to_string());
                }
            }
        },
        None,
    )
    .await
    .map_err(AppError::Internal)?;

    let output_text = &spawn_result.text_output;
    let log_lines: Vec<String> = cli_log.lock().unwrap_or_else(|e| e.into_inner()).clone();

    if output_text.trim().is_empty() {
        return Err(AppError::Internal(
            "Claude produced no output for smart search".into(),
        ));
    }

    // Parse response using RawSearchResult (snake_case, matching Claude's output)
    let json_str = extract_first_json_object_matching(output_text, |val| {
        val.get("ranked_ids").is_some()
    })
    .ok_or_else(|| {
        AppError::Internal(format!(
            "Failed to extract search results from Claude output. Raw output:\n{}",
            &output_text[..output_text.len().min(500)]
        ))
    })?;

    let raw: RawSearchResult =
        serde_json::from_str(&json_str).map_err(AppError::Serde)?;

    Ok(SmartSearchResult {
        ranked_ids: raw.ranked_ids,
        rationale: raw.rationale,
        cli_log: log_lines,
    })
}
