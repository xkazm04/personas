use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::PersonaToolDefinition;
use crate::db::repos::resources::automations as automation_repo;
use crate::db::DbPool;
use crate::engine::automation_runner::invoke_automation;
use crate::error::AppError;

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
/// substitutes `$ENV_VAR` placeholders with resolved credential values, and executes via shell.
pub async fn invoke_tool_direct(
    pool: &DbPool,
    tool: &PersonaToolDefinition,
    persona_id: &str,
    persona_name: &str,
    input_json: &str,
) -> Result<ToolInvocationResult, AppError> {
    let start = Instant::now();

    // Resolve credential env vars using the existing runner infrastructure
    let (env_vars, _hints) =
        super::runner::resolve_credential_env_vars(pool, &[tool.clone()], persona_id, persona_name)
            .await;

    let env_map: HashMap<&str, &str> = env_vars
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    let result = if tool.category == "automation" {
        invoke_automation_tool(pool, tool, input_json).await
    } else if !tool.script_path.is_empty() {
        invoke_script(tool, input_json, &env_map).await
    } else if let Some(ref guide) = tool.implementation_guide {
        invoke_api(tool, guide, input_json, &env_map).await
    } else {
        Err(AppError::Execution(format!(
            "Tool '{}' has no script_path and no implementation_guide — cannot invoke directly",
            tool.name
        )))
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok((output, tool_type)) => Ok(ToolInvocationResult {
            success: true,
            output,
            error: None,
            duration_ms,
            tool_name: tool.name.clone(),
            tool_type,
        }),
        Err(e) => {
            let tool_type = if !tool.script_path.is_empty() {
                "script"
            } else {
                "api"
            };
            Ok(ToolInvocationResult {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
                duration_ms,
                tool_name: tool.name.clone(),
                tool_type: tool_type.to_string(),
            })
        }
    }
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
async fn invoke_api(
    tool: &PersonaToolDefinition,
    guide: &str,
    input_json: &str,
    env_map: &HashMap<&str, &str>,
) -> Result<(String, String), AppError> {
    let curl_line = extract_curl_line(guide).ok_or_else(|| {
        AppError::Execution(format!(
            "Tool '{}' implementation_guide has no 'Curl:' line — cannot invoke directly",
            tool.name
        ))
    })?;

    // Substitute $ENV_VAR placeholders with resolved credential values
    let mut resolved_curl = curl_line.to_string();
    for (k, v) in env_map {
        resolved_curl = resolved_curl.replace(&format!("${k}"), v);
        resolved_curl = resolved_curl.replace(&format!("${{{k}}}"), v);
    }

    // Also substitute input parameters from the JSON
    if let Ok(input_val) = serde_json::from_str::<serde_json::Value>(input_json) {
        if let Some(obj) = input_val.as_object() {
            for (key, val) in obj {
                let val_str = match val {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                resolved_curl = resolved_curl.replace(&format!("${{{key}}}"), &val_str);
                resolved_curl = resolved_curl.replace(&format!("${key}"), &val_str);
            }
        }
    }

    // Execute the resolved curl command
    let shell = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
    let flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };

    let mut cmd = tokio::process::Command::new(shell);
    cmd.arg(flag).arg(&resolved_curl);

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
