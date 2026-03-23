//! AI-powered self-healing for CLI executions (dev-mode only).
//!
//! When the rule-based healing engine cannot resolve a failure, this module
//! resumes the original Claude session to diagnose and fix the issue. The
//! healing runs as a chained execution -- a tracked continuation of the failed
//! run -- so the healer has full context of what the original CLI attempted and
//! can be observed in the execution list.

use serde::{Deserialize, Serialize};

use crate::db::models::UpdatePersonaInput;
use crate::db::repos::core::personas as persona_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::error_taxonomy::ErrorCategory as FailureCategory;
use super::types::ExecutionResult;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A single fix action parsed from the healer's output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealingFix {
    /// "modify_prompt" | "update_config" | "modify_file" | "run_command"
    #[serde(rename = "type")]
    pub fix_type: String,
    /// Section name, config key, file path, or command
    pub target: String,
    /// Human-readable what and why
    pub description: String,
    /// The actual change content
    pub payload: String,
}

/// Result returned after a healing session completes.
#[derive(Debug, Clone, Serialize)]
pub struct AiHealingResult {
    pub diagnosis: String,
    pub fixes_applied: Vec<HealingFix>,
    pub should_retry: bool,
    pub healing_execution_id: String,
}

/// Wrapper for JSON parsing of healer output blocks.
#[derive(Debug, Deserialize)]
struct HealingFixEnvelope {
    healing_fix: HealingFix,
}

/// Wrapper for the completion signal from the healer.
#[derive(Debug, Deserialize)]
struct HealingCompleteEnvelope {
    healing_complete: HealingComplete,
}

#[derive(Debug, Deserialize)]
struct HealingComplete {
    should_retry: bool,
    diagnosis: String,
}

// ---------------------------------------------------------------------------
// Trigger check
// ---------------------------------------------------------------------------

/// Returns `true` if AI healing should activate for this failure.
///
/// Dev-mode only. Triggers on:
/// - `ExecutionState::Incomplete` (exit 0 but task not accomplished)
/// - `FailureCategory::Unknown` (rule engine can't classify)
/// - `FailureCategory::CredentialError` (AI can inspect fields)
/// - 2+ consecutive failures of any category
pub fn should_trigger_ai_healing(
    category: &FailureCategory,
    execution_state: &str,
    consecutive_failures: u32,
) -> bool {
    // Never trigger for rate limits (backoff handles it) or CLI not found
    if matches!(category, FailureCategory::RateLimit | FailureCategory::ProviderNotFound) {
        return false;
    }

    // Incomplete state -- CLI ran but couldn't complete the task
    if execution_state == "incomplete" {
        return true;
    }

    // Unknown or credential errors -- AI can diagnose
    if matches!(
        category,
        FailureCategory::Unknown | FailureCategory::CredentialError
    ) {
        return true;
    }

    // Pattern detection -- 2+ consecutive failures of any type
    if consecutive_failures >= 2 {
        return true;
    }

    false
}

// ---------------------------------------------------------------------------
// Healing input (sent as input_data to the resumed session)
// ---------------------------------------------------------------------------

/// Build the healing input data for the resumed session.
///
/// Since we resume the original Claude session, the AI already has full
/// context of what it tried to do. We only need to tell it the execution
/// failed and ask it to diagnose and fix.
pub fn build_healing_input(error: &str, category: &str) -> serde_json::Value {
    let healing_prompt = format!(
        r#"IMPORTANT: The execution you just attempted has FAILED.

## Failure Details
- Error: {error}
- Category: {category}

## Your Task (Self-Healing Mode)
1. Diagnose WHY the execution failed based on everything you just tried
2. Apply fixes using your available tools (file editing, bash)
3. For any database-level changes to the persona configuration, output structured JSON

## Database Fix Format
Output each database change on its own line:
{{"healing_fix": {{"type": "modify_prompt", "target": "instructions", "description": "why this fix", "payload": "new content"}}}}
{{"healing_fix": {{"type": "update_config", "target": "timeout_ms", "description": "why this fix", "payload": "900000"}}}}

Valid types: modify_prompt, update_config, modify_file, run_command
Valid targets for modify_prompt: system_prompt, instructions, structured_prompt, or any section name
Valid targets for update_config: timeout_ms, max_turns, enabled

## Rules
- Be surgical -- fix the minimum needed
- Explain your diagnosis before applying fixes
- End with: {{"healing_complete": {{"should_retry": true/false, "diagnosis": "one-sentence root cause"}}}}
"#,
        error = truncate_str(error, 2000),
        category = category,
    );

    serde_json::json!({
        "_healing": true,
        "_healing_prompt": healing_prompt,
    })
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/// Parse structured fix actions from the healing execution's output.
///
/// Scans the full output text for `{"healing_fix": ...}` and
/// `{"healing_complete": ...}` JSON blocks on their own lines.
pub fn parse_healing_output(output: &str) -> (Vec<HealingFix>, Option<String>, bool) {
    let mut fixes = Vec::new();
    let mut diagnosis = None;
    let mut should_retry = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Try parsing as a healing fix
        if let Ok(envelope) = serde_json::from_str::<HealingFixEnvelope>(trimmed) {
            fixes.push(envelope.healing_fix);
            continue;
        }

        // Try parsing as healing complete signal
        if let Ok(envelope) = serde_json::from_str::<HealingCompleteEnvelope>(trimmed) {
            diagnosis = Some(envelope.healing_complete.diagnosis);
            should_retry = envelope.healing_complete.should_retry;
        }
    }

    (fixes, diagnosis, should_retry)
}

/// Process the result of a healing execution: parse fixes and apply them.
pub async fn process_healing_result(
    pool: &DbPool,
    persona_id: &str,
    result: &ExecutionResult,
) -> Result<AiHealingResult, AppError> {
    let output = result.output.as_deref().unwrap_or("");
    let (fixes, diagnosis, should_retry) = parse_healing_output(output);

    let diagnosis = diagnosis
        .unwrap_or_else(|| "AI healing completed without structured diagnosis".to_string());

    // Apply DB-level fixes
    let applied_descriptions = if !fixes.is_empty() {
        apply_db_fixes(pool, persona_id, &fixes)?
    } else {
        Vec::new()
    };

    if !applied_descriptions.is_empty() {
        tracing::info!(
            persona_id = %persona_id,
            "AI healing applied {} DB fixes: {:?}",
            applied_descriptions.len(),
            applied_descriptions,
        );
    }

    Ok(AiHealingResult {
        diagnosis,
        fixes_applied: fixes,
        should_retry,
        healing_execution_id: String::new(), // filled in by caller
    })
}

// ---------------------------------------------------------------------------
// Fix application
// ---------------------------------------------------------------------------

/// Apply database-level fixes (prompt changes, config updates).
fn apply_db_fixes(
    pool: &DbPool,
    persona_id: &str,
    fixes: &[HealingFix],
) -> Result<Vec<String>, AppError> {
    let mut applied = Vec::new();

    for fix in fixes {
        match fix.fix_type.as_str() {
            "modify_prompt" => {
                match fix.target.as_str() {
                    "system_prompt" | "instructions" => {
                        let input = UpdatePersonaInput {
                            system_prompt: Some(fix.payload.clone()),
                            ..Default::default()
                        };
                        persona_repo::update(pool, persona_id, input)?;
                        applied.push(format!("Updated system_prompt: {}", fix.description));
                    }
                    "structured_prompt" => {
                        let input = UpdatePersonaInput {
                            structured_prompt: Some(Some(fix.payload.clone())),
                            ..Default::default()
                        };
                        persona_repo::update(pool, persona_id, input)?;
                        applied.push(format!("Updated structured_prompt: {}", fix.description));
                    }
                    other => {
                        // Try to patch a specific section within structured_prompt
                        if let Ok(patched) =
                            patch_structured_prompt_section(pool, persona_id, other, &fix.payload)
                        {
                            applied.push(format!("Patched section '{}': {}", other, fix.description));
                            if !patched {
                                tracing::warn!(
                                    "AI healing: section '{}' not found in structured_prompt",
                                    other
                                );
                            }
                        }
                    }
                }
            }
            "update_config" => match fix.target.as_str() {
                "timeout_ms" => {
                    if let Ok(timeout) = fix.payload.parse::<i32>() {
                        let input = UpdatePersonaInput {
                            timeout_ms: Some(timeout),
                            ..Default::default()
                        };
                        persona_repo::update(pool, persona_id, input)?;
                        applied.push(format!("Updated timeout_ms to {}: {}", timeout, fix.description));
                    }
                }
                "max_turns" => {
                    if let Ok(turns) = fix.payload.parse::<i32>() {
                        let input = UpdatePersonaInput {
                            max_turns: Some(Some(turns)),
                            ..Default::default()
                        };
                        persona_repo::update(pool, persona_id, input)?;
                        applied.push(format!("Updated max_turns to {}: {}", turns, fix.description));
                    }
                }
                "enabled" => {
                    if let Ok(enabled) = fix.payload.parse::<bool>() {
                        let input = UpdatePersonaInput {
                            enabled: Some(enabled),
                            ..Default::default()
                        };
                        persona_repo::update(pool, persona_id, input)?;
                        applied.push(format!("Set enabled={}: {}", enabled, fix.description));
                    }
                }
                other => {
                    tracing::warn!("AI healing: unknown config target '{}'", other);
                }
            },
            "modify_file" | "run_command" => {
                // File modifications and commands are handled directly by the CLI's
                // own tool use -- we just log that they were requested.
                applied.push(format!(
                    "CLI handled {}: {} ({})",
                    fix.fix_type, fix.target, fix.description
                ));
            }
            other => {
                tracing::warn!("AI healing: unknown fix type '{}'", other);
            }
        }
    }

    Ok(applied)
}

/// Patch a specific section within the structured_prompt JSON.
fn patch_structured_prompt_section(
    pool: &DbPool,
    persona_id: &str,
    section: &str,
    new_content: &str,
) -> Result<bool, AppError> {
    let persona = persona_repo::get_by_id(pool, persona_id)?;
    let sp = persona.structured_prompt.unwrap_or_default();

    if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&sp) {
        if let Some(obj) = val.as_object_mut() {
            if obj.contains_key(section) {
                obj.insert(
                    section.to_string(),
                    serde_json::Value::String(new_content.to_string()),
                );
                let updated = serde_json::to_string(&val).unwrap_or(sp);
                let input = UpdatePersonaInput {
                    structured_prompt: Some(Some(updated)),
                    ..Default::default()
                };
                persona_repo::update(pool, persona_id, input)?;
                return Ok(true);
            }
        }
    }

    Ok(false)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn truncate_str(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &s[..end]
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_trigger_incomplete() {
        assert!(should_trigger_ai_healing(
            &FailureCategory::Unknown,
            "incomplete",
            0,
        ));
    }

    #[test]
    fn test_should_trigger_unknown() {
        assert!(should_trigger_ai_healing(
            &FailureCategory::Unknown,
            "failed",
            0,
        ));
    }

    #[test]
    fn test_should_trigger_credential() {
        assert!(should_trigger_ai_healing(
            &FailureCategory::CredentialError,
            "failed",
            0,
        ));
    }

    #[test]
    fn test_should_trigger_consecutive() {
        assert!(should_trigger_ai_healing(
            &FailureCategory::Timeout,
            "failed",
            2,
        ));
    }

    #[test]
    fn test_should_not_trigger_rate_limit() {
        assert!(!should_trigger_ai_healing(
            &FailureCategory::RateLimit,
            "failed",
            0,
        ));
    }

    #[test]
    fn test_should_not_trigger_cli_not_found() {
        assert!(!should_trigger_ai_healing(
            &FailureCategory::ProviderNotFound,
            "failed",
            0,
        ));
    }

    #[test]
    fn test_should_not_trigger_single_timeout() {
        assert!(!should_trigger_ai_healing(
            &FailureCategory::Timeout,
            "failed",
            0,
        ));
    }

    #[test]
    fn test_parse_healing_output_empty() {
        let (fixes, diagnosis, should_retry) = parse_healing_output("");
        assert!(fixes.is_empty());
        assert!(diagnosis.is_none());
        assert!(!should_retry);
    }

    #[test]
    fn test_parse_healing_output_with_fix() {
        let output = r#"Some diagnosis text
{"healing_fix": {"type": "modify_prompt", "target": "instructions", "description": "Add missing context", "payload": "Updated prompt text"}}
{"healing_complete": {"should_retry": true, "diagnosis": "Missing instructions"}}
"#;
        let (fixes, diagnosis, should_retry) = parse_healing_output(output);
        assert_eq!(fixes.len(), 1);
        assert_eq!(fixes[0].fix_type, "modify_prompt");
        assert_eq!(fixes[0].target, "instructions");
        assert_eq!(diagnosis.unwrap(), "Missing instructions");
        assert!(should_retry);
    }

    #[test]
    fn test_parse_healing_output_multiple() {
        let output = r#"{"healing_fix": {"type": "modify_prompt", "target": "instructions", "description": "fix 1", "payload": "a"}}
{"healing_fix": {"type": "update_config", "target": "timeout_ms", "description": "fix 2", "payload": "900000"}}
{"healing_complete": {"should_retry": false, "diagnosis": "Two issues found"}}
"#;
        let (fixes, diagnosis, should_retry) = parse_healing_output(output);
        assert_eq!(fixes.len(), 2);
        assert_eq!(diagnosis.unwrap(), "Two issues found");
        assert!(!should_retry);
    }

    #[test]
    fn test_build_healing_input_structure() {
        let input = build_healing_input("some error", "Unknown");
        assert!(input.get("_healing").unwrap().as_bool().unwrap());
        let prompt = input.get("_healing_prompt").unwrap().as_str().unwrap();
        assert!(prompt.contains("FAILED"));
        assert!(prompt.contains("some error"));
        assert!(prompt.contains("Unknown"));
        assert!(prompt.contains("healing_fix"));
        assert!(prompt.contains("healing_complete"));
    }
}
