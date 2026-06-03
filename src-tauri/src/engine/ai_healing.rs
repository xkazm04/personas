//! AI-powered self-healing for CLI executions (dev-mode only).
//!
//! When the rule-based healing engine cannot resolve a failure, this module
//! resumes the original Claude session to diagnose and fix the issue. The
//! healing runs as a chained execution -- a tracked continuation of the failed
//! run -- so the healer has full context of what the original CLI attempted and
//! can be observed in the execution list.

use serde::{Deserialize, Serialize};

use crate::db::DbPool;
use crate::error::AppError;

use super::error_taxonomy::ErrorCategory as FailureCategory;
use super::types::ExecutionResult;

// Bounds for AI-healing config changes. Values outside these ranges are
// rejected to prevent a misdiagnosis from bricking a persona.
const TIMEOUT_MS_MIN: i32 = 1_000; // 1 second
const TIMEOUT_MS_MAX: i32 = 1_800_000; // 30 minutes
const MAX_TURNS_MIN: i32 = 1;
const MAX_TURNS_MAX: i32 = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A single fix action parsed from the healer's output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealingFix {
    /// "modify_prompt" | "update_config" | "modify_file" | "run_command"
    ///
    /// Note: a fifth `instrument_and_reproduce` variant existed historically
    /// (proposed log-point injection + re-execution) but was removed
    /// 2026-05-10 — the orchestrator never shipped, and the healer kept
    /// proposing it into a phantom audit row. The parser still accepts the
    /// variant from any healer output that emits it, but `apply_db_fixes`
    /// routes it to the `unknown fix type` warn arm. Re-introduce by
    /// re-adding a dedicated dispatch arm AND building the orchestrator. See
    /// [[Architect/decisions/2026-05-10-instrument-and-reproduce-phantom]].
    #[serde(rename = "type")]
    pub fix_type: String,
    /// Section name, config key, file path, or command.
    pub target: String,
    /// Human-readable what and why
    pub description: String,
    /// The actual change content (e.g., new prompt text, config value, file diff).
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
    if matches!(
        category,
        FailureCategory::RateLimit | FailureCategory::ProviderNotFound
    ) {
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
Valid targets for update_config: timeout_ms (1000-1800000), max_turns (1-100), enabled (true only; disabling requires human approval)

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
/// `{"healing_complete": ...}` JSON blocks. The blocks do **not** have to sit
/// on a single line: LLM healers routinely pretty-print the JSON across several
/// lines or wrap it in Markdown code fences. Earlier this function parsed each
/// trimmed line independently with `serde_json::from_str`, so any multi-line or
/// fenced block failed on every line and *every proposed fix was silently
/// dropped* while the run still reported "completed" — success theater. We now
/// pull balanced `{...}` objects out of the raw text (brace-balanced,
/// string-aware) so the layout no longer matters. See [[idea-2561d623]].
pub fn parse_healing_output(output: &str) -> (Vec<HealingFix>, Option<String>, bool) {
    let mut fixes = Vec::new();
    let mut diagnosis = None;
    let mut should_retry = false;

    for candidate in extract_json_objects(output) {
        // Try parsing as a healing fix
        if let Ok(envelope) = serde_json::from_str::<HealingFixEnvelope>(candidate) {
            fixes.push(envelope.healing_fix);
            continue;
        }

        // Try parsing as healing complete signal
        if let Ok(envelope) = serde_json::from_str::<HealingCompleteEnvelope>(candidate) {
            diagnosis = Some(envelope.healing_complete.diagnosis);
            should_retry = envelope.healing_complete.should_retry;
        }
    }

    (fixes, diagnosis, should_retry)
}

/// Extract balanced top-level `{...}` JSON objects from arbitrary text.
///
/// Walks the text tracking brace depth so a `{ ... }` block that spans multiple
/// lines (pretty-printed) or sits inside ```` ```json ```` code fences is
/// captured whole — fence backticks and prose outside of braces are simply not
/// `{`, so they are ignored. Once inside an object the scan is string- and
/// escape-aware, so braces or quotes embedded in a payload string (e.g. a file
/// diff or a JSON-encoded `payload`) never prematurely close the object. Each
/// returned slice is a balanced candidate the caller can attempt to deserialize.
fn extract_json_objects(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut objects = Vec::new();
    let mut depth: u32 = 0;
    let mut start: Option<usize> = None;
    let mut in_string = false;
    let mut escaped = false;

    for (i, &c) in bytes.iter().enumerate() {
        if depth == 0 {
            // Outside any object: only an opening brace is meaningful.
            if c == b'{' {
                start = Some(i);
                depth = 1;
            }
            continue;
        }

        // Inside an object: respect string literals and escape sequences.
        if in_string {
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == b'"' {
                in_string = false;
            }
            continue;
        }

        match c {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(s) = start.take() {
                        // `{` and `}` are ASCII, so `s` and `i` always land on
                        // char boundaries even within multi-byte UTF-8 text.
                        objects.push(&text[s..=i]);
                    }
                }
            }
            _ => {}
        }
    }

    objects
}

/// Returns `true` when the healer output referenced a `healing_fix` block but
/// the parser recovered zero structured fixes — the silent-drop failure mode.
///
/// When the robust extractor above still fails (genuinely malformed JSON,
/// truncated output, single-quoted keys, …) the run would otherwise report
/// "completed" with no fixes, leaving the user to believe the persona was
/// repaired. Callers use this to emit a `healing_audit_log` entry so the drop
/// is visible instead of invisible.
fn fix_text_was_dropped(output: &str, parsed_fix_count: usize) -> bool {
    parsed_fix_count == 0 && output.contains("healing_fix")
}

/// Process the result of a healing execution: parse fixes and apply them.
pub async fn process_healing_result(
    pool: &DbPool,
    persona_id: &str,
    result: &ExecutionResult,
) -> Result<AiHealingResult, AppError> {
    let output = result.output.as_deref().unwrap_or("");
    let (fixes, diagnosis, should_retry) = parse_healing_output(output);

    // Surface the silent-drop failure mode: the healer emitted `healing_fix`
    // text the parser still could not recover. Without this audit entry the run
    // reports "completed" with zero fixes and the user believes the persona was
    // repaired when every proposed fix was discarded. See [[idea-2561d623]].
    if fix_text_was_dropped(output, fixes.len()) {
        tracing::warn!(
            persona_id = %persona_id,
            "AI healing: output referenced healing_fix but no structured fix parsed -- fixes dropped",
        );
        crate::db::repos::execution::healing::create_audit_entry(
            pool,
            Some(persona_id),
            None,
            "ai_heal_parse_failed",
            "ai_healing",
            "Healer output referenced healing_fix but no structured fix could be parsed",
            Some(&truncate_str(output, 2000)),
        );
    }

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

/// Apply database-level fixes (prompt changes, config updates) atomically
/// within a single SQLite transaction. Either all DB fixes succeed or none
/// are persisted, preventing partially-healed persona state.
fn apply_db_fixes(
    pool: &DbPool,
    persona_id: &str,
    fixes: &[HealingFix],
) -> Result<Vec<String>, AppError> {
    use rusqlite::params;

    let mut applied = Vec::new();
    let now = chrono::Utc::now().to_rfc3339();

    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    // Write audit entries into the active transaction so they commit/rollback
    // atomically with the fixes they describe.
    let tx_audit = |tx: &rusqlite::Transaction<'_>,
                    event_type: &str,
                    message: &str,
                    detail: Option<&str>| {
        let id = uuid::Uuid::new_v4().to_string();
        let ts = chrono::Utc::now().to_rfc3339();
        let _ = tx.execute(
            "INSERT INTO healing_audit_log (id, persona_id, execution_id, event_type, subsystem, message, detail, created_at)
             VALUES (?1, ?2, NULL, ?3, 'ai_healing', ?4, ?5, ?6)",
            params![id, persona_id, event_type, message, detail, ts],
        );
    };

    for fix in fixes {
        match fix.fix_type.as_str() {
            "modify_prompt" => {
                match fix.target.as_str() {
                    "system_prompt" | "instructions" => {
                        tx.execute(
                            "UPDATE personas SET system_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                            params![fix.payload, now, persona_id],
                        )
                        .map_err(AppError::Database)?;
                        applied.push(format!("Updated system_prompt: {}", fix.description));
                    }
                    "structured_prompt" => {
                        tx.execute(
                            "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                            params![fix.payload, now, persona_id],
                        ).map_err(AppError::Database)?;
                        applied.push(format!("Updated structured_prompt: {}", fix.description));
                    }
                    other => {
                        // Try to patch a specific section within structured_prompt
                        let sp: Option<String> = tx
                            .query_row(
                                "SELECT structured_prompt FROM personas WHERE id = ?1",
                                params![persona_id],
                                |row| row.get(0),
                            )
                            .map_err(AppError::Database)?;

                        let sp = sp.unwrap_or_default();
                        if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&sp) {
                            if let Some(obj) = val.as_object_mut() {
                                if obj.contains_key(other) {
                                    obj.insert(
                                        other.to_string(),
                                        serde_json::Value::String(fix.payload.clone()),
                                    );
                                    let updated = serde_json::to_string(&val).unwrap_or(sp);
                                    tx.execute(
                                        "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                                        params![updated, now, persona_id],
                                    ).map_err(AppError::Database)?;
                                    applied.push(format!(
                                        "Patched section '{}': {}",
                                        other, fix.description
                                    ));
                                } else {
                                    tracing::warn!(
                                        "AI healing: section '{}' not found in structured_prompt",
                                        other
                                    );
                                    tx_audit(
                                        &tx,
                                        "ai_heal_section_missing",
                                        &format!(
                                            "Section '{}' not found in structured_prompt",
                                            other
                                        ),
                                        Some(&fix.description),
                                    );
                                }
                            } else {
                                tracing::error!(
                                    "AI healing: structured_prompt is valid JSON but not an object, cannot patch section '{}'",
                                    other
                                );
                                tx_audit(&tx, "ai_heal_not_object",
                                    &format!(
                                        "structured_prompt is not a JSON object, cannot patch section '{}'",
                                        other
                                    ),
                                    Some(&fix.description));
                            }
                        } else {
                            tracing::error!(
                                "AI healing: structured_prompt is not valid JSON, cannot patch section '{}'",
                                other
                            );
                            tx_audit(&tx, "ai_heal_invalid_json",
                                &format!(
                                    "structured_prompt is not valid JSON, cannot patch section '{}'",
                                    other
                                ),
                                Some(&fix.description));
                        }
                    }
                }
            }
            "update_config" => {
                match fix.target.as_str() {
                    "timeout_ms" => {
                        if let Ok(timeout) = fix.payload.parse::<i32>() {
                            if !(TIMEOUT_MS_MIN..=TIMEOUT_MS_MAX).contains(&timeout) {
                                tracing::warn!(
                                    "AI healing: timeout_ms {} out of bounds [{}, {}], rejecting",
                                    timeout,
                                    TIMEOUT_MS_MIN,
                                    TIMEOUT_MS_MAX,
                                );
                                tx_audit(
                                    &tx,
                                    "ai_heal_value_rejected",
                                    &format!(
                                        "Rejected timeout_ms={} (must be {}-{})",
                                        timeout, TIMEOUT_MS_MIN, TIMEOUT_MS_MAX,
                                    ),
                                    Some(&fix.description),
                                );
                            } else {
                                tx.execute(
                                "UPDATE personas SET timeout_ms = ?1, updated_at = ?2 WHERE id = ?3",
                                params![timeout, now, persona_id],
                            ).map_err(AppError::Database)?;
                                applied.push(format!(
                                    "Updated timeout_ms to {}: {}",
                                    timeout, fix.description
                                ));
                            }
                        }
                    }
                    "max_turns" => {
                        if let Ok(turns) = fix.payload.parse::<i32>() {
                            if !(MAX_TURNS_MIN..=MAX_TURNS_MAX).contains(&turns) {
                                tracing::warn!(
                                    "AI healing: max_turns {} out of bounds [{}, {}], rejecting",
                                    turns,
                                    MAX_TURNS_MIN,
                                    MAX_TURNS_MAX,
                                );
                                tx_audit(
                                    &tx,
                                    "ai_heal_value_rejected",
                                    &format!(
                                        "Rejected max_turns={} (must be {}-{})",
                                        turns, MAX_TURNS_MIN, MAX_TURNS_MAX,
                                    ),
                                    Some(&fix.description),
                                );
                            } else {
                                tx.execute(
                                "UPDATE personas SET max_turns = ?1, updated_at = ?2 WHERE id = ?3",
                                params![turns, now, persona_id],
                            ).map_err(AppError::Database)?;
                                applied.push(format!(
                                    "Updated max_turns to {}: {}",
                                    turns, fix.description
                                ));
                            }
                        }
                    }
                    "enabled" => {
                        // AI healing must never disable a persona -- that requires human approval.
                        // Only allow setting enabled=true (re-enabling).
                        if let Ok(enabled) = fix.payload.parse::<bool>() {
                            if !enabled {
                                tracing::warn!(
                                    "AI healing: blocked attempt to disable persona {}",
                                    persona_id,
                                );
                                tx_audit(&tx, "ai_heal_disable_blocked",
                                "Blocked AI healing from setting enabled=false (requires human approval)",
                                Some(&fix.description));
                            } else {
                                let enabled_int = 1;
                                tx.execute(
                                "UPDATE personas SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
                                params![enabled_int, now, persona_id],
                            ).map_err(AppError::Database)?;
                                applied.push(format!("Set enabled=true: {}", fix.description));
                            }
                        }
                    }
                    other => {
                        tracing::warn!("AI healing: unknown config target '{}'", other);
                        tx_audit(
                            &tx,
                            "ai_heal_unknown_target",
                            &format!("Unknown config target '{}'", other),
                            Some(&fix.description),
                        );
                    }
                }
            }
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
                tx_audit(
                    &tx,
                    "ai_heal_unknown_fix_type",
                    &format!("Unknown fix type '{}'", other),
                    Some(&fix.description),
                );
            }
        }
    }

    // Log applied fixes as a healing issue for audit trail
    if !applied.is_empty() {
        let log_id = uuid::Uuid::new_v4().to_string();
        let description = applied.join("\n");
        tx.execute(
            "INSERT OR IGNORE INTO persona_healing_issues \
             (id, persona_id, execution_id, title, description, is_circuit_breaker, severity, category, suggested_fix, auto_fixed, status, created_at) \
             VALUES (?1, ?2, NULL, ?3, ?4, 0, 'info', 'auto_heal', NULL, 1, 'resolved', ?5)",
            params![
                log_id,
                persona_id,
                format!("AI healing applied {} fixes", applied.len()),
                description,
                now,
            ],
        ).map_err(AppError::Database)?;
    }

    tx.commit().map_err(AppError::Database)?;

    Ok(applied)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

use super::str_utils::truncate_str;

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

    #[test]
    fn test_healing_prompt_documents_bounds() {
        let input = build_healing_input("err", "Unknown");
        let prompt = input.get("_healing_prompt").unwrap().as_str().unwrap();
        assert!(
            prompt.contains("1000-1800000"),
            "prompt should document timeout_ms bounds"
        );
        assert!(
            prompt.contains("1-100"),
            "prompt should document max_turns bounds"
        );
        assert!(
            prompt.contains("true only"),
            "prompt should note enabled=true only"
        );
    }

    #[test]
    fn test_config_bounds_constants() {
        assert_eq!(TIMEOUT_MS_MIN, 1_000);
        assert_eq!(TIMEOUT_MS_MAX, 1_800_000);
        assert_eq!(MAX_TURNS_MIN, 1);
        assert_eq!(MAX_TURNS_MAX, 100);
        assert!(TIMEOUT_MS_MIN > 0, "timeout lower bound must be positive");
        assert!(MAX_TURNS_MIN > 0, "max_turns lower bound must be positive");
    }

    #[test]
    fn test_healing_prompt_omits_instrument_and_reproduce() {
        // The variant was removed 2026-05-10 (architect ADR
        // 2026-05-10-instrument-and-reproduce-phantom). Healer prompt no
        // longer mentions it; parser still accepts it from legacy healer
        // output but apply_db_fixes routes it to the unknown-fix-type
        // warn arm.
        let input = build_healing_input("generic error", "Unknown");
        let prompt = input.get("_healing_prompt").unwrap().as_str().unwrap();
        assert!(
            !prompt.contains("instrument_and_reproduce"),
            "prompt must not advertise the removed fix type"
        );
        assert!(
            !prompt.contains("Reproduce-and-verify"),
            "prompt must not advertise the removed pattern"
        );
        // The four remaining valid types are still documented:
        assert!(prompt.contains("modify_prompt"));
        assert!(prompt.contains("update_config"));
        assert!(prompt.contains("modify_file"));
        assert!(prompt.contains("run_command"));
    }

    #[test]
    fn test_parse_healing_output_with_legacy_instrument_and_reproduce() {
        // Defensive: a healer instance running an older prompt or any
        // upstream tool that emits the legacy variant should still
        // produce a parsed fix (the parser is shape-agnostic on
        // fix_type), but apply_db_fixes will route it to the
        // unknown-fix-type warn arm. This test pins the parsing behavior
        // so we don't accidentally tighten the parser and crash on
        // legacy healer output.
        let output = r#"Diagnosis: not enough evidence yet.
{"healing_fix": {"type": "instrument_and_reproduce", "target": "src/foo.rs", "description": "trace value of x and len of items", "payload": "[{\"line\": 42, \"expr\": \"value of x\"}, {\"line\": 88, \"expr\": \"len(items)\"}]"}}
{"healing_complete": {"should_retry": true, "diagnosis": "needs runtime evidence -- proposed instrumentation"}}
"#;
        let (fixes, diagnosis, should_retry) = parse_healing_output(output);
        assert_eq!(fixes.len(), 1, "should still parse legacy variant");
        assert_eq!(fixes[0].fix_type, "instrument_and_reproduce");
        assert_eq!(fixes[0].target, "src/foo.rs");
        assert!(
            fixes[0].payload.contains("\"line\": 42"),
            "payload must preserve the log-point JSON"
        );
        assert!(should_retry);
        assert!(diagnosis.unwrap().contains("runtime evidence"));
    }

    #[test]
    fn test_parse_instrument_payload_log_point_count() {
        // Verify the payload shape the dispatch arm uses to count log points.
        // This test pins the contract between the healer prompt format and the
        // counting logic in apply_db_fixes -- if the healer ever changes the
        // payload shape, this test fails first.
        let payload = r#"[{"line": 42, "expr": "value of x"}, {"line": 88, "expr": "len(items)"}, {"line": 120, "expr": "is_dirty"}]"#;
        let parsed: serde_json::Value = serde_json::from_str(payload).unwrap();
        let count = parsed.as_array().map(|a| a.len()).unwrap_or(0);
        assert_eq!(
            count, 3,
            "instrument payload must be a JSON array of log points"
        );
    }

    #[test]
    fn test_parse_healing_output_pretty_printed() {
        // Real LLM output: the fix JSON is pretty-printed across many lines.
        // The old per-line parser dropped every fix here.
        let output = r#"Here is my diagnosis and the fix:

{
  "healing_fix": {
    "type": "modify_prompt",
    "target": "instructions",
    "description": "Add missing tool guidance",
    "payload": "Always read the file before editing."
  }
}

{
  "healing_complete": {
    "should_retry": true,
    "diagnosis": "Instructions omitted the read-before-edit rule"
  }
}
"#;
        let (fixes, diagnosis, should_retry) = parse_healing_output(output);
        assert_eq!(fixes.len(), 1, "pretty-printed fix must be parsed");
        assert_eq!(fixes[0].fix_type, "modify_prompt");
        assert_eq!(fixes[0].target, "instructions");
        assert_eq!(fixes[0].payload, "Always read the file before editing.");
        assert_eq!(
            diagnosis.unwrap(),
            "Instructions omitted the read-before-edit rule"
        );
        assert!(should_retry);
    }

    #[test]
    fn test_parse_healing_output_code_fenced() {
        // LLMs frequently wrap structured output in Markdown code fences.
        let output = "I will fix the timeout.\n\n```json\n{\"healing_fix\": {\"type\": \"update_config\", \"target\": \"timeout_ms\", \"description\": \"bump timeout\", \"payload\": \"900000\"}}\n```\n\n```json\n{\"healing_complete\": {\"should_retry\": false, \"diagnosis\": \"timeout too low\"}}\n```\n";
        let (fixes, diagnosis, should_retry) = parse_healing_output(output);
        assert_eq!(fixes.len(), 1, "fenced fix must be parsed");
        assert_eq!(fixes[0].fix_type, "update_config");
        assert_eq!(fixes[0].target, "timeout_ms");
        assert_eq!(fixes[0].payload, "900000");
        assert_eq!(diagnosis.unwrap(), "timeout too low");
        assert!(!should_retry);
    }

    #[test]
    fn test_parse_healing_output_fenced_and_pretty_printed() {
        // The hostile combination: fenced AND pretty-printed across lines.
        let output = "```json\n{\n  \"healing_fix\": {\n    \"type\": \"update_config\",\n    \"target\": \"max_turns\",\n    \"description\": \"more turns\",\n    \"payload\": \"50\"\n  }\n}\n```\n";
        let (fixes, _diagnosis, _should_retry) = parse_healing_output(output);
        assert_eq!(fixes.len(), 1, "fenced + pretty-printed fix must be parsed");
        assert_eq!(fixes[0].target, "max_turns");
        assert_eq!(fixes[0].payload, "50");
    }

    #[test]
    fn test_parse_healing_output_payload_with_braces_and_quotes() {
        // A payload string containing braces and escaped quotes must not
        // confuse the brace-balanced extractor.
        let output = r#"{
  "healing_fix": {
    "type": "modify_file",
    "target": "src/config.json",
    "description": "rewrite config object",
    "payload": "{\"retries\": 3, \"label\": \"a }nasty{ value\"}"
  }
}"#;
        let (fixes, _diagnosis, _should_retry) = parse_healing_output(output);
        assert_eq!(fixes.len(), 1, "payload braces must not truncate the object");
        assert_eq!(fixes[0].target, "src/config.json");
        assert!(
            fixes[0].payload.contains("\"retries\": 3"),
            "payload JSON must survive intact: {}",
            fixes[0].payload
        );
        assert!(fixes[0].payload.contains("a }nasty{ value"));
    }

    #[test]
    fn test_parse_healing_output_multiple_pretty_printed() {
        // Two pretty-printed fixes followed by a completion signal.
        let output = r#"{
  "healing_fix": { "type": "modify_prompt", "target": "instructions", "description": "fix 1", "payload": "a" }
}
{
  "healing_fix": { "type": "update_config", "target": "timeout_ms", "description": "fix 2", "payload": "900000" }
}
{ "healing_complete": { "should_retry": false, "diagnosis": "Two issues found" } }
"#;
        let (fixes, diagnosis, should_retry) = parse_healing_output(output);
        assert_eq!(fixes.len(), 2);
        assert_eq!(fixes[0].fix_type, "modify_prompt");
        assert_eq!(fixes[1].fix_type, "update_config");
        assert_eq!(diagnosis.unwrap(), "Two issues found");
        assert!(!should_retry);
    }

    #[test]
    fn test_extract_json_objects_ignores_unbalanced_and_prose() {
        let text = "prose with a stray } brace\n{\"a\": 1}\nmore prose {not closed";
        let objs = extract_json_objects(text);
        assert_eq!(objs.len(), 1, "only the one balanced object is captured");
        assert_eq!(objs[0], "{\"a\": 1}");
    }

    #[test]
    fn test_fix_text_was_dropped_detects_unparsed_fix() {
        // Truncated / malformed fix JSON that even the robust extractor can't
        // recover: the word is present but zero fixes parsed.
        let truncated = "{\"healing_fix\": {\"type\": \"modify_prompt\", \"target\": \"instru";
        let (fixes, _d, _r) = parse_healing_output(truncated);
        assert!(fixes.is_empty(), "truncated fix must not parse");
        assert!(
            fix_text_was_dropped(truncated, fixes.len()),
            "a referenced-but-unparsed fix must be flagged as dropped"
        );
    }

    #[test]
    fn test_fix_text_was_dropped_quiet_when_parsed() {
        let output = r#"{"healing_fix": {"type": "modify_prompt", "target": "instructions", "description": "x", "payload": "y"}}"#;
        let (fixes, _d, _r) = parse_healing_output(output);
        assert_eq!(fixes.len(), 1);
        assert!(
            !fix_text_was_dropped(output, fixes.len()),
            "a successfully parsed fix must not be flagged as dropped"
        );
    }

    #[test]
    fn test_fix_text_was_dropped_quiet_when_no_fix_mentioned() {
        let output = "AI healing ran but found nothing actionable.";
        assert!(
            !fix_text_was_dropped(output, 0),
            "output without any healing_fix text must not be flagged"
        );
    }
}
