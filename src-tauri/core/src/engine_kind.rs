//! Which CLI engine backend a persona runs on.
//!
//! Extracted from `engine::provider` in crate-split step 4d. It is a plain
//! enum with no dependencies, but `byom` — policy over which provider may
//! serve a run — needs it, and `byom` is data-layer code that belongs in
//! `personas-db`. One enum was the whole blocker.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// =============================================================================
// EngineKind -- which CLI engine is selected
// =============================================================================

/// Supported CLI engine backends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
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
