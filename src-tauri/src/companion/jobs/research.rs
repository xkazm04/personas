//! `research` job handler (athena-browser-react): a background web-research
//! lane. Athena dispatches `OP: {"op":"research","question":…}` from a chat
//! turn, answers the user at once with her interim reaction, and this job
//! runs a headless ASIDE-tier turn with `WebSearch` and `WebFetch`
//! (`session::run_research_turn`). The findings are the job result and, as
//! for every job, a System episode.
//!
//! **The return leg.** What makes this lane a conversation and not a note:
//! on completion, success or failure, [`spawn_return_leg`] starts a proactive
//! follow-up turn in the SAME conversation
//! (`TurnOrigin::Proactive { trigger_kind: "job_completed" }`) whose user
//! message names the question and carries the findings inline, so the
//! follow-up does not depend on recall. That origin AWAITS the conversation
//! lock like a user turn does (`session::locks::awaits_turn_lock`): a
//! question the user sends while the job runs is answered first, and the
//! findings arrive after it. The job worker itself never holds a turn lock.

#[cfg(feature = "ml")]
use std::sync::Arc;

use serde_json::Value;

use super::{BackgroundJob, JobEventSink, JobProgress};
use crate::companion::session::{spawn_proactive_turn_in_with, JOB_COMPLETED_TRIGGER};
use crate::db::{DbPool, UserDbPool};
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// The job kind, as `companion_background_job.kind` stores it.
pub const KIND: &str = "research";

/// How much of the findings the follow-up turn's user message carries
/// inline. Past this the message says where the rest is (the System note).
pub const FINDINGS_INLINE_CAP: usize = 12_000;

/// Run one research job: the question out of `params`, the leg through the
/// session module, the findings back as the result.
pub async fn run(
    pool: &UserDbPool,
    sys_db: &DbPool,
    job: &BackgroundJob,
    params: &Value,
    progress: &JobProgress,
) -> Result<String, AppError> {
    let question = question_of(params)
        .ok_or_else(|| AppError::Internal("research: missing `question`".into()))?;
    let context = params.get("context").and_then(Value::as_str);
    let app = progress.app_handle().ok_or_else(|| {
        AppError::Internal("research: no app handle behind the job sink (daemon/test sink)".into())
    })?;
    progress.report(format!("Searching the web: {question}"));
    crate::companion::session::run_research_turn(app, pool, sys_db, &job.id, question, context)
        .await
}

/// The question a research job carries, trimmed; `None` when absent or blank.
pub fn question_of(params: &Value) -> Option<&str> {
    params
        .get("question")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|q| !q.is_empty())
}

/// The user message of the follow-up turn. Success carries the findings
/// inline (capped, and the cap stated); failure carries the reason and asks
/// her to say so and answer from what she knows.
pub fn follow_up_directive(question: &str, outcome: Result<&str, &str>) -> String {
    match outcome {
        Ok(findings) => {
            let mut s = format!(
                "Your research on «{question}» finished. Read the findings in the system note \
                 above and give me your verdict in layer one; if the sources and detail matter, \
                 put them in a report and link it.\n\nFindings, inline so you need not \
                 recall them:\n\n"
            );
            let (body, cut) = cap_findings(findings);
            s.push_str(body);
            if cut {
                s.push_str(&format!(
                    "\n\n[findings cut here at {FINDINGS_INLINE_CAP} of {} chars; the full text \
                     is in the system note above]",
                    findings.len()
                ));
            }
            s
        }
        Err(reason) => format!(
            "Your research on «{question}» failed: {reason}. Tell me so in a sentence, answer \
             from what you already know and say that is what you are doing, and offer to try \
             again."
        ),
    }
}

/// The inline findings and whether the cap cut them.
fn cap_findings(findings: &str) -> (&str, bool) {
    if findings.len() <= FINDINGS_INLINE_CAP {
        (findings, false)
    } else {
        (
            crate::utils::text::truncate_on_char_boundary(findings, FINDINGS_INLINE_CAP),
            true,
        )
    }
}

/// Start the follow-up turn for a finished research job, in the job's own
/// conversation. Fire-and-forget by design (the turn's lifetime is the
/// proactive spawner's); a missing app handle is logged and the findings
/// still stand as the job result and the System note.
pub fn spawn_return_leg(
    pool: &UserDbPool,
    sys_db: &DbPool,
    #[cfg(feature = "ml")] embedder: Option<&Arc<EmbeddingManager>>,
    sink: &JobEventSink,
    job: &BackgroundJob,
    outcome: Result<&str, &str>,
) {
    let Some(app) = sink.app_handle() else {
        tracing::warn!(job_id = %job.id, "research: no app handle; the follow-up turn is not spawned");
        return;
    };
    let params: Value = serde_json::from_str(&job.params_json).unwrap_or_else(|e| {
        tracing::warn!(job_id = %job.id, error = %e, "research: params_json unreadable; the follow-up names no question");
        Value::Null
    });
    let question = question_of(&params).unwrap_or("your question").to_string();
    let directive = follow_up_directive(&question, outcome);
    let conversation_id = job
        .conversation_id
        .clone()
        .unwrap_or_else(|| crate::companion::session::DEFAULT_SESSION_ID.to_string());
    tracing::info!(
        job_id = %job.id,
        conversation = %conversation_id,
        ok = outcome.is_ok(),
        "research: spawning the follow-up turn"
    );
    spawn_proactive_turn_in_with(
        app.clone(),
        std::sync::Arc::new(pool.clone()),
        std::sync::Arc::new(sys_db.clone()),
        #[cfg(feature = "ml")]
        embedder.cloned(),
        JOB_COMPLETED_TRIGGER.to_string(),
        Some(job.id.clone()),
        directive,
        conversation_id,
        // Not autonomous: a research follow-up carries no standing consent,
        // so any proposal it makes is a card for the user, never auto-approved.
        false,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_question_is_trimmed_and_blank_is_absent() {
        assert_eq!(
            question_of(&serde_json::json!({ "question": "  is it true?  " })),
            Some("is it true?")
        );
        assert_eq!(question_of(&serde_json::json!({ "question": "   " })), None);
        assert_eq!(question_of(&serde_json::json!({})), None);
        assert_eq!(question_of(&serde_json::json!({ "question": 7 })), None);
    }

    #[test]
    fn the_follow_up_names_the_question_and_carries_the_findings_inline() {
        let d = follow_up_directive("do the claims hold?", Ok("Verdict: mostly.\n\nSources: x"));
        assert!(d.starts_with("Your research on «do the claims hold?» finished. Read the findings in the system note above and give me your verdict in layer one;"));
        assert!(
            !d.contains("briefly"),
            "the length rule is layer one, not an adverb"
        );
        assert!(d.ends_with("Verdict: mostly.\n\nSources: x"));
        assert!(!d.contains("[findings cut"));
    }

    #[test]
    fn oversized_findings_are_cut_and_the_cut_is_stated() {
        let big = "é".repeat(FINDINGS_INLINE_CAP); // 2 bytes each: twice the cap
        let d = follow_up_directive("q", Ok(&big));
        assert!(d.contains(&format!(
            "[findings cut here at {FINDINGS_INLINE_CAP} of {} chars",
            big.len()
        )));
        // The cut lands on a char boundary and never exceeds the cap.
        let body = d
            .split("Findings, inline so you need not recall them:\n\n")
            .nth(1)
            .unwrap();
        let body = body.split("\n\n[findings cut").next().unwrap();
        assert!(body.len() <= FINDINGS_INLINE_CAP);
        assert!(body.chars().all(|c| c == 'é'));
    }

    #[test]
    fn a_failed_job_still_gets_a_follow_up_that_says_so() {
        let d = follow_up_directive("q", Err("research leg exceeded the 240-second timeout"));
        assert!(d.contains("failed: research leg exceeded the 240-second timeout"));
        assert!(d.contains("offer to try again"));
    }
}
