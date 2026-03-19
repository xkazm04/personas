//! Declarative output assertion engine.
//!
//! Evaluates a set of `OutputAssertion` rules against execution output text.
//! Supports regex, contains, not_contains, json_path, json_schema, and length checks.
//! Each assertion produces an `AssertionResult` that is persisted per-execution.

use std::time::Instant;

use regex::Regex;
use serde::Deserialize;

use crate::db::models::{
    AssertionFailureAction, AssertionResult, AssertionType, ExecutionAssertionSummary,
    OutputAssertion,
};
use crate::db::DbPool;

// ============================================================================
// Config shapes (deserialized from assertion.config JSON)
// ============================================================================

#[derive(Deserialize)]
struct RegexConfig {
    pattern: String,
    /// If true, the pattern must NOT match (negative assertion).
    #[serde(default)]
    negate: bool,
}

#[derive(Deserialize)]
struct ContainsConfig {
    /// One or more phrases that must appear in the output.
    phrases: Vec<String>,
    /// If true, all phrases must match. If false, at least one.
    #[serde(default = "default_true")]
    match_all: bool,
    #[serde(default)]
    case_sensitive: bool,
}

#[derive(Deserialize)]
struct NotContainsConfig {
    /// Patterns/phrases that must NOT appear in the output.
    patterns: Vec<String>,
    #[serde(default)]
    case_sensitive: bool,
}

#[derive(Deserialize)]
struct JsonPathConfig {
    /// JSONPath expression (simple dot-notation: "$.result.status").
    path: String,
    /// Expected value at the path (string comparison).
    expected: Option<String>,
    /// If true, just check that the path exists (value doesn't matter).
    #[serde(default)]
    exists_only: bool,
}

#[derive(Deserialize)]
struct JsonSchemaConfig {
    /// Required top-level keys that must exist in the JSON output.
    required_keys: Vec<String>,
}

#[derive(Deserialize)]
struct LengthConfig {
    #[serde(default)]
    min: Option<usize>,
    #[serde(default)]
    max: Option<usize>,
}

fn default_true() -> bool {
    true
}

// ============================================================================
// Core evaluation
// ============================================================================

/// Evaluate a single assertion against the output text.
fn evaluate_one(assertion: &OutputAssertion, output: &str) -> AssertionResult {
    let start = Instant::now();
    let (passed, explanation, matched_value) = match assertion.assertion_type {
        AssertionType::Regex => eval_regex(&assertion.config, output),
        AssertionType::Contains => eval_contains(&assertion.config, output),
        AssertionType::NotContains => eval_not_contains(&assertion.config, output),
        AssertionType::JsonPath => eval_json_path(&assertion.config, output),
        AssertionType::JsonSchema => eval_json_schema(&assertion.config, output),
        AssertionType::Length => eval_length(&assertion.config, output),
    };
    let evaluation_ms = start.elapsed().as_millis() as i64;

    AssertionResult {
        id: uuid::Uuid::new_v4().to_string(),
        assertion_id: assertion.id.clone(),
        execution_id: String::new(), // filled by caller
        persona_id: assertion.persona_id.clone(),
        passed,
        explanation,
        matched_value,
        evaluation_ms,
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}

fn eval_regex(config_json: &str, output: &str) -> (bool, String, Option<String>) {
    let config: RegexConfig = match serde_json::from_str(config_json) {
        Ok(c) => c,
        Err(e) => return (false, format!("Invalid regex config: {e}"), None),
    };
    let re = match Regex::new(&config.pattern) {
        Ok(r) => r,
        Err(e) => return (false, format!("Invalid regex pattern: {e}"), None),
    };
    let found = re.find(output);
    let matched = found.is_some();
    let passed = if config.negate { !matched } else { matched };
    let matched_value = found.map(|m| m.as_str().to_string());

    let explanation = if config.negate {
        if passed {
            format!("Pattern '{}' correctly not found in output", config.pattern)
        } else {
            format!("Pattern '{}' was found but should not be", config.pattern)
        }
    } else if passed {
        format!("Pattern '{}' matched", config.pattern)
    } else {
        format!("Pattern '{}' not found in output", config.pattern)
    };

    (passed, explanation, matched_value)
}

fn eval_contains(config_json: &str, output: &str) -> (bool, String, Option<String>) {
    let config: ContainsConfig = match serde_json::from_str(config_json) {
        Ok(c) => c,
        Err(e) => return (false, format!("Invalid contains config: {e}"), None),
    };

    let output_check = if config.case_sensitive {
        output.to_string()
    } else {
        output.to_lowercase()
    };

    let mut found_phrases = Vec::new();
    let mut missing_phrases = Vec::new();

    for phrase in &config.phrases {
        let search = if config.case_sensitive {
            phrase.clone()
        } else {
            phrase.to_lowercase()
        };
        if output_check.contains(&search) {
            found_phrases.push(phrase.as_str());
        } else {
            missing_phrases.push(phrase.as_str());
        }
    }

    let passed = if config.match_all {
        missing_phrases.is_empty()
    } else {
        !found_phrases.is_empty()
    };

    let explanation = format!(
        "{}/{} required phrases found{}",
        found_phrases.len(),
        config.phrases.len(),
        if !missing_phrases.is_empty() {
            format!("; missing: {}", missing_phrases.join(", "))
        } else {
            String::new()
        }
    );

    (
        passed,
        explanation,
        if !found_phrases.is_empty() {
            Some(found_phrases.join(", "))
        } else {
            None
        },
    )
}

fn eval_not_contains(config_json: &str, output: &str) -> (bool, String, Option<String>) {
    let config: NotContainsConfig = match serde_json::from_str(config_json) {
        Ok(c) => c,
        Err(e) => return (false, format!("Invalid not_contains config: {e}"), None),
    };

    let output_check = if config.case_sensitive {
        output.to_string()
    } else {
        output.to_lowercase()
    };

    let mut violations = Vec::new();
    for pattern in &config.patterns {
        let search = if config.case_sensitive {
            pattern.clone()
        } else {
            pattern.to_lowercase()
        };
        if output_check.contains(&search) {
            violations.push(pattern.as_str());
        }
    }

    let passed = violations.is_empty();
    let explanation = if passed {
        format!("None of {} forbidden patterns found", config.patterns.len())
    } else {
        format!(
            "{} forbidden pattern(s) detected: {}",
            violations.len(),
            violations.join(", ")
        )
    };

    (
        passed,
        explanation,
        if !violations.is_empty() {
            Some(violations.join(", "))
        } else {
            None
        },
    )
}

fn eval_json_path(config_json: &str, output: &str) -> (bool, String, Option<String>) {
    let config: JsonPathConfig = match serde_json::from_str(config_json) {
        Ok(c) => c,
        Err(e) => return (false, format!("Invalid json_path config: {e}"), None),
    };

    // Try to parse the output as JSON
    let json_val: serde_json::Value = match serde_json::from_str(output) {
        Ok(v) => v,
        Err(_) => {
            // Try to find JSON embedded in the output (between first { and last })
            let trimmed = output.trim();
            let json_start = trimmed.find('{');
            let json_end = trimmed.rfind('}');
            match (json_start, json_end) {
                (Some(s), Some(e)) if s < e => {
                    match serde_json::from_str(&trimmed[s..=e]) {
                        Ok(v) => v,
                        Err(_) => {
                            return (
                                false,
                                "Output is not valid JSON; cannot evaluate JSONPath".into(),
                                None,
                            )
                        }
                    }
                }
                _ => {
                    return (
                        false,
                        "Output is not valid JSON; cannot evaluate JSONPath".into(),
                        None,
                    )
                }
            }
        }
    };

    // Simple dot-notation path resolution: "$.foo.bar" or "foo.bar"
    let path = config.path.strip_prefix("$.").unwrap_or(&config.path);
    let segments: Vec<&str> = path.split('.').filter(|s| !s.is_empty()).collect();

    let mut current = &json_val;
    for segment in &segments {
        match current.get(segment) {
            Some(v) => current = v,
            None => {
                return (
                    false,
                    format!("Path '{}' not found in JSON output", config.path),
                    None,
                );
            }
        }
    }

    let value_str = match current {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    if config.exists_only {
        return (
            true,
            format!("Path '{}' exists with value: {}", config.path, value_str),
            Some(value_str),
        );
    }

    if let Some(ref expected) = config.expected {
        let passed = value_str == *expected;
        let explanation = if passed {
            format!("Path '{}' equals expected '{}'", config.path, expected)
        } else {
            format!(
                "Path '{}' is '{}', expected '{}'",
                config.path, value_str, expected
            )
        };
        (passed, explanation, Some(value_str))
    } else {
        // No expected value and not exists_only -- just check it exists
        (
            true,
            format!("Path '{}' found: {}", config.path, value_str),
            Some(value_str),
        )
    }
}

fn eval_json_schema(config_json: &str, output: &str) -> (bool, String, Option<String>) {
    let config: JsonSchemaConfig = match serde_json::from_str(config_json) {
        Ok(c) => c,
        Err(e) => return (false, format!("Invalid json_schema config: {e}"), None),
    };

    let json_val: serde_json::Value = match serde_json::from_str(output) {
        Ok(v) => v,
        Err(_) => {
            let trimmed = output.trim();
            let json_start = trimmed.find('{');
            let json_end = trimmed.rfind('}');
            match (json_start, json_end) {
                (Some(s), Some(e)) if s < e => match serde_json::from_str(&trimmed[s..=e]) {
                    Ok(v) => v,
                    Err(_) => {
                        return (
                            false,
                            "Output is not valid JSON; cannot validate schema".into(),
                            None,
                        )
                    }
                },
                _ => {
                    return (
                        false,
                        "Output is not valid JSON; cannot validate schema".into(),
                        None,
                    )
                }
            }
        }
    };

    let obj = match json_val.as_object() {
        Some(o) => o,
        None => return (false, "Output JSON is not an object".into(), None),
    };

    let mut missing = Vec::new();
    for key in &config.required_keys {
        if !obj.contains_key(key) {
            missing.push(key.as_str());
        }
    }

    let passed = missing.is_empty();
    let explanation = if passed {
        format!(
            "All {} required keys present",
            config.required_keys.len()
        )
    } else {
        format!(
            "Missing required keys: {}",
            missing.join(", ")
        )
    };

    (passed, explanation, None)
}

fn eval_length(config_json: &str, output: &str) -> (bool, String, Option<String>) {
    let config: LengthConfig = match serde_json::from_str(config_json) {
        Ok(c) => c,
        Err(e) => return (false, format!("Invalid length config: {e}"), None),
    };

    let len = output.len();
    let mut issues = Vec::new();

    if let Some(min) = config.min {
        if len < min {
            issues.push(format!("too short ({len} < {min})"));
        }
    }
    if let Some(max) = config.max {
        if len > max {
            issues.push(format!("too long ({len} > {max})"));
        }
    }

    let passed = issues.is_empty();
    let explanation = if passed {
        format!("Output length {len} within bounds")
    } else {
        format!("Output length {len}: {}", issues.join(", "))
    };

    (passed, explanation, Some(len.to_string()))
}

// ============================================================================
// Public API: evaluate all assertions for a persona against an execution
// ============================================================================

/// Evaluate all enabled assertions for a persona against the given output.
/// Persists results to the database and updates assertion counters.
/// Returns the summary including individual results.
pub fn evaluate_assertions(
    pool: &DbPool,
    execution_id: &str,
    persona_id: &str,
    output: &str,
) -> ExecutionAssertionSummary {
    use crate::db::repos::execution::assertions as repo;

    // Load enabled assertions for this persona
    let assertions = match repo::list_enabled_by_persona(pool, persona_id) {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!(persona_id, "Failed to load assertions: {}", e);
            return ExecutionAssertionSummary {
                execution_id: execution_id.to_string(),
                total: 0,
                passed: 0,
                failed: 0,
                results: vec![],
            };
        }
    };

    if assertions.is_empty() {
        return ExecutionAssertionSummary {
            execution_id: execution_id.to_string(),
            total: 0,
            passed: 0,
            failed: 0,
            results: vec![],
        };
    }

    let mut results = Vec::with_capacity(assertions.len());
    let mut passed_count = 0i64;
    let mut failed_count = 0i64;

    for assertion in &assertions {
        let mut result = evaluate_one(assertion, output);
        result.execution_id = execution_id.to_string();

        if result.passed {
            passed_count += 1;
        } else {
            failed_count += 1;
        }

        // Persist result
        if let Err(e) = repo::insert_result(pool, &result) {
            tracing::warn!(assertion_id = %assertion.id, "Failed to persist assertion result: {}", e);
        }

        // Update assertion counters
        if let Err(e) = repo::increment_counter(pool, &assertion.id, result.passed) {
            tracing::warn!(assertion_id = %assertion.id, "Failed to update assertion counter: {}", e);
        }

        // Handle failure actions
        if !result.passed {
            handle_failure_action(pool, assertion, execution_id, persona_id, &result.explanation);
        }

        results.push(result);
    }

    ExecutionAssertionSummary {
        execution_id: execution_id.to_string(),
        total: results.len() as i64,
        passed: passed_count,
        failed: failed_count,
        results,
    }
}

/// Handle the on_failure action for a failed assertion.
fn handle_failure_action(
    pool: &DbPool,
    assertion: &OutputAssertion,
    execution_id: &str,
    persona_id: &str,
    explanation: &str,
) {
    match assertion.on_failure {
        AssertionFailureAction::Log => {
            tracing::info!(
                assertion = %assertion.name,
                execution_id,
                "Assertion failed: {}",
                explanation
            );
        }
        AssertionFailureAction::Review => {
            let input = crate::db::models::CreateManualReviewInput {
                execution_id: execution_id.to_string(),
                persona_id: persona_id.to_string(),
                title: format!("Assertion failed: {}", assertion.name),
                description: Some(explanation.to_string()),
                severity: Some(assertion.severity.clone()),
                context_data: Some(
                    serde_json::json!({
                        "assertion_id": assertion.id,
                        "assertion_type": assertion.assertion_type,
                        "source": "output_assertion",
                    })
                    .to_string(),
                ),
                suggested_actions: Some(
                    serde_json::json!([
                        "Review the execution output",
                        "Update the assertion configuration",
                        "Adjust the persona prompt"
                    ])
                    .to_string(),
                ),
            };
            if let Err(e) =
                crate::db::repos::communication::manual_reviews::create(pool, input)
            {
                tracing::warn!(
                    assertion = %assertion.name,
                    "Failed to create manual review for assertion failure: {}", e
                );
            }
        }
        AssertionFailureAction::Heal => {
            if let Err(e) = crate::db::repos::execution::healing::create(
                pool,
                persona_id,
                &format!("Assertion violation: {}", assertion.name),
                explanation,
                false,
                Some(&assertion.severity),
                Some("assertion_failure"),
                Some(execution_id),
                Some("Review and update persona prompt to comply with assertion rules"),
            ) {
                tracing::warn!(
                    assertion = %assertion.name,
                    "Failed to create healing issue for assertion failure: {}", e
                );
            }
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{AssertionFailureAction, AssertionType, OutputAssertion};

    fn make_assertion(assertion_type: AssertionType, config: &str) -> OutputAssertion {
        OutputAssertion {
            id: "test-assertion".into(),
            persona_id: "test-persona".into(),
            name: "Test Assertion".into(),
            description: None,
            assertion_type,
            config: config.into(),
            severity: "warning".into(),
            enabled: true,
            on_failure: AssertionFailureAction::Log,
            pass_count: 0,
            fail_count: 0,
            last_evaluated_at: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn test_regex_match() {
        let a = make_assertion(
            AssertionType::Regex,
            r#"{"pattern": "\\d{3}-\\d{4}"}"#,
        );
        let result = evaluate_one(&a, "Call us at 555-1234 for help");
        assert!(result.passed);
        assert_eq!(result.matched_value.as_deref(), Some("555-1234"));
    }

    #[test]
    fn test_regex_no_match() {
        let a = make_assertion(AssertionType::Regex, r#"{"pattern": "^ERROR"}"#);
        let result = evaluate_one(&a, "Everything is fine");
        assert!(!result.passed);
    }

    #[test]
    fn test_regex_negate() {
        let a = make_assertion(
            AssertionType::Regex,
            r#"{"pattern": "password|secret|api_key", "negate": true}"#,
        );
        let result = evaluate_one(&a, "The result is 42");
        assert!(result.passed);

        let result2 = evaluate_one(&a, "Your api_key is ABC123");
        assert!(!result2.passed);
    }

    #[test]
    fn test_contains_all() {
        let a = make_assertion(
            AssertionType::Contains,
            r#"{"phrases": ["hello", "world"], "match_all": true}"#,
        );
        let result = evaluate_one(&a, "Hello World!");
        assert!(result.passed);

        let result2 = evaluate_one(&a, "Hello there");
        assert!(!result2.passed);
    }

    #[test]
    fn test_contains_any() {
        let a = make_assertion(
            AssertionType::Contains,
            r#"{"phrases": ["success", "completed"], "match_all": false}"#,
        );
        let result = evaluate_one(&a, "Task completed successfully");
        assert!(result.passed);
    }

    #[test]
    fn test_not_contains_pass() {
        let a = make_assertion(
            AssertionType::NotContains,
            r#"{"patterns": ["SSN", "social security", "credit card"]}"#,
        );
        let result = evaluate_one(&a, "The report is ready for review");
        assert!(result.passed);
    }

    #[test]
    fn test_not_contains_fail() {
        let a = make_assertion(
            AssertionType::NotContains,
            r#"{"patterns": ["SSN", "social security"]}"#,
        );
        let result = evaluate_one(&a, "Found SSN: 123-45-6789");
        assert!(!result.passed);
        assert!(result.explanation.contains("SSN"));
    }

    #[test]
    fn test_json_path_exists() {
        let a = make_assertion(
            AssertionType::JsonPath,
            r#"{"path": "$.result.status", "exists_only": true}"#,
        );
        let result = evaluate_one(&a, r#"{"result": {"status": "ok", "count": 5}}"#);
        assert!(result.passed);
    }

    #[test]
    fn test_json_path_value() {
        let a = make_assertion(
            AssertionType::JsonPath,
            r#"{"path": "$.result.status", "expected": "ok"}"#,
        );
        let result = evaluate_one(&a, r#"{"result": {"status": "ok"}}"#);
        assert!(result.passed);

        let result2 = evaluate_one(&a, r#"{"result": {"status": "error"}}"#);
        assert!(!result2.passed);
    }

    #[test]
    fn test_json_schema_required_keys() {
        let a = make_assertion(
            AssertionType::JsonSchema,
            r#"{"required_keys": ["status", "message"]}"#,
        );
        let result = evaluate_one(&a, r#"{"status": "ok", "message": "done", "extra": 1}"#);
        assert!(result.passed);

        let result2 = evaluate_one(&a, r#"{"status": "ok"}"#);
        assert!(!result2.passed);
    }

    #[test]
    fn test_length_bounds() {
        let a = make_assertion(
            AssertionType::Length,
            r#"{"min": 10, "max": 1000}"#,
        );
        let result = evaluate_one(&a, "This is a valid length output");
        assert!(result.passed);

        let result2 = evaluate_one(&a, "Short");
        assert!(!result2.passed);
    }
}
