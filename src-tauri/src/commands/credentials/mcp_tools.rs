use std::sync::Arc;

use tauri::State;

use crate::engine::mcp_tools::{McpTool, McpToolResult};
use crate::error::AppError;
use crate::ipc_auth::require_privileged;
use crate::AppState;

#[tauri::command]
pub async fn list_mcp_tools(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<McpTool>, AppError> {
    require_privileged(&state, "list_mcp_tools").await?;
    crate::engine::mcp_tools::list_tools(&state.db, &credential_id).await
}

#[tauri::command]
pub async fn execute_mcp_tool(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<McpToolResult, AppError> {
    require_privileged(&state, "execute_mcp_tool").await?;
    crate::engine::mcp_tools::execute_tool(
        &state.db,
        &credential_id,
        &tool_name,
        arguments,
    )
    .await
}
