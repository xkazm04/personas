use std::sync::Arc;
use tauri::State;

use crate::db::models::{AutomationRun, CreateAutomationInput, PersonaAutomation, UpdateAutomationInput};
use crate::db::repos::resources::automations as repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

use crate::commands::core::personas::BlastRadiusItem;

/// Generate a sample payload from a schema definition string.
///
/// The schema is expected to be a JSON object where values are type descriptors
/// (e.g. `{"file_url": "string", "count": "number"}`). This function produces a
/// valid sample payload with realistic placeholder values instead of sending the
/// raw type descriptors to external webhooks.
fn generate_sample_payload(schema_json: &str) -> String {
    let parsed: Result<serde_json::Value, _> = serde_json::from_str(schema_json);
    match parsed {
        Ok(serde_json::Value::Object(map)) => {
            let mut sample = serde_json::Map::new();
            for (key, type_val) in &map {
                let sample_value = match type_val {
                    serde_json::Value::String(t) => match t.to_lowercase().as_str() {
                        "string" | "text" => serde_json::Value::String(format!("sample_{key}")),
                        "number" | "float" | "double" => serde_json::json!(0),
                        "integer" | "int" => serde_json::json!(0),
                        "boolean" | "bool" => serde_json::Value::Bool(true),
                        "array" | "list" => serde_json::json!([]),
                        "object" | "map" => serde_json::json!({}),
                        "url" | "uri" => serde_json::Value::String("https://example.com".into()),
                        "email" => serde_json::Value::String("test@example.com".into()),
                        "date" => serde_json::Value::String("2026-01-01".into()),
                        "datetime" | "timestamp" => {
                            serde_json::Value::String("2026-01-01T00:00:00Z".into())
                        }
                        _ => serde_json::Value::String(format!("sample_{key}")),
                    },
                    // If the value is already a concrete value (not a type descriptor),
                    // keep it as-is — the user may have provided literal defaults.
                    other => other.clone(),
                };
                sample.insert(key.clone(), sample_value);
            }
            serde_json::to_string(&serde_json::Value::Object(sample))
                .unwrap_or_else(|_| r#"{"test": true}"#.to_string())
        }
        // If schema is not a JSON object (e.g. array schema or unparseable),
        // fall back to a safe test payload.
        _ => r#"{"test": true}"#.to_string(),
    }
}

#[tauri::command]
pub fn list_automations(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<PersonaAutomation>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn get_automation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaAutomation, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_automation(
    state: State<'_, Arc<AppState>>,
    input: CreateAutomationInput,
) -> Result<PersonaAutomation, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_automation(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateAutomationInput,
) -> Result<PersonaAutomation, AppError> {
    require_auth_sync(&state)?;
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn automation_blast_radius(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<BlastRadiusItem>, AppError> {
    require_auth_sync(&state)?;
    let items = repo::blast_radius(&state.db, &id)?;
    Ok(items
        .into_iter()
        .map(|(category, description)| BlastRadiusItem { category, description })
        .collect())
}

#[tauri::command]
pub fn delete_automation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub async fn trigger_automation(
    state: State<'_, Arc<AppState>>,
    id: String,
    input_data: Option<String>,
    execution_id: Option<String>,
) -> Result<AutomationRun, AppError> {
    require_auth(&state).await?;
    let automation = repo::get_by_id(&state.db, &id)?;

    if !automation.deployment_status.is_runnable() {
        return Err(AppError::Validation(format!(
            "Automation '{}' is not active (status: {})",
            automation.name, automation.deployment_status
        )));
    }

    crate::engine::automation_runner::invoke_automation(
        &state.db,
        &automation,
        input_data.as_deref(),
        execution_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn test_automation_webhook(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<AutomationRun, AppError> {
    require_auth(&state).await?;
    let automation = repo::get_by_id(&state.db, &id)?;

    // Generate a realistic sample payload from the schema definition
    // instead of sending raw type descriptors to external webhooks.
    let sample_input = match &automation.input_schema {
        Some(schema) => generate_sample_payload(schema),
        None => r#"{"test": true}"#.to_string(),
    };

    crate::engine::automation_runner::invoke_automation(
        &state.db,
        &automation,
        Some(&sample_input),
        None,
    )
    .await
}

#[tauri::command]
pub fn get_automation_runs(
    state: State<'_, Arc<AppState>>,
    automation_id: String,
    limit: Option<i64>,
) -> Result<Vec<AutomationRun>, AppError> {
    require_auth_sync(&state)?;
    repo::get_runs_by_automation(&state.db, &automation_id, limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_sample_from_string_types() {
        let schema = r#"{"file_url": "string", "count": "number", "active": "boolean"}"#;
        let payload: serde_json::Value = serde_json::from_str(&generate_sample_payload(schema)).unwrap();
        assert!(payload["file_url"].is_string());
        assert_eq!(payload["file_url"], "sample_file_url");
        assert!(payload["count"].is_number());
        assert!(payload["active"].is_boolean());
    }

    #[test]
    fn generates_sample_from_special_types() {
        let schema = r#"{"endpoint": "url", "contact": "email", "created": "datetime"}"#;
        let payload: serde_json::Value = serde_json::from_str(&generate_sample_payload(schema)).unwrap();
        assert_eq!(payload["endpoint"], "https://example.com");
        assert_eq!(payload["contact"], "test@example.com");
        assert_eq!(payload["created"], "2026-01-01T00:00:00Z");
    }

    #[test]
    fn preserves_concrete_values() {
        let schema = r#"{"name": "string", "limit": 42, "tags": ["a", "b"]}"#;
        let payload: serde_json::Value = serde_json::from_str(&generate_sample_payload(schema)).unwrap();
        assert_eq!(payload["name"], "sample_name");
        assert_eq!(payload["limit"], 42);
        assert_eq!(payload["tags"], serde_json::json!(["a", "b"]));
    }

    #[test]
    fn falls_back_on_invalid_schema() {
        assert_eq!(generate_sample_payload("not json"), r#"{"test": true}"#);
        assert_eq!(generate_sample_payload("[]"), r#"{"test": true}"#);
        assert_eq!(generate_sample_payload("null"), r#"{"test": true}"#);
    }

    #[test]
    fn handles_empty_object_schema() {
        let payload: serde_json::Value = serde_json::from_str(&generate_sample_payload("{}")).unwrap();
        assert_eq!(payload, serde_json::json!({}));
    }
}
