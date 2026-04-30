use rusqlite::params;

use crate::db::models::PolicyEvent;
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mapper -----------------------------------------------

row_mapper!(row_to_policy_event -> PolicyEvent {
    id, execution_id, persona_id,
    use_case_id, policy_kind, action,
    payload_title, reason, created_at,
});

// -- CRUD ------------------------------------------------------

/// Insert a policy event row. Best-effort: caller logs but does not fail the
/// execution on error — the enforcement itself already succeeded, this is
/// just the audit trail.
#[allow(clippy::too_many_arguments)]
pub fn insert(
    pool: &DbPool,
    execution_id: &str,
    persona_id: &str,
    use_case_id: Option<&str>,
    policy_kind: &str,
    action: &str,
    payload_title: Option<&str>,
    reason: Option<&str>,
) -> Result<String, AppError> {
    timed_query!("policy_events", "policy_events::insert", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO policy_events
             (id, execution_id, persona_id, use_case_id, policy_kind, action, payload_title, reason, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, execution_id, persona_id, use_case_id, policy_kind, action, payload_title, reason, now],
        )?;

        // Best-effort: promote dropped policy events into the incidents inbox.
        // No-op unless PERSONAS_INCIDENTS_PROMOTION=1; only `action='dropped'`
        // surfaces (see `audit_incidents_promoter::promote_policy_event`).
        let event = PolicyEvent {
            id: id.clone(),
            execution_id: execution_id.to_string(),
            persona_id: persona_id.to_string(),
            use_case_id: use_case_id.map(|s| s.to_string()),
            policy_kind: policy_kind.to_string(),
            action: action.to_string(),
            payload_title: payload_title.map(|s| s.to_string()),
            reason: reason.map(|s| s.to_string()),
            created_at: now.clone(),
        };
        crate::engine::audit_incidents_promoter::promote_policy_event(pool, &event);

        Ok(id)
    })
}

pub fn list_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<PolicyEvent>, AppError> {
    timed_query!("policy_events", "policy_events::list_by_execution", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM policy_events WHERE execution_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![execution_id], row_to_policy_event)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}
