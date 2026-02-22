use std::collections::HashMap;
use super::types::{ExecutionMetrics, ProtocolMessage, StreamLineType};

const MAX_TOOL_INPUT_DISPLAY: usize = 500;
const MAX_TOOL_RESULT_DISPLAY: usize = 200;

/// Truncate a string to `max_len` characters, appending "..." if truncated.
fn truncate_field(text: &str, max_len: usize) -> String {
    if text.len() > max_len {
        format!("{}...", &text[..max_len])
    } else {
        text.to_string()
    }
}

/// Parse a single stdout JSON line from Claude CLI stream-json format.
///
/// Returns a tuple of (StreamLineType, Option<display_string>).
/// The display string is a human-readable representation suitable for log output.
pub fn parse_stream_line(line: &str) -> (StreamLineType, Option<String>) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return (StreamLineType::Unknown, None);
    }

    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            // Non-JSON line — show as-is
            return (StreamLineType::Unknown, Some(trimmed.to_string()));
        }
    };

    let line_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");

    match line_type {
        "system" => {
            let subtype = value.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
            if subtype == "init" {
                let model = value
                    .get("model")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let session_id = value
                    .get("session_id")
                    .and_then(|s| s.as_str())
                    .map(String::from);
                let display = format!("Session started ({})", model);
                (
                    StreamLineType::SystemInit { model, session_id },
                    Some(display),
                )
            } else {
                (StreamLineType::Unknown, None)
            }
        }
        "assistant" => {
            let content = value
                .pointer("/message/content")
                .and_then(|c| c.as_array());

            match content {
                Some(blocks) => {
                    let mut first_type: Option<StreamLineType> = None;
                    let mut all_text = String::new();
                    let mut tool_display: Option<String> = None;

                    for block in blocks {
                        let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        match block_type {
                            "text" => {
                                let text = block
                                    .get("text")
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                if !all_text.is_empty() {
                                    all_text.push('\n');
                                }
                                all_text.push_str(&text);
                                if first_type.is_none() {
                                    first_type =
                                        Some(StreamLineType::AssistantText { text: text.clone() });
                                }
                            }
                            "tool_use" => {
                                let name = block
                                    .get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                let input_json = block.get("input").cloned().unwrap_or(serde_json::Value::Null);
                                let input_preview = serde_json::to_string(&input_json).unwrap_or_default();
                                let input_preview_truncated = truncate_field(&input_preview, MAX_TOOL_INPUT_DISPLAY);
                                let display = format!("> Using tool: {}", name);
                                if first_type.is_none() {
                                    first_type = Some(StreamLineType::AssistantToolUse {
                                        tool_name: name,
                                        input_preview: input_preview_truncated,
                                    });
                                    tool_display = Some(display);
                                } else if tool_display.is_none() {
                                    tool_display = Some(display);
                                }
                            }
                            _ => {}
                        }
                    }

                    match first_type {
                        Some(ref st) => match st {
                            StreamLineType::AssistantText { .. } => {
                                let display = if all_text.is_empty() {
                                    None
                                } else {
                                    Some(all_text)
                                };
                                (first_type.unwrap(), display)
                            }
                            StreamLineType::AssistantToolUse { .. } => {
                                (first_type.unwrap(), tool_display)
                            }
                            _ => (StreamLineType::Unknown, None),
                        },
                        None => (StreamLineType::Unknown, None),
                    }
                }
                None => (StreamLineType::Unknown, None),
            }
        }
        "user" => {
            // Check for tool_result content
            let content = value
                .pointer("/message/content")
                .and_then(|c| c.as_array());

            if let Some(blocks) = content {
                for block in blocks {
                    let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if block_type == "tool_result" {
                        let preview = extract_tool_result_preview(block);
                        let truncated = truncate_field(&preview, MAX_TOOL_RESULT_DISPLAY);
                        let display = format!("  Tool result: {}", truncated);
                        return (
                            StreamLineType::ToolResult {
                                content_preview: preview,
                            },
                            Some(display),
                        );
                    }
                }
            }

            (StreamLineType::Unknown, None)
        }
        "result" => {
            let duration_ms = value
                .get("duration_ms")
                .and_then(|d| d.as_u64());
            let total_cost_usd = value
                .get("total_cost_usd")
                .and_then(|c| c.as_f64());
            let total_input_tokens = value
                .get("total_input_tokens")
                .and_then(|t| t.as_u64());
            let total_output_tokens = value
                .get("total_output_tokens")
                .and_then(|t| t.as_u64());
            let model = value
                .get("model")
                .and_then(|m| m.as_str())
                .map(String::from);
            let session_id = value
                .get("session_id")
                .and_then(|s| s.as_str())
                .map(String::from);

            let mut display = String::new();
            if let Some(ms) = duration_ms {
                let secs = ms as f64 / 1000.0;
                display.push_str(&format!("Completed in {:.1}s", secs));
            } else {
                display.push_str("Completed");
            }
            if let Some(cost) = total_cost_usd {
                display.push_str(&format!(" (cost: ${:.4})", cost));
            }

            (
                StreamLineType::Result {
                    duration_ms,
                    total_cost_usd,
                    total_input_tokens,
                    total_output_tokens,
                    model,
                    session_id,
                },
                Some(display),
            )
        }
        _ => (StreamLineType::Unknown, None),
    }
}

/// Extract a text preview from a tool_result content block.
fn extract_tool_result_preview(block: &serde_json::Value) -> String {
    // tool_result content can be a string or array of content blocks
    if let Some(content) = block.get("content") {
        if let Some(s) = content.as_str() {
            return s.to_string();
        }
        if let Some(arr) = content.as_array() {
            let mut parts = Vec::new();
            for item in arr {
                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                    parts.push(text.to_string());
                }
            }
            return parts.join(" ");
        }
    }
    // Fallback: stringify the whole block
    block.to_string()
}

/// Helper: extract an optional string field from a JSON value.
fn str_field(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|f| f.as_str()).map(String::from)
}

/// Helper: extract a required string field, defaulting to "" if missing.
fn str_field_or(v: &serde_json::Value, key: &str, default: &str) -> String {
    v.get(key)
        .and_then(|f| f.as_str())
        .unwrap_or(default)
        .to_string()
}

/// Helper: extract an optional string array field from a JSON value.
fn str_array_field(v: &serde_json::Value, key: &str) -> Option<Vec<String>> {
    v.get(key).and_then(|f| {
        f.as_array().map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
    })
}

/// Protocol message parsers keyed by their JSON wrapper field name.
#[allow(clippy::type_complexity)]
const PROTOCOL_KEYS: &[(&str, fn(&serde_json::Value) -> Option<ProtocolMessage>)] = &[
    ("user_message", parse_user_message),
    ("persona_action", parse_persona_action),
    ("emit_event", parse_emit_event),
    ("agent_memory", parse_agent_memory),
    ("manual_review", parse_manual_review),
    ("execution_flow", parse_execution_flow),
];

fn parse_user_message(msg: &serde_json::Value) -> Option<ProtocolMessage> {
    Some(ProtocolMessage::UserMessage {
        title: str_field(msg, "title"),
        content: str_field_or(msg, "content", ""),
        content_type: str_field(msg, "content_type"),
        priority: str_field(msg, "priority"),
    })
}

fn parse_persona_action(msg: &serde_json::Value) -> Option<ProtocolMessage> {
    Some(ProtocolMessage::PersonaAction {
        target: str_field_or(msg, "target", ""),
        action: str_field(msg, "action"),
        input: msg.get("input").cloned(),
    })
}

fn parse_emit_event(msg: &serde_json::Value) -> Option<ProtocolMessage> {
    Some(ProtocolMessage::EmitEvent {
        event_type: str_field_or(msg, "type", ""),
        data: msg.get("data").cloned(),
    })
}

fn parse_agent_memory(msg: &serde_json::Value) -> Option<ProtocolMessage> {
    Some(ProtocolMessage::AgentMemory {
        title: str_field_or(msg, "title", ""),
        content: str_field_or(msg, "content", ""),
        category: str_field(msg, "category"),
        importance: msg.get("importance").and_then(|v| v.as_i64()).map(|n| n as i32),
        tags: str_array_field(msg, "tags"),
    })
}

fn parse_manual_review(msg: &serde_json::Value) -> Option<ProtocolMessage> {
    Some(ProtocolMessage::ManualReview {
        title: str_field_or(msg, "title", ""),
        description: str_field(msg, "description"),
        severity: str_field(msg, "severity"),
        context_data: str_field(msg, "context_data"),
        suggested_actions: str_array_field(msg, "suggested_actions"),
    })
}

fn parse_execution_flow(msg: &serde_json::Value) -> Option<ProtocolMessage> {
    let flows = msg.get("flows").cloned().unwrap_or(serde_json::Value::Null);
    Some(ProtocolMessage::ExecutionFlow { flows })
}

/// Check if a trimmed line is a known protocol JSON message.
///
/// Returns the parsed protocol message, or None if not a protocol message
/// or if parsing fails.
pub fn extract_protocol_message(line: &str) -> Option<ProtocolMessage> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    for &(key, parser_fn) in PROTOCOL_KEYS {
        // Fast prefix check: {"key": or {"key" :
        if trimmed.starts_with(&format!("{{\"{}\":", key))
            || trimmed.starts_with(&format!("{{\"{}\" :", key))
        {
            let wrapper: serde_json::Value = serde_json::from_str(trimmed).ok()?;
            let msg = wrapper.get(key)?;
            return parser_fn(msg);
        }
    }

    None
}

/// Scan accumulated assistant text for execution_flow JSON and return raw JSON string.
pub fn extract_execution_flows(text: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("{\"execution_flow\":") || trimmed.starts_with("{\"execution_flow\" :") {
            // Validate it's parseable JSON before returning
            if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Parse the outcome_assessment JSON from accumulated assistant text.
///
/// Returns `Some((accomplished, summary))` if found, `None` otherwise.
pub fn parse_outcome_assessment(text: &str) -> Option<(bool, String)> {
    for line in text.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with("{\"outcome_assessment\":")
            || trimmed.starts_with("{\"outcome_assessment\" :")
        {
            let wrapper: serde_json::Value = serde_json::from_str(trimmed).ok()?;
            let msg = wrapper.get("outcome_assessment")?;
            let accomplished = msg.get("accomplished")?.as_bool()?;
            let summary = msg
                .get("summary")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            return Some((accomplished, summary));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/// Update accumulated execution metrics from a Result stream line.
pub fn update_metrics_from_result(metrics: &mut ExecutionMetrics, line_type: &StreamLineType) {
    if let StreamLineType::Result {
        total_cost_usd,
        total_input_tokens,
        total_output_tokens,
        model,
        session_id,
        ..
    } = line_type
    {
        if let Some(cost) = total_cost_usd {
            metrics.cost_usd = *cost;
        }
        if let Some(input) = total_input_tokens {
            metrics.input_tokens = *input;
        }
        if let Some(output) = total_output_tokens {
            metrics.output_tokens = *output;
        }
        if let Some(ref m) = model {
            metrics.model_used = Some(m.clone());
        }
        if let Some(ref sid) = session_id {
            metrics.session_id = Some(sid.clone());
        }
    }
}

/// Check if stderr text indicates a session/rate limit error.
pub fn is_session_limit_error(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("session limit")
        || lower.contains("rate limit")
        || lower.contains("usage limit")
        || lower.contains("quota exceeded")
        || lower.contains("too many requests")
}

/// Count tool usage occurrences from a list of parsed stream line types.
pub fn count_tool_usage(lines: &[StreamLineType]) -> HashMap<String, u32> {
    let mut counts = HashMap::new();
    for line in lines {
        if let StreamLineType::AssistantToolUse { tool_name, .. } = line {
            *counts.entry(tool_name.clone()).or_insert(0) += 1;
        }
    }
    counts
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_system_init() {
        let line = r#"{"type":"system","subtype":"init","model":"claude-sonnet-4-20250514","session_id":"sess-123"}"#;
        let (st, display) = parse_stream_line(line);

        match st {
            StreamLineType::SystemInit { model, session_id } => {
                assert_eq!(model, "claude-sonnet-4-20250514");
                assert_eq!(session_id, Some("sess-123".to_string()));
            }
            _ => panic!("Expected SystemInit, got {:?}", st),
        }
        assert_eq!(display, Some("Session started (claude-sonnet-4-20250514)".to_string()));
    }

    #[test]
    fn test_parse_assistant_text() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello world"}]}}"#;
        let (st, display) = parse_stream_line(line);

        match st {
            StreamLineType::AssistantText { text } => {
                assert_eq!(text, "Hello world");
            }
            _ => panic!("Expected AssistantText, got {:?}", st),
        }
        assert_eq!(display, Some("Hello world".to_string()));
    }

    #[test]
    fn test_parse_assistant_tool_use() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"read_file","id":"t1","input":{}}]}}"#;
        let (st, display) = parse_stream_line(line);

        match st {
            StreamLineType::AssistantToolUse { tool_name, input_preview } => {
                assert_eq!(tool_name, "read_file");
                assert_eq!(input_preview, "{}");
            }
            _ => panic!("Expected AssistantToolUse, got {:?}", st),
        }
        assert_eq!(display, Some("> Using tool: read_file".to_string()));
    }

    #[test]
    fn test_parse_result_with_metrics() {
        let line = r#"{"type":"result","duration_ms":5200,"total_cost_usd":0.0123,"total_input_tokens":1500,"total_output_tokens":800,"model":"claude-sonnet-4-20250514","session_id":"sess-456"}"#;
        let (st, display) = parse_stream_line(line);

        match st {
            StreamLineType::Result {
                duration_ms,
                total_cost_usd,
                total_input_tokens,
                total_output_tokens,
                model,
                session_id,
            } => {
                assert_eq!(duration_ms, Some(5200));
                assert_eq!(total_cost_usd, Some(0.0123));
                assert_eq!(total_input_tokens, Some(1500));
                assert_eq!(total_output_tokens, Some(800));
                assert_eq!(model, Some("claude-sonnet-4-20250514".to_string()));
                assert_eq!(session_id, Some("sess-456".to_string()));
            }
            _ => panic!("Expected Result, got {:?}", st),
        }
        let disp = display.unwrap();
        assert!(disp.contains("Completed in 5.2s"));
        assert!(disp.contains("cost: $0.0123"));
    }

    #[test]
    fn test_parse_tool_result() {
        let line = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"File contents here: some data"}]}}"#;
        let (st, display) = parse_stream_line(line);

        match st {
            StreamLineType::ToolResult { content_preview } => {
                assert_eq!(content_preview, "File contents here: some data");
            }
            _ => panic!("Expected ToolResult, got {:?}", st),
        }
        let disp = display.unwrap();
        assert!(disp.starts_with("  Tool result: "));
    }

    #[test]
    fn test_parse_non_json_line() {
        let line = "This is just regular text output";
        let (st, display) = parse_stream_line(line);

        assert_eq!(st, StreamLineType::Unknown);
        assert_eq!(display, Some("This is just regular text output".to_string()));
    }

    #[test]
    fn test_parse_empty_line() {
        let (st, display) = parse_stream_line("");
        assert_eq!(st, StreamLineType::Unknown);
        assert_eq!(display, None);

        let (st2, display2) = parse_stream_line("   ");
        assert_eq!(st2, StreamLineType::Unknown);
        assert_eq!(display2, None);
    }

    #[test]
    fn test_parse_assistant_multi_content() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Let me check that."},{"type":"tool_use","name":"bash","id":"t2","input":{"command":"ls"}}]}}"#;
        let (st, display) = parse_stream_line(line);

        // First content block is text, so should return AssistantText
        match st {
            StreamLineType::AssistantText { text } => {
                assert_eq!(text, "Let me check that.");
            }
            _ => panic!("Expected AssistantText for first block, got {:?}", st),
        }
        // Display should contain the text
        let disp = display.unwrap();
        assert!(disp.contains("Let me check that."));
    }

    #[test]
    fn test_extract_user_message() {
        let line = r#"{"user_message": {"title": "Status Update", "content": "Task completed", "content_type": "success", "priority": "normal"}}"#;
        let msg = extract_protocol_message(line).unwrap();

        match msg {
            ProtocolMessage::UserMessage {
                title,
                content,
                content_type,
                priority,
            } => {
                assert_eq!(title, Some("Status Update".to_string()));
                assert_eq!(content, "Task completed");
                assert_eq!(content_type, Some("success".to_string()));
                assert_eq!(priority, Some("normal".to_string()));
            }
            _ => panic!("Expected UserMessage, got {:?}", msg),
        }
    }

    #[test]
    fn test_extract_persona_action() {
        let line = r#"{"persona_action": {"target": "reviewer-bot", "action": "run", "input": {"files": ["main.rs"]}}}"#;
        let msg = extract_protocol_message(line).unwrap();

        match msg {
            ProtocolMessage::PersonaAction {
                target,
                action,
                input,
            } => {
                assert_eq!(target, "reviewer-bot");
                assert_eq!(action, Some("run".to_string()));
                assert!(input.is_some());
                let inp = input.unwrap();
                assert!(inp.get("files").is_some());
            }
            _ => panic!("Expected PersonaAction, got {:?}", msg),
        }
    }

    #[test]
    fn test_extract_emit_event() {
        let line = r#"{"emit_event": {"type": "build_completed", "data": {"success": true}}}"#;
        let msg = extract_protocol_message(line).unwrap();

        match msg {
            ProtocolMessage::EmitEvent { event_type, data } => {
                assert_eq!(event_type, "build_completed");
                assert!(data.is_some());
                let d = data.unwrap();
                assert_eq!(d.get("success").and_then(|v| v.as_bool()), Some(true));
            }
            _ => panic!("Expected EmitEvent, got {:?}", msg),
        }
    }

    #[test]
    fn test_extract_agent_memory() {
        let line = r#"{"agent_memory": {"title": "API Pattern", "content": "Use REST conventions", "category": "learning", "importance": 8, "tags": ["api", "patterns"]}}"#;
        let msg = extract_protocol_message(line).unwrap();

        match msg {
            ProtocolMessage::AgentMemory {
                title,
                content,
                category,
                importance,
                tags,
            } => {
                assert_eq!(title, "API Pattern");
                assert_eq!(content, "Use REST conventions");
                assert_eq!(category, Some("learning".to_string()));
                assert_eq!(importance, Some(8));
                assert_eq!(
                    tags,
                    Some(vec!["api".to_string(), "patterns".to_string()])
                );
            }
            _ => panic!("Expected AgentMemory, got {:?}", msg),
        }
    }

    #[test]
    fn test_extract_regular_text() {
        assert!(extract_protocol_message("Just some regular text").is_none());
        assert!(extract_protocol_message("console.log('hello')").is_none());
        assert!(extract_protocol_message("").is_none());
        assert!(extract_protocol_message("{}").is_none());
        assert!(extract_protocol_message(r#"{"other_key": "value"}"#).is_none());
    }

    #[test]
    fn test_extract_malformed_json() {
        // Starts with the right prefix but is not valid JSON
        assert!(extract_protocol_message(r#"{"user_message": not json}"#).is_none());
        assert!(extract_protocol_message(r#"{"persona_action": {broken"#).is_none());
        assert!(extract_protocol_message(r#"{"emit_event": }"#).is_none());
        assert!(extract_protocol_message(r#"{"agent_memory": [1,2,3]"#).is_none());
    }

    #[test]
    fn test_extract_execution_flows_present() {
        let text = r#"Starting work...
{"execution_flow": {"flows": [{"step": 1, "action": "analyze"}, {"step": 2, "action": "implement"}]}}
Finished."#;

        let flow = extract_execution_flows(text);
        assert!(flow.is_some());
        let flow_str = flow.unwrap();
        assert!(flow_str.contains("execution_flow"));
        assert!(flow_str.contains("analyze"));
    }

    #[test]
    fn test_extract_execution_flows_absent() {
        let text = "No flows here\nJust text\nNothing special";
        assert!(extract_execution_flows(text).is_none());
    }

    #[test]
    fn test_is_session_limit_error() {
        // Should match
        assert!(is_session_limit_error("Error: session limit reached"));
        assert!(is_session_limit_error("rate limit exceeded"));
        assert!(is_session_limit_error("Usage Limit: you have exceeded your quota"));
        assert!(is_session_limit_error("Quota exceeded for this billing period"));
        assert!(is_session_limit_error("Too many requests, please slow down"));

        // Case insensitive
        assert!(is_session_limit_error("SESSION LIMIT HIT"));
        assert!(is_session_limit_error("Rate Limit Error"));

        // Should not match
        assert!(!is_session_limit_error("Command not found"));
        assert!(!is_session_limit_error("File not found"));
        assert!(!is_session_limit_error(""));
        assert!(!is_session_limit_error("Everything is fine"));
    }

    #[test]
    fn test_update_metrics_from_result() {
        let mut metrics = ExecutionMetrics::default();
        assert_eq!(metrics.cost_usd, 0.0);
        assert_eq!(metrics.input_tokens, 0);

        let result = StreamLineType::Result {
            duration_ms: Some(3000),
            total_cost_usd: Some(0.05),
            total_input_tokens: Some(2000),
            total_output_tokens: Some(500),
            model: Some("claude-sonnet-4-20250514".to_string()),
            session_id: Some("sess-789".to_string()),
        };

        update_metrics_from_result(&mut metrics, &result);

        assert_eq!(metrics.cost_usd, 0.05);
        assert_eq!(metrics.input_tokens, 2000);
        assert_eq!(metrics.output_tokens, 500);
        assert_eq!(metrics.model_used, Some("claude-sonnet-4-20250514".to_string()));
        assert_eq!(metrics.session_id, Some("sess-789".to_string()));

        // Non-Result type should not change metrics
        let text_line = StreamLineType::AssistantText {
            text: "hello".into(),
        };
        update_metrics_from_result(&mut metrics, &text_line);
        // Values unchanged
        assert_eq!(metrics.cost_usd, 0.05);
        assert_eq!(metrics.input_tokens, 2000);
    }

    #[test]
    fn test_parse_outcome_assessment_accomplished() {
        let text = "Doing work...\n{\"outcome_assessment\": {\"accomplished\": true, \"summary\": \"All tasks completed\"}}\nDone.";
        let result = parse_outcome_assessment(text);
        assert!(result.is_some());
        let (accomplished, summary) = result.unwrap();
        assert!(accomplished);
        assert_eq!(summary, "All tasks completed");
    }

    #[test]
    fn test_parse_outcome_assessment_not_accomplished() {
        let text = "Trying...\n{\"outcome_assessment\": {\"accomplished\": false, \"summary\": \"API was unreachable\", \"blockers\": [\"connection refused\"]}}\n";
        let result = parse_outcome_assessment(text);
        assert!(result.is_some());
        let (accomplished, summary) = result.unwrap();
        assert!(!accomplished);
        assert_eq!(summary, "API was unreachable");
    }

    #[test]
    fn test_parse_outcome_assessment_absent() {
        let text = "Just some output\nNo assessment here\nDone.";
        assert!(parse_outcome_assessment(text).is_none());
    }
}
