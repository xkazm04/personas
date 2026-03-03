use crate::db::models::Persona;
use crate::engine::types::{CliArgs, ModelProfile, StreamLineType};

use super::{CliProvider, PromptDelivery};

/// GitHub Copilot CLI provider.
pub struct CopilotProvider;

/// Platform-specific command and initial args for invoking the Copilot CLI.
fn base_cli_setup() -> (String, Vec<String>) {
    if cfg!(windows) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "copilot.cmd".to_string()],
        )
    } else {
        ("copilot".to_string(), vec![])
    }
}

impl CliProvider for CopilotProvider {
    fn engine_name(&self) -> &'static str {
        "Copilot CLI"
    }

    fn context_file_name(&self) -> &'static str {
        "COPILOT.md"
    }

    fn binary_candidates(&self) -> &[&str] {
        if cfg!(target_os = "windows") {
            &["copilot", "copilot.cmd"]
        } else {
            &["copilot"]
        }
    }

    fn supports_session_resume(&self) -> bool {
        false
    }

    fn prompt_delivery(&self) -> PromptDelivery {
        PromptDelivery::Flag("-p".to_string())
    }

    fn build_execution_args(
        &self,
        _persona: Option<&Persona>,
        model_profile: Option<&ModelProfile>,
    ) -> CliArgs {
        let (command, mut args) = base_cli_setup();

        // copilot -p "<prompt>" --output-format stream-json --yolo
        args.extend([
            "-p".to_string(),
            String::new(), // placeholder — prompt injected by build_execution_args_with_prompt
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--yolo".to_string(),
        ]);

        // Model override
        if let Some(profile) = model_profile {
            if let Some(ref model) = profile.model {
                if !model.is_empty() {
                    args.push("--model".to_string());
                    args.push(model.clone());
                }
            }
        }

        let mut cli_args = CliArgs {
            command,
            args,
            env_overrides: Vec::new(),
            env_removals: Vec::new(),
            cwd: None,
        };

        if let Some(profile) = model_profile {
            self.apply_provider_env(&mut cli_args, profile);
        }

        cli_args
    }

    fn build_execution_args_with_prompt(
        &self,
        persona: Option<&Persona>,
        model_profile: Option<&ModelProfile>,
        prompt_text: &str,
    ) -> CliArgs {
        let mut args = self.build_execution_args(persona, model_profile);
        // Replace the empty placeholder after "-p" with actual prompt text
        let flag_idx = args.args.iter().position(|a| a == "-p");
        if let Some(idx) = flag_idx {
            if idx + 1 < args.args.len() && args.args[idx + 1].is_empty() {
                args.args[idx + 1] = prompt_text.to_string();
            }
        }
        args
    }

    fn build_resume_args(&self, _session_id: &str) -> CliArgs {
        // Resume not supported in Copilot CLI technical preview
        let (command, args) = base_cli_setup();
        CliArgs {
            command,
            args,
            env_overrides: Vec::new(),
            env_removals: Vec::new(),
            cwd: None,
        }
    }

    fn parse_stream_line(&self, line: &str) -> (StreamLineType, Option<String>) {
        // Copilot CLI stream format is not fully documented (technical preview).
        // We handle both Gemini-style and Codex-style events so whichever
        // format the actual CLI emits will be parsed correctly.
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return (StreamLineType::Unknown, None);
        }

        let value: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => return (StreamLineType::Unknown, None),
        };

        let line_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match line_type {
            // ── Gemini-style events ──────────────────────────────────────

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

                if let Some(blocks) = content {
                    for block in blocks {
                        let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        match block_type {
                            "text" => {
                                let text = block
                                    .get("text")
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                if !text.is_empty() {
                                    return (
                                        StreamLineType::AssistantText { text: text.clone() },
                                        Some(text),
                                    );
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
                                let display = format!("> Using tool: {}", name);
                                return (
                                    StreamLineType::AssistantToolUse {
                                        tool_name: name,
                                        input_preview: truncate(&input_preview, 500),
                                    },
                                    Some(display),
                                );
                            }
                            _ => {}
                        }
                    }
                }

                (StreamLineType::Unknown, None)
            }

            "user" => {
                let content = value
                    .pointer("/message/content")
                    .and_then(|c| c.as_array());

                if let Some(blocks) = content {
                    for block in blocks {
                        let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if block_type == "tool_result" {
                            let preview = extract_tool_result_preview(block);
                            let display = format!("  Tool result: {}", truncate(&preview, 200));
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
                let duration_ms = value.get("duration_ms").and_then(|d| d.as_u64());
                let total_cost_usd = value.get("total_cost_usd").and_then(|c| c.as_f64());
                let total_input_tokens = value.get("total_input_tokens").and_then(|t| t.as_u64());
                let total_output_tokens = value.get("total_output_tokens").and_then(|t| t.as_u64());
                let model = value.get("model").and_then(|m| m.as_str()).map(String::from);
                let session_id = value.get("session_id").and_then(|s| s.as_str()).map(String::from);

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

            // ── Codex-style events ───────────────────────────────────────

            "thread.started" => {
                let model = value
                    .get("model")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let session_id = value
                    .get("thread_id")
                    .or_else(|| value.get("session_id"))
                    .and_then(|s| s.as_str())
                    .map(String::from);
                let display = format!("Session started ({})", model);
                (
                    StreamLineType::SystemInit { model, session_id },
                    Some(display),
                )
            }

            t if t.starts_with("item.") => parse_copilot_item(&value),

            "turn.completed" => {
                let usage = value.get("usage");
                let input_tokens = usage
                    .and_then(|u| u.get("input_tokens"))
                    .and_then(|t| t.as_u64());
                let output_tokens = usage
                    .and_then(|u| u.get("output_tokens"))
                    .and_then(|t| t.as_u64());
                let total_cost_usd = value
                    .get("total_cost_usd")
                    .and_then(|c| c.as_f64());
                let model = value
                    .get("model")
                    .and_then(|m| m.as_str())
                    .map(String::from);
                let session_id = value
                    .get("thread_id")
                    .and_then(|s| s.as_str())
                    .map(String::from);

                let mut display = "Completed".to_string();
                if let Some(cost) = total_cost_usd {
                    display.push_str(&format!(" (cost: ${:.4})", cost));
                }

                (
                    StreamLineType::Result {
                        duration_ms: None,
                        total_cost_usd,
                        total_input_tokens: input_tokens,
                        total_output_tokens: output_tokens,
                        model,
                        session_id,
                    },
                    Some(display),
                )
            }

            "error" => {
                let msg = value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                tracing::warn!("Copilot CLI error: {}", msg);
                (StreamLineType::Unknown, None)
            }

            _ => (StreamLineType::Unknown, None),
        }
    }

    fn apply_provider_env(&self, cli_args: &mut CliArgs, profile: &ModelProfile) {
        if let Some(ref auth_token) = profile.auth_token {
            if !auth_token.is_empty() {
                cli_args
                    .env_overrides
                    .push(("GITHUB_TOKEN".to_string(), auth_token.clone()));
            }
        }
    }
}

/// Extract a text preview from a tool_result content block.
fn extract_tool_result_preview(block: &serde_json::Value) -> String {
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
    block.to_string()
}

/// Parse a Copilot `item.*` event (Codex-compatible format).
fn parse_copilot_item(value: &serde_json::Value) -> (StreamLineType, Option<String>) {
    let content = value.get("content").or_else(|| value.get("item").and_then(|i| i.get("content")));

    if let Some(content_arr) = content.and_then(|c| c.as_array()) {
        for block in content_arr {
            let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");

            match block_type {
                "text" | "output_text" => {
                    let text = block
                        .get("text")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !text.is_empty() {
                        return (
                            StreamLineType::AssistantText { text: text.clone() },
                            Some(text),
                        );
                    }
                }
                "function_call" => {
                    let name = block
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let arguments = block
                        .get("arguments")
                        .and_then(|a| a.as_str())
                        .unwrap_or("{}")
                        .to_string();
                    let display = format!("> Using tool: {}", name);
                    return (
                        StreamLineType::AssistantToolUse {
                            tool_name: name,
                            input_preview: truncate(&arguments, 500),
                        },
                        Some(display),
                    );
                }
                "function_call_output" => {
                    let output = block
                        .get("output")
                        .and_then(|o| o.as_str())
                        .unwrap_or("")
                        .to_string();
                    let display = format!("  Tool result: {}", truncate(&output, 200));
                    return (
                        StreamLineType::ToolResult {
                            content_preview: output,
                        },
                        Some(display),
                    );
                }
                _ => {}
            }
        }
    }

    if let Some(text) = value.get("text").and_then(|t| t.as_str()) {
        if !text.is_empty() {
            return (
                StreamLineType::AssistantText { text: text.to_string() },
                Some(text.to_string()),
            );
        }
    }

    (StreamLineType::Unknown, None)
}

fn truncate(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((byte_offset, _)) => format!("{}...", &s[..byte_offset]),
        None => s.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_name() {
        let provider = CopilotProvider;
        assert_eq!(provider.engine_name(), "Copilot CLI");
    }

    #[test]
    fn test_prompt_delivery() {
        let provider = CopilotProvider;
        assert_eq!(provider.prompt_delivery(), PromptDelivery::Flag("-p".to_string()));
    }

    #[test]
    fn test_parse_gemini_style_init() {
        let provider = CopilotProvider;
        let line = r#"{"type":"system","subtype":"init","model":"gpt-5-mini","session_id":"sess-cp"}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::SystemInit { model, session_id } => {
                assert_eq!(model, "gpt-5-mini");
                assert_eq!(session_id, Some("sess-cp".to_string()));
            }
            _ => panic!("Expected SystemInit, got {:?}", st),
        }
        assert!(display.unwrap().contains("gpt-5-mini"));
    }

    #[test]
    fn test_parse_codex_style_thread_started() {
        let provider = CopilotProvider;
        let line = r#"{"type":"thread.started","model":"gpt-5-mini","thread_id":"thread-abc"}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::SystemInit { model, session_id } => {
                assert_eq!(model, "gpt-5-mini");
                assert_eq!(session_id, Some("thread-abc".to_string()));
            }
            _ => panic!("Expected SystemInit, got {:?}", st),
        }
        assert_eq!(display, Some("Session started (gpt-5-mini)".to_string()));
    }

    #[test]
    fn test_parse_assistant_text() {
        let provider = CopilotProvider;
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello from Copilot"}]}}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::AssistantText { text } => {
                assert_eq!(text, "Hello from Copilot");
            }
            _ => panic!("Expected AssistantText, got {:?}", st),
        }
        assert_eq!(display, Some("Hello from Copilot".to_string()));
    }

    #[test]
    fn test_parse_assistant_tool_use() {
        let provider = CopilotProvider;
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"read_file","input":{"path":"main.rs"}}]}}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::AssistantToolUse { tool_name, .. } => {
                assert_eq!(tool_name, "read_file");
            }
            _ => panic!("Expected AssistantToolUse, got {:?}", st),
        }
        assert_eq!(display, Some("> Using tool: read_file".to_string()));
    }

    #[test]
    fn test_parse_item_text() {
        let provider = CopilotProvider;
        let line = r#"{"type":"item.created","content":[{"type":"text","text":"Hello from Copilot"}]}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::AssistantText { text } => {
                assert_eq!(text, "Hello from Copilot");
            }
            _ => panic!("Expected AssistantText, got {:?}", st),
        }
        assert_eq!(display, Some("Hello from Copilot".to_string()));
    }

    #[test]
    fn test_parse_item_function_call() {
        let provider = CopilotProvider;
        let line = r#"{"type":"item.created","content":[{"type":"function_call","name":"shell","arguments":"{\"command\":\"ls\"}"}]}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::AssistantToolUse { tool_name, input_preview } => {
                assert_eq!(tool_name, "shell");
                assert!(input_preview.contains("ls"));
            }
            _ => panic!("Expected AssistantToolUse, got {:?}", st),
        }
        assert_eq!(display, Some("> Using tool: shell".to_string()));
    }

    #[test]
    fn test_parse_result() {
        let provider = CopilotProvider;
        let line = r#"{"type":"result","duration_ms":3000,"total_cost_usd":0.001,"total_input_tokens":5000,"total_output_tokens":1000,"model":"gpt-5-mini"}"#;
        let (st, _) = provider.parse_stream_line(line);

        match st {
            StreamLineType::Result {
                duration_ms,
                total_cost_usd,
                total_input_tokens,
                total_output_tokens,
                ..
            } => {
                assert_eq!(duration_ms, Some(3000));
                assert_eq!(total_cost_usd, Some(0.001));
                assert_eq!(total_input_tokens, Some(5000));
                assert_eq!(total_output_tokens, Some(1000));
            }
            _ => panic!("Expected Result, got {:?}", st),
        }
    }

    #[test]
    fn test_parse_turn_completed() {
        let provider = CopilotProvider;
        let line = r#"{"type":"turn.completed","usage":{"input_tokens":2000,"output_tokens":500},"total_cost_usd":0.05,"model":"gpt-5-mini","thread_id":"thread-xyz"}"#;
        let (st, _) = provider.parse_stream_line(line);

        match st {
            StreamLineType::Result {
                total_cost_usd,
                total_input_tokens,
                total_output_tokens,
                model,
                session_id,
                ..
            } => {
                assert_eq!(total_cost_usd, Some(0.05));
                assert_eq!(total_input_tokens, Some(2000));
                assert_eq!(total_output_tokens, Some(500));
                assert_eq!(model, Some("gpt-5-mini".to_string()));
                assert_eq!(session_id, Some("thread-xyz".to_string()));
            }
            _ => panic!("Expected Result, got {:?}", st),
        }
    }

    #[test]
    fn test_parse_non_json() {
        let provider = CopilotProvider;
        let (st, display) = provider.parse_stream_line("not json");
        assert_eq!(st, StreamLineType::Unknown);
        assert_eq!(display, None);
    }

    #[test]
    fn test_build_execution_args_with_prompt() {
        let provider = CopilotProvider;
        let args = provider.build_execution_args_with_prompt(None, None, "Do the thing");
        assert!(args.args.contains(&"-p".to_string()));
        assert!(args.args.contains(&"Do the thing".to_string()));
        assert!(args.args.contains(&"stream-json".to_string()));
    }

    #[test]
    fn test_build_execution_args_with_model() {
        let provider = CopilotProvider;
        let profile = ModelProfile {
            model: Some("gpt-5-mini".to_string()),
            provider: Some("copilot".to_string()),
            ..Default::default()
        };
        let args = provider.build_execution_args(None, Some(&profile));
        assert!(args.args.contains(&"--model".to_string()));
        assert!(args.args.contains(&"gpt-5-mini".to_string()));
    }

    #[test]
    fn test_apply_provider_env() {
        let provider = CopilotProvider;
        let profile = ModelProfile {
            auth_token: Some("ghp_test123".to_string()),
            ..Default::default()
        };
        let mut cli_args = CliArgs {
            command: "copilot".to_string(),
            args: vec![],
            env_overrides: vec![],
            env_removals: vec![],
            cwd: None,
        };
        provider.apply_provider_env(&mut cli_args, &profile);
        assert_eq!(cli_args.env_overrides.len(), 1);
        assert_eq!(cli_args.env_overrides[0].0, "GITHUB_TOKEN");
        assert_eq!(cli_args.env_overrides[0].1, "ghp_test123");
    }
}
