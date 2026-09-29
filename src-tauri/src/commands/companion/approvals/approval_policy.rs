//! `approval_policy` — part of the approval module family. The **standing
//! policy** arm: a kp gig-persona hire approved on the operator's behalf
//! because it lies entirely inside the operator's gig persona policy
//! (`personas_db::kp_gig_policy`, settings key `kp.gig_persona_policy`).
//!
//! `kp_hire_request` is otherwise never approved without a human
//! (`approval_autopilot` does not list it). This module is the second narrow
//! exception after the headless bridge, and unlike that one it is not a test
//! mode: the operator wrote the bound, once, in Settings, and a request is
//! decided here only when the management API's intake found it inside every
//! condition of that bound.
//!
//! # Not a second decision path
//!
//! It claims the row through the same `pending` → `running` compare-and-swap
//! the Approve click, the operator API and the headless bridge use
//! ([`claim_pending`]), and then runs [`execute_claimed`] — the executor table,
//! finalize and episode log that [`approve_claimed`] runs for a click. So the
//! draft persona, its build, the placement filing and the per-persona execute
//! grant for the submitting key (`kp_execute_grant::grant_on_hire_approval`,
//! which reads the key off THIS row) are exactly what an operator approval
//! produces. The one thing left out is Athena's reaction turn: nobody clicked.
//!
//! # The actor
//!
//! Like the operator API and the headless bridge, the decision is recorded in
//! the row's payload: `decidedBy: "policy:kp.gig_persona_policy"`, `decidedAt`,
//! and a `decisionNote` naming the policy — stamped after the claim and before
//! the executor, so a row that dies mid-flight already names who decided it.

#[allow(unused_imports)]
use super::*;

use personas_db::kp_gig_policy::POLICY_ACTOR;

/// What a policy approval did, for the intake response.
#[derive(Debug)]
pub(crate) struct PolicyHireOutcome {
    /// `approved` | `approved_failed`.
    pub(crate) status: String,
    pub(crate) message: String,
    /// The row's `result` stamp (`personaId`, `personaName`, `buildSessionId`)
    /// when the executor wrote one.
    pub(crate) result: Option<serde_json::Value>,
}

const POLICY_NOTE: &str =
    "auto-approved: the request lies inside the operator's gig persona policy (kp.gig_persona_policy)";

/// Claim a freshly-inserted `kp_hire_request` for the policy and stamp the
/// actor. Split out so the claim and the stamp are testable without an
/// `AppHandle`. Refuses any other action (the row is then left `approved_failed`
/// by the caller, never silently decided).
pub(crate) fn claim_for_policy(
    user_db: &crate::db::UserDbPool,
    approval_id: &str,
) -> Result<(String, serde_json::Value), AppError> {
    let (action, params) = claim_pending(user_db, approval_id).map_err(|e| match e {
        ClaimError::NotFound => AppError::NotFound(format!("approval `{approval_id}`")),
        ClaimError::NotPending(s) => {
            AppError::Internal(format!("approval `{approval_id}` is `{s}`, not pending"))
        }
        ClaimError::Expired => AppError::Internal(format!("approval `{approval_id}` expired")),
        ClaimError::Corrupt(m) => AppError::Internal(m),
        ClaimError::Store(e) => e,
    })?;
    if action != "kp_hire_request" {
        return Err(AppError::Internal(format!(
            "the gig persona policy refuses action `{action}` — it decides `kp_hire_request` only"
        )));
    }
    stamp_decision(user_db, approval_id, POLICY_ACTOR, Some(POLICY_NOTE))?;
    Ok((action, params))
}

/// Approve a pending `kp_hire_request` on the operator's behalf. The caller
/// (the management API's intake) must already have found the request inside
/// the policy (`kp_gig_policy::evaluate_request`).
pub(crate) async fn policy_approve_kp_hire(
    app: &tauri::AppHandle,
    approval_id: &str,
) -> Result<PolicyHireOutcome, AppError> {
    let state = app.state::<Arc<AppState>>();
    let (action, params) = match claim_for_policy(&state.user_db, approval_id) {
        Ok(v) => v,
        Err(e) => {
            // A row we claimed but refused must not sit `running` forever.
            let _ = finalize_approval(&state, approval_id, APPROVAL_STATUS_APPROVED_FAILED);
            return Err(e);
        }
    };
    tracing::info!(
        approval_id,
        actor = POLICY_ACTOR,
        "gig persona policy: approving a kp hire request on the operator's behalf"
    );
    let outcome = execute_claimed(&state, app, approval_id.to_string(), &action, &params).await?;
    let result = result_stamp(&state.user_db, approval_id);
    Ok(PolicyHireOutcome {
        status: outcome.status,
        message: outcome.message,
        result,
    })
}

// Tests live in `engine::management_api::kp_gig::tests` (the policy's claim,
// its actor stamp, and the execute grant it leads to): they read the approval
// row directly, which belongs outside the command tree.
