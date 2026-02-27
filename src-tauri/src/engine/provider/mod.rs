pub mod claude;
pub mod codex;
pub mod gemini;

use crate::db::DbPool;
use crate::db::models::Persona;
use super::types::{CliArgs, ModelProfile, StreamLineType};

// =============================================================================
// PromptDelivery — how the provider sends the prompt to the CLI process
// =============================================================================

/// How the CLI provider receives the prompt text.
#[derive(Debug, Clone, PartialEq)]
pub enum PromptDelivery {
    /// Write prompt to stdin, then close (Claude Code).
    Stdin,
    /// Prompt is embedded as a positional argument (Codex: `exec "<prompt>"`).
    PositionalArg,
    /// Prompt is passed via a flag (Gemini: `-p "<prompt>"`).
    Flag(String),
}

// =============================================================================
// EngineKind — which CLI engine is selected
// =============================================================================

/// Supported CLI engine backends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineKind {
    ClaudeCode,
    CodexCli,
    GeminiCli,
}

impl EngineKind {
    /// Parse from the string stored in the settings DB.
    pub fn from_setting(s: &str) -> Self {
        match s {
            "codex_cli" => EngineKind::CodexCli,
            "gemini_cli" => EngineKind::GeminiCli,
            _ => EngineKind::ClaudeCode,
        }
    }

    /// Serialize to the string stored in the settings DB.
    pub fn as_setting(&self) -> &'static str {
        match self {
            EngineKind::ClaudeCode => "claude_code",
            EngineKind::CodexCli => "codex_cli",
            EngineKind::GeminiCli => "gemini_cli",
        }
    }
}

// =============================================================================
// CliProvider trait
// =============================================================================

/// Abstraction over CLI-based AI coding agents.
///
/// Each provider knows how to:
/// - Locate its binary on the system
/// - Build CLI arguments for execution and resume
/// - Parse NDJSON stream output into unified `StreamLineType`
/// - Configure environment variables for its API
pub trait CliProvider: Send + Sync {
    /// Human-readable engine name for error messages and UI.
    fn engine_name(&self) -> &'static str;

    /// Name of the context file this engine reads (e.g., "CLAUDE.md", "AGENTS.md").
    fn context_file_name(&self) -> &'static str;

    /// Binary names to try when locating the CLI (platform-specific).
    fn binary_candidates(&self) -> &[&str];

    /// Whether this engine supports native session resume.
    fn supports_session_resume(&self) -> bool;

    /// How the prompt is delivered to the CLI process.
    fn prompt_delivery(&self) -> PromptDelivery;

    /// Build CLI arguments for a fresh execution.
    fn build_execution_args(
        &self,
        persona: Option<&Persona>,
        model_profile: Option<&ModelProfile>,
    ) -> CliArgs;

    /// Build CLI arguments to resume an existing session.
    fn build_resume_args(&self, session_id: &str) -> CliArgs;

    /// Parse a single NDJSON line from stdout into a unified stream type.
    ///
    /// Returns `(StreamLineType, Option<display_string>)`.
    fn parse_stream_line(&self, line: &str) -> (StreamLineType, Option<String>);

    /// Apply provider-specific environment overrides (API keys, base URLs).
    fn apply_provider_env(&self, cli_args: &mut CliArgs, profile: &ModelProfile);

    /// Build CLI arguments for a fresh execution with prompt text embedded
    /// (used by providers with PositionalArg or Flag delivery).
    fn build_execution_args_with_prompt(
        &self,
        persona: Option<&Persona>,
        model_profile: Option<&ModelProfile>,
        prompt_text: &str,
    ) -> CliArgs {
        // Default: ignore prompt_text and use base args (Stdin providers override nothing)
        let _ = prompt_text;
        self.build_execution_args(persona, model_profile)
    }

    /// Build CLI arguments for resume with prompt text embedded.
    fn build_resume_args_with_prompt(
        &self,
        session_id: &str,
        _prompt_text: &str,
    ) -> CliArgs {
        self.build_resume_args(session_id)
    }
}

// =============================================================================
// Factory
// =============================================================================

/// Create the appropriate provider for the given engine kind.
pub fn resolve_provider(kind: EngineKind) -> Box<dyn CliProvider> {
    match kind {
        EngineKind::ClaudeCode => Box::new(claude::ClaudeProvider),
        EngineKind::CodexCli => Box::new(codex::CodexProvider),
        EngineKind::GeminiCli => Box::new(gemini::GeminiProvider),
    }
}

/// Read the active engine kind from the settings DB.
/// Falls back to ClaudeCode if unset or unrecognized.
pub fn load_engine_kind(pool: &DbPool) -> EngineKind {
    crate::db::repos::core::settings::get(pool, crate::db::settings_keys::CLI_ENGINE)
        .ok()
        .flatten()
        .map(|s| EngineKind::from_setting(&s))
        .unwrap_or(EngineKind::ClaudeCode)
}
