use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{PersonaToolDefinition, ToolKind, VirtualToolId};
use crate::db::repos::resources::automations as automation_repo;
use crate::db::repos::resources::tool_audit_log;
use crate::db::DbPool;
use crate::engine::automation_runner::invoke_automation;
use crate::engine::rate_limiter::{RateLimiter, TOOL_EXECUTION_MAX_PER_MINUTE, TOOL_EXECUTION_WINDOW};
use crate::error::AppError;

/// Default timeout for direct tool invocations (script and API calls).
const DIRECT_TOOL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Shorter timeout for test-mode tool invocations.
const TEST_TOOL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Result of a direct (no-LLM) tool invocation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolInvocationResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub tool_name: String,
    /// "script" | "api" | "unknown"
    pub tool_type: String,
}

/// Invoke a tool directly without LLM orchestration.
///
/// For **script** tools (`script_path` is non-empty): spawns `npx tsx <script_path> --input '<json>'`.
/// For **API** tools (has `implementation_guide` with a `Curl:` line): extracts the curl command,
/// tokenizes it, substitutes `$ENV_VAR` placeholders, and executes via `Command::new("curl")`
/// with individual `.arg()` calls (no shell involved, preventing command injection).
///
/// Applies per-tool rate limiting, wraps invocations in a timeout, and logs
/// structured audit entries for every execution.
pub async fn invoke_tool_direct(
    pool: &DbPool,
    tool: &PersonaToolDefinition,
    persona_id: &str,
    persona_name: &str,
    input_json: &str,
    rate_limiter: Option<&RateLimiter>,
) -> Result<ToolInvocationResult, AppError> {
    // Per-tool rate limiting
    if let Some(rl) = rate_limiter {
        let rate_key = format!("tool:{}", tool.id);
        if let Err(retry_after) = rl.check(&rate_key, TOOL_EXECUTION_MAX_PER_MINUTE, TOOL_EXECUTION_WINDOW) {
            tracing::warn!(
                tool_name = %tool.name,
                tool_id = %tool.id,
                retry_after_secs = retry_after,
                "Direct tool execution rate limited"
            );
            return Err(AppError::RateLimited(format!(
                "Tool '{}' rate limited. Retry after {retry_after}s.",
                tool.name
            )));
        }
    }

    let start = Instant::now();

    // Resolve credential env vars using the existing runner infrastructure
    let (env_vars, _hints, cred_failures) =
        super::runner::resolve_credential_env_vars(pool, std::slice::from_ref(tool), persona_id, persona_name)
            .await;

    if !cred_failures.is_empty() {
        return Err(AppError::Execution(format!(
            "Credential decryption failed for: {}. Re-enter or rotate these credentials before retrying.",
            cred_failures.join(", ")
        )));
    }

    let env_map: HashMap<&str, &str> = env_vars
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    let kind = tool.tool_kind().map_err(AppError::Execution)?;

    let result = {
        #[allow(clippy::type_complexity)]
        let fut: std::pin::Pin<Box<dyn std::future::Future<Output = Result<(String, String), AppError>> + Send>> = match kind {
            ToolKind::Automation => Box::pin(invoke_automation_tool(pool, tool, input_json)),
            ToolKind::Script => Box::pin(invoke_script(tool, input_json, &env_map)),
            ToolKind::Api => {
                let guide = tool.implementation_guide.as_ref().ok_or_else(|| {
                    AppError::Execution(format!(
                        "Tool '{}' is categorized as API but has no implementation_guide",
                        tool.name
                    ))
                })?;
                Box::pin(invoke_api(tool, guide, input_json, &env_map))
            }
        };
        tokio::time::timeout(DIRECT_TOOL_TIMEOUT, fut)
            .await
            .map_err(|_| AppError::Execution(format!(
                "Tool '{}' timed out after {}s",
                tool.name, DIRECT_TOOL_TIMEOUT.as_secs()
            )))?
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    let invocation_result = match result {
        Ok((output, tool_type)) => ToolInvocationResult {
            success: true,
            output,
            error: None,
            duration_ms,
            tool_name: tool.name.clone(),
            tool_type,
        },
        Err(e) => {
            let tool_type = match kind {
                ToolKind::Automation => "automation",
                ToolKind::Script => "script",
                ToolKind::Api => "api",
            };
            ToolInvocationResult {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
                duration_ms,
                tool_name: tool.name.clone(),
                tool_type: tool_type.to_string(),
            }
        }
    };

    // Structured audit logging (best-effort, never fails the call)
    if let Err(log_err) = tool_audit_log::insert(
        pool,
        &tool.id,
        &tool.name,
        &invocation_result.tool_type,
        Some(persona_id),
        Some(persona_name),
        None,
        if invocation_result.success { "success" } else { "error" },
        Some(duration_ms),
        invocation_result.error.as_deref(),
    ) {
        tracing::warn!("Failed to write tool audit log: {log_err}");
    }

    Ok(invocation_result)
}

/// Invoke a script-based tool via `npx tsx`.
async fn invoke_script(
    tool: &PersonaToolDefinition,
    input_json: &str,
    env_map: &HashMap<&str, &str>,
) -> Result<(String, String), AppError> {
    let mut cmd = tokio::process::Command::new("npx");
    cmd.arg("tsx")
        .arg(&tool.script_path)
        .arg("--input")
        .arg(input_json);

    for (k, v) in env_map {
        cmd.env(k, v);
    }

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = cmd.output().await.map_err(|e| {
        AppError::Execution(format!("Failed to spawn tool script '{}': {}", tool.script_path, e))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok((stdout, "script".to_string()))
    } else {
        let msg = if stderr.is_empty() { &stdout } else { &stderr };
        Err(AppError::Execution(format!(
            "Script exited with {}: {}",
            output.status,
            msg.trim()
        )))
    }
}

/// Invoke an API tool by extracting the Curl command from its implementation_guide.
///
/// Uses `Command::new("curl")` with individual `.arg()` calls to avoid shell
/// injection (CWE-78). The curl command string is tokenized respecting quotes,
/// then variable placeholders are substituted in each token individually.
///
/// Security measures:
/// - User input is sanitized (null bytes, CRLF stripped) before substitution
/// - Input params are substituted **before** env vars, preventing user values
///   containing `${SECRET}` from triggering credential expansion
/// - Resolved arguments are validated against a blocklist of dangerous curl
///   flags (`-o`, `--output`, `-K`, `--config`, etc.)
/// - `--proto =https,http` is injected to restrict curl to safe protocols,
///   blocking `file://`, `gopher://`, `dict://`, etc. (SSRF mitigation)
async fn invoke_api(
    tool: &PersonaToolDefinition,
    guide: &str,
    input_json: &str,
    env_map: &HashMap<&str, &str>,
) -> Result<(String, String), AppError> {
    let curl_line = extract_curl_line(guide).ok_or_else(|| {
        AppError::Execution(format!(
            "Tool '{}' implementation_guide has no 'Curl:' line -- cannot invoke directly",
            tool.name
        ))
    })?;

    // Parse the curl command into shell-style tokens (respecting quotes)
    let raw_tokens = shell_tokenize(curl_line);

    // The first token must be "curl"
    if raw_tokens.is_empty() || raw_tokens[0] != "curl" {
        return Err(AppError::Execution(format!(
            "Tool '{}' Curl: line must start with 'curl', got: {:?}",
            tool.name,
            raw_tokens.first()
        )));
    }

    // Pre-parse input JSON once instead of re-parsing per token.
    let input_val: Option<serde_json::Value> = serde_json::from_str(input_json).ok();

    // Substitute placeholders in each token individually.
    // Each token becomes a separate process argument so shell metacharacters
    // (;, |, &&, $(...), etc.) have no effect.
    let resolved_tokens: Vec<String> = raw_tokens[1..]
        .iter()
        .map(|token| resolve_placeholders(token, env_map, input_val.as_ref()))
        .collect();

    // Validate resolved arguments -- block dangerous curl flags and URL schemes
    validate_curl_args(&resolved_tokens, &tool.name)?;

    // Execute directly via Command::new("curl") -- no shell involved.
    // Inject --proto to restrict to safe URL schemes (blocks file://, gopher://, etc.)
    let mut cmd = tokio::process::Command::new("curl");
    cmd.arg("--proto").arg("=https,http");
    for token in &resolved_tokens {
        cmd.arg(token);
    }

    for (k, v) in env_map {
        cmd.env(k, v);
    }

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = cmd.output().await.map_err(|e| {
        AppError::Execution(format!("Failed to execute curl for tool '{}': {}", tool.name, e))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok((stdout, "api".to_string()))
    } else {
        let msg = if stderr.is_empty() { &stdout } else { &stderr };
        Err(AppError::Execution(format!(
            "Curl exited with {}: {}",
            output.status,
            msg.trim()
        )))
    }
}

/// Substitute `$VAR` and `${VAR}` placeholders in a single token with values
/// from the environment map and input JSON. Returns the resolved string.
///
/// **Security**: Input parameters (user-controlled) are substituted **first** and
/// their values are sanitized to strip null bytes and control characters.
/// Environment variables (credentials) are substituted **second**. This ordering
/// prevents a user from injecting `${SECRET_ENV}` into their input value and
/// having it expand to actual credential data during the env-var pass.
fn resolve_placeholders(
    token: &str,
    env_map: &HashMap<&str, &str>,
    input_val: Option<&serde_json::Value>,
) -> String {
    let mut resolved = token.to_string();

    // 1. Substitute input parameters FIRST (user-controlled values).
    //    Sanitize values to strip null bytes and CRLF sequences that could be
    //    used for header injection in HTTP requests.
    if let Some(obj) = input_val.and_then(|v| v.as_object()) {
        for (key, val) in obj {
            let raw = match val {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            let sanitized = sanitize_input_value(&raw);
            resolved = resolved.replace(&format!("${{{}}}", key), &sanitized);
            resolved = resolved.replace(&format!("${}", key), &sanitized);
        }
    }

    // 2. Substitute credential env vars SECOND.
    //    Because user input was already expanded above, any `${VAR}` patterns
    //    originating from user values are now literal text and will NOT match
    //    env var keys (user values had `$` escaped to prevent expansion).
    for (k, v) in env_map {
        resolved = resolved.replace(&format!("${{{}}}", k), v);
        resolved = resolved.replace(&format!("${}", k), v);
    }

    resolved
}

/// Sanitize a user-provided input value before substitution into a curl argument.
///
/// - Strips null bytes (prevent C-string truncation)
/// - Strips carriage returns and newlines (prevent CRLF / header injection)
/// - Strips Unicode line terminators: U+0085 (NEL), U+000B (VT),
///   U+2028 (LINE SEPARATOR), U+2029 (PARAGRAPH SEPARATOR)
/// - Escapes `$` characters so user values cannot trigger secondary placeholder
///   expansion (e.g. user providing `${API_KEY}` won't match env var substitution)
fn sanitize_input_value(value: &str) -> String {
    value
        .replace(['\0', '\r', '\u{0085}', '\u{000B}'], "")
        .replace(['\n', '\u{2028}', '\u{2029}'], " ")
        .replace('$', "\\$")
}

/// Curl flags that are dangerous when user input can influence arguments.
///
/// - `-o` / `--output`: write response to arbitrary file path
/// - `-O` / `--remote-name`: write to file named by URL (directory traversal)
/// - `-K` / `--config`: read additional curl options from a file
/// - `-T` / `--upload-file`: upload local files
/// - `--proto`: override our protocol restriction
const BLOCKED_CURL_FLAGS: &[&str] = &[
    "-o", "--output",
    "-O", "--remote-name",
    "-K", "--config",
    "-T", "--upload-file",
    "--proto",
];

/// Validate that resolved curl arguments do not contain dangerous flags.
fn validate_curl_args(args: &[String], tool_name: &str) -> Result<(), AppError> {
    for arg in args {
        let lower = arg.to_ascii_lowercase();
        for blocked in BLOCKED_CURL_FLAGS {
            // Match both exact flags and flags with `=` (e.g. `--output=path`)
            if &lower == blocked || lower.starts_with(&format!("{}=", blocked)) {
                return Err(AppError::Execution(format!(
                    "Tool '{}': blocked dangerous curl flag '{}'",
                    tool_name, arg
                )));
            }
        }
    }
    Ok(())
}

/// Tokenize a command string into arguments, respecting single and double quotes.
///
/// Examples:
/// - `curl -s -H 'Authorization: Bearer tok'` -> `["curl", "-s", "-H", "Authorization: Bearer tok"]`
/// - `curl -d "hello world"` -> `["curl", "-d", "hello world"]`
/// - `curl -sS https://example.com` -> `["curl", "-sS", "https://example.com"]`
fn shell_tokenize(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut in_single_quote = false;
    let mut in_double_quote = false;

    while let Some(ch) = chars.next() {
        match ch {
            '\'' if !in_double_quote => {
                in_single_quote = !in_single_quote;
            }
            '"' if !in_single_quote => {
                in_double_quote = !in_double_quote;
            }
            ' ' | '\t' if !in_single_quote && !in_double_quote => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            '\\' if !in_single_quote => {
                // Consume next char literally
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            _ => {
                current.push(ch);
            }
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

/// Invoke an automation-backed tool via webhook.
///
/// Virtual automation tools use [`VirtualToolId`] to encode the automation ID.
/// Parses the tool ID, extracts the automation_id, and delegates to the runner.
async fn invoke_automation_tool(
    pool: &DbPool,
    tool: &PersonaToolDefinition,
    input_json: &str,
) -> Result<(String, String), AppError> {
    let vtid = VirtualToolId::parse(&tool.id).ok_or_else(|| {
        AppError::Execution(format!(
            "Automation tool '{}' has invalid ID format (expected {}<id>): {}",
            tool.name,
            VirtualToolId::PREFIX,
            tool.id
        ))
    })?;
    let automation_id = vtid.automation_id();

    let automation = automation_repo::get_by_id(pool, automation_id)?;
    let run = invoke_automation(pool, &automation, Some(input_json), None).await?;

    if run.status == crate::db::models::AutomationRunStatus::Completed {
        Ok((
            run.output_data.unwrap_or_default(),
            "automation".to_string(),
        ))
    } else {
        Err(AppError::Execution(format!(
            "Automation '{}' failed: {}",
            tool.name,
            run.error_message.unwrap_or_else(|| "Unknown error".into())
        )))
    }
}

// =============================================================================
// Safe test execution for build draft validation
// =============================================================================

/// Result of testing a single tool against a real API.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolTestResult {
    pub tool_name: String,
    /// "passed" | "failed" | "skipped" | "credential_missing"
    pub status: String,
    pub http_status: Option<u16>,
    pub latency_ms: u64,
    pub error: Option<String>,
    pub connector: Option<String>,
    pub output_preview: Option<String>,
}

/// Construct a temporary `PersonaToolDefinition` from an agent_ir tool JSON entry.
///
/// Handles two formats:
/// 1. **Object**: `{ "name": "notion", "category": "api", ... }` — full tool definition
/// 2. **String**: `"notion"` — shorthand tool name, common in template payloads
///
/// For string entries, the name is used as both the tool name and
/// `requires_credential_type` so credential resolution can match it to a connector.
pub fn tool_def_from_ir(tool: &crate::db::models::agent_ir::AgentIrTool) -> Option<PersonaToolDefinition> {
    use crate::db::models::agent_ir::AgentIrTool;

    let name = tool.name().to_string();
    if name.is_empty() { return None; }

    match tool {
        AgentIrTool::Simple(_) => {
            // Infer credential type from well-known connector prefixes.
            // "notion_database_query" → "notion", "gmail" → "gmail", "data_processing" → None (builtin)
            let known_connectors = ["notion", "gmail", "slack", "github", "airtable", "linear",
                "supabase", "sentry", "asana", "attio", "clickup", "cal_com", "google_calendar",
                "betterstack", "leonardo_ai"];
            let builtin_prefixes = ["personas_", "database", "db_", "file_", "web_", "http_",
                "data_", "nlp_", "ai_", "text_", "notification_", "date_"];
            let name_lower = name.to_lowercase();
            let is_builtin = builtin_prefixes.iter().any(|p| name_lower.starts_with(p));
            let cred_type = if is_builtin {
                None
            } else {
                known_connectors.iter()
                    .find(|c| name_lower == **c || name_lower.starts_with(&format!("{}_", c)))
                    .map(|c| c.to_string())
                    .or_else(|| Some(name.clone()))
            };
            Some(PersonaToolDefinition {
                id: format!("test_{}", name),
                name: name.clone(),
                category: "api".to_string(),
                description: String::new(),
                script_path: String::new(),
                input_schema: None,
                output_schema: None,
                requires_credential_type: cred_type,
                implementation_guide: None,
                is_builtin: false,
                created_at: String::new(),
                updated_at: String::new(),
            })
        }
        AgentIrTool::Structured(d) => {
            Some(PersonaToolDefinition {
                id: format!("test_{}", name),
                name: name.clone(),
                category: d.category.as_deref().unwrap_or("api").to_string(),
                description: d.description.as_deref().unwrap_or("").to_string(),
                script_path: String::new(),
                input_schema: None,
                output_schema: None,
                requires_credential_type: d.requires_credential_type.clone()
                    .or(Some(name)),
                implementation_guide: d.implementation_guide.clone(),
                is_builtin: false,
                created_at: String::new(),
                updated_at: String::new(),
            })
        }
    }
}

/// Execute a CLI-generated curl command with real credential env vars.
///
/// The curl command string comes from the LLM's test_plan and contains
/// `$ENV_VAR` placeholders. We tokenize, substitute placeholders with real
/// credential values, validate, and execute.
///
/// The command is expected to include `-w '\n%{http_code}'` so the HTTP
/// status code appears on the last line of stdout.
pub async fn execute_test_curl(
    curl_command: &str,
    env_map: &HashMap<&str, &str>,
) -> ToolTestResult {
    let start = Instant::now();

    if curl_command.is_empty() {
        return ToolTestResult {
            tool_name: String::new(),
            status: "skipped".to_string(),
            http_status: None,
            latency_ms: 0,
            error: Some("Empty curl command".to_string()),
            connector: None,
            output_preview: None,
        };
    }

    // Tokenize the curl command
    let raw_tokens = shell_tokenize(curl_command);
    if raw_tokens.is_empty() || raw_tokens[0] != "curl" {
        return ToolTestResult {
            tool_name: String::new(),
            status: "failed".to_string(),
            http_status: None,
            latency_ms: 0,
            error: Some(format!("Invalid curl command: must start with 'curl', got: {:?}", raw_tokens.first())),
            connector: None,
            output_preview: None,
        };
    }

    // Substitute $ENV_VAR placeholders with real credential values.
    // Use resolve_placeholders (same two-pass approach as invoke_api) to
    // prevent cross-expansion where one env var value contains ${OTHER_VAR}.
    let resolved_tokens: Vec<String> = raw_tokens[1..]
        .iter()
        .map(|token| resolve_placeholders(token, env_map, None))
        .collect();

    // Validate against dangerous flags
    if let Err(e) = validate_curl_args(&resolved_tokens, "test") {
        return ToolTestResult {
            tool_name: String::new(),
            status: "failed".to_string(),
            http_status: None,
            latency_ms: 0,
            error: Some(e.to_string()),
            connector: None,
            output_preview: None,
        };
    }

    // Execute with test timeout
    let mut cmd = tokio::process::Command::new("curl");
    cmd.arg("--proto").arg("=https,http");
    for token in &resolved_tokens {
        cmd.arg(token);
    }
    for (k, v) in env_map {
        cmd.env(k, v);
    }
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let result = tokio::time::timeout(TEST_TOOL_TIMEOUT, cmd.output()).await;
    let latency_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            // Try to extract HTTP status code from last line (from -w '%{http_code}')
            let (body, http_code) = extract_http_code_from_output(&stdout);

            let preview = if body.len() > 300 {
                format!("{}...", &body[..300])
            } else {
                body.to_string()
            };

            if output.status.success() {
                // Curl succeeded (exit code 0), but check HTTP status
                let status = match http_code {
                    Some(code) if (200..300).contains(&code) => "passed",
                    Some(401 | 403) => "failed",
                    Some(404) => "failed",
                    Some(429) => "failed",
                    Some(code) if code >= 500 => "failed",
                    Some(_) => "failed",
                    None => "passed", // no -w flag, curl succeeded = assume OK
                };
                ToolTestResult {
                    tool_name: String::new(),
                    status: status.to_string(),
                    http_status: http_code,
                    latency_ms,
                    error: if status == "passed" { None } else { Some(preview.clone()) },
                    connector: None,
                    output_preview: Some(preview),
                }
            } else {
                let msg = if stderr.is_empty() { &stdout } else { &stderr };
                let (_, code) = classify_api_error(msg);
                ToolTestResult {
                    tool_name: String::new(),
                    status: "failed".to_string(),
                    http_status: code,
                    latency_ms,
                    error: Some(msg.trim().to_string()),
                    connector: None,
                    output_preview: if !preview.is_empty() { Some(preview) } else { None },
                }
            }
        }
        Ok(Err(e)) => ToolTestResult {
            tool_name: String::new(),
            status: "failed".to_string(),
            http_status: None,
            latency_ms,
            error: Some(format!("Failed to execute curl: {e}")),
            connector: None,
            output_preview: None,
        },
        Err(_) => ToolTestResult {
            tool_name: String::new(),
            status: "failed".to_string(),
            http_status: None,
            latency_ms,
            error: Some(format!("Curl timed out after {}s", TEST_TOOL_TIMEOUT.as_secs())),
            connector: None,
            output_preview: None,
        },
    }
}

/// Extract the HTTP status code from curl output that used `-w '%{http_code}'`.
/// Returns (body_without_status, Optional<status_code>).
fn extract_http_code_from_output(stdout: &str) -> (&str, Option<u16>) {
    let trimmed = stdout.trim_end();
    // The HTTP status code is on the last line (from -w '\n%{http_code}')
    if let Some(last_newline) = trimmed.rfind('\n') {
        let last_line = trimmed[last_newline + 1..].trim();
        if let Ok(code) = last_line.parse::<u16>() {
            if (100..=599).contains(&code) {
                return (&trimmed[..last_newline], Some(code));
            }
        }
    }
    // Maybe the entire output IS just the status code (empty body)
    if let Ok(code) = trimmed.parse::<u16>() {
        if (100..=599).contains(&code) {
            return ("", Some(code));
        }
    }
    (stdout, None)
}

/// Classify an API error message to determine the failure category and HTTP status code.
fn classify_api_error(error_msg: &str) -> (&'static str, Option<u16>) {
    // Try to extract HTTP status code from curl exit message
    // Format: "Curl exited with exit status: N: <body>"
    if let Some(body) = error_msg.strip_prefix("Curl exited with ") {
        // Look for common HTTP error patterns in the body
        if body.contains("401") || body.contains("Unauthorized") {
            return ("failed", Some(401));
        }
        if body.contains("403") || body.contains("Forbidden") {
            return ("failed", Some(403));
        }
        if body.contains("404") || body.contains("Not Found") {
            return ("failed", Some(404));
        }
        if body.contains("429") || body.contains("Too Many Requests") || body.contains("rate limit") {
            return ("failed", Some(429));
        }
        if body.contains("500") || body.contains("Internal Server Error") {
            return ("failed", Some(500));
        }
        if body.contains("502") || body.contains("503") || body.contains("504") {
            return ("failed", Some(503));
        }
    }
    ("failed", None)
}

/// Extract the curl command from an implementation_guide string.
/// Looks for a line starting with "Curl:" and returns everything after it.
fn extract_curl_line(guide: &str) -> Option<&str> {
    for segment in guide.split("\\n") {
        let trimmed = segment.trim();
        if let Some(rest) = trimmed.strip_prefix("Curl:") {
            let cmd = rest.trim();
            if !cmd.is_empty() {
                return Some(cmd);
            }
        }
    }
    // Also try real newlines (in case guide has actual newlines)
    for line in guide.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Curl:") {
            let cmd = rest.trim();
            if !cmd.is_empty() {
                return Some(cmd);
            }
        }
    }
    None
}
