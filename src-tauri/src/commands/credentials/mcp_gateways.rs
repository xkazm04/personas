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
use crate::AppState;
use personas_macros::requires;

#[tauri::command]
#[requires(privileged)]
pub async fn add_mcp_gateway_member(
    state: State<'_, Arc<AppState>>,
    gateway_credential_id: String,
    member_credential_id: String,
    display_name: String,
    sort_order: Option<i32>,
) -> Result<String, AppError> {
    // Gateway tools are exposed to personas as `"{display_name}::{tool}"` and
    // routed back by splitting on the first `::`. If a display name itself
    // contains `::`, routing becomes ambiguous — member tools turn uncallable,
    // or a crafted name dispatches a call to the wrong member/credential
    // (bug-hunt 2026-06-07 mcp #5). Enforce the separator invariant at the input
    // boundary. Surrounding whitespace is trimmed so it can't break the
    // exact-equality member match at parse time.
    let display_name = display_name.trim();
    if display_name.is_empty() {
        return Err(AppError::Validation(
            "Gateway member display name must not be empty".into(),
        ));
    }
    if display_name.contains("::") {
        return Err(AppError::Validation(
            "Gateway member display name may not contain '::' (reserved as the gateway tool-name separator)".into(),
        ));
    }
    mcp_gateways::add_member(
        &state.db,
        &gateway_credential_id,
        &member_credential_id,
        display_name,
        sort_order.unwrap_or(0),
    )
}

#[tauri::command]
#[requires(privileged)]
pub async fn remove_mcp_gateway_member(
    state: State<'_, Arc<AppState>>,
    gateway_credential_id: String,
    member_credential_id: String,
) -> Result<(), AppError> {
    mcp_gateways::remove_member(&state.db, &gateway_credential_id, &member_credential_id)
}

#[tauri::command]
#[requires(privileged)]
pub async fn list_mcp_gateway_members(
    state: State<'_, Arc<AppState>>,
    gateway_credential_id: String,
) -> Result<Vec<GatewayMember>, AppError> {
    mcp_gateways::list_members(&state.db, &gateway_credential_id)
}

#[tauri::command]
#[requires(privileged)]
pub async fn set_mcp_gateway_member_enabled(
    state: State<'_, Arc<AppState>>,
    gateway_credential_id: String,
    member_credential_id: String,
    enabled: bool,
) -> Result<(), AppError> {
    mcp_gateways::set_member_enabled(
        &state.db,
        &gateway_credential_id,
        &member_credential_id,
        enabled,
    )
}
