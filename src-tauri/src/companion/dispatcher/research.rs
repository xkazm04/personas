//! The `research` op (athena-browser-react): what the dispatcher accepts,
//! and the job title it enqueues under.
//!
//! Two spellings reach the same arm. The short line the constitution teaches,
//! `OP: {"op":"research","question":"…","context":"…"}`, and the standard
//! envelope, `{"op":"propose_action","action":"research","params":{…}}`.
//! Both are read here; the dispatch arm in `dispatch.rs` only enqueues.

use serde_json::Value;

use super::envelope::OpEnvelope;

/// A question longer than this is refused rather than researched: past it
/// the line is a brief, not a question, and the leg's turn budget is small.
pub(crate) const QUESTION_MAX_CHARS: usize = 1_000;
/// The optional context is a hint about what prompted the question.
pub(crate) const CONTEXT_MAX_CHARS: usize = 2_000;
/// How much of the question the task tag's title shows.
pub(crate) const TITLE_QUESTION_CHARS: usize = 60;

/// Is this envelope a research op, in either spelling?
pub(super) fn is_research(env: &OpEnvelope) -> bool {
    env.op == "research" || (env.op == "propose_action" && env.action == "research")
}

/// The `(question, context)` a research line asks for, validated. `payload`
/// is the raw JSON of the line: the short form keeps `question` at the top
/// level, which the envelope struct does not carry.
pub(super) fn research_request(
    payload: &str,
    env: &OpEnvelope,
) -> Result<(String, Option<String>), String> {
    // `payload` already parsed as an envelope, so this cannot fail; if it
    // ever does, say so rather than reading the short form as empty.
    let top: Value = serde_json::from_str(payload).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "research: op line re-parse failed; short-form fields unread");
        Value::Null
    });
    let field = |name: &str| -> Option<String> {
        env.params
            .get(name)
            .or_else(|| top.get(name))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let question = field("question").ok_or_else(|| {
        "`question` must be a non-empty string naming what to find out".to_string()
    })?;
    let question_chars = question.chars().count();
    if question_chars > QUESTION_MAX_CHARS {
        return Err(format!(
            "`question` is {question_chars} chars; the limit is {QUESTION_MAX_CHARS}"
        ));
    }
    let context = field("context");
    if let Some(c) = &context {
        let n = c.chars().count();
        if n > CONTEXT_MAX_CHARS {
            return Err(format!(
                "`context` is {n} chars; the limit is {CONTEXT_MAX_CHARS}"
            ));
        }
    }
    Ok((question, context))
}

/// `Researching: <question>`, the question cut to [`TITLE_QUESTION_CHARS`]
/// on a char boundary with the cut marked.
pub(crate) fn research_title(question: &str) -> String {
    let question = question.trim();
    let mut title = String::from("Researching: ");
    if question.chars().count() <= TITLE_QUESTION_CHARS {
        title.push_str(question);
    } else {
        title.extend(question.chars().take(TITLE_QUESTION_CHARS));
        title = title.trim_end().to_string();
        title.push('…');
    }
    title
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::dispatcher::dispatch;
    use crate::companion::jobs;

    fn env(payload: &str) -> OpEnvelope {
        serde_json::from_str(payload).expect("envelope parses")
    }

    #[test]
    fn both_spellings_are_research_and_nothing_else_is() {
        assert!(is_research(&env(r#"{"op":"research","question":"q"}"#)));
        assert!(is_research(&env(
            r#"{"op":"propose_action","action":"research","params":{"question":"q"}}"#
        )));
        assert!(!is_research(&env(
            r#"{"op":"propose_action","action":"use_connector","params":{}}"#
        )));
        assert!(!is_research(&env(r#"{"op":"researchy"}"#)));
    }

    #[test]
    fn the_request_is_read_from_the_top_level_or_the_params() {
        let short = r#"{"op":"research","question":"  Does IEEE 1789 cover flicker? ","context":"a lamp page cites it"}"#;
        assert_eq!(
            research_request(short, &env(short)).unwrap(),
            (
                "Does IEEE 1789 cover flicker?".to_string(),
                Some("a lamp page cites it".to_string())
            )
        );
        let long = r#"{"op":"propose_action","action":"research","params":{"question":"q2"},"rationale":"r"}"#;
        assert_eq!(
            research_request(long, &env(long)).unwrap(),
            ("q2".to_string(), None)
        );
        // A blank context is no context.
        let blank = r#"{"op":"research","question":"q","context":"   "}"#;
        assert_eq!(research_request(blank, &env(blank)).unwrap().1, None);
    }

    #[test]
    fn an_empty_or_oversized_question_is_refused_by_name() {
        for payload in [
            r#"{"op":"research"}"#,
            r#"{"op":"research","question":"   "}"#,
            r#"{"op":"research","question":7}"#,
            r#"{"op":"propose_action","action":"research","params":{}}"#,
        ] {
            let err = research_request(payload, &env(payload)).unwrap_err();
            assert!(err.contains("`question`"), "{payload}: {err}");
        }
        let long = format!(
            r#"{{"op":"research","question":"{}"}}"#,
            "x".repeat(QUESTION_MAX_CHARS + 1)
        );
        let err = research_request(&long, &env(&long)).unwrap_err();
        assert!(err.contains("1001 chars"), "{err}");
        let ctx = format!(
            r#"{{"op":"research","question":"q","context":"{}"}}"#,
            "c".repeat(CONTEXT_MAX_CHARS + 1)
        );
        assert!(research_request(&ctx, &env(&ctx))
            .unwrap_err()
            .contains("`context`"));
    }

    #[test]
    fn the_title_is_the_question_cut_at_sixty_chars_and_marked() {
        assert_eq!(research_title(" short one "), "Researching: short one");
        let long = "a".repeat(TITLE_QUESTION_CHARS + 20);
        let title = research_title(&long);
        assert_eq!(
            title,
            format!("Researching: {}…", "a".repeat(TITLE_QUESTION_CHARS))
        );
        // Multi-byte chars are counted as chars, never cut mid-codepoint.
        let accents = "é".repeat(TITLE_QUESTION_CHARS + 1);
        assert_eq!(
            research_title(&accents),
            format!("Researching: {}…", "é".repeat(TITLE_QUESTION_CHARS))
        );
    }

    /// The whole door, on the production user-db schema: the line enqueues a
    /// `research` job in the dispatching conversation and leaves the prose.
    #[test]
    fn a_research_line_enqueues_a_job_in_the_conversation_and_is_stripped() {
        let pool = crate::db::init_test_user_db().unwrap();
        let text = "Good question. I'll check the standard and come back to you.\n\
                    OP: {\"op\":\"research\",\"question\":\"Does IEEE 1789 cover LED flicker?\",\"context\":\"the Lumen page cites it\"}\n\
                    Meanwhile, the pricing looks steep.";
        let out = dispatch(&pool, "conv-research-1", text).expect("dispatch ok");
        assert!(out.warnings.is_empty(), "{:?}", out.warnings);
        assert!(!out.cleaned_text.contains("OP:"));
        assert!(out.cleaned_text.contains("I'll check the standard"));
        assert!(out.cleaned_text.contains("pricing looks steep"));
        assert!(out.approvals.is_empty(), "research is not a card");

        let queued = jobs::list(&pool, true, 50).expect("list jobs");
        let job = queued
            .iter()
            .find(|j| j.kind == jobs::research::KIND)
            .expect("a research job is queued");
        assert_eq!(job.status, "queued");
        assert_eq!(job.conversation_id.as_deref(), Some("conv-research-1"));
        assert_eq!(
            job.short_title.as_deref(),
            Some("Researching: Does IEEE 1789 cover LED flicker?")
        );
        let params: Value = serde_json::from_str(&job.params_json).unwrap();
        assert_eq!(params["question"], "Does IEEE 1789 cover LED flicker?");
        assert_eq!(params["context"], "the Lumen page cites it");
    }

    #[test]
    fn the_envelope_spelling_enqueues_too() {
        let pool = crate::db::init_test_user_db().unwrap();
        let text = "On it.\nOP: {\"op\":\"propose_action\",\"action\":\"research\",\"params\":{\"question\":\"q2\"},\"rationale\":\"he asked\"}";
        let out = dispatch(&pool, "conv-research-2", text).expect("dispatch ok");
        assert!(out.warnings.is_empty(), "{:?}", out.warnings);
        let queued = jobs::list(&pool, true, 50).expect("list jobs");
        assert!(queued.iter().any(|j| j.kind == jobs::research::KIND));
    }

    #[test]
    fn an_empty_question_enqueues_nothing_and_warns() {
        let pool = crate::db::init_test_user_db().unwrap();
        let text = "On it.\nOP: {\"op\":\"research\",\"question\":\"\"}";
        let out = dispatch(&pool, "conv-research-3", text).expect("dispatch ok");
        assert!(
            out.warnings.iter().any(|w| w.contains("rejected research")),
            "{:?}",
            out.warnings
        );
        let queued = jobs::list(&pool, true, 50).expect("list jobs");
        assert!(!queued.iter().any(|j| j.kind == jobs::research::KIND));
    }
}
