//! `audit_incidents` repository — CRUD + lifecycle + idempotent promotion.
//!
//! See `src/features/overview/sub_incidents/DESIGN.md` for the architecture.
//! Every mutation goes through this module; promoter callers never write to
//! the table directly.
//!
//! Idempotency contract: `promote()` uses `INSERT OR IGNORE` against the
//! `dedup_key UNIQUE` constraint, so calling it twice for the same source row
//! is a safe no-op. The dedup key shape is `{source_table}:{source_id}` —
//! callers must compute it consistently (`make_dedup_key()` is the single
//! source of truth).

use rusqlite::params;

use crate::db::models::{
    AuditIncident, AuditIncidentSummary, CreateAuditIncidentInput, IncidentFilters,
    IncidentStatus,
};
use crate::db::query_builder::QueryBuilder;
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mapper ---------------------------------------------------------------

row_mapper!(row_to_incident -> AuditIncident {
    id, source_table, source_id, dedup_key,
    persona_id [opt], persona_name [opt], execution_id [opt],
    severity, kind, title, detail [opt],
    status,
    acknowledged_at [opt], acknowledged_by [opt],
    resolved_at [opt], resolution_note [opt],
    created_at,
});

// -- Severity normalization ---------------------------------------------------

/// Normalize a heterogeneous source severity into the four-step scale used by
/// the inbox. The mapping is documented in `DESIGN.md` Section 3.
///
/// Mapping rules:
/// - Already-normalized values pass through (`low`/`medium`/`high`/`critical`).
/// - `warning` → `medium` (alert-rule severity convention).
/// - Any string containing `error`, `fail`, `critical` → `high` unless the
///   source explicitly elevates to `critical`.
/// - Anything else → `low` (informational).
pub fn normalize_severity(raw: &str) -> &'static str {
    let s = raw.trim().to_ascii_lowercase();
    match s.as_str() {
        "critical" => "critical",
        "high" => "high",
        "medium" => "medium",
        "low" => "low",
        "warning" | "warn" => "medium",
        other => {
            if other.contains("critical") {
                "critical"
            } else if other.contains("error") || other.contains("fail") {
                "high"
            } else {
                "low"
            }
        }
    }
}

/// Compute the canonical dedup key for a `(source_table, source_id)` pair.
/// Callers must use this — the repo will never recompute it differently.
pub fn make_dedup_key(source_table: &str, source_id: &str) -> String {
    format!("{source_table}:{source_id}")
}

// -- Promotion (idempotent insert) -------------------------------------------

/// Idempotently promote a source row into the incidents inbox.
///
/// Returns `Ok(Some(id))` when a new incident was inserted, `Ok(None)` when
/// the dedup key already existed (the source row was previously promoted).
/// Severity is normalized via `normalize_severity()` before insertion.
pub fn promote(pool: &DbPool, input: CreateAuditIncidentInput) -> Result<Option<String>, AppError> {
    timed_query!("audit_incidents", "audit_incidents::promote", {
        if input.source_table.trim().is_empty() || input.source_id.trim().is_empty() {
            return Err(AppError::Validation(
                "source_table and source_id are required".into(),
            ));
        }
        if input.title.trim().is_empty() {
            return Err(AppError::Validation("title is required".into()));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let dedup_key = make_dedup_key(&input.source_table, &input.source_id);
        let severity = normalize_severity(&input.severity).to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        let rows = conn.execute(
            "INSERT OR IGNORE INTO audit_incidents
             (id, source_table, source_id, dedup_key,
              persona_id, persona_name, execution_id,
              severity, kind, title, detail,
              status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'open', ?12)",
            params![
                id,
                input.source_table,
                input.source_id,
                dedup_key,
                input.persona_id,
                input.persona_name,
                input.execution_id,
                severity,
                input.kind,
                input.title,
                input.detail,
                now,
            ],
        )?;

        // `INSERT OR IGNORE` returns 0 on dedup-key conflict.
        Ok(if rows == 0 { None } else { Some(id) })
    })
}

// -- Read paths ---------------------------------------------------------------

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<AuditIncident, AppError> {
    timed_query!("audit_incidents", "audit_incidents::get_by_id", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM audit_incidents WHERE id = ?1")?;
        let row = stmt
            .query_row(params![id], row_to_incident)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("audit_incident {id}"))
                }
                other => AppError::Database(other),
            })?;
        Ok(row)
    })
}

/// List incidents matching the filter. Pagination via `(limit, offset)`.
/// Default ordering is `created_at DESC` so the inbox shows newest first.
pub fn list(
    pool: &DbPool,
    filters: &IncidentFilters,
    limit: i64,
    offset: i64,
) -> Result<Vec<AuditIncident>, AppError> {
    timed_query!("audit_incidents", "audit_incidents::list", {
        let mut qb = QueryBuilder::new();

        if let Some(statuses) = filters.statuses.as_ref().filter(|v| !v.is_empty()) {
            qb.where_in("status", statuses.clone());
        }
        if let Some(severities) = filters.severities.as_ref().filter(|v| !v.is_empty()) {
            qb.where_in("severity", severities.clone());
        }
        if let Some(sources) = filters.source_tables.as_ref().filter(|v| !v.is_empty()) {
            qb.where_in("source_table", sources.clone());
        }
        if let Some(pid) = filters.persona_id.as_deref().filter(|s| !s.is_empty()) {
            qb.where_eq("persona_id", pid.to_string());
        }
        if let Some(since) = filters.since.as_deref().filter(|s| !s.is_empty()) {
            qb.where_gte("created_at", since.to_string());
        }

        qb.order_by("created_at", "DESC");
        qb.limit(limit);
        qb.offset(offset);

        let sql = qb.build_select("SELECT * FROM audit_incidents");
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_incident)?;
        Ok(collect_rows(rows, "audit_incidents::list"))
    })
}

/// Compute KPI counts for the inbox header. The breakdown rows are scoped to
/// `status='open'` so the chips reflect "what still needs attention."
pub fn summary(pool: &DbPool) -> Result<AuditIncidentSummary, AppError> {
    timed_query!("audit_incidents", "audit_incidents::summary", {
        let conn = pool.get()?;

        let mut open = 0i64;
        let mut acknowledged = 0i64;
        let mut resolved = 0i64;
        let mut dismissed = 0i64;
        {
            let mut totals_stmt = conn.prepare(
                "SELECT status, COUNT(*) FROM audit_incidents GROUP BY status",
            )?;
            let mut totals_rows = totals_stmt.query([])?;
            while let Some(row) = totals_rows.next()? {
                let status: String = row.get(0)?;
                let count: i64 = row.get(1)?;
                match status.as_str() {
                    "open" => open = count,
                    "acknowledged" => acknowledged = count,
                    "resolved" => resolved = count,
                    "dismissed" => dismissed = count,
                    _ => {}
                }
            }
        }

        let mut sev_stmt = conn.prepare(
            "SELECT severity, COUNT(*) FROM audit_incidents
             WHERE status = 'open' GROUP BY severity ORDER BY severity",
        )?;
        let sev_iter = sev_stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?;
        let open_by_severity: Vec<(String, i64)> = collect_rows(sev_iter, "audit_incidents::summary/sev");
        drop(sev_stmt);

        let mut src_stmt = conn.prepare(
            "SELECT source_table, COUNT(*) FROM audit_incidents
             WHERE status = 'open' GROUP BY source_table ORDER BY source_table",
        )?;
        let src_iter = src_stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?;
        let open_by_source: Vec<(String, i64)> = collect_rows(src_iter, "audit_incidents::summary/src");

        Ok(AuditIncidentSummary {
            open,
            acknowledged,
            resolved,
            dismissed,
            open_by_severity,
            open_by_source,
        })
    })
}

// -- Lifecycle transitions ----------------------------------------------------

/// Generic transition guard. Allowed transitions:
/// - open → acknowledged | resolved | dismissed
/// - acknowledged → resolved | dismissed | open  (un-ack)
/// - resolved → open  (reopen, e.g. mistaken close)
/// - dismissed → open  (reopen)
fn can_transition(from: IncidentStatus, to: IncidentStatus) -> bool {
    use IncidentStatus::*;
    matches!(
        (from, to),
        (Open, Acknowledged)
            | (Open, Resolved)
            | (Open, Dismissed)
            | (Acknowledged, Resolved)
            | (Acknowledged, Dismissed)
            | (Acknowledged, Open)
            | (Resolved, Open)
            | (Dismissed, Open)
    )
}

fn apply_transition(
    pool: &DbPool,
    id: &str,
    target: IncidentStatus,
    resolution_note: Option<&str>,
) -> Result<bool, AppError> {
    let current = get_by_id(pool, id)?;
    let from = IncidentStatus::from_str(&current.status).ok_or_else(|| {
        AppError::Internal(format!("audit_incident {id} has invalid status {}", current.status))
    })?;

    if from == target {
        return Ok(false); // idempotent no-op
    }

    if !can_transition(from, target) {
        return Err(AppError::Validation(format!(
            "Invalid status transition: {} → {}",
            from.as_str(),
            target.as_str()
        )));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let rows = match target {
        IncidentStatus::Acknowledged => conn.execute(
            "UPDATE audit_incidents
             SET status = 'acknowledged', acknowledged_at = ?1, acknowledged_by = 'user'
             WHERE id = ?2",
            params![now, id],
        )?,
        IncidentStatus::Resolved => conn.execute(
            "UPDATE audit_incidents
             SET status = 'resolved', resolved_at = ?1, resolution_note = ?2
             WHERE id = ?3",
            params![now, resolution_note, id],
        )?,
        IncidentStatus::Dismissed => conn.execute(
            "UPDATE audit_incidents
             SET status = 'dismissed', resolved_at = ?1, resolution_note = ?2
             WHERE id = ?3",
            params![now, resolution_note, id],
        )?,
        IncidentStatus::Open => conn.execute(
            "UPDATE audit_incidents
             SET status = 'open', acknowledged_at = NULL, acknowledged_by = NULL,
                 resolved_at = NULL, resolution_note = NULL
             WHERE id = ?1",
            params![id],
        )?,
    };

    Ok(rows > 0)
}

pub fn acknowledge(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("audit_incidents", "audit_incidents::acknowledge", {
        apply_transition(pool, id, IncidentStatus::Acknowledged, None)
    })
}

pub fn resolve(pool: &DbPool, id: &str, note: Option<&str>) -> Result<bool, AppError> {
    timed_query!("audit_incidents", "audit_incidents::resolve", {
        apply_transition(pool, id, IncidentStatus::Resolved, note)
    })
}

pub fn dismiss(pool: &DbPool, id: &str, note: Option<&str>) -> Result<bool, AppError> {
    timed_query!("audit_incidents", "audit_incidents::dismiss", {
        apply_transition(pool, id, IncidentStatus::Dismissed, note)
    })
}

pub fn reopen(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("audit_incidents", "audit_incidents::reopen", {
        apply_transition(pool, id, IncidentStatus::Open, None)
    })
}

// -- Bulk operations ----------------------------------------------------------

pub fn bulk_acknowledge(pool: &DbPool, ids: &[String]) -> Result<i64, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut count = 0i64;
    for id in ids {
        if acknowledge(pool, id).unwrap_or(false) {
            count += 1;
        }
    }
    Ok(count)
}

pub fn bulk_resolve(pool: &DbPool, ids: &[String], note: Option<&str>) -> Result<i64, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut count = 0i64;
    for id in ids {
        if resolve(pool, id, note).unwrap_or(false) {
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    fn make_input(source_table: &str, source_id: &str, severity: &str, title: &str) -> CreateAuditIncidentInput {
        CreateAuditIncidentInput {
            source_table: source_table.into(),
            source_id: source_id.into(),
            persona_id: Some("p-1".into()),
            persona_name: Some("Test Persona".into()),
            execution_id: None,
            severity: severity.into(),
            kind: "test".into(),
            title: title.into(),
            detail: None,
        }
    }

    #[test]
    fn normalize_severity_handles_known_values() {
        assert_eq!(normalize_severity("critical"), "critical");
        assert_eq!(normalize_severity("CRITICAL"), "critical");
        assert_eq!(normalize_severity("high"), "high");
        assert_eq!(normalize_severity("medium"), "medium");
        assert_eq!(normalize_severity("low"), "low");
        assert_eq!(normalize_severity("warning"), "medium");
        assert_eq!(normalize_severity("warn"), "medium");
        assert_eq!(normalize_severity("error"), "high");
        assert_eq!(normalize_severity("decrypt_failure"), "high");
        assert_eq!(normalize_severity("info"), "low");
        assert_eq!(normalize_severity("debug"), "low");
        assert_eq!(normalize_severity(""), "low");
    }

    #[test]
    fn promote_inserts_new_incident() {
        let pool = init_test_db().unwrap();
        let id = promote(&pool, make_input("fired_alerts", "a-1", "warning", "Latency spike"))
            .unwrap();
        assert!(id.is_some());

        let row = get_by_id(&pool, &id.unwrap()).unwrap();
        assert_eq!(row.source_table, "fired_alerts");
        assert_eq!(row.source_id, "a-1");
        assert_eq!(row.dedup_key, "fired_alerts:a-1");
        assert_eq!(row.severity, "medium"); // warning normalized
        assert_eq!(row.status, "open");
    }

    #[test]
    fn promote_is_idempotent_on_dedup_key() {
        let pool = init_test_db().unwrap();
        let first = promote(&pool, make_input("fired_alerts", "a-1", "warning", "T1")).unwrap();
        assert!(first.is_some());

        // Second promote of the same source_table+source_id is a no-op.
        let second = promote(&pool, make_input("fired_alerts", "a-1", "critical", "T2"))
            .unwrap();
        assert!(second.is_none(), "duplicate dedup_key must not insert");

        // The original row's severity/title are preserved (no overwrite).
        let row = get_by_id(&pool, &first.unwrap()).unwrap();
        assert_eq!(row.severity, "medium");
        assert_eq!(row.title, "T1");
    }

    #[test]
    fn lifecycle_transitions_follow_the_state_machine() {
        let pool = init_test_db().unwrap();
        let id = promote(&pool, make_input("tool_execution_audit_log", "t-1", "error", "Tool failed"))
            .unwrap()
            .unwrap();

        assert!(acknowledge(&pool, &id).unwrap());
        let after_ack = get_by_id(&pool, &id).unwrap();
        assert_eq!(after_ack.status, "acknowledged");
        assert!(after_ack.acknowledged_at.is_some());
        assert_eq!(after_ack.acknowledged_by.as_deref(), Some("user"));

        assert!(resolve(&pool, &id, Some("Fixed it")).unwrap());
        let after_resolve = get_by_id(&pool, &id).unwrap();
        assert_eq!(after_resolve.status, "resolved");
        assert_eq!(after_resolve.resolution_note.as_deref(), Some("Fixed it"));

        // resolved → open  (reopen) is allowed
        assert!(reopen(&pool, &id).unwrap());
        let after_reopen = get_by_id(&pool, &id).unwrap();
        assert_eq!(after_reopen.status, "open");
        assert!(after_reopen.resolved_at.is_none());
        assert!(after_reopen.acknowledged_at.is_none());
    }

    #[test]
    fn invalid_transitions_are_rejected() {
        let pool = init_test_db().unwrap();
        let id = promote(&pool, make_input("policy_events", "pe-1", "low", "Drop")).unwrap().unwrap();

        // Set to resolved
        resolve(&pool, &id, None).unwrap();

        // resolved → acknowledged is NOT a valid transition
        let err = apply_transition(&pool, &id, IncidentStatus::Acknowledged, None);
        assert!(err.is_err());
    }

    #[test]
    fn list_filters_apply_correctly() {
        let pool = init_test_db().unwrap();
        promote(&pool, make_input("fired_alerts", "a-1", "critical", "A")).unwrap();
        promote(&pool, make_input("tool_execution_audit_log", "t-1", "medium", "B")).unwrap();
        promote(&pool, make_input("credential_audit_log", "c-1", "high", "C")).unwrap();

        let all = list(&pool, &IncidentFilters::default(), 50, 0).unwrap();
        assert_eq!(all.len(), 3);

        let only_critical = list(
            &pool,
            &IncidentFilters {
                severities: Some(vec!["critical".into()]),
                ..Default::default()
            },
            50,
            0,
        )
        .unwrap();
        assert_eq!(only_critical.len(), 1);
        assert_eq!(only_critical[0].title, "A");

        let from_alerts_or_creds = list(
            &pool,
            &IncidentFilters {
                source_tables: Some(vec!["fired_alerts".into(), "credential_audit_log".into()]),
                ..Default::default()
            },
            50,
            0,
        )
        .unwrap();
        assert_eq!(from_alerts_or_creds.len(), 2);
    }

    #[test]
    fn summary_counts_are_accurate() {
        let pool = init_test_db().unwrap();
        let a = promote(&pool, make_input("fired_alerts", "a-1", "critical", "A")).unwrap().unwrap();
        promote(&pool, make_input("fired_alerts", "a-2", "high", "B")).unwrap();
        promote(&pool, make_input("tool_execution_audit_log", "t-1", "medium", "C")).unwrap();

        // Move one to acknowledged
        acknowledge(&pool, &a).unwrap();

        let s = summary(&pool).unwrap();
        assert_eq!(s.open, 2);
        assert_eq!(s.acknowledged, 1);
        assert_eq!(s.resolved, 0);

        // The severity/source breakdowns are open-only.
        let total_open_by_sev: i64 = s.open_by_severity.iter().map(|(_, c)| c).sum();
        assert_eq!(total_open_by_sev, 2);
    }

    #[test]
    fn bulk_resolve_handles_multiple_ids() {
        let pool = init_test_db().unwrap();
        let mut ids = Vec::new();
        for i in 0..5 {
            let id = promote(
                &pool,
                make_input("fired_alerts", &format!("a-{i}"), "medium", &format!("T{i}")),
            )
            .unwrap()
            .unwrap();
            ids.push(id);
        }

        let n = bulk_resolve(&pool, &ids, Some("batch close")).unwrap();
        assert_eq!(n, 5);

        let s = summary(&pool).unwrap();
        assert_eq!(s.resolved, 5);
        assert_eq!(s.open, 0);
    }
}
