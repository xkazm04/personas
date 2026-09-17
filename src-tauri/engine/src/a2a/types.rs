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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    /// False — synchronous result only. `message/stream` is out of scope here.
    pub streaming: bool,
    /// False — push delivery is out of scope.
    pub push_notifications: bool,
    /// False — a task's `history` carries its messages (user input, agent
    /// output), not a per-transition state log.
    pub state_transition_history: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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
    /// Groups this message with earlier tasks of the same conversation. When
    /// absent, the gateway falls back to the persona-derived context id.
    #[serde(default, rename = "contextId")]
    pub context_id: Option<String>,
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

/// JSON-RPC response envelope, generic over the per-method result payload.
///
/// Every A2A method answers with the same `{ jsonrpc, id, result?, error? }`
/// shape and only the `result` type varies, so the envelope is written once
/// here and specialised by the aliases below.
#[derive(Debug, Clone, Serialize)]
pub struct A2AEnvelope<T> {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<A2AError>,
}

impl<T> A2AEnvelope<T> {
    pub fn success(id: serde_json::Value, result: T) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
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

/// Response envelope for `message/send`.
pub type A2AResponse = A2AEnvelope<A2AResultMessage>;

/// Response envelope for `tasks/get` / `tasks/cancel`.
pub type A2ATaskResponse = A2AEnvelope<A2ATask>;

#[derive(Debug, Clone, Serialize)]
pub struct A2AResultMessage {
    pub kind: &'static str, // "message"
    pub role: &'static str, // "agent"
    pub parts: Vec<A2AResponsePart>,
    #[serde(rename = "messageId")]
    pub message_id: String,
    /// The task (execution) this reply belongs to, so a client can call
    /// `tasks/get` for its history afterwards.
    #[serde(rename = "taskId", skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(rename = "contextId", skip_serializing_if = "Option::is_none")]
    pub context_id: Option<String>,
}

impl A2AResultMessage {
    /// Build a single-text-part agent message with a fresh message id.
    pub fn text(text: String) -> Self {
        Self {
            kind: "message",
            role: "agent",
            parts: vec![A2AResponsePart { kind: "text", text }],
            message_id: uuid::Uuid::new_v4().to_string(),
            task_id: None,
            context_id: None,
        }
    }

    /// Attach the task and context this reply belongs to.
    pub fn in_task(mut self, task_id: String, context_id: String) -> Self {
        self.task_id = Some(task_id);
        self.context_id = Some(context_id);
        self
    }
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
    /// conversation). It is the `contextId` the client sent on `message/send`
    /// (persisted with the execution's input), or, when it sent none, a
    /// deterministic value derived from the persona id.
    #[serde(rename = "contextId")]
    pub context_id: String,
    pub kind: &'static str, // always "task"
    pub status: A2ATaskStatus,
    /// The task's messages in order: the user's input, then the agent's final
    /// output once the task completed. Built from the execution row by
    /// [`build_task_history`].
    #[serde(default)]
    pub history: Vec<A2AStatusMessage>,
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

/// An A2A `Message` object: a task status message (role `agent`) or one
/// entry of a task's `history` (role `user` or `agent`).
#[derive(Debug, Clone, Serialize)]
pub struct A2AStatusMessage {
    pub kind: &'static str, // "message"
    pub role: &'static str, // "user" | "agent"
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

// =============================================================================
// Conversation context + task history
// =============================================================================

/// Key under which `message/send` stores the conversation's `contextId` in
/// the execution's persisted `input_data`. Only the stored row carries it:
/// the engine is handed the bare `{ "input": .. }` so it never reaches a prompt.
pub const A2A_CONTEXT_INPUT_KEY: &str = "_a2aContextId";

/// Longest client-supplied `contextId` accepted; anything longer is refused
/// as invalid params rather than stored.
pub const MAX_CONTEXT_ID_LEN: usize = 256;

/// The persona-derived context id used when a client sends none.
pub fn default_context_id(persona_id: &str) -> String {
    format!("persona-{persona_id}")
}

/// The `input_data` value persisted for an A2A `message/send`: the text the
/// engine runs on, plus the conversation's context id.
pub fn stored_a2a_input(text: &str, context_id: &str) -> serde_json::Value {
    serde_json::json!({ "input": text, A2A_CONTEXT_INPUT_KEY: context_id })
}

/// The context id persisted with an execution, if it was an A2A run that
/// carried one.
pub fn context_id_from_input(input_data: Option<&str>) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(input_data?).ok()?;
    v.get(A2A_CONTEXT_INPUT_KEY)?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Build a task's `history` from its execution row: the user's input (the
/// `input` string of a JSON input, or the raw text), then the agent's final
/// output when the task completed with one. Message ids are derived from the
/// task id so repeated `tasks/get` calls return the same ids.
pub fn build_task_history(
    task_id: &str,
    input_data: Option<&str>,
    completed_output: Option<&str>,
) -> Vec<A2AStatusMessage> {
    let mut history = Vec::new();
    let input_text = input_data.filter(|s| !s.is_empty()).map(|raw| {
        serde_json::from_str::<serde_json::Value>(raw)
            .ok()
            .and_then(|v| v.get("input").and_then(|i| i.as_str()).map(str::to_string))
            .unwrap_or_else(|| raw.to_string())
    });
    if let Some(text) = input_text.filter(|t| !t.is_empty()) {
        history.push(A2AStatusMessage {
            kind: "message",
            role: "user",
            parts: vec![A2AResponsePart { kind: "text", text }],
            message_id: format!("{task_id}-input"),
        });
    }
    if let Some(out) = completed_output.filter(|o| !o.is_empty()) {
        history.push(A2AStatusMessage {
            kind: "message",
            role: "agent",
            parts: vec![A2AResponsePart {
                kind: "text",
                text: out.to_string(),
            }],
            message_id: format!("{task_id}-output"),
        });
    }
    history
}

/// Translate a personas `executions.status` string into an A2A task state.
///
/// Personas writes statuses like "queued", "running", "completed", "success",
/// "failed", "error", "cancelled", "timeout". The A2A spec's terminal vocabulary
/// is more compact: submitted / working / completed / canceled / failed.
///
/// Unrecognised statuses map to the NON-terminal "working". Every known failure
/// mode is listed explicitly below, so anything left over is by definition a
/// status this function has not been taught yet — most likely a new in-flight
/// state added on the Personas side. Reporting such a task as "failed" is the
/// expensive mistake: "failed" is terminal, so clients stop polling and a live
/// execution is presented as dead. "working" is merely premature — the next
/// poll corrects it once the task reaches a state we do recognise.
pub fn map_status_to_a2a_state(personas_status: &str) -> &'static str {
    match personas_status {
        "queued" | "submitted" | "pending" => "submitted",
        "running" | "starting" | "in_progress" => "working",
        "completed" | "success" => "completed",
        "cancelled" | "canceled" => "canceled",
        // Terminal failures (incl. "timeout" — terminal, not user-cancelled).
        "failed" | "error" | "timeout" => "failed",
        _ => "working",
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
    fn history_carries_user_input_then_agent_output() {
        let stored = stored_a2a_input("what is 2+2?", "ctx-42").to_string();
        let h = build_task_history("exec-1", Some(&stored), Some("4"));
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].role, "user");
        assert_eq!(h[0].parts[0].text, "what is 2+2?");
        assert_eq!(h[0].message_id, "exec-1-input");
        assert_eq!(h[1].role, "agent");
        assert_eq!(h[1].parts[0].text, "4");
        let json = serde_json::to_value(&h).unwrap();
        assert_eq!(json[0]["kind"], "message");
        assert_eq!(json[1]["messageId"], "exec-1-output");
    }

    #[test]
    fn history_without_output_has_only_the_input_and_raw_input_is_kept() {
        let h = build_task_history("exec-2", Some("plain text, not json"), None);
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].parts[0].text, "plain text, not json");
        assert!(build_task_history("exec-3", None, Some("")).is_empty());
    }

    #[test]
    fn context_id_round_trips_through_the_stored_input() {
        let stored = stored_a2a_input("hi", "conv-7").to_string();
        assert_eq!(
            context_id_from_input(Some(&stored)).as_deref(),
            Some("conv-7")
        );
        assert_eq!(context_id_from_input(Some(r#"{"input":"hi"}"#)), None);
        assert_eq!(context_id_from_input(Some("not json")), None);
        assert_eq!(context_id_from_input(None), None);
        assert_eq!(default_context_id("p1"), "persona-p1");
    }

    #[test]
    fn message_send_params_accept_context_id_and_reply_names_the_task() {
        let p: MessageSendParams = serde_json::from_value(serde_json::json!({
            "message": { "role": "user", "contextId": "conv-1",
                         "parts": [{ "kind": "text", "text": "hi" }] }
        }))
        .unwrap();
        assert_eq!(p.message.context_id.as_deref(), Some("conv-1"));
        let reply = A2AResultMessage::text("yo".into()).in_task("exec-9".into(), "conv-1".into());
        let json = serde_json::to_value(&reply).unwrap();
        assert_eq!(json["taskId"], "exec-9");
        assert_eq!(json["contextId"], "conv-1");
        let bare = serde_json::to_value(A2AResultMessage::text("yo".into())).unwrap();
        assert!(bare.get("taskId").is_none());
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
        // Unknown / future statuses fall through to a NON-terminal state: a
        // client that is told "failed" stops polling, which would strand a
        // still-running execution. "working" self-corrects on the next poll.
        assert_eq!(map_status_to_a2a_state("nonsense-future-state"), "working");
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
        assert_eq!(
            json["result"]["artifacts"][0]["parts"][0]["text"],
            "final output"
        );
        assert!(json.get("error").is_none() || json["error"].is_null());
    }

    #[test]
    fn collects_multiple_text_parts() {
        let msg = A2AMessage {
            role: Some("user".into()),
            parts: vec![
                A2AMessagePart {
                    kind: Some("text".into()),
                    text: Some("part one".into()),
                },
                A2AMessagePart {
                    kind: Some("text".into()),
                    text: Some("part two".into()),
                },
            ],
            message_id: None,
            context_id: None,
        };
        assert_eq!(msg.collect_text().as_deref(), Some("part one\npart two"));
    }

    #[test]
    fn ignores_non_text_parts() {
        let msg = A2AMessage {
            role: None,
            parts: vec![
                A2AMessagePart {
                    kind: Some("file".into()),
                    text: Some("ignored".into()),
                },
                A2AMessagePart {
                    kind: Some("text".into()),
                    text: Some("kept".into()),
                },
            ],
            message_id: None,
            context_id: None,
        };
        assert_eq!(msg.collect_text().as_deref(), Some("kept"));
    }

    #[test]
    fn empty_text_returns_none() {
        let msg = A2AMessage {
            role: None,
            parts: vec![],
            message_id: None,
            context_id: None,
        };
        assert!(msg.collect_text().is_none());
    }

    #[test]
    fn success_response_serializes_with_correct_shape() {
        let resp = A2AResponse::success(
            serde_json::json!("req-1"),
            A2AResultMessage::text("hi back".into()),
        );
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
    fn agent_card_serializes_field_names_in_spec_camel_case() {
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
            skills: vec![AgentSkill {
                id: "skill-1".into(),
                name: "Skill".into(),
                description: "does a thing".into(),
                tags: vec![],
                examples: vec![],
                input_modes: vec!["text".into()],
                output_modes: vec!["text".into()],
            }],
            default_input_modes: vec!["text".into()],
            default_output_modes: vec!["text".into()],
        };
        let json = serde_json::to_value(&card).unwrap();
        assert_eq!(json["name"], "Test");
        assert_eq!(json["url"], "http://localhost:9420/a2a/test");
        // The A2A spec names every multi-word field in camelCase; snake_case
        // keys are simply invisible to a conformant client.
        assert_eq!(json["defaultInputModes"][0], "text");
        assert_eq!(json["defaultOutputModes"][0], "text");
        assert!(json.get("default_input_modes").is_none());
        assert!(json.get("default_output_modes").is_none());
        assert_eq!(json["capabilities"]["streaming"], false);
        assert_eq!(json["capabilities"]["pushNotifications"], false);
        assert_eq!(json["capabilities"]["stateTransitionHistory"], false);
        assert!(json["capabilities"].get("push_notifications").is_none());
        assert!(json["capabilities"]
            .get("state_transition_history")
            .is_none());
        assert_eq!(json["skills"][0]["inputModes"][0], "text");
        assert_eq!(json["skills"][0]["outputModes"][0], "text");
        assert!(json["skills"][0].get("input_modes").is_none());
        assert!(json["skills"][0].get("output_modes").is_none());
    }
}
