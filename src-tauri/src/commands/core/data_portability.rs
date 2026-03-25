use std::collections::HashMap;
use std::io::{Read as IoRead, Write as IoWrite};
use std::sync::Arc;

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, State};
use ts_rs::TS;
use tauri_plugin_dialog::DialogExt;

use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::{
    groups as group_repo, memories as memory_repo, personas as persona_repo,
};
use crate::db::repos::execution::{test_suites as suite_repo};
use crate::db::repos::resources::{
    audit_log, connectors as connector_repo, credentials as cred_repo, teams as team_repo,
    tools as tool_repo, triggers as trigger_repo,
};
use crate::db::DbPool;
use crate::engine::crypto;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync, require_privileged};
use crate::validation;
use crate::AppState;

// ============================================================================
// Field length limits (aligned with import_export.rs)
// ============================================================================
const MAX_NAME_LEN: usize = 200;
const MAX_DESCRIPTION_LEN: usize = 2_000;
const MAX_SYSTEM_PROMPT_LEN: usize = 100_000;
const MAX_STRUCTURED_PROMPT_LEN: usize = 100_000;
const MAX_SHORT_FIELD_LEN: usize = 500;
const MAX_CONFIG_LEN: usize = 10_000;
const MAX_DESIGN_CONTEXT_LEN: usize = 50_000;
const MAX_MEMORY_CONTENT_LEN: usize = 50_000;
const MAX_CANVAS_DATA_LEN: usize = 500_000;
const MAX_SCHEMA_LEN: usize = 100_000;
const MAX_SCENARIOS_LEN: usize = 500_000;

// Array size caps
const MAX_PERSONAS: usize = 200;
const MAX_GROUPS: usize = 100;
const MAX_TOOLS: usize = 500;
const MAX_TEAMS: usize = 50;
const MAX_CONNECTORS: usize = 100;
const MAX_TRIGGERS_PER_PERSONA: usize = 100;
const MAX_SUBSCRIPTIONS_PER_PERSONA: usize = 50;
const MAX_MEMORIES_PER_PERSONA: usize = 500;
const MAX_TEST_SUITES_PER_PERSONA: usize = 100;
const MAX_TEAM_MEMBERS: usize = 50;
const MAX_TEAM_CONNECTIONS: usize = 200;

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
    Selective {
        persona_ids: Vec<String>,
        team_ids: Vec<String>,
        #[serde(default)]
        connector_ids: Vec<String>,
    },
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

#[derive(Debug, Serialize, TS)]
#[ts(export)]
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

#[derive(Debug, Serialize, TS)]
#[ts(export)]
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
    require_auth_sync(&state)?;
    let pool = &state.db;
    let personas = persona_repo::get_all(pool)?;
    let groups = group_repo::get_all(pool)?;
    let tools = tool_repo::get_all_definitions(pool)?;
    let teams = team_repo::get_all(pool)?;
    let connectors = connector_repo::get_all(pool)?;

    let mut memory_count: u32 = 0;
    let mut test_suite_count: u32 = 0;
    for p in &personas {
        memory_count += memory_repo::get_all(pool, Some(&p.id), None, None, None, None, None, None)?
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
    require_privileged(&state, "export_full").await?;
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
    connector_ids: Vec<String>,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    let pool = &state.db;
    let scope = ExportScope::Selective {
        persona_ids: persona_ids.clone(),
        team_ids: team_ids.clone(),
        connector_ids: connector_ids.clone(),
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
    require_privileged(&state, "import_portability_bundle").await?;
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

    let content = if path.extension().is_some_and(|ext| ext == "zip") {
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

    validate_bundle(&bundle)?;

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
    require_auth(&state).await?;
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

#[derive(Debug, Serialize, TS)]
#[ts(export)]
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
            ..
        } => (persona_ids.clone(), team_ids.clone()),
    };

    // Batch-fetch all per-persona data in 5 queries instead of 5*N
    let all_triggers = trigger_repo::get_by_persona_ids(pool, &selected_persona_ids)?;
    let all_subscriptions = event_repo::get_subscriptions_by_persona_ids(pool, &selected_persona_ids)?;
    let all_memories = memory_repo::get_all_by_persona_ids(pool, &selected_persona_ids)?;
    let all_persona_tools = tool_repo::get_tools_for_personas(pool, &selected_persona_ids)?;
    let all_test_suites = suite_repo::list_by_persona_ids(pool, &selected_persona_ids)?;

    // Group by persona_id into HashMaps
    let mut triggers_map: HashMap<String, Vec<_>> = HashMap::new();
    for t in all_triggers {
        triggers_map.entry(t.persona_id.clone()).or_default().push(t);
    }
    let mut subscriptions_map: HashMap<String, Vec<_>> = HashMap::new();
    for s in all_subscriptions {
        subscriptions_map.entry(s.persona_id.clone()).or_default().push(s);
    }
    let mut memories_map: HashMap<String, Vec<_>> = HashMap::new();
    for m in all_memories {
        memories_map.entry(m.persona_id.clone()).or_default().push(m);
    }
    let mut tools_map: HashMap<String, Vec<_>> = HashMap::new();
    for (pid, def) in all_persona_tools {
        tools_map.entry(pid).or_default().push(def);
    }
    let mut suites_map: HashMap<String, Vec<_>> = HashMap::new();
    for s in all_test_suites {
        suites_map.entry(s.persona_id.clone()).or_default().push(s);
    }

    // Build persona exports
    let mut persona_exports = Vec::new();
    for p in &all_personas {
        if !selected_persona_ids.contains(&p.id) {
            continue;
        }

        let triggers = triggers_map.remove(&p.id).unwrap_or_default();
        let subscriptions = subscriptions_map.remove(&p.id).unwrap_or_default();
        let memories = memories_map.remove(&p.id).unwrap_or_default();
        let tools = tools_map.remove(&p.id).unwrap_or_default();
        let test_suites = suites_map.remove(&p.id).unwrap_or_default();

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

    // Connector exports (filtered in selective mode when connector_ids is non-empty)
    let selected_connector_ids: Option<&Vec<String>> = match &scope {
        ExportScope::Full => None,
        ExportScope::Selective { connector_ids, .. } if connector_ids.is_empty() => None,
        ExportScope::Selective { connector_ids, .. } => Some(connector_ids),
    };

    let connector_exports: Vec<ConnectorExport> = all_connectors
        .iter()
        .filter(|c| match &selected_connector_ids {
            None => true,
            Some(ids) => ids.contains(&c.id),
        })
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

/// Maximum decompressed size for ZIP entries (50 MB).
const MAX_DECOMPRESSED_SIZE: u64 = 50 * 1024 * 1024;

fn read_zip_bundle(path: &std::path::Path) -> Result<String, AppError> {
    let file = std::fs::File::open(path)
        .map_err(|e| AppError::Internal(format!("Failed to open ZIP: {e}")))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Internal(format!("Invalid ZIP archive: {e}")))?;
    let mut manifest = archive
        .by_name("manifest.json")
        .map_err(|_| AppError::Validation("ZIP archive does not contain manifest.json".into()))?;

    // Guard against zip bombs: reject entries whose declared size exceeds the limit
    if manifest.size() > MAX_DECOMPRESSED_SIZE {
        return Err(AppError::Validation(format!(
            "manifest.json decompressed size ({} bytes) exceeds the {} MB limit",
            manifest.size(),
            MAX_DECOMPRESSED_SIZE / (1024 * 1024)
        )));
    }

    // Read with a capped reader so even a lying size header cannot exhaust memory
    let mut limited = std::io::Read::take(&mut manifest, MAX_DECOMPRESSED_SIZE + 1);
    let mut content = String::new();
    limited
        .read_to_string(&mut content)
        .map_err(|e| AppError::Internal(format!("Failed to read manifest: {e}")))?;

    if content.len() as u64 > MAX_DECOMPRESSED_SIZE {
        return Err(AppError::Validation(format!(
            "manifest.json decompressed content exceeds the {} MB limit",
            MAX_DECOMPRESSED_SIZE / (1024 * 1024)
        )));
    }

    Ok(content)
}

fn validate_bundle(bundle: &PortabilityBundle) -> Result<(), AppError> {
    // Top-level array caps
    validation::require_max_count("personas", &bundle.personas, MAX_PERSONAS)?;
    validation::require_max_count("groups", &bundle.groups, MAX_GROUPS)?;
    validation::require_max_count("tool_definitions", &bundle.tool_definitions, MAX_TOOLS)?;
    validation::require_max_count("teams", &bundle.teams, MAX_TEAMS)?;
    validation::require_max_count("connectors", &bundle.connectors, MAX_CONNECTORS)?;

    // Validate groups
    for (i, g) in bundle.groups.iter().enumerate() {
        validation::require_non_empty(&format!("group[{i}].name"), &g.name)?;
        validation::require_max_len(&format!("group[{i}].name"), &g.name, MAX_NAME_LEN)?;
        validation::require_optional_max_len(&format!("group[{i}].color"), &g.color, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("group[{i}].description"), &g.description, MAX_DESCRIPTION_LEN)?;
    }

    // Validate tool definitions
    for (i, t) in bundle.tool_definitions.iter().enumerate() {
        validation::require_non_empty(&format!("tool[{i}].name"), &t.name)?;
        validation::require_max_len(&format!("tool[{i}].name"), &t.name, MAX_NAME_LEN)?;
        validation::require_max_len(&format!("tool[{i}].category"), &t.category, MAX_SHORT_FIELD_LEN)?;
        validation::require_max_len(&format!("tool[{i}].description"), &t.description, MAX_DESCRIPTION_LEN)?;
        validation::require_optional_max_len(&format!("tool[{i}].input_schema"), &t.input_schema, MAX_SCHEMA_LEN)?;
        validation::require_optional_max_len(&format!("tool[{i}].requires_credential_type"), &t.requires_credential_type, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("tool[{i}].implementation_guide"), &t.implementation_guide, MAX_DESIGN_CONTEXT_LEN)?;
    }

    // Validate connectors
    for (i, c) in bundle.connectors.iter().enumerate() {
        validation::require_non_empty(&format!("connector[{i}].name"), &c.name)?;
        validation::require_max_len(&format!("connector[{i}].name"), &c.name, MAX_NAME_LEN)?;
        validation::require_max_len(&format!("connector[{i}].label"), &c.label, MAX_NAME_LEN)?;
        validation::require_max_len(&format!("connector[{i}].category"), &c.category, MAX_SHORT_FIELD_LEN)?;
        validation::require_max_len(&format!("connector[{i}].fields"), &c.fields, MAX_SCHEMA_LEN)?;
        validation::require_max_len(&format!("connector[{i}].services"), &c.services, MAX_SCHEMA_LEN)?;
    }

    // Validate personas and their sub-entities
    for (i, p) in bundle.personas.iter().enumerate() {
        let prefix = format!("persona[{i}]");

        // Core persona fields
        validation::require_non_empty(&format!("{prefix}.name"), &p.name)?;
        validation::require_max_len(&format!("{prefix}.name"), &p.name, MAX_NAME_LEN)?;
        validation::require_max_len(&format!("{prefix}.system_prompt"), &p.system_prompt, MAX_SYSTEM_PROMPT_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.description"), &p.description, MAX_DESCRIPTION_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.structured_prompt"), &p.structured_prompt, MAX_STRUCTURED_PROMPT_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.icon"), &p.icon, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.color"), &p.color, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.notification_channels"), &p.notification_channels, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.model_profile"), &p.model_profile, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.design_context"), &p.design_context, MAX_DESIGN_CONTEXT_LEN)?;

        // Sub-entity array caps
        validation::require_max_count(&format!("{prefix}.triggers"), &p.triggers, MAX_TRIGGERS_PER_PERSONA)?;
        validation::require_max_count(&format!("{prefix}.subscriptions"), &p.subscriptions, MAX_SUBSCRIPTIONS_PER_PERSONA)?;
        validation::require_max_count(&format!("{prefix}.memories"), &p.memories, MAX_MEMORIES_PER_PERSONA)?;
        validation::require_max_count(&format!("{prefix}.test_suites"), &p.test_suites, MAX_TEST_SUITES_PER_PERSONA)?;

        // Validate triggers
        for (j, t) in p.triggers.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.trigger[{j}].trigger_type"), &t.trigger_type)?;
            validation::require_max_len(&format!("{prefix}.trigger[{j}].trigger_type"), &t.trigger_type, MAX_SHORT_FIELD_LEN)?;
            validation::require_optional_max_len(&format!("{prefix}.trigger[{j}].config"), &t.config, MAX_CONFIG_LEN)?;
            validation::require_optional_max_len(&format!("{prefix}.trigger[{j}].use_case_id"), &t.use_case_id, MAX_SHORT_FIELD_LEN)?;
        }

        // Validate subscriptions
        for (j, s) in p.subscriptions.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.subscription[{j}].event_type"), &s.event_type)?;
            validation::require_max_len(&format!("{prefix}.subscription[{j}].event_type"), &s.event_type, MAX_SHORT_FIELD_LEN)?;
            validation::require_optional_max_len(&format!("{prefix}.subscription[{j}].source_filter"), &s.source_filter, MAX_SHORT_FIELD_LEN)?;
            validation::require_optional_max_len(&format!("{prefix}.subscription[{j}].use_case_id"), &s.use_case_id, MAX_SHORT_FIELD_LEN)?;
        }

        // Validate memories
        for (j, m) in p.memories.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.memory[{j}].title"), &m.title)?;
            validation::require_max_len(&format!("{prefix}.memory[{j}].title"), &m.title, MAX_NAME_LEN)?;
            validation::require_max_len(&format!("{prefix}.memory[{j}].content"), &m.content, MAX_MEMORY_CONTENT_LEN)?;
            validation::require_max_len(&format!("{prefix}.memory[{j}].category"), &m.category, MAX_SHORT_FIELD_LEN)?;
            validation::require_optional_max_len(&format!("{prefix}.memory[{j}].tags"), &m.tags, MAX_SHORT_FIELD_LEN)?;
        }

        // Validate test suites
        for (j, s) in p.test_suites.iter().enumerate() {
            validation::require_non_empty(&format!("{prefix}.test_suite[{j}].name"), &s.name)?;
            validation::require_max_len(&format!("{prefix}.test_suite[{j}].name"), &s.name, MAX_NAME_LEN)?;
            validation::require_optional_max_len(&format!("{prefix}.test_suite[{j}].description"), &s.description, MAX_DESCRIPTION_LEN)?;
            validation::require_max_len(&format!("{prefix}.test_suite[{j}].scenarios"), &s.scenarios, MAX_SCENARIOS_LEN)?;
        }
    }

    // Validate teams
    for (i, t) in bundle.teams.iter().enumerate() {
        let prefix = format!("team[{i}]");

        validation::require_non_empty(&format!("{prefix}.name"), &t.name)?;
        validation::require_max_len(&format!("{prefix}.name"), &t.name, MAX_NAME_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.description"), &t.description, MAX_DESCRIPTION_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.canvas_data"), &t.canvas_data, MAX_CANVAS_DATA_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.team_config"), &t.team_config, MAX_CONFIG_LEN)?;
        validation::require_optional_max_len(&format!("{prefix}.icon"), &t.icon, MAX_SHORT_FIELD_LEN)?;

        validation::require_max_count(&format!("{prefix}.members"), &t.members, MAX_TEAM_MEMBERS)?;
        validation::require_max_count(&format!("{prefix}.connections"), &t.connections, MAX_TEAM_CONNECTIONS)?;

        for (j, m) in t.members.iter().enumerate() {
            validation::require_optional_max_len(&format!("{prefix}.member[{j}].role"), &m.role, MAX_SHORT_FIELD_LEN)?;
            validation::require_optional_max_len(&format!("{prefix}.member[{j}].config"), &m.config, MAX_CONFIG_LEN)?;
        }

        for (j, c) in t.connections.iter().enumerate() {
            validation::require_optional_max_len(&format!("{prefix}.connection[{j}].connection_type"), &c.connection_type, MAX_SHORT_FIELD_LEN)?;
            validation::require_optional_max_len(&format!("{prefix}.connection[{j}].condition"), &c.condition, MAX_CONFIG_LEN)?;
            validation::require_optional_max_len(&format!("{prefix}.connection[{j}].label"), &c.label, MAX_NAME_LEN)?;
        }
    }

    Ok(())
}

fn import_bundle(
    pool: &DbPool,
    bundle: &PortabilityBundle,
) -> Result<PortabilityImportResult, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    let mut result = PortabilityImportResult {
        personas_created: 0,
        teams_created: 0,
        tools_created: 0,
        groups_created: 0,
        connectors_created: 0,
        warnings: Vec::new(),
        id_mapping: std::collections::HashMap::new(),
    };

    let now = chrono::Utc::now().to_rfc3339();

    // Phase 1: Import groups (map old IDs to new IDs)
    for g in &bundle.groups {
        let id = uuid::Uuid::new_v4().to_string();
        let name = format!("{} (imported)", g.name);
        let color = g.color.as_deref().unwrap_or("#6B7280");
        match tx.execute(
            "INSERT INTO persona_groups (id, name, color, sort_order, collapsed, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?6)",
            rusqlite::params![id, name, color, g.sort_order, g.description, now],
        ) {
            Ok(_) => {
                result.id_mapping.insert(g.id.clone(), id);
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
            // Builtin tools already exist -- try to find matching by name
            let found = tx
                .query_row(
                    "SELECT id FROM persona_tool_definitions WHERE name = ?1 LIMIT 1",
                    rusqlite::params![t.name],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            if let Some(existing_id) = found {
                result.id_mapping.insert(t.id.clone(), existing_id);
                continue;
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let is_builtin_i = if t.is_builtin { 1i32 } else { 0i32 };
        match tx.execute(
            "INSERT INTO persona_tool_definitions
             (id, name, category, description, script_path,
              input_schema, output_schema, requires_credential_type,
              implementation_guide, is_builtin, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            rusqlite::params![
                id,
                t.name,
                t.category,
                t.description,
                "",
                t.input_schema,
                Option::<String>::None,
                t.requires_credential_type,
                t.implementation_guide,
                is_builtin_i,
                now,
            ],
        ) {
            Ok(_) => {
                result.id_mapping.insert(t.id.clone(), id);
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
        let exists = tx
            .query_row(
                "SELECT COUNT(*) FROM connector_definitions WHERE name = ?1",
                rusqlite::params![c.name],
                |row| row.get::<_, i32>(0),
            )
            .unwrap_or(0)
            > 0;
        if exists {
            continue;
        }

        let id = uuid::Uuid::new_v4().to_string();
        match tx.execute(
            "INSERT INTO connector_definitions
             (id, name, label, icon_url, color, category, fields,
              healthcheck_config, services, events, metadata, is_builtin,
              created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,?12,?12)",
            rusqlite::params![
                id,
                c.name,
                c.label,
                Option::<String>::None,
                "#6B7280",
                c.category,
                c.fields,
                Option::<String>::None,
                c.services,
                "[]",
                Option::<String>::None,
                now,
            ],
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

        let new_id = uuid::Uuid::new_v4().to_string();
        let persona_name = format!("{} (imported)", p.name);
        let enabled_i = 0i32; // imported personas start disabled
        let max_concurrent = p.max_concurrent;
        let timeout_ms = p.timeout_ms;

        // Encrypt notification channel secrets before storing
        let encrypted_channels = match &p.notification_channels {
            Some(json) if !json.trim().is_empty() => {
                match persona_repo::encrypt_notification_channels(json) {
                    Ok(enc) => Some(enc),
                    Err(_) => p.notification_channels.clone(), // fallback to original on error
                }
            }
            other => other.clone(),
        };

        match tx.execute(
            "INSERT INTO personas
             (id, project_id, name, description, system_prompt, structured_prompt,
              icon, color, enabled, sensitive, max_concurrent, timeout_ms,
              model_profile, max_budget_usd, max_turns, design_context, group_id,
              notification_channels, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
            rusqlite::params![
                new_id,
                "default",
                persona_name,
                p.description,
                p.system_prompt,
                p.structured_prompt,
                p.icon,
                p.color,
                enabled_i,
                max_concurrent,
                timeout_ms,
                p.model_profile,
                p.max_budget_usd,
                p.max_turns,
                p.design_context,
                mapped_group_id,
                encrypted_channels,
                now,
            ],
        ) {
            Ok(_) => {
                result.id_mapping.insert(p.id.clone(), new_id.clone());
                result.personas_created += 1;

                // Sub-entities: triggers
                for t in &p.triggers {
                    let tid = uuid::Uuid::new_v4().to_string();
                    let enabled_i = if t.enabled { 1i32 } else { 0i32 };
                    if let Err(e) = tx.execute(
                        "INSERT INTO persona_triggers
                         (id, persona_id, trigger_type, config, enabled, use_case_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                        rusqlite::params![tid, new_id, t.trigger_type, t.config, enabled_i, t.use_case_id, now],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' trigger ({}): {}",
                            p.name, t.trigger_type, e
                        ));
                    }
                }

                // Sub-entities: subscriptions
                for s in &p.subscriptions {
                    let sid = uuid::Uuid::new_v4().to_string();
                    let enabled_i = if s.enabled { 1i32 } else { 0i32 };
                    if let Err(e) = tx.execute(
                        "INSERT OR IGNORE INTO persona_event_subscriptions
                         (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                        rusqlite::params![sid, new_id, s.event_type, s.source_filter, enabled_i, s.use_case_id, now],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' subscription ({}): {}",
                            p.name, s.event_type, e
                        ));
                    }
                }

                // Sub-entities: memories
                for m in &p.memories {
                    let mid = uuid::Uuid::new_v4().to_string();
                    let category = m.category.as_str();
                    let importance = m.importance;
                    if let Err(e) = tx.execute(
                        "INSERT INTO persona_memories
                         (id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                        rusqlite::params![mid, new_id, m.title, m.content, category, Option::<String>::None, importance, m.tags, now],
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
                        let aid = uuid::Uuid::new_v4().to_string();
                        if let Err(e) = tx.execute(
                            "INSERT INTO persona_tools (id, persona_id, tool_id, tool_config, created_at)
                             VALUES (?1, ?2, ?3, ?4, ?5)",
                            rusqlite::params![aid, new_id, new_tool_id, Option::<String>::None, now],
                        ) {
                            result.warnings.push(format!(
                                "Persona '{}' tool assignment: {}",
                                p.name, e
                            ));
                        }
                    }
                }

                // Sub-entities: test suites
                for s in &p.test_suites {
                    let sid = uuid::Uuid::new_v4().to_string();
                    if let Err(e) = tx.execute(
                        "INSERT INTO test_suites (id, persona_id, name, description, scenarios, scenario_count, source_run_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                        rusqlite::params![sid, new_id, s.name, s.description, s.scenarios, s.scenario_count, Option::<String>::None, now],
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
        let new_team_id = uuid::Uuid::new_v4().to_string();
        let team_name = format!("{} (imported)", t.name);
        let enabled_i = 0i32; // imported teams start disabled

        match tx.execute(
            "INSERT INTO persona_teams
             (id, project_id, parent_team_id, name, description, canvas_data, team_config, icon, color, enabled, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            rusqlite::params![
                new_team_id,
                Option::<String>::None,
                Option::<String>::None,
                team_name,
                t.description,
                t.canvas_data,
                t.team_config,
                t.icon,
                "#6B7280",
                enabled_i,
                now,
            ],
        ) {
            Ok(_) => {
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

                    let mid = uuid::Uuid::new_v4().to_string();
                    let role = m.role.as_deref().unwrap_or("worker");
                    let px = m.position_x.unwrap_or(0.0);
                    let py = m.position_y.unwrap_or(0.0);

                    match tx.execute(
                        "INSERT INTO persona_team_members (id, team_id, persona_id, role, position_x, position_y, config, created_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![mid, new_team_id, new_persona_id, role, px, py, m.config, now],
                    ) {
                        Ok(_) => {
                            member_id_map
                                .insert(m.persona_id.clone(), mid);
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

                    let cid = uuid::Uuid::new_v4().to_string();
                    let conn_type = c.connection_type.as_deref().unwrap_or("sequential");

                    if let Err(e) = tx.execute(
                        "INSERT INTO persona_team_connections
                         (id, team_id, source_member_id, target_member_id, connection_type, condition, label, created_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![cid, new_team_id, source_id, target_id, conn_type, c.condition, c.label, now],
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

    // Commit the transaction -- all entities are persisted atomically.
    // If anything above returned a hard error (not a warning), we would
    // have already returned Err and the transaction would roll back on drop.
    tx.commit().map_err(AppError::Database)?;

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
    v.get("steps").is_some_and(|s| s.is_array())
        && v.get("title").is_some()
}

fn is_make_workflow(v: &serde_json::Value) -> bool {
    // Make/Integromat exports have "modules" array
    v.get("modules").is_some_and(|s| s.is_array())
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

// ============================================================================
// Encrypted credential export / import
// ============================================================================

const PBKDF2_ITERATIONS: u32 = 600_000;
const CREDENTIAL_EXPORT_FORMAT: &str = "personas_credentials_v1";

#[derive(Debug, Serialize, Deserialize)]
struct CredentialExportBundle {
    format_version: u32,
    exported_at: String,
    credentials: Vec<CredentialExportEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CredentialExportEntry {
    name: String,
    service_type: String,
    metadata: Option<String>,
    fields: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CredentialExportEnvelope {
    format: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CredentialImportResult {
    pub created: u32,
    pub skipped: u32,
    pub replaced: u32,
    pub warnings: Vec<String>,
    /// Non-empty when conflicts detected — frontend should show resolution UI
    pub conflicts: Vec<CredentialConflict>,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export)]
pub struct CredentialConflict {
    pub name: String,
    pub service_type: String,
    pub existing_id: String,
}

/// Derive a 32-byte key from a passphrase using PBKDF2-HMAC-SHA256.
fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

/// Export all credential secrets to a password-protected encrypted file.
#[tauri::command]
pub async fn export_credentials(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: String,
) -> Result<bool, AppError> {
    require_privileged(&state, "export_credentials").await?;

    if passphrase.len() < 8 {
        return Err(AppError::Validation(
            "Passphrase must be at least 8 characters".into(),
        ));
    }

    let pool = &state.db;
    let all_creds = cred_repo::get_all(pool)?;

    let mut entries = Vec::with_capacity(all_creds.len());
    for cred in &all_creds {
        let fields = cred_repo::get_decrypted_fields(pool, cred)
            .unwrap_or_default();
        let _ = audit_log::log_decrypt(pool, &cred.id, &cred.name, "data_portability:export", None, None);
        entries.push(CredentialExportEntry {
            name: cred.name.clone(),
            service_type: cred.service_type.clone(),
            metadata: cred.metadata.clone(),
            fields,
        });
    }

    let bundle = CredentialExportBundle {
        format_version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        credentials: entries,
    };

    let plaintext = serde_json::to_vec(&bundle)
        .map_err(|e| AppError::Internal(format!("Serialization failed: {e}")))?;

    // Generate random salt and nonce
    use aes_gcm::aead::rand_core::RngCore;
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(&passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| AppError::Internal(format!("Encryption failed: {e}")))?;

    let envelope = CredentialExportEnvelope {
        format: CREDENTIAL_EXPORT_FORMAT.into(),
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    };

    let envelope_json = serde_json::to_string_pretty(&envelope)
        .map_err(|e| AppError::Internal(format!("Envelope serialization failed: {e}")))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let file_name = format!("personas_credentials_{}.cred.enc", timestamp);
    let app_clone = app.clone();

    let save_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("Encrypted Credentials", &["enc"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    if let Some(file_path) = save_path {
        let path = file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;
        tokio::fs::write(&path, envelope_json)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;
        return Ok(true);
    }

    Ok(false)
}

/// Import credentials from a password-protected encrypted file.
#[tauri::command]
pub async fn import_credentials(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    passphrase: String,
    resolutions_json: Option<String>,
) -> Result<Option<CredentialImportResult>, AppError> {
    require_privileged(&state, "import_credentials").await?;

    let app_clone = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .add_filter("Encrypted Credentials", &["enc"])
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

    let envelope: CredentialExportEnvelope = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Invalid credential export file: {e}")))?;

    if envelope.format != CREDENTIAL_EXPORT_FORMAT {
        return Err(AppError::Validation(format!(
            "Unsupported format: {} (expected {})",
            envelope.format, CREDENTIAL_EXPORT_FORMAT
        )));
    }

    let salt = B64
        .decode(&envelope.salt)
        .map_err(|e| AppError::Validation(format!("Invalid salt: {e}")))?;
    let nonce_bytes = B64
        .decode(&envelope.nonce)
        .map_err(|e| AppError::Validation(format!("Invalid nonce: {e}")))?;
    let ciphertext = B64
        .decode(&envelope.ciphertext)
        .map_err(|e| AppError::Validation(format!("Invalid ciphertext: {e}")))?;

    let key = derive_key(&passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| {
            AppError::Validation("Decryption failed -- wrong passphrase or corrupted file".into())
        })?;

    let bundle: CredentialExportBundle = serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Validation(format!("Invalid inner data: {e}")))?;

    let pool = &state.db;

    // Parse resolutions from frontend (second pass after conflict detection)
    let resolutions: std::collections::HashMap<String, String> = resolutions_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let has_resolutions = !resolutions.is_empty();

    // Load existing credentials for conflict detection
    let existing = cred_repo::get_all(pool).unwrap_or_default();
    let existing_names: std::collections::HashMap<String, String> = existing
        .iter()
        .map(|c| (c.name.to_lowercase(), c.id.clone()))
        .collect();

    let mut result = CredentialImportResult {
        created: 0,
        skipped: 0,
        replaced: 0,
        warnings: Vec::new(),
        conflicts: Vec::new(),
    };

    // First pass: if conflicts exist and no resolutions provided, return conflicts for UI
    if !has_resolutions {
        for entry in &bundle.credentials {
            let conflict_key = entry.name.to_lowercase();
            if existing_names.contains_key(&conflict_key) {
                result.conflicts.push(CredentialConflict {
                    name: entry.name.clone(),
                    service_type: entry.service_type.clone(),
                    existing_id: existing_names.get(&conflict_key).cloned().unwrap_or_default(),
                });
            }
        }
        if !result.conflicts.is_empty() {
            return Ok(Some(result));
        }
    }

    // Wrap the entire import in a single transaction so that a failed create
    // after a delete does not permanently lose the original credential.
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    // Non-sensitive field keys (mirrored from cred_repo::create_with_fields)
    const NON_SENSITIVE_KEYS: &[&str] = &[
        "base_url", "url", "host", "hostname", "server",
        "port", "database", "project", "organization", "org",
        "workspace", "team", "region", "scope", "scopes",
        "oauth_client_mode", "token_type",
    ];

    for entry in &bundle.credentials {
        let conflict_key = entry.name.to_lowercase();

        // Determine action based on resolution
        let resolution = resolutions.get(&entry.name);
        match resolution.map(|s| s.as_str()) {
            Some("skip") => {
                result.skipped += 1;
                continue;
            }
            Some("replace") => {
                // Delete existing credential and dependents within the transaction
                if let Some(existing_id) = existing_names.get(&conflict_key) {
                    tx.execute("DELETE FROM credential_fields WHERE credential_id = ?1", rusqlite::params![existing_id])?;
                    tx.execute("DELETE FROM credential_rotation_history WHERE credential_id = ?1", rusqlite::params![existing_id])?;
                    tx.execute("DELETE FROM credential_rotation_policies WHERE credential_id = ?1", rusqlite::params![existing_id])?;
                    tx.execute("DELETE FROM credential_events WHERE credential_id = ?1", rusqlite::params![existing_id])?;
                    tx.execute("DELETE FROM persona_credentials WHERE id = ?1", rusqlite::params![existing_id])?;
                }
                result.replaced += 1;
            }
            Some("keep_both") => {
                // Import with "(imported)" suffix — fall through to create with modified name
            }
            _ => {
                // No conflict or no resolution needed — use original name
            }
        }

        let final_name = if resolution == Some(&"keep_both".to_string()) {
            format!("{} (imported)", entry.name)
        } else {
            entry.name.clone()
        };

        let cred_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Insert credential row within the transaction
        match tx.execute(
            "INSERT INTO persona_credentials
             (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            rusqlite::params![
                cred_id,
                final_name,
                entry.service_type,
                "",
                "",
                entry.metadata,
                now,
            ],
        ) {
            Ok(_) => {}
            Err(e) => {
                // Roll back the entire transaction on failure
                return Err(AppError::Internal(format!(
                    "Credential '{}': insert failed: {}",
                    entry.name, e
                )));
            }
        }

        // Insert encrypted fields within the same transaction
        for (key, value) in &entry.fields {
            let is_sensitive = !NON_SENSITIVE_KEYS.contains(&key.to_lowercase().as_str());
            let (enc_val, field_iv) = crypto::encrypt_field(value, is_sensitive)
                .map_err(|e| AppError::Internal(format!("Field encryption failed: {}", e)))?;

            let field_type = classify_credential_field_type(key);
            let field_id = uuid::Uuid::new_v4().to_string();

            tx.execute(
                "INSERT INTO credential_fields
                 (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                rusqlite::params![
                    field_id,
                    cred_id,
                    key,
                    enc_val,
                    field_iv,
                    field_type,
                    is_sensitive as i32,
                    now,
                ],
            )?;
        }

        result.created += 1;
    }

    tx.commit().map_err(AppError::Database)?;
    Ok(Some(result))
}

/// Classify a credential field key into a type category.
/// Mirrors the private `classify_field_type` in cred_repo.
fn classify_credential_field_type(key: &str) -> &'static str {
    let lower = key.to_lowercase();
    if lower.contains("url") || lower.contains("endpoint") || lower == "host" || lower == "server" {
        "url"
    } else if lower.contains("token") || lower.contains("key") || lower.contains("secret") || lower.contains("password") {
        "secret"
    } else if lower == "port" {
        "number"
    } else if lower.contains("email") || lower.contains("username") || lower.contains("user") {
        "identity"
    } else {
        "text"
    }
}
