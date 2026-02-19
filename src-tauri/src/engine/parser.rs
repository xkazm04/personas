use std::collections::HashMap;
use super::types::{ExecutionMetrics, ProtocolMessage, StreamLineType};

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
                                let input_preview_truncated = if input_preview.len() > 500 {
                                    format!("{}...", &input_preview[..500])
                                } else {
                                    input_preview
                                };
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
                        let truncated = if preview.len() > 200 {
                            format!("{}...", &preview[..200])
                        } else {
                            preview.clone()
                        };
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

/// Check if a trimmed line is a known protocol JSON message.
///
/// Returns the parsed protocol message, or None if not a protocol message
/// or if parsing fails.
pub fn extract_protocol_message(line: &str) -> Option<ProtocolMessage> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with("{\"user_message\":") || trimmed.starts_with("{\"user_message\" :") {
        let wrapper: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        let msg = wrapper.get("user_message")?;
        Some(ProtocolMessage::UserMessage {
            title: msg.get("title").and_then(|v| v.as_str()).map(String::from),
            content: msg
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            content_type: msg
                .get("content_type")
                .and_then(|v| v.as_str())
                .map(String::from),
            priority: msg
                .get("priority")
                .and_then(|v| v.as_str())
                .map(String::from),
        })
    } else if trimmed.starts_with("{\"persona_action\":")
        || trimmed.starts_with("{\"persona_action\" :")
    {
        let wrapper: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        let msg = wrapper.get("persona_action")?;
        Some(ProtocolMessage::PersonaAction {
            target: msg
                .get("target")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            action: msg
                .get("action")
                .and_then(|v| v.as_str())
                .map(String::from),
            input: msg.get("input").cloned(),
        })
    } else if trimmed.starts_with("{\"emit_event\":") || trimmed.starts_with("{\"emit_event\" :") {
        let wrapper: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        let msg = wrapper.get("emit_event")?;
        Some(ProtocolMessage::EmitEvent {
            event_type: msg
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            data: msg.get("data").cloned(),
        })
    } else if trimmed.starts_with("{\"agent_memory\":")
        || trimmed.starts_with("{\"agent_memory\" :")
    {
        let wrapper: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        let msg = wrapper.get("agent_memory")?;
        Some(ProtocolMessage::AgentMemory {
            title: msg
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            content: msg
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            category: msg
                .get("category")
                .and_then(|v| v.as_str())
                .map(String::from),
            importance: msg.get("importance").and_then(|v| v.as_i64()).map(|n| n as i32),
            tags: msg.get("tags").and_then(|v| {
                v.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().map(String::from))
                        .collect()
                })
            }),
        })
    } else if trimmed.starts_with("{\"manual_review\":")
        || trimmed.starts_with("{\"manual_review\" :")
    {
        let wrapper: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        let msg = wrapper.get("manual_review")?;
        Some(ProtocolMessage::ManualReview {
            title: msg
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            description: msg
                .get("description")
                .and_then(|v| v.as_str())
                .map(String::from),
            severity: msg
                .get("severity")
                .and_then(|v| v.as_str())
                .map(String::from),
            context_data: msg
                .get("context_data")
                .and_then(|v| v.as_str())
                .map(String::from),
            suggested_actions: msg.get("suggested_actions").and_then(|v| {
                v.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().map(String::from))
                        .collect()
                })
            }),
        })
    } else if trimmed.starts_with("{\"execution_flow\":")
        || trimmed.starts_with("{\"execution_flow\" :")
    {
        let wrapper: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        let msg = wrapper.get("execution_flow")?;
        let flows = msg.get("flows").cloned().unwrap_or(serde_json::Value::Null);
        Some(ProtocolMessage::ExecutionFlow { flows })
    } else {
        None
    }
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
}
