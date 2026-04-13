//! Wire types for the A2A protocol surface.
//!
//! These structs intentionally use bare `serde` (no `ts_rs::TS`) — they are
//! **outbound HTTP shapes** consumed by external A2A clients, not the desktop
//! frontend, so there's no value in generating TypeScript bindings for them.

use serde::{Deserialize, Serialize};

// =============================================================================
// Agent Card (GET /agent-card/{persona_id})
// =============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct AgentCard {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Canonical `/a2a/{persona_id}` URL for this agent.
    pub url: String,
    /// Personas app version (sourced from `CARGO_PKG_VERSION`).
    pub version: String,
    pub capabilities: AgentCapabilities,
    pub skills: Vec<AgentSkill>,
    pub default_input_modes: Vec<String>,
    pub default_output_modes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentCapabilities {
    /// False — synchronous result only. `message/stream` is out of scope here.
    pub streaming: bool,
    /// False — push delivery is out of scope.
    pub push_notifications: bool,
    /// False — task history is out of scope.
    pub state_transition_history: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub examples: Vec<String>,
    pub input_modes: Vec<String>,
    pub output_modes: Vec<String>,
}

// =============================================================================
// JSON-RPC envelope (POST /a2a/{persona_id})
// =============================================================================

/// Inbound A2A request. The `params` field is intentionally untyped at the
/// envelope level so the dispatch layer in `management_api.rs` can decode it
/// into the per-method shape (`MessageSendParams` for `message/send`,
/// `TaskIdParams` for `tasks/get` and `tasks/cancel`, etc.).
#[derive(Debug, Clone, Deserialize)]
pub struct A2ARequest {
    /// JSON-RPC version field. Accepted on the way in for protocol
    /// conformance but not validated; we always emit `"2.0"` on the way out.
    #[serde(default)]
    #[allow(dead_code)]
    pub jsonrpc: Option<String>,
    /// Echoed back in the response so clients can correlate. Accepts string,
    /// number, or null per the JSON-RPC spec.
    #[serde(default)]
    pub id: Option<serde_json::Value>,
    pub method: String,
    /// Raw params value. Decoded per-method by the dispatcher.
    #[serde(default)]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageSendParams {
    pub message: A2AMessage,
}

/// Params shape for `tasks/get` and `tasks/cancel`. The A2A spec uses a
/// bare `{ "id": "..." }` object for both methods.
#[derive(Debug, Clone, Deserialize)]
pub struct TaskIdParams {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct A2AMessage {
    #[serde(default)]
    #[allow(dead_code)]
    pub role: Option<String>,
    #[serde(default)]
    pub parts: Vec<A2AMessagePart>,
    #[serde(default, rename = "messageId")]
    #[allow(dead_code)]
    pub message_id: Option<String>,
}

/// A part of an A2A message. We currently only handle text parts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2AMessagePart {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
}

impl A2AMessage {
    /// Concatenate every text-typed part into a single string. Parts of other
    /// kinds are ignored. Returns `None` if no text content was found.
    pub fn collect_text(&self) -> Option<String> {
        let combined: String = self
            .parts
            .iter()
            .filter(|p| p.kind.as_deref().unwrap_or("text") == "text")
            .filter_map(|p| p.text.as_deref())
            .collect::<Vec<_>>()
            .join("\n");
        if combined.is_empty() {
            None
        } else {
            Some(combined)
        }
    }
}

// =============================================================================
// JSON-RPC response
// =============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct A2AResponse {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<A2AResultMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<A2AError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2AResultMessage {
    pub kind: &'static str, // "message"
    pub role: &'static str, // "agent"
    pub parts: Vec<A2AResponsePart>,
    #[serde(rename = "messageId")]
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2AResponsePart {
    pub kind: &'static str, // "text"
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2AError {
    pub code: i32,
    pub message: String,
}

// =============================================================================
// Task object (returned by tasks/get and tasks/cancel)
// =============================================================================

/// A2A `Task` object. Personas maps each `executions` row to one task,
/// using the execution_id as the task id.
#[derive(Debug, Clone, Serialize)]
pub struct A2ATask {
    pub id: String,
    /// In the A2A spec, contextId groups related tasks (e.g. a multi-turn
    /// conversation). Personas does not currently model conversation context
    /// at the A2A surface, so we emit a deterministic value derived from
    /// the persona id — clients that need history can use it as a grouping
    /// key but should not rely on it for state lookup.
    #[serde(rename = "contextId")]
    pub context_id: String,
    pub kind: &'static str, // always "task"
    pub status: A2ATaskStatus,
    /// History is not exposed yet — empty array keeps clients happy.
    #[serde(default)]
    pub history: Vec<serde_json::Value>,
    /// Output artifacts when the task is in a terminal state.
    #[serde(default)]
    pub artifacts: Vec<A2AArtifact>,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2ATaskStatus {
    /// One of: "submitted", "working", "completed", "canceled", "failed".
    pub state: &'static str,
    /// Timestamp in RFC3339 format. Best-effort: if the executions row has
    /// no completion time we emit the current time.
    pub timestamp: String,
    /// Optional message attached to the state (used for cancel/failure
    /// reasons). The shape mirrors the spec: a `Message` object with role,
    /// parts, and messageId.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<A2AStatusMessage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2AStatusMessage {
    pub kind: &'static str, // "message"
    pub role: &'static str, // "agent"
    pub parts: Vec<A2AResponsePart>,
    #[serde(rename = "messageId")]
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct A2AArtifact {
    #[serde(rename = "artifactId")]
    pub artifact_id: String,
    pub name: &'static str,
    pub parts: Vec<A2AResponsePart>,
}

/// Translate a personas `executions.status` string into an A2A task state.
///
/// Personas writes statuses like "queued", "running", "completed", "success",
/// "failed", "error", "cancelled", "timeout". The A2A spec's terminal vocabulary
/// is more compact: submitted / working / completed / canceled / failed.
pub fn map_status_to_a2a_state(personas_status: &str) -> &'static str {
    match personas_status {
        "queued" | "submitted" | "pending" => "submitted",
        "running" | "starting" | "in_progress" => "working",
        "completed" | "success" => "completed",
        "cancelled" | "canceled" => "canceled",
        // "timeout" maps to failed (terminal, not user-cancelled). Anything
        // unrecognised falls through to failed so clients always see a
        // terminal state instead of an unknown one.
        _ => "failed",
    }
}

/// Result envelope for `tasks/get` / `tasks/cancel` responses.
#[derive(Debug, Clone, Serialize)]
pub struct A2ATaskResponse {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<A2ATask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<A2AError>,
}

impl A2ATaskResponse {
    pub fn success(id: serde_json::Value, task: A2ATask) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(task),
            error: None,
        }
    }

    pub fn error(id: serde_json::Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(A2AError {
                code,
                message: message.into(),
            }),
        }
    }
}

impl A2AResponse {
    pub fn success(id: serde_json::Value, text: String) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(A2AResultMessage {
                kind: "message",
                role: "agent",
                parts: vec![A2AResponsePart {
                    kind: "text",
                    text,
                }],
                message_id: uuid::Uuid::new_v4().to_string(),
            }),
            error: None,
        }
    }

    pub fn error(id: serde_json::Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(A2AError {
                code,
                message: message.into(),
            }),
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_message_send_request() {
        let raw = r#"{
            "jsonrpc": "2.0",
            "id": "req-1",
            "method": "message/send",
            "params": {
                "message": {
                    "role": "user",
                    "parts": [{ "kind": "text", "text": "hello world" }],
                    "messageId": "msg-1"
                }
            }
        }"#;
        let req: A2ARequest = serde_json::from_str(raw).expect("parse");
        assert_eq!(req.method, "message/send");
        let raw_params = req.params.expect("params");
        let params: MessageSendParams =
            serde_json::from_value(raw_params).expect("decode message send params");
        let text = params.message.collect_text().expect("text");
        assert_eq!(text, "hello world");
    }

    #[test]
    fn parses_tasks_get_request() {
        let raw = r#"{
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tasks/get",
            "params": { "id": "exec-abc" }
        }"#;
        let req: A2ARequest = serde_json::from_str(raw).expect("parse");
        assert_eq!(req.method, "tasks/get");
        let params: TaskIdParams =
            serde_json::from_value(req.params.expect("params")).expect("decode task id params");
        assert_eq!(params.id, "exec-abc");
    }

    #[test]
    fn maps_personas_statuses_to_a2a_states() {
        assert_eq!(map_status_to_a2a_state("queued"), "submitted");
        assert_eq!(map_status_to_a2a_state("running"), "working");
        assert_eq!(map_status_to_a2a_state("completed"), "completed");
        assert_eq!(map_status_to_a2a_state("success"), "completed");
        assert_eq!(map_status_to_a2a_state("cancelled"), "canceled");
        assert_eq!(map_status_to_a2a_state("failed"), "failed");
        assert_eq!(map_status_to_a2a_state("error"), "failed");
        assert_eq!(map_status_to_a2a_state("timeout"), "failed");
        // Unknown / future statuses fall through to a terminal state instead
        // of leaking an A2A-invalid value to the client.
        assert_eq!(map_status_to_a2a_state("nonsense-future-state"), "failed");
    }

    #[test]
    fn task_response_success_serializes_with_correct_shape() {
        let task = A2ATask {
            id: "exec-1".into(),
            context_id: "ctx-persona-1".into(),
            kind: "task",
            status: A2ATaskStatus {
                state: "completed",
                timestamp: "2026-04-13T12:00:00Z".into(),
                message: None,
            },
            history: vec![],
            artifacts: vec![A2AArtifact {
                artifact_id: "out-1".into(),
                name: "result",
                parts: vec![A2AResponsePart {
                    kind: "text",
                    text: "final output".into(),
                }],
            }],
        };
        let resp = A2ATaskResponse::success(serde_json::json!("req-9"), task);
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["id"], "req-9");
        assert_eq!(json["result"]["id"], "exec-1");
        assert_eq!(json["result"]["kind"], "task");
        assert_eq!(json["result"]["status"]["state"], "completed");
        assert_eq!(json["result"]["artifacts"][0]["parts"][0]["text"], "final output");
        assert!(json.get("error").is_none() || json["error"].is_null());
    }

    #[test]
    fn collects_multiple_text_parts() {
        let msg = A2AMessage {
            role: Some("user".into()),
            parts: vec![
                A2AMessagePart { kind: Some("text".into()), text: Some("part one".into()) },
                A2AMessagePart { kind: Some("text".into()), text: Some("part two".into()) },
            ],
            message_id: None,
        };
        assert_eq!(msg.collect_text().as_deref(), Some("part one\npart two"));
    }

    #[test]
    fn ignores_non_text_parts() {
        let msg = A2AMessage {
            role: None,
            parts: vec![
                A2AMessagePart { kind: Some("file".into()), text: Some("ignored".into()) },
                A2AMessagePart { kind: Some("text".into()), text: Some("kept".into()) },
            ],
            message_id: None,
        };
        assert_eq!(msg.collect_text().as_deref(), Some("kept"));
    }

    #[test]
    fn empty_text_returns_none() {
        let msg = A2AMessage { role: None, parts: vec![], message_id: None };
        assert!(msg.collect_text().is_none());
    }

    #[test]
    fn success_response_serializes_with_correct_shape() {
        let resp = A2AResponse::success(serde_json::json!("req-1"), "hi back".into());
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["id"], "req-1");
        assert_eq!(json["result"]["kind"], "message");
        assert_eq!(json["result"]["role"], "agent");
        assert_eq!(json["result"]["parts"][0]["text"], "hi back");
        assert!(json["result"]["messageId"].is_string());
        assert!(json.get("error").is_none() || json["error"].is_null());
    }

    #[test]
    fn error_response_serializes_with_correct_shape() {
        let resp = A2AResponse::error(serde_json::json!(7), -32601, "Method not found");
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["id"], 7);
        assert_eq!(json["error"]["code"], -32601);
        assert_eq!(json["error"]["message"], "Method not found");
        assert!(json.get("result").is_none() || json["result"].is_null());
    }

    #[test]
    fn agent_card_serializes_with_camel_case_field_names_kept_as_is() {
        let card = AgentCard {
            name: "Test".into(),
            description: Some("desc".into()),
            url: "http://localhost:9420/a2a/test".into(),
            version: "1.0.0".into(),
            capabilities: AgentCapabilities {
                streaming: false,
                push_notifications: false,
                state_transition_history: false,
            },
            skills: vec![],
            default_input_modes: vec!["text".into()],
            default_output_modes: vec!["text".into()],
        };
        let json = serde_json::to_value(&card).unwrap();
        assert_eq!(json["name"], "Test");
        assert_eq!(json["url"], "http://localhost:9420/a2a/test");
        assert_eq!(json["capabilities"]["streaming"], false);
        assert_eq!(json["default_input_modes"][0], "text");
    }
}
