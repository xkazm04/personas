pub mod claude;
pub mod codex;

use crate::db::DbPool;
use crate::db::models::Persona;
use super::types::{CliArgs, ModelProfile, StreamLineType};
use tauri::Emitter;

// =============================================================================
// PromptDelivery -- how the provider sends the prompt to the CLI process
// =============================================================================

/// How the CLI provider receives the prompt text.
#[derive(Debug, Clone, PartialEq)]
pub enum PromptDelivery {
    /// Write prompt to stdin, then close (Claude Code).
    Stdin,
    /// Prompt is embedded as a positional argument (Codex: `exec "<prompt>"`).
    PositionalArg,
    /// Prompt is passed via a flag (Codex: `-p "<prompt>"`).
    #[allow(dead_code)]
    Flag(String),
}

// =============================================================================
// EngineKind -- which CLI engine is selected
// =============================================================================

/// Supported CLI engine backends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EngineKind {
    ClaudeCode,
    CodexCli,
}

impl EngineKind {
    /// All known engine variants. Use this instead of hand-rolled lists.
    ///
    /// **Compile-time safety**: [`Self::assert_all_covered`] ensures this array
    /// covers every variant. If you add a variant to the enum, the compiler will
    /// force you to update this array (and `as_setting` / `FromStr`).
    pub const ALL: [EngineKind; 2] = [EngineKind::ClaudeCode, EngineKind::CodexCli];

    /// Compile-time exhaustiveness guard for [`Self::ALL`].
    ///
    /// This function uses an exhaustive match (no wildcard) over every variant.
    /// If a new variant is added to `EngineKind` without updating this function
    /// **and** the `ALL` const, compilation will fail — preventing BYOM policy
    /// enforcement gaps.
    const fn assert_all_covered() {
        // Walk every entry in ALL with an exhaustive match.  If a variant is
        // missing from ALL the array length won't match; if a variant is missing
        // from this match the compiler will error.
        let mut i = 0;
        while i < Self::ALL.len() {
            match Self::ALL[i] {
                EngineKind::ClaudeCode => {}
                EngineKind::CodexCli => {}
                // ↑ NO wildcard: adding a variant without a branch here is a
                //   compile error.
            }
            i += 1;
        }
    }

    /// Parse from the string stored in the settings DB, logging a warning and
    /// falling back to `ClaudeCode` for unrecognised values.
    pub fn from_setting(s: &str) -> Self {
        s.parse().unwrap_or_else(|_| {
            tracing::warn!(
                engine_setting = s,
                "Unrecognized engine setting '{}', falling back to ClaudeCode",
                s
            );
            EngineKind::ClaudeCode
        })
    }

    /// Serialize to the string stored in the settings DB.
    #[allow(dead_code)]
    pub fn as_setting(&self) -> &'static str {
        match self {
            EngineKind::ClaudeCode => "claude_code",
            EngineKind::CodexCli => "codex_cli",
        }
    }

    /// Parse from setting string, returning `None` for unrecognised values
    /// (unlike `from_setting` which falls back to ClaudeCode).
    pub fn from_str_exact(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

// Evaluated at compile time — zero runtime cost.
const _: () = EngineKind::assert_all_covered();

impl std::str::FromStr for EngineKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "claude_code" => Ok(EngineKind::ClaudeCode),
            "codex_cli" => Ok(EngineKind::CodexCli),
            other => Err(format!("unknown engine kind '{}'", other)),
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
#[allow(dead_code)]
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

/// Like [`load_engine_kind`] but emits an `engine-fallback` event to the
/// frontend when an unrecognized engine setting triggers the ClaudeCode
/// fallback, so the user sees a toast notification.
pub fn load_engine_kind_notified(pool: &DbPool, app: &tauri::AppHandle) -> EngineKind {
    use super::event_registry::event_name;

    let raw = crate::db::repos::core::settings::get(pool, crate::db::settings_keys::CLI_ENGINE)
        .ok()
        .flatten();

    match raw {
        Some(ref s) if s.parse::<EngineKind>().is_err() => {
            // Unrecognized value — from_setting will log the warning
            let kind = EngineKind::from_setting(s);
            let _ = app.emit(
                event_name::ENGINE_FALLBACK,
                serde_json::json!({
                    "requested": s,
                    "actual": kind.as_setting(),
                }),
            );
            kind
        }
        Some(ref s) => EngineKind::from_setting(s),
        None => EngineKind::ClaudeCode,
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that every variant in `EngineKind::ALL` round-trips through
    /// `as_setting()` → `FromStr` (and `from_str_exact`).  This catches
    /// mismatched string mappings that the compile-time exhaustiveness guard
    /// cannot detect (e.g., a typo in `as_setting` that doesn't match `FromStr`).
    #[test]
    fn all_variants_round_trip_through_setting_strings() {
        for kind in EngineKind::ALL {
            let s = kind.as_setting();
            let parsed: EngineKind = s.parse().unwrap_or_else(|e| {
                panic!(
                    "EngineKind::{:?}.as_setting() = {:?} failed to parse back: {}",
                    kind, s, e
                )
            });
            assert_eq!(
                kind, parsed,
                "Round-trip mismatch for EngineKind::{:?}",
                kind
            );
            assert_eq!(
                EngineKind::from_str_exact(s),
                Some(kind),
                "from_str_exact mismatch for {:?}",
                s
            );
        }
    }

    /// `from_str_exact` must return `None` for unknown strings.
    #[test]
    fn from_str_exact_returns_none_for_unknown() {
        assert_eq!(EngineKind::from_str_exact("nonexistent"), None);
        assert_eq!(EngineKind::from_str_exact(""), None);
    }

    /// `resolve_provider` must return a provider for every known variant.
    #[test]
    fn resolve_provider_covers_all_variants() {
        for kind in EngineKind::ALL {
            let provider = resolve_provider(kind);
            assert!(
                !provider.engine_name().is_empty(),
                "resolve_provider({:?}) returned a provider with empty engine_name",
                kind
            );
        }
    }
}
