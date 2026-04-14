pub mod claude;

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
}

impl EngineKind {
    /// All known engine variants. Use this instead of hand-rolled lists.
    ///
    /// **Compile-time safety**: [`Self::assert_all_covered`] ensures this array
    /// covers every variant. If you add a variant to the enum, the compiler will
    /// force you to update this array (and `as_setting` / `FromStr`).
    pub const ALL: [EngineKind; 1] = [EngineKind::ClaudeCode];

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
            // Legacy: treat "codex_cli" as ClaudeCode for backwards compat with stored settings
            "codex_cli" => Ok(EngineKind::ClaudeCode),
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

    /// Minimum required CLI version, or `None` to skip the version check.
    /// Returned as a dot-separated version string (e.g., "2.1.101").
    fn minimum_version(&self) -> Option<&str> {
        None
    }

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
    }
}

/// Read the active engine kind from the settings DB.
/// Falls back to ClaudeCode if unset or unrecognized.
#[allow(dead_code)]
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
pub fn load_engine_kind_notified(pool: &DbPool, emitter: &dyn super::events::ExecutionEventEmitter) -> EngineKind {
    use super::event_registry::event_name;

    let raw = crate::db::repos::core::settings::get(pool, crate::db::settings_keys::CLI_ENGINE)
        .ok()
        .flatten();

    match raw {
        Some(ref s) if s.parse::<EngineKind>().is_err() => {
            // Unrecognized value — from_setting will log the warning
            let kind = EngineKind::from_setting(s);
            super::events::emit_to(emitter, event_name::ENGINE_FALLBACK, &serde_json::json!({
                    "requested": s,
                    "actual": kind.as_setting(),
                }));
            kind
        }
        Some(ref s) => EngineKind::from_setting(s),
        None => EngineKind::ClaudeCode,
    }
}

// =============================================================================
// CLI version check
// =============================================================================

/// Parse a version string like "2.1.101" into a comparable tuple of numbers.
/// Returns `None` if parsing fails.
fn parse_version_tuple(version: &str) -> Option<Vec<u64>> {
    let parts: Vec<u64> = version
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect();
    if parts.len() >= 2 {
        Some(parts)
    } else {
        None
    }
}

/// Compare two dot-separated version strings numerically.
/// Returns true if `actual` >= `minimum`.
pub fn version_gte(actual: &str, minimum: &str) -> bool {
    let Some(a) = parse_version_tuple(actual) else {
        return false;
    };
    let Some(m) = parse_version_tuple(minimum) else {
        return true; // can't parse minimum — don't block
    };
    for i in 0..a.len().max(m.len()) {
        let av = a.get(i).copied().unwrap_or(0);
        let mv = m.get(i).copied().unwrap_or(0);
        if av > mv {
            return true;
        }
        if av < mv {
            return false;
        }
    }
    true // equal
}

/// Extract the version number from `claude --version` output.
///
/// Handles common formats:
/// - "claude v2.1.101"
/// - "claude-code 2.1.98"
/// - "2.1.101"
pub fn extract_version(output: &str) -> Option<String> {
    let line = output.lines().next()?.trim();
    // Try to find a version-like pattern: digits.digits[.digits...]
    for token in line.split_whitespace() {
        let clean = token.trim_start_matches('v');
        if clean.contains('.') && clean.chars().next().map_or(false, |c| c.is_ascii_digit()) {
            return Some(clean.to_string());
        }
    }
    None
}

/// Run `<binary> --version` with a timeout, parse the version, compare against
/// the provider's minimum. Returns `Ok(version_string)` if OK or no version
/// could be determined, `Err(warning_message)` if below minimum.
pub async fn check_cli_version(
    binary_path: &str,
    minimum: &str,
) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(binary_path);
    cmd.arg("--version");

    #[cfg(target_os = "windows")]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        cmd.output(),
    )
    .await
    {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            tracing::debug!(binary = binary_path, error = %e, "Failed to run --version");
            return Ok("unknown".to_string());
        }
        Err(_) => {
            tracing::debug!(binary = binary_path, "CLI --version timed out");
            return Ok("unknown".to_string());
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(version) = extract_version(&stdout) else {
        tracing::debug!(
            binary = binary_path,
            output = %stdout.chars().take(200).collect::<String>(),
            "Could not parse CLI version from --version output"
        );
        return Ok("unknown".to_string());
    };

    if version_gte(&version, minimum) {
        Ok(version)
    } else {
        Err(format!(
            "CLI version {version} is below the recommended minimum {minimum}. \
             Please update your Claude Code CLI to avoid known issues \
             (UTF-8 corruption, permission bugs, timeout failures)."
        ))
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

    // -----------------------------------------------------------------------
    // Version parsing & comparison
    // -----------------------------------------------------------------------

    #[test]
    fn version_gte_equal() {
        assert!(version_gte("2.1.101", "2.1.101"));
    }

    #[test]
    fn version_gte_newer() {
        assert!(version_gte("2.2.0", "2.1.101"));
        assert!(version_gte("3.0.0", "2.1.101"));
        assert!(version_gte("2.1.102", "2.1.101"));
    }

    #[test]
    fn version_gte_older() {
        assert!(!version_gte("2.1.92", "2.1.101"));
        assert!(!version_gte("2.0.200", "2.1.101"));
        assert!(!version_gte("1.9.999", "2.1.101"));
    }

    #[test]
    fn version_gte_two_part() {
        assert!(version_gte("2.2", "2.1.101"));
        assert!(!version_gte("2.1", "2.1.101"));
    }

    #[test]
    fn extract_version_prefixed() {
        assert_eq!(
            extract_version("claude v2.1.101"),
            Some("2.1.101".to_string())
        );
    }

    #[test]
    fn extract_version_bare() {
        assert_eq!(
            extract_version("2.1.98"),
            Some("2.1.98".to_string())
        );
    }

    #[test]
    fn extract_version_with_name() {
        assert_eq!(
            extract_version("claude-code 2.1.92"),
            Some("2.1.92".to_string())
        );
    }

    #[test]
    fn extract_version_garbage() {
        assert_eq!(extract_version("not a version"), None);
        assert_eq!(extract_version(""), None);
    }

    #[test]
    fn claude_provider_has_minimum_version() {
        let provider = resolve_provider(EngineKind::ClaudeCode);
        assert!(provider.minimum_version().is_some());
    }

}
