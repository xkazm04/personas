use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tauri::State;

use crate::engine::mcp_tools::{McpTool, McpToolResult, PingResult, StdioPoolMetrics};
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

/// Live liveness of the local management HTTP server (the "MCP server" the
/// Settings panel points MCP clients at). `live` reflects an actual `/health`
/// probe of the listener, NOT an optimistic intent flag — an explicit down
/// state when the socket isn't answering.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct McpServerLiveness {
    /// True iff `GET http://127.0.0.1:<port>/health` returned 2xx within the
    /// probe timeout.
    pub live: bool,
    /// The port the management server binds (honors the PERSONAS_WEBHOOK_PORT
    /// override, so the panel shows the real port).
    pub port: u16,
}

/// Probe the local management server's unauthenticated `/health` endpoint so the
/// Settings panel can render an honest running/down chip instead of a hardcoded
/// "Running" literal. Cheap: one localhost GET with a 2s timeout, no auth (the
/// `/health` route is intentionally unauthenticated).
#[tauri::command]
#[requires(privileged)]
pub async fn probe_mcp_server(
    state: State<'_, Arc<AppState>>,
) -> Result<McpServerLiveness, AppError> {
    let _ = state; // auth gate only; no state needed for the probe
    let port = crate::engine::webhook::webhook_port();
    let url = format!("http://127.0.0.1:{port}/health");

    let live = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => matches!(client.get(&url).send().await, Ok(resp) if resp.status().is_success()),
        Err(_) => false,
    };

    Ok(McpServerLiveness { live, port })
}

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
