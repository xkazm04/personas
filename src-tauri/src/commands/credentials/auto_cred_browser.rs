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
use tauri::{Emitter, Manager, State};
use ts_rs::TS;

use crate::commands::credentials::ai_artifact_flow::spawn_claude_and_collect;
use crate::engine::prompt::build_cli_args;
use crate::engine::types::StreamLineType;
use crate::ipc_auth::require_privileged;
use crate::AppState;

/// Event names for auto-cred browser progress.
const STATUS_EVENT: &str = "auto-cred-browser-status";
const PROGRESS_EVENT: &str = "auto-cred-browser-progress";

/// Event emitted when a URL should be opened in the user's browser.
const OPEN_URL_EVENT: &str = "auto-cred-open-url";

/// Model for browser automation tasks -- needs tool use capabilities.
const BROWSER_MODEL: &str = "claude-sonnet-4-6";

/// Timeout for browser automation (5 minutes -- browser work is slow).
const BROWSER_TIMEOUT_SECS: u64 = 300;

/// Timeout for guided mode (8 minutes -- user interacts manually).
const GUIDED_TIMEOUT_SECS: u64 = 480;

/// Protocol prefix: when Claude outputs `OPEN_URL:https://...`, the frontend opens it.
const OPEN_URL_PREFIX: &str = "OPEN_URL:";

/// Protocol prefix: when Claude needs user input during guided mode.
const USER_INPUT_PREFIX: &str = "USER_INPUT:";

/// Maximum number of tool invocations per session to prevent infinite loops
/// from a misbehaving MCP server or looping browser automation.
const MAX_TOOL_INVOCATIONS: u32 = 500;

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct AutoCredBrowserRequest {
    pub session_id: String,
    pub connector_name: String,
    pub connector_label: String,
    pub docs_url: Option<String>,
    pub setup_instructions: Option<String>,
    pub fields: Vec<AutoCredField>,
    /// If provided, replay this saved procedure instead of discovering fresh.
    pub saved_procedure: Option<String>,
    /// Force guided mode even if Playwright is available.
    pub force_guided: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct AutoCredField {
    pub key: String,
    pub label: String,
    #[allow(dead_code)]
    pub field_type: String,
    pub required: bool,
    pub placeholder: Option<String>,
    pub help_text: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
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
    /// Last meaningful assistant text -- used to derive better error messages.
    pub last_assistant_text: Option<String>,
}

/// Tracks emitted log messages to prevent duplicates in the browser session UI.
///
/// Claude CLI `stream-json` sends cumulative `assistant` events -- each contains
/// ALL text from the current turn, not just the delta. This tracker computes
/// deltas so the UI only receives new content.
#[derive(Default)]
struct StreamDedup {
    /// Full assistant text accumulated in the current turn.
    /// Reset when a non-AssistantText event arrives (tool use, tool result, etc.).
    assistant_text_acc: String,
    /// Whether we've emitted the SystemInit event already.
    system_init_emitted: bool,
}

impl StreamDedup {
    /// Given a new cumulative assistant text from stream-json, return only the
    /// NEW portion (delta) that hasn't been emitted yet. Returns None if there's
    /// nothing new.
    fn assistant_delta(&mut self, full_text: &str) -> Option<String> {
        let trimmed = full_text.trim();
        if trimmed.is_empty() {
            return None;
        }

        // If the new text starts with what we've accumulated, extract the delta
        if trimmed.starts_with(&self.assistant_text_acc) {
            let delta = trimmed[self.assistant_text_acc.len()..].trim_start();
            if delta.is_empty() {
                return None; // exact duplicate
            }
            self.assistant_text_acc = trimmed.to_string();
            return Some(delta.to_string());
        }

        // If the accumulated text starts with the new text, it's a subset -> skip
        if self.assistant_text_acc.starts_with(trimmed) {
            return None;
        }

        // Completely new text (new turn or different content) -- emit all and reset
        self.assistant_text_acc = trimmed.to_string();
        Some(trimmed.to_string())
    }

    /// Reset the assistant text accumulator (call when the turn changes,
    /// e.g. after tool results).
    fn reset_turn(&mut self) {
        self.assistant_text_acc.clear();
    }

    /// Check and mark SystemInit as emitted. Returns true the first time only.
    fn should_emit_system_init(&mut self) -> bool {
        if self.system_init_emitted {
            return false;
        }
        self.system_init_emitted = true;
        true
    }

    /// Check whether a log message should be emitted (dedup by exact string within a turn).
    /// Returns true the first time a given message is seen, false on duplicates.
    /// Reset via `reset_turn`.
    #[cfg(test)]
    fn should_emit_message(&mut self, msg: &str) -> bool {
        // Reuse assistant_delta: if the message is new content, emit it.
        self.assistant_delta(msg).is_some()
    }
}

/// Write a subprocess crash/error report to the crash_logs directory so it
/// appears in System Checks -> Crash Logs alongside Rust panics.
fn write_subprocess_crash_report(
    app: &tauri::AppHandle,
    session_id: &str,
    connector: &str,
    mode: &AutoCredMode,
    error_kind: &str,
    error_msg: &str,
    ctx: Option<&SessionContext>,
) {
    let crash_dir = match app.path().app_data_dir() {
        Ok(dir) => dir.join("crash_logs"),
        Err(_) => return,
    };
    let _ = std::fs::create_dir_all(&crash_dir);

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let path = crash_dir.join(format!("autocred_{timestamp}.log"));

    let mut report = format!(
        "=== AUTO-CRED SESSION CRASH ===\n\
         Time: {}\n\
         Version: {}\n\
         Session: {}\n\
         Connector: {}\n\
         Mode: {:?}\n\
         Error Kind: {}\n\n\
         Error:\n{}\n",
        chrono::Local::now().to_rfc3339(),
        env!("CARGO_PKG_VERSION"),
        session_id,
        connector,
        mode,
        error_kind,
        error_msg,
    );

    if let Some(ctx) = ctx {
        report.push_str("\n--- Session Context ---\n");
        if let Some(ref url) = ctx.last_url {
            report.push_str(&format!("Last URL: {url}\n"));
        }
        if let Some(secs) = ctx.duration_secs {
            report.push_str(&format!("Duration: {secs:.1}s\n"));
        }
        report.push_str(&format!("Tool calls: {}\n", ctx.tool_call_count));
        report.push_str(&format!("Had waiting prompt: {}\n", ctx.had_waiting_prompt));
        if !ctx.last_actions.is_empty() {
            report.push_str(&format!("Last actions: {}\n", ctx.last_actions.join(", ")));
        }
        if let Some(ref text) = ctx.last_assistant_text {
            report.push_str(&format!("\nLast assistant output:\n{text}\n"));
        }
    }

    let _ = std::fs::write(&path, &report);
    tracing::debug!(path = %path.display(), "Auto-cred crash report written");
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
        if let Some(ref ph) = f.placeholder { desc.push_str(&format!(" placeholder: {ph}")); }
        if let Some(ref ht) = f.help_text { desc.push_str(&format!(" -- {ht}")); }
        desc
    }).collect();

    let docs_section = if let Some(ref url) = req.docs_url {
        format!("Start by navigating to: {url}")
    } else {
        format!("Find the {} developer/API settings page.", req.connector_label)
    };

    let instructions_section = if let Some(ref instructions) = req.setup_instructions {
        format!("\n## Setup Instructions\n{instructions}\n")
    } else {
        String::new()
    };

    let procedure_section = if let Some(ref procedure) = req.saved_procedure {
        format!("\n## Saved Procedure (follow these exact steps)\n{procedure}\n")
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
4. When you encounter a login page, CAPTCHA, or 2FA prompt, output a message like "WAITING: Login required -- please authenticate in the browser" and use `mcp__playwright__browser_wait_for_navigation` to wait for the user.
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
- When you need the user to open a URL in their browser, output: OPEN_URL:https://the-url-here
  The app will automatically open it in their default browser.
"#,
        connector_label = req.connector_label,
        connector_name = req.connector_name,
        docs_section = docs_section,
        instructions_section = instructions_section,
        procedure_section = procedure_section,
        fields = fields_desc.join("\n"),
    )
}

/// Build the prompt for the guided (non-browser) fallback mode.
/// Claude guides the user step-by-step through manual credential creation.
fn build_guided_prompt(req: &AutoCredBrowserRequest) -> String {
    let fields_desc: Vec<String> = req.fields.iter().map(|f| {
        let mut desc = format!("- `{}` ({})", f.key, f.label);
        if f.required { desc.push_str(" [REQUIRED]"); }
        if let Some(ref ph) = f.placeholder { desc.push_str(&format!(" placeholder: {ph}")); }
        if let Some(ref ht) = f.help_text { desc.push_str(&format!(" -- {ht}")); }
        desc
    }).collect();

    let docs_section = if let Some(ref url) = req.docs_url {
        format!("The setup page is at: {url}\nFirst output: OPEN_URL:{url}")
    } else {
        format!("Find the {} developer/API settings page and output the URL with the OPEN_URL: prefix.", req.connector_label)
    };

    let instructions_section = if let Some(ref instructions) = req.setup_instructions {
        format!("\n## Setup Instructions (from documentation)\n{instructions}\n")
    } else {
        String::new()
    };

    format!(
r#"You are a guided credential setup assistant for {connector_label} ({connector_name}).

Browser automation is NOT available. Instead, you will guide the user step-by-step through creating API credentials manually in their own browser.

## Communication Protocol

You have special output prefixes that trigger actions in the desktop app:

1. **OPEN_URL:https://example.com** -- Opens the URL in the user's default browser.
   Use this whenever you reference a URL the user should visit.
   Output it on its own line, with no surrounding text on that line.

2. **WAITING: <message>** -- Indicates you're waiting for the user to complete a step.
   After outputting a WAITING message, the app will pause for user confirmation.

## Starting Point
{docs_section}
{instructions_section}
## Required Fields to Extract
{fields}

## Your Task

Guide the user through these exact steps:

1. First, output the OPEN_URL for the service's API/developer dashboard.
2. Provide clear, numbered instructions for creating an API key or token.
3. For each step, tell the user exactly what to click, fill in, or select.
4. When the user needs to perform an action, output a WAITING message.
5. After the user has created the credential, ask them to copy each field value.
6. Once you have all values, output the final result as JSON:

```json
{{
  "extracted_values": {{
    "field_key": "value_from_user",
    ...
  }},
  "procedure_log": "Step-by-step description of what was done"
}}
```

IMPORTANT:
- Always use OPEN_URL: prefix for any URL you mention (each on its own line).
- Be specific: name exact buttons, menu items, and page sections.
- For services with multiple auth methods, prefer API tokens over OAuth.
- Output ONLY the JSON block at the very end, no other text after it.
- If a field value is not available, use an empty string.
"#,
        connector_label = req.connector_label,
        connector_name = req.connector_name,
        docs_section = docs_section,
        instructions_section = instructions_section,
        fields = fields_desc.join("\n"),
    )
}

/// Determine the mode (playwright or guided) and return the appropriate config.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AutoCredMode {
    Playwright,
    Guided,
}

/// Start a browser automation session to create credentials.
#[tauri::command]
pub async fn start_auto_cred_browser(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    request: AutoCredBrowserRequest,
) -> Result<AutoCredBrowserResult, String> {
    require_privileged(&state, "start_auto_cred_browser").await.map_err(|e| e.to_string())?;
    let registry = Arc::clone(&state.process_registry);
    let session_id = request.session_id.clone();
    let force_guided = request.force_guided.unwrap_or(false);

    // Determine mode: try Playwright first, fall back to guided
    let mode = if force_guided {
        tracing::info!(session_id = %session_id, "Guided mode forced by request");
        AutoCredMode::Guided
    } else if check_playwright_available() {
        AutoCredMode::Playwright
    } else {
        tracing::info!(session_id = %session_id, "Playwright MCP not available, falling back to guided mode");
        AutoCredMode::Guided
    };

    // Build CLI args
    let mut cli_args = build_cli_args(None, None);

    // Override model
    if !cli_args.args.iter().any(|a| a == "--model") {
        cli_args.args.push("--model".to_string());
        cli_args.args.push(BROWSER_MODEL.to_string());
    }

    // Clean up stale MCP config temp files from any previous crashed sessions
    // before creating a new one.
    cleanup_stale_mcp_temp_files();

    // Keep the MCP config file alive for the entire function scope -- dropping
    // the NamedTempFile auto-deletes it, so it must outlive spawn_claude_and_collect.
    let mut _mcp_config_file: Option<tempfile::NamedTempFile> = None;

    let (prompt, timeout) = match mode {
        AutoCredMode::Playwright => {
            // Add Playwright MCP server configuration via secure temp file.
            let mcp_file = build_playwright_mcp_config()?;
            cli_args.args.push("--mcp-config".to_string());
            cli_args.args.push(mcp_file.path().to_string_lossy().to_string());
            _mcp_config_file = Some(mcp_file);

            // Restrict to only Playwright tools
            cli_args.args.push("--allowedTools".to_string());
            cli_args.args.push("mcp__playwright__*".to_string());

            (build_browser_prompt(&request), BROWSER_TIMEOUT_SECS)
        }
        AutoCredMode::Guided => {
            // No MCP needed -- guided mode uses only text output
            // Disallow all tools so Claude focuses on generating instructions
            cli_args.args.push("--allowedTools".to_string());
            cli_args.args.push("".to_string());

            (build_guided_prompt(&request), GUIDED_TIMEOUT_SECS)
        }
    };

    // Emit initial status
    let _ = app.emit(STATUS_EVENT, json!({
        "session_id": session_id,
        "status": "running",
        "mode": mode,
    }));
    let _ = app.emit(PROGRESS_EVENT, json!({
        "session_id": session_id,
        "type": "info",
        "message": match mode {
            AutoCredMode::Playwright => format!("Starting browser automation for {}...", request.connector_label),
            AutoCredMode::Guided => format!("Starting guided setup for {} (no browser automation available)...", request.connector_label),
        },
    }));

    // Collect field keys for partial extraction fallback
    let field_keys: Vec<String> = request.fields.iter().map(|f| f.key.clone()).collect();

    let app_clone = app.clone();
    let sid = session_id.clone();

    // Session context accumulator -- shared with the streaming callback
    let ctx_acc = Arc::new(Mutex::new(SessionContext::default()));
    let ctx_ref = Arc::clone(&ctx_acc);

    // Deduplication tracker -- prevents duplicate log entries in the UI.
    // Claude CLI stream-json sends cumulative assistant events (each contains
    // ALL text from the turn), so we compute deltas to only emit new content.
    let dedup = Arc::new(Mutex::new(StreamDedup::default()));
    let dedup_ref = Arc::clone(&dedup);

    let result = spawn_claude_and_collect(
        &cli_args,
        prompt,
        timeout,
        |line_type, raw| {
            match line_type {
                StreamLineType::SystemInit { model, .. } => {
                    if let Ok(mut dd) = dedup_ref.lock() {
                        if !dd.should_emit_system_init() {
                            return; // already emitted
                        }
                    }
                    let _ = app_clone.emit(PROGRESS_EVENT, json!({
                        "session_id": sid,
                        "type": "info",
                        "message": format!("Connected to Claude ({})", model),
                    }));
                }
                StreamLineType::AssistantText { text } => {
                    // Capture last meaningful assistant text for error context
                    let trimmed_full = text.trim();
                    if !trimmed_full.is_empty() {
                        if let Ok(mut ctx) = ctx_ref.lock() {
                            // Keep the last ~500 chars of meaningful text
                            let snippet = if trimmed_full.len() > 500 {
                                &trimmed_full[trimmed_full.len() - 500..]
                            } else {
                                trimmed_full
                            };
                            ctx.last_assistant_text = Some(snippet.to_string());
                        }
                    }

                    // Compute delta -- only process NEW text not yet emitted
                    let delta = if let Ok(mut dd) = dedup_ref.lock() {
                        dd.assistant_delta(text)
                    } else {
                        Some(text.trim().to_string())
                    };

                    if let Some(delta_text) = delta {
                        // Process each line in the delta independently
                        for line in delta_text.lines() {
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }

                            // Skip trivially short deltas (just punctuation from cumulative streaming)
                            if trimmed.len() <= 3 && trimmed.chars().all(|c| c.is_ascii_punctuation()) {
                                continue;
                            }

                            // Check for OPEN_URL: protocol -- can appear at start OR inline
                            if let Some(url_start) = trimmed.find(OPEN_URL_PREFIX) {
                                let url = trimmed[url_start + OPEN_URL_PREFIX.len()..].trim();
                                // The URL may have trailing text; extract just the URL part
                                let url_end = url.find(|c: char| c.is_whitespace()).unwrap_or(url.len());
                                let url = url[..url_end].trim_end_matches(['.', ',', ';', ')', ']']);
                                if url.starts_with("http://") || url.starts_with("https://") {
                                    let _ = app_clone.emit(OPEN_URL_EVENT, json!({
                                        "session_id": sid,
                                        "url": url,
                                        "auto_open": true,
                                    }));
                                    let _ = app_clone.emit(PROGRESS_EVENT, json!({
                                        "session_id": sid,
                                        "type": "url",
                                        "message": format!("Opening: {}", url),
                                        "url": url,
                                    }));
                                    // If there was text before OPEN_URL:, emit it as action
                                    if url_start > 0 {
                                        let prefix_text = trimmed[..url_start].trim();
                                        if !prefix_text.is_empty() {
                                            let _ = app_clone.emit(PROGRESS_EVENT, json!({
                                                "session_id": sid,
                                                "type": "action",
                                                "message": prefix_text,
                                            }));
                                        }
                                    }
                                    continue;
                                }
                            }

                            if trimmed.starts_with("WAITING:") {
                                if let Ok(mut ctx) = ctx_ref.lock() {
                                    ctx.had_waiting_prompt = true;
                                }
                                let _ = app_clone.emit(PROGRESS_EVENT, json!({
                                    "session_id": sid,
                                    "type": "warning",
                                    "message": trimmed,
                                }));
                            } else if trimmed.starts_with(USER_INPUT_PREFIX) {
                                let _ = app_clone.emit(PROGRESS_EVENT, json!({
                                    "session_id": sid,
                                    "type": "input_request",
                                    "message": trimmed.strip_prefix(USER_INPUT_PREFIX).unwrap().trim(),
                                }));
                            } else {
                                let _ = app_clone.emit(PROGRESS_EVENT, json!({
                                    "session_id": sid,
                                    "type": "action",
                                    "message": trimmed,
                                }));

                                // Extract any inline URLs and emit open-url events (auto_open for these)
                                for url in extract_urls(trimmed) {
                                    let _ = app_clone.emit(OPEN_URL_EVENT, json!({
                                        "session_id": sid,
                                        "url": url,
                                        "auto_open": false,
                                    }));
                                }
                            }
                        }
                    }
                }
                StreamLineType::AssistantToolUse { tool_name, .. } => {
                    // Track context only -- no progress events for routine tool calls
                    // to avoid noisy log entries like "Navigating...", "Working..."
                    if let Ok(mut ctx) = ctx_ref.lock() {
                        ctx.tool_call_count += 1;
                        // Guard against infinite browser automation loops
                        if ctx.tool_call_count >= MAX_TOOL_INVOCATIONS {
                            let _ = app_clone.emit(PROGRESS_EVENT, json!({
                                "session_id": sid,
                                "type": "warning",
                                "message": format!("Tool invocation limit reached ({}). Stopping session.", MAX_TOOL_INVOCATIONS),
                            }));
                        }

                        let action = match tool_name.as_str() {
                            "mcp__playwright__browser_navigate" => "Navigating",
                            "mcp__playwright__browser_snapshot" => "Reading page",
                            "mcp__playwright__browser_click" => "Clicking",
                            "mcp__playwright__browser_type" => "Typing",
                            _ => "Working",
                        };
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
                }
                StreamLineType::ToolResult { .. } => {
                    // A tool result means a new assistant turn is about to start.
                    // Reset the dedup tracker so the next assistant text is treated
                    // as fresh content.
                    if let Ok(mut dd) = dedup_ref.lock() {
                        dd.reset_turn();
                    }
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
                        msg = format!("Browser session complete ({secs:.1}s");
                        if let Some(cost) = total_cost_usd {
                            msg.push_str(&format!(", ${cost:.4}"));
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
        Some((&registry, "auto_cred")),
    )
    .await;

    // Clear PID on completion
    registry.clear_pid("auto_cred");

    // Snapshot the accumulated session context
    let session_ctx = ctx_acc.lock().ok().map(|g| g.clone());

    // Clean up any orphaned browser processes spawned by the Playwright MCP
    // server.  The CLI itself is already reaped by spawn_claude_and_collect,
    // but Chromium children may linger.
    cleanup_orphaned_browsers();

    // Check if the tool invocation limit was reached
    let hit_tool_limit = session_ctx
        .as_ref()
        .map(|c| c.tool_call_count >= MAX_TOOL_INVOCATIONS)
        .unwrap_or(false);

    if hit_tool_limit {
        let err = structured_error(
            "tool_limit",
            &format!("Browser session exceeded the maximum of {} tool invocations.", MAX_TOOL_INVOCATIONS),
            "The automation may be stuck in a loop. Try with more specific instructions or set up manually.",
            true,
            session_ctx,
        );
        let _ = app.emit(STATUS_EVENT, json!({
            "session_id": session_id,
            "status": "failed",
            "error": &err,
        }));
        return Err(err);
    }

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

            // Write crash report for System Checks
            write_subprocess_crash_report(
                &app, &session_id, &request.connector_name, &mode,
                kind, &error_msg, session_ctx.as_ref(),
            );

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
                        // Build guidance that includes the last assistant message
                        // so the user sees WHY the session failed, not a generic message.
                        let guidance = match &session_ctx {
                            Some(ctx) if ctx.last_assistant_text.is_some() => {
                                let last = ctx.last_assistant_text.as_deref().unwrap_or("");
                                // Take the last meaningful sentence(s) from assistant text
                                let summary = last
                                    .lines()
                                    .rev()
                                    .filter(|l| {
                                        let t = l.trim();
                                        !t.is_empty() && !t.starts_with('{') && !t.starts_with("```")
                                    })
                                    .take(3)
                                    .collect::<Vec<_>>()
                                    .into_iter()
                                    .rev()
                                    .collect::<Vec<_>>()
                                    .join(" ");
                                if summary.len() > 20 {
                                    format!("Claude reported: {summary}. You may need to set up this credential manually.")
                                } else {
                                    "The session completed but couldn't produce the expected credentials. The service may require manual steps (login, CAPTCHA, specific account permissions). Check the session log for details.".to_string()
                                }
                            }
                            _ => "The session completed but couldn't produce the expected credentials. The service may require manual steps (CAPTCHA, 2FA, paid plan). Try setting up manually.".to_string(),
                        };
                        // Write crash report for System Checks -- include raw output tail
                        let output_tail = if spawn_result.text_output.len() > 1000 {
                            &spawn_result.text_output[spawn_result.text_output.len() - 1000..]
                        } else {
                            &spawn_result.text_output
                        };
                        let extraction_detail = format!(
                            "Failed to extract credential values.\nOutput length: {} bytes\n\nLast output:\n{}",
                            spawn_result.text_output.len(),
                            output_tail,
                        );
                        write_subprocess_crash_report(
                            &app, &session_id, &request.connector_name, &mode,
                            "extraction_failed", &extraction_detail, session_ctx.as_ref(),
                        );

                        let err = structured_error(
                            "extraction_failed",
                            "Failed to extract credential values from browser session output.",
                            &guidance,
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
    require_privileged(&state, "save_playwright_procedure").await.map_err(|e| e.to_string())?;
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
    require_privileged(&state, "get_playwright_procedure").await.map_err(|e| e.to_string())?;
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
/// handle alive until the CLI process finishes -- dropping it deletes the file,
/// preventing stale credential configs from lingering on disk.
fn build_playwright_mcp_config() -> Result<tempfile::NamedTempFile, String> {
    use std::io::Write;

    let config = json!({
        "mcpServers": {
            "playwright": {
                "command": "npx",
                "args": ["@playwright/mcp@latest"],
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

/// Remove stale `personas_mcp_*.json` temp files left behind by crashed or
/// killed sessions.  The `tempfile` crate's `NamedTempFile` auto-deletes on
/// Drop, but that won't run if the process is killed (e.g. SIGKILL, Task
/// Manager on Windows).  We sweep the OS temp dir at session start.
fn cleanup_stale_mcp_temp_files() {
    let tmp_dir = std::env::temp_dir();
    if let Ok(entries) = std::fs::read_dir(&tmp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("personas_mcp_") && name_str.ends_with(".json")
                && std::fs::remove_file(entry.path()).is_ok() {
                tracing::debug!(file = %name_str, "Cleaned up stale MCP temp file");
            }
        }
    }
}

/// Best-effort cleanup of Chromium processes that were spawned by the
/// Playwright MCP server.  When the Claude CLI exits (normally or via timeout /
/// crash), the MCP server's Chromium child may remain running and consume
/// 200-500 MB of memory per instance.
///
/// This is a best-effort sweep: we look for Chromium processes whose
/// command-line contains the Playwright user-data-dir marker.  On Windows we
/// use WMIC; on Unix we use `pkill`.
fn cleanup_orphaned_browsers() {
    #[cfg(windows)]
    {
        // Kill Chromium instances launched by Playwright.
        // Use PowerShell Get-CimInstance (works on both x64 and ARM64 Windows).
        // WMIC is deprecated and absent on many ARM64 installs.
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("powershell")
            .args([
                "-NoProfile", "-NonInteractive", "-Command",
                "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*playwright*' -and $_.CommandLine -like '*chromium*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output();
    }
    #[cfg(not(windows))]
    {
        // On macOS/Linux, pkill with a pattern matching Playwright-launched Chromium
        let _ = std::process::Command::new("pkill")
            .args(["-f", "chromium.*playwright"])
            .output();
    }
}


/// Check if Playwright MCP is likely to work (npx and @playwright/mcp available).
fn check_playwright_available() -> bool {
    let npx_cmd = if cfg!(windows) { "cmd" } else { "npx" };
    let npx_args: Vec<&str> = if cfg!(windows) {
        vec!["/C", "npx", "--yes", "@playwright/mcp@latest", "--help"]
    } else {
        vec!["--yes", "@playwright/mcp@latest", "--help"]
    };

    match std::process::Command::new(npx_cmd)
        .args(&npx_args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

/// Extract URLs from a text string.
fn extract_urls(text: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut search_from = 0;
    while search_from < text.len() {
        let remaining = &text[search_from..];
        let start = if let Some(pos) = remaining.find("https://") {
            pos
        } else if let Some(pos) = remaining.find("http://") {
            pos
        } else {
            break;
        };

        let url_start = search_from + start;
        let url_text = &text[url_start..];
        // Find end of URL: stop at whitespace, ), ], >, ", markdown chars, or end of string
        let end = url_text
            .find(|c: char| c.is_whitespace() || c == ')' || c == ']' || c == '>' || c == '"' || c == '\'' || c == '`' || c == '*' || c == '_')
            .unwrap_or(url_text.len());
        let url = &url_text[..end];
        // Strip trailing punctuation
        let url = url.trim_end_matches(['.', ',', ';']);
        if url.len() > 10 {
            urls.push(url.to_string());
        }
        search_from = url_start + end;
    }
    urls
}

/// Cancel a running auto-cred browser session by killing the CLI subprocess.
#[tauri::command]
pub async fn cancel_auto_cred_browser(
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let pid = state.process_registry.take_pid("auto_cred");
    if let Some(pid) = pid {
        tracing::info!(pid, "Killing auto-cred CLI subprocess");
        #[cfg(windows)]
        {
            // On Windows, use taskkill to kill the process tree (works on x64 + ARM64)
            #[allow(unused_imports)]
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
        #[cfg(all(not(windows), not(target_os = "android")))]
        {
            unsafe { libc::kill(pid as i32, libc::SIGTERM); }
        }
    }
    Ok(())
}

/// Check if Playwright MCP is available -- exposed as a Tauri command
/// so the frontend can decide the UI mode upfront.
#[tauri::command]
pub async fn check_auto_cred_playwright_available() -> Result<bool, String> {
    Ok(check_playwright_available())
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
        let pattern = format!("\"{key}\"");
        if let Some(pos) = text.find(&pattern) {
            let after = &text[pos + pattern.len()..];
            if let Some(colon_pos) = after.find(':') {
                let value_area = after[colon_pos + 1..].trim_start();
                if let Some(stripped) = value_area.strip_prefix('"') {
                    if let Some(end_quote) = stripped.find('"') {
                        let val = &stripped[..end_quote];
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

// -- Tests ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dedup_first_text_emits_all() {
        let mut dd = StreamDedup::default();
        let delta = dd.assistant_delta("Hello world");
        assert_eq!(delta, Some("Hello world".to_string()));
    }

    #[test]
    fn test_dedup_exact_duplicate_skipped() {
        let mut dd = StreamDedup::default();
        dd.assistant_delta("Hello world");
        let delta = dd.assistant_delta("Hello world");
        assert_eq!(delta, None);
    }

    #[test]
    fn test_dedup_cumulative_emits_delta() {
        let mut dd = StreamDedup::default();
        dd.assistant_delta("Step 1: Go to");
        let delta = dd.assistant_delta("Step 1: Go to GitHub settings.\n\nStep 2:");
        assert!(delta.is_some());
        let d = delta.unwrap();
        assert!(d.contains("GitHub settings"));
        assert!(d.contains("Step 2:"));
        // Original prefix should NOT be in the delta
        assert!(!d.starts_with("Step 1: Go to"));
    }

    #[test]
    fn test_dedup_subset_skipped() {
        let mut dd = StreamDedup::default();
        dd.assistant_delta("Full text here with more content");
        // A shorter version of already-seen text -> skip
        let delta = dd.assistant_delta("Full text here");
        assert_eq!(delta, None);
    }

    #[test]
    fn test_dedup_new_turn_after_reset() {
        let mut dd = StreamDedup::default();
        dd.assistant_delta("Turn 1 text");
        dd.reset_turn();
        let delta = dd.assistant_delta("Turn 2 text");
        assert_eq!(delta, Some("Turn 2 text".to_string()));
    }

    #[test]
    fn test_dedup_system_init_once() {
        let mut dd = StreamDedup::default();
        assert!(dd.should_emit_system_init());
        assert!(!dd.should_emit_system_init());
    }

    #[test]
    fn test_dedup_message_exact() {
        let mut dd = StreamDedup::default();
        assert!(dd.should_emit_message("Navigating..."));
        assert!(!dd.should_emit_message("Navigating..."));
        assert!(dd.should_emit_message("Reading page..."));
    }

    #[test]
    fn test_dedup_message_reset_clears() {
        let mut dd = StreamDedup::default();
        dd.should_emit_message("Navigating...");
        dd.reset_turn();
        // After reset, same message should emit again
        assert!(dd.should_emit_message("Navigating..."));
    }

    #[test]
    fn test_extract_urls_basic() {
        let urls = extract_urls("Visit https://github.com/settings/tokens for tokens.");
        assert_eq!(urls.len(), 1);
        assert_eq!(urls[0], "https://github.com/settings/tokens");
    }

    #[test]
    fn test_extract_urls_multiple() {
        let urls = extract_urls("Go to https://a.com and https://b.com/path");
        assert_eq!(urls.len(), 2);
    }

    #[test]
    fn test_extract_urls_strips_trailing_punct() {
        let urls = extract_urls("Check https://example.com/api.");
        assert_eq!(urls[0], "https://example.com/api");
    }
}
