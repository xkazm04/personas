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
    pub results: Vec<AssertionResult>,
}
