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
    AuditIncident, AuditIncidentSummary, CreateAuditIncidentInput, IncidentFilters, IncidentStatus,
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
    continued_at [opt],
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
/// Normalize an incident title into a duplicate-detection key: lowercase,
/// every digit run collapsed to `#` (so "PR #4 stuck (cycle 4)" and
/// "(cycle 5)" compare equal), whitespace collapsed, first 64 chars.
/// Strip one trailing volatile-counter parenthetical — `(cycle 4)`,
/// `(attempt 2)`, `(retry 3)`, `(run 5)`, `(iteration 1)`, … — so the SAME
/// blocker re-raised each cycle dedups, without touching digits elsewhere. The
/// label is matched case-insensitively; anything that isn't a `(<label> <int>)`
/// pair is left intact.
fn strip_counter_suffix(s: &str) -> &str {
    const LABELS: &[&str] = &[
        "cycle", "attempt", "retry", "run", "iteration", "try", "pass", "round",
    ];
    let trimmed = s.trim_end();
    if !trimmed.ends_with(')') {
        return trimmed;
    }
    let Some(open) = trimmed.rfind('(') else {
        return trimmed;
    };
    let inner = &trimmed[open + 1..trimmed.len() - 1];
    let mut parts = inner.split_whitespace();
    match (parts.next(), parts.next(), parts.next()) {
        (Some(label), Some(num), None)
            if LABELS.contains(&label.to_lowercase().as_str())
                && !num.is_empty()
                && num.chars().all(|c| c.is_ascii_digit()) =>
        {
            trimmed[..open].trim_end()
        }
        _ => trimmed,
    }
}

/// Normalized open-incident dedup key. Lowercases + collapses whitespace and
/// drops a trailing volatile counter suffix (see [`strip_counter_suffix`]) so
/// per-cycle re-raises of one blocker collapse together — but KEEPS meaningful
/// digits so distinct blockers like "PR #4 stuck" and "PR #7 stuck" stay
/// separate (the old version collapsed every digit run to `#` and silenced the
/// second as a false duplicate).
pub fn normalize_title_key(title: &str) -> String {
    let base = strip_counter_suffix(title.trim());
    let mut out = String::with_capacity(64);
    let mut last_was_space = false;
    for c in base.chars() {
        if out.len() >= 64 {
            break;
        }
        if c.is_whitespace() {
            if !last_was_space {
                out.push(' ');
            }
            last_was_space = true;
        } else {
            out.extend(c.to_lowercase());
            last_was_space = false;
        }
    }
    out.trim_end().to_string()
}

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

        // OPEN-DUPLICATE guard (beyond the per-source dedup_key): the same
        // underlying problem re-raised from a DIFFERENT execution/run must not
        // stack a new open incident. Live audit (2026-06-10) found 22 open
        // copies of "Transient process failure" and per-cycle re-raises of the
        // same stuck-PR blocker ("PR #4 stuck (cycle 4)" / "(cycle 5)") — the
        // inbox became noise and personas re-discovered the same blocker every
        // run. Compare on a normalized title (lowercase, digits collapsed, 64
        // chars) within the same persona (or, for persona-less system sources,
        // the same kind): an OPEN match means this incident already exists.
        let title_key = normalize_title_key(&input.title);
        let open_titles: Vec<String> = if let Some(pid) = input.persona_id.as_deref() {
            let mut stmt = conn.prepare(
                "SELECT title FROM audit_incidents WHERE status = 'open' AND persona_id = ?1",
            )?;
            let rows = stmt.query_map(params![pid], |r| r.get::<_, String>(0))?;
            rows.filter_map(Result::ok).collect()
        } else {
            let mut stmt = conn.prepare(
                "SELECT title FROM audit_incidents
                 WHERE status = 'open' AND persona_id IS NULL AND kind = ?1",
            )?;
            let rows = stmt.query_map(params![input.kind], |r| r.get::<_, String>(0))?;
            rows.filter_map(Result::ok).collect()
        };
        if open_titles
            .iter()
            .any(|t| normalize_title_key(t) == title_key)
        {
            return Ok(None);
        }
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

/// Open (non-terminal) incidents for a set of personas, newest-first, capped at
/// `limit`. Used by the execution-time team-awareness block
/// (`engine::runner::team_context`) so members avoid repeating known failures.
///
/// "Open" here = `status IN ('open','acknowledged')` (the two non-terminal
/// states; `resolved`/`dismissed` are excluded). Scope is by `persona_id`
/// because `audit_incidents` has no project/team FK — the persona roster is the
/// closest available team scope. Ordering is `created_at DESC` (the table has no
/// `last_seen_at`); the caller applies the severity-rank + high/critical filter
/// in Rust, so this stays a plain, index-friendly query.
///
/// Empty `persona_ids` ⇒ `Ok(vec![])` (no SQL issued).
pub fn list_open_by_personas(
    pool: &DbPool,
    persona_ids: &[String],
    limit: i64,
) -> Result<Vec<AuditIncident>, AppError> {
    timed_query!("audit_incidents", "audit_incidents::list_open_by_personas", {
        if persona_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut qb = QueryBuilder::new();
        qb.where_in("status", vec!["open".to_string(), "acknowledged".to_string()]);
        qb.where_in("persona_id", persona_ids.to_vec());
        qb.order_by("created_at", "DESC");
        qb.limit(limit);

        let sql = qb.build_select("SELECT * FROM audit_incidents");
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_incident)?;
        Ok(collect_rows(rows, "audit_incidents::list_open_by_personas"))
    })
}

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
            let mut totals_stmt =
                conn.prepare("SELECT status, COUNT(*) FROM audit_incidents GROUP BY status")?;
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
        let sev_iter = sev_stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let open_by_severity: Vec<(String, i64)> =
            collect_rows(sev_iter, "audit_incidents::summary/sev");
        drop(sev_stmt);

        let mut src_stmt = conn.prepare(
            "SELECT source_table, COUNT(*) FROM audit_incidents
             WHERE status = 'open' GROUP BY source_table ORDER BY source_table",
        )?;
        let src_iter = src_stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let open_by_source: Vec<(String, i64)> =
            collect_rows(src_iter, "audit_incidents::summary/src");

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
            | (Open, InProgress)
            | (Open, Resolved)
            | (Open, Dismissed)
            | (Acknowledged, InProgress)
            | (Acknowledged, Resolved)
            | (Acknowledged, Dismissed)
            | (Acknowledged, Open)
            // In-progress: the active-work state. Can finish (resolved),
            // be set aside (dismissed), or revert to open/acknowledged.
            | (InProgress, Resolved)
            | (InProgress, Dismissed)
            | (InProgress, Open)
            | (InProgress, Acknowledged)
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
        AppError::Internal(format!(
            "audit_incident {id} has invalid status {}",
            current.status
        ))
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
        IncidentStatus::InProgress => conn.execute(
            // Stamp acknowledged_at if not already (entering in_progress implies
            // it's been seen). resolution fields stay clear — work isn't done.
            // continued_at is reset too: leaving the resolved state starts a
            // fresh lifecycle, so a later re-resolution must be continuable
            // again (the continuation scanner skips rows where it's non-NULL).
            "UPDATE audit_incidents
             SET status = 'in_progress',
                 acknowledged_at = COALESCE(acknowledged_at, ?1),
                 acknowledged_by = COALESCE(acknowledged_by, 'user'),
                 resolved_at = NULL, resolution_note = NULL, continued_at = NULL
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
            // Reopen resets the whole lifecycle, including the continuation
            // claim — otherwise a reopened persona_blocker that gets resolved
            // again would never re-continue (continued_at stayed stamped, so the
            // scanner's `continued_at IS NULL` claim never matches it again).
            "UPDATE audit_incidents
             SET status = 'open', acknowledged_at = NULL, acknowledged_by = NULL,
                 resolved_at = NULL, resolution_note = NULL, continued_at = NULL
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

/// Mark an incident as actively being worked ("In Progress"). The middle state
/// of the `open → in_progress → resolved` escalation lifecycle.
pub fn start_progress(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("audit_incidents", "audit_incidents::start_progress", {
        apply_transition(pool, id, IncidentStatus::InProgress, None)
    })
}

pub fn resolve(pool: &DbPool, id: &str, note: Option<&str>) -> Result<bool, AppError> {
    timed_query!("audit_incidents", "audit_incidents::resolve", {
        apply_transition(pool, id, IncidentStatus::Resolved, note)
    })
}

/// Resolved persona-raised incidents whose blocked work has NOT yet been
/// auto-continued (P2.3b). These are the candidates the incident-continuation
/// reactive loop re-runs: `status='resolved'` (the human/Athena cleared the
/// blocker) AND a continuable source — `source_table='persona_blocker'` (a
/// persona's `raise_incident`; `source_id` is the blocked execution id) or
/// `source_table='team_assignments'` (Athena's review-resolution `incident`
/// outcome; `source_id` is the parked assignment id — resolving the access/
/// credential blocker auto-resumes the assignment) — AND
/// `continued_at IS NULL` (not yet claimed). Oldest-resolved first so the
/// backlog drains FIFO. The caller still atomically `claim_continuation`s each
/// one before acting, so this query may safely over-return under races.
pub fn find_continuation_candidates(pool: &DbPool, limit: i64) -> Result<Vec<AuditIncident>, AppError> {
    timed_query!("audit_incidents", "audit_incidents::find_continuation_candidates", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM audit_incidents \
             WHERE status = 'resolved' \n             AND source_table IN ('persona_blocker', 'team_assignments') \
             AND continued_at IS NULL \
             ORDER BY resolved_at ASC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], row_to_incident)?;
        let out = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(out)
    })
}

/// Atomically claim a resolved incident for auto-continuation (P2.3b).
///
/// Stamps `continued_at` to now ONLY if it was NULL. The `WHERE continued_at IS
/// NULL` clause makes this a race-free claim: when the incident-continuation
/// reactive loop fires on the same incident across overlapping ticks (or two
/// engine instances), exactly one call updates a row. Returns `true` when THIS
/// call claimed it (caller re-runs the blocked work), `false` when it was
/// already claimed (skip — no double re-run).
pub fn claim_continuation(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("audit_incidents", "audit_incidents::claim_continuation", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE audit_incidents SET continued_at = ?1
             WHERE id = ?2 AND continued_at IS NULL",
            params![now, id],
        )?;
        Ok(rows > 0)
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
        // Propagate a real DB error (lock/busy/corrupt) instead of collapsing
        // it to `false`: swallowing it under-reports the count and the caller
        // shows "N acknowledged" while some rows silently stayed open, with no
        // toast and no Sentry breadcrumb. A genuine no-change (`Ok(false)`)
        // still correctly counts as "not flipped".
        if acknowledge(pool, id)? {
            count += 1;
        }
    }
    Ok(count)
}

/// Bulk-resolve incidents, returning the ids that THIS call actually
/// transitioned to `resolved` (i.e. `resolve()` returned `true`). Ids that
/// were already resolved — or otherwise unchanged — are omitted, so callers
/// can publish `incident_resolved` only for the rows they genuinely flipped
/// (mirroring `resolve()`'s `changed` contract) and avoid re-firing spurious
/// events on duplicate or overlapping selections.
pub fn bulk_resolve(
    pool: &DbPool,
    ids: &[String],
    note: Option<&str>,
) -> Result<Vec<String>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut flipped = Vec::new();
    for id in ids {
        // Propagate a real DB error (lock/busy/corrupt) instead of collapsing
        // it to `false`: swallowing it under-reports which rows resolved and
        // leaves the operator believing incidents are cleared when they remain
        // open. A genuine no-change (`Ok(false)` — already resolved) is still
        // correctly omitted from the freshly-flipped list.
        if resolve(pool, id, note)? {
            flipped.push(id.clone());
        }
    }
    Ok(flipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    fn make_input(
        source_table: &str,
        source_id: &str,
        severity: &str,
        title: &str,
    ) -> CreateAuditIncidentInput {
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
        let id = promote(
            &pool,
            make_input("fired_alerts", "a-1", "warning", "Latency spike"),
        )
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
        let second = promote(&pool, make_input("fired_alerts", "a-1", "critical", "T2")).unwrap();
        assert!(second.is_none(), "duplicate dedup_key must not insert");

        // The original row's severity/title are preserved (no overwrite).
        let row = get_by_id(&pool, &first.unwrap()).unwrap();
        assert_eq!(row.severity, "medium");
        assert_eq!(row.title, "T1");
    }

    #[test]
    fn lifecycle_transitions_follow_the_state_machine() {
        let pool = init_test_db().unwrap();
        let id = promote(
            &pool,
            make_input("tool_execution_audit_log", "t-1", "error", "Tool failed"),
        )
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

    /// The escalation lifecycle's active-work state: `open → in_progress →
    /// resolved`. Entering in_progress stamps acknowledged_at; resolving from
    /// in_progress carries the note. resolved → in_progress is NOT allowed.
    #[test]
    fn in_progress_lifecycle() {
        let pool = init_test_db().unwrap();
        let id = promote(&pool, make_input("fired_alerts", "ip-1", "critical", "Build broken"))
            .unwrap()
            .unwrap();

        // open -> in_progress (stamps acknowledged_at, no resolution yet)
        assert!(start_progress(&pool, &id).unwrap());
        let working = get_by_id(&pool, &id).unwrap();
        assert_eq!(working.status, "in_progress");
        assert!(working.acknowledged_at.is_some());
        assert!(working.resolved_at.is_none());

        // in_progress -> resolved (carries the note)
        assert!(resolve(&pool, &id, Some("fixed the build")).unwrap());
        let done = get_by_id(&pool, &id).unwrap();
        assert_eq!(done.status, "resolved");
        assert_eq!(done.resolution_note.as_deref(), Some("fixed the build"));

        // resolved -> in_progress is NOT a valid transition (only -> open).
        assert!(apply_transition(&pool, &id, IncidentStatus::InProgress, None).is_err());
    }

    /// P2.3b race-free claim: the first claim_continuation wins (true) and
    /// stamps continued_at; every subsequent claim loses (false). This is the
    /// idempotency guarantee that stops the reactive loop double-firing a re-run.
    #[test]
    fn claim_continuation_fires_at_most_once() {
        let pool = init_test_db().unwrap();
        let id = promote(&pool, make_input("persona_blocker", "ex-1", "high", "Blocked"))
            .unwrap()
            .unwrap();

        // Not yet claimed.
        assert!(get_by_id(&pool, &id).unwrap().continued_at.is_none());

        // First claim wins + stamps continued_at.
        assert!(claim_continuation(&pool, &id).unwrap(), "first claim must win");
        assert!(get_by_id(&pool, &id).unwrap().continued_at.is_some());

        // Second + third claims lose (already continued) — no double re-run.
        assert!(!claim_continuation(&pool, &id).unwrap(), "second claim must lose");
        assert!(!claim_continuation(&pool, &id).unwrap(), "third claim must lose");
    }

    /// find_continuation_candidates returns only resolved persona_blocker
    /// incidents with continued_at NULL, and drops them once claimed — the exact
    /// set the incident-continuation loop should re-run.
    #[test]
    fn find_continuation_candidates_filters_correctly() {
        let pool = init_test_db().unwrap();

        // (a) resolved persona_blocker, unclaimed → candidate.
        let blocked = promote(&pool, make_input("persona_blocker", "exec-blocked", "high", "Blocked"))
            .unwrap()
            .unwrap();
        resolve(&pool, &blocked, Some("fixed the creds")).unwrap();

        // (b) persona_blocker but still OPEN → not a candidate.
        promote(&pool, make_input("persona_blocker", "exec-open", "high", "Still blocked"))
            .unwrap()
            .unwrap();

        // (c) resolved but NOT persona_blocker (an audit-stream incident) → not a candidate.
        let alert = promote(&pool, make_input("fired_alerts", "alert-1", "high", "Latency"))
            .unwrap()
            .unwrap();
        resolve(&pool, &alert, None).unwrap();

        let candidates = find_continuation_candidates(&pool, 50).unwrap();
        assert_eq!(candidates.len(), 1, "only the resolved persona_blocker qualifies");
        assert_eq!(candidates[0].id, blocked);
        assert_eq!(candidates[0].source_id, "exec-blocked");

        // Once claimed, it drops out of the candidate set (no re-run on next tick).
        assert!(claim_continuation(&pool, &blocked).unwrap());
        assert!(
            find_continuation_candidates(&pool, 50).unwrap().is_empty(),
            "a claimed incident must not reappear as a candidate"
        );
    }

    #[test]
    fn invalid_transitions_are_rejected() {
        let pool = init_test_db().unwrap();
        let id = promote(&pool, make_input("policy_events", "pe-1", "low", "Drop"))
            .unwrap()
            .unwrap();

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
        promote(
            &pool,
            make_input("tool_execution_audit_log", "t-1", "medium", "B"),
        )
        .unwrap();
        promote(
            &pool,
            make_input("credential_audit_log", "c-1", "high", "C"),
        )
        .unwrap();

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
        let a = promote(&pool, make_input("fired_alerts", "a-1", "critical", "A"))
            .unwrap()
            .unwrap();
        promote(&pool, make_input("fired_alerts", "a-2", "high", "B")).unwrap();
        promote(
            &pool,
            make_input("tool_execution_audit_log", "t-1", "medium", "C"),
        )
        .unwrap();

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
                make_input(
                    "fired_alerts",
                    &format!("a-{i}"),
                    "medium",
                    &format!("T{i}"),
                ),
            )
            .unwrap()
            .unwrap();
            ids.push(id);
        }

        let flipped = bulk_resolve(&pool, &ids, Some("batch close")).unwrap();
        assert_eq!(flipped.len(), 5);

        let s = summary(&pool).unwrap();
        assert_eq!(s.resolved, 5);
        assert_eq!(s.open, 0);
    }

    /// Regression: `bulk_resolve` must return ONLY the ids it actually flipped
    /// to resolved, never ids that were already resolved coming in. This is the
    /// guard that stops `bulk_resolve_audit_incidents` from re-emitting
    /// `incident_resolved` (and persisting duplicate persona_events) for rows a
    /// previous call — or an overlapping selection in another window — already
    /// closed.
    #[test]
    fn bulk_resolve_returns_only_freshly_flipped_ids() {
        let pool = init_test_db().unwrap();
        let a = promote(&pool, make_input("fired_alerts", "a-1", "medium", "A"))
            .unwrap()
            .unwrap();
        let b = promote(&pool, make_input("fired_alerts", "a-2", "medium", "B"))
            .unwrap()
            .unwrap();

        // Pre-resolve `a`, so the bulk call below does NOT change it.
        assert!(resolve(&pool, &a, None).unwrap());

        // Selection includes the already-resolved `a` and the still-open `b`.
        let flipped = bulk_resolve(&pool, &[a.clone(), b.clone()], Some("batch")).unwrap();
        assert_eq!(flipped, vec![b.clone()], "only the still-open `b` flips");

        // Re-running over an all-resolved set flips nothing — no spurious republish.
        let flipped_again = bulk_resolve(&pool, &[a, b], Some("batch")).unwrap();
        assert!(
            flipped_again.is_empty(),
            "re-resolving an all-resolved selection must flip nothing"
        );
    }
}
