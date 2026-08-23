//! Records that a trigger fired — two tables, one lifecycle.
//!
//! `pending_trigger_fires` holds a scheduler-fired trigger back for human
//! approval (the unattended-mode gate); `composite_trigger_fires` remembers
//! when each leg of a composite trigger last fired so the window logic can
//! decide whether the composite is satisfied. Both are append-and-prune churn,
//! not definition state.

use rusqlite::params;

use crate::DbPool;
use personas_core::error::AppError;

// -- Pending trigger fires (the `approval` unattended-mode hold, UAT P5) ------

fn row_to_pending_fire(row: &rusqlite::Row) -> rusqlite::Result<crate::models::PendingTriggerFire> {
    Ok(crate::models::PendingTriggerFire {
        id: row.get("id")?,
        trigger_id: row.get("trigger_id")?,
        persona_id: row.get("persona_id")?,
        event_type: row.get("event_type")?,
        payload: row.get("payload")?,
        use_case_id: row.get("use_case_id")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}

/// Hold a scheduler-fired trigger for approval (don't publish its event yet).
pub fn insert_pending_fire(
    pool: &DbPool,
    trigger_id: &str,
    persona_id: &str,
    event_type: &str,
    payload: Option<&str>,
    use_case_id: Option<&str>,
) -> Result<crate::models::PendingTriggerFire, AppError> {
    timed_query!("pending_trigger_fires", "pending_trigger_fires::insert", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO pending_trigger_fires
             (id, trigger_id, persona_id, event_type, payload, use_case_id, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
            params![
                id,
                trigger_id,
                persona_id,
                event_type,
                payload,
                use_case_id,
                now
            ],
        )?;
        conn.query_row(
            "SELECT * FROM pending_trigger_fires WHERE id = ?1",
            params![id],
            row_to_pending_fire,
        )
        .map_err(AppError::Database)
    })
}

/// All trigger fires awaiting human approval, newest first.
pub fn list_pending_fires(
    pool: &DbPool,
) -> Result<Vec<crate::models::PendingTriggerFire>, AppError> {
    timed_query!("pending_trigger_fires", "pending_trigger_fires::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM pending_trigger_fires WHERE status = 'pending' ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_pending_fire)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_pending_fire(
    pool: &DbPool,
    id: &str,
) -> Result<crate::models::PendingTriggerFire, AppError> {
    timed_query!("pending_trigger_fires", "pending_trigger_fires::get", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM pending_trigger_fires WHERE id = ?1",
            params![id],
            row_to_pending_fire,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Pending trigger fire {id} not found"))
            }
            other => AppError::Database(other),
        })
    })
}

/// Resolve a pending fire (approve/reject). Only flips a still-`pending` row.
///
/// Returns `(row, won_cas)`. `won_cas` is the ONLY signal the caller may use to
/// decide whether to publish the downstream event: the `AND status = 'pending'`
/// predicate makes this UPDATE a single-winner compare-and-swap. Two overlapping
/// callers for the same fire id (UI double-click, IPC timeout retry) both pass a
/// pre-check that reads `status == "pending"`, then race this UPDATE — only one
/// actually transitions the row. Without gating on the rows-affected count, both
/// callers would see `approved == true` (their own stale intent) and both publish,
/// firing an approval-gated automation twice from a single human click. A 0-row
/// result here means someone else already resolved this fire; that is a benign
/// no-op, not an error — the human's approval WAS recorded, just by the other call.
pub fn resolve_pending_fire(
    pool: &DbPool,
    id: &str,
    approved: bool,
) -> Result<(crate::models::PendingTriggerFire, bool), AppError> {
    timed_query!("pending_trigger_fires", "pending_trigger_fires::resolve", {
        let status = if approved { "approved" } else { "rejected" };
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        // CAS semantics (deliberate, differs from healing.rs::confirm_auto_fix
        // and manual_reviews.rs::update_status): a LOST compare-and-swap here is
        // NOT an error. The `AND status = 'pending'` predicate means a losing
        // caller's `rows == 0` only happens because a concurrent caller already
        // recorded the human's approve/reject decision -- the decision the
        // caller wanted recorded WAS recorded, just by the other racing call.
        // Returning success (with the resolved row) here is correct; returning
        // an error would be a false failure for a decision that in fact went
        // through. Contrast with healing/manual-review CAS, where a lost race
        // means a DIFFERENT actor made a conflicting decision and the caller's
        // own action was genuinely dropped, so those paths must surface `Err`.
        let rows = conn.execute(
            "UPDATE pending_trigger_fires SET status = ?1, resolved_at = ?2 WHERE id = ?3 AND status = 'pending'",
            params![status, now, id],
        )?;
        let row = get_pending_fire(pool, id)?;
        Ok((row, rows > 0))
    })
}

// ---------------------------------------------------------------------------
// Composite trigger fire persistence
// ---------------------------------------------------------------------------

/// Load all persisted composite trigger fire timestamps.
pub fn load_composite_fires(pool: &DbPool) -> Result<Vec<(String, String)>, AppError> {
    timed_query!("composite_trigger_fires", "composite_fires::load_all", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare_cached("SELECT trigger_id, fired_at FROM composite_trigger_fires")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }
        Ok(result)
    })
}

/// Upsert a composite trigger fire timestamp.
pub fn upsert_composite_fire(
    pool: &DbPool,
    trigger_id: &str,
    fired_at: &str,
) -> Result<(), AppError> {
    timed_query!("composite_trigger_fires", "composite_fires::upsert", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "INSERT INTO composite_trigger_fires (trigger_id, fired_at)
             VALUES (?1, ?2)
             ON CONFLICT(trigger_id) DO UPDATE SET fired_at = excluded.fired_at",
        )?;
        stmt.execute(params![trigger_id, fired_at])?;
        Ok(())
    })
}

/// Remove composite fire records older than the given cutoff timestamp.
///
/// W3.4: this is the campaign's transaction-boundary candidate. It runs on a
/// pooled connection with no transaction handle. Moved verbatim in W1 and
/// deliberately left alone -- wrapping it changes behaviour (a partial cleanup
/// would begin rolling back where today it does not) and needs its own test.
pub fn cleanup_composite_fires(pool: &DbPool, cutoff: &str) -> Result<(), AppError> {
    timed_query!("composite_trigger_fires", "composite_fires::cleanup", {
        let conn = pool.get()?;
        conn.execute(
            "DELETE FROM composite_trigger_fires WHERE fired_at < ?1",
            params![cutoff],
        )?;
        Ok(())
    })
}
