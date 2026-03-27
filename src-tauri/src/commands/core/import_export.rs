use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::{memories as memory_repo, personas as persona_repo};
use crate::db::repos::resources::triggers as trigger_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::validation;
use crate::AppState;

use super::export_types::{
    MemoryExport, SubscriptionExport, TriggerExport,
    MAX_CONFIG_LEN, MAX_DESCRIPTION_LEN, MAX_DESIGN_CONTEXT_LEN, MAX_MEMORIES,
    MAX_MEMORY_CONTENT_LEN, MAX_NAME_LEN, MAX_SHORT_FIELD_LEN, MAX_STRUCTURED_PROMPT_LEN,
    MAX_SUBSCRIPTIONS, MAX_SYSTEM_PROMPT_LEN, MAX_TRIGGERS,
};

/// Maximum import file size (5 MB).
const MAX_IMPORT_FILE_BYTES: u64 = 5 * 1024 * 1024;

// ============================================================================
// Export-only data structs (no system-generated fields like id/created_at)
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
struct PersonaExportData {
    name: String,
    description: Option<String>,
    system_prompt: String,
    structured_prompt: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    max_concurrent: i32,
    timeout_ms: i32,
    notification_channels: Option<String>,
    model_profile: Option<String>,
    max_budget_usd: Option<f64>,
    max_turns: Option<i32>,
    design_context: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersonaExportBundle {
    version: u32,
    exported_at: String,
    persona: PersonaExportData,
    triggers: Vec<TriggerExport>,
    subscriptions: Vec<SubscriptionExport>,
    memories: Vec<MemoryExport>,
}

/// Result of a persona import, including the new persona ID and any warnings
/// from sub-entity creation failures (triggers, subscriptions, memories).
#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub persona_id: String,
    pub warnings: Vec<String>,
}

// ============================================================================
// Commands
// ============================================================================

#[tauri::command]
pub async fn export_persona(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    persona_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let pool = &state.db;

    // Gather data
    let persona = persona_repo::get_by_id(pool, &persona_id)?;
    let triggers = trigger_repo::get_by_persona_id(pool, &persona_id)?;
    let subscriptions = event_repo::get_subscriptions_by_persona(pool, &persona_id)?;
    let memories = memory_repo::get_all(pool, Some(&persona_id), None, None, None, None, None, None)?;

    let bundle = PersonaExportBundle {
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        persona: PersonaExportData {
            name: persona.name.clone(),
            description: persona.description,
            system_prompt: persona.system_prompt,
            structured_prompt: persona.structured_prompt,
            icon: persona.icon,
            color: persona.color,
            max_concurrent: persona.max_concurrent,
            timeout_ms: persona.timeout_ms,
            notification_channels: persona.notification_channels,
            model_profile: persona.model_profile,
            max_budget_usd: persona.max_budget_usd,
            max_turns: persona.max_turns,
            design_context: persona.design_context,
        },
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
    };

    let json = serde_json::to_string_pretty(&bundle)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let file_name = format!("{}.persona.json", persona.name.replace(' ', "_"));
    let app_clone = app.clone();
    let save_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("Persona Bundle", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    if let Some(file_path) = save_path {
        let path = file_path
            .into_path()
            .map_err(|e| AppError::Internal(format!("Invalid file path: {e}")))?;
        tokio::fs::write(&path, json)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;
        return Ok(true);
    }

    Ok(false)
}

#[tauri::command]
pub async fn import_persona(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<Option<ImportResult>, AppError> {
    require_auth_sync(&state)?;
    let app_clone = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .add_filter("Persona Bundle", &["json"])
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

    // Check file size before reading to prevent memory exhaustion
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file metadata: {e}")))?;
    if metadata.len() > MAX_IMPORT_FILE_BYTES {
        return Err(AppError::Validation(format!(
            "Import file too large ({:.1} MB). Maximum is {} MB.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_IMPORT_FILE_BYTES / (1024 * 1024)
        )));
    }

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?;

    let bundle: PersonaExportBundle = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Invalid persona file: {e}")))?;

    if bundle.version != 1 {
        return Err(AppError::Validation(format!(
            "Unsupported bundle version: {}",
            bundle.version
        )));
    }

    // Validate array sizes
    validation::require_max_count("triggers", &bundle.triggers, MAX_TRIGGERS)?;
    validation::require_max_count("subscriptions", &bundle.subscriptions, MAX_SUBSCRIPTIONS)?;
    validation::require_max_count("memories", &bundle.memories, MAX_MEMORIES)?;

    // Validate persona fields
    let p = &bundle.persona;
    validation::require_non_empty("persona name", &p.name)?;
    validation::require_max_len("persona name", &p.name, MAX_NAME_LEN)?;
    validation::require_max_len("system_prompt", &p.system_prompt, MAX_SYSTEM_PROMPT_LEN)?;
    validation::require_optional_max_len("description", &p.description, MAX_DESCRIPTION_LEN)?;
    validation::require_optional_max_len("structured_prompt", &p.structured_prompt, MAX_STRUCTURED_PROMPT_LEN)?;
    validation::require_optional_max_len("icon", &p.icon, MAX_SHORT_FIELD_LEN)?;
    validation::require_optional_max_len("color", &p.color, MAX_SHORT_FIELD_LEN)?;
    validation::require_optional_max_len("notification_channels", &p.notification_channels, MAX_SHORT_FIELD_LEN)?;
    validation::require_optional_max_len("model_profile", &p.model_profile, MAX_SHORT_FIELD_LEN)?;
    validation::require_optional_max_len("design_context", &p.design_context, MAX_DESIGN_CONTEXT_LEN)?;

    // Validate trigger fields
    for (i, t) in bundle.triggers.iter().enumerate() {
        validation::require_non_empty(&format!("trigger[{i}].trigger_type"), &t.trigger_type)?;
        validation::require_max_len(&format!("trigger[{i}].trigger_type"), &t.trigger_type, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("trigger[{i}].config"), &t.config, MAX_CONFIG_LEN)?;
        validation::require_optional_max_len(&format!("trigger[{i}].use_case_id"), &t.use_case_id, MAX_SHORT_FIELD_LEN)?;
    }

    // Validate subscription fields
    for (i, s) in bundle.subscriptions.iter().enumerate() {
        validation::require_non_empty(&format!("subscription[{i}].event_type"), &s.event_type)?;
        validation::require_max_len(&format!("subscription[{i}].event_type"), &s.event_type, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("subscription[{i}].source_filter"), &s.source_filter, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("subscription[{i}].use_case_id"), &s.use_case_id, MAX_SHORT_FIELD_LEN)?;
    }

    // Validate memory fields
    for (i, m) in bundle.memories.iter().enumerate() {
        validation::require_non_empty(&format!("memory[{i}].title"), &m.title)?;
        validation::require_max_len(&format!("memory[{i}].title"), &m.title, MAX_NAME_LEN)?;
        validation::require_max_len(&format!("memory[{i}].content"), &m.content, MAX_MEMORY_CONTENT_LEN)?;
        validation::require_max_len(&format!("memory[{i}].category"), &m.category, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("memory[{i}].tags"), &m.tags, MAX_SHORT_FIELD_LEN)?;
    }

    let pool = &state.db;

    // Create the persona (disabled by default, with "(imported)" suffix)
    let new_persona = persona_repo::create(
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
            group_id: None,
            notification_channels: p.notification_channels.clone(),
        },
    )?;
    let new_id = new_persona.id.clone();
    let mut warnings: Vec<String> = Vec::new();

    // Re-create triggers
    for (i, t) in bundle.triggers.iter().enumerate() {
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
            warnings.push(format!("Trigger {} ({}): {}", i + 1, t.trigger_type, e));
        }
    }

    // Re-create subscriptions
    for (i, s) in bundle.subscriptions.iter().enumerate() {
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
            warnings.push(format!("Subscription {} ({}): {}", i + 1, s.event_type, e));
        }
    }

    // Re-create memories
    for (i, m) in bundle.memories.iter().enumerate() {
        if let Err(e) = memory_repo::create(
            pool,
            crate::db::models::CreatePersonaMemoryInput {
                persona_id: new_id.clone(),
                title: m.title.clone(),
                content: m.content.clone(),
                category: Some(crate::db::models::normalize_category(&m.category).to_string()),
                source_execution_id: None,
                importance: Some(m.importance),
                tags: m.tags.clone(),
            },
        ) {
            warnings.push(format!("Memory {} ({}): {}", i + 1, m.title, e));
        }
    }

    Ok(Some(ImportResult {
        persona_id: new_id,
        warnings,
    }))
}
