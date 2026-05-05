use crate::db::models::Persona;
use crate::engine::parser;
use crate::engine::prompt;
use crate::engine::types::{CliArgs, ModelProfile, StreamLineType};

use super::{CliProvider, PromptDelivery};

/// Claude Code CLI provider -- wraps the existing prompt/parser modules.
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

    fn minimum_version(&self) -> Option<&str> {
        // CLI ≥ 2.1.128 — floor advances when a newer CLI fixes the wrapping
        // contract personas depends on. Recent floor:
        // - 2.1.128: `claude -p` no longer crashes on >10MB stdin (defense for
        //   the `cli_process` stdin-pipe contract); MCP tool results no longer
        //   drop images when the server returns both structured content and
        //   content blocks (matters for personas-mcp `drive_*` returning
        //   binary content alongside metadata); sub-agent progress summaries
        //   now hit the prompt cache (~3× `cache_creation` reduction) and no
        //   longer fire repeatedly on static transcripts (worst-case token
        //   cap); parallel shell tool calls no longer cancel siblings on a
        //   single read-only failure. Version 2.1.127 was skipped upstream —
        //   all changes batched into 2.1.128.
        // Earlier floors (2.1.121–2.1.126) elided — see git history of this
        // file for the alwaysLoad / hooks-sidecar / sandbox-scope / OAuth
        // narrative. The 2026-05-01 sandbox-erosion threat model recorded
        // against the 2.1.126 floor lives in `Patterns/descoped-reopenable.md`.
        // The check is advisory: `provider::check_cli_version` returns an Err
        // string below the floor; no caller turns that into a hard refusal.
        Some("2.1.128")
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
            StreamLineType::SystemInit { model, session_id, plugin_errors } => {
                assert_eq!(model, "claude-sonnet-4-20250514");
                assert_eq!(session_id, Some("sess-123".to_string()));
                assert!(plugin_errors.is_empty());
            }
            _ => panic!("Expected SystemInit, got {st:?}"),
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
            _ => panic!("Expected Result, got {st:?}"),
        }
    }

    #[test]
    fn test_build_execution_args() {
        let provider = ClaudeProvider;
        let args = provider.build_execution_args(None, None);
        assert!(args.args.contains(&"-p".to_string()));
        assert!(args.args.contains(&"stream-json".to_string()));
        assert!(args
            .args
            .contains(&"--exclude-dynamic-system-prompt-sections".to_string()));
    }

    #[test]
    fn test_build_execution_args_pins_effort_medium() {
        // Personas pins --effort medium so behavior stays deterministic across
        // CLI 2.1.94's tier-dependent default change.
        let provider = ClaudeProvider;
        let args = provider.build_execution_args(None, None);
        assert!(args.args.contains(&"--effort".to_string()));
        assert!(args.args.contains(&"medium".to_string()));
    }

    #[test]
    fn test_minimum_version_is_set() {
        let provider = ClaudeProvider;
        let min = provider.minimum_version();
        assert!(min.is_some());
        assert_eq!(min.unwrap(), "2.1.128");
    }
}
