use crate::db::models::Persona;
use crate::engine::types::{CliArgs, ModelProfile, StreamLineType};

use super::{CliProvider, PromptDelivery};

/// Codex CLI provider (OpenAI's coding agent).
pub struct CodexProvider;

/// Platform-specific command and initial args for invoking the Codex CLI.
fn base_cli_setup() -> (String, Vec<String>) {
    if cfg!(windows) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "codex.cmd".to_string()],
        )
    } else {
        ("codex".to_string(), vec![])
    }
}

impl CliProvider for CodexProvider {
    fn engine_name(&self) -> &'static str {
        "Codex CLI"
    }

    fn context_file_name(&self) -> &'static str {
        "AGENTS.md"
    }

    fn binary_candidates(&self) -> &[&str] {
        if cfg!(target_os = "windows") {
            &["codex", "codex.cmd"]
        } else {
            &["codex"]
        }
    }

    fn supports_session_resume(&self) -> bool {
        true
    }

    fn prompt_delivery(&self) -> PromptDelivery {
        PromptDelivery::PositionalArg
    }

    fn build_execution_args(
        &self,
        persona: Option<&Persona>,
        model_profile: Option<&ModelProfile>,
    ) -> CliArgs {
        let (command, mut args) = base_cli_setup();

        // Codex uses: codex exec "<prompt>" --json --full-auto
        args.extend([
            "exec".to_string(),
            String::new(), // placeholder — prompt injected by build_execution_args_with_prompt
            "--json".to_string(),
            "--full-auto".to_string(),
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

        let _ = persona; // Codex doesn't have budget/turns flags like Claude

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
        // Replace the empty placeholder with actual prompt text
        // The placeholder is at index 1 (after "exec") on Unix, or index 3 (after "/C", "codex.cmd", "exec") on Windows
        let exec_idx = args.args.iter().position(|a| a == "exec");
        if let Some(idx) = exec_idx {
            // The prompt slot is right after "exec"
            if idx + 1 < args.args.len() {
                args.args[idx + 1] = prompt_text.to_string();
            }
        }
        args
    }

    fn build_resume_args(&self, session_id: &str) -> CliArgs {
        let (command, mut args) = base_cli_setup();

        args.extend([
            "exec".to_string(),
            "resume".to_string(),
            session_id.to_string(),
            "--json".to_string(),
            "--full-auto".to_string(),
        ]);

        CliArgs {
            command,
            args,
            env_overrides: Vec::new(),
            env_removals: Vec::new(),
            cwd: None,
        }
    }

    fn parse_stream_line(&self, line: &str) -> (StreamLineType, Option<String>) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return (StreamLineType::Unknown, None);
        }

        let value: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => return (StreamLineType::Unknown, None),
        };

        let event_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match event_type {
            // Thread started — maps to SystemInit
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

            // Item events — can contain text, function calls, or function call output
            t if t.starts_with("item.") => {
                parse_codex_item(&value)
            }

            // Turn completed — maps to Result
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

            // Error
            "error" => {
                let msg = value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                tracing::warn!("Codex CLI error: {}", msg);
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
                    .push(("OPENAI_API_KEY".to_string(), auth_token.clone()));
            }
        }
        if let Some(ref base_url) = profile.base_url {
            if !base_url.is_empty() {
                cli_args
                    .env_overrides
                    .push(("OPENAI_BASE_URL".to_string(), base_url.clone()));
            }
        }
    }
}

/// Parse a Codex `item.*` event into a StreamLineType.
fn parse_codex_item(value: &serde_json::Value) -> (StreamLineType, Option<String>) {
    // Check for content array in the item
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

    // Check for text directly on the item
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
        let provider = CodexProvider;
        assert_eq!(provider.engine_name(), "Codex CLI");
    }

    #[test]
    fn test_prompt_delivery() {
        let provider = CodexProvider;
        assert_eq!(provider.prompt_delivery(), PromptDelivery::PositionalArg);
    }

    #[test]
    fn test_parse_thread_started() {
        let provider = CodexProvider;
        let line = r#"{"type":"thread.started","model":"gpt-4.1","thread_id":"thread-abc"}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::SystemInit { model, session_id } => {
                assert_eq!(model, "gpt-4.1");
                assert_eq!(session_id, Some("thread-abc".to_string()));
            }
            _ => panic!("Expected SystemInit, got {:?}", st),
        }
        assert_eq!(display, Some("Session started (gpt-4.1)".to_string()));
    }

    #[test]
    fn test_parse_item_text() {
        let provider = CodexProvider;
        let line = r#"{"type":"item.created","content":[{"type":"text","text":"Hello from Codex"}]}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::AssistantText { text } => {
                assert_eq!(text, "Hello from Codex");
            }
            _ => panic!("Expected AssistantText, got {:?}", st),
        }
        assert_eq!(display, Some("Hello from Codex".to_string()));
    }

    #[test]
    fn test_parse_item_function_call() {
        let provider = CodexProvider;
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
    fn test_parse_item_function_call_output() {
        let provider = CodexProvider;
        let line = r#"{"type":"item.completed","content":[{"type":"function_call_output","output":"file1.rs\nfile2.rs"}]}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::ToolResult { content_preview } => {
                assert!(content_preview.contains("file1.rs"));
            }
            _ => panic!("Expected ToolResult, got {:?}", st),
        }
        assert!(display.unwrap().starts_with("  Tool result: "));
    }

    #[test]
    fn test_parse_turn_completed() {
        let provider = CodexProvider;
        let line = r#"{"type":"turn.completed","usage":{"input_tokens":2000,"output_tokens":500},"total_cost_usd":0.05,"model":"gpt-4.1","thread_id":"thread-xyz"}"#;
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
                assert_eq!(model, Some("gpt-4.1".to_string()));
                assert_eq!(session_id, Some("thread-xyz".to_string()));
            }
            _ => panic!("Expected Result, got {:?}", st),
        }
    }

    #[test]
    fn test_parse_non_json() {
        let provider = CodexProvider;
        let (st, display) = provider.parse_stream_line("not json");
        assert_eq!(st, StreamLineType::Unknown);
        assert_eq!(display, None);
    }

    #[test]
    fn test_build_execution_args_with_prompt() {
        let provider = CodexProvider;
        let args = provider.build_execution_args_with_prompt(None, None, "Do the thing");
        assert!(args.args.contains(&"exec".to_string()));
        assert!(args.args.contains(&"Do the thing".to_string()));
    }
}
