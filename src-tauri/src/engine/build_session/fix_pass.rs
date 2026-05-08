//! LLM fix-pass: when an autonomous build's test phase fails, this module
//! spawns a fresh Claude CLI subprocess with the current agent_ir + the
//! failure summary and asks for a corrected agent_ir back.
//!
//! Design notes:
//!   - Single-turn, NOT the multi-turn streaming flow used by the main
//!     build runner. Uses `claude --print` (one-shot stdout) so we don't
//!     need to host a stream-json parser here. The runner exists to drive
//!     a multi-step build conversation; a fix is a one-shot edit.
//!   - The CLI inherits the same `base_cli_invocation()` helper as the
//!     companion's chat session (`src-tauri/src/companion/session.rs`).
//!     If the platform shim changes, both call sites pick it up.
//!   - The fix is *advisory*: this module returns `Ok(corrected_ir)` on
//!     success, but the caller (`oneshot::run_post_draft`) decides
//!     whether to commit the change. Today it always commits and
//!     re-tests; if a future failure mode wants a "preview the fix and
//!     ask the user" path, the fix can be returned without writing.
//!
//! Why not reuse `runner::run_session`?
//!   - The runner is built around the v3 capability framework's
//!     three-phase event protocol (behavior_core / capability_* /
//!     agent_ir) and its long-lived gate state machine. A one-shot fix
//!     doesn't need any of that — it just needs the LLM to see "here's
//!     the broken IR + here's why it broke" and emit a corrected IR.
//!     Reusing the runner would require carving out a non-streaming
//!     entry point and disabling all the gate/coverage scaffolding.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

/// Hard ceiling for a single fix-pass CLI invocation. A healthy run is
/// well under a minute; if we cross five minutes the CLI is hung
/// (network stall, suspended child, prompt overflow) and the build
/// session is stuck in `Resolving` with no recovery path. Killing the
/// child and surfacing a typed error lets the caller finalize the
/// session as Failed instead of blocking forever.
const FIX_PASS_CLI_TIMEOUT: Duration = Duration::from_secs(300);

use crate::db::models::UpdateBuildSession;
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::error::AppError;
use crate::AppState;

/// Run a single LLM fix pass: ask the model to correct the agent_ir
/// given the test failure summary, persist the corrected IR back to the
/// session row, and return.
///
/// The corrected IR also flows back to the caller as the second tuple
/// element so the orchestrator can log what changed (or use it for
/// in-memory continuation without re-fetching from the DB).
pub(super) async fn run_fix_pass(
    state: &Arc<AppState>,
    session_id: &str,
    failure_summary: &str,
    attempt: u32,
) -> Result<crate::db::models::AgentIr, AppError> {
    // Load the current agent_ir + intent for prompt context.
    let session = build_session_repo::get_by_id(&state.db, session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    let current_ir_str = session.agent_ir.clone().ok_or_else(|| {
        AppError::Validation(
            "fix_pass: build session has no agent_ir to fix — autonomous build never reached DraftReady"
                .to_string(),
        )
    })?;

    // Sanity-parse so we fail fast on a corrupt IR (rather than surfacing
    // a confusing CLI prompt error later).
    serde_json::from_str::<crate::db::models::AgentIr>(&current_ir_str).map_err(|e| {
        AppError::Validation(format!("fix_pass: existing agent_ir parse error: {e}"))
    })?;

    let prompt = build_fix_prompt(&session.intent, &current_ir_str, failure_summary, attempt);

    tracing::info!(
        session_id = %session_id,
        attempt,
        prompt_bytes = prompt.len(),
        "fix_pass: spawning Claude CLI for autonomous correction"
    );

    let response_text = invoke_claude_print(&prompt).await?;

    let corrected_ir_str =
        extract_agent_ir_json(&response_text, &current_ir_str).ok_or_else(|| {
            tracing::warn!(
                session_id = %session_id,
                attempt,
                response_preview = %response_text.chars().take(400).collect::<String>(),
                "fix_pass: LLM response had no parseable agent_ir block"
            );
            AppError::Internal(
                "fix_pass: LLM did not emit a valid agent_ir JSON block — keeping previous IR"
                    .to_string(),
            )
        })?;

    // Validate before persisting so a structurally broken response can't
    // poison the session row (and trip the next test pass before the
    // problem is visible).
    let corrected_ir: crate::db::models::AgentIr = serde_json::from_str(&corrected_ir_str)
        .map_err(|e| {
            AppError::Internal(format!(
                "fix_pass: corrected agent_ir failed to parse as AgentIr: {e}"
            ))
        })?;

    build_session_repo::update(
        &state.db,
        session_id,
        &UpdateBuildSession {
            agent_ir: Some(Some(corrected_ir_str)),
            // Clear the previous error_message so the UI / notification
            // copy reflects the latest attempt rather than the stale fail.
            error_message: Some(None),
            ..Default::default()
        },
    )?;

    tracing::info!(
        session_id = %session_id,
        attempt,
        "fix_pass: persisted corrected agent_ir"
    );

    Ok(corrected_ir)
}

/// Build the one-shot fix prompt. Kept dense so the LLM sees the IR and
/// the failures side by side without scrolling — the model is more
/// likely to make pinpoint edits than to rewrite from scratch when the
/// before/after framing is right next to the failure list.
fn build_fix_prompt(intent: &str, current_ir: &str, failure_summary: &str, attempt: u32) -> String {
    format!(
        "You previously generated an `agent_ir` for an autonomous build. The pre-promote test phase \
         FAILED. You must emit a CORRECTED agent_ir that addresses the failures.\n\n\
         ## Original intent\n\n{intent}\n\n\
         ## Current (broken) agent_ir\n\n```json\n{current_ir}\n```\n\n\
         ## Test failure summary (attempt {attempt})\n\n{failure_summary}\n\n\
         ## What you must do now\n\n\
         1. Diagnose which fields in `agent_ir` caused each failure (tool definitions, \
         credential references, schema mismatches, missing required parameters, malformed \
         endpoints).\n\
         2. Emit ONE corrected `agent_ir` JSON object that fixes those issues. Keep working \
         capabilities intact; only edit what the failures point at.\n\
         3. If a failure can't be fixed without removing a capability (e.g. the credential \
         genuinely doesn't exist), drop the failing capability rather than ship something \
         that will fail again. Note the drop in the capability `summary` of any neighbour \
         that depended on it.\n\
         4. If the failure is a transient credential issue (HTTP 401 / 403) and the IR \
         itself is structurally fine, return the IR unchanged so the orchestrator can \
         decide to surface a credential-setup prompt to the user instead of re-fixing.\n\n\
         ## Output contract\n\n\
         Output ONLY a single JSON object in a fenced ```json``` block, with the top-level \
         key `agent_ir`. No prose before or after. No `clarifying_question`. No `progress`. \
         No `behavior_core`. Just the corrected agent_ir.\n\n\
         Example shape:\n\
         ```json\n{{\"agent_ir\": {{\"name\": \"...\", \"description\": \"...\", ...}}}}\n```\n"
    )
}

/// Fire off `claude --print` with the fix prompt on stdin and capture
/// the full stdout. We deliberately use `--print` (not `stream-json`)
/// because the fix pass is a one-shot Q→A: there's no need to subscribe
/// to incremental events on the Rust side, and the simpler IO loop
/// avoids re-implementing a stream-json parser here.
async fn invoke_claude_print(prompt: &str) -> Result<String, AppError> {
    let (cmd_program, mut argv) = crate::companion::session::base_cli_invocation();
    argv.extend([
        "-p".into(),
        "-".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        "claude-sonnet-4-20250514".into(),
    ]);

    let cwd = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let mut child = Command::new(&cmd_program)
        .args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .env("CLAUDE_CODE_DISABLE_TERMINAL_TITLE", "1")
        .spawn()
        .map_err(|e| AppError::Internal(format!("fix_pass: spawn claude: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("fix_pass: write claude stdin: {e}")))?;
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("fix_pass: claude stdout missing".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("fix_pass: claude stderr missing".into()))?;

    // Drain stdout into a buffer.
    let stdout_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stdout_handle = {
        let buf = stdout_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut g = buf.lock().await;
                if !g.is_empty() {
                    g.push('\n');
                }
                g.push_str(&line);
            }
        })
    };

    // Drain stderr concurrently so a verbose CLI doesn't deadlock the
    // pipe and so we can include it in any failure message.
    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stderr_handle = {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut g = buf.lock().await;
                if !g.is_empty() {
                    g.push('\n');
                }
                g.push_str(&line);
            }
        })
    };

    let wait_result = tokio::time::timeout(FIX_PASS_CLI_TIMEOUT, child.wait()).await;

    let status = match wait_result {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            // Best-effort: drain reader tasks so they don't outlive us.
            stdout_handle.abort();
            stderr_handle.abort();
            return Err(AppError::Internal(format!("fix_pass: claude wait: {e}")));
        }
        Err(_elapsed) => {
            // CLI is hung. Kill the child, then bound how long we wait
            // for the drain tasks so a stuck pipe can't keep us blocked.
            let _ = child.kill().await;
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            let _ = tokio::time::timeout(Duration::from_secs(2), stdout_handle).await;
            let _ = tokio::time::timeout(Duration::from_secs(2), stderr_handle).await;
            let stderr_text = stderr_buf.lock().await.clone();
            tracing::warn!(
                timeout_secs = FIX_PASS_CLI_TIMEOUT.as_secs(),
                stderr_preview = %stderr_text.chars().take(400).collect::<String>(),
                "fix_pass: claude CLI timed out — killed child"
            );
            return Err(AppError::Internal(format!(
                "fix_pass: claude CLI timed out after {}s — killed and aborting fix pass",
                FIX_PASS_CLI_TIMEOUT.as_secs()
            )));
        }
    };

    stdout_handle
        .await
        .map_err(|e| AppError::Internal(format!("fix_pass: stdout reader task panicked: {e}")))?;
    stderr_handle
        .await
        .map_err(|e| AppError::Internal(format!("fix_pass: stderr reader task panicked: {e}")))?;

    if !status.success() {
        let stderr_text = stderr_buf.lock().await.clone();
        return Err(AppError::Internal(format!(
            "fix_pass: claude exited with status {} — stderr: {}",
            status,
            stderr_text.chars().take(400).collect::<String>()
        )));
    }

    let stdout_text = stdout_buf.lock().await.clone();
    Ok(stdout_text)
}

/// Pull the `agent_ir` JSON object out of a Claude `--print` response.
///
/// Strategy:
///   1. Look for a fenced ```json ... ``` block; parse its body. If it
///      has a top-level `agent_ir` key, serialize that key's value back
///      to a JSON string and return.
///   2. Failing that, scan the whole response for the substring
///      `"agent_ir"` and try to extract the smallest balanced JSON
///      object that contains it.
///
/// Returns `None` if neither strategy yields a parseable IR.
fn extract_agent_ir_json(response: &str, prior_agent_ir: &str) -> Option<String> {
    let prior_value = serde_json::from_str::<serde_json::Value>(prior_agent_ir).ok();

    for json_text in extract_fenced_json_blocks(response).into_iter().rev() {
        if let Some(candidate) = candidate_agent_ir_json(&json_text, prior_value.as_ref()) {
            return Some(candidate);
        }
    }

    if let Some(start) = response.find(r#""agent_ir""#) {
        // Walk backwards to the nearest `{`, then forward to find the
        // matching closing brace. Handles the case where the model
        // emitted unfenced JSON.
        let object_start = response[..start].rfind('{')?;
        let mut depth = 0i32;
        let bytes = response.as_bytes();
        let mut object_end = None;
        for (i, &b) in bytes.iter().enumerate().skip(object_start) {
            match b {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        object_end = Some(i + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
        let end = object_end?;
        let candidate = &response[object_start..end];
        if let Some(candidate) = candidate_agent_ir_json(candidate, prior_value.as_ref()) {
            return Some(candidate);
        }
    }

    None
}

fn candidate_agent_ir_json(
    json_text: &str,
    prior_value: Option<&serde_json::Value>,
) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(json_text).ok()?;
    let ir_value = value.get("agent_ir").unwrap_or(&value);

    if value.get("agent_ir").is_none() && !looks_like_bare_agent_ir(ir_value) {
        return None;
    }

    if prior_value.is_some_and(|prior| prior == ir_value) {
        return None;
    }

    serde_json::to_string(ir_value).ok()
}

/// Heuristic for accepting an unwrapped fenced object as the agent_ir.
///
/// `AgentIr` derives `#[serde(default)]` on every field, so strict
/// deserialization isn't strict — almost any JSON object will parse.
/// To avoid persisting a structurally-similar-but-wrong object (a tool
/// definition, a connector spec, an n8n debug payload), require both a
/// `name` field AND at least one field that is exclusive to agent_ir at
/// the top level. Tool/connector definitions don't carry these.
fn looks_like_bare_agent_ir(value: &serde_json::Value) -> bool {
    if !value.is_object() || value.get("name").is_none() {
        return false;
    }
    // Fields (and known aliases) that only appear on the top-level
    // agent_ir object. Tool defs have `name`/`description`/`input_schema`
    // but never these.
    const IR_MARKERS: &[&str] = &[
        "system_prompt",
        "full_prompt_markdown",
        "structured_prompt",
        "use_cases",
        "use_case_flows",
        "triggers",
        "suggested_triggers",
        "tools",
        "suggested_tools",
        "required_connectors",
        "suggested_connectors",
        "events",
        "suggested_event_subscriptions",
        "design_context",
        "service_flow",
        "persona",
    ];
    IR_MARKERS.iter().any(|k| value.get(*k).is_some())
}

fn extract_fenced_json_blocks(response: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut cursor = 0usize;

    while let Some(open_rel) = response[cursor..].find("```") {
        let open = cursor + open_rel;
        let after_open = open + 3;
        let body_start = response[after_open..]
            .find('\n')
            .map(|nl| after_open + nl + 1)
            .unwrap_or(after_open);

        let Some(close_rel) = response[body_start..].find("```") else {
            break;
        };
        let close = body_start + close_rel;
        let trimmed = response[body_start..close].trim();
        if !trimmed.is_empty() {
            blocks.push(trimmed.to_string());
        }
        cursor = close + 3;
    }

    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIOR_IR: &str = r#"{"name":"Prior","description":"broken","system_prompt":"old"}"#;

    #[test]
    fn extract_fenced_agent_ir() {
        let response = r#"Here is the fix:

```json
{
  "agent_ir": {
    "name": "Test",
    "description": "Fixed"
  }
}
```

Done."#;
        let extracted = extract_agent_ir_json(response, PRIOR_IR).expect("should extract");
        let value: serde_json::Value = serde_json::from_str(&extracted).unwrap();
        assert_eq!(value["name"], "Test");
    }

    #[test]
    fn extract_unfenced_agent_ir() {
        let response = r#"OK. {"agent_ir": {"name": "X", "description": "y"}} that should work."#;
        let extracted = extract_agent_ir_json(response, PRIOR_IR).expect("should extract");
        let value: serde_json::Value = serde_json::from_str(&extracted).unwrap();
        assert_eq!(value["name"], "X");
    }

    #[test]
    fn returns_none_when_no_agent_ir() {
        let response = "I cannot fix this — credentials are missing entirely.";
        assert!(extract_agent_ir_json(response, PRIOR_IR).is_none());
    }

    #[test]
    fn handles_bare_object_without_wrapper() {
        let response = r#"```json
{"name": "X", "description": "y", "system_prompt": "z"}
```"#;
        let extracted = extract_agent_ir_json(response, PRIOR_IR).expect("should extract bare IR");
        let value: serde_json::Value = serde_json::from_str(&extracted).unwrap();
        assert_eq!(value["name"], "X");
    }

    /// Regression — a fenced tool definition (has `name` + `description` +
    /// `input_schema`/`parameters`) must NOT be accepted as the corrected
    /// agent_ir. Without the marker check, the name-only heuristic let
    /// these through and the orchestrator would persist them into the
    /// session row, poisoning the next test pass.
    #[test]
    fn rejects_bare_tool_definition_shape() {
        let response = r#"```json
{
  "name": "fetch_url",
  "description": "Fetch a URL and return body",
  "input_schema": {"type": "object", "properties": {"url": {"type": "string"}}},
  "parameters": {"timeout_ms": 5000}
}
```"#;
        assert!(
            extract_agent_ir_json(response, PRIOR_IR).is_none(),
            "tool definition without IR markers must not be accepted as agent_ir"
        );
    }

    /// Regression — a fenced connector spec is similarly tool-like and
    /// must be rejected.
    #[test]
    fn rejects_bare_connector_spec_shape() {
        let response = r#"```json
{
  "name": "slack",
  "service_type": "slack",
  "has_credential": true
}
```"#;
        assert!(
            extract_agent_ir_json(response, PRIOR_IR).is_none(),
            "connector spec must not be accepted as agent_ir"
        );
    }

    /// Regression — an object with only `name` + `description` (the bare
    /// minimum AgentIr fields, which `#[serde(default)]` would happily
    /// accept) is too ambiguous to commit. Must be rejected.
    #[test]
    fn rejects_minimal_name_description_only() {
        let response = r#"```json
{"name": "X", "description": "y"}
```"#;
        assert!(
            extract_agent_ir_json(response, PRIOR_IR).is_none(),
            "minimal name+description must not be accepted as agent_ir"
        );
    }

    /// A bare IR with `use_cases` (the v3 capability list) is a clear
    /// agent_ir signature and should be accepted.
    #[test]
    fn accepts_bare_ir_with_use_cases_marker() {
        let response = r#"```json
{"name": "X", "description": "y", "use_cases": [{"id": "uc_a", "title": "A"}]}
```"#;
        let extracted = extract_agent_ir_json(response, PRIOR_IR).expect("should extract bare IR");
        let value: serde_json::Value = serde_json::from_str(&extracted).unwrap();
        assert_eq!(value["name"], "X");
    }

    #[test]
    fn prefers_last_valid_fenced_agent_ir() {
        let response = r#"The first block is the broken input:
```json
{"agent_ir":{"name":"Broken","description":"old","system_prompt":"bad"}}
```

The corrected IR is:
```json
{"agent_ir":{"name":"Fixed","description":"new","system_prompt":"good"}}
```"#;
        let extracted = extract_agent_ir_json(response, PRIOR_IR).expect("should extract last IR");
        let value: serde_json::Value = serde_json::from_str(&extracted).unwrap();
        assert_eq!(value["name"], "Fixed");
    }

    #[test]
    fn skips_echoed_prior_ir_and_uses_real_correction() {
        let response = r#"```json
{"agent_ir":{"name":"Prior","description":"broken","system_prompt":"old"}}
```
```json
{"agent_ir":{"name":"Fixed","description":"new","system_prompt":"good"}}
```"#;
        let extracted = extract_agent_ir_json(response, PRIOR_IR).expect("should skip prior IR");
        let value: serde_json::Value = serde_json::from_str(&extracted).unwrap();
        assert_eq!(value["name"], "Fixed");
    }

    #[test]
    fn rejects_only_echoed_prior_ir() {
        let response = r#"```json
{"agent_ir":{"name":"Prior","description":"broken","system_prompt":"old"}}
```"#;
        assert!(extract_agent_ir_json(response, PRIOR_IR).is_none());
    }
}
