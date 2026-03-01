use crate::engine::platform_rules;
use crate::db::models::PlatformDefinition;
use crate::error::AppError;
use serde::Serialize;

/// Lightweight summary returned by list command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformDefinitionSummary {
    pub id: String,
    pub label: String,
    pub format: String,
    pub is_builtin: bool,
    pub node_type_count: usize,
    pub credential_rule_count: usize,
}

/// List all available platform definitions (built-in only for now).
#[tauri::command]
pub fn list_platform_definitions() -> Result<Vec<PlatformDefinitionSummary>, AppError> {
    let defs = platform_rules::builtin_definitions();
    Ok(defs
        .iter()
        .map(|d| PlatformDefinitionSummary {
            id: d.id.clone(),
            label: d.label.clone(),
            format: d.format.clone(),
            is_builtin: d.is_builtin,
            node_type_count: d.node_type_map.len(),
            credential_rule_count: d.credential_consolidation.len(),
        })
        .collect())
}

/// Get a full platform definition by ID.
#[tauri::command]
pub fn get_platform_definition(id: String) -> Result<PlatformDefinition, AppError> {
    platform_rules::get_builtin(&id)
        .ok_or_else(|| AppError::NotFound(format!("Platform definition '{id}'")))
}
