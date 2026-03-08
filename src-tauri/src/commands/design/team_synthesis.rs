use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{CreatePersonaInput, CreateTeamInput};
use crate::db::repos::communication::reviews as review_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::teams as team_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// ============================================================================
// Constants
// ============================================================================

const SYNTHESIS_MODEL: &str = "claude-sonnet-4-6";
const SYNTHESIS_TIMEOUT_SECS: u64 = 120;

// ============================================================================
// LLM response types
// ============================================================================

#[derive(Debug, Deserialize)]
struct SynthesisResponse {
    templates: Vec<SelectedTemplate>,
    connections: Vec<SynthesisConnection>,
    team_description: String,
}

#[derive(Debug, Deserialize)]
struct SelectedTemplate {
    review_id: String,
    role: String,
}

#[derive(Debug, Deserialize)]
struct SynthesisConnection {
    source_index: usize,
    target_index: usize,
}

// ============================================================================
// Result type
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamSynthesisResult {
    pub team_id: String,
    pub team_name: String,
    pub member_count: usize,
    pub description: String,
}

// ============================================================================
// Prompt builder
// ============================================================================

fn build_synthesis_prompt(query: &str, templates: &[crate::db::models::PersonaDesignReview]) -> String {
    let catalog: Vec<serde_json::Value> = templates
        .iter()
        .filter(|t| t.status == "passed")
        .map(|t| {
            json!({
                "review_id": t.id,
                "name": t.test_case_name,
                "instruction": if t.instruction.len() > 200 {
                    format!("{}...", &t.instruction[..200])
                } else {
                    t.instruction.clone()
                },
                "connectors": t.connectors_used,
                "category": t.category,
            })
        })
        .collect();

    format!(
        r#"You are a team composition expert. Given a user request and a catalog of available persona templates, select 2-5 templates that together form a cohesive team.

## Available Templates

```json
{catalog}
```

## User Request

"{query}"

## Instructions

1. Select 2-5 templates from the catalog that best address the user's request
2. Assign each a role (e.g., "coordinator", "data-collector", "analyst", "executor", "reviewer")
3. Define connections between them (data flows from source to target)
4. Provide a brief team description

Return ONLY a JSON object in this exact format:
```json
{{
  "templates": [
    {{ "review_id": "<id from catalog>", "role": "coordinator" }},
    {{ "review_id": "<id from catalog>", "role": "executor" }}
  ],
  "connections": [
    {{ "source_index": 0, "target_index": 1 }}
  ],
  "team_description": "Brief description of the team's purpose and workflow"
}}
```

- `source_index` and `target_index` refer to positions in the `templates` array (0-based)
- Every template should be connected to at least one other template
- Prefer linear or fan-out patterns over fully-connected graphs"#,
        catalog = serde_json::to_string_pretty(&catalog).unwrap_or_default(),
        query = query,
    )
}

// ============================================================================
// Command
// ============================================================================

#[tauri::command]
pub async fn synthesize_team_from_templates(
    state: State<'_, Arc<AppState>>,
    query: String,
    team_name: String,
) -> Result<TeamSynthesisResult, AppError> {
    require_auth(&state).await?;
    use crate::commands::credentials::ai_artifact_flow::run_claude_prompt;
    use crate::commands::design::n8n_transform::cli_runner::extract_first_json_object_matching;
    use crate::engine::prompt;
    use crate::engine::topology::compute_dag_layout;

    if query.trim().is_empty() {
        return Err(AppError::Validation("Query cannot be empty".into()));
    }
    if team_name.trim().is_empty() {
        return Err(AppError::Validation("Team name cannot be empty".into()));
    }

    // 1. Load templates
    let templates = review_repo::get_reviews(&state.db, None, Some(100))?;
    let passed_count = templates.iter().filter(|t| t.status == "passed").count();
    if passed_count < 2 {
        return Err(AppError::Validation(
            "Need at least 2 passing templates to synthesize a team".into(),
        ));
    }

    // 2. Build LLM prompt
    let prompt_text = build_synthesis_prompt(&query, &templates);

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(SYNTHESIS_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    // 3. Call Claude
    let output_text = run_claude_prompt(
        prompt_text,
        &cli_args,
        SYNTHESIS_TIMEOUT_SECS,
        "Claude produced no output for team synthesis",
    )
    .await
    .map_err(AppError::Internal)?;

    // 4. Parse response
    let json_str = extract_first_json_object_matching(&output_text, |val| {
        val.get("templates").is_some() && val.get("connections").is_some()
    })
    .ok_or_else(|| {
        AppError::Internal("Failed to extract JSON from Claude output for team synthesis".into())
    })?;

    let response: SynthesisResponse = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Failed to parse synthesis response: {e}")))?;

    if response.templates.is_empty() {
        return Err(AppError::Internal(
            "LLM returned empty template selection".into(),
        ));
    }

    // 5. Validate selected templates exist
    let template_map: std::collections::HashMap<&str, &crate::db::models::PersonaDesignReview> =
        templates.iter().map(|t| (t.id.as_str(), t)).collect();

    let mut valid_templates = Vec::new();
    for st in &response.templates {
        if let Some(tmpl) = template_map.get(st.review_id.as_str()) {
            valid_templates.push((*tmpl, st.role.clone()));
        }
    }

    if valid_templates.is_empty() {
        return Err(AppError::Internal(
            "None of the selected template IDs matched existing templates".into(),
        ));
    }

    // 6. Create personas via instant_adopt logic (inline, not calling tauri command)
    let mut persona_ids: Vec<String> = Vec::new();
    for (tmpl, _role) in &valid_templates {
        let design_json = tmpl.design_result.as_deref().unwrap_or("{}");
        let design: serde_json::Value = serde_json::from_str(design_json).unwrap_or_default();

        let full_prompt = design
            .get("full_prompt_markdown")
            .and_then(|v| v.as_str())
            .unwrap_or("You are a helpful AI assistant.")
            .to_string();

        let summary = design
            .get("summary")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| Some(format!("Adopted from template: {}", tmpl.test_case_name)));

        let structured_prompt = design.get("structured_prompt").map(|v| {
            let mut sp = v.clone();
            if let Some(sections) = sp.get_mut("customSections").and_then(|v| v.as_array_mut()) {
                for section in sections.iter_mut() {
                    if section.get("title").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                        let heading = section.get("label").cloned()
                            .or_else(|| section.get("name").cloned())
                            .or_else(|| section.get("key").cloned());
                        if let Some(heading_val) = heading {
                            if let Some(obj) = section.as_object_mut() {
                                obj.insert("title".into(), heading_val);
                            }
                        }
                    }
                }
            }
            sp.to_string()
        });

        let persona_meta = design.get("persona_meta");
        let icon = persona_meta.and_then(|m| m.get("icon")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let color = persona_meta.and_then(|m| m.get("color")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let model_profile = persona_meta.and_then(|m| m.get("model_profile")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let persona_name = persona_meta
            .and_then(|m| m.get("name"))
            .and_then(|v| v.as_str())
            .filter(|n| !n.trim().is_empty())
            .map(|s| s.to_string())
            .unwrap_or(tmpl.test_case_name.clone());

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
                design_context: Some(design_json.to_string()),
                group_id: None,
                notification_channels: None,
            },
        )?;

        // Track adoption count
        let _ = review_repo::increment_adoption_count(&state.db, &tmpl.test_case_name);

        persona_ids.push(persona.id);
    }

    // 7. Create team
    let team = team_repo::create(
        &state.db,
        CreateTeamInput {
            name: team_name.clone(),
            project_id: None,
            parent_team_id: None,
            description: Some(response.team_description.clone()),
            canvas_data: None,
            team_config: None,
            icon: None,
            color: None,
            enabled: Some(true),
        },
    )?;

    // 8. Add members with DAG layout positions
    let edge_pairs: Vec<(usize, usize)> = response
        .connections
        .iter()
        .filter(|c| c.source_index < persona_ids.len() && c.target_index < persona_ids.len() && c.source_index != c.target_index)
        .map(|c| (c.source_index, c.target_index))
        .collect();

    let positions = compute_dag_layout(persona_ids.len(), &edge_pairs, 180.0, 70.0, 60.0, 100.0);

    let mut member_ids: Vec<String> = Vec::new();
    for (i, persona_id) in persona_ids.iter().enumerate() {
        let role = valid_templates.get(i).map(|(_, r)| r.clone());
        let (px, py) = positions.get(i).copied().unwrap_or((0.0, 0.0));
        let member = team_repo::add_member(
            &state.db,
            &team.id,
            persona_id,
            role,
            Some(px),
            Some(py),
            None,
        )?;
        member_ids.push(member.id);
    }

    // 9. Create connections
    for conn in &response.connections {
        if conn.source_index < member_ids.len()
            && conn.target_index < member_ids.len()
            && conn.source_index != conn.target_index
        {
            let _ = team_repo::create_connection(
                &state.db,
                &team.id,
                &member_ids[conn.source_index],
                &member_ids[conn.target_index],
                Some("sequential".into()),
                None,
                None,
            );
        }
    }

    Ok(TeamSynthesisResult {
        team_id: team.id,
        team_name,
        member_count: persona_ids.len(),
        description: response.team_description,
    })
}
