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

use super::cli_process::CliProcessDriver;
use super::parser;
use super::prompt;
use super::types::*;

// ============================================================================
// EvalResult -- standardized output from any evaluation strategy
// ============================================================================

/// A standardized evaluation result produced by any EvalStrategy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalResult {
    /// The strategy that produced this result.
    pub strategy: EvalStrategyKind,
    /// Score from 0--100. Higher is better.
    pub score: i32,
    /// Confidence in the score (0.0--1.0). Low confidence means the evaluation
    /// had limited signal (e.g. no expected behavior specified).
    pub confidence: f64,
    /// Human-readable explanation of how the score was derived.
    pub explanation: String,
    /// Whether this evaluation indicates a pass or fail.
    /// None means the strategy doesn't make a binary judgement.
    pub passed: Option<bool>,
}

/// Indicates which evaluation method produced the scores.
/// Propagated to the frontend so users know when scores came from degraded evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum EvalMethod {
    /// Full LLM-based evaluation with Claude scoring and rationale.
    Llm,
    /// Heuristic fallback: keyword-match + tool-accuracy scoring (LLM eval failed after retries).
    HeuristicFallback,
    /// Heuristic fallback triggered specifically by a timeout.
    Timeout,
}

impl EvalMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Llm => "llm",
            Self::HeuristicFallback => "heuristic_fallback",
            Self::Timeout => "timeout",
        }
    }
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
// EvalInput -- what every strategy receives
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
                    format!("No expected tools but {actual} tool(s) called")
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
        let pattern = format!("\"{proto}\":");
        let alt_pattern = format!("{{{proto}");
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
                "Agent appears confused -- matched {} confusion phrase(s): \"{}\"",
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
// Composite evaluation -- runs multiple strategies and combines results
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
// LLM-based evaluation -- asks Claude to score and provide rationale
// ============================================================================

/// Result from LLM-based evaluation, including scores, rationale, and suggestions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct LlmEvalResult {
    pub tool_accuracy: i32,
    pub output_quality: i32,
    pub protocol_compliance: i32,
    /// Combined rationale string (backwards-compatible). Built from per-metric fields.
    pub rationale: String,
    /// Combined suggestions string (backwards-compatible).
    pub suggestions: String,
    /// Per-metric rationale for rich UI display (optional for backwards compat).
    #[serde(default)]
    pub tool_accuracy_rationale: Option<String>,
    #[serde(default)]
    pub output_quality_rationale: Option<String>,
    #[serde(default)]
    pub protocol_rationale: Option<String>,
    /// Verdict: one-line summary of the overall result.
    #[serde(default)]
    pub verdict: Option<String>,
    /// How the evaluation was performed: full LLM, heuristic fallback, or timeout.
    #[serde(default = "default_eval_method")]
    pub eval_method: EvalMethod,
}

fn default_eval_method() -> EvalMethod {
    EvalMethod::Llm
}

/// Ask an LLM to evaluate a persona's test result, providing scores, rationale,
/// and concrete improvement suggestions. Falls back to heuristic scoring on failure.
pub async fn eval_with_llm(
    input: &EvalInput<'_>,
    persona_name: &str,
    persona_description: &str,
    scenario_name: &str,
    scenario_description: &str,
) -> LlmEvalResult {
    let eval_prompt = build_llm_eval_prompt(
        input, persona_name, persona_description, scenario_name, scenario_description,
    );

    // Try LLM eval up to 2 times before falling back to heuristic
    let mut last_err = String::new();
    for attempt in 0..2u8 {
        match run_llm_eval(&eval_prompt).await {
            Ok(result) => return result,
            Err(e) => {
                last_err = e.clone();
                if attempt == 0 {
                    tracing::debug!("LLM eval attempt 1 failed, retrying: {last_err}");
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                }
            }
        }
    }

    // Distinguish timeout from other failures
    let is_timeout = last_err.contains("timed out");
    let method = if is_timeout { EvalMethod::Timeout } else { EvalMethod::HeuristicFallback };
    tracing::warn!("LLM eval failed after 2 attempts (method={:?}), falling back to heuristic: {last_err}", method);
    fallback_heuristic(input, method)
}

fn build_llm_eval_prompt(
    input: &EvalInput<'_>,
    persona_name: &str,
    persona_description: &str,
    scenario_name: &str,
    scenario_description: &str,
) -> String {
    let tool_calls_actual = input.actual_tools
        .map(|t| t.join(", "))
        .unwrap_or_else(|| "(none)".to_string());
    let tool_calls_expected = input.expected_tools
        .map(|t| t.join(", "))
        .unwrap_or_else(|| "(none specified)".to_string());
    let output_preview = if input.output.len() > 3000 {
        &input.output[..3000]
    } else {
        input.output
    };
    let expected_behavior = input.expected_behavior.unwrap_or("(not specified)");

    format!(
        r#"# Persona Test Evaluation

You are an expert AI persona evaluator. Analyze this test result and provide scores WITH clear explanations a human can act on.

## Persona Under Test
- **Name**: {persona_name}
- **Purpose**: {persona_description}

## Test Scenario: "{scenario_name}"
{scenario_description}

## What Was Expected
**Behavior**: {expected_behavior}
**Tool calls**: {tool_calls_expected}

## What Actually Happened
**Tool calls made**: {tool_calls_actual}
**Agent output** (truncated to 3000 chars):
---
{output_preview}
---

## Scoring Rubric (0-100 each)

### tool_accuracy — Did the agent use the right tools correctly?
- **90-100**: Called every expected tool with correct parameters in the right order
- **60-89**: Called most expected tools but missed some or used wrong parameters
- **30-59**: Called some tools but significant gaps or wrong tool choices
- **1-29**: Called almost no expected tools, or called completely wrong tools
- **0**: Made zero tool calls when tools were expected, or no tools were expected and score is N/A (give 50)

### output_quality — Is the output useful and well-structured?
- **90-100**: Complete, well-formatted, directly addresses the scenario with accurate content
- **60-89**: Mostly addresses the scenario but has gaps in completeness or formatting
- **30-59**: Partially addresses the scenario, missing key information or poorly structured
- **1-29**: Barely relevant output, mostly filler or hallucinated content
- **0**: Empty output or completely irrelevant

### protocol_compliance — Did the agent follow its prompt instructions?
- **90-100**: Followed all persona instructions, constraints, and output format rules
- **60-89**: Followed most instructions but missed some constraints
- **30-59**: Followed some instructions but violated important constraints
- **1-29**: Largely ignored the persona's defined behavior
- **0**: No evidence of following any persona instructions

## Response Format
Respond with ONLY a JSON object:
{{
  "tool_accuracy": <0-100>,
  "output_quality": <0-100>,
  "protocol_compliance": <0-100>,
  "tool_accuracy_rationale": "<What tools were/weren't called and why this matters. Be specific about which tools were expected vs used.>",
  "output_quality_rationale": "<What the output got right/wrong. Reference specific content from the output.>",
  "protocol_rationale": "<Which persona instructions were followed/violated. Quote specific rules if possible.>",
  "verdict": "<One sentence: what is the single most important thing the user should know about this result?>",
  "suggestions": "<2-3 specific prompt changes that would fix the weakest areas. Be concrete — say exactly what to add/change in the prompt, not vague advice.>"
}}"#
    )
}

async fn run_llm_eval(prompt_text: &str) -> Result<LlmEvalResult, String> {
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let mut driver = CliProcessDriver::spawn_temp_no_stderr(&cli_args, "personas-llm-eval")
        .map_err(|e| format!("Failed to spawn LLM eval process: {e}"))?;
    driver.write_stdin(prompt_text.as_bytes()).await;

    let mut assistant_text = String::new();
    let timeout = tokio::time::Duration::from_secs(180);

    driver.collect_lines_with_timeout(timeout, |line| {
        let (line_type, _) = parser::parse_stream_line(line);
        if let StreamLineType::AssistantText { text } = line_type {
            assistant_text.push_str(&text);
            assistant_text.push('\n');
        }
    }).await.map_err(|e| format!("LLM eval timed out or failed: {e}"))?;

    let _ = driver.finish().await;

    parse_llm_eval_response(&assistant_text)
}

fn parse_llm_eval_response(raw: &str) -> Result<LlmEvalResult, String> {
    let trimmed = raw.trim();

    // Try direct parse
    if let Ok(result) = serde_json::from_str::<LlmEvalResult>(trimmed) {
        return validate_llm_result(result);
    }

    // Try to extract JSON from text
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            let json_str = &trimmed[start..=end];
            if let Ok(result) = serde_json::from_str::<LlmEvalResult>(json_str) {
                return validate_llm_result(result);
            }
        }
    }

    Err(format!(
        "Failed to parse LLM eval response. Raw (first 500 chars): {}",
        &trimmed[..trimmed.len().min(500)]
    ))
}

fn validate_llm_result(mut result: LlmEvalResult) -> Result<LlmEvalResult, String> {
    // Clamp all scores to valid 0-100 range
    result.tool_accuracy = result.tool_accuracy.clamp(0, 100);
    result.output_quality = result.output_quality.clamp(0, 100);
    result.protocol_compliance = result.protocol_compliance.clamp(0, 100);

    // Build combined rationale from per-metric fields if the rationale is empty or generic
    if result.rationale.is_empty() || result.rationale.len() < 20 {
        let mut parts = Vec::new();
        if let Some(ref r) = result.tool_accuracy_rationale {
            parts.push(format!("Tool usage: {}", r));
        }
        if let Some(ref r) = result.output_quality_rationale {
            parts.push(format!("Output quality: {}", r));
        }
        if let Some(ref r) = result.protocol_rationale {
            parts.push(format!("Protocol: {}", r));
        }
        if !parts.is_empty() {
            result.rationale = parts.join(" | ");
        }
    }
    Ok(result)
}

/// Fallback to heuristic scoring when LLM evaluation fails.
fn fallback_heuristic(input: &EvalInput<'_>, method: EvalMethod) -> LlmEvalResult {
    let tool = eval_tool_accuracy(input);
    let keyword = eval_keyword_match(input);
    let protocol = eval_protocol_compliance(input);

    LlmEvalResult {
        tool_accuracy: tool.score,
        output_quality: keyword.score,
        protocol_compliance: protocol.score,
        rationale: format!(
            "Heuristic fallback: tool_accuracy={} ({}), output_quality={} ({}), protocol={}  ({})",
            tool.score, tool.explanation,
            keyword.score, keyword.explanation,
            protocol.score, protocol.explanation,
        ),
        suggestions: "LLM evaluation unavailable; consider re-running with LLM eval enabled.".to_string(),
        tool_accuracy_rationale: Some(tool.explanation.clone()),
        output_quality_rationale: Some(keyword.explanation.clone()),
        protocol_rationale: Some(protocol.explanation.clone()),
        verdict: Some("Scored using heuristic fallback (LLM eval was unavailable).".to_string()),
        eval_method: method,
    }
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

    // -- Keyword Match --

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

    // -- Tool Accuracy --

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

    // -- Confusion Detect --

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

    // -- Protocol Compliance --

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

    // -- Composite --

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
