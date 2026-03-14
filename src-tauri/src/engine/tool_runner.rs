use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{PersonaToolDefinition, ToolKind};
use crate::db::repos::resources::automations as automation_repo;
use crate::db::repos::resources::tool_audit_log;
use crate::db::DbPool;
use crate::engine::automation_runner::invoke_automation;
use crate::engine::rate_limiter::{RateLimiter, TOOL_EXECUTION_MAX_PER_MINUTE, TOOL_EXECUTION_WINDOW};
use crate::error::AppError;

/// Default timeout for direct tool invocations (script and API calls).
const DIRECT_TOOL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

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

    let kind = tool.tool_kind().map_err(|msg| AppError::Execution(msg))?;

    let result = match kind {
        ToolKind::Automation => {
            tokio::time::timeout(DIRECT_TOOL_TIMEOUT, invoke_automation_tool(pool, tool, input_json))
                .await
                .map_err(|_| AppError::Execution(format!(
                    "Tool '{}' timed out after {}s",
                    tool.name, DIRECT_TOOL_TIMEOUT.as_secs()
                )))?
        }
        ToolKind::Script => {
            tokio::time::timeout(DIRECT_TOOL_TIMEOUT, invoke_script(tool, input_json, &env_map))
                .await
                .map_err(|_| AppError::Execution(format!(
                    "Tool '{}' timed out after {}s",
                    tool.name, DIRECT_TOOL_TIMEOUT.as_secs()
                )))?
        }
        ToolKind::Api => {
            let guide = tool.implementation_guide.as_ref().unwrap();
            tokio::time::timeout(DIRECT_TOOL_TIMEOUT, invoke_api(tool, guide, input_json, &env_map))
                .await
                .map_err(|_| AppError::Execution(format!(
                    "Tool '{}' timed out after {}s",
                    tool.name, DIRECT_TOOL_TIMEOUT.as_secs()
                )))?
        }
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

    // Substitute placeholders in each token individually.
    // Each token becomes a separate process argument so shell metacharacters
    // (;, |, &&, $(...), etc.) have no effect.
    let resolved_tokens: Vec<String> = raw_tokens[1..]
        .iter()
        .map(|token| resolve_placeholders(token, env_map, input_json))
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
    input_json: &str,
) -> String {
    let mut resolved = token.to_string();

    // 1. Substitute input parameters FIRST (user-controlled values).
    //    Sanitize values to strip null bytes and CRLF sequences that could be
    //    used for header injection in HTTP requests.
    if let Ok(input_val) = serde_json::from_str::<serde_json::Value>(input_json) {
        if let Some(obj) = input_val.as_object() {
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
/// Virtual automation tools have IDs in the form `auto_{automation_id}`.
/// Extracts the automation_id, loads the automation, and delegates to the runner.
async fn invoke_automation_tool(
    pool: &DbPool,
    tool: &PersonaToolDefinition,
    input_json: &str,
) -> Result<(String, String), AppError> {
    // Virtual tool IDs follow the pattern "auto_{automation_id}"
    let automation_id = tool
        .id
        .strip_prefix("auto_")
        .ok_or_else(|| {
            AppError::Execution(format!(
                "Automation tool '{}' has invalid ID format (expected auto_<id>): {}",
                tool.name, tool.id
            ))
        })?;

    let automation = automation_repo::get_by_id(pool, automation_id)?;
    let run = invoke_automation(pool, &automation, Some(input_json), None).await?;

    if run.status == "completed" {
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
