//! Writes to the user DB: the `companion_approval` row an accepted op
//! becomes, and the System episode a rejected `use_connector` op leaves
//! behind so Athena sees her own silent failure on the next turn.
//!
//! Moved verbatim out of the former single-file `dispatcher.rs`.

use rusqlite::params;

use super::envelope::OpEnvelope;
use super::types::CreatedApproval;
use crate::db::UserDbPool;
use crate::error::AppError;

pub(super) fn note_dispatcher_rejection(
    pool: &UserDbPool,
    session_id: &str,
    connector_name: &str,
    capability: &str,
    reason: &str,
) {
    let body = format!(
        "[dispatcher] Your last `OP: use_connector{{{connector_name}, {capability}}}` was rejected and produced no background job. Reason: {reason}. On your next turn, surface this to the user honestly — either propose pinning/enabling the connector, pivot to a wired alternative, or acknowledge the gap. Do NOT silently re-emit the same op.",
        connector_name = connector_name,
        capability = capability,
        reason = reason,
    );
    if let Err(e) = crate::companion::brain::episodic::append_episode(
        pool,
        session_id,
        crate::companion::brain::episodic::EpisodeRole::System,
        &body,
    ) {
        tracing::warn!(
            connector = connector_name,
            capability = capability,
            error = %e,
            "note_dispatcher_rejection: failed to append system episode (silent-drop pattern returns for this turn only)"
        );
    }
}

pub(super) fn insert_approval(
    pool: &UserDbPool,
    session_id: &str,
    env: &OpEnvelope,
) -> Result<CreatedApproval, AppError> {
    let id = format!("appr_{}", crate::companion::util::short_id(12));
    let params_json = env.params.to_string();
    let payload = serde_json::json!({
        "action": env.action,
        "params": env.params,
        "rationale": env.rationale,
    })
    .to_string();
    // For resolve_human_review, surface the review_id at the top level
    // for cross-link queries (Overview panel can find approvals attached
    // to a specific review without parsing the payload JSON).
    let human_review_id: Option<String> = if env.action == "resolve_human_review" {
        env.params
            .get("review_id")
            .and_then(|v| v.as_str())
            .map(String::from)
    } else {
        None
    };

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', ?4, datetime('now'))",
        params![id, session_id, payload, human_review_id],
    )?;

    Ok(CreatedApproval {
        id,
        action: env.action.clone(),
        params_json,
        rationale: env.rationale.clone(),
    })
}
