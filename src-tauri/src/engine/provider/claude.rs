use crate::db::models::Persona;
use crate::engine::parser;
use crate::engine::prompt;
use crate::engine::types::{CliArgs, ModelProfile, StreamLineType};

use super::{CliProvider, PromptDelivery};

/// Claude Code CLI provider — wraps the existing prompt/parser modules.
pub struct ClaudeProvider;

impl CliProvider for ClaudeProvider {
    fn engine_name(&self) -> &'static str {
        "Claude Code CLI"
    }

    fn context_file_name(&self) -> &'static str {
        "CLAUDE.md"
    }

    fn binary_candidates(&self) -> &[&str] {
        if cfg!(target_os = "windows") {
            &["claude", "claude.cmd", "claude.exe", "claude-code"]
        } else {
            &["claude", "claude-code"]
        }
    }

    fn supports_session_resume(&self) -> bool {
        true
    }

    fn prompt_delivery(&self) -> PromptDelivery {
        PromptDelivery::Stdin
    }

    fn build_execution_args(
        &self,
        persona: Option<&Persona>,
        model_profile: Option<&ModelProfile>,
    ) -> CliArgs {
        prompt::build_cli_args(persona, model_profile)
    }

    fn build_resume_args(&self, session_id: &str) -> CliArgs {
        prompt::build_resume_cli_args(session_id)
    }

    fn parse_stream_line(&self, line: &str) -> (StreamLineType, Option<String>) {
        parser::parse_stream_line(line)
    }

    fn apply_provider_env(&self, cli_args: &mut CliArgs, profile: &ModelProfile) {
        prompt::apply_provider_env(cli_args, profile);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_name() {
        let provider = ClaudeProvider;
        assert_eq!(provider.engine_name(), "Claude Code CLI");
    }

    #[test]
    fn test_prompt_delivery() {
        let provider = ClaudeProvider;
        assert_eq!(provider.prompt_delivery(), PromptDelivery::Stdin);
    }

    #[test]
    fn test_supports_session_resume() {
        let provider = ClaudeProvider;
        assert!(provider.supports_session_resume());
    }

    #[test]
    fn test_parse_system_init() {
        let provider = ClaudeProvider;
        let line = r#"{"type":"system","subtype":"init","model":"claude-sonnet-4-20250514","session_id":"sess-123"}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::SystemInit { model, session_id } => {
                assert_eq!(model, "claude-sonnet-4-20250514");
                assert_eq!(session_id, Some("sess-123".to_string()));
            }
            _ => panic!("Expected SystemInit, got {:?}", st),
        }
        assert!(display.is_some());
    }

    #[test]
    fn test_parse_result() {
        let provider = ClaudeProvider;
        let line = r#"{"type":"result","duration_ms":5200,"total_cost_usd":0.0123,"total_input_tokens":1500,"total_output_tokens":800}"#;
        let (st, _) = provider.parse_stream_line(line);

        match st {
            StreamLineType::Result { total_cost_usd, .. } => {
                assert_eq!(total_cost_usd, Some(0.0123));
            }
            _ => panic!("Expected Result, got {:?}", st),
        }
    }

    #[test]
    fn test_build_execution_args() {
        let provider = ClaudeProvider;
        let args = provider.build_execution_args(None, None);
        assert!(args.args.contains(&"-p".to_string()));
        assert!(args.args.contains(&"stream-json".to_string()));
    }
}
