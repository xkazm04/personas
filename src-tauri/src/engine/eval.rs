//! Unified evaluation framework for persona testing.
//!
//! Three independent evaluation approaches existed:
//!   1. Confusion-phrase detection in draft testing (string matching against failure patterns)
//!   2. Keyword-presence scoring in the test runner (expected behavior terms in output)
//!   3. Tool-accuracy / protocol-compliance scoring (expected vs actual tool calls)
//!
//! This module unifies them under a single `EvalStrategy` trait with pluggable
//! implementations. Each strategy produces a standardized `EvalResult` with
//! score, confidence, and explanation.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// EvalResult — standardized output from any evaluation strategy
// ============================================================================

/// A standardized evaluation result produced by any EvalStrategy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalResult {
    /// The strategy that produced this result.
    pub strategy: EvalStrategyKind,
    /// Score from 0–100. Higher is better.
    pub score: i32,
    /// Confidence in the score (0.0–1.0). Low confidence means the evaluation
    /// had limited signal (e.g. no expected behavior specified).
    pub confidence: f64,
    /// Human-readable explanation of how the score was derived.
    pub explanation: String,
    /// Whether this evaluation indicates a pass or fail.
    /// None means the strategy doesn't make a binary judgement.
    pub passed: Option<bool>,
}

/// Identifies which strategy produced an EvalResult.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum EvalStrategyKind {
    /// Keyword-presence scoring: checks expected behavior terms in output.
    KeywordMatch,
    /// Tool accuracy: compares expected vs actual tool calls.
    ToolAccuracy,
    /// Protocol compliance: checks for protocol message patterns.
    ProtocolCompliance,
    /// Confusion detection: checks for known confusion/failure phrases.
    ConfusionDetect,
    /// Composite: weighted combination of other strategies.
    Composite,
}

// ============================================================================
// EvalInput — what every strategy receives
// ============================================================================

/// Input provided to evaluation strategies.
pub struct EvalInput<'a> {
    /// The assistant's output text.
    pub output: &'a str,
    /// Expected behavior description (from test scenario).
    pub expected_behavior: Option<&'a str>,
    /// Expected tool call sequence.
    pub expected_tools: Option<&'a [String]>,
    /// Actual tool calls made by the agent.
    pub actual_tools: Option<&'a [String]>,
    /// Expected protocol messages.
    pub expected_protocols: Option<&'a [String]>,
    /// Whether the persona has tools configured.
    pub has_tools: bool,
}

// ============================================================================
// Strategy implementations
// ============================================================================

/// Evaluate output quality by checking keyword presence from expected behavior.
pub fn eval_keyword_match(input: &EvalInput) -> EvalResult {
    let expected = match input.expected_behavior {
        Some(eb) if !eb.is_empty() => eb,
        _ => {
            return EvalResult {
                strategy: EvalStrategyKind::KeywordMatch,
                score: 50,
                confidence: 0.2,
                explanation: "No expected behavior specified; defaulting to neutral score".into(),
                passed: None,
            };
        }
    };

    let output = match input.output {
        o if !o.is_empty() => o,
        _ => {
            return EvalResult {
                strategy: EvalStrategyKind::KeywordMatch,
                score: 0,
                confidence: 0.9,
                explanation: "Output is empty".into(),
                passed: Some(false),
            };
        }
    };

    // Extract key terms from expected_behavior and check for presence
    let keywords: Vec<&str> = expected
        .split_whitespace()
        .filter(|w| w.len() > 3)
        .collect();

    if keywords.is_empty() {
        return EvalResult {
            strategy: EvalStrategyKind::KeywordMatch,
            score: 50,
            confidence: 0.2,
            explanation: "Expected behavior has no significant keywords".into(),
            passed: None,
        };
    }

    let output_lower = output.to_lowercase();
    let mut found = 0;
    for kw in &keywords {
        if output_lower.contains(&kw.to_lowercase()) {
            found += 1;
        }
    }

    let score = ((found as f64 / keywords.len() as f64) * 100.0).min(100.0) as i32;
    let confidence = if keywords.len() >= 5 { 0.7 } else { 0.5 };

    EvalResult {
        strategy: EvalStrategyKind::KeywordMatch,
        score,
        confidence,
        explanation: format!("{}/{} expected keywords found in output", found, keywords.len()),
        passed: Some(score >= 40),
    }
}

/// Evaluate tool usage accuracy by comparing expected vs actual tool calls.
pub fn eval_tool_accuracy(input: &EvalInput) -> EvalResult {
    let expected = match input.expected_tools {
        Some(e) if !e.is_empty() => e,
        _ => {
            let actual = input.actual_tools.map(|a| a.len()).unwrap_or(0);
            let score = if actual == 0 { 100 } else { 50 };
            return EvalResult {
                strategy: EvalStrategyKind::ToolAccuracy,
                score,
                confidence: 0.3,
                explanation: if actual == 0 {
                    "No expected tools and no tools called".into()
                } else {
                    format!("No expected tools but {} tool(s) called", actual)
                },
                passed: None,
            };
        }
    };

    let actual = input.actual_tools.unwrap_or(&[]);

    // Check what fraction of expected tools were referenced
    let mut matched = 0;
    for exp in expected {
        if actual.iter().any(|a| a == exp) {
            matched += 1;
        }
    }

    let recall = (matched as f64 / expected.len() as f64) * 100.0;

    // Penalize for extra unexpected tool calls (but mildly)
    let extra = actual.len().saturating_sub(expected.len());
    let penalty = (extra as f64 * 5.0).min(20.0);

    let score = (recall - penalty).clamp(0.0, 100.0) as i32;

    EvalResult {
        strategy: EvalStrategyKind::ToolAccuracy,
        score,
        confidence: 0.8,
        explanation: format!(
            "{}/{} expected tools called{}",
            matched,
            expected.len(),
            if extra > 0 { format!(", {} extra calls (-{} penalty)", extra, penalty as i32) } else { String::new() }
        ),
        passed: Some(score >= 50),
    }
}

/// Evaluate protocol compliance by checking for protocol patterns in output.
pub fn eval_protocol_compliance(input: &EvalInput) -> EvalResult {
    let expected = match input.expected_protocols {
        Some(e) if !e.is_empty() => e,
        _ => {
            return EvalResult {
                strategy: EvalStrategyKind::ProtocolCompliance,
                score: 100,
                confidence: 0.3,
                explanation: "No protocol expectations specified".into(),
                passed: None,
            };
        }
    };

    let output = input.output;
    let mut found = 0;
    for proto in expected {
        let pattern = format!("\"{}\":", proto);
        let alt_pattern = format!("{{{}", proto);
        if output.contains(&pattern) || output.contains(&alt_pattern) {
            found += 1;
        }
    }

    let score = ((found as f64 / expected.len() as f64) * 100.0) as i32;

    EvalResult {
        strategy: EvalStrategyKind::ProtocolCompliance,
        score,
        confidence: 0.6,
        explanation: format!("{}/{} expected protocol patterns found", found, expected.len()),
        passed: Some(score >= 50),
    }
}

/// Detect confusion/failure phrases indicating the agent is lost.
pub fn eval_confusion_detect(input: &EvalInput) -> EvalResult {
    if input.output.is_empty() {
        return EvalResult {
            strategy: EvalStrategyKind::ConfusionDetect,
            score: 0,
            confidence: 0.9,
            explanation: "Output is empty".into(),
            passed: Some(false),
        };
    }

    let text_lower = input.output.to_lowercase();

    let confusion_phrases = [
        "i don't have enough information",
        "i don't know which api",
        "unable to determine",
        "i cannot determine",
        "i'm not sure how to",
        "i don't have access to",
        "i need more information",
        "i cannot find any",
        "no api endpoint",
        "no implementation details",
        "missing credentials",
        "i don't know how to call",
        "i'm unable to proceed",
        "i cannot proceed",
    ];

    let matched: Vec<&&str> = confusion_phrases
        .iter()
        .filter(|phrase| text_lower.contains(**phrase))
        .collect();

    if !matched.is_empty() {
        return EvalResult {
            strategy: EvalStrategyKind::ConfusionDetect,
            score: 0,
            confidence: 0.85,
            explanation: format!(
                "Agent appears confused — matched {} confusion phrase(s): \"{}\"",
                matched.len(),
                matched[0]
            ),
            passed: Some(false),
        };
    }

    // Check if agent has tools but didn't use any
    if input.has_tools {
        let actual_count = input.actual_tools.map(|a| a.len()).unwrap_or(0);
        if actual_count == 0 {
            return EvalResult {
                strategy: EvalStrategyKind::ConfusionDetect,
                score: 20,
                confidence: 0.6,
                explanation: "Agent has tools but did not attempt to use any".into(),
                passed: Some(false),
            };
        }
    }

    EvalResult {
        strategy: EvalStrategyKind::ConfusionDetect,
        score: 100,
        confidence: 0.7,
        explanation: "No confusion indicators detected".into(),
        passed: Some(true),
    }
}

// ============================================================================
// Composite evaluation — runs multiple strategies and combines results
// ============================================================================

/// Weights for composite scoring. Keep in sync with frontend.
pub const WEIGHT_TOOL_ACCURACY: f64 = 0.4;
pub const WEIGHT_OUTPUT_QUALITY: f64 = 0.4;
pub const WEIGHT_PROTOCOL_COMPLIANCE: f64 = 0.2;

/// Run all applicable strategies and combine into a composite result.
/// Returns individual results plus the composite.
#[allow(dead_code)]
pub fn eval_composite(input: &EvalInput) -> CompositeEvalResult {
    let keyword = eval_keyword_match(input);
    let tool = eval_tool_accuracy(input);
    let protocol = eval_protocol_compliance(input);
    let confusion = eval_confusion_detect(input);

    // If confusion detected, override composite
    if confusion.score == 0 && confusion.confidence > 0.5 {
        return CompositeEvalResult {
            composite: EvalResult {
                strategy: EvalStrategyKind::Composite,
                score: 0,
                confidence: confusion.confidence,
                explanation: format!("Blocked by confusion detection: {}", confusion.explanation),
                passed: Some(false),
            },
            individual: vec![keyword, tool, protocol, confusion],
        };
    }

    let composite_score = (tool.score as f64 * WEIGHT_TOOL_ACCURACY
        + keyword.score as f64 * WEIGHT_OUTPUT_QUALITY
        + protocol.score as f64 * WEIGHT_PROTOCOL_COMPLIANCE)
        .round() as i32;

    // Weighted confidence
    let composite_confidence = tool.confidence * WEIGHT_TOOL_ACCURACY
        + keyword.confidence * WEIGHT_OUTPUT_QUALITY
        + protocol.confidence * WEIGHT_PROTOCOL_COMPLIANCE;

    CompositeEvalResult {
        composite: EvalResult {
            strategy: EvalStrategyKind::Composite,
            score: composite_score,
            confidence: composite_confidence,
            explanation: format!(
                "Composite: tool_accuracy={} (w={:.1}), output_quality={} (w={:.1}), protocol={} (w={:.1})",
                tool.score, WEIGHT_TOOL_ACCURACY,
                keyword.score, WEIGHT_OUTPUT_QUALITY,
                protocol.score, WEIGHT_PROTOCOL_COMPLIANCE,
            ),
            passed: Some(composite_score >= 50),
        },
        individual: vec![keyword, tool, protocol, confusion],
    }
}

/// Result of a composite evaluation: the combined score plus individual strategy results.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositeEvalResult {
    pub composite: EvalResult,
    pub individual: Vec<EvalResult>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_input<'a>(
        output: &'a str,
        expected_behavior: Option<&'a str>,
        expected_tools: Option<&'a [String]>,
        actual_tools: Option<&'a [String]>,
    ) -> EvalInput<'a> {
        EvalInput {
            output,
            expected_behavior,
            expected_tools,
            actual_tools,
            expected_protocols: None,
            has_tools: true,
        }
    }

    // ── Keyword Match ──

    #[test]
    fn test_keyword_match_good_output() {
        let input = make_input(
            "The email was sent successfully to john@example.com with the report attached.",
            Some("send email with report attachment"),
            None,
            None,
        );
        let result = eval_keyword_match(&input);
        assert!(result.score > 50, "Score should be high: {}", result.score);
        assert!(result.passed == Some(true));
    }

    #[test]
    fn test_keyword_match_empty_output() {
        let input = make_input("", Some("send email with report"), None, None);
        let result = eval_keyword_match(&input);
        assert_eq!(result.score, 0);
        assert!(result.passed == Some(false));
    }

    #[test]
    fn test_keyword_match_no_expected() {
        let input = make_input("Some output", None, None, None);
        let result = eval_keyword_match(&input);
        assert_eq!(result.score, 50);
        assert!(result.confidence < 0.5);
    }

    // ── Tool Accuracy ──

    #[test]
    fn test_tool_accuracy_perfect() {
        let expected = vec!["gmail_send".to_string(), "slack_post".to_string()];
        let actual = vec!["gmail_send".to_string(), "slack_post".to_string()];
        let input = make_input("output", None, Some(&expected), Some(&actual));
        let result = eval_tool_accuracy(&input);
        assert_eq!(result.score, 100);
    }

    #[test]
    fn test_tool_accuracy_partial() {
        let expected = vec!["gmail_send".to_string(), "slack_post".to_string()];
        let actual = vec!["gmail_send".to_string()];
        let input = make_input("output", None, Some(&expected), Some(&actual));
        let result = eval_tool_accuracy(&input);
        assert_eq!(result.score, 50);
    }

    #[test]
    fn test_tool_accuracy_extra_calls() {
        let expected = vec!["gmail_send".to_string()];
        let actual = vec!["gmail_send".to_string(), "slack_post".to_string(), "drive_upload".to_string()];
        let input = make_input("output", None, Some(&expected), Some(&actual));
        let result = eval_tool_accuracy(&input);
        assert!(result.score < 100, "Extra calls should reduce score: {}", result.score);
        assert!(result.score > 70, "But not by too much: {}", result.score);
    }

    // ── Confusion Detect ──

    #[test]
    fn test_confusion_detected() {
        let input = make_input(
            "I don't have enough information to proceed with this task.",
            None,
            None,
            None,
        );
        let result = eval_confusion_detect(&input);
        assert_eq!(result.score, 0);
        assert!(result.passed == Some(false));
        assert!(result.explanation.contains("confused"));
    }

    #[test]
    fn test_no_confusion() {
        let actual = vec!["gmail_send".to_string()];
        let input = make_input(
            "Successfully processed the request and sent the email.",
            None,
            None,
            Some(&actual),
        );
        let result = eval_confusion_detect(&input);
        assert_eq!(result.score, 100);
        assert!(result.passed == Some(true));
    }

    #[test]
    fn test_no_tool_use_with_tools() {
        let actual: Vec<String> = vec![];
        let input = EvalInput {
            output: "I analyzed the situation and here is my recommendation.",
            expected_behavior: None,
            expected_tools: None,
            actual_tools: Some(&actual),
            expected_protocols: None,
            has_tools: true,
        };
        let result = eval_confusion_detect(&input);
        assert_eq!(result.score, 20);
        assert!(result.passed == Some(false));
    }

    // ── Protocol Compliance ──

    #[test]
    fn test_protocol_compliance_all_found() {
        let protocols = vec!["user_message".to_string()];
        let input = EvalInput {
            output: r#"{"user_message": "Hello world"}"#,
            expected_behavior: None,
            expected_tools: None,
            actual_tools: None,
            expected_protocols: Some(&protocols),
            has_tools: false,
        };
        let result = eval_protocol_compliance(&input);
        assert_eq!(result.score, 100);
    }

    #[test]
    fn test_protocol_compliance_none_expected() {
        let input = EvalInput {
            output: "some output",
            expected_behavior: None,
            expected_tools: None,
            actual_tools: None,
            expected_protocols: None,
            has_tools: false,
        };
        let result = eval_protocol_compliance(&input);
        assert_eq!(result.score, 100);
        assert!(result.confidence < 0.5);
    }

    // ── Composite ──

    #[test]
    fn test_composite_normal() {
        let expected_tools = vec!["gmail_send".to_string()];
        let actual_tools = vec!["gmail_send".to_string()];
        let input = EvalInput {
            output: "Email sent successfully with the report attached to john@example.com.",
            expected_behavior: Some("send email with report attachment"),
            expected_tools: Some(&expected_tools),
            actual_tools: Some(&actual_tools),
            expected_protocols: None,
            has_tools: true,
        };
        let result = eval_composite(&input);
        assert!(result.composite.score > 60, "Composite should be decent: {}", result.composite.score);
        assert_eq!(result.individual.len(), 4);
    }

    #[test]
    fn test_composite_confusion_override() {
        let input = EvalInput {
            output: "I don't have enough information to determine which API to call.",
            expected_behavior: Some("send email"),
            expected_tools: None,
            actual_tools: None,
            expected_protocols: None,
            has_tools: true,
        };
        let result = eval_composite(&input);
        assert_eq!(result.composite.score, 0, "Confusion should override composite");
        assert!(result.composite.explanation.contains("confusion"));
    }
}
