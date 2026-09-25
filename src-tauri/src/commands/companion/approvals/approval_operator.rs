//! `approval_operator` — part of the approval module family. The **operator
//! API** arm: the local operator deciding a pending approval over HTTP
//! (`POST /api/approvals/{id}/approve|reject`, scope `personas:approve`, held
//! only by the file-delivered `operator-local` key — see
//! `personas_db::operator_key`).
//!
//! It is not a second decision path. It claims the row through the same
//! `pending` → `running` compare-and-swap ([`claim_pending`]) and then runs the
//! very functions the inbox buttons run ([`approve_claimed`] /
//! [`reject_claimed`]), so an operator-API approval of a kp hire creates the
//! persona, grants kp its execute scope, starts the build and pushes the
//! lifecycle event exactly as a click does — and Athena reacts to it the same
//! way. What it adds is the one thing a click cannot say about itself: WHO
//! decided. `companion_approval` has no `decided_by` column, so — exactly like
//! the headless bridge (`approval_headless`) — the actor is merged into the
//! row's payload as `decidedBy: "operator-api:<key id>"` + `decidedAt`, with
//! the operator's note or reason as `decisionNote`. The UI click records no
//! actor at all today; a row without `decidedBy` is a human click.

#[allow(unused_imports)]
use super::*;

/// The actor string recorded for an operator-API decision.
pub(crate) fn operator_actor(key_id: &str) -> String {
    format!("operator-api:{key_id}")
}

/// Why an operator decision did not happen.
#[derive(Debug)]
pub(crate) enum OperatorDecisionError {
    /// No approval row with that id.
    NotFound,
    /// Already decided, in flight, or expired — carries what it is instead.
    NotPending(String),
    /// Claimed (or failed to claim) with a store/runtime error.
    Failed(AppError),
}

/// What an operator decision did, plus the row's `result` stamp (a kp hire's
/// `personaId` / `buildSessionId`) when the executor wrote one.
#[derive(Debug)]
pub(crate) struct OperatorDecision {
    pub(crate) action: String,
    pub(crate) outcome: ApprovalOutcome,
    pub(crate) result: Option<serde_json::Value>,
}

fn claim_for_operator(
    user_db: &crate::db::UserDbPool,
    approval_id: &str,
) -> Result<(String, serde_json::Value), OperatorDecisionError> {
    claim_pending(user_db, approval_id).map_err(|e| match e {
        ClaimError::NotFound => OperatorDecisionError::NotFound,
        ClaimError::NotPending(status) => OperatorDecisionError::NotPending(status),
        ClaimError::Expired => OperatorDecisionError::NotPending("expired".into()),
        ClaimError::Corrupt(m) => OperatorDecisionError::Failed(AppError::Internal(m)),
        ClaimError::Store(e) => OperatorDecisionError::Failed(e),
    })
}

/// Merge `{decidedBy, decidedAt, decisionNote?}` into a row's payload.
/// Read-modify-write in Rust, the same spelling `stamp_kp_request_result`
/// and the headless actor stamp use.
pub(crate) fn stamp_decision(
    user_db: &crate::db::UserDbPool,
    approval_id: &str,
    actor: &str,
    note: Option<&str>,
) -> Result<(), AppError> {
    let conn = user_db.get()?;
    let payload: Option<String> = conn
        .query_row(
            "SELECT payload FROM companion_approval WHERE id = ?1",
            params![approval_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(payload) = payload else {
        return Err(AppError::NotFound(format!("approval `{approval_id}`")));
    };
    let mut v: serde_json::Value = serde_json::from_str(&payload)
        .map_err(|e| AppError::Internal(format!("payload parse: {e}")))?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert("decidedBy".into(), serde_json::Value::String(actor.into()));
        obj.insert(
            "decidedAt".into(),
            serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
        );
        if let Some(n) = note.map(str::trim).filter(|n| !n.is_empty()) {
            obj.insert("decisionNote".into(), serde_json::Value::String(n.into()));
        }
    }
    conn.execute(
        "UPDATE companion_approval SET payload = ?2 WHERE id = ?1",
        params![approval_id, v.to_string()],
    )?;
    Ok(())
}

fn result_stamp(user_db: &crate::db::UserDbPool, approval_id: &str) -> Option<serde_json::Value> {
    let conn = user_db.get().ok()?;
    let payload: String = conn
        .query_row(
            "SELECT payload FROM companion_approval WHERE id = ?1",
            params![approval_id],
            |r| r.get(0),
        )
        .ok()?;
    serde_json::from_str::<serde_json::Value>(&payload)
        .ok()?
        .get("result")
        .cloned()
}

/// Approve on the operator's behalf. Same claim, same executor, same finalize
/// as the inbox's Approve button.
pub(crate) async fn operator_approve(
    app: &tauri::AppHandle,
    approval_id: &str,
    operator_key_id: &str,
    note: Option<&str>,
) -> Result<OperatorDecision, OperatorDecisionError> {
    let state = app.state::<Arc<AppState>>();
    let (action, params) = claim_for_operator(&state.user_db, approval_id)?;
    // Stamped after the claim (the row is ours now) and before the executor,
    // so a row that crashes mid-flight already names its actor.
    if let Err(e) = stamp_decision(
        &state.user_db,
        approval_id,
        &operator_actor(operator_key_id),
        note,
    ) {
        tracing::warn!(approval_id, error = %e, "operator api: could not stamp the actor");
    }
    tracing::info!(
        approval_id,
        action = %action,
        actor = %operator_actor(operator_key_id),
        "operator api: approving"
    );
    let outcome = approve_claimed(&state, app, approval_id.to_string(), &action, &params)
        .await
        .map_err(OperatorDecisionError::Failed)?;
    Ok(OperatorDecision {
        result: result_stamp(&state.user_db, approval_id),
        action,
        outcome,
    })
}

/// Reject on the operator's behalf. Same claim and the same reject function
/// as the inbox's Reject button (a kp hire's requester is notified).
pub(crate) async fn operator_reject(
    app: &tauri::AppHandle,
    approval_id: &str,
    operator_key_id: &str,
    reason: Option<&str>,
) -> Result<OperatorDecision, OperatorDecisionError> {
    let state = app.state::<Arc<AppState>>();
    let (action, params) = claim_for_operator(&state.user_db, approval_id)?;
    if let Err(e) = stamp_decision(
        &state.user_db,
        approval_id,
        &operator_actor(operator_key_id),
        reason,
    ) {
        tracing::warn!(approval_id, error = %e, "operator api: could not stamp the actor");
    }
    tracing::info!(
        approval_id,
        action = %action,
        actor = %operator_actor(operator_key_id),
        "operator api: rejecting"
    );
    let reason = reason
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(String::from);
    let outcome = reject_claimed(&state, approval_id.to_string(), &action, &params, reason)
        .await
        .map_err(OperatorDecisionError::Failed)?;
    Ok(OperatorDecision {
        result: None,
        action,
        outcome,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool() -> crate::db::UserDbPool {
        crate::db::init_test_user_db().expect("user pool")
    }

    fn insert(pool: &crate::db::UserDbPool, id: &str) {
        crate::engine::management_api::insert_kp_hire_approval(
            pool,
            id,
            &serde_json::json!({"spec": {"name": "Gig specialist"}, "requestId": id}),
            "KP job 'x' requests an AI hire",
            Some("key_kp"),
        )
        .unwrap();
    }

    fn status(pool: &crate::db::UserDbPool, id: &str) -> String {
        pool.get()
            .unwrap()
            .query_row(
                "SELECT status FROM companion_approval WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap()
    }

    /// The CAS: exactly one claim wins; a second — operator API or UI — is
    /// told the row is no longer pending, and an unknown id is NotFound.
    #[test]
    fn a_pending_row_can_be_claimed_exactly_once() {
        let pool = pool();
        insert(&pool, "appr_cas");
        let (action, params) = claim_for_operator(&pool, "appr_cas").expect("first claim");
        assert_eq!(action, "kp_hire_request");
        assert_eq!(params["spec"]["name"], "Gig specialist");
        assert_eq!(status(&pool, "appr_cas"), "running");

        match claim_for_operator(&pool, "appr_cas") {
            Err(OperatorDecisionError::NotPending(s)) => assert_eq!(s, "running"),
            other => panic!("expected NotPending, got {other:?}"),
        }
        assert!(matches!(
            claim_for_operator(&pool, "appr_nope"),
            Err(OperatorDecisionError::NotFound)
        ));
    }

    #[test]
    fn a_decided_or_expired_row_is_not_pending() {
        let pool = pool();
        insert(&pool, "appr_done");
        pool.get()
            .unwrap()
            .execute(
                "UPDATE companion_approval SET status = 'rejected' WHERE id = 'appr_done'",
                [],
            )
            .unwrap();
        match claim_for_operator(&pool, "appr_done") {
            Err(OperatorDecisionError::NotPending(s)) => assert_eq!(s, "rejected"),
            other => panic!("expected NotPending, got {other:?}"),
        }

        insert(&pool, "appr_old");
        pool.get()
            .unwrap()
            .execute(
                "UPDATE companion_approval SET created_at = datetime('now', '-3 days') WHERE id = 'appr_old'",
                [],
            )
            .unwrap();
        match claim_for_operator(&pool, "appr_old") {
            Err(OperatorDecisionError::NotPending(s)) => assert_eq!(s, "expired"),
            other => panic!("expected NotPending(expired), got {other:?}"),
        }
        assert_eq!(
            status(&pool, "appr_old"),
            "pending",
            "an expired row is not claimed"
        );
    }

    /// The actor lands in the payload beside the untouched params.
    #[test]
    fn the_operator_actor_is_stamped_into_the_payload() {
        let pool = pool();
        insert(&pool, "appr_actor");
        stamp_decision(
            &pool,
            "appr_actor",
            &operator_actor("key-123"),
            Some("  looks right "),
        )
        .unwrap();
        let payload: String = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT payload FROM companion_approval WHERE id = 'appr_actor'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(v["decidedBy"], "operator-api:key-123");
        assert!(v["decidedAt"].as_str().is_some());
        assert_eq!(v["decisionNote"], "looks right");
        assert_eq!(
            v["action"], "kp_hire_request",
            "the rest of the payload survives"
        );
        assert_eq!(v["params"]["spec"]["name"], "Gig specialist");
    }

    /// The operator list and the inbox read the same rows, and the operator
    /// sees who queued each one.
    #[test]
    fn the_shared_pending_read_carries_the_requesting_key() {
        let pool = pool();
        insert(&pool, "appr_list");
        let rows = pending_approval_rows(&pool).unwrap();
        let row = rows.iter().find(|r| r.id == "appr_list").expect("listed");
        assert_eq!(row.action, "kp_hire_request");
        assert_eq!(row.requested_by_key_id.as_deref(), Some("key_kp"));
        claim_for_operator(&pool, "appr_list").unwrap();
        assert!(pending_approval_rows(&pool)
            .unwrap()
            .iter()
            .all(|r| r.id != "appr_list"));
    }
}
