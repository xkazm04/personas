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

/// Inbound A2A request. We accept any of the known method names but only
/// `message/send` is implemented; other methods return JSON-RPC -32601.
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
    #[serde(default)]
    pub params: Option<MessageSendParams>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageSendParams {
    pub message: A2AMessage,
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
        let params = req.params.expect("params");
        let text = params.message.collect_text().expect("text");
        assert_eq!(text, "hello world");
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
