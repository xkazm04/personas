//! Tauri command surface for the MCP layer.
//!
//! Bridges the in-process MCP request hub
//! ([`crate::companion::orchestration::mcp::pending`]) to the frontend.
//! The frontend listens for `athena://mcp/*-request` Tauri events,
//! renders the question / approval card, then calls
//! [`companion_mcp_resolve_request`] to release the blocking MCP RPC.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::companion::orchestration::mcp;
use crate::error::AppError;
use crate::AppState;

/// Resolve a pending MCP request. Returns true if a request matched.
///
/// `response` shape depends on the request kind:
///   - `guidance`: `{ "text": "..." }` — Athena's reply, surfaced to
///     the session as the tool-call result text.
///   - `approval`: `{ "approved": bool, "note"?: "..." }` — `approved=true`
///     surfaces as a normal tool result; `approved=false` surfaces with
///     `isError: true` so the session knows the action was denied.
#[tauri::command]
pub async fn companion_mcp_resolve_request(
    state: State<'_, Arc<AppState>>,
    request_id: String,
    response: Value,
) -> Result<bool, AppError> {
    crate::ipc_auth::require_auth(&state).await?;
    Ok(mcp::pending::resolve(&request_id, Ok(response)))
}

/// Snapshot of currently-pending MCP requests. Used by the chat panel
/// to render the in-flight question list after a remount (the event
/// stream catches up live, but a hard reload needs initial state).
#[tauri::command]
pub async fn companion_mcp_pending_snapshot(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PendingRequestDto>, AppError> {
    crate::ipc_auth::require_auth(&state).await?;
    Ok(mcp::pending::snapshot()
        .into_iter()
        .map(|(id, kind, sid)| PendingRequestDto {
            request_id: id,
            kind: match kind {
                mcp::pending::RequestKind::Guidance => "guidance".to_string(),
                mcp::pending::RequestKind::Approval => "approval".to_string(),
            },
            fleet_session_id: sid,
        })
        .collect())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRequestDto {
    pub request_id: String,
    pub kind: String,
    pub fleet_session_id: String,
}
