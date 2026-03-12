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
use crate::db::repos::resources::tool_audit_log;
use crate::db::DbPool;
use crate::engine::rate_limiter::{RateLimiter, TOOL_EXECUTION_MAX_PER_MINUTE, TOOL_EXECUTION_WINDOW};
use crate::error::AppError;

/// Maximum allowed MCP JSON-RPC response payload (10 MB).
const MAX_MCP_PAYLOAD_BYTES: usize = 10 * 1024 * 1024;

/// Maximum nesting depth for MCP tool arguments.
const MAX_ARGUMENT_DEPTH: usize = 20;

/// Maximum serialized size for MCP tool arguments (1 MB).
const MAX_ARGUMENT_BYTES: usize = 1024 * 1024;

/// Overall timeout for a complete MCP stdio session (connect + handshake + call).
const MCP_SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

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

/// Ping an MCP server using raw field values (no stored credential required).
///
/// Performs the full MCP handshake (`initialize` -> `notifications/initialized`
/// -> `tools/list`) and returns a healthcheck-style result.
pub async fn ping(fields: &HashMap<String, String>) -> Result<PingResult, AppError> {
    let connection_type = fields
        .get("connection_type")
        .map(|s| s.as_str())
        .unwrap_or("stdio");

    let result = match connection_type {
        "stdio" => list_tools_stdio(fields).await,
        "sse" => list_tools_sse(fields).await,
        other => Err(AppError::Validation(format!(
            "Unsupported MCP connection type: '{other}'"
        ))),
    };

    match result {
        Ok(tools) => Ok(PingResult {
            success: true,
            message: format!("Connected -- {} tool{} available", tools.len(), if tools.len() == 1 { "" } else { "s" }),
        }),
        Err(e) => Ok(PingResult {
            success: false,
            message: format!("{e}"),
        }),
    }
}

/// Result of an MCP server ping / connection test.
#[derive(Debug, serde::Serialize)]
pub struct PingResult {
    pub success: bool,
    pub message: String,
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
///
/// Validates arguments against structural limits (depth, size) and the tool's
/// declared `input_schema` before forwarding to the MCP server.
/// Applies per-tool rate limiting and logs execution to the audit trail.
pub async fn execute_tool(
    pool: &DbPool,
    credential_id: &str,
    tool_name: &str,
    arguments: serde_json::Value,
    rate_limiter: Option<&RateLimiter>,
    persona_id: Option<&str>,
    persona_name: Option<&str>,
) -> Result<McpToolResult, AppError> {
    // Per-tool rate limiting
    if let Some(rl) = rate_limiter {
        let rate_key = format!("mcp_tool:{tool_name}");
        if let Err(retry_after) = rl.check(&rate_key, TOOL_EXECUTION_MAX_PER_MINUTE, TOOL_EXECUTION_WINDOW) {
            tracing::warn!(
                tool_name = %tool_name,
                retry_after_secs = retry_after,
                "MCP tool execution rate limited"
            );
            return Err(AppError::RateLimited(format!(
                "Tool '{tool_name}' rate limited. Retry after {retry_after}s."
            )));
        }
    }

    // Structural validation: reject oversized or deeply nested arguments early.
    validate_argument_structure(&arguments)?;

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

    // Audit logging (best-effort, never fails the call)
    let (status, error_msg) = match &result {
        Ok(r) if r.is_error => ("tool_error", None),
        Ok(_) => ("success", None),
        Err(e) => ("error", Some(e.to_string())),
    };
    if let Err(log_err) = tool_audit_log::insert(
        pool,
        &format!("mcp:{credential_id}:{tool_name}"),
        tool_name,
        "mcp",
        persona_id,
        persona_name,
        Some(credential_id),
        status,
        Some(duration_ms),
        error_msg.as_deref(),
    ) {
        tracing::warn!("Failed to write tool audit log: {log_err}");
    }

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
    tokio::time::timeout(MCP_SESSION_TIMEOUT, list_tools_stdio_inner(fields))
        .await
        .map_err(|_| AppError::Internal(
            "MCP stdio session timed out during tools/list".into(),
        ))?
}

async fn list_tools_stdio_inner(
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
    tokio::time::timeout(
        MCP_SESSION_TIMEOUT,
        execute_tool_stdio_inner(fields, tool_name, arguments),
    )
    .await
    .map_err(|_| AppError::Internal(
        format!("MCP stdio session timed out executing tool '{tool_name}'"),
    ))?
}

async fn execute_tool_stdio_inner(
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

    // List tools to get input_schema for validation
    let list_req = jsonrpc_request(2, "tools/list", serde_json::json!({}));
    write_jsonrpc(&mut child, &list_req).await?;
    let list_resp = read_jsonrpc(&mut child).await?;

    let schema = extract_tool_schema(&list_resp, tool_name)?;
    validate_arguments_against_schema(arguments, schema.as_ref())?;

    // Call tool
    let call_req = jsonrpc_request(3, "tools/call", serde_json::json!({
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

    // List tools to get input_schema for validation
    let list_payload = jsonrpc_request(2, "tools/list", serde_json::json!({}));
    let list_resp = send_sse_request(&client, url, auth_token, &list_payload).await?;

    let schema = extract_tool_schema(&list_resp, tool_name)?;
    validate_arguments_against_schema(arguments, schema.as_ref())?;

    // Call tool
    let call_payload = jsonrpc_request(3, "tools/call", serde_json::json!({
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
// Argument validation
// ============================================================================

/// Reject arguments that exceed structural limits (depth, serialized size).
fn validate_argument_structure(arguments: &serde_json::Value) -> Result<(), AppError> {
    let serialized_len = serde_json::to_string(arguments)
        .map_err(|e| AppError::Validation(format!("Cannot serialize arguments: {e}")))?
        .len();

    if serialized_len > MAX_ARGUMENT_BYTES {
        return Err(AppError::Validation(format!(
            "MCP tool arguments exceed maximum size ({serialized_len} bytes > {MAX_ARGUMENT_BYTES} byte limit)"
        )));
    }

    let depth = json_depth(arguments);
    if depth > MAX_ARGUMENT_DEPTH {
        return Err(AppError::Validation(format!(
            "MCP tool arguments exceed maximum nesting depth ({depth} > {MAX_ARGUMENT_DEPTH} limit)"
        )));
    }

    Ok(())
}

/// Compute the maximum nesting depth of a JSON value.
fn json_depth(value: &serde_json::Value) -> usize {
    match value {
        serde_json::Value::Array(arr) => {
            1 + arr.iter().map(json_depth).max().unwrap_or(0)
        }
        serde_json::Value::Object(obj) => {
            1 + obj.values().map(json_depth).max().unwrap_or(0)
        }
        _ => 0,
    }
}

/// Extract the `input_schema` for a specific tool from a `tools/list` response.
/// Returns `Ok(None)` if the tool exists but has no schema.
/// Returns `Err` if the tool is not found in the server's tool list.
fn extract_tool_schema(
    list_resp: &serde_json::Value,
    tool_name: &str,
) -> Result<Option<serde_json::Value>, AppError> {
    let tools_arr = list_resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .ok_or_else(|| AppError::Internal("Invalid tools/list response".into()))?;

    let tool = tools_arr
        .iter()
        .find(|t| t.get("name").and_then(|n| n.as_str()) == Some(tool_name))
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Tool '{tool_name}' not found on MCP server"
            ))
        })?;

    Ok(tool.get("inputSchema").or_else(|| tool.get("input_schema")).cloned())
}

/// Validate arguments against the tool's declared JSON Schema.
/// Skips validation if no schema is declared (permissive by default).
fn validate_arguments_against_schema(
    arguments: &serde_json::Value,
    schema: Option<&serde_json::Value>,
) -> Result<(), AppError> {
    let schema = match schema {
        Some(s) => s,
        None => return Ok(()), // No schema declared; allow any arguments
    };

    let validator = match jsonschema::validator_for(schema) {
        Ok(v) => v,
        Err(e) => {
            // If the schema itself is invalid, log and skip validation rather
            // than blocking all calls to a tool with a broken schema.
            tracing::warn!("MCP tool has invalid input_schema, skipping validation: {e}");
            return Ok(());
        }
    };

    let errors: Vec<String> = validator
        .iter_errors(arguments)
        .map(|err| {
            let path = err.instance_path.to_string();
            if path.is_empty() {
                err.to_string()
            } else {
                format!("{path}: {err}")
            }
        })
        .collect();

    if !errors.is_empty() {
        let summary = if errors.len() <= 3 {
            errors.join("; ")
        } else {
            format!(
                "{}; ... and {} more errors",
                errors[..3].join("; "),
                errors.len() - 3
            )
        };
        return Err(AppError::Validation(format!(
            "MCP tool arguments failed schema validation: {summary}"
        )));
    }

    Ok(())
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
    let raw: HashMap<String, String> = fields
        .get("env_vars")
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or_default();

    raw.into_iter()
        .filter_map(|(k, v)| {
            super::runner::sanitize_env_name(&k).map(|safe_key| (safe_key, v))
        })
        .collect()
}

fn spawn_mcp_process(
    command: &str,
    working_directory: Option<&String>,
    env_vars: &HashMap<String, String>,
) -> Result<tokio::process::Child, AppError> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("MCP command is empty".into()));
    }

    // On Windows, commands like `npx` are actually `.cmd` wrappers that
    // require shell dispatch. Use `cmd /C` so PATHEXT resolution works.
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", trimmed]);
        c
    };

    #[cfg(not(windows))]
    let mut cmd = {
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        let mut c = tokio::process::Command::new(parts[0]);
        if parts.len() > 1 {
            c.args(&parts[1..]);
        }
        c
    };

    if let Some(wd) = working_directory {
        if !wd.trim().is_empty() {
            cmd.current_dir(wd);
        }
    }

    for (k, v) in env_vars {
        cmd.env(k, v);
    }

    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);

    // Prevent a visible console window flash on Windows.
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd.spawn()
        .map_err(|e| AppError::Internal(format!("Failed to spawn MCP process: {e}")))
}

/// Timeout for MCP stdin write + flush operations (prevents hung process accumulation).
const MCP_WRITE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

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

    tokio::time::timeout(MCP_WRITE_TIMEOUT, async {
        stdin
            .write_all(message.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write to MCP stdin: {e}")))?;

        stdin
            .flush()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to flush MCP stdin: {e}")))?;

        Ok(())
    })
    .await
    .map_err(|_| AppError::Internal("Timeout writing to MCP process stdin".into()))?
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

    // Read headers with a total timeout (prevents slowloris-style attacks
    // where the server sends headers one byte at a time).
    let content_length: usize = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        async {
            let mut cl: usize = 0;
            loop {
                let mut line = String::new();
                let bytes_read = reader
                    .read_line(&mut line)
                    .await
                    .map_err(|e| AppError::Internal(format!("Failed to read from MCP stdout: {e}")))?;

                if bytes_read == 0 {
                    return Err(AppError::Internal("MCP process closed stdout unexpectedly".into()));
                }

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    break; // End of headers
                }

                if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                    cl = len_str
                        .trim()
                        .parse()
                        .map_err(|_| AppError::Internal("Invalid Content-Length from MCP server".into()))?;
                }
            }
            Ok(cl)
        },
    )
    .await
    .map_err(|_| AppError::Internal("Timeout reading headers from MCP server".into()))??;

    if content_length == 0 {
        return Err(AppError::Internal("MCP server sent no Content-Length header".into()));
    }

    if content_length > MAX_MCP_PAYLOAD_BYTES {
        return Err(AppError::Internal(format!(
            "MCP response too large: Content-Length {} exceeds limit of {} bytes",
            content_length, MAX_MCP_PAYLOAD_BYTES,
        )));
    }

    // Read exact body
    let mut body = vec![0u8; content_length];
    use tokio::io::AsyncReadExt;
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
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
