use std::sync::Arc;

use serde_json::json;
use tauri::State;

use crate::db::repos::core::personas as persona_repo;
use crate::db::models::CreatePersonaInput;
use crate::error::AppError;
use crate::AppState;

use super::types::{N8nPersonaOutput, normalize_n8n_persona_draft};

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
            notification_channels: draft.notification_channels.clone(),
        },
    )?;

    let persona_id = &created.id;

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
    // Track tool_name → requires_credential_type for connector service registration
    let mut tool_credential_map: Vec<(String, String)> = Vec::new();
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
                        script_path: String::new(), // No script — uses Bash tool via prompt
                        input_schema: tool_draft.input_schema.as_ref().and_then(|s| serde_json::to_string(s).ok()),
                        output_schema: None,
                        requires_credential_type: tool_draft.requires_credential_type.clone(),
                        implementation_guide: tool_draft.implementation_guide.clone(),
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

            // Track credential type for connector service registration
            if let Some(ref cred_type) = tool_draft.requires_credential_type {
                tool_credential_map.push((tool_name.clone(), cred_type.clone()));
            }

            // Assign tool to persona
            match tool_repo::assign_tool(&state.db, persona_id, &tool_def_id, None) {
                Ok(_) => tools_created += 1,
                Err(e) => tracing::warn!(tool_name = %tool_name, error = %e, "Failed to assign n8n tool to persona"),
            }
        }
    }

    // Register n8n tools in matching connector services so credential resolution works.
    // Groups tools by their requires_credential_type, then appends them to the
    // matching connector's services JSON array.
    if !tool_credential_map.is_empty() {
        use crate::db::repos::resources::connectors as connector_repo;
        use crate::db::models::UpdateConnectorDefinitionInput;

        if let Ok(connectors) = connector_repo::get_all(&state.db) {
            // Group tool names by credential type
            let mut type_to_tools: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();
            for (tool_name, cred_type) in &tool_credential_map {
                type_to_tools
                    .entry(cred_type.clone())
                    .or_default()
                    .push(tool_name.clone());
            }

            for (cred_type, tool_names) in &type_to_tools {
                // Find matching connector by name or prefix
                let matching_connector = connectors.iter().find(|c| {
                    c.name == *cred_type
                        || c.name.starts_with(cred_type.as_str())
                        || cred_type.starts_with(&c.name)
                });

                if let Some(connector) = matching_connector {
                    let mut services: Vec<serde_json::Value> =
                        serde_json::from_str(&connector.services).unwrap_or_default();

                    for tool_name in tool_names {
                        // Only add if not already present
                        let already_listed = services.iter().any(|s| {
                            s.get("toolName")
                                .and_then(|v| v.as_str())
                                .map(|n| n == tool_name.as_str())
                                .unwrap_or(false)
                        });
                        if !already_listed {
                            services.push(serde_json::json!({
                                "toolName": tool_name,
                                "source": "n8n_import"
                            }));
                        }
                    }

                    if let Ok(services_json) = serde_json::to_string(&services) {
                        let _ = connector_repo::update(
                            &state.db,
                            &connector.id,
                            UpdateConnectorDefinitionInput {
                                services: Some(services_json),
                                name: None,
                                label: None,
                                icon_url: None,
                                color: None,
                                category: None,
                                fields: None,
                                healthcheck_config: None,
                                events: None,
                                metadata: None,
                            },
                        );
                    }
                }
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
