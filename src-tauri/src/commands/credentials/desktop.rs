//! Tauri commands for desktop app discovery, MCP import, and approval management.

use std::sync::Arc;

use tauri::State;

use crate::engine::desktop_discovery::{DiscoveredApp, ImportedMcpServer};
use crate::engine::desktop_security::{DesktopCapability, DesktopConnectorManifest};
use crate::error::AppError;
use crate::AppState;

/// Scan the system for known desktop applications.
#[tauri::command]
pub async fn discover_desktop_apps(
    _state: State<'_, Arc<AppState>>,
) -> Result<Vec<DiscoveredApp>, AppError> {
    Ok(crate::engine::desktop_discovery::discover_apps().await)
}

/// Import MCP servers from Claude Desktop configuration.
#[tauri::command]
pub async fn import_claude_mcp_servers(
    _state: State<'_, Arc<AppState>>,
) -> Result<Vec<ImportedMcpServer>, AppError> {
    crate::engine::desktop_discovery::import_claude_desktop_mcp_servers().await
}

/// Get the security manifest for a desktop connector.
#[tauri::command]
pub async fn get_desktop_connector_manifest(
    _state: State<'_, Arc<AppState>>,
    connector_name: String,
) -> Result<Option<DesktopConnectorManifest>, AppError> {
    Ok(crate::engine::desktop_security::get_manifest(&connector_name))
}

/// Get pending (unapproved) capabilities for a desktop connector.
#[tauri::command]
pub async fn get_pending_desktop_capabilities(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
) -> Result<Vec<DesktopCapability>, AppError> {
    let manifest = crate::engine::desktop_security::get_manifest(&connector_name)
        .ok_or_else(|| AppError::Validation(format!(
            "Unknown desktop connector: {connector_name}"
        )))?;

    Ok(state.desktop_approvals.pending_capabilities(&manifest))
}

/// Approve specific capabilities for a desktop connector.
#[tauri::command]
pub async fn approve_desktop_capabilities(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
    capabilities: Vec<DesktopCapability>,
) -> Result<(), AppError> {
    if capabilities.is_empty() {
        return Ok(());
    }

    // Validate all capabilities are declared in the manifest
    let manifest = crate::engine::desktop_security::get_manifest(&connector_name)
        .ok_or_else(|| AppError::Validation(format!(
            "Unknown desktop connector: {connector_name}"
        )))?;

    for cap in &capabilities {
        if !manifest.capabilities.contains(cap) {
            return Err(AppError::Validation(format!(
                "Capability '{}' is not declared by connector '{connector_name}'",
                serde_json::to_string(cap).unwrap_or_default()
            )));
        }
    }

    state.desktop_approvals.approve(&state.db, &connector_name, &capabilities)?;
    Ok(())
}

/// Revoke all approvals for a desktop connector.
#[tauri::command]
pub async fn revoke_desktop_approvals(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
) -> Result<(), AppError> {
    state.desktop_approvals.revoke(&state.db, &connector_name)?;
    Ok(())
}

/// Check if a desktop connector is fully approved.
#[tauri::command]
pub async fn is_desktop_connector_approved(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
) -> Result<bool, AppError> {
    let manifest = match crate::engine::desktop_security::get_manifest(&connector_name) {
        Some(m) => m,
        None => return Ok(false),
    };

    Ok(state.desktop_approvals.is_fully_approved(&manifest))
}

/// Register an imported MCP server as a credential in the vault.
#[tauri::command]
pub async fn register_imported_mcp_server(
    state: State<'_, Arc<AppState>>,
    server: ImportedMcpServer,
    credential_name: String,
) -> Result<String, AppError> {
    use crate::db::models::CreateCredentialInput;
    use crate::db::repos::resources::credentials;

    // Build credential fields for an MCP server
    let mut fields = std::collections::HashMap::new();
    fields.insert("connection_type".to_string(), "stdio".to_string());
    fields.insert("command".to_string(), server.command);

    if !server.env.is_empty() {
        let env_json = serde_json::to_string(&server.env)
            .map_err(|e| AppError::Internal(format!("Failed to serialize env vars: {e}")))?;
        fields.insert("env_vars".to_string(), env_json);
    }

    let service_type = format!("mcp_{}", server.name);
    let metadata = serde_json::json!({
        "imported_from": "claude_desktop",
        "source": server.source,
        "auth_type": "mcp",
        "auth_type_label": "MCP",
    });

    let input = CreateCredentialInput {
        name: credential_name,
        service_type: service_type.clone(),
        encrypted_data: String::new(),
        iv: String::new(),
        metadata: Some(serde_json::to_string(&metadata).unwrap_or_default()),
        session_encrypted_data: None,
    };

    let credential = credentials::create_with_fields(&state.db, input, &fields)?;

    tracing::info!(
        credential_id = %credential.id,
        server_name = %server.name,
        source = %server.source,
        "Registered imported MCP server as credential"
    );

    Ok(credential.id)
}
