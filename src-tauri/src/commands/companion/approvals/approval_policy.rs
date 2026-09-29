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
    let result = {
        let conn = state.user_db.get()?;
        conn.query_row(
            "SELECT payload FROM companion_approval WHERE id = ?1",
            params![approval_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .and_then(|p| serde_json::from_str::<serde_json::Value>(&p).ok())
        .and_then(|v| v.get("result").cloned())
    };
    Ok(PolicyHireOutcome {
        status: outcome.status,
        message: outcome.message,
        result,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pools() -> (crate::db::DbPool, crate::db::UserDbPool) {
        (
            crate::db::init_test_db().expect("app pool"),
            crate::db::init_test_user_db().expect("user pool"),
        )
    }

    fn kp_key(pool: &crate::db::DbPool) -> String {
        crate::db::repos::resources::external_api_keys::create(
            pool,
            "kp (paired)",
            vec!["personas:read".into(), "personas:build".into()],
            None,
            Some("http://localhost:3000".into()),
            None,
        )
        .expect("key")
        .record
        .id
    }

    fn insert(user_db: &crate::db::UserDbPool, id: &str, key: &str) {
        crate::engine::management_api::insert_kp_hire_approval(
            user_db,
            id,
            &serde_json::json!({"requestId": id, "fit": {"kind": "kp.gig-persona.v1"}}),
            "KP job 'gig' requests an AI hire",
            Some(key),
        )
        .expect("insert");
    }

    fn row(user_db: &crate::db::UserDbPool, id: &str) -> (String, serde_json::Value) {
        let conn = user_db.get().unwrap();
        let (status, payload): (String, String) = conn
            .query_row(
                "SELECT status, payload FROM companion_approval WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        (status, serde_json::from_str(&payload).unwrap())
    }

    #[test]
    fn the_policy_claims_the_row_and_names_itself_as_the_decider() {
        let (pool, user_db) = pools();
        let key = kp_key(&pool);
        insert(&user_db, "appr_pol1", &key);

        let (action, params) = claim_for_policy(&user_db, "appr_pol1").expect("claim");
        assert_eq!(action, "kp_hire_request");
        assert_eq!(params["requestId"], "appr_pol1");
        let (status, payload) = row(&user_db, "appr_pol1");
        assert_eq!(status, "running", "the same CAS every decision path takes");
        assert_eq!(payload["decidedBy"], POLICY_ACTOR);
        assert!(payload["decisionNote"]
            .as_str()
            .unwrap()
            .contains("gig persona policy"));

        // Exactly one decider wins: a second claim (a click racing the policy) loses.
        assert!(claim_for_policy(&user_db, "appr_pol1").is_err());
    }

    /// The executor grants through `grant_on_hire_approval(approval_id)`, which
    /// reads the submitter off the row. The policy's claim and stamp leave that
    /// column alone, so the grant is the one an operator approval issues: this
    /// key, this persona, this exact scope.
    #[test]
    fn a_policy_approval_leads_to_the_same_execute_grant_as_an_operator_approval() {
        let (pool, user_db) = pools();
        let key = kp_key(&pool);
        insert(&user_db, "appr_pol2", &key);
        claim_for_policy(&user_db, "appr_pol2").expect("claim");

        let grant = personas_engine::kp_execute_grant::grant_on_hire_approval(
            &pool,
            &user_db,
            "appr_pol2",
            "persona-gig-1",
        );
        assert_eq!(
            grant,
            personas_engine::kp_execute_grant::HireGrant::Granted {
                key_id: key.clone(),
                scope: "personas:execute:persona:persona-gig-1".into(),
            }
        );

        // And the operator path on a sibling row produces the identical grant shape.
        insert(&user_db, "appr_op", &key);
        claim_pending(&user_db, "appr_op").expect("operator claim");
        stamp_decision(&user_db, "appr_op", &operator_actor("op-key"), None).unwrap();
        assert_eq!(
            personas_engine::kp_execute_grant::grant_on_hire_approval(
                &pool,
                &user_db,
                "appr_op",
                "persona-gig-2"
            ),
            personas_engine::kp_execute_grant::HireGrant::Granted {
                key_id: key,
                scope: "personas:execute:persona:persona-gig-2".into(),
            }
        );
    }

    #[test]
    fn the_policy_refuses_any_other_action() {
        let (_pool, user_db) = pools();
        let conn = user_db.get().unwrap();
        conn.execute(
            "INSERT INTO companion_approval (id, session_id, kind, payload, status, created_at)
             VALUES ('appr_other', 'default', 'op_execute',
                     '{\"action\":\"run_persona\",\"params\":{}}', 'pending', datetime('now'))",
            [],
        )
        .unwrap();
        drop(conn);
        let err = claim_for_policy(&user_db, "appr_other").unwrap_err();
        assert!(err.to_string().contains("kp_hire_request only"), "{err}");
    }
}
