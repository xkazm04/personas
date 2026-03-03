//! Auto-credential browser automation via Claude CLI with Playwright MCP.
//!
//! Spawns Claude CLI with the `@anthropic/claude-code-playwright` MCP adapter
//! and a prompt instructing it to navigate the connector's dashboard, create
//! API credentials, and extract the resulting values.
//!
//! Progress events are emitted to the frontend so the UI can display a live
//! log of browser actions.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Emitter, State};

use crate::commands::credentials::ai_artifact_flow::spawn_claude_and_collect;
use crate::engine::prompt::build_cli_args;
use crate::engine::types::StreamLineType;
use crate::AppState;

/// Event names for auto-cred browser progress.
const STATUS_EVENT: &str = "auto-cred-browser-status";
const PROGRESS_EVENT: &str = "auto-cred-browser-progress";

/// Model for browser automation tasks — needs tool use capabilities.
const BROWSER_MODEL: &str = "claude-sonnet-4-6";

/// Timeout for browser automation (5 minutes — browser work is slow).
const BROWSER_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Deserialize)]
pub struct AutoCredBrowserRequest {
    pub session_id: String,
    pub connector_name: String,
    pub connector_label: String,
    pub docs_url: Option<String>,
    pub setup_instructions: Option<String>,
    pub fields: Vec<AutoCredField>,
    /// If provided, replay this saved procedure instead of discovering fresh.
    pub saved_procedure: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AutoCredField {
    pub key: String,
    pub label: String,
    pub field_type: String,
    pub required: bool,
    pub placeholder: Option<String>,
    pub help_text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AutoCredBrowserResult {
    pub session_id: String,
    pub extracted_values: serde_json::Value,
    pub procedure_log: String,
}

/// Build the prompt for Claude to drive Playwright and extract credentials.
fn build_browser_prompt(req: &AutoCredBrowserRequest) -> String {
    let fields_desc: Vec<String> = req.fields.iter().map(|f| {
        let mut desc = format!("- `{}` ({})", f.key, f.label);
        if f.required { desc.push_str(" [REQUIRED]"); }
        if let Some(ref ph) = f.placeholder { desc.push_str(&format!(" placeholder: {}", ph)); }
        if let Some(ref ht) = f.help_text { desc.push_str(&format!(" — {}", ht)); }
        desc
    }).collect();

    let docs_section = if let Some(ref url) = req.docs_url {
        format!("Start by navigating to: {}", url)
    } else {
        format!("Find the {} developer/API settings page.", req.connector_label)
    };

    let instructions_section = if let Some(ref instructions) = req.setup_instructions {
        format!("\n## Setup Instructions\n{}\n", instructions)
    } else {
        String::new()
    };

    let procedure_section = if let Some(ref procedure) = req.saved_procedure {
        format!("\n## Saved Procedure (follow these exact steps)\n{}\n", procedure)
    } else {
        String::new()
    };

    format!(
r#"You are an automated credential setup assistant. Your job is to use the Playwright browser tools to create API credentials for {connector_label} ({connector_name}).

## Goal
Navigate to the {connector_label} API/developer dashboard, create a new API key or credential, and extract the generated values.

## Starting Point
{docs_section}
{instructions_section}{procedure_section}
## Required Fields to Extract
{fields}

## Instructions
1. Use `mcp__playwright__browser_navigate` to open the starting URL.
2. Use `mcp__playwright__browser_snapshot` to read the page content.
3. Navigate through the credential creation flow using `mcp__playwright__browser_click` and `mcp__playwright__browser_type` as needed.
4. When you encounter a login page, CAPTCHA, or 2FA prompt, output a message like "WAITING: Login required — please authenticate in the browser" and use `mcp__playwright__browser_wait_for_navigation` to wait for the user.
5. After creating the credential, extract all field values.
6. Output the final result as a JSON object with exactly this format:

```json
{{
  "extracted_values": {{
    "field_key": "extracted_value",
    ...
  }},
  "procedure_log": "Step-by-step description of what was done"
}}
```

IMPORTANT:
- Output ONLY the JSON block at the end, no other text after it.
- If a field value is not available, use an empty string.
- Be methodical: snapshot the page before and after each action.
- If you hit a dead end, try alternative navigation paths.
"#,
        connector_label = req.connector_label,
        connector_name = req.connector_name,
        docs_section = docs_section,
        instructions_section = instructions_section,
        procedure_section = procedure_section,
        fields = fields_desc.join("\n"),
    )
}

/// Start a browser automation session to create credentials.
#[tauri::command]
pub async fn start_auto_cred_browser(
    app: tauri::AppHandle,
    _state: State<'_, Arc<AppState>>,
    request: AutoCredBrowserRequest,
) -> Result<AutoCredBrowserResult, String> {
    let session_id = request.session_id.clone();

    // Build CLI args with Playwright MCP
    let mut cli_args = build_cli_args(None, None);

    // Override model
    if !cli_args.args.iter().any(|a| a == "--model") {
        cli_args.args.push("--model".to_string());
        cli_args.args.push(BROWSER_MODEL.to_string());
    }

    // Add Playwright MCP server configuration
    cli_args.args.push("--mcp-config".to_string());
    cli_args.args.push(build_playwright_mcp_config());

    // Restrict to only Playwright tools
    cli_args.args.push("--allowedTools".to_string());
    cli_args.args.push("mcp__playwright__*".to_string());

    let prompt = build_browser_prompt(&request);

    // Emit initial status
    let _ = app.emit(STATUS_EVENT, json!({
        "session_id": session_id,
        "status": "running",
    }));
    let _ = app.emit(PROGRESS_EVENT, json!({
        "session_id": session_id,
        "type": "info",
        "message": format!("Starting browser automation for {}...", request.connector_label),
    }));

    let app_clone = app.clone();
    let sid = session_id.clone();

    let result = spawn_claude_and_collect(
        &cli_args,
        prompt,
        BROWSER_TIMEOUT_SECS,
        |line_type, _raw| {
            match line_type {
                StreamLineType::SystemInit { model, .. } => {
                    let _ = app_clone.emit(PROGRESS_EVENT, json!({
                        "session_id": sid,
                        "type": "info",
                        "message": format!("Connected to Claude ({})", model),
                    }));
                }
                StreamLineType::AssistantText { text } => {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        // Check for waiting/user-action messages
                        let msg_type = if trimmed.starts_with("WAITING:") { "warning" } else { "action" };
                        let _ = app_clone.emit(PROGRESS_EVENT, json!({
                            "session_id": sid,
                            "type": msg_type,
                            "message": trimmed,
                        }));
                    }
                }
                StreamLineType::AssistantToolUse { tool_name, .. } => {
                    let action = match tool_name.as_str() {
                        "mcp__playwright__browser_navigate" => "Navigating...",
                        "mcp__playwright__browser_snapshot" => "Reading page...",
                        "mcp__playwright__browser_click" => "Clicking element...",
                        "mcp__playwright__browser_type" => "Typing text...",
                        "mcp__playwright__browser_wait_for_navigation" => "Waiting for page load...",
                        _ => &format!("Tool: {}", tool_name),
                    };
                    let _ = app_clone.emit(PROGRESS_EVENT, json!({
                        "session_id": sid,
                        "type": "action",
                        "message": action,
                    }));
                }
                StreamLineType::Result { duration_ms, total_cost_usd, .. } => {
                    let mut msg = "Browser session complete".to_string();
                    if let Some(ms) = duration_ms {
                        let secs = *ms as f64 / 1000.0;
                        msg = format!("Browser session complete ({:.1}s", secs);
                        if let Some(cost) = total_cost_usd {
                            msg.push_str(&format!(", ${:.4}", cost));
                        }
                        msg.push(')');
                    }
                    let _ = app_clone.emit(PROGRESS_EVENT, json!({
                        "session_id": sid,
                        "type": "info",
                        "message": msg,
                    }));
                }
                _ => {}
            }
        },
        None,
    )
    .await;

    match result {
        Err(error_msg) => {
            let _ = app.emit(STATUS_EVENT, json!({
                "session_id": session_id,
                "status": "failed",
                "error": error_msg,
            }));
            Err(error_msg)
        }
        Ok(spawn_result) => {
            // Try to extract JSON from the output
            match extract_browser_result(&spawn_result.text_output) {
                Some((values, procedure_log)) => {
                    let _ = app.emit(STATUS_EVENT, json!({
                        "session_id": session_id,
                        "status": "completed",
                    }));
                    Ok(AutoCredBrowserResult {
                        session_id,
                        extracted_values: values,
                        procedure_log,
                    })
                }
                None => {
                    let err = "Failed to extract credential values from browser session output.";
                    let _ = app.emit(STATUS_EVENT, json!({
                        "session_id": session_id,
                        "status": "failed",
                        "error": err,
                    }));
                    tracing::warn!(
                        session_id = %session_id,
                        output_len = spawn_result.text_output.len(),
                        "Failed to extract auto-cred browser result"
                    );
                    Err(err.to_string())
                }
            }
        }
    }
}

/// Save a playwright procedure for a connector type.
#[tauri::command]
pub async fn save_playwright_procedure(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
    procedure_json: String,
    field_keys: String,
) -> Result<serde_json::Value, String> {
    let proc = crate::db::repos::resources::playwright_procedures::save(
        &state.db,
        &connector_name,
        &procedure_json,
        &field_keys,
    ).map_err(|e| e.to_string())?;

    Ok(json!({
        "id": proc.id,
        "connector_name": proc.connector_name,
        "is_active": proc.is_active,
    }))
}

/// Get the active playwright procedure for a connector.
#[tauri::command]
pub async fn get_playwright_procedure(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
) -> Result<Option<serde_json::Value>, String> {
    let proc = crate::db::repos::resources::playwright_procedures::get_active(
        &state.db,
        &connector_name,
    ).map_err(|e| e.to_string())?;

    Ok(proc.map(|p| json!({
        "id": p.id,
        "connector_name": p.connector_name,
        "procedure_json": p.procedure_json,
        "field_keys": p.field_keys,
        "is_active": p.is_active,
        "created_at": p.created_at,
    })))
}

/// Build a temporary MCP config JSON for the Playwright server.
/// Claude CLI accepts `--mcp-config <path>` pointing to a JSON file.
/// We write a temp file and return its path.
fn build_playwright_mcp_config() -> String {
    let config = json!({
        "mcpServers": {
            "playwright": {
                "command": "npx",
                "args": ["@anthropic-ai/mcp-playwright@latest"],
                "type": "stdio"
            }
        }
    });

    // Write to a temp file
    let temp_dir = std::env::temp_dir();
    let config_path = temp_dir.join("personas_playwright_mcp.json");
    let _ = std::fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap());
    config_path.to_string_lossy().to_string()
}

/// Extract the JSON result from Claude's text output.
/// Looks for a JSON block containing `extracted_values`.
fn extract_browser_result(text: &str) -> Option<(serde_json::Value, String)> {
    // Try to find a JSON block in the output
    // Look for ```json ... ``` blocks first
    if let Some(start) = text.find("```json") {
        let json_start = start + 7;
        if let Some(end) = text[json_start..].find("```") {
            let json_str = text[json_start..json_start + end].trim();
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(values) = parsed.get("extracted_values") {
                    let log = parsed.get("procedure_log")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    return Some((values.clone(), log));
                }
            }
        }
    }

    // Fallback: try to find raw JSON with extracted_values
    for line in text.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && trimmed.contains("extracted_values") {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if let Some(values) = parsed.get("extracted_values") {
                    let log = parsed.get("procedure_log")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    return Some((values.clone(), log));
                }
            }
        }
    }

    // Last resort: try to parse the entire output as JSON
    let trimmed = text.trim();
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(values) = parsed.get("extracted_values") {
            let log = parsed.get("procedure_log")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            return Some((values.clone(), log));
        }
    }

    None
}
