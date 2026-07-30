//! `session_review` background job — the night-shift review station leg.
//!
//! Enqueued by `night_shift::tick`'s review sweep when a dispatched session
//! reaches a terminal state. Gathers read-only git facts from the session's
//! repo, classifies ship-to-branch / park-for-human / retry-with-feedback
//! (`night_shift::review`), and lands the finding as a `review_verdict`
//! ledger row + a system episode. The morning report rolls the verdicts up
//! into one card — no per-session card spam.

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::night_shift::{self, review};
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::UserDbPool;
use crate::error::AppError;

pub const KIND: &str = "session_review";

pub async fn run(
    pool: &UserDbPool,
    params: &serde_json::Value,
    progress: &super::JobProgress,
) -> Result<String, AppError> {
    let plan_id = str_param(params, "planId")?;
    let session_id = str_param(params, "sessionId")?;
    let cwd = str_param(params, "cwd")?;
    let project = params
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let objective = params
        .get("objective")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    progress.report(format!("Reviewing night session in {project}…"));

    let (verdict, reason, facts_json) = match review::gather_facts(&cwd).await {
        Ok(facts) => {
            let (verdict, reason) = review::classify(&facts);
            let facts_json = serde_json::to_value(&facts).unwrap_or(serde_json::json!({}));
            (verdict, reason, facts_json)
        }
        Err(e) => {
            // Can't even read the repo — that is itself a park-for-human.
            (
                review::Verdict::ParkForHuman,
                format!("Could not inspect the repo: {e}"),
                serde_json::json!({}),
            )
        }
    };

    // Audit ledger row — attributed to the plan + session.
    night_shift::record_event(
        pool,
        Some(&plan_id),
        night_shift::EVENT_REVIEW_VERDICT,
        Some(&session_id),
        Some(&project),
        &serde_json::json!({
            "verdict": verdict.as_str(),
            "reason": reason,
            "objective": objective,
            "facts": facts_json,
        }),
    )?;

    // Episode so Athena's next turn (and consolidation) knows the outcome.
    let episode = format!(
        "[Night shift review] `{project}` session `{sid}` — {verdict}: {reason}\nObjective was: {objective}",
        sid = &session_id[..session_id.len().min(8)],
        verdict = verdict.as_str(),
    );
    if let Err(e) = episodic::append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, &episode)
    {
        tracing::warn!(error = %e, "session_review: episode write failed");
    }

    Ok(format!(
        "Reviewed `{project}` night session: {} — {reason}",
        verdict.as_str()
    ))
}

fn str_param(params: &serde_json::Value, key: &str) -> Result<String, AppError> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::Internal(format!("session_review: missing `{key}` param")))
}
