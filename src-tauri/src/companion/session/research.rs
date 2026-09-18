//! The research leg (athena-browser-react): one headless, tool-restricted
//! CLI turn on the ASIDE tier that answers a `research` job's question with
//! findings and sources, and books itself on the turn ledger.
//!
//! It is a *leg*, not a conversation turn: it holds no conversation lock,
//! resumes no session and writes no session pointer, streams nothing to the
//! panel, and composes no constitution — its system prompt is the short
//! research brief in `templates/research-prompt.md`. What it shares with a
//! chat turn is the one thing worth sharing: the spawn and the stdout loop
//! (`cli::run_cli_turn`), so a `result` line lands in `companion_turn` with
//! `tier_class = "aside"`, `origin = "job"` and `trigger_kind = "research"`,
//! and a spawn failure or a timeout books as a failed leg through the same
//! taxonomy every other leg uses.
//!
//! **Claude only.** The two tools the brief allows, `WebSearch` and
//! `WebFetch`, are Claude Code's; an ASIDE tier set to grok runs the leg on
//! Claude's ASIDE defaults instead and the ledger row says so
//! (`fallback_reason = "research_tools_claude_only"`).

use std::time::{Duration, Instant};

use super::cli::{run_cli_turn, CliTurn};
use crate::companion::engine_settings::{self, AthenaEngine, ResolvedTier, TurnTierClass};
use crate::companion::model_routing;
use crate::companion::templates::RESEARCH_PROMPT_MD;
use crate::companion::turn_ledger::{failed_turn_record, record_turn, TurnRecord};
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;
use tauri::AppHandle;

/// The whole bound on a research leg, spawn to `result`. A leg that has not
/// answered by then is killed (`kill_on_drop`) and the job fails with the
/// reason, so the return leg still fires.
pub const RESEARCH_TIMEOUT: Duration = Duration::from_secs(240);

/// Ledger identity of the leg: `origin`, `trigger_kind`.
pub const RESEARCH_ORIGIN: &str = "job";
pub const RESEARCH_TRIGGER: &str = "research";

/// The `fallback_reason` token when the ASIDE tier asked for an engine that
/// cannot carry the research tools.
pub const FALLBACK_RESEARCH_TOOLS: &str = "research_tools_claude_only";

/// The tier a research leg actually runs on, given the operator's ASIDE
/// choice: the choice itself when it is Claude, otherwise Claude's ASIDE
/// defaults, with the reason.
pub fn research_tier(requested: &ResolvedTier) -> (ResolvedTier, Option<&'static str>) {
    if requested.engine == AthenaEngine::Claude {
        return (
            ResolvedTier {
                class: TurnTierClass::Aside,
                ..requested.clone()
            },
            None,
        );
    }
    (
        ResolvedTier {
            class: TurnTierClass::Aside,
            engine: AthenaEngine::Claude,
            model: model_routing::ASIDE.model.to_string(),
            effort: model_routing::ASIDE.effort.map(String::from),
        },
        Some(FALLBACK_RESEARCH_TOOLS),
    )
}

/// The one user message the leg receives.
pub fn research_user_message(question: &str, context: Option<&str>) -> String {
    let mut s = format!("Question: {}\n", question.trim());
    if let Some(context) = context.map(str::trim).filter(|c| !c.is_empty()) {
        s.push_str(&format!("\nContext (what prompted it): {context}\n"));
    }
    s.push_str("\nAnswer with the report format in your brief.\n");
    s
}

/// The findings out of a leg's output: the last prose segment when the
/// model worked in several steps (the earlier ones narrate the searching),
/// the whole text otherwise.
pub fn findings_from(text: &str, segments: &[String]) -> String {
    segments
        .iter()
        .rev()
        .map(|s| s.trim())
        .find(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| text.trim().to_string())
}

/// Run one research leg for `job_id`. `Ok(findings)` on a clean `result`;
/// `Err` on a spawn failure, a non-zero exit with no text, or the timeout.
/// Every path books exactly one ledger row.
pub async fn run_research_turn(
    app: &AppHandle,
    pool: &UserDbPool,
    sys_db: &DbPool,
    job_id: &str,
    question: &str,
    context: Option<&str>,
) -> Result<String, AppError> {
    let requested = engine_settings::resolve(sys_db, TurnTierClass::Aside);
    let (tier, fallback_reason) = research_tier(&requested);
    let user_message = research_user_message(question, context);
    let turn_id = format!("research_{job_id}");
    // Never the conversation's id: a research leg must not `--resume` the
    // chat session nor overwrite its pointer. `research_tools` on the turn is
    // what keeps `run_cli_turn` from writing the pointer or streaming events.
    let session_id = format!("research:{job_id}");
    let turn = CliTurn {
        turn_id: &turn_id,
        session_id: &session_id,
        resume_session_id: None,
        system_prompt: RESEARCH_PROMPT_MD,
        user_message: &user_message,
        engine: AthenaEngine::Claude,
        tier: &tier,
        browser_tools: false,
        research_tools: true,
        cwd_override: None,
        mcp: &[],
        persist_progress: false,
        usage_sink: None,
    };
    let started = Instant::now();
    match tokio::time::timeout(RESEARCH_TIMEOUT, run_cli_turn(app, pool, turn)).await {
        Ok(Ok((text, segments, usage))) => {
            record_turn(
                pool,
                &TurnRecord {
                    origin: RESEARCH_ORIGIN.to_string(),
                    trigger_kind: Some(RESEARCH_TRIGGER.to_string()),
                    model: Some(tier.model.clone()),
                    usage,
                    outcome_json: serde_json::to_string(&serde_json::json!({
                        "job_id": job_id,
                        "segments": segments.len(),
                        "elapsed_ms": started.elapsed().as_millis() as u64,
                    }))
                    .ok(),
                    engine: AthenaEngine::Claude,
                    tier_class: Some(TurnTierClass::Aside),
                    fallback_reason: fallback_reason.map(String::from),
                    ..Default::default()
                },
            );
            Ok(findings_from(&text, &segments))
        }
        Ok(Err(e)) => {
            record_failed(pool, &tier, fallback_reason, &e);
            Err(e)
        }
        Err(_) => {
            let e = AppError::Internal(format!(
                "research leg exceeded the {}-second timeout",
                RESEARCH_TIMEOUT.as_secs()
            ));
            record_failed(pool, &tier, fallback_reason, &e);
            Err(e)
        }
    }
}

fn record_failed(
    pool: &UserDbPool,
    tier: &ResolvedTier,
    fallback_reason: Option<&'static str>,
    e: &AppError,
) {
    let reason = super::failure::classify_failure(e);
    tracing::warn!(
        origin = RESEARCH_ORIGIN,
        trigger_kind = RESEARCH_TRIGGER,
        model = %tier.model,
        reason,
        error = %e,
        "companion: research leg failed — recording ledger row"
    );
    let mut rec = failed_turn_record(
        RESEARCH_ORIGIN,
        Some(RESEARCH_TRIGGER.to_string()),
        Some(tier.model.clone()),
        reason,
        &e.to_string(),
        None,
    );
    rec.tier_class = Some(TurnTierClass::Aside);
    rec.fallback_reason = fallback_reason.map(String::from);
    record_turn(pool, &rec);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_claude_aside_tier_runs_as_itself_and_a_grok_one_falls_back_with_the_reason() {
        let claude = ResolvedTier {
            class: TurnTierClass::Aside,
            engine: AthenaEngine::Claude,
            model: model_routing::ASIDE.model.into(),
            effort: Some("low".into()),
        };
        let (tier, why) = research_tier(&claude);
        assert_eq!(tier, claude);
        assert_eq!(why, None);

        let grok = ResolvedTier {
            class: TurnTierClass::Aside,
            engine: AthenaEngine::Grok,
            model: personas_core::model_ids::GROK_CURRENT.into(),
            effort: Some("low".into()),
        };
        let (tier, why) = research_tier(&grok);
        assert_eq!(tier.engine, AthenaEngine::Claude);
        assert_eq!(tier.class, TurnTierClass::Aside);
        assert_eq!(tier.model, model_routing::ASIDE.model);
        assert_eq!(why, Some(FALLBACK_RESEARCH_TOOLS));
    }

    #[test]
    fn the_user_message_carries_the_question_and_only_a_real_context() {
        let plain = research_user_message("  Does IEEE 1789 cover LED flicker?  ", None);
        assert_eq!(
            plain,
            "Question: Does IEEE 1789 cover LED flicker?\n\nAnswer with the report format in your brief.\n"
        );
        assert_eq!(
            research_user_message("q", Some("   ")),
            research_user_message("q", None)
        );
        let with = research_user_message("q", Some("a product page claims it"));
        assert!(with.contains("\nContext (what prompted it): a product page claims it\n"));
    }

    #[test]
    fn findings_are_the_last_prose_segment_or_the_whole_text() {
        let segments = vec![
            "Searching for the standard.".to_string(),
            "   ".to_string(),
            "Verdict: it does.\n\nSources: https://standards.ieee.org/".to_string(),
        ];
        assert_eq!(
            findings_from("ignored", &segments),
            "Verdict: it does.\n\nSources: https://standards.ieee.org/"
        );
        assert_eq!(findings_from("  whole text  ", &[]), "whole text");
        assert_eq!(findings_from("whole", &["  ".to_string()]), "whole");
    }

    #[test]
    fn the_brief_teaches_the_report_shape_and_forbids_the_machine_grammar() {
        for needle in [
            "WebSearch",
            "WebFetch",
            "Verdict",
            "Sources",
            "Gaps",
            "No `OP:` lines",
        ] {
            assert!(RESEARCH_PROMPT_MD.contains(needle), "brief lost: {needle}");
        }
        assert!(
            RESEARCH_PROMPT_MD.lines().count() <= 60,
            "the brief is meant to stay compact"
        );
        assert!(RESEARCH_TIMEOUT == Duration::from_secs(240));
    }
}
