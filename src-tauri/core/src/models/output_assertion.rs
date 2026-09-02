use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Output Assertion Definitions
// ============================================================================

/// A declarative assertion rule attached to a persona.
/// Evaluated automatically on every execution output.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OutputAssertion {
    pub id: String,
    pub persona_id: String,
    pub name: String,
    pub description: Option<String>,
    /// The assertion strategy type.
    pub assertion_type: AssertionType,
    /// JSON-encoded configuration specific to the assertion_type.
    /// See `AssertionConfig` variants for shape.
    pub config: String,
    /// Severity when this assertion fails: "info", "warning", "critical".
    pub severity: String,
    /// Whether this assertion is actively evaluated.
    pub enabled: bool,
    /// What to do when the assertion fails: "log", "review", "heal".
    pub on_failure: AssertionFailureAction,
    #[ts(type = "number")]
    pub pass_count: i64,
    #[ts(type = "number")]
    pub fail_count: i64,
    pub last_evaluated_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// The type of assertion to evaluate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AssertionType {
    /// Match output against a regex pattern.
    Regex,
    /// Evaluate a JSONPath expression against JSON output.
    JsonPath,
    /// Check for required keywords / phrases.
    Contains,
    /// Check that output does NOT contain certain patterns (PII, secrets, etc.).
    NotContains,
    /// Validate output against a JSON schema.
    JsonSchema,
    /// Check output length bounds.
    Length,
}

/// What action to take when an assertion fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AssertionFailureAction {
    /// Just log the failure (visible in assertion results).
    Log,
    /// Create a manual review item for human inspection.
    Review,
    /// Trigger the healing workflow to attempt auto-fix.
    Heal,
}

/// Severity attached to an assertion. Stored as the lowercase token in the
/// `severity TEXT` column and carried on the wire as a plain `String` (see
/// `OutputAssertion::severity`), so this enum is deliberately NOT
/// `#[ts(export)]` — it is the closed vocabulary the write door validates
/// against, not a new wire type.
///
/// `engine::output_assertions` branches on `"critical"` to downgrade an
/// execution's status; before this vocabulary existed a caller could store
/// `"Critical"`, `"crit"` or `"urgent"` and that branch silently never fired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AssertionSeverity {
    Info,
    #[default]
    Warning,
    Critical,
}

impl AssertionType {
    /// The token persisted in `output_assertions.assertion_type`. Matches the
    /// serde `snake_case` rename, so the DB and the wire agree by construction.
    pub fn as_token(self) -> &'static str {
        match self {
            AssertionType::Regex => "regex",
            AssertionType::JsonPath => "json_path",
            AssertionType::Contains => "contains",
            AssertionType::NotContains => "not_contains",
            AssertionType::JsonSchema => "json_schema",
            AssertionType::Length => "length",
        }
    }

    /// Parse a stored/incoming token. `None` means *unknown*, which is not a
    /// value: the write door rejects it and the row mapper errors on it. It
    /// must never be coerced into a real variant — a mistyped assertion that
    /// silently runs a different check is worse than no assertion at all.
    pub fn parse_token(s: &str) -> Option<Self> {
        match s {
            "regex" => Some(AssertionType::Regex),
            "json_path" => Some(AssertionType::JsonPath),
            "contains" => Some(AssertionType::Contains),
            "not_contains" => Some(AssertionType::NotContains),
            "json_schema" => Some(AssertionType::JsonSchema),
            "length" => Some(AssertionType::Length),
            _ => None,
        }
    }

    /// Every token this vocabulary accepts, for error messages and tests.
    pub const TOKENS: &'static [&'static str] = &[
        "regex",
        "json_path",
        "contains",
        "not_contains",
        "json_schema",
        "length",
    ];
}

impl AssertionFailureAction {
    pub fn as_token(self) -> &'static str {
        match self {
            AssertionFailureAction::Log => "log",
            AssertionFailureAction::Review => "review",
            AssertionFailureAction::Heal => "heal",
        }
    }

    pub fn parse_token(s: &str) -> Option<Self> {
        match s {
            "log" => Some(AssertionFailureAction::Log),
            "review" => Some(AssertionFailureAction::Review),
            "heal" => Some(AssertionFailureAction::Heal),
            _ => None,
        }
    }

    pub const TOKENS: &'static [&'static str] = &["log", "review", "heal"];
}

impl AssertionSeverity {
    pub fn as_token(self) -> &'static str {
        match self {
            AssertionSeverity::Info => "info",
            AssertionSeverity::Warning => "warning",
            AssertionSeverity::Critical => "critical",
        }
    }

    pub fn parse_token(s: &str) -> Option<Self> {
        match s {
            "info" => Some(AssertionSeverity::Info),
            "warning" => Some(AssertionSeverity::Warning),
            "critical" => Some(AssertionSeverity::Critical),
            _ => None,
        }
    }

    pub const TOKENS: &'static [&'static str] = &["info", "warning", "critical"];
}

// ============================================================================
// Assertion Results (per-execution evaluation)
// ============================================================================

/// Result of evaluating one assertion against one execution's output.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AssertionResult {
    pub id: String,
    pub assertion_id: String,
    pub execution_id: String,
    pub persona_id: String,
    pub passed: bool,
    /// Human-readable explanation of the result.
    pub explanation: String,
    /// The matched/extracted value (for debugging).
    pub matched_value: Option<String>,
    #[ts(type = "number")]
    pub evaluation_ms: i64,
    pub created_at: String,
}

/// Summary of assertion results for a single execution.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionAssertionSummary {
    pub execution_id: String,
    #[ts(type = "number")]
    pub total: i64,
    #[ts(type = "number")]
    pub passed: i64,
    #[ts(type = "number")]
    pub failed: i64,
    /// Subset of `failed` whose owning assertion had `severity: "critical"`.
    /// Drives the post-execution status downgrade from `Completed` →
    /// `Incomplete` so semantic blockers surface in the notification center.
    #[serde(default)]
    #[ts(type = "number")]
    pub critical_failures: i64,
    /// First critical-severity failure explanation — used as the execution's
    /// error message when a downgrade occurs. `None` when no critical
    /// assertion failed.
    #[serde(default)]
    pub first_critical_failure: Option<String>,
    pub results: Vec<AssertionResult>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assertion_tokens_round_trip() {
        for token in AssertionType::TOKENS {
            let parsed = AssertionType::parse_token(token).expect("listed token must parse");
            assert_eq!(parsed.as_token(), *token);
        }
        for token in AssertionFailureAction::TOKENS {
            let parsed =
                AssertionFailureAction::parse_token(token).expect("listed token must parse");
            assert_eq!(parsed.as_token(), *token);
        }
        for token in AssertionSeverity::TOKENS {
            let parsed = AssertionSeverity::parse_token(token).expect("listed token must parse");
            assert_eq!(parsed.as_token(), *token);
        }
    }

    #[test]
    fn unknown_tokens_are_not_coerced() {
        // The old readers mapped these onto `Contains` / `Log` / a live
        // severity. Unknown is not a value.
        assert!(AssertionType::parse_token("Contains").is_none());
        assert!(AssertionType::parse_token("contain").is_none());
        assert!(AssertionType::parse_token("").is_none());
        assert!(AssertionFailureAction::parse_token("LOG").is_none());
        assert!(AssertionSeverity::parse_token("urgent").is_none());
    }

    #[test]
    fn tokens_match_serde_representation() {
        // The DB token and the wire token are the same string, so a value
        // written by the door reads back identically through serde.
        for ty in [
            AssertionType::Regex,
            AssertionType::JsonPath,
            AssertionType::Contains,
            AssertionType::NotContains,
            AssertionType::JsonSchema,
            AssertionType::Length,
        ] {
            let json = serde_json::to_string(&ty).unwrap();
            assert_eq!(json, format!("\"{}\"", ty.as_token()));
        }
        for action in [
            AssertionFailureAction::Log,
            AssertionFailureAction::Review,
            AssertionFailureAction::Heal,
        ] {
            let json = serde_json::to_string(&action).unwrap();
            assert_eq!(json, format!("\"{}\"", action.as_token()));
        }
    }
}
