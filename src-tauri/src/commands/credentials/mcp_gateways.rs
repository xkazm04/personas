//! Tauri commands for MCP gateway membership management.
//!
//! A "gateway" credential (connector_name = "mcp_gateway") bundles multiple
//! MCP-speaking credentials under one attachment point. Use these commands to
//! add, remove, and list members of a gateway.
//!
//! Added 2026-04-08 as part of the LangSmith/Arcade MCP gateway pattern.

use std::sync::Arc;

use tauri::State;

use crate::db::repos::resources::mcp_gateways::{self, GatewayMember};
use crate::error::AppError;
use crate::ipc_auth::require_privileged;
use crate::AppState;

#[tauri::command]
pub async fn add_mcp_gateway_member(
    state: State<'_, Arc<AppState>>,
    gateway_credential_id: String,
    member_credential_id: String,
    display_name: String,
    sort_order: Option<i32>,
) -> Result<String, AppError> {
    require_privileged(&state, "add_mcp_gateway_member").await?;
    mcp_gateways::add_member(
        &state.db,
        &gateway_credential_id,
        &member_credential_id,
        &display_name,
        sort_order.unwrap_or(0),
    )
}

#[tauri::command]
pub async fn remove_mcp_gateway_member(
    state: State<'_, Arc<AppState>>,
    gateway_credential_id: String,
    member_credential_id: String,
) -> Result<(), AppError> {
    require_privileged(&state, "remove_mcp_gateway_member").await?;
    mcp_gateways::remove_member(&state.db, &gateway_credential_id, &member_credential_id)
}

#[tauri::command]
pub async fn list_mcp_gateway_members(
    state: State<'_, Arc<AppState>>,
    gateway_credential_id: String,
) -> Result<Vec<GatewayMember>, AppError> {
    require_privileged(&state, "list_mcp_gateway_members").await?;
    mcp_gateways::list_members(&state.db, &gateway_credential_id)
}

#[tauri::command]
pub async fn set_mcp_gateway_member_enabled(
    state: State<'_, Arc<AppState>>,
    gateway_credential_id: String,
    member_credential_id: String,
    enabled: bool,
) -> Result<(), AppError> {
    require_privileged(&state, "set_mcp_gateway_member_enabled").await?;
    mcp_gateways::set_member_enabled(
        &state.db,
        &gateway_credential_id,
        &member_credential_id,
        enabled,
    )
}
