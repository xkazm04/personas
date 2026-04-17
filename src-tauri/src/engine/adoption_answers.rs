//! Adoption answer pipeline — applies questionnaire answers to AgentIr.
//!
//! Three operations:
//!   1. `substitute_variables` — replaces `{{param.KEY}}` placeholders in all
//!      string fields of the AgentIr with the user's actual answer values.
//!   2. `inject_configuration_section` — appends a human-readable
//!      `## User Configuration` block to the system prompt so the LLM knows
//!      what the user configured at adoption time.
//!   3. `extract_credential_bindings` — returns the connector→service_type map
//!      for explicit credential preference at runtime.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::db::models::agent_ir::AgentIr;

// ============================================================================
// Types
// ============================================================================

/// Adoption answers payload persisted in `build_sessions.adoption_answers`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdoptionAnswers {
    /// question_id → answer_value
    pub answers: HashMap<String, String>,
    /// Question metadata needed to interpret answers.
    #[serde(default)]
    pub questions: Vec<AdoptionQuestionMeta>,
    /// connector_name → credential_service_type (derived from vault-category questions).
    #[serde(default)]
    pub credential_bindings: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdoptionQuestionMeta {
    pub id: String,
    pub question: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub option_service_types: Option<Vec<Option<String>>>,
    #[serde(default)]
    pub vault_category: Option<String>,
}

// ============================================================================
// 1. Variable substitution
// ============================================================================

/// Replace `{{param.KEY}}` placeholders throughout the entire `AgentIr`.
///
/// Walks all string values in the serialized JSON tree. If a placeholder's KEY
/// has no matching answer, the placeholder is left as-is (degraded but not
/// broken) and a warning is logged.
pub fn substitute_variables(ir: &mut AgentIr, answers: &AdoptionAnswers) {
    if answers.answers.is_empty() {
        return;
    }

    // Build substitution map: param key → value.
    // Keys are the question IDs (e.g. "aq_config_1").
    let subs: HashMap<String, &str> = answers
        .answers
        .iter()
        .map(|(k, v)| (k.clone(), v.as_str()))
        .collect();

    // Round-trip through serde_json::Value so we can walk all strings.
    let Ok(mut val) = serde_json::to_value(&*ir) else {
        return;
    };
    walk_and_substitute(&mut val, &subs);
    if let Ok(patched) = serde_json::from_value::<AgentIr>(val) {
        *ir = patched;
    }
}

fn walk_and_substitute(val: &mut serde_json::Value, subs: &HashMap<String, &str>) {
    match val {
        serde_json::Value::String(s) => {
            if s.contains("{{param.") {
                let mut result = s.clone();
                for (key, replacement) in subs {
                    let placeholder = format!("{{{{param.{key}}}}}");
                    if result.contains(&placeholder) {
                        result = result.replace(&placeholder, replacement);
                    }
                }
                // Log any remaining unresolved placeholders.
                if result.contains("{{param.") {
                    tracing::warn!(
                        remaining = %result.matches("{{param.").count(),
                        "Unresolved {{{{param.X}}}} placeholders after substitution"
                    );
                }
                *s = result;
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                walk_and_substitute(item, subs);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                walk_and_substitute(v, subs);
            }
        }
        _ => {}
    }
}

// ============================================================================
// 2. Configuration section injection
// ============================================================================

/// Append a `## User Configuration` section to the system prompt listing all
/// Q→A pairs. Also injects into `structured_prompt.configuration` if the
/// structured prompt exists.
pub fn inject_configuration_section(ir: &mut AgentIr, answers: &AdoptionAnswers) {
    if answers.answers.is_empty() || answers.questions.is_empty() {
        return;
    }

    // Build ordered lines from the question metadata (preserves template order).
    let mut lines: Vec<String> = Vec::new();
    for q in &answers.questions {
        if let Some(answer) = answers.answers.get(&q.id) {
            if !answer.is_empty() {
                lines.push(format!("- **{}**: {}", q.question, answer));
            }
        }
    }

    if lines.is_empty() {
        return;
    }

    let section = format!(
        "\n\n## User Configuration (applied during adoption)\n\n{}",
        lines.join("\n")
    );

    // Append to system_prompt.
    if let Some(ref mut prompt) = ir.system_prompt {
        prompt.push_str(&section);
    } else {
        ir.system_prompt = Some(section.clone());
    }

    // Also inject into structured_prompt if it exists (as a "configuration" key).
    if let Some(ref mut sp) = ir.structured_prompt {
        if let Some(obj) = sp.as_object_mut() {
            obj.insert(
                "configuration".to_string(),
                serde_json::Value::String(lines.join("\n")),
            );
        }
    }
}

// ============================================================================
// 3. Credential bindings
// ============================================================================

/// Extract the connector→service_type map from adoption answers.
/// Used by credential resolution to prefer user-selected credentials.
pub fn extract_credential_bindings(answers: &AdoptionAnswers) -> HashMap<String, String> {
    answers.credential_bindings.clone()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ir(prompt: &str) -> AgentIr {
        AgentIr {
            system_prompt: Some(prompt.to_string()),
            ..Default::default()
        }
    }

    fn make_answers(pairs: &[(&str, &str)], questions: &[(&str, &str)]) -> AdoptionAnswers {
        AdoptionAnswers {
            answers: pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            questions: questions
                .iter()
                .map(|(id, q)| AdoptionQuestionMeta {
                    id: id.to_string(),
                    question: q.to_string(),
                    category: None,
                    option_service_types: None,
                    vault_category: None,
                })
                .collect(),
            credential_bindings: HashMap::new(),
        }
    }

    #[test]
    fn substitute_replaces_params() {
        let mut ir = make_ir("Monitor {{param.aq_ticker}} weekly with threshold {{param.aq_threshold}}.");
        let answers = make_answers(
            &[("aq_ticker", "NVDA,AAPL"), ("aq_threshold", "500")],
            &[],
        );
        substitute_variables(&mut ir, &answers);
        assert_eq!(
            ir.system_prompt.unwrap(),
            "Monitor NVDA,AAPL weekly with threshold 500."
        );
    }

    #[test]
    fn substitute_leaves_unresolved_params() {
        let mut ir = make_ir("Watch {{param.aq_ticker}} with {{param.aq_missing}}.");
        let answers = make_answers(&[("aq_ticker", "TSLA")], &[]);
        substitute_variables(&mut ir, &answers);
        assert_eq!(
            ir.system_prompt.unwrap(),
            "Watch TSLA with {{param.aq_missing}}."
        );
    }

    #[test]
    fn inject_config_appends_section() {
        let mut ir = make_ir("You are an analyst.");
        let answers = make_answers(
            &[("aq_ticker", "NVDA"), ("aq_style", "Deep dive")],
            &[
                ("aq_ticker", "Which tickers to track?"),
                ("aq_style", "Report detail level?"),
            ],
        );
        inject_configuration_section(&mut ir, &answers);
        let prompt = ir.system_prompt.unwrap();
        assert!(prompt.contains("## User Configuration"));
        assert!(prompt.contains("- **Which tickers to track?**: NVDA"));
        assert!(prompt.contains("- **Report detail level?**: Deep dive"));
    }

    #[test]
    fn empty_answers_noop() {
        let mut ir = make_ir("Original prompt.");
        let answers = make_answers(&[], &[]);
        substitute_variables(&mut ir, &answers);
        inject_configuration_section(&mut ir, &answers);
        assert_eq!(ir.system_prompt.unwrap(), "Original prompt.");
    }
}
