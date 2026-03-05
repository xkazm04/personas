use std::sync::Arc;
use tauri::State;

use crate::engine::platforms::n8n::{self, N8nActivateResult, N8nWorkflow};
use crate::error::AppError;
use crate::AppState;

/// List all workflows from an n8n instance using a stored credential.
#[tauri::command]
pub async fn n8n_list_workflows(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<N8nWorkflow>, AppError> {
    let client = n8n::build_client_from_credential(&state.db, &credential_id)?;
    client.list_workflows().await
}

/// Activate a workflow on an n8n instance.
#[tauri::command]
pub async fn n8n_activate_workflow(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    workflow_id: String,
) -> Result<N8nActivateResult, AppError> {
    let client = n8n::build_client_from_credential(&state.db, &credential_id)?;
    client.activate_workflow(&workflow_id).await
}

/// Deactivate a workflow on an n8n instance.
#[tauri::command]
pub async fn n8n_deactivate_workflow(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    workflow_id: String,
) -> Result<N8nActivateResult, AppError> {
    let client = n8n::build_client_from_credential(&state.db, &credential_id)?;
    client.deactivate_workflow(&workflow_id).await
}

/// Create a new workflow on an n8n instance.
#[tauri::command]
pub async fn n8n_create_workflow(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    definition: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let client = n8n::build_client_from_credential(&state.db, &credential_id)?;
    client.create_workflow(&definition).await
}

/// Trigger a webhook URL on an n8n instance.
#[tauri::command]
pub async fn n8n_trigger_webhook(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    webhook_url: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, AppError> {
    let client = n8n::build_client_from_credential(&state.db, &credential_id)?;
    client
        .trigger_webhook(&webhook_url, &body.unwrap_or(serde_json::Value::Object(Default::default())))
        .await
}
