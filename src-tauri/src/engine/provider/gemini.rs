use crate::db::models::Persona;
use crate::engine::types::{CliArgs, ModelProfile, StreamLineType};

use super::{CliProvider, PromptDelivery};

/// Gemini CLI provider (Google's Gemini agent).
pub struct GeminiProvider;

/// Platform-specific command and initial args for invoking the Gemini CLI.
fn base_cli_setup() -> (String, Vec<String>) {
    if cfg!(windows) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "gemini.cmd".to_string()],
        )
    } else {
        ("gemini".to_string(), vec![])
    }
}

impl CliProvider for GeminiProvider {
    fn engine_name(&self) -> &'static str {
        "Gemini CLI"
    }

    fn context_file_name(&self) -> &'static str {
        "GEMINI.md"
    }

    fn binary_candidates(&self) -> &[&str] {
        if cfg!(target_os = "windows") {
            &["gemini", "gemini.cmd"]
        } else {
            &["gemini"]
        }
    }

    fn supports_session_resume(&self) -> bool {
        true
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

        // Gemini uses: gemini -p "<prompt>" --output-format stream-json --yolo
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
                    args.push("-m".to_string());
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

    fn build_resume_args(&self, session_id: &str) -> CliArgs {
        let (command, mut args) = base_cli_setup();

        args.extend([
            "--resume".to_string(),
            session_id.to_string(),
            "-p".to_string(),
            String::new(), // placeholder for prompt
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--yolo".to_string(),
        ]);

        CliArgs {
            command,
            args,
            env_overrides: Vec::new(),
            env_removals: Vec::new(),
            cwd: None,
        }
    }

    fn build_resume_args_with_prompt(
        &self,
        session_id: &str,
        prompt_text: &str,
    ) -> CliArgs {
        let mut args = self.build_resume_args(session_id);
        // Replace the empty placeholder after "-p" with actual prompt text
        let flag_idx = args.args.iter().position(|a| a == "-p");
        if let Some(idx) = flag_idx {
            if idx + 1 < args.args.len() && args.args[idx + 1].is_empty() {
                args.args[idx + 1] = prompt_text.to_string();
            }
        }
        args
    }

    fn parse_stream_line(&self, line: &str) -> (StreamLineType, Option<String>) {
        // Gemini CLI's stream-json format is very similar to Claude's.
        // The main structural difference is in how content blocks are nested.
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
                // Same content block structure as Claude
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
                // Check for tool_result content
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

            _ => (StreamLineType::Unknown, None),
        }
    }

    fn apply_provider_env(&self, cli_args: &mut CliArgs, profile: &ModelProfile) {
        if let Some(ref auth_token) = profile.auth_token {
            if !auth_token.is_empty() {
                cli_args
                    .env_overrides
                    .push(("GEMINI_API_KEY".to_string(), auth_token.clone()));
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
        let provider = GeminiProvider;
        assert_eq!(provider.engine_name(), "Gemini CLI");
    }

    #[test]
    fn test_prompt_delivery() {
        let provider = GeminiProvider;
        assert_eq!(provider.prompt_delivery(), PromptDelivery::Flag("-p".to_string()));
    }

    #[test]
    fn test_parse_system_init() {
        let provider = GeminiProvider;
        let line = r#"{"type":"system","subtype":"init","model":"gemini-2.5-pro","session_id":"sess-gem"}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::SystemInit { model, session_id } => {
                assert_eq!(model, "gemini-2.5-pro");
                assert_eq!(session_id, Some("sess-gem".to_string()));
            }
            _ => panic!("Expected SystemInit, got {:?}", st),
        }
        assert!(display.unwrap().contains("gemini-2.5-pro"));
    }

    #[test]
    fn test_parse_assistant_text() {
        let provider = GeminiProvider;
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello from Gemini"}]}}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::AssistantText { text } => {
                assert_eq!(text, "Hello from Gemini");
            }
            _ => panic!("Expected AssistantText, got {:?}", st),
        }
        assert_eq!(display, Some("Hello from Gemini".to_string()));
    }

    #[test]
    fn test_parse_assistant_tool_use() {
        let provider = GeminiProvider;
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
    fn test_parse_result() {
        let provider = GeminiProvider;
        let line = r#"{"type":"result","duration_ms":3000,"total_cost_usd":0.001,"total_input_tokens":5000,"total_output_tokens":1000,"model":"gemini-2.5-pro"}"#;
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
    fn test_parse_non_json() {
        let provider = GeminiProvider;
        let (st, display) = provider.parse_stream_line("not json at all");
        assert_eq!(st, StreamLineType::Unknown);
        assert_eq!(display, None);
    }

    #[test]
    fn test_build_execution_args_with_prompt() {
        let provider = GeminiProvider;
        let args = provider.build_execution_args_with_prompt(None, None, "My prompt");
        assert!(args.args.contains(&"-p".to_string()));
        assert!(args.args.contains(&"My prompt".to_string()));
        assert!(args.args.contains(&"stream-json".to_string()));
    }

    #[test]
    fn test_build_resume_args_with_prompt() {
        let provider = GeminiProvider;
        let args = provider.build_resume_args_with_prompt("sess-123", "Continue");
        assert!(args.args.contains(&"--resume".to_string()));
        assert!(args.args.contains(&"sess-123".to_string()));
        assert!(args.args.contains(&"Continue".to_string()));
    }
}
