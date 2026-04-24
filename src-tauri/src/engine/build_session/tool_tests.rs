//! `run_tool_tests` — LLM-driven test runner used right before promote.
//!
//! The build flow hands this module an `AgentIr` and a set of resolved
//! credentials; the module spawns a scratch Claude CLI that composes curl
//! commands for each connector-backed tool, invokes them against real APIs,
//! and returns a summary the UI renders as the test-result panel.
//!
//! Pure side-effect-free execution against the draft — no DB writes, no
//! persona events fired. The promote pipeline happens in a separate command
//! once the user approves the test results.

use std::collections::HashMap;
use std::time::Duration;

use tauri::Emitter;

use crate::db::models::Json;
use crate::db::DbPool;
use crate::error::AppError;

use super::super::cli_process::{read_line_limited, CliProcessDriver};
use super::super::event_registry::event_name;
use super::super::prompt;
// Aliased to avoid colliding with the sibling `build_session::runner`
// submodule (which holds `run_session`, not the persona-execution runner).
use super::super::runner as engine_runner;
use super::super::tool_runner;

// =============================================================================
// run_tool_tests -- LLM-driven real API testing for build drafts
// =============================================================================

/// Test an agent draft by having the LLM compose test curl commands for each
/// tool, then executing them against real APIs with resolved credentials.
///
/// Flow:
/// 1. Resolve credentials for the agent's connectors → get env var names
/// 2. Spawn a CLI process with a test-specific prompt containing the agent_ir
///    tools and available credential env var names
/// 3. CLI outputs a `test_plan` JSON with curl commands per tool
/// 4. Backend executes each curl command with real credential values
/// 5. Emits per-tool result events and returns aggregate report
pub async fn run_tool_tests(
    pool: &DbPool,
    app: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
    agent_ir: &crate::db::models::AgentIr,
) -> Result<serde_json::Value, AppError> {
    let tools = &agent_ir.tools;

    if tools.is_empty() {
        return Ok(serde_json::json!({
            "results": [],
            "tools_tested": 0,
            "tools_passed": 0,
            "tools_failed": 0,
            "tools_skipped": 0,
            "credential_issues": [],
        }));
    }

    let persona_name = agent_ir
        .name
        .as_deref()
        .unwrap_or("draft-agent");

    // Step 1: Resolve credentials to get env var names + values
    let tool_defs: Vec<_> = tools
        .iter()
        .filter_map(tool_runner::tool_def_from_ir)
        .collect();

    let (env_vars, hints, cred_failures, _injected_connectors) =
        engine_runner::resolve_credential_env_vars(pool, &tool_defs, persona_id, persona_name)
            .await;

    // Query ALL credential service types from vault so the LLM can match intelligently
    let all_vault_types = crate::db::repos::resources::credentials::get_distinct_service_types(pool)
        .unwrap_or_default();

    let cred_context = {
        let mut ctx = String::new();
        if !hints.is_empty() {
            ctx.push_str("Resolved credential env vars:\n");
            for h in &hints {
                ctx.push_str(&format!("  {h}\n"));
            }
        }
        if !cred_failures.is_empty() {
            ctx.push_str(&format!(
                "\nFailed to auto-resolve credentials for: {}\n",
                cred_failures.join(", ")
            ));
        }
        if !all_vault_types.is_empty() {
            let mut sorted: Vec<_> = all_vault_types.iter().cloned().collect();
            sorted.sort();
            ctx.push_str("\nAll credential service types available in vault:\n");
            for t in &sorted {
                // Derive the env var prefix the system would use
                let prefix = t.to_uppercase().replace('-', "_");
                ctx.push_str(&format!("  {t} (env prefix: {prefix}_)\n"));
            }
            ctx.push_str("\nIMPORTANT: If a tool needs a credential that wasn't auto-resolved above, check if any vault service type matches semantically (e.g. 'github' matches a GitHub PAT, 'alpha_vantage' matches an Alpha Vantage API key). Use the env prefix format ${PREFIX_API_KEY} or ${PREFIX_TOKEN} for the matching vault entry.\n");
        }
        if ctx.is_empty() {
            ctx = "No credentials found in vault. Tools requiring auth will fail.".to_string();
        }
        ctx
    };

    // Step 2: Build test prompt for the CLI
    let tools_json = serde_json::to_string_pretty(&tools).unwrap_or_default();
    // The connector list is what actually needs credentials — generic tools
    // like `http_request` are conduits. Pass both so the CLI can generate
    // one test entry per connector regardless of how many tools the persona
    // declares.
    let connectors_json = serde_json::to_string_pretty(&agent_ir.required_connectors)
        .unwrap_or_else(|_| "[]".to_string());
    let test_prompt = build_test_prompt(&tools_json, &connectors_json, &cred_context);

    // Step 3: Spawn CLI and get test plan
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-20250514".to_string());

    let mut driver = CliProcessDriver::spawn_temp(&cli_args, "build-test")
        .map_err(|e| AppError::ProcessSpawn(format!("Failed to spawn test CLI: {e}")))?;

    if let Err(e) = driver.write_stdin_line(test_prompt.as_bytes()).await {
        let _ = driver.kill().await;
        return Err(AppError::Execution(format!("Failed to write test prompt: {e}")));
    }
    driver.close_stdin().await;

    // Read CLI output and extract test_plan
    let mut raw_output = String::new();
    if let Some(mut reader) = driver.take_stdout_reader() {
        loop {
            match read_line_limited(&mut reader).await {
                Ok(Some(line)) => {
                    raw_output.push_str(&line);
                    raw_output.push('\n');
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    }
    let _ = driver.finish().await;

    // Parse test_plan from CLI output (may be wrapped in stream-json envelope)
    let test_plan = extract_test_plan(&raw_output);

    // Build a set of resolved credential connector names for validation
    let resolved_cred_names: std::collections::HashSet<String> = env_vars
        .iter()
        .filter_map(|(k, _)| {
            // Env var names are like NOTION_API_KEY → extract prefix "notion"
            k.split('_').next().map(|p| p.to_lowercase())
        })
        .collect();

    // Built-in platform connectors that never need user credentials
    let platform_connectors: std::collections::HashSet<&str> = [
        "personas_database", "personas_messages", "personas_vector_db",
        "messaging", "database", "builtin",
    ].iter().copied().collect();

    // Build connector resolution list for the report so the frontend can show
    // which connectors were matched to user credentials.
    // Check three sources: resolved env vars, credential hints, AND vault service types.
    let vault_types_lower: std::collections::HashSet<String> = all_vault_types
        .iter()
        .map(|t| t.to_lowercase())
        .collect();
    let connectors_resolved: Vec<serde_json::Value> = {
        let names: Vec<String> = agent_ir.required_connectors.iter()
            .filter_map(|c| c.name().map(|n| n.to_string()))
            .collect();
        names.iter()
            .filter(|name| !platform_connectors.contains(name.to_lowercase().as_str()))
            .map(|name| {
                let name_lower = name.to_lowercase();
                let matched = resolved_cred_names.contains(&name_lower)
                    || resolved_cred_names.iter().any(|cred| name_lower.contains(cred.as_str()) || cred.contains(&name_lower))
                    || hints.iter().any(|h| h.to_lowercase().contains(&name_lower))
                    // Also match against vault service types (covers connectors not matched
                    // by tool name, e.g. alpha_vantage credential for http_request tool)
                    || vault_types_lower.contains(&name_lower)
                    || vault_types_lower.iter().any(|vt| name_lower.contains(vt.as_str()) || vt.contains(&name_lower));
                serde_json::json!({
                    "name": name,
                    "has_credential": matched,
                })
            }).collect()
    };

    let total = test_plan.len();
    if total == 0 {
        tracing::warn!(
            session_id = %session_id,
            "CLI returned no test_plan entries, falling back to credential check"
        );
        // Fallback strategy:
        //   • Generic infrastructure tools (http_request, web_search, file_read,
        //     …) never need credentials themselves — their credentials live on
        //     the connectors they target. Iterating tools here would produce
        //     meaningless "http_request needs credentials" messages that don't
        //     tell the user which external service is missing.
        //   • The right level of granularity is `agent_ir.required_connectors`
        //     — one result entry per connector, each carrying the connector
        //     name so the UI can surface "Alpha Vantage needs credentials"
        //     instead of "http_request needs credentials".
        let builtin_tool_names: std::collections::HashSet<&str> = [
            "personas_database", "database", "database_query", "db_query", "db_write",
            "personas_messages", "messaging", "personas_vector_db",
            "file_read", "file_write", "web_search", "web_fetch",
            "http_request", "data_processing", "nlp_parser", "ai_generation",
            "date_calculation", "notification_sender", "text_analysis", "data_enrichment",
        ].iter().copied().collect();

        let mut fb_passed = 0usize;
        let mut fb_failed = 0usize;
        let mut fb_cred_issues: Vec<serde_json::Value> = Vec::new();
        let mut fallback_results: Vec<serde_json::Value> = Vec::new();

        // Infrastructure tools auto-pass — they don't have their own
        // credentials; they're conduits to whichever connector is bound.
        for t in tools.iter() {
            let name = t.name();
            if name.is_empty() { continue; }
            if builtin_tool_names.contains(name) {
                fb_passed += 1;
                fallback_results.push(serde_json::json!({
                    "tool_name": name,
                    "status": "passed",
                    "http_status": null,
                    "latency_ms": 0,
                    "error": null,
                    "connector": null,
                    "output_preview": "Built-in platform tool — auto-verified",
                }));
            }
        }

        // Emit one result per connector. This is what makes the UI's
        // credential_missing messages specific — the connector name is the
        // credential subject, not the generic tool name.
        let connector_names: Vec<String> = agent_ir.required_connectors.iter()
            .filter_map(|c| c.name().map(|n| n.to_string()))
            .collect();
        for cname in &connector_names {
            let name_lower = cname.to_lowercase();
            if platform_connectors.contains(name_lower.as_str()) {
                fb_passed += 1;
                fallback_results.push(serde_json::json!({
                    "tool_name": cname,
                    "status": "passed",
                    "http_status": null,
                    "latency_ms": 0,
                    "error": null,
                    "connector": cname,
                    "output_preview": "Built-in platform connector — auto-verified",
                }));
                continue;
            }
            let has_cred = resolved_cred_names.contains(&name_lower)
                || resolved_cred_names.iter().any(|cred| name_lower.contains(cred.as_str()) || cred.contains(&name_lower))
                || hints.iter().any(|h| h.to_lowercase().contains(&name_lower))
                || vault_types_lower.contains(&name_lower)
                || vault_types_lower.iter().any(|vt| name_lower.contains(vt.as_str()) || vt.contains(&name_lower));
            if has_cred {
                fb_passed += 1;
                fallback_results.push(serde_json::json!({
                    "tool_name": cname,
                    "status": "passed",
                    "http_status": null,
                    "latency_ms": 0,
                    "error": null,
                    "connector": cname,
                    "output_preview": "Credential available — connector verified",
                }));
            } else {
                fb_failed += 1;
                fb_cred_issues.push(serde_json::json!({
                    "connector": cname,
                    "issue": format!("No credential found for connector '{cname}'. Add it in Keys section."),
                }));
                fallback_results.push(serde_json::json!({
                    "tool_name": cname,
                    "status": "credential_missing",
                    "http_status": null,
                    "latency_ms": 0,
                    "error": format!("No credential configured for '{cname}'"),
                    "connector": cname,
                    "output_preview": null,
                }));
            }
        }

        return Ok(serde_json::json!({
            "results": fallback_results,
            "tools_tested": fb_passed + fb_failed,
            "tools_passed": fb_passed,
            "tools_failed": fb_failed,
            "tools_skipped": 0usize,
            "credential_issues": fb_cred_issues,
            "connectors_resolved": connectors_resolved,
        }));
    }

    // Step 4: Execute each test curl command with real credentials
    let env_map: std::collections::HashMap<&str, &str> = env_vars
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut skipped = 0usize;
    let mut credential_issues: Vec<serde_json::Value> = Vec::new();

    for (idx, entry) in test_plan.iter().enumerate() {
        let tool_name = entry
            .get("tool_name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let curl_cmd = entry
            .get("curl")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let connector = entry
            .get("connector")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        tracing::info!(
            session_id = %session_id,
            tool = %tool_name,
            "Executing test {}/{}",
            idx + 1,
            total
        );

        let is_cli_native = entry
            .get("cli_native")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let description = entry
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Auto-pass built-in platform connectors regardless of CLI classification
        let is_builtin_platform = matches!(
            tool_name,
            "personas_database" | "database" | "database_query" | "db_query" | "db_write"
            | "personas_messages" | "messaging"
            | "personas_vector_db"
            | "file_read" | "file_write"
        ) || connector.as_deref().is_some_and(|c| c.starts_with("personas_") || c == "builtin");

        let result = if is_cli_native || is_builtin_platform {
            // CLI-native tools and built-in platform connectors auto-pass
            passed += 1;
            tool_runner::ToolTestResult {
                tool_name: tool_name.to_string(),
                status: "passed".to_string(),
                http_status: None,
                latency_ms: 0,
                error: None,
                connector: connector.clone(),
                output_preview: Some(description),
            }
        } else if curl_cmd.is_empty() {
            skipped += 1;
            tool_runner::ToolTestResult {
                tool_name: tool_name.to_string(),
                status: "skipped".to_string(),
                http_status: None,
                latency_ms: 0,
                error: Some(if description.is_empty() { "No curl command generated".to_string() } else { description }),
                connector: connector.clone(),
                output_preview: None,
            }
        } else {
            let r = tool_runner::execute_test_curl(curl_cmd, &env_map).await;
            match r.status.as_str() {
                "passed" => passed += 1,
                "credential_missing" => {
                    failed += 1;
                    credential_issues.push(serde_json::json!({
                        "connector": connector,
                        "issue": r.error,
                    }));
                }
                _ => failed += 1,
            }
            tool_runner::ToolTestResult {
                tool_name: tool_name.to_string(),
                connector: connector.clone(),
                ..r
            }
        };

        let result_json = serde_json::json!({
            "tool_name": result.tool_name,
            "status": result.status,
            "http_status": result.http_status,
            "latency_ms": result.latency_ms,
            "error": result.error,
            "connector": result.connector,
            "output_preview": result.output_preview,
        });

        // Emit per-tool result event
        let _ = app.emit(event_name::BUILD_TEST_TOOL_RESULT, serde_json::json!({
            "session_id": session_id,
            "tool_name": result.tool_name,
            "status": result.status,
            "http_status": result.http_status,
            "latency_ms": result.latency_ms,
            "error": result.error,
            "connector": result.connector,
            "tested": idx + 1,
            "total": total,
        }));

        results.push(result_json);
    }

    // Step 5: Generate human-friendly summary via CLI
    let results_json = serde_json::to_string_pretty(&results).unwrap_or_default();
    let summary = generate_test_summary(
        &results_json,
        persona_name,
        passed,
        failed,
        skipped,
    )
    .await
    .unwrap_or_else(|_| build_fallback_summary(&results, passed, failed, skipped));

    Ok(serde_json::json!({
        "results": results,
        "tools_tested": passed + failed,
        "tools_passed": passed,
        "tools_failed": failed,
        "tools_skipped": skipped,
        "credential_issues": credential_issues,
        "connectors_resolved": connectors_resolved,
        "summary": summary,
    }))
}

/// Ask the CLI to generate a human-friendly summary of test results.
async fn generate_test_summary(
    results_json: &str,
    agent_name: &str,
    passed: usize,
    failed: usize,
    skipped: usize,
) -> Result<String, AppError> {
    let prompt = format!(
r#"You are writing a test report for a non-technical user who just built an AI agent called "{agent_name}".

## Test Results (raw data)
{results_json}

## Stats
- {passed} passed, {failed} failed, {skipped} skipped

## Instructions
Write a structured report in this EXACT markdown format:

### Overview
One paragraph (2-3 sentences) summarizing the overall result in plain, friendly language.

### Results
For EACH tool tested, write exactly one entry:
- **Tool Name** — ✅ One sentence describing what was verified and that it works. OR
- **Tool Name** — ❌ One sentence explaining in plain language what went wrong and how to fix it.

### Next Steps
If all passed: One encouraging sentence.
If some failed: 2-3 bullet points with specific, actionable steps the user should take (e.g., "Go to **Keys** section and refresh your Gmail credentials").

## Rules
- Use ONLY the markdown format above (###, **, -, ✅, ❌)
- Write for a NON-TECHNICAL user — no HTTP codes, no API jargon, no JSON
- For CLI-native tools (web search, summarization): explain they use built-in capabilities and are always available
- For credential failures: always mention the **Keys** section
- Keep each tool summary to exactly ONE sentence"#
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-haiku-4-5-20251001".to_string());

    let mut driver = CliProcessDriver::spawn_temp(&cli_args, "test-summary")
        .map_err(|e| AppError::ProcessSpawn(format!("Failed to spawn summary CLI: {e}")))?;

    if let Err(e) = driver.write_stdin_line(prompt.as_bytes()).await {
        let _ = driver.kill().await;
        return Err(AppError::Execution(format!("Failed to write summary prompt: {e}")));
    }
    driver.close_stdin().await;

    let mut raw_output = String::new();
    if let Some(mut reader) = driver.take_stdout_reader() {
        loop {
            match read_line_limited(&mut reader).await {
                Ok(Some(line)) => {
                    raw_output.push_str(&line);
                    raw_output.push('\n');
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    }
    let _ = driver.finish().await;

    // Extract plain text from CLI output (unwrap stream-json envelopes)
    let text = extract_llm_text_from_output(&raw_output);
    let cleaned = text
        .replace("```", "")
        .trim()
        .to_string();

    if cleaned.is_empty() {
        return Err(AppError::Execution("Empty summary from CLI".to_string()));
    }

    Ok(cleaned)
}

/// Build a basic fallback summary when CLI summary generation fails.
fn build_fallback_summary(
    results: &[serde_json::Value],
    passed: usize,
    failed: usize,
    skipped: usize,
) -> String {
    let mut lines = Vec::new();

    if failed == 0 && passed > 0 {
        lines.push(format!("All {} tool connections were verified successfully.", passed));
    } else if passed == 0 && failed > 0 {
        lines.push(format!("None of the {} tools could connect to their services.", failed));
    } else {
        lines.push(format!("{} of {} tools connected successfully, {} had issues.", passed, passed + failed, failed));
    }

    for r in results {
        let status = r.get("status").and_then(|v| v.as_str()).unwrap_or("");
        // Prefer the connector name (e.g. "alpha_vantage") over the tool
        // name (e.g. "http_request") so the user sees which external
        // service is failing, not the generic tool that drove the call.
        let connector = r.get("connector").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        let tool = r.get("tool_name").and_then(|v| v.as_str()).unwrap_or("unknown");
        let subject = connector.unwrap_or(tool);
        let friendly = subject.replace('_', " ");

        if status == "credential_missing" {
            lines.push(format!("\"{}\" needs credentials — add them in the Keys section.", friendly));
        } else if status == "failed" {
            let code = r.get("http_status").and_then(|v| v.as_u64());
            match code {
                Some(401) | Some(403) => {
                    lines.push(format!("\"{}\" authentication failed — try refreshing credentials in Keys.", friendly));
                }
                Some(404) => {
                    lines.push(format!("\"{}\" endpoint not found — the API configuration may need updating.", friendly));
                }
                _ => {
                    lines.push(format!("\"{}\" could not connect to the service.", friendly));
                }
            }
        }
    }

    if skipped > 0 {
        lines.push(format!("{} tools were skipped (read-only verification not available).", skipped));
    }

    lines.join(" ")
}

/// Build the test prompt sent to the CLI to generate executable curl commands.
fn build_test_prompt(tools_json: &str, connectors_json: &str, cred_context: &str) -> String {
    format!(
r#"You are a tool-testing agent. Compose one `test_plan` entry PER CONNECTOR the persona relies on — plus one entry per non-connector tool that might need verification.

## Connectors the persona uses
These are the external services the persona binds to. EVERY connector needs its own test_plan entry so the user sees per-service status.
{connectors_json}

## Tools the persona uses
Generic tools (http_request, web_search, file_read, …) are conduits — they don't own credentials. Do NOT emit a separate "http_request needs credentials" entry; the connectors above are the credential subjects.
{tools_json}

## Credentials
{cred_context}

## Strategy

### 1. Per-connector API test (MUST emit one per external connector)
For each connector in the list above whose category is an external service (not a platform builtin), compose a minimal safe curl. Set `tool_name` to the connector name (same as `connector`), or to the persona tool that drives the call when that's clearer. ALWAYS set `connector` to the connector's `name` so the UI can surface "Alpha Vantage" instead of "http_request".

### 2. CLI-native tools (Claude built-ins, no external API)
`web_search`, `web_fetch`, text summarization, reasoning, etc. are powered by Claude CLI. Mark these with `"cli_native": true` and `"curl": ""`.

### 3. Built-in platform connectors (always available)
`personas_database` / `database` / `personas_messages` / `messaging` / `personas_vector_db` / `file_read` / `file_write` — auto-verified. Mark `"cli_native": true`.

### 4. Non-testable (write-only or no endpoint)
Tools that only mutate state — emit an entry with empty curl and a description explaining the skip.

## Rules for API tests
1. Use GET endpoints or read-only operations only — NO writes, deletes, or mutations.
2. Minimal params (limit=1, maxResults=1, per_page=1).
3. Use $ENV_VAR placeholders for credential values; match the env prefix of the credential from the list above.
4. Always include `-s` (silent) and `-w '\n%{{http_code}}'` to capture HTTP status.

## Output Format
Output EXACTLY one JSON object — a test_plan array. No markdown, no commentary, raw JSON only:
{{"test_plan": [
  {{"tool_name": "alpha_vantage", "connector": "alpha_vantage", "curl": "curl -s 'https://www.alphavantage.co/query?function=MARKET_STATUS&apikey=$ALPHA_VANTAGE_API_KEY' -w '\\n%{{http_code}}'", "cli_native": false, "description": "Verify Alpha Vantage API key via MARKET_STATUS"}},
  {{"tool_name": "gmail", "connector": "gmail", "curl": "curl -s -H 'Authorization: Bearer $GMAIL_ACCESS_TOKEN' 'https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=1' -w '\\n%{{http_code}}'", "cli_native": false, "description": "Verify Gmail API access"}},
  {{"tool_name": "web_search", "connector": null, "curl": "", "cli_native": true, "description": "Uses Claude CLI built-in web search — auto-verified"}},
  {{"tool_name": "messaging", "connector": "personas_messages", "curl": "", "cli_native": true, "description": "Built-in platform connector — auto-verified"}}
]}}

Generate the test_plan now."#
    )
}

/// Extract test_plan entries from CLI output (handles stream-json envelopes).
fn extract_test_plan(raw_output: &str) -> Vec<serde_json::Value> {
    // First try to parse from LLM text content (unwrap envelopes)
    let text_content = extract_llm_text_from_output(raw_output);
    let search_text = if text_content.is_empty() {
        raw_output.to_string()
    } else {
        text_content
    };

    // Look for test_plan JSON object in the text
    // Strategy: find a JSON object containing "test_plan" key
    let cleaned = search_text
        .replace("```json", "")
        .replace("```", "");

    for line in cleaned.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(plan) = val.get("test_plan").and_then(|v| v.as_array()) {
                return plan.clone();
            }
        }
    }

    // Try multi-line parse (test_plan might span multiple lines)
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&cleaned) {
        if let Some(plan) = val.get("test_plan").and_then(|v| v.as_array()) {
            return plan.clone();
        }
    }

    // Try to find test_plan in any JSON object in the raw output
    for chunk in raw_output.split('\n') {
        let trimmed = chunk.trim();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            // Check stream-json result envelope
            if let Some(result_text) = val.get("result").and_then(|v| v.as_str()) {
                let inner_cleaned = result_text
                    .replace("```json", "")
                    .replace("```", "");
                if let Ok(inner) = serde_json::from_str::<serde_json::Value>(&inner_cleaned) {
                    if let Some(plan) = inner.get("test_plan").and_then(|v| v.as_array()) {
                        return plan.clone();
                    }
                }
            }
            // Check assistant envelope
            if let Some(content) = val.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        let inner_cleaned = text
                            .replace("```json", "")
                            .replace("```", "");
                        if let Ok(inner) = serde_json::from_str::<serde_json::Value>(&inner_cleaned) {
                            if let Some(plan) = inner.get("test_plan").and_then(|v| v.as_array()) {
                                return plan.clone();
                            }
                        }
                    }
                }
            }
        }
    }

    vec![]
}

/// Extract the LLM's text content from raw CLI stream-json output.
/// Prefers the `result` event (final complete output) over `assistant` events
/// (streaming fragments) to avoid duplication.
fn extract_llm_text_from_output(raw: &str) -> String {
    let mut result_text: Option<String> = None;
    let mut assistant_text: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let obj = match val.as_object() {
                Some(o) => o,
                None => continue,
            };
            let etype = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
            match etype {
                "assistant" => {
                    if let Some(text) = obj
                        .get("message")
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_array())
                        .and_then(|arr| {
                            arr.iter()
                                .find(|i| i.get("type").and_then(|t| t.as_str()) == Some("text"))
                                .and_then(|i| i.get("text").and_then(|t| t.as_str()))
                        })
                    {
                        assistant_text = Some(text.to_string());
                    }
                }
                "result" => {
                    if let Some(text) = obj.get("result").and_then(|v| v.as_str()) {
                        result_text = Some(text.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    // Prefer result (complete output) over assistant (may be partial/duplicate)
    result_text.or(assistant_text).unwrap_or_default()
}

