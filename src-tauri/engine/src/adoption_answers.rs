//! Adoption answer pipeline — applies questionnaire answers to AgentIr.
//!
//! Four operations:
//!   1. `substitute_variables` — replaces `{{param.KEY}}` placeholders in all
//!      string fields of the AgentIr with the user's actual answer values.
//!   2. `inject_configuration_section` — appends a human-readable
//!      `## User Configuration` block to the system prompt so the LLM knows
//!      what the user configured at adoption time.
//!   3. `extract_credential_bindings` — returns the connector→service_type map
//!      for explicit credential preference at runtime.
//!   4. `validate_answers` — the server-side gate. Everything above assumes
//!      the answers it is handed are complete and in range; until this existed
//!      that assumption was enforced only by the browser.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use personas_db::models::agent_ir::AgentIr;

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
#[allow(dead_code)] // pending: credential resolution path doesn't consult adoption answers yet
pub fn extract_credential_bindings(answers: &AdoptionAnswers) -> HashMap<String, String> {
    answers.credential_bindings.clone()
}

/// Apply the user's questionnaire credential picks to the AgentIr's
/// `required_connectors` list.
///
/// Templates often ship a generic `required_connectors` entry like
/// `{"name": "image_ai"}` that's a semantic placeholder — the actual
/// connector in the vault is named `leonardo_ai` or `openai` or similar.
/// When the user answers the corresponding vault-category question, the
/// frontend records the concrete service_type in
/// `answers.credential_bindings` (e.g. `"ai" -> "leonardo_ai"`).
///
/// This function rewrites generic entries to their concrete picks. It does
/// NOT add new connectors — it only replaces placeholders. The match is
/// keyed by the connector name matching the vault category (most templates
/// use the category itself, e.g. `name: "ai"`, as the placeholder name).
///
/// Effect:
/// - The matrix Apps & Services dimension renders the concrete service.
/// - `prepare_tool_actions` sets `requires_credential_type` to the real
///   service_type so runtime credential resolution finds the right one.
pub fn apply_credential_bindings_to_connectors(ir: &mut AgentIr, answers: &AdoptionAnswers) {
    use personas_db::models::agent_ir::{AgentIrConnector, AgentIrConnectorData};

    if answers.credential_bindings.is_empty() {
        return;
    }

    for conn in ir.required_connectors.iter_mut() {
        let current_name = conn.name().unwrap_or("").to_string();
        // Look up by exact match on connector name. Templates may use either
        // the vault category (`ai`) or a semantic placeholder (`image_ai`).
        let bound = answers
            .credential_bindings
            .get(&current_name)
            .cloned()
            // Fallback: some templates use aq_id-style names. Future work.
            .or_else(|| None);
        if let Some(service_type) = bound {
            *conn = AgentIrConnector::Structured(AgentIrConnectorData {
                name: Some(service_type.clone()),
                service_type: Some(service_type),
                has_credential: Some(true),
            });
        }
    }
}

// ============================================================================
// 4. Server-side validation of submitted answers
// ============================================================================
//
// The questionnaire's required-field enforcement used to live entirely in the
// browser (`canSubmit = allAnswered && blockedCount === 0`). Every non-UI
// caller of the pipeline above — the management API, the test-automation
// harness, the one-shot orchestrator, build simulate — could therefore hand it
// an under-configured answer set and produce a persona that looks adopted and
// fails at run time.
//
// The template's declared question schema IS reachable server-side: an
// adoption session's `build_sessions.agent_ir` holds the design payload
// round-tripped as a raw JSON value (not through the typed `AgentIr`), so
// `adoption_questions[]` survives verbatim. That, not the client-supplied
// `questions[]` echo inside the answers payload, is what this validates
// against.
//
// Validate on WRITE only. Existing half-configured rows must keep loading —
// the read paths above are untouched.

/// Dimensions whose gating the server genuinely cannot adjudicate.
///
/// The adoption UI drops a question from its "must answer" set for three
/// reasons. Two are recoverable server-side: `optional: true` is on the
/// template, and a per-capability disabled dimension is persisted on
/// `build_sessions.disabled_dims_json`. The third is not: `isQuestionDimOff`
/// (useAdoptionDimensionModel.tsx) silences `memory` / `review` questions
/// based on a dim policy that lives only in component state. Requiring those
/// server-side would reject saves the UI legitimately produced, so they are
/// exempt from the REQUIRED check — 71 of 817 catalogued template questions,
/// ~8.7%. They are still range-checked like everything else: an out-of-range
/// value is wrong no matter which gate let the question through.
const DIMENSIONS_GATED_CLIENT_SIDE: &[&str] = &["memory", "review"];

/// One question as the TEMPLATE declares it, read from the design payload on
/// `build_sessions.agent_ir`. Deliberately lenient: every field but `id` is
/// optional so a template that omits `type` (104 of 817 in the catalogue) or
/// predates a field still parses instead of silently dropping the question.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct DeclaredQuestion {
    pub id: String,
    #[serde(default)]
    pub question: String,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    /// The value the questionnaire pre-fills. Held as a raw `Value` on
    /// purpose: 507 catalogued questions declare a string default but 12
    /// declare a bool, int or list, and a typed `Option<String>` would fail
    /// to deserialize those questions and silently drop them from the schema.
    #[serde(default, rename = "default")]
    pub default_value: Option<serde_json::Value>,
    /// Template-declared "never gates the build".
    #[serde(default)]
    pub optional: bool,
    /// The user may type a value outside `options` — no range check.
    #[serde(default)]
    pub allow_custom: bool,
    /// Options are fetched from a connector at render time, so the static
    /// `options` list (usually absent) is not the allowed set.
    #[serde(default)]
    pub dynamic_source: Option<serde_json::Value>,
    #[serde(default)]
    pub dimension: Option<String>,
    #[serde(default)]
    pub use_case_id: Option<String>,
    #[serde(default)]
    pub use_case_ids: Option<Vec<String>>,
}

impl DeclaredQuestion {
    /// Every capability id this question is tied to. Empty = persona- or
    /// connector-scoped, which the UI always shows.
    fn capability_ids(&self) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        if let Some(id) = self.use_case_id.as_deref() {
            if !id.is_empty() {
                out.push(id);
            }
        }
        if let Some(ids) = &self.use_case_ids {
            for id in ids {
                if !id.is_empty() && !out.contains(&id.as_str()) {
                    out.push(id.as_str());
                }
            }
        }
        out
    }

    /// The values the template says are acceptable, or `None` when the
    /// question is not a closed enum (free text, booleans, multi-select,
    /// custom-allowed pickers, connector-fed dynamic lists).
    ///
    /// The declared `default` is always in range, even when it is not in
    /// `options`. That is not defensive hand-waving — 10 of the 351 closed
    /// `select` questions in the shipped catalogue drifted exactly that way
    /// (a de-branding pass rewrote `default` from "…send a Slack alert…" to
    /// "…send a messaging alert…" without rewriting `options`). The adoption
    /// UI pre-fills `default` into the answer map
    /// (`ChronologyAdoptionView.tsx`), so a user who simply accepts the
    /// pre-filled value submits it. Rejecting the template's own default
    /// would break those adoptions to punish a template-authoring bug. The
    /// check still catches the case it exists for: a value nobody declared.
    fn closed_option_set(&self) -> Option<Vec<&str>> {
        if self.allow_custom || self.dynamic_source.is_some() {
            return None;
        }
        if self.kind.as_deref() != Some("select") {
            return None;
        }
        let options = self.options.as_deref()?;
        if options.is_empty() {
            return None;
        }
        let mut allowed: Vec<&str> = options.iter().map(String::as_str).collect();
        if let Some(default) = self.default_value.as_ref().and_then(|v| v.as_str()) {
            if !default.is_empty() && !allowed.contains(&default) {
                allowed.push(default);
            }
        }
        Some(allowed)
    }
}

/// Why one submitted answer set was rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnswerViolationKind {
    /// A question the template requires has no answer, or a blank one.
    MissingRequired,
    /// The answer is not one of the values the template declared.
    ValueOutOfRange { got: String, allowed: Vec<String> },
}

/// A single rejection, naming the question it is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnswerViolation {
    pub question_id: String,
    pub question: String,
    pub kind: AnswerViolationKind,
}

impl AnswerViolation {
    /// One line the user can act on. Names the question by its own text (the
    /// id alone means nothing to them) and keeps the id for support.
    pub fn describe(&self) -> String {
        let label = if self.question.trim().is_empty() {
            self.question_id.clone()
        } else {
            format!("{} ({})", self.question.trim(), self.question_id)
        };
        match &self.kind {
            AnswerViolationKind::MissingRequired => format!("{label} needs an answer"),
            AnswerViolationKind::ValueOutOfRange { got, allowed } => format!(
                "{label} was answered \"{got}\", which is not one of: {}",
                allowed.join(", ")
            ),
        }
    }
}

/// Stable prefix on every rejection message. Kept as one greppable phrase so
/// the frontend error registry can map it to friendly copy.
pub const ADOPTION_ANSWERS_REJECTED: &str = "Adoption answers rejected";

/// Render a violation list as one error message.
pub fn describe_violations(violations: &[AnswerViolation]) -> String {
    let details: Vec<String> = violations.iter().map(AnswerViolation::describe).collect();
    format!("{ADOPTION_ANSWERS_REJECTED}: {}", details.join("; "))
}

/// Pull `adoption_questions[]` out of a stored design payload.
///
/// Returns an empty vec for a session whose `agent_ir` declares none (a
/// from-scratch build, a legacy row, an unparseable blob). An empty schema
/// means "nothing declared to enforce" — never "reject everything".
pub fn declared_questions(agent_ir_json: &str) -> Vec<DeclaredQuestion> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(agent_ir_json) else {
        return Vec::new();
    };
    let Some(items) = value.get("adoption_questions").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| match serde_json::from_value::<DeclaredQuestion>(item.clone()) {
            Ok(q) if !q.id.is_empty() => Some(q),
            Ok(_) => None,
            Err(error) => {
                // A question we cannot read is a question we cannot enforce.
                // Dropping it is the right (fail-open) call, but do it out
                // loud: a silent drop would look identical to a template that
                // never declared the question.
                tracing::warn!(
                    error = %error,
                    question = %item.get("id").and_then(|v| v.as_str()).unwrap_or("<no id>"),
                    "adoption schema: skipping an unreadable adoption_question"
                );
                None
            }
        })
        .collect()
}

/// Read the capability selection the submitter declared alongside its answers.
/// `None` (absent or JSON `null`) means "no use-case picker was shown", i.e.
/// every declared question applies.
pub fn submitted_use_case_selection(answers_json: &str) -> Option<Vec<String>> {
    serde_json::from_str::<serde_json::Value>(answers_json)
        .ok()?
        .get("selected_use_case_ids")?
        .as_array()?
        .iter()
        .map(|v| v.as_str().map(str::to_string))
        .collect()
}

/// Parse `build_sessions.disabled_dims_json` into `capability -> [dimension]`.
pub fn parse_disabled_dims(disabled_dims_json: Option<&str>) -> HashMap<String, Vec<String>> {
    disabled_dims_json
        .and_then(|raw| serde_json::from_str::<HashMap<String, Vec<String>>>(raw).ok())
        .unwrap_or_default()
}

/// Validate a submitted answer set against the template's declared schema.
///
/// Two rules, both derived from what the UI itself enforces:
///   * **required present** — every declared question that is in scope must
///     have a non-blank answer. In scope = not `optional`, not filtered out by
///     the submitter's capability selection, not on a dimension the user
///     disabled for that capability, and not on a
///     [`DIMENSIONS_GATED_CLIENT_SIDE`] dimension.
///   * **enum values in range** — an answered question whose template declares
///     a closed `select` option list must carry one of those values. Applies to
///     optional and out-of-scope questions too: nothing legitimately produces
///     an out-of-range value.
///
/// Returns every violation rather than the first, so one rejection can tell the
/// caller about all of its problems.
pub fn validate_answers(
    declared: &[DeclaredQuestion],
    answers: &AdoptionAnswers,
    selected_use_case_ids: Option<&[String]>,
    disabled_dims: &HashMap<String, Vec<String>>,
) -> Vec<AnswerViolation> {
    let mut violations = Vec::new();

    for q in declared {
        let answer = answers.answers.get(&q.id).map(String::as_str).unwrap_or("");
        let answered = !answer.trim().is_empty();

        if answered {
            if let Some(allowed) = q.closed_option_set() {
                if !allowed.iter().any(|opt| *opt == answer) {
                    violations.push(AnswerViolation {
                        question_id: q.id.clone(),
                        question: q.question.clone(),
                        kind: AnswerViolationKind::ValueOutOfRange {
                            got: answer.to_string(),
                            allowed: allowed.into_iter().map(str::to_string).collect(),
                        },
                    });
                }
            }
            continue;
        }

        if is_required(q, selected_use_case_ids, disabled_dims) {
            violations.push(AnswerViolation {
                question_id: q.id.clone(),
                question: q.question.clone(),
                kind: AnswerViolationKind::MissingRequired,
            });
        }
    }

    violations
}

/// Whether an unanswered declared question is a rejection.
fn is_required(
    q: &DeclaredQuestion,
    selected_use_case_ids: Option<&[String]>,
    disabled_dims: &HashMap<String, Vec<String>>,
) -> bool {
    if q.optional {
        return false;
    }

    let capabilities = q.capability_ids();

    // The submitter deselected every capability this question configures, so
    // the UI never showed it. Persona- and connector-scoped questions (no
    // capability ids) always apply.
    if let Some(selected) = selected_use_case_ids {
        if !capabilities.is_empty()
            && !capabilities
                .iter()
                .any(|cap| selected.iter().any(|s| s == cap))
        {
            return false;
        }
    }

    if let Some(dim) = q.dimension.as_deref() {
        if DIMENSIONS_GATED_CLIENT_SIDE.contains(&dim) {
            return false;
        }
        // The user switched this dimension off for the capability via the
        // SigilEditModal, which persists to `disabled_dims_json` before the
        // answers are saved.
        for cap in &capabilities {
            if disabled_dims
                .get(*cap)
                .is_some_and(|dims| dims.iter().any(|d| d == dim))
            {
                return false;
            }
        }
    }

    true
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
            answers: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
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
        let mut ir =
            make_ir("Monitor {{param.aq_ticker}} weekly with threshold {{param.aq_threshold}}.");
        let answers = make_answers(&[("aq_ticker", "NVDA,AAPL"), ("aq_threshold", "500")], &[]);
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

    // -- Server-side validation (adoption-answers-server-validation) --------

    /// A design payload shaped like the real thing: `adoption_questions[]` at
    /// the top level of the stored `agent_ir`, alongside the rest of the IR.
    const DESIGN_JSON: &str = r#"{
      "name": "Doc Hub",
      "use_cases": [{"id": "uc_ingest"}, {"id": "uc_report"}],
      "adoption_questions": [
        {"id": "aq_folders", "question": "Which folders?", "type": "text",
         "dimension": "connector", "use_case_id": "uc_ingest", "use_case_ids": ["uc_ingest"]},
        {"id": "aq_depth", "question": "How thorough?", "type": "select",
         "options": ["Fast", "Balanced", "Deep"],
         "dimension": "task", "use_case_id": "uc_ingest", "use_case_ids": ["uc_ingest"]},
        {"id": "aq_cadence", "question": "How often?", "type": "select",
         "options": ["Daily", "Weekly"],
         "dimension": "trigger", "use_case_id": "uc_report", "use_case_ids": ["uc_report"]},
        {"id": "aq_nickname", "question": "Nickname?", "type": "text",
         "optional": true, "dimension": "task"},
        {"id": "aq_recall", "question": "Remember past docs?", "type": "select",
         "options": ["Yes", "No"], "dimension": "memory", "use_case_id": "uc_ingest"},
        {"id": "aq_provider", "question": "Which AI?", "type": "select",
         "options": ["OpenAI", "Anthropic"], "allow_custom": true, "dimension": "connector"},
        {"id": "aq_project", "question": "Which project?", "type": "select",
         "dynamic_source": {"service_type": "sentry"}, "dimension": "connector"}
      ]
    }"#;

    fn answers_of(pairs: &[(&str, &str)]) -> AdoptionAnswers {
        make_answers(pairs, &[])
    }

    /// Every question the server can prove is required, answered in range.
    fn complete_pairs() -> Vec<(&'static str, &'static str)> {
        vec![
            ("aq_folders", "Drive/Strategy"),
            ("aq_depth", "Balanced"),
            ("aq_cadence", "Weekly"),
            ("aq_provider", "Cohere"),
            ("aq_project", "personas-desktop"),
        ]
    }

    #[test]
    fn declared_questions_are_read_from_the_stored_design_payload() {
        let declared = declared_questions(DESIGN_JSON);
        assert_eq!(declared.len(), 7, "every declared question must be seen");
        let depth = declared.iter().find(|q| q.id == "aq_depth").unwrap();
        assert_eq!(depth.kind.as_deref(), Some("select"));
        assert_eq!(depth.closed_option_set().unwrap().len(), 3);
        // A from-scratch build declares none — that is "nothing to enforce",
        // never "reject everything".
        assert!(declared_questions(r#"{"name":"scratch"}"#).is_empty());
        assert!(declared_questions("not json at all").is_empty());
    }

    #[test]
    fn complete_answers_are_accepted() {
        let declared = declared_questions(DESIGN_JSON);
        let violations = validate_answers(
            &declared,
            &answers_of(&complete_pairs()),
            None,
            &HashMap::new(),
        );
        assert!(
            violations.is_empty(),
            "a complete answer set must pass: {violations:?}"
        );
    }

    #[test]
    fn a_missing_required_answer_is_rejected_and_names_the_question() {
        let declared = declared_questions(DESIGN_JSON);
        let mut pairs = complete_pairs();
        pairs.retain(|(id, _)| *id != "aq_cadence");
        let violations = validate_answers(&declared, &answers_of(&pairs), None, &HashMap::new());

        assert_eq!(violations.len(), 1, "got {violations:?}");
        assert_eq!(violations[0].question_id, "aq_cadence");
        assert_eq!(violations[0].kind, AnswerViolationKind::MissingRequired);

        let message = describe_violations(&violations);
        assert!(message.starts_with(ADOPTION_ANSWERS_REJECTED));
        assert!(message.contains("How often?"), "message: {message}");
        assert!(message.contains("aq_cadence"), "message: {message}");
    }

    #[test]
    fn a_blank_answer_counts_as_missing() {
        let declared = declared_questions(DESIGN_JSON);
        let mut pairs = complete_pairs();
        for pair in pairs.iter_mut() {
            if pair.0 == "aq_folders" {
                pair.1 = "   ";
            }
        }
        let violations = validate_answers(&declared, &answers_of(&pairs), None, &HashMap::new());
        assert_eq!(violations.len(), 1, "got {violations:?}");
        assert_eq!(violations[0].question_id, "aq_folders");
    }

    #[test]
    fn an_out_of_range_enum_value_is_rejected() {
        let declared = declared_questions(DESIGN_JSON);
        let mut pairs = complete_pairs();
        for pair in pairs.iter_mut() {
            if pair.0 == "aq_depth" {
                pair.1 = "Exhaustive";
            }
        }
        let violations = validate_answers(&declared, &answers_of(&pairs), None, &HashMap::new());
        assert_eq!(violations.len(), 1, "got {violations:?}");
        assert_eq!(violations[0].question_id, "aq_depth");
        match &violations[0].kind {
            AnswerViolationKind::ValueOutOfRange { got, allowed } => {
                assert_eq!(got, "Exhaustive");
                assert_eq!(allowed.len(), 3);
            }
            other => panic!("expected an out-of-range violation, got {other:?}"),
        }
        let message = describe_violations(&violations);
        assert!(message.contains("Balanced"), "allowed set must be shown: {message}");
    }

    #[test]
    fn open_ended_questions_are_never_range_checked() {
        // allow_custom, dynamic_source and free text all legitimately carry
        // values the template never listed.
        let declared = declared_questions(DESIGN_JSON);
        let violations =
            validate_answers(&declared, &answers_of(&complete_pairs()), None, &HashMap::new());
        assert!(violations.is_empty(), "got {violations:?}");
    }

    #[test]
    fn optional_and_client_gated_questions_are_not_required() {
        // aq_nickname is `optional`; aq_recall is a `memory` question whose
        // gate lives in component state the server cannot see. Neither is
        // answered in `complete_pairs()`.
        let declared = declared_questions(DESIGN_JSON);
        let violations =
            validate_answers(&declared, &answers_of(&complete_pairs()), None, &HashMap::new());
        assert!(violations.is_empty(), "got {violations:?}");
    }

    #[test]
    fn a_client_gated_question_is_still_range_checked_when_answered() {
        let declared = declared_questions(DESIGN_JSON);
        let mut pairs = complete_pairs();
        pairs.push(("aq_recall", "Sometimes"));
        let violations = validate_answers(&declared, &answers_of(&pairs), None, &HashMap::new());
        assert_eq!(violations.len(), 1, "got {violations:?}");
        assert_eq!(violations[0].question_id, "aq_recall");
    }

    #[test]
    fn deselecting_a_capability_drops_its_questions_from_required() {
        let declared = declared_questions(DESIGN_JSON);
        let mut pairs = complete_pairs();
        pairs.retain(|(id, _)| *id != "aq_cadence"); // uc_report's only question
        let selected = vec!["uc_ingest".to_string()];
        let violations = validate_answers(
            &declared,
            &answers_of(&pairs),
            Some(&selected),
            &HashMap::new(),
        );
        assert!(
            violations.is_empty(),
            "a question for a deselected capability must not be required: {violations:?}"
        );

        // …and it IS required when its capability is selected.
        let selected_both = vec!["uc_ingest".to_string(), "uc_report".to_string()];
        let violations = validate_answers(
            &declared,
            &answers_of(&pairs),
            Some(&selected_both),
            &HashMap::new(),
        );
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].question_id, "aq_cadence");
    }

    #[test]
    fn a_dimension_the_user_disabled_for_a_capability_is_not_required() {
        let declared = declared_questions(DESIGN_JSON);
        let mut pairs = complete_pairs();
        pairs.retain(|(id, _)| *id != "aq_cadence");
        let disabled = parse_disabled_dims(Some(r#"{"uc_report":["trigger"]}"#));
        assert_eq!(disabled.get("uc_report").unwrap(), &vec!["trigger".to_string()]);
        let violations = validate_answers(&declared, &answers_of(&pairs), None, &disabled);
        assert!(violations.is_empty(), "got {violations:?}");
    }

    #[test]
    fn every_problem_is_reported_not_just_the_first() {
        let declared = declared_questions(DESIGN_JSON);
        let violations = validate_answers(
            &declared,
            &answers_of(&[("aq_depth", "Exhaustive")]),
            None,
            &HashMap::new(),
        );
        let ids: Vec<&str> = violations.iter().map(|v| v.question_id.as_str()).collect();
        assert!(ids.contains(&"aq_depth"), "{ids:?}");
        assert!(ids.contains(&"aq_folders"), "{ids:?}");
        assert!(ids.contains(&"aq_cadence"), "{ids:?}");
        assert!(ids.contains(&"aq_project"), "{ids:?}");
        assert!(!ids.contains(&"aq_nickname"), "optional leaked in: {ids:?}");
    }

    /// Regression guard for a real defect in the shipped catalogue: 10 of 351
    /// closed `select` questions declare a `default` that is not in their own
    /// `options` (a de-branding pass rewrote the default and not the list).
    /// The adoption UI pre-fills that default, so rejecting it would break
    /// those adoptions for a template-authoring bug. Anything else invented is
    /// still rejected.
    #[test]
    fn a_template_default_that_drifted_out_of_its_options_is_still_in_range() {
        let design = r#"{
          "adoption_questions": [
            {"id": "aq_alert", "question": "On an oversized PR?", "type": "select",
             "options": ["Post Slack alert and tag a reviewer", "Do nothing"],
             "default": "Post messaging alert and tag a reviewer", "dimension": "task"}
          ]
        }"#;
        let declared = declared_questions(design);
        assert_eq!(declared.len(), 1);

        let accepted = answers_of(&[("aq_alert", "Post messaging alert and tag a reviewer")]);
        assert!(
            validate_answers(&declared, &accepted, None, &HashMap::new()).is_empty(),
            "the template's own pre-filled default must be accepted"
        );

        let listed = answers_of(&[("aq_alert", "Do nothing")]);
        assert!(validate_answers(&declared, &listed, None, &HashMap::new()).is_empty());

        let invented = answers_of(&[("aq_alert", "Delete the repository")]);
        assert_eq!(
            validate_answers(&declared, &invented, None, &HashMap::new()).len(),
            1,
            "a value nobody declared is still rejected"
        );
    }

    /// A non-string `default` (12 catalogued questions use bool/int/list) must
    /// not knock the whole question out of the schema.
    #[test]
    fn a_non_string_default_does_not_drop_the_question() {
        let design = r#"{
          "adoption_questions": [
            {"id": "aq_flag", "question": "Enabled?", "type": "boolean", "default": true,
             "dimension": "task"},
            {"id": "aq_count", "question": "How many?", "type": "number", "default": 5,
             "dimension": "task"}
          ]
        }"#;
        let declared = declared_questions(design);
        assert_eq!(declared.len(), 2, "typed defaults must not drop questions");
        // …and both are still enforced as required.
        let violations =
            validate_answers(&declared, &answers_of(&[]), None, &HashMap::new());
        assert_eq!(violations.len(), 2);
    }

    #[test]
    fn the_capability_selection_is_read_off_the_submitted_payload() {
        let json = r#"{"answers":{},"questions":[],"credential_bindings":{},"selected_use_case_ids":["uc_ingest"]}"#;
        assert_eq!(
            submitted_use_case_selection(json),
            Some(vec!["uc_ingest".to_string()])
        );
        // Absent or null => no picker was shown => everything applies.
        assert_eq!(submitted_use_case_selection(r#"{"answers":{}}"#), None);
        assert_eq!(
            submitted_use_case_selection(r#"{"answers":{},"selected_use_case_ids":null}"#),
            None
        );
    }
}
