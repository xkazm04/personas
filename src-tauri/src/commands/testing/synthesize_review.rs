//! `synthesize_manual_review` — bridge-callable test command that
//! deterministically drives the auto_triage second-pass evaluator
//! end-to-end, bypassing LLM nondeterminism in the build/runtime
//! flow.
//!
//! Why this exists: Phase D verifies the BUILD shape only (LLM emits
//! `mode: "auto_triage"` and promote preserves it). The follow-up
//! "Phase D2" needs to verify the RUNTIME — that when a
//! `ProtocolMessage::ManualReview` is dispatched against an auto_triage
//! capability, the spawned evaluator runs the Claude CLI, parses a
//! verdict, transitions the review row to `Approved` / `Rejected`, and
//! audits via `policy_events`. The only nondeterminism left in the
//! end-to-end path is whether the LLM actually emits a
//! `request_review` action at runtime — that's what this bridge
//! removes.
//!
//! What it does:
//!   1. Inserts a synthetic `persona_executions` row (is_simulation =
//!      true) so the FK on `persona_manual_reviews.execution_id` and
//!      `policy_events.execution_id` resolves cleanly.
//!   2. Inserts the manual_review row exactly as
//!      `dispatch::ProtocolMessage::ManualReview` would.
//!   3. Spawns `auto_triage::spawn_evaluator_task` directly. The
//!      capability's `review_policy.mode` is intentionally NOT
//!      consulted — caller specified the desired flow by invoking this
//!      command.
//!
//! What it does NOT cover (intentionally):
//!   - Dispatch's policy lookup (off / trust_llm / auto_triage / on).
//!     Those branches are unit-tested in `engine::dispatch::tests`.
//!   - Quality-gate review filtering. Same — unit-tested.
//!
//! Audit-tag note: the spawned evaluator records to `policy_events` with
//! the same `review.auto_triage.{approved,rejected,fallback}` kind as
//! the production dispatch path. The Phase D2 driver reads them via
//! `getPolicyEventsForExecution(execution_id)`.

use std::sync::Arc;
use tauri::State;

use crate::db::models::CreateManualReviewInput;
use crate::db::repos::communication::manual_reviews as review_repo;
use crate::db::repos::execution::executions as execution_repo;
use crate::engine::auto_triage::{spawn_evaluator_task, SpawnedEvaluatorContext};
use crate::error::AppError;
use crate::AppState;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Result returned to the test bridge — identifiers it needs to poll.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizedManualReview {
    pub review_id: String,
    pub execution_id: String,
}

/// Synthesize a `manual_review` row + spawn the auto_triage evaluator
/// against an already-promoted persona, with no execution required.
///
/// Caller responsibility: persona must already exist (typically a
/// promoted Phase-D-style persona with `review_policy.mode =
/// "auto_triage"`). The command does not validate that the persona's
/// design actually has auto_triage — the evaluator runs unconditionally
/// because that's the deterministic shape we want for E2E tests.
#[tauri::command]
pub async fn synthesize_manual_review(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    use_case_id: Option<String>,
    title: String,
    description: Option<String>,
    severity: Option<String>,
    context_data: Option<String>,
    suggested_actions: Option<Vec<String>>,
) -> Result<SynthesizedManualReview, AppError> {
    // No auth gate — the command is only compiled in under the
    // `test-automation` feature, so prod builds don't carry it. The
    // surrounding harness is responsible for not exposing the bridge
    // server outside dev/test.

    if title.trim().is_empty() {
        return Err(AppError::Validation(
            "synthesize_manual_review: title must not be empty".into(),
        ));
    }

    // 1. Synthetic persona_executions row. Marked as a simulation so
    //    background metric jobs / activity feeds filter it out.
    let synthetic_input = serde_json::json!({
        "_synthetic": true,
        "source": "bridge::synthesize_manual_review",
        "persona_id": persona_id,
        "use_case_id": use_case_id,
    })
    .to_string();

    let execution = execution_repo::create_with_idempotency(
        &state.db,
        &persona_id,
        /* trigger_id */ None,
        Some(synthetic_input),
        /* model_used */ None,
        use_case_id.clone(),
        /* idempotency_key */ None,
        /* is_simulation */ true,
    )?;

    // Land it as `completed` so the row looks like a finished run from
    // any reader's perspective (audit dashboards, retention sweeps,
    // etc.). Manual_reviews / policy_events join in fine either way —
    // this is purely cosmetic.
    let now = chrono::Utc::now().to_rfc3339();
    {
        let conn = state.db.get()?;
        conn.execute(
            "UPDATE persona_executions
                SET status        = 'completed',
                    started_at    = COALESCE(started_at, ?2),
                    completed_at  = ?2
              WHERE id = ?1",
            rusqlite::params![&execution.id, &now],
        )?;
    }

    // 2. Manual_review row — same shape as
    //    `dispatch::ProtocolMessage::ManualReview` would land.
    let suggested_actions_json = suggested_actions
        .as_ref()
        .map(|a| serde_json::json!(a).to_string());

    let review = review_repo::create(
        &state.db,
        CreateManualReviewInput {
            execution_id: execution.id.clone(),
            persona_id: persona_id.clone(),
            title: title.clone(),
            description: description.clone(),
            severity: severity.clone(),
            context_data: context_data.clone(),
            suggested_actions: suggested_actions_json.clone(),
            use_case_id: use_case_id.clone(),
        },
    )?;

    // 3. Fire the evaluator. The task is fully self-contained — it
    //    loads `persona.last_design_result` itself (so a missing one
    //    falls back to the empty-principles path inside the
    //    evaluator), runs Claude CLI, and finalises the review row +
    //    policy_events.
    spawn_evaluator_task(SpawnedEvaluatorContext {
        pool: state.db.clone(),
        review_id: review.id.clone(),
        execution_id: execution.id.clone(),
        persona_id,
        use_case_id,
        review_title: title,
        review_description: description,
        review_severity: severity,
        review_context_data: context_data,
        review_suggested_actions: suggested_actions_json,
    });

    tracing::info!(
        review_id = %review.id,
        execution_id = %execution.id,
        "synthesize_manual_review: review row + evaluator spawned"
    );

    Ok(SynthesizedManualReview {
        review_id: review.id,
        execution_id: execution.id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // The full command requires Tauri runtime + DB + Claude CLI, which
    // makes meaningful end-to-end coverage E2E-driver territory (Phase
    // D2). The pure-function surface here is just the input-validation
    // edge case + the result struct shape.

    #[test]
    fn synthesized_manual_review_round_trips_through_serde() {
        let r = SynthesizedManualReview {
            review_id: "rev_123".into(),
            execution_id: "exec_456".into(),
        };
        let raw = serde_json::to_string(&r).unwrap();
        assert!(raw.contains("\"reviewId\""), "got {raw}");
        assert!(raw.contains("\"executionId\""), "got {raw}");
        let r2: SynthesizedManualReview = serde_json::from_str(&raw).unwrap();
        assert_eq!(r2.review_id, "rev_123");
        assert_eq!(r2.execution_id, "exec_456");
    }
}
