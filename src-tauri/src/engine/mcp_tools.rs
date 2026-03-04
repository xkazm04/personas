//! MCP (Model Context Protocol) tool discovery and execution engine.
//!
//! Connects to MCP servers via stdio or SSE transport to:
//! - Discover available tools (`tools/list`)
//! - Execute tools (`tools/call`)
//!
//! Uses spawn-per-request model: each invocation starts a fresh process/connection
//! and cleans up after completion.

use std::collections::HashMap;
use std::time::Instant;

use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// An MCP tool definition as returned by `tools/list`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
}

/// A content block returned by tool execution.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct McpToolContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: Option<String>,
}

/// Result of executing an MCP tool.
#[derive(Debug, serde::Serialize)]
pub struct McpToolResult {
    pub content: Vec<McpToolContent>,
    pub is_error: bool,
    pub duration_ms: u64,
}

/// List available tools from an MCP server.
pub async fn list_tools(
    pool: &DbPool,
    credential_id: &str,
) -> Result<Vec<McpTool>, AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;
    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;

    let connection_type = fields
        .get("connection_type")
        .map(|s| s.as_str())
        .unwrap_or("stdio");

    match connection_type {
        "stdio" => list_tools_stdio(&fields).await,
        "sse" => list_tools_sse(&fields).await,
        other => Err(AppError::Validation(format!(
            "Unsupported MCP connection type: '{other}'"
        ))),
    }
}

/// Execute a tool on an MCP server.
pub async fn execute_tool(
    pool: &DbPool,
    credential_id: &str,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<McpToolResult, AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;
    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;

    let connection_type = fields
        .get("connection_type")
        .map(|s| s.as_str())
        .unwrap_or("stdio");

    let start = Instant::now();

    let result = match connection_type {
        "stdio" => execute_tool_stdio(&fields, tool_name, &arguments).await,
        "sse" => execute_tool_sse(&fields, tool_name, &arguments).await,
        other => Err(AppError::Validation(format!(
            "Unsupported MCP connection type: '{other}'"
        ))),
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(mut r) => {
            r.duration_ms = duration_ms;
            Ok(r)
        }
        Err(e) => Err(e),
    }
}

// ============================================================================
// stdio transport
// ============================================================================

async fn list_tools_stdio(
    fields: &HashMap<String, String>,
) -> Result<Vec<McpTool>, AppError> {
    let command = fields
        .get("command")
        .ok_or_else(|| AppError::Validation("MCP server has no 'command' field".into()))?;

    let env_vars = parse_env_vars(fields);

    let mut child = spawn_mcp_process(command, fields.get("working_directory"), &env_vars)?;

    // Initialize
    let init_req = jsonrpc_request(1, "initialize", serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "personas-playground", "version": "1.0.0" }
    }));

    write_jsonrpc(&mut child, &init_req).await?;
    let _init_resp = read_jsonrpc(&mut child).await?;

    // Send initialized notification
    let initialized = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    write_jsonrpc(&mut child, &initialized).await?;

    // List tools
    let list_req = jsonrpc_request(2, "tools/list", serde_json::json!({}));
    write_jsonrpc(&mut child, &list_req).await?;
    let list_resp = read_jsonrpc(&mut child).await?;

    // Kill process
    let _ = child.kill().await;

    // Parse tools from response
    let tools_val = list_resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .ok_or_else(|| AppError::Internal("Invalid tools/list response".into()))?;

    let tools: Vec<McpTool> = tools_val
        .iter()
        .filter_map(|t| serde_json::from_value(t.clone()).ok())
        .collect();

    Ok(tools)
}

async fn execute_tool_stdio(
    fields: &HashMap<String, String>,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<McpToolResult, AppError> {
    let command = fields
        .get("command")
        .ok_or_else(|| AppError::Validation("MCP server has no 'command' field".into()))?;

    let env_vars = parse_env_vars(fields);

    let mut child = spawn_mcp_process(command, fields.get("working_directory"), &env_vars)?;

    // Initialize
    let init_req = jsonrpc_request(1, "initialize", serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "personas-playground", "version": "1.0.0" }
    }));

    write_jsonrpc(&mut child, &init_req).await?;
    let _init_resp = read_jsonrpc(&mut child).await?;

    // Send initialized notification
    let initialized = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    write_jsonrpc(&mut child, &initialized).await?;

    // Call tool
    let call_req = jsonrpc_request(2, "tools/call", serde_json::json!({
        "name": tool_name,
        "arguments": arguments,
    }));

    write_jsonrpc(&mut child, &call_req).await?;
    let call_resp = read_jsonrpc(&mut child).await?;

    // Kill process
    let _ = child.kill().await;

    parse_tool_result(&call_resp)
}

// ============================================================================
// SSE transport
// ============================================================================

async fn list_tools_sse(
    fields: &HashMap<String, String>,
) -> Result<Vec<McpTool>, AppError> {
    let url = fields
        .get("url")
        .ok_or_else(|| AppError::Validation("MCP server has no 'url' field".into()))?;
    let auth_token = fields.get("auth_token");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    // Initialize
    let init_payload = jsonrpc_request(1, "initialize", serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "personas-playground", "version": "1.0.0" }
    }));

    let _init_resp = send_sse_request(&client, url, auth_token, &init_payload).await?;

    // List tools
    let list_payload = jsonrpc_request(2, "tools/list", serde_json::json!({}));
    let list_resp = send_sse_request(&client, url, auth_token, &list_payload).await?;

    let tools_val = list_resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .ok_or_else(|| AppError::Internal("Invalid tools/list response from SSE server".into()))?;

    let tools: Vec<McpTool> = tools_val
        .iter()
        .filter_map(|t| serde_json::from_value(t.clone()).ok())
        .collect();

    Ok(tools)
}

async fn execute_tool_sse(
    fields: &HashMap<String, String>,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<McpToolResult, AppError> {
    let url = fields
        .get("url")
        .ok_or_else(|| AppError::Validation("MCP server has no 'url' field".into()))?;
    let auth_token = fields.get("auth_token");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    // Initialize
    let init_payload = jsonrpc_request(1, "initialize", serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "personas-playground", "version": "1.0.0" }
    }));
    let _init_resp = send_sse_request(&client, url, auth_token, &init_payload).await?;

    // Call tool
    let call_payload = jsonrpc_request(2, "tools/call", serde_json::json!({
        "name": tool_name,
        "arguments": arguments,
    }));
    let call_resp = send_sse_request(&client, url, auth_token, &call_payload).await?;

    parse_tool_result(&call_resp)
}

async fn send_sse_request(
    client: &reqwest::Client,
    url: &str,
    auth_token: Option<&String>,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let mut req = client.post(url).json(payload);
    if let Some(token) = auth_token {
        req = req.bearer_auth(token);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("SSE request failed: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read SSE response: {e}")))?;

    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "SSE server returned {status}: {body}"
        )));
    }

    serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("Invalid JSON from SSE server: {e}")))
}

// ============================================================================
// Helpers
// ============================================================================

fn jsonrpc_request(id: u64, method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    })
}

fn parse_env_vars(fields: &HashMap<String, String>) -> HashMap<String, String> {
    fields
        .get("env_vars")
        .and_then(|v| serde_json::from_str::<HashMap<String, String>>(v).ok())
        .unwrap_or_default()
}

fn spawn_mcp_process(
    command: &str,
    working_directory: Option<&String>,
    env_vars: &HashMap<String, String>,
) -> Result<tokio::process::Child, AppError> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err(AppError::Validation("MCP command is empty".into()));
    }

    let mut cmd = tokio::process::Command::new(parts[0]);
    if parts.len() > 1 {
        cmd.args(&parts[1..]);
    }

    if let Some(wd) = working_directory {
        cmd.current_dir(wd);
    }

    for (k, v) in env_vars {
        cmd.env(k, v);
    }

    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);

    cmd.spawn()
        .map_err(|e| AppError::Internal(format!("Failed to spawn MCP process: {e}")))
}

async fn write_jsonrpc(
    child: &mut tokio::process::Child,
    payload: &serde_json::Value,
) -> Result<(), AppError> {
    use tokio::io::AsyncWriteExt;

    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| AppError::Internal("MCP process stdin not available".into()))?;

    let json = serde_json::to_string(payload)
        .map_err(|e| AppError::Internal(format!("JSON serialize error: {e}")))?;

    // MCP uses Content-Length header framing
    let message = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);

    stdin
        .write_all(message.as_bytes())
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write to MCP stdin: {e}")))?;

    stdin
        .flush()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to flush MCP stdin: {e}")))?;

    Ok(())
}

async fn read_jsonrpc(
    child: &mut tokio::process::Child,
) -> Result<serde_json::Value, AppError> {
    use tokio::io::AsyncBufReadExt;

    let stdout = child
        .stdout
        .as_mut()
        .ok_or_else(|| AppError::Internal("MCP process stdout not available".into()))?;

    let mut reader = tokio::io::BufReader::new(stdout);

    // Read Content-Length header
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        let bytes_read = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            reader.read_line(&mut line),
        )
        .await
        .map_err(|_| AppError::Internal("Timeout reading from MCP server".into()))?
        .map_err(|e| AppError::Internal(format!("Failed to read from MCP stdout: {e}")))?;

        if bytes_read == 0 {
            return Err(AppError::Internal("MCP process closed stdout unexpectedly".into()));
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            break; // End of headers
        }

        if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
            content_length = len_str
                .trim()
                .parse()
                .map_err(|_| AppError::Internal("Invalid Content-Length from MCP server".into()))?;
        }
    }

    if content_length == 0 {
        return Err(AppError::Internal("MCP server sent no Content-Length header".into()));
    }

    // Read exact body
    let mut body = vec![0u8; content_length];
    use tokio::io::AsyncReadExt;
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        reader.read_exact(&mut body),
    )
    .await
    .map_err(|_| AppError::Internal("Timeout reading MCP response body".into()))?
    .map_err(|e| AppError::Internal(format!("Failed to read MCP response body: {e}")))?;

    let json_str = String::from_utf8_lossy(&body);

    serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON from MCP server: {e}")))
}

fn parse_tool_result(resp: &serde_json::Value) -> Result<McpToolResult, AppError> {
    // Check for JSON-RPC error
    if let Some(err) = resp.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Ok(McpToolResult {
            content: vec![McpToolContent {
                content_type: "text".into(),
                text: Some(format!("Error: {msg}")),
            }],
            is_error: true,
            duration_ms: 0,
        });
    }

    let result = resp
        .get("result")
        .ok_or_else(|| AppError::Internal("No result in MCP tool response".into()))?;

    let is_error = result
        .get("isError")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let content: Vec<McpToolContent> = result
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(McpToolResult {
        content,
        is_error,
        duration_ms: 0,
    })
}
