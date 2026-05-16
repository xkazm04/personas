use std::collections::HashMap;
use std::sync::Arc;

use tauri::State;

use crate::engine::mcp_tools::{McpTool, McpToolResult, PingResult, StdioPoolMetrics};
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

#[tauri::command]
#[requires(privileged)]
pub async fn list_mcp_tools(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<McpTool>, AppError> {
    crate::engine::mcp_tools::list_tools(&state.db, &credential_id).await
}

#[tauri::command]
#[requires(privileged)]
pub async fn execute_mcp_tool(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<McpToolResult, AppError> {
    crate::engine::mcp_tools::execute_tool(
        &state.db,
        &credential_id,
        &tool_name,
        arguments,
        Some(&state.rate_limiter),
        None,
        None,
    )
    .await
}

#[tauri::command]
#[requires(privileged)]
pub async fn healthcheck_mcp_preview(
    state: State<'_, Arc<AppState>>,
    fields: HashMap<String, String>,
) -> Result<PingResult, AppError> {
    crate::engine::mcp_tools::ping(&fields).await
}

#[tauri::command]
#[requires(privileged)]
pub async fn get_mcp_pool_metrics(
    state: State<'_, Arc<AppState>>,
) -> Result<StdioPoolMetrics, AppError> {
    Ok(crate::engine::mcp_tools::snapshot_pool_metrics().await)
}
