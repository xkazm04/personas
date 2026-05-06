//! LLM-critique mutation operator for persona evolution.
//!
//! Companion to `engine::genome::mutate` (which does mechanical mutations:
//! shuffle/drop/duplicate prompt segments, permute tools, jiggle timeout).
//! This module rewrites prompt segments based on textual gradient feedback
//! derived from the persona's own low-fitness execution history.
//!
//! Loop: read recent failure-leaning knowledge entries → ask Claude to
//! critique-and-rewrite the current prompt → return a mutated genome with
//! new `prompt_segments`. On any error (no signal, CLI spawn failure, JSON
//! parse failure), returns Err so the evolution cycle can fall back to the
//! mechanical mutator.

use crate::db::models::{ExecutionKnowledge, Persona};
use crate::db::repos::execution::knowledge as knowledge_repo;
use crate::db::DbPool;
use crate::engine::cli_process::CliProcessDriver;
use crate::engine::genome::{PersonaGenome, PromptSegment};
use crate::engine::parser;
use crate::engine::prompt;
use crate::engine::types::StreamLineType;

const CRITIQUE_TIMEOUT_SECS: u64 = 180;
const MIN_OBSERVATIONS_PER_PATTERN: i64 = 3;
const MAX_FAILURE_PATTERNS_IN_PROMPT: usize = 8;

/// Rewrite a persona's prompt segments via LLM critique driven by recent
/// failure-leaning execution knowledge.
///
/// Returns a mutated `PersonaGenome` on success, or an error string when:
/// - Insufficient failure signal exists (the persona has no real gradient)
/// - The Claude CLI spawn fails
/// - The response cannot be parsed into a structured rewrite
///
/// Callers should treat errors as "fall back to mechanical mutation."
pub async fn mutate_via_critique(
    pool: &DbPool,
    persona: &Persona,
    incumbent: &PersonaGenome,
) -> Result<PersonaGenome, String> {
    // Gather low-fitness knowledge entries — the gradient signal.
    let entries =
        knowledge_repo::list_for_persona(pool, &persona.id, Some("cost_quality"), Some(50))
            .map_err(|e| format!("Failed to load knowledge entries: {e}"))?;

    let failures = select_failure_patterns(&entries);
    if failures.is_empty() {
        return Err("No actionable failure signal — gradient is empty".to_string());
    }

    let current_prompt = render_segments(&incumbent.prompt_segments);
    let critique_prompt = build_critique_prompt(&persona.name, &current_prompt, &failures);

    let assistant_text = run_critique_cli(&critique_prompt).await?;
    let rewritten = parse_rewrite_response(&assistant_text)?;

    let mut mutated = incumbent.clone();
    mutated.prompt_segments = rewritten
        .into_iter()
        .enumerate()
        .map(|(index, text)| PromptSegment { index, text })
        .collect();
    Ok(mutated)
}

/// Select up to `MAX_FAILURE_PATTERNS_IN_PROMPT` knowledge entries whose
/// failure rate dominates and which have at least `MIN_OBSERVATIONS_PER_PATTERN`
/// total observations. Sorted by absolute failure count (worst first).
fn select_failure_patterns(entries: &[ExecutionKnowledge]) -> Vec<&ExecutionKnowledge> {
    let mut candidates: Vec<&ExecutionKnowledge> = entries
        .iter()
        .filter(|e| {
            let total = e.success_count + e.failure_count;
            total >= MIN_OBSERVATIONS_PER_PATTERN && e.failure_count > e.success_count
        })
        .collect();

    candidates.sort_by(|a, b| b.failure_count.cmp(&a.failure_count));
    candidates.truncate(MAX_FAILURE_PATTERNS_IN_PROMPT);
    candidates
}

/// Concatenate prompt segments back into a single string in their stored order.
fn render_segments(segments: &[PromptSegment]) -> String {
    let mut sorted: Vec<&PromptSegment> = segments.iter().collect();
    sorted.sort_by_key(|s| s.index);
    sorted
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Build the critique prompt. The LLM is asked to act as a textual-gradient
/// rewriter: read the current prompt, read the failure signals, return the
/// rewritten prompt as a JSON array of segment strings.
fn build_critique_prompt(
    persona_name: &str,
    current_prompt: &str,
    failures: &[&ExecutionKnowledge],
) -> String {
    let mut failure_block = String::new();
    for (i, e) in failures.iter().enumerate() {
        failure_block.push_str(&format!(
            "{n}. pattern_key=\"{key}\" failure_count={fc} success_count={sc} confidence={conf:.2}\n   pattern_data: {data}\n",
            n = i + 1,
            key = e.pattern_key,
            fc = e.failure_count,
            sc = e.success_count,
            conf = e.confidence,
            data = truncate(&e.pattern_data, 400),
        ));
    }

    format!(
        r#"You are a prompt-rewrite assistant. Your job is to read a persona's current system prompt, study its recent failure patterns, and produce an improved prompt. This is one step of an evolutionary loop — your rewrite will be tested against the incumbent in the lab; if it loses, your work is discarded with no harm done.

# Persona name
{persona_name}

# Current prompt segments (joined with blank lines)
{current_prompt}

# Recent failure-leaning patterns
{failure_block}

# Your task
Rewrite the prompt as a JSON array of paragraph-sized segments. Each segment is a self-contained instruction or constraint. Aim for the same overall length as the input (within ~20%) — do NOT pad. Every change must be motivated by one of the failure patterns above; if a pattern suggests an instruction is missing, add it; if a pattern suggests an existing instruction is ambiguous, sharpen it. Preserve any persona-specific voice, names, or domain vocabulary.

# Response format
Respond with ONLY a JSON object of this exact shape:
{{
  "rewritten_segments": ["segment 1 text", "segment 2 text", "..."],
  "rationale": "<one paragraph explaining which patterns drove which edits>"
}}

No prose outside the JSON. No code fences. The first character of your response MUST be `{{`."#
    )
}

/// Spawn the Claude CLI in single-turn print mode and pipe the critique
/// prompt to stdin. Returns the assistant's text response (or an error on
/// timeout / spawn failure).
async fn run_critique_cli(critique_prompt: &str) -> Result<String, String> {
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let mut driver = CliProcessDriver::spawn_temp_no_stderr(&cli_args, "personas-genome-critique")
        .map_err(|e| format!("Failed to spawn critique CLI: {e}"))?;
    driver.write_stdin(critique_prompt.as_bytes()).await;

    let mut assistant_text = String::new();
    let timeout = tokio::time::Duration::from_secs(CRITIQUE_TIMEOUT_SECS);
    driver
        .collect_lines_with_timeout(timeout, |line| {
            let (line_type, _) = parser::parse_stream_line(line);
            if let StreamLineType::AssistantText { text } = line_type {
                assistant_text.push_str(&text);
                assistant_text.push('\n');
            }
        })
        .await
        .map_err(|e| format!("Critique CLI timed out or failed: {e}"))?;

    let _ = driver.finish().await;
    Ok(assistant_text)
}

/// Parse the assistant's JSON response into a `Vec<String>` of rewritten
/// segments. Tolerates surrounding text by extracting the first balanced
/// `{...}` block (mirrors `engine::eval::parse_llm_eval_response`).
fn parse_rewrite_response(raw: &str) -> Result<Vec<String>, String> {
    #[derive(serde::Deserialize)]
    struct Rewrite {
        rewritten_segments: Vec<String>,
        #[serde(default)]
        #[allow(dead_code)]
        rationale: Option<String>,
    }

    let trimmed = raw.trim();

    let parsed: Option<Rewrite> = serde_json::from_str(trimmed).ok().or_else(|| {
        let start = trimmed.find('{')?;
        let end = trimmed.rfind('}')?;
        if end <= start {
            return None;
        }
        serde_json::from_str(&trimmed[start..=end]).ok()
    });

    let Some(rewrite) = parsed else {
        let head = &trimmed[..trimmed.len().min(500)];
        return Err(format!(
            "Failed to parse critique response. Head (≤500 chars): {head}"
        ));
    };

    let cleaned: Vec<String> = rewrite
        .rewritten_segments
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if cleaned.is_empty() {
        return Err("Critique response had no non-empty rewritten segments".to_string());
    }
    Ok(cleaned)
}

fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max_chars).collect();
        out.push_str("...");
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ek(pattern_key: &str, success: i64, failure: i64, confidence: f64) -> ExecutionKnowledge {
        ExecutionKnowledge {
            id: format!("k-{pattern_key}"),
            persona_id: "p-1".to_string(),
            use_case_id: None,
            knowledge_type: "cost_quality".to_string(),
            pattern_key: pattern_key.to_string(),
            pattern_data: "{}".to_string(),
            success_count: success,
            failure_count: failure,
            avg_cost_usd: 0.01,
            avg_duration_ms: 1000.0,
            confidence,
            last_execution_id: None,
            created_at: "2026-04-25T00:00:00Z".to_string(),
            updated_at: "2026-04-25T00:00:00Z".to_string(),
            scope_type: "persona".to_string(),
            scope_id: None,
            annotation_text: None,
            annotation_source: None,
            is_verified: false,
        }
    }

    #[test]
    fn select_failure_patterns_filters_by_min_observations() {
        // Two failures but only 2 total observations — under the floor.
        let entries = vec![ek("rare_fail", 0, 2, 0.5)];
        let picked = select_failure_patterns(&entries);
        assert!(
            picked.is_empty(),
            "patterns under MIN_OBSERVATIONS must be ignored"
        );
    }

    #[test]
    fn select_failure_patterns_filters_success_dominant() {
        // Lots of observations but successes win — not a gradient signal.
        let entries = vec![ek("mostly_works", 8, 2, 0.9)];
        let picked = select_failure_patterns(&entries);
        assert!(
            picked.is_empty(),
            "success-dominant patterns are not gradient signal"
        );
    }

    #[test]
    fn select_failure_patterns_orders_worst_first_and_caps_count() {
        let entries: Vec<ExecutionKnowledge> = (0..(MAX_FAILURE_PATTERNS_IN_PROMPT + 4))
            .map(|i| ek(&format!("p{i}"), 1, (i as i64) + 5, 0.5))
            .collect();
        let picked = select_failure_patterns(&entries);
        assert_eq!(picked.len(), MAX_FAILURE_PATTERNS_IN_PROMPT);
        // Worst first: highest failure_count.
        let counts: Vec<i64> = picked.iter().map(|e| e.failure_count).collect();
        let mut sorted = counts.clone();
        sorted.sort_by(|a, b| b.cmp(a));
        assert_eq!(counts, sorted);
    }

    #[test]
    fn render_segments_joins_in_index_order_even_if_unsorted() {
        let segs = vec![
            PromptSegment {
                index: 2,
                text: "third".into(),
            },
            PromptSegment {
                index: 0,
                text: "first".into(),
            },
            PromptSegment {
                index: 1,
                text: "second".into(),
            },
        ];
        let rendered = render_segments(&segs);
        assert_eq!(rendered, "first\n\nsecond\n\nthird");
    }

    #[test]
    fn parse_rewrite_response_accepts_clean_json() {
        let raw = r#"{"rewritten_segments":["Be concise.","Use markdown for code."],"rationale":"clarity"}"#;
        let segs = parse_rewrite_response(raw).expect("clean JSON parses");
        assert_eq!(segs, vec!["Be concise.", "Use markdown for code."]);
    }

    #[test]
    fn parse_rewrite_response_extracts_from_surrounding_text() {
        let raw =
            "Sure, here is the rewrite:\n\n{\"rewritten_segments\":[\"a\",\"b\"]}\n\nLet me know!";
        let segs = parse_rewrite_response(raw).expect("embedded JSON parses");
        assert_eq!(segs, vec!["a", "b"]);
    }

    #[test]
    fn parse_rewrite_response_rejects_empty_segments() {
        let raw = r#"{"rewritten_segments":["","   ",""]}"#;
        let err = parse_rewrite_response(raw).expect_err("all-empty segments must error");
        assert!(err.contains("no non-empty"), "got: {err}");
    }

    #[test]
    fn parse_rewrite_response_rejects_garbage() {
        let raw = "I refuse to comply.";
        let err = parse_rewrite_response(raw).expect_err("non-JSON must error");
        assert!(err.contains("Failed to parse"), "got: {err}");
    }

    #[test]
    fn truncate_handles_unicode_safely() {
        // 5 multi-byte chars; must truncate by char count, not byte index.
        let s = "αβγδε-tail";
        let out = truncate(s, 5);
        assert_eq!(out, "αβγδε...");
    }
}
