//! MCP tool handlers — the four `athena.*` tools exposed to claude
//! sessions over the MCP transport.
//!
//! See [`super`] for the transport (router, JSON-RPC) and
//! [`super::pending`] for the blocking-request hub used by
//! `request_guidance` / `request_approval`.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::pending::{self, RequestKind, RequestNotice};
use super::{internal_error, invalid_params, text_result, JsonRpcError};

/// JSON schemas for `tools/list`. Each entry advertises name +
/// description + JSON Schema for the arguments. We use plain `"type":
/// "object"` schemas — claude validates required fields client-side.
pub fn tool_descriptors() -> Value {
    json!([
        {
            "name": "athena.report_intent",
            "description": "Tell Athena what this session is working on. Call once at the start of meaningful work, or whenever the focus changes. Optionally claims a specific Operation (when one is in flight) by passing operation_id; otherwise auto-creates an ad-hoc operation. The reported intent replaces the auto-generated 'user spawn in <project>' label in Athena's prompt digest.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "intent": {
                        "type": "string",
                        "description": "One-line summary of what this session is going to do. Keep it concrete (\"add login flow tests\" not \"work on tests\")."
                    },
                    "role": {
                        "type": "string",
                        "description": "Optional role within a multi-session operation (e.g. \"writer\", \"reviewer\", \"runner\")."
                    },
                    "operation_id": {
                        "type": "string",
                        "description": "Optional operation id to join. Use when another session has already begun an operation you should attach to."
                    }
                },
                "required": ["intent"]
            }
        },
        {
            "name": "athena.checkpoint",
            "description": "Report progress mid-session. Appended to Athena's view so she can see what each session thinks is happening, separately from raw tool calls. Call when crossing meaningful milestones, NOT on every tool use (the hook layer already covers that).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "progress": {
                        "type": "string",
                        "description": "One-line progress update (\"login form wired, moving to validation tests\")."
                    },
                    "blockers": {
                        "type": "string",
                        "description": "Optional — describe what's blocking you, if anything. Athena uses this to decide whether to pre-empt with guidance."
                    }
                },
                "required": ["progress"]
            }
        },
        {
            "name": "athena.request_guidance",
            "description": "BLOCKING. Ask Athena (the in-app conversational agent) a question and wait for her reply. Use sparingly — only when you're genuinely stuck and cheap retries won't resolve it. Athena sees your operative-memory state including intent, checkpoints, and recent failures.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The specific question. Include enough context that Athena can answer without round-tripping (\"should I use the new auth middleware or extend the existing one?\")."
                    },
                    "context": {
                        "type": "string",
                        "description": "Optional extra context — error tail, conflicting docs, recent decision rationale."
                    }
                },
                "required": ["question"]
            }
        },
        {
            "name": "athena.request_approval",
            "description": "BLOCKING. Propose a destructive or cost-bearing action and wait for explicit approval. The user sees an ApprovalCard in the chat panel; result returns once they approve or deny. Use for: deleting files outside the working tree, force-pushing, calling paid APIs, modifying shared infrastructure.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "Short label for the action (\"force-push to origin/main\", \"delete migration 0042\")."
                    },
                    "rationale": {
                        "type": "string",
                        "description": "Why this is the right thing to do. Goes into the approval card."
                    },
                    "details": {
                        "type": "object",
                        "description": "Optional structured payload (target ref, file paths, API endpoint) for richer card rendering."
                    }
                },
                "required": ["action", "rationale"]
            }
        }
    ])
}

/// Dispatch a `tools/call` to the right handler. Called by
/// [`super::dispatch`].
pub async fn call_tool(
    app: &AppHandle,
    fleet_session_id: &str,
    params: Value,
) -> Result<Value, JsonRpcError> {
    let call: ToolsCallParams =
        serde_json::from_value(params).map_err(|e| invalid_params(format!("invalid params: {e}")))?;

    match call.name.as_str() {
        "athena.report_intent" => report_intent(app, fleet_session_id, call.arguments).await,
        "athena.checkpoint" => checkpoint(app, fleet_session_id, call.arguments).await,
        "athena.request_guidance" => request_guidance(app, fleet_session_id, call.arguments).await,
        "athena.request_approval" => request_approval(app, fleet_session_id, call.arguments).await,
        other => Err(invalid_params(format!("unknown tool: {other}"))),
    }
}

#[derive(Deserialize)]
struct ToolsCallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
}

// ---------------------------------------------------------------------------
// athena.report_intent
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct ReportIntentArgs {
    intent: String,
    role: Option<String>,
    operation_id: Option<String>,
}

async fn report_intent(
    app: &AppHandle,
    fleet_session_id: &str,
    args: Value,
) -> Result<Value, JsonRpcError> {
    let a: ReportIntentArgs =
        serde_json::from_value(args).map_err(|e| invalid_params(format!("invalid args: {e}")))?;
    if a.intent.trim().is_empty() {
        return Err(invalid_params("intent must not be empty"));
    }

    // Pull project_label + cwd from the fleet registry so operative
    // memory can label the op correctly if no SessionRef exists yet.
    let (project_label, cwd) = resolve_session_meta(fleet_session_id);

    let op_id = crate::companion::orchestration::operative_memory::memory().record_intent(
        fleet_session_id,
        a.intent.trim(),
        a.role.as_deref(),
        a.operation_id.as_deref(),
        &project_label,
        &cwd,
    );
    crate::companion::orchestration::emit_digest_changed(app);

    Ok(text_result(format!(
        "intent recorded; operation_id={op_id}"
    )))
}

// ---------------------------------------------------------------------------
// athena.checkpoint
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CheckpointArgs {
    progress: String,
    blockers: Option<String>,
}

async fn checkpoint(
    app: &AppHandle,
    fleet_session_id: &str,
    args: Value,
) -> Result<Value, JsonRpcError> {
    let a: CheckpointArgs =
        serde_json::from_value(args).map_err(|e| invalid_params(format!("invalid args: {e}")))?;
    if a.progress.trim().is_empty() {
        return Err(invalid_params("progress must not be empty"));
    }

    let recorded = crate::companion::orchestration::operative_memory::memory().record_checkpoint(
        fleet_session_id,
        a.progress.trim(),
        a.blockers.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    );
    if !recorded {
        // Race: session unknown to operative memory yet. Treat as
        // soft success — the next state-change event will register
        // the session and Athena can re-query for checkpoints later.
        return Ok(text_result("checkpoint deferred (session not yet registered)"));
    }
    crate::companion::orchestration::emit_digest_changed(app);
    Ok(text_result("checkpoint recorded"))
}

// ---------------------------------------------------------------------------
// athena.request_guidance — BLOCKING
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RequestGuidanceArgs {
    question: String,
    context: Option<String>,
}

async fn request_guidance(
    app: &AppHandle,
    fleet_session_id: &str,
    args: Value,
) -> Result<Value, JsonRpcError> {
    let a: RequestGuidanceArgs =
        serde_json::from_value(args).map_err(|e| invalid_params(format!("invalid args: {e}")))?;
    if a.question.trim().is_empty() {
        return Err(invalid_params("question must not be empty"));
    }

    let (request_id, rx) = pending::submit(fleet_session_id, RequestKind::Guidance);

    let notice = RequestNotice {
        request_id: request_id.clone(),
        fleet_session_id: fleet_session_id.to_string(),
        kind: RequestKind::Guidance,
        payload: json!({
            "question": a.question.trim(),
            "context": a.context,
        }),
    };
    if let Err(e) = app.emit(RequestKind::Guidance.event_name(), &notice) {
        // Drain the pending entry so it doesn't leak.
        pending::resolve(&request_id, Err("emit failed".to_string()));
        return Err(internal_error(format!("failed to emit notice: {e}")));
    }

    match rx.await {
        Ok(Ok(response)) => {
            // Convention: Athena's response is `{ "text": "..." }`.
            let text = response
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Ok(text_result(text))
        }
        Ok(Err(msg)) => Err(internal_error(format!("guidance unavailable: {msg}"))),
        Err(_) => Err(internal_error("guidance channel closed unexpectedly")),
    }
}

// ---------------------------------------------------------------------------
// athena.request_approval — BLOCKING
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RequestApprovalArgs {
    action: String,
    rationale: String,
    details: Option<Value>,
}

async fn request_approval(
    app: &AppHandle,
    fleet_session_id: &str,
    args: Value,
) -> Result<Value, JsonRpcError> {
    let a: RequestApprovalArgs =
        serde_json::from_value(args).map_err(|e| invalid_params(format!("invalid args: {e}")))?;
    if a.action.trim().is_empty() || a.rationale.trim().is_empty() {
        return Err(invalid_params("action and rationale must not be empty"));
    }

    let (request_id, rx) = pending::submit(fleet_session_id, RequestKind::Approval);

    let notice = RequestNotice {
        request_id: request_id.clone(),
        fleet_session_id: fleet_session_id.to_string(),
        kind: RequestKind::Approval,
        payload: json!({
            "action": a.action.trim(),
            "rationale": a.rationale.trim(),
            "details": a.details,
        }),
    };
    if let Err(e) = app.emit(RequestKind::Approval.event_name(), &notice) {
        pending::resolve(&request_id, Err("emit failed".to_string()));
        return Err(internal_error(format!("failed to emit notice: {e}")));
    }

    match rx.await {
        Ok(Ok(response)) => {
            // Convention: response is `{ "approved": bool, "note"?: string }`.
            let approved = response
                .get("approved")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let note = response
                .get("note")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let label = if approved { "APPROVED" } else { "DENIED" };
            let body = if note.is_empty() {
                label.to_string()
            } else {
                format!("{label}: {note}")
            };
            Ok(json!({
                "content": [{ "type": "text", "text": body }],
                "isError": !approved
            }))
        }
        Ok(Err(msg)) => Err(internal_error(format!("approval unavailable: {msg}"))),
        Err(_) => Err(internal_error("approval channel closed unexpectedly")),
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// Look up project_label + cwd for a Fleet session id. Falls back to
/// safe defaults if the session is unknown — the MCP call may race
/// the SessionStart hook, and we'd rather record the intent under a
/// reasonable label than reject it.
fn resolve_session_meta(fleet_session_id: &str) -> (String, String) {
    crate::commands::fleet::registry::registry()
        .lookup_meta(fleet_session_id)
        .unwrap_or_else(|| ("unknown".to_string(), String::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descriptor_list_contains_all_four_tools() {
        let descriptors = tool_descriptors();
        let arr = descriptors.as_array().expect("tools is array");
        let names: Vec<&str> = arr.iter().filter_map(|t| t["name"].as_str()).collect();
        assert!(names.contains(&"athena.report_intent"));
        assert!(names.contains(&"athena.checkpoint"));
        assert!(names.contains(&"athena.request_guidance"));
        assert!(names.contains(&"athena.request_approval"));
        assert_eq!(names.len(), 4);
    }

    #[test]
    fn each_descriptor_has_required_fields() {
        let descriptors = tool_descriptors();
        let arr = descriptors.as_array().unwrap();
        for tool in arr {
            assert!(tool["name"].as_str().is_some(), "name required");
            assert!(tool["description"].as_str().is_some(), "description required");
            let schema = &tool["inputSchema"];
            assert_eq!(schema["type"], "object", "inputSchema must be an object schema");
            assert!(schema["properties"].is_object(), "properties required");
            assert!(schema["required"].is_array(), "required[] is mandatory in our schemas");
        }
    }

    // The two `*_rejects_empty` tests that lived here previously were
    // dropped when D7 added `&AppHandle` parameters to the tool
    // handlers — constructing a real AppHandle in a unit test isn't
    // straightforward, and the empty-string validation they covered
    // is exercised end-to-end by the orchestration Playwright spec.
}
