//! `review_decide` from a paired phone: approve or reject one manual review
//! (PHASE2-SPEC 1.6 and 2.2; owner decision M20, 2026-10-07).
//!
//! The decision runs through the desk's own resolution,
//! `commands::design::reviews::resolve_manual_review` - the body behind the
//! desk's Approve / Reject - so a phone decision writes the status and its
//! learned memory and fires every side effect a desk decision does (the
//! resolved event, the `review_decision.*` bus event, the team-channel
//! bridge, the goal signal, App master probation and ask reactions, the
//! held-team-step resume loop). A verb that only wrote the status would leave
//! a held team step blocked and teach the fleet nothing.
//!
//! # The contract (what the web signs and what it gets back)
//!
//! * Row: `command_type = 'review_decide'`, `persona_id` = the REVIEW's
//!   persona, and the envelope's `"persona"` the same id.
//! * `params` = `{"reviewId": "...", "decision": "approved" | "rejected",
//!   "notes": "..." | null}`, read from the SIGNED envelope.
//! * `decision`: exactly one of the two, else `invalid_decision`. `notes`: a
//!   string of at most [`MAX_NOTES_CHARS`] characters, or null / absent, else
//!   `invalid_notes`; blank notes are no notes. A `reviewId` of the wrong JSON
//!   type is `bad_params`.
//! * The review exists here AND its `persona_id` equals the envelope's, else
//!   `not_found` - the same answer for both, so a phone never learns that an
//!   id exists under another persona.
//! * Already decided (any status but `pending`): `completed` with
//!   `{"reviewId", "status": <current>, "changed": false}` and no side
//!   effects, the same rule as an already-terminal cancel. A decision that
//!   loses the race to another one (the desk, Athena) in the instant between
//!   the check and the write answers the same way.
//! * Decided here: `completed` with `{"reviewId", "status", "changed": true}`,
//!   and the cloud sync is nudged so `synced_manual_reviews` shows the new
//!   status at the next pass instead of the next periodic tick.
//!
//! Out of v1: choosing one of the review's suggested actions (the desk's
//! `dispatch_review_action`, which also starts a follow-up run).

use serde_json::{json, Value};

use crate::cloud::remote_commands::{Effective, Outcome};
use crate::db::models::{ManualReviewStatus, PersonaManualReview};
use crate::db::repos::communication::manual_reviews as manual_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// The longest reviewer note a phone may send, in characters (PHASE2-SPEC 2.2).
pub const MAX_NOTES_CHARS: usize = 2000;

/// What `review_decide` will do, decided from the database alone.
#[derive(Debug, Clone, PartialEq)]
pub enum ReviewDecidePlan {
    /// Already decided: completed with `changed:false`, nothing to run.
    Settled(Outcome),
    /// Still pending: resolve it through the shared chokepoint.
    Decide {
        review_id: String,
        status: ManualReviewStatus,
        notes: Option<String>,
    },
}

/// Every precondition of the contract above, from the database alone.
pub fn plan(pool: &DbPool, cmd: &Effective) -> Result<ReviewDecidePlan, AppError> {
    let status = match cmd.params.get("decision").and_then(Value::as_str) {
        Some("approved") => ManualReviewStatus::Approved,
        Some("rejected") => ManualReviewStatus::Rejected,
        _ => return Err(AppError::Validation("invalid_decision".into())),
    };
    let notes = match cmd.params.get("notes") {
        None | Some(Value::Null) => None,
        Some(Value::String(n)) if n.chars().count() <= MAX_NOTES_CHARS => {
            Some(n.trim().to_string())
        }
        Some(_) => return Err(AppError::Validation("invalid_notes".into())),
    };
    let review_id = match cmd.params.get("reviewId") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(id)) => id.clone(),
        Some(_) => return Err(AppError::Validation("bad_params".into())),
    };
    // A missing id, an unknown one and another persona's are one answer.
    let not_found = || AppError::NotFound(format!("Manual review {review_id}"));
    if review_id.trim().is_empty() {
        return Err(not_found());
    }
    let review = match manual_repo::get_by_id(pool, &review_id) {
        Ok(r) => r,
        Err(AppError::NotFound(_)) => return Err(not_found()),
        Err(e) => return Err(e),
    };
    if cmd.persona_id.as_deref() != Some(review.persona_id.as_str()) {
        return Err(not_found());
    }
    if review.status != ManualReviewStatus::Pending {
        return Ok(ReviewDecidePlan::Settled(outcome(&review, false)));
    }
    Ok(ReviewDecidePlan::Decide {
        review_id,
        status,
        // Blank notes are no notes (the chokepoint keeps any existing ones).
        notes: notes.filter(|n| !n.is_empty()),
    })
}

/// The `completed` result for `review` as it now stands.
pub fn outcome(review: &PersonaManualReview, changed: bool) -> Outcome {
    Outcome {
        result: json!({
            "reviewId": review.id,
            "status": review.status.as_str(),
            "changed": changed,
        }),
        execution_id: None,
        result_ref: Some(review.id.clone()),
    }
}

/// Plan, then decide through `resolve` (the app passes the whole resolution,
/// the tests its database half).
pub fn execute(
    pool: &DbPool,
    cmd: &Effective,
    resolve: impl FnOnce(
        &str,
        ManualReviewStatus,
        Option<String>,
    ) -> Result<PersonaManualReview, AppError>,
) -> Result<Outcome, AppError> {
    let (review_id, status, notes) = match plan(pool, cmd)? {
        ReviewDecidePlan::Settled(o) => return Ok(o),
        ReviewDecidePlan::Decide {
            review_id,
            status,
            notes,
        } => (review_id, status, notes),
    };
    match resolve(&review_id, status, notes) {
        Ok(review) => Ok(outcome(&review, true)),
        // Lost the chokepoint's compare-and-swap: another decision landed
        // between the plan and the write. Already decided, no side effects ran.
        Err(e) => match manual_repo::get_by_id(pool, &review_id) {
            Ok(now) if now.status != ManualReviewStatus::Pending => Ok(outcome(&now, false)),
            // Gone since the plan (the desk's Clear all, a persona delete).
            Err(AppError::NotFound(_)) => {
                Err(AppError::NotFound(format!("Manual review {review_id}")))
            }
            _ => Err(closed(e)),
        },
    }
}

/// A resolution failure as the command row may carry it. `failure_message`
/// copies a `Validation` text verbatim, and the chokepoint's texts are prose
/// with the review id in them ("Manual review <id> was already resolved ...",
/// "Invalid status transition: ..."), so they leave as `internal_error`.
fn closed(e: AppError) -> AppError {
    match e {
        AppError::Validation(m) => AppError::Internal(m),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::communication::manual_reviews::UnanchoredReviewInput;

    fn cmd(persona: &str, params: Value) -> Effective {
        Effective {
            id: "c1".into(),
            command_type: "review_decide".into(),
            persona_id: Some(persona.into()),
            params,
            prompt: None,
        }
    }

    fn persona(pool: &DbPool, name: &str) -> String {
        crate::db::repos::core::personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "You are a test persona.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    /// A persona with one pending review.
    fn setup() -> (DbPool, String, String) {
        let pool = crate::db::init_test_db().unwrap();
        let p = persona(&pool, "Reviewed persona");
        let review = manual_repo::create_unanchored(
            &pool,
            UnanchoredReviewInput {
                persona_id: &p,
                title: "Publish the weekly digest?",
                description: None,
                severity: "info",
                context_data: None,
            },
        )
        .unwrap();
        (pool, p, review.id)
    }

    fn reason(r: Result<ReviewDecidePlan, AppError>) -> String {
        match r {
            Err(AppError::Validation(m)) => m,
            Err(AppError::NotFound(_)) => "not_found".into(),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_pending_review_plans_the_decision_with_trimmed_notes() {
        let (pool, p, r) = setup();
        let plan = plan(
            &pool,
            &cmd(
                &p,
                json!({ "reviewId": r, "decision": "rejected", "notes": "  not this week  " }),
            ),
        )
        .unwrap();
        assert_eq!(
            plan,
            ReviewDecidePlan::Decide {
                review_id: r.clone(),
                status: ManualReviewStatus::Rejected,
                notes: Some("not this week".into()),
            }
        );
        let blank = plan_of(
            &pool,
            &p,
            json!({ "reviewId": r, "decision": "approved", "notes": "   " }),
        );
        assert_eq!(
            blank,
            ReviewDecidePlan::Decide {
                review_id: r.clone(),
                status: ManualReviewStatus::Approved,
                notes: None,
            },
            "blank notes are no notes"
        );
        let none = plan_of(&pool, &p, json!({ "reviewId": r, "decision": "approved" }));
        assert!(matches!(none, ReviewDecidePlan::Decide { notes: None, .. }));
    }

    fn plan_of(pool: &DbPool, p: &str, params: Value) -> ReviewDecidePlan {
        plan(pool, &cmd(p, params)).unwrap()
    }

    #[test]
    fn the_params_refuse_with_their_tokens() {
        let (pool, p, r) = setup();
        let send = |v: Value| reason(plan(&pool, &cmd(&p, v)));
        for bad in [
            json!("resolved"),
            json!("pending"),
            json!("APPROVED"),
            json!(1),
            Value::Null,
        ] {
            assert_eq!(
                send(json!({ "reviewId": r, "decision": bad })),
                "invalid_decision",
                "{bad}"
            );
        }
        assert_eq!(send(json!({ "reviewId": r })), "invalid_decision");
        assert_eq!(
            send(
                json!({ "reviewId": r, "decision": "approved", "notes": "x".repeat(MAX_NOTES_CHARS + 1) })
            ),
            "invalid_notes"
        );
        // The bound is characters, not bytes: 2000 two-byte characters pass.
        assert!(plan(
            &pool,
            &cmd(&p, json!({ "reviewId": r, "decision": "approved", "notes": "é".repeat(MAX_NOTES_CHARS) }))
        )
        .is_ok());
        assert_eq!(
            send(json!({ "reviewId": r, "decision": "approved", "notes": 7 })),
            "invalid_notes"
        );
        assert_eq!(
            send(json!({ "reviewId": 5, "decision": "approved" })),
            "bad_params"
        );
    }

    #[test]
    fn an_unknown_review_or_another_personas_is_not_found() {
        let (pool, p, r) = setup();
        let other = persona(&pool, "Someone else");
        let send = |persona: &str, v: Value| reason(plan(&pool, &cmd(persona, v)));
        assert_eq!(
            send(
                &p,
                json!({ "reviewId": "no-such-review", "decision": "approved" })
            ),
            "not_found"
        );
        assert_eq!(send(&p, json!({ "decision": "approved" })), "not_found");
        assert_eq!(
            send(&other, json!({ "reviewId": r, "decision": "approved" })),
            "not_found",
            "a review of another persona answers exactly like a missing one"
        );
        let mut no_persona = cmd(&p, json!({ "reviewId": r, "decision": "approved" }));
        no_persona.persona_id = None;
        assert_eq!(reason(plan(&pool, &no_persona)), "not_found");
    }

    #[test]
    fn an_already_decided_review_is_settled_with_its_current_status() {
        let (pool, p, r) = setup();
        manual_repo::update_status(&pool, &r, ManualReviewStatus::Rejected, None).unwrap();
        let plan = plan_of(&pool, &p, json!({ "reviewId": r, "decision": "approved" }));
        let ReviewDecidePlan::Settled(o) = plan else {
            panic!("settled: {plan:?}")
        };
        assert_eq!(
            o.result,
            json!({ "reviewId": r, "status": "rejected", "changed": false })
        );
    }

    /// The desk (or Athena) decides in the instant between the plan and the
    /// write: the chokepoint's compare-and-swap refuses ours, and the command
    /// reports the decision that stands instead of failing.
    #[test]
    fn a_decision_that_loses_the_race_is_settled_not_failed() {
        let (pool, p, r) = setup();
        let o = execute(
            &pool,
            &cmd(&p, json!({ "reviewId": r, "decision": "approved" })),
            |id, _, _| {
                manual_repo::update_status(&pool, id, ManualReviewStatus::Rejected, None)?;
                Err(AppError::Validation("lost the compare-and-swap".into()))
            },
        )
        .unwrap();
        assert_eq!(
            o.result,
            json!({ "reviewId": r, "status": "rejected", "changed": false })
        );
    }

    /// A resolution error never reaches the command row as prose: the
    /// chokepoint's lost compare-and-swap text names the review id, and
    /// `failure_message` copies a `Validation` verbatim.
    #[test]
    fn a_resolution_error_leaves_as_a_closed_token() {
        let (pool, p, r) = setup();
        let cas_text = format!("Manual review {r} was already resolved by a concurrent action");
        // Still pending: the error is `internal_error`, not the chokepoint's text.
        let e = execute(
            &pool,
            &cmd(&p, json!({ "reviewId": r, "decision": "approved" })),
            |_, _, _| Err(AppError::Validation(cas_text.clone())),
        )
        .unwrap_err();
        assert!(matches!(e, AppError::Internal(_)), "{e:?}");
        // Decided and then deleted before the re-read: `not_found`.
        let e = execute(
            &pool,
            &cmd(&p, json!({ "reviewId": r, "decision": "approved" })),
            |_, _, _| {
                manual_repo::delete_all(&pool)?;
                Err(AppError::Validation(cas_text.clone()))
            },
        )
        .unwrap_err();
        assert!(matches!(e, AppError::NotFound(_)), "{e:?}");
    }

    /// A resolution that fails with the review still pending is a failure.
    #[test]
    fn a_failed_resolution_of_a_still_pending_review_fails() {
        let (pool, p, r) = setup();
        let e = execute(
            &pool,
            &cmd(&p, json!({ "reviewId": r, "decision": "approved" })),
            |_, _, _| Err(AppError::Internal("disk full".into())),
        )
        .unwrap_err();
        assert!(matches!(e, AppError::Internal(_)), "{e:?}");
    }
}
