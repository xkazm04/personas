//! Auto-credential browser automation via Claude CLI with Playwright MCP.
//!
//! Spawns Claude CLI with the `@anthropic/claude-code-playwright` MCP adapter
//! and a prompt instructing it to navigate the connector's dashboard, create
//! API credentials, and extract the resulting values.
//!
//! Progress events are emitted to the frontend so the UI can display a live
//! log of browser actions.

use std::sync::{Arc, Mutex};

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
    /// True when values were salvaged via partial extraction (not all fields found).
    pub partial: bool,
}

/// Structured error info serialized as JSON in the Err(String) variant.
#[derive(Debug, Serialize)]
pub struct AutoCredErrorInfo {
    pub kind: String,
    pub message: String,
    pub guidance: String,
    pub retryable: bool,
    pub context: Option<SessionContext>,
}

/// Last-mile context captured during the browser session.
#[derive(Debug, Clone, Serialize, Default)]
pub struct SessionContext {
    pub last_url: Option<String>,
    pub last_actions: Vec<String>,
    pub tool_call_count: u32,
    pub duration_secs: Option<f64>,
    pub had_waiting_prompt: bool,
}

fn structured_error(
    kind: &str,
    message: &str,
    guidance: &str,
    retryable: bool,
    ctx: Option<SessionContext>,
) -> String {
    serde_json::to_string(&AutoCredErrorInfo {
        kind: kind.to_string(),
        message: message.to_string(),
        guidance: guidance.to_string(),
        retryable,
        context: ctx,
    })
    .unwrap_or_else(|_| message.to_string())
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

    // Add Playwright MCP server configuration via secure temp file.
    // _mcp_config_file must stay alive until spawn_claude_and_collect returns —
    // dropping it auto-deletes the temp file.
    let _mcp_config_file = build_playwright_mcp_config()?;
    cli_args.args.push("--mcp-config".to_string());
    cli_args.args.push(_mcp_config_file.path().to_string_lossy().to_string());

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

    // Collect field keys for partial extraction fallback
    let field_keys: Vec<String> = request.fields.iter().map(|f| f.key.clone()).collect();

    let app_clone = app.clone();
    let sid = session_id.clone();

    // Session context accumulator — shared with the streaming callback
    let ctx_acc = Arc::new(Mutex::new(SessionContext::default()));
    let ctx_ref = Arc::clone(&ctx_acc);

    let result = spawn_claude_and_collect(
        &cli_args,
        prompt,
        BROWSER_TIMEOUT_SECS,
        |line_type, raw| {
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
                        let msg_type = if trimmed.starts_with("WAITING:") {
                            if let Ok(mut ctx) = ctx_ref.lock() {
                                ctx.had_waiting_prompt = true;
                            }
                            "warning"
                        } else {
                            "action"
                        };
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
                        _ => "Working...",
                    };

                    // Track context
                    if let Ok(mut ctx) = ctx_ref.lock() {
                        ctx.tool_call_count += 1;
                        // Keep last 5 actions
                        if ctx.last_actions.len() >= 5 {
                            ctx.last_actions.remove(0);
                        }
                        ctx.last_actions.push(action.to_string());

                        // Extract URL from navigate tool calls
                        if tool_name == "mcp__playwright__browser_navigate" {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) {
                                if let Some(url) = parsed
                                    .pointer("/tool_use/input/url")
                                    .or_else(|| parsed.pointer("/input/url"))
                                    .and_then(|v| v.as_str())
                                {
                                    ctx.last_url = Some(url.to_string());
                                }
                            }
                        }
                    }

                    let _ = app_clone.emit(PROGRESS_EVENT, json!({
                        "session_id": sid,
                        "type": "action",
                        "message": action,
                    }));
                }
                StreamLineType::Result { duration_ms, total_cost_usd, .. } => {
                    if let Some(ms) = duration_ms {
                        if let Ok(mut ctx) = ctx_ref.lock() {
                            ctx.duration_secs = Some(*ms as f64 / 1000.0);
                        }
                    }
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

    // Snapshot the accumulated session context
    let session_ctx = ctx_acc.lock().ok().map(|g| g.clone());

    match result {
        Err(error_msg) => {
            // Classify the spawn error
            let (kind, guidance, retryable) = if error_msg.contains("CLI not found") {
                ("cli_not_found", "Install Claude CLI from https://docs.anthropic.com/en/docs/claude-code", false)
            } else if error_msg.contains("timed out after") {
                ("timeout", "The browser session exceeded 5 minutes. The page may require manual interaction or the service is slow. Try again or set up manually.", true)
            } else if error_msg.contains("conflicting CLAUDECODE") {
                ("env_conflict", "Restart the app to clear the environment conflict, then try again.", false)
            } else if error_msg.contains("exited with error") {
                ("cli_error", "Claude CLI encountered an error. Check that your API key is valid and you have available credits.", true)
            } else {
                ("spawn_failed", "Could not start the Claude CLI process. Verify it is installed and accessible.", false)
            };

            let err = structured_error(kind, &error_msg, guidance, retryable, session_ctx);
            let _ = app.emit(STATUS_EVENT, json!({
                "session_id": session_id,
                "status": "failed",
                "error": &err,
            }));
            Err(err)
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
                        partial: false,
                    })
                }
                None => {
                    // Attempt partial extraction before giving up
                    if let Some(partial_values) = extract_partial_values(&spawn_result.text_output, &field_keys) {
                        tracing::info!(
                            session_id = %session_id,
                            found_keys = ?partial_values.as_object().map(|m| m.len()).unwrap_or(0),
                            "Partial extraction recovered some values"
                        );
                        let _ = app.emit(STATUS_EVENT, json!({
                            "session_id": session_id,
                            "status": "completed",
                        }));
                        Ok(AutoCredBrowserResult {
                            session_id,
                            extracted_values: partial_values,
                            procedure_log: String::new(),
                            partial: true,
                        })
                    } else {
                        let err = structured_error(
                            "extraction_failed",
                            "Failed to extract credential values from browser session output.",
                            "The browser completed but couldn't produce the expected credentials. The service may require manual steps (CAPTCHA, 2FA, paid plan). Try setting up manually.",
                            true,
                            session_ctx,
                        );
                        let _ = app.emit(STATUS_EVENT, json!({
                            "session_id": session_id,
                            "status": "failed",
                            "error": &err,
                        }));
                        tracing::warn!(
                            session_id = %session_id,
                            output_len = spawn_result.text_output.len(),
                            "Failed to extract auto-cred browser result"
                        );
                        Err(err)
                    }
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
///
/// Returns a `NamedTempFile` with a random filename. The caller MUST keep this
/// handle alive until the CLI process finishes — dropping it deletes the file,
/// preventing stale credential configs from lingering on disk.
fn build_playwright_mcp_config() -> Result<tempfile::NamedTempFile, String> {
    use std::io::Write;

    let config = json!({
        "mcpServers": {
            "playwright": {
                "command": "npx",
                "args": ["@anthropic-ai/mcp-playwright@latest"],
                "type": "stdio"
            }
        }
    });

    let mut tmp = tempfile::Builder::new()
        .prefix("personas_mcp_")
        .suffix(".json")
        .tempfile()
        .map_err(|e| format!("Failed to create temp MCP config: {e}"))?;

    tmp.write_all(
        serde_json::to_string_pretty(&config)
            .unwrap()
            .as_bytes(),
    )
    .map_err(|e| format!("Failed to write temp MCP config: {e}"))?;

    tmp.flush()
        .map_err(|e| format!("Failed to flush temp MCP config: {e}"))?;

    Ok(tmp)
}

/// Best-effort partial extraction: scan text for any field values even without
/// a proper `extracted_values` JSON block.
fn extract_partial_values(text: &str, field_keys: &[String]) -> Option<serde_json::Value> {
    let mut found = serde_json::Map::new();

    // Strategy 1: Find any JSON objects and check for matching keys
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') {
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if let Some(map) = obj.as_object() {
                    for key in field_keys {
                        if found.contains_key(key) {
                            continue;
                        }
                        if let Some(val) = map.get(key) {
                            if let Some(s) = val.as_str() {
                                if !s.is_empty() {
                                    found.insert(
                                        key.clone(),
                                        serde_json::Value::String(s.to_string()),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Strategy 2: Look for "key": "value" patterns in the full text
    for key in field_keys {
        if found.contains_key(key) {
            continue;
        }
        let pattern = format!("\"{}\"", key);
        if let Some(pos) = text.find(&pattern) {
            let after = &text[pos + pattern.len()..];
            if let Some(colon_pos) = after.find(':') {
                let value_area = after[colon_pos + 1..].trim_start();
                if value_area.starts_with('"') {
                    if let Some(end_quote) = value_area[1..].find('"') {
                        let val = &value_area[1..1 + end_quote];
                        if !val.is_empty() {
                            found.insert(
                                key.clone(),
                                serde_json::Value::String(val.to_string()),
                            );
                        }
                    }
                }
            }
        }
    }

    if found.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(found))
    }
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
