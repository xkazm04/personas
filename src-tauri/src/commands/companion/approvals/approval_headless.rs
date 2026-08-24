//! `approval_headless` — part of the approval module family. The **headless
//! bridge** (test mode) arm: a kp hire request that fires itself.
//!
//! `kp_hire_request` is deliberately NOT autopilot-eligible
//! (`approval_autopilot`): an external app must never be able to create a
//! persona without a human click. This module is the one, loudly-gated
//! exception, for the unattended test loop described in
//! `docs/architecture/cloud-integration-bridge.md` §13. It runs **only** while
//! `personas_engine::headless::enabled()` — a latched read of
//! `PERSONAS_HEADLESS_BRIDGE=1` at process start.
//!
//! # What it does NOT do
//!
//! It does not fork the executor. `execute_kp_hire_request` is called through
//! `execute_approval_action` — the same shared table both consent paths use —
//! so the headless mode changes *whether a human clicks*, never *what the
//! action does*. Everything downstream (draft persona, one-shot build, App
//! master binding, partial-success notes, the kp lifecycle push) is byte for
//! byte the human path, and a failure lands on `approved_failed` exactly as a
//! failed human approval does, so kp's poll reads `failed` rather than
//! `rejected`.
//!
//! # The actor
//!
//! `companion_approval` has no `decided_by` column, so the actor is merged into
//! the row's own payload as `decidedBy` / `decidedAt`. Recording it is not
//! decoration: an approval row that says `approved` with nothing else on it
//! claims a human looked at this hire. Nobody did.

#[allow(unused_imports)]
use super::*;

use personas_engine::headless;

/// What the headless auto-approval did, for the intake response.
pub(crate) struct HeadlessHireOutcome {
    /// `approved` | `approved_failed`.
    pub(crate) status: &'static str,
    pub(crate) message: String,
}

/// Execute a freshly-inserted `kp_hire_request` immediately, with no human in
/// the loop. Caller must have checked [`headless::enabled`].
pub(crate) async fn auto_execute_kp_hire(
    app: &tauri::AppHandle,
    approval_id: &str,
) -> Result<HeadlessHireOutcome, AppError> {
    let state = app.state::<Arc<AppState>>();

    // Same atomic pending→running transition the manual click uses, including
    // its consent-freshness refusal. Stamped BEFORE the executor runs so a row
    // that is mid-flight (or that crashes mid-flight) already names its actor.
    stamp_headless_actor(&state, approval_id)?;
    let (action, params) = load_pending(&state, approval_id)?;
    if action != "kp_hire_request" {
        // The caller inserted the row moments ago; anything else here means a
        // caller wired this to the wrong action. Refuse rather than widen the
        // exception to every approval kind.
        finalize_approval(&state, approval_id, APPROVAL_STATUS_APPROVED_FAILED)?;
        return Err(AppError::Internal(format!(
            "headless bridge auto-approval refuses action `{action}` — it exists for \
             `kp_hire_request` only"
        )));
    }

    tracing::warn!(
        approval_id,
        actor = headless::ACTOR,
        "HEADLESS BRIDGE: executing a kp hire request with NO human approval"
    );

    let exec_result =
        execute_approval_action(state.clone(), app.clone(), approval_id, &action, &params).await;
    let (status, message) = match exec_result {
        Ok(r) => (APPROVAL_STATUS_APPROVED, r.message),
        Err(e) => {
            tracing::warn!(error = %e, "headless bridge: auto-approved kp hire failed");
            (
                APPROVAL_STATUS_APPROVED_FAILED,
                format!("kp hire request failed under the headless bridge: {e}"),
            )
        }
    };
    finalize_approval(&state, approval_id, status)?;
    log_action_episode(&state, &action, &message).await;

    Ok(HeadlessHireOutcome { status, message })
}

/// Merge `{decidedBy, decidedAt}` into the approval row's payload.
///
/// Read-modify-write in Rust rather than SQLite's `json_set`, matching
/// `stamp_kp_request_result` — one spelling of "merge into this payload" in
/// this module family.
fn stamp_headless_actor(
    state: &State<'_, Arc<AppState>>,
    approval_id: &str,
) -> Result<(), AppError> {
    let conn = state.user_db.get()?;
    let payload: Option<String> = conn
        .query_row(
            "SELECT payload FROM companion_approval WHERE id = ?1",
            params![approval_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(payload) = payload else {
        return Err(AppError::Internal(format!(
            "approval `{approval_id}` not found"
        )));
    };
    let mut v: serde_json::Value = serde_json::from_str(&payload)
        .map_err(|e| AppError::Internal(format!("payload parse: {e}")))?;
    headless::stamp_actor(&mut v, &chrono::Utc::now().to_rfc3339());
    conn.execute(
        "UPDATE companion_approval SET payload = ?2 WHERE id = ?1",
        params![approval_id, v.to_string()],
    )?;
    Ok(())
}
