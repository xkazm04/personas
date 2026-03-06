use std::io::{Read as IoRead, Write as IoWrite};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::{
    groups as group_repo, memories as memory_repo, personas as persona_repo,
};
use crate::db::repos::execution::{test_suites as suite_repo};
use crate::db::repos::resources::{
    connectors as connector_repo, teams as team_repo, tools as tool_repo, triggers as trigger_repo,
};
use crate::db::DbPool;
use crate::error::AppError;
use crate::AppState;

// ============================================================================
// Export bundle types
// ============================================================================

/// Top-level archive manifest (version 2 = full portability format).
#[derive(Debug, Serialize, Deserialize)]
pub struct PortabilityBundle {
    pub format_version: u32,
    pub exported_at: String,
    pub app_version: String,
    pub scope: ExportScope,
    pub personas: Vec<PersonaExport>,
    pub groups: Vec<GroupExport>,
    pub tool_definitions: Vec<ToolDefinitionExport>,
    pub teams: Vec<TeamExport>,
    pub connectors: Vec<ConnectorExport>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ExportScope {
    Full,
    Selective { persona_ids: Vec<String>, team_ids: Vec<String> },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PersonaExport {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub structured_prompt: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub max_concurrent: i32,
    pub timeout_ms: i32,
    pub notification_channels: Option<String>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub design_context: Option<String>,
    pub group_id: Option<String>,
    pub triggers: Vec<TriggerExport>,
    pub subscriptions: Vec<SubscriptionExport>,
    pub memories: Vec<MemoryExport>,
    pub tool_ids: Vec<String>,
    pub test_suites: Vec<TestSuiteExport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TriggerExport {
    pub trigger_type: String,
    pub config: Option<String>,
    pub enabled: bool,
    pub use_case_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubscriptionExport {
    pub event_type: String,
    pub source_filter: Option<String>,
    pub enabled: bool,
    pub use_case_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryExport {
    pub title: String,
    pub content: String,
    pub category: String,
    pub importance: i32,
    pub tags: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestSuiteExport {
    pub name: String,
    pub description: Option<String>,
    pub scenarios: String,
    pub scenario_count: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupExport {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub sort_order: i32,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolDefinitionExport {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub input_schema: Option<String>,
    pub requires_credential_type: Option<String>,
    pub implementation_guide: Option<String>,
    pub is_builtin: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TeamExport {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub canvas_data: Option<String>,
    pub team_config: Option<String>,
    pub icon: Option<String>,
    pub members: Vec<TeamMemberExport>,
    pub connections: Vec<TeamConnectionExport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TeamMemberExport {
    pub persona_id: String,
    pub role: Option<String>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub config: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TeamConnectionExport {
    pub source_persona_id: String,
    pub target_persona_id: String,
    pub connection_type: Option<String>,
    pub condition: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectorExport {
    pub name: String,
    pub label: String,
    pub fields: String,
    pub services: String,
    pub category: String,
}

// ============================================================================
// Import result types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct PortabilityImportResult {
    pub personas_created: u32,
    pub teams_created: u32,
    pub tools_created: u32,
    pub groups_created: u32,
    pub connectors_created: u32,
    pub warnings: Vec<String>,
    pub id_mapping: std::collections::HashMap<String, String>,
}

// ============================================================================
// Export stats (for UI preview)
// ============================================================================

#[derive(Debug, Serialize)]
pub struct ExportStats {
    pub persona_count: u32,
    pub group_count: u32,
    pub tool_count: u32,
    pub team_count: u32,
    pub connector_count: u32,
    pub memory_count: u32,
    pub test_suite_count: u32,
}

// ============================================================================
// Commands
// ============================================================================

/// Get export statistics for the entire workspace (for UI preview).
#[tauri::command]
pub async fn get_export_stats(
    state: State<'_, Arc<AppState>>,
) -> Result<ExportStats, AppError> {
    let pool = &state.db;
    let personas = persona_repo::get_all(pool)?;
    let groups = group_repo::get_all(pool)?;
    let tools = tool_repo::get_all_definitions(pool)?;
    let teams = team_repo::get_all(pool)?;
    let connectors = connector_repo::get_all(pool)?;

    let mut memory_count: u32 = 0;
    let mut test_suite_count: u32 = 0;
    for p in &personas {
        memory_count += memory_repo::get_all(pool, Some(&p.id), None, None, None, None)?
            .len() as u32;
        test_suite_count += suite_repo::list_by_persona(pool, &p.id)?.len() as u32;
    }

    Ok(ExportStats {
        persona_count: personas.len() as u32,
        group_count: groups.len() as u32,
        tool_count: tools.len() as u32,
        team_count: teams.len() as u32,
        connector_count: connectors.len() as u32,
        memory_count,
        test_suite_count,
    })
}

/// Full export: export everything into a compressed JSON archive via save dialog.
#[tauri::command]
pub async fn export_full(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<bool, AppError> {
    let pool = &state.db;
    let bundle = build_export_bundle(pool, ExportScope::Full)?;
    save_bundle_to_file(&app, &bundle, "personas_full_export").await
}

/// Selective export: export only specified personas and teams.
#[tauri::command]
pub async fn export_selective(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    persona_ids: Vec<String>,
    team_ids: Vec<String>,
) -> Result<bool, AppError> {
    let pool = &state.db;
    let scope = ExportScope::Selective {
        persona_ids: persona_ids.clone(),
        team_ids: team_ids.clone(),
    };
    let bundle = build_export_bundle(pool, scope)?;
    save_bundle_to_file(&app, &bundle, "personas_selective_export").await
}

/// Import a previously exported portability bundle.
#[tauri::command]
pub async fn import_portability_bundle(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<Option<PortabilityImportResult>, AppError> {
    let app_clone = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .add_filter("Personas Export", &["zip", "json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;

    let content = if path.extension().map_or(false, |ext| ext == "zip") {
        read_zip_bundle(&path)?
    } else {
        tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?
    };

    let bundle: PortabilityBundle = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Invalid export file: {e}")))?;

    if bundle.format_version != 2 {
        return Err(AppError::Validation(format!(
            "Unsupported format version: {} (expected 2)",
            bundle.format_version
        )));
    }

    let pool = &state.db;
    let result = import_bundle(pool, &bundle)?;
    Ok(Some(result))
}

/// Parse a competitive workflow file (n8n, Zapier, Make) and return a preview
/// of what would be imported as persona agents.
#[tauri::command]
pub async fn preview_competitive_import(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<Option<Vec<CompetitiveImportPreview>>, AppError> {
    let _ = &state.db; // validate state

    let app_clone = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .add_filter("Workflow Files", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?;

    let previews = parse_competitive_workflow(&content)?;
    Ok(Some(previews))
}

#[derive(Debug, Serialize)]
pub struct CompetitiveImportPreview {
    pub source_platform: String,
    pub workflow_name: String,
    pub description: String,
    pub suggested_tools: Vec<String>,
    pub suggested_triggers: Vec<String>,
}

// ============================================================================
// Internal helpers
// ============================================================================

fn build_export_bundle(pool: &DbPool, scope: ExportScope) -> Result<PortabilityBundle, AppError> {
    let all_personas = persona_repo::get_all(pool)?;
    let all_groups = group_repo::get_all(pool)?;
    let all_tools = tool_repo::get_all_definitions(pool)?;
    let all_teams = team_repo::get_all(pool)?;
    let all_connectors = connector_repo::get_all(pool)?;

    let (selected_persona_ids, selected_team_ids) = match &scope {
        ExportScope::Full => (
            all_personas.iter().map(|p| p.id.clone()).collect::<Vec<_>>(),
            all_teams.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
        ),
        ExportScope::Selective {
            persona_ids,
            team_ids,
        } => (persona_ids.clone(), team_ids.clone()),
    };

    // Build persona exports
    let mut persona_exports = Vec::new();
    for p in &all_personas {
        if !selected_persona_ids.contains(&p.id) {
            continue;
        }

        let triggers = trigger_repo::get_by_persona_id(pool, &p.id)?;
        let subscriptions = event_repo::get_subscriptions_by_persona(pool, &p.id)?;
        let memories = memory_repo::get_all(pool, Some(&p.id), None, None, None, None)?;
        let tools = tool_repo::get_tools_for_persona(pool, &p.id)?;
        let test_suites = suite_repo::list_by_persona(pool, &p.id)?;

        persona_exports.push(PersonaExport {
            id: p.id.clone(),
            name: p.name.clone(),
            description: p.description.clone(),
            system_prompt: p.system_prompt.clone(),
            structured_prompt: p.structured_prompt.clone(),
            icon: p.icon.clone(),
            color: p.color.clone(),
            max_concurrent: p.max_concurrent,
            timeout_ms: p.timeout_ms,
            notification_channels: p.notification_channels.clone(),
            model_profile: p.model_profile.clone(),
            max_budget_usd: p.max_budget_usd,
            max_turns: p.max_turns,
            design_context: p.design_context.clone(),
            group_id: p.group_id.clone(),
            triggers: triggers
                .iter()
                .map(|t| TriggerExport {
                    trigger_type: t.trigger_type.clone(),
                    config: t.config.clone(),
                    enabled: t.enabled,
                    use_case_id: t.use_case_id.clone(),
                })
                .collect(),
            subscriptions: subscriptions
                .iter()
                .map(|s| SubscriptionExport {
                    event_type: s.event_type.clone(),
                    source_filter: s.source_filter.clone(),
                    enabled: s.enabled,
                    use_case_id: s.use_case_id.clone(),
                })
                .collect(),
            memories: memories
                .iter()
                .map(|m| MemoryExport {
                    title: m.title.clone(),
                    content: m.content.clone(),
                    category: m.category.clone(),
                    importance: m.importance,
                    tags: m.tags.clone(),
                })
                .collect(),
            tool_ids: tools.iter().map(|t| t.id.clone()).collect(),
            test_suites: test_suites
                .iter()
                .map(|s| TestSuiteExport {
                    name: s.name.clone(),
                    description: s.description.clone(),
                    scenarios: s.scenarios.clone(),
                    scenario_count: s.scenario_count,
                })
                .collect(),
        });
    }

    // Collect only referenced group IDs
    let referenced_group_ids: std::collections::HashSet<String> = persona_exports
        .iter()
        .filter_map(|p| p.group_id.clone())
        .collect();

    let group_exports: Vec<GroupExport> = all_groups
        .iter()
        .filter(|g| matches!(&scope, ExportScope::Full) || referenced_group_ids.contains(&g.id))
        .map(|g| GroupExport {
            id: g.id.clone(),
            name: g.name.clone(),
            color: Some(g.color.clone()),
            sort_order: g.sort_order,
            description: g.description.clone(),
        })
        .collect();

    // Collect only referenced tool IDs
    let referenced_tool_ids: std::collections::HashSet<String> = persona_exports
        .iter()
        .flat_map(|p| p.tool_ids.iter().cloned())
        .collect();

    let tool_exports: Vec<ToolDefinitionExport> = all_tools
        .iter()
        .filter(|t| matches!(&scope, ExportScope::Full) || referenced_tool_ids.contains(&t.id))
        .map(|t| ToolDefinitionExport {
            id: t.id.clone(),
            name: t.name.clone(),
            category: t.category.clone(),
            description: t.description.clone(),
            input_schema: t.input_schema.clone(),
            requires_credential_type: t.requires_credential_type.clone(),
            implementation_guide: t.implementation_guide.clone(),
            is_builtin: t.is_builtin,
        })
        .collect();

    // Build team exports
    let mut team_exports = Vec::new();
    for t in &all_teams {
        if !selected_team_ids.contains(&t.id) {
            continue;
        }

        let members = team_repo::get_members(pool, &t.id)?;
        let connections = team_repo::get_connections(pool, &t.id)?;

        team_exports.push(TeamExport {
            id: t.id.clone(),
            name: t.name.clone(),
            description: t.description.clone(),
            canvas_data: t.canvas_data.clone(),
            team_config: t.team_config.clone(),
            icon: t.icon.clone(),
            members: members
                .iter()
                .map(|m| TeamMemberExport {
                    persona_id: m.persona_id.clone(),
                    role: Some(m.role.clone()),
                    position_x: Some(m.position_x),
                    position_y: Some(m.position_y),
                    config: m.config.clone(),
                })
                .collect(),
            connections: connections
                .iter()
                .map(|c| TeamConnectionExport {
                    source_persona_id: c.source_member_id.clone(),
                    target_persona_id: c.target_member_id.clone(),
                    connection_type: Some(c.connection_type.clone()),
                    condition: c.condition.clone(),
                    label: c.label.clone(),
                })
                .collect(),
        });
    }

    // Connector exports
    let connector_exports: Vec<ConnectorExport> = all_connectors
        .iter()
        .map(|c| ConnectorExport {
            name: c.name.clone(),
            label: c.label.clone(),
            fields: c.fields.clone(),
            services: c.services.clone(),
            category: c.category.clone(),
        })
        .collect();

    Ok(PortabilityBundle {
        format_version: 2,
        exported_at: chrono::Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        scope,
        personas: persona_exports,
        groups: group_exports,
        tool_definitions: tool_exports,
        teams: team_exports,
        connectors: connector_exports,
    })
}

async fn save_bundle_to_file(
    app: &AppHandle,
    bundle: &PortabilityBundle,
    default_name: &str,
) -> Result<bool, AppError> {
    let json = serde_json::to_string_pretty(bundle)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let file_name = format!("{}_{}.zip", default_name, timestamp);
    let app_clone = app.clone();

    let save_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("Personas Export Archive", &["zip"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    if let Some(file_path) = save_path {
        let path = file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;

        // Write as ZIP containing the JSON manifest
        let zip_bytes = create_zip_bundle(&json)?;
        tokio::fs::write(&path, zip_bytes)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;

        return Ok(true);
    }

    Ok(false)
}

fn create_zip_bundle(json: &str) -> Result<Vec<u8>, AppError> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP error: {e}")))?;
        zip.write_all(json.as_bytes())
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.finish()
            .map_err(|e| AppError::Internal(format!("ZIP finish error: {e}")))?;
    }
    Ok(buf.into_inner())
}

fn read_zip_bundle(path: &std::path::Path) -> Result<String, AppError> {
    let file = std::fs::File::open(path)
        .map_err(|e| AppError::Internal(format!("Failed to open ZIP: {e}")))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Internal(format!("Invalid ZIP archive: {e}")))?;
    let mut manifest = archive
        .by_name("manifest.json")
        .map_err(|_| AppError::Validation("ZIP archive does not contain manifest.json".into()))?;
    let mut content = String::new();
    manifest
        .read_to_string(&mut content)
        .map_err(|e| AppError::Internal(format!("Failed to read manifest: {e}")))?;
    Ok(content)
}

fn import_bundle(
    pool: &DbPool,
    bundle: &PortabilityBundle,
) -> Result<PortabilityImportResult, AppError> {
    let mut result = PortabilityImportResult {
        personas_created: 0,
        teams_created: 0,
        tools_created: 0,
        groups_created: 0,
        connectors_created: 0,
        warnings: Vec::new(),
        id_mapping: std::collections::HashMap::new(),
    };

    // Phase 1: Import groups (map old IDs to new IDs)
    for g in &bundle.groups {
        match group_repo::create(
            pool,
            crate::db::models::CreatePersonaGroupInput {
                name: format!("{} (imported)", g.name),
                color: g.color.clone(),
                sort_order: Some(g.sort_order),
                description: g.description.clone(),
            },
        ) {
            Ok(new_group) => {
                result.id_mapping.insert(g.id.clone(), new_group.id);
                result.groups_created += 1;
            }
            Err(e) => result
                .warnings
                .push(format!("Group '{}': {}", g.name, e)),
        }
    }

    // Phase 2: Import tool definitions (map old IDs to new IDs, skip builtins)
    for t in &bundle.tool_definitions {
        if t.is_builtin {
            // Builtin tools already exist — try to find matching by name
            if let Ok(all_defs) = tool_repo::get_all_definitions(pool) {
                if let Some(existing) = all_defs.iter().find(|d| d.name == t.name) {
                    result
                        .id_mapping
                        .insert(t.id.clone(), existing.id.clone());
                    continue;
                }
            }
        }

        match tool_repo::create_definition(
            pool,
            crate::db::models::CreateToolDefinitionInput {
                name: t.name.clone(),
                category: t.category.clone(),
                description: t.description.clone(),
                script_path: String::new(),
                input_schema: t.input_schema.clone(),
                output_schema: None,
                requires_credential_type: t.requires_credential_type.clone(),
                implementation_guide: t.implementation_guide.clone(),
                is_builtin: Some(t.is_builtin),
            },
        ) {
            Ok(new_tool) => {
                result.id_mapping.insert(t.id.clone(), new_tool.id);
                result.tools_created += 1;
            }
            Err(e) => result
                .warnings
                .push(format!("Tool '{}': {}", t.name, e)),
        }
    }

    // Phase 3: Import connectors
    for c in &bundle.connectors {
        // Skip if connector with same name already exists
        if let Ok(existing) = connector_repo::get_all(pool) {
            if existing.iter().any(|e| e.name == c.name) {
                continue;
            }
        }
        match connector_repo::create(
            pool,
            crate::db::models::CreateConnectorDefinitionInput {
                name: c.name.clone(),
                label: c.label.clone(),
                icon_url: None,
                color: None,
                category: Some(c.category.clone()),
                fields: c.fields.clone(),
                healthcheck_config: None,
                services: Some(c.services.clone()),
                events: None,
                metadata: None,
                is_builtin: None,
            },
        ) {
            Ok(_) => result.connectors_created += 1,
            Err(e) => result
                .warnings
                .push(format!("Connector '{}': {}", c.name, e)),
        }
    }

    // Phase 4: Import personas (map old IDs to new, remap group_id)
    for p in &bundle.personas {
        let mapped_group_id = p
            .group_id
            .as_ref()
            .and_then(|gid| result.id_mapping.get(gid))
            .cloned();

        match persona_repo::create(
            pool,
            crate::db::models::CreatePersonaInput {
                name: format!("{} (imported)", p.name),
                system_prompt: p.system_prompt.clone(),
                project_id: None,
                description: p.description.clone(),
                structured_prompt: p.structured_prompt.clone(),
                icon: p.icon.clone(),
                color: p.color.clone(),
                enabled: Some(false),
                max_concurrent: Some(p.max_concurrent),
                timeout_ms: Some(p.timeout_ms),
                model_profile: p.model_profile.clone(),
                max_budget_usd: p.max_budget_usd,
                max_turns: p.max_turns,
                design_context: p.design_context.clone(),
                group_id: mapped_group_id,
                notification_channels: p.notification_channels.clone(),
            },
        ) {
            Ok(new_persona) => {
                let new_id = new_persona.id.clone();
                result.id_mapping.insert(p.id.clone(), new_id.clone());
                result.personas_created += 1;

                // Sub-entities: triggers
                for t in &p.triggers {
                    if let Err(e) = trigger_repo::create(
                        pool,
                        crate::db::models::CreateTriggerInput {
                            persona_id: new_id.clone(),
                            trigger_type: t.trigger_type.clone(),
                            config: t.config.clone(),
                            enabled: Some(t.enabled),
                            use_case_id: t.use_case_id.clone(),
                        },
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' trigger ({}): {}",
                            p.name, t.trigger_type, e
                        ));
                    }
                }

                // Sub-entities: subscriptions
                for s in &p.subscriptions {
                    if let Err(e) = event_repo::create_subscription(
                        pool,
                        crate::db::models::CreateEventSubscriptionInput {
                            persona_id: new_id.clone(),
                            event_type: s.event_type.clone(),
                            source_filter: s.source_filter.clone(),
                            enabled: Some(s.enabled),
                            use_case_id: s.use_case_id.clone(),
                        },
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' subscription ({}): {}",
                            p.name, s.event_type, e
                        ));
                    }
                }

                // Sub-entities: memories
                for m in &p.memories {
                    if let Err(e) = memory_repo::create(
                        pool,
                        crate::db::models::CreatePersonaMemoryInput {
                            persona_id: new_id.clone(),
                            title: m.title.clone(),
                            content: m.content.clone(),
                            category: Some(m.category.clone()),
                            source_execution_id: None,
                            importance: Some(m.importance),
                            tags: m.tags.clone(),
                        },
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' memory ({}): {}",
                            p.name, m.title, e
                        ));
                    }
                }

                // Sub-entities: tool assignments
                for old_tool_id in &p.tool_ids {
                    if let Some(new_tool_id) = result.id_mapping.get(old_tool_id) {
                        if let Err(e) =
                            tool_repo::assign_tool(pool, &new_id, new_tool_id, None)
                        {
                            result.warnings.push(format!(
                                "Persona '{}' tool assignment: {}",
                                p.name, e
                            ));
                        }
                    }
                }

                // Sub-entities: test suites
                for s in &p.test_suites {
                    if let Err(e) = suite_repo::create(
                        pool,
                        &new_id,
                        &s.name,
                        s.description.as_deref(),
                        &s.scenarios,
                        s.scenario_count,
                        None,
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' test suite ({}): {}",
                            p.name, s.name, e
                        ));
                    }
                }
            }
            Err(e) => result
                .warnings
                .push(format!("Persona '{}': {}", p.name, e)),
        }
    }

    // Phase 5: Import teams (remap member persona IDs)
    for t in &bundle.teams {
        match team_repo::create(
            pool,
            crate::db::models::CreateTeamInput {
                name: format!("{} (imported)", t.name),
                project_id: None,
                description: t.description.clone(),
                canvas_data: t.canvas_data.clone(),
                team_config: t.team_config.clone(),
                icon: t.icon.clone(),
                color: None,
                enabled: Some(false),
            },
        ) {
            Ok(new_team) => {
                let new_team_id = new_team.id.clone();
                result.id_mapping.insert(t.id.clone(), new_team_id.clone());
                result.teams_created += 1;

                // member old ID -> new member ID mapping for connections
                let mut member_id_map: std::collections::HashMap<String, String> =
                    std::collections::HashMap::new();

                for m in &t.members {
                    let new_persona_id = result
                        .id_mapping
                        .get(&m.persona_id)
                        .cloned()
                        .unwrap_or_else(|| m.persona_id.clone());

                    match team_repo::add_member(
                        pool,
                        &new_team_id,
                        &new_persona_id,
                        m.role.clone(),
                        m.position_x,
                        m.position_y,
                        m.config.clone(),
                    ) {
                        Ok(new_member) => {
                            member_id_map
                                .insert(m.persona_id.clone(), new_member.id.clone());
                        }
                        Err(e) => result.warnings.push(format!(
                            "Team '{}' member: {}",
                            t.name, e
                        )),
                    }
                }

                for c in &t.connections {
                    let source_id = member_id_map
                        .get(&c.source_persona_id)
                        .cloned()
                        .unwrap_or_else(|| c.source_persona_id.clone());
                    let target_id = member_id_map
                        .get(&c.target_persona_id)
                        .cloned()
                        .unwrap_or_else(|| c.target_persona_id.clone());

                    if let Err(e) = team_repo::create_connection(
                        pool,
                        &new_team_id,
                        &source_id,
                        &target_id,
                        c.connection_type.clone(),
                        c.condition.clone(),
                        c.label.clone(),
                    ) {
                        result.warnings.push(format!(
                            "Team '{}' connection: {}",
                            t.name, e
                        ));
                    }
                }
            }
            Err(e) => result
                .warnings
                .push(format!("Team '{}': {}", t.name, e)),
        }
    }

    Ok(result)
}

/// Parse competitive workflow file and return previews.
fn parse_competitive_workflow(content: &str) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| AppError::Validation(format!("Invalid JSON: {e}")))?;

    // Detect platform from structure
    if is_n8n_workflow(&value) {
        return parse_n8n_preview(&value);
    }
    if is_zapier_workflow(&value) {
        return parse_zapier_preview(&value);
    }
    if is_make_workflow(&value) {
        return parse_make_preview(&value);
    }

    Err(AppError::Validation(
        "Unrecognized workflow format. Supported: n8n, Zapier, Make/Integromat".into(),
    ))
}

fn is_n8n_workflow(v: &serde_json::Value) -> bool {
    v.get("nodes").is_some() && v.get("connections").is_some()
}

fn is_zapier_workflow(v: &serde_json::Value) -> bool {
    // Zapier exports have "steps" array and often a "title" field
    v.get("steps").map_or(false, |s| s.is_array())
        && v.get("title").is_some()
}

fn is_make_workflow(v: &serde_json::Value) -> bool {
    // Make/Integromat exports have "modules" array
    v.get("modules").map_or(false, |s| s.is_array())
        || v.get("scenario").is_some()
}

fn parse_n8n_preview(v: &serde_json::Value) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled n8n Workflow")
        .to_string();

    let nodes = v
        .get("nodes")
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();

    let tools: Vec<String> = nodes
        .iter()
        .filter_map(|n| n.get("type").and_then(|t| t.as_str()))
        .filter(|t| !t.starts_with("n8n-nodes-base."))
        .map(|t| t.to_string())
        .collect();

    let triggers: Vec<String> = nodes
        .iter()
        .filter_map(|n| {
            let node_type = n.get("type")?.as_str()?;
            if node_type.contains("Trigger") || node_type.contains("trigger") {
                Some(node_type.to_string())
            } else {
                None
            }
        })
        .collect();

    let desc = format!(
        "n8n workflow with {} nodes. Use the n8n Transform wizard for full AI-assisted conversion.",
        nodes.len()
    );

    Ok(vec![CompetitiveImportPreview {
        source_platform: "n8n".into(),
        workflow_name: name,
        description: desc,
        suggested_tools: tools,
        suggested_triggers: triggers,
    }])
}

fn parse_zapier_preview(v: &serde_json::Value) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let name = v
        .get("title")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled Zap")
        .to_string();

    let steps = v
        .get("steps")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    let apps: Vec<String> = steps
        .iter()
        .filter_map(|s| {
            s.get("app")
                .and_then(|a| a.as_str())
                .map(|a| a.to_string())
        })
        .collect();

    let triggers: Vec<String> = steps
        .first()
        .and_then(|s| s.get("action"))
        .and_then(|a| a.as_str())
        .map(|a| vec![a.to_string()])
        .unwrap_or_default();

    let desc = format!(
        "Zapier Zap with {} steps connecting: {}",
        steps.len(),
        apps.join(", ")
    );

    Ok(vec![CompetitiveImportPreview {
        source_platform: "zapier".into(),
        workflow_name: name,
        description: desc,
        suggested_tools: apps,
        suggested_triggers: triggers,
    }])
}

fn parse_make_preview(v: &serde_json::Value) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let scenario = v.get("scenario").unwrap_or(v);
    let name = scenario
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled Make Scenario")
        .to_string();

    let modules = scenario
        .get("modules")
        .or_else(|| v.get("modules"))
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();

    let tools: Vec<String> = modules
        .iter()
        .filter_map(|m| {
            m.get("module")
                .and_then(|a| a.as_str())
                .map(|a| a.to_string())
        })
        .collect();

    let desc = format!(
        "Make scenario with {} modules: {}",
        modules.len(),
        tools.join(", ")
    );

    Ok(vec![CompetitiveImportPreview {
        source_platform: "make".into(),
        workflow_name: name,
        description: desc,
        suggested_tools: tools,
        suggested_triggers: vec![],
    }])
}
