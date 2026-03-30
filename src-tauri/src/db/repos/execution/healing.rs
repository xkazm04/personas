use rusqlite::params;

use crate::db::models::{HealingAuditEntry, HealingKnowledge, PersonaHealingIssue};
use crate::db::query_builder::QueryBuilder;
use crate::db::DbPool;
use crate::error::AppError;

row_mapper!(row_to_healing_issue -> PersonaHealingIssue {
    id, persona_id, execution_id, title, description,
    is_circuit_breaker [bool], severity, category,
    suggested_fix, auto_fixed [bool], status,
    created_at, resolved_at,
});

crud_get_by_id!(PersonaHealingIssue, "persona_healing_issues", "PersonaHealingIssue", row_to_healing_issue);

pub fn get_all(
    pool: &DbPool,
    persona_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<PersonaHealingIssue>, AppError> {
    timed_query!("healing_events", "healing_events::get_all", {
        let conn = pool.get()?;

        let mut qb = QueryBuilder::new();
        if let Some(pid) = persona_id {
            qb.where_eq("persona_id", pid.to_string());
        }
        if let Some(st) = status {
            qb.where_eq("status", st.to_string());
        }
        qb.order_by("created_at", "DESC");

        let sql = qb.build_select("SELECT * FROM persona_healing_issues");

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_healing_issue)?;
        Ok(crate::db::repos::utils::collect_rows(rows, "healing_issues_list"))
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create(
    pool: &DbPool,
    persona_id: &str,
    title: &str,
    description: &str,
    is_circuit_breaker: bool,
    severity: Option<&str>,
    category: Option<&str>,
    execution_id: Option<&str>,
    suggested_fix: Option<&str>,
) -> Result<Option<PersonaHealingIssue>, AppError> {
    timed_query!("healing_events", "healing_events::create", {
        if title.trim().is_empty() {
            return Err(AppError::Validation("Title cannot be empty".into()));
        }
        if description.trim().is_empty() {
            return Err(AppError::Validation("Description cannot be empty".into()));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let severity = severity.unwrap_or("low");
        let category = category.unwrap_or("config");
        let is_circuit_breaker = if is_circuit_breaker { 1 } else { 0 };

        let conn = pool.get()?;
        let rows = conn.execute(
            "INSERT OR IGNORE INTO persona_healing_issues
             (id, persona_id, execution_id, title, description, is_circuit_breaker, severity, category, suggested_fix, auto_fixed, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 'open', ?10)",
            params![
                id,
                persona_id,
                execution_id,
                title,
                description,
                is_circuit_breaker,
                severity,
                category,
                suggested_fix,
                now,
            ],
        )?;

        if rows == 0 {
            // Duplicate -- a healing issue already exists for this (persona_id, execution_id).
            return Ok(None);
        }

        Ok(Some(get_by_id(pool, &id)?))
    })
}

/// Valid healing issue statuses. The issue lifecycle is:
/// `open` -> `auto_fix_pending` -> `resolved` (or back to `open` on revert).
const VALID_STATUSES: &[&str] = &["open", "auto_fix_pending", "resolved"];

pub fn update_status(pool: &DbPool, id: &str, status: &str) -> Result<(), AppError> {
    timed_query!("healing_events", "healing_events::update_status", {
        if !VALID_STATUSES.contains(&status) {
            return Err(AppError::Validation(format!(
                "Invalid healing issue status '{}'. Valid values: {}",
                status,
                VALID_STATUSES.join(", "),
            )));
        }

        // Verify exists
        get_by_id(pool, id)?;

        let conn = pool.get()?;

        if status == "resolved" {
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE persona_healing_issues SET status = ?1, resolved_at = ?2 WHERE id = ?3",
                params![status, now, id],
            )?;
        } else {
            conn.execute(
                "UPDATE persona_healing_issues SET status = ?1 WHERE id = ?2",
                params![status, id],
            )?;
        }

        Ok(())
    })
}

/// Mark a healing issue as pending auto-fix. Called at schedule time before the
/// retry actually runs. The issue stays in `auto_fix_pending` until
/// [`confirm_auto_fix`] (on success) or [`revert_auto_fix_pending`] (on failure).
pub fn mark_auto_fix_pending(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("healing_events", "healing_events::mark_auto_fix_pending", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE persona_healing_issues SET auto_fixed = 1, status = 'auto_fix_pending' WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    })
}

/// Transition a healing issue from `auto_fix_pending` to `resolved` after the
/// retry execution succeeds.
pub fn confirm_auto_fix(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("healing_events", "healing_events::confirm_auto_fix", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE persona_healing_issues SET status = 'resolved', resolved_at = ?1 WHERE id = ?2 AND status = 'auto_fix_pending'",
            params![now, id],
        )?;
        if rows == 0 {
            tracing::warn!("confirm_auto_fix: 0 rows updated for issue {id} — status was not 'auto_fix_pending' (possible race condition)");
            return Err(AppError::Execution(format!(
                "Healing issue {id} is not in 'auto_fix_pending' status; transition to 'resolved' was lost"
            )));
        }
        Ok(())
    })
}

/// Revert a healing issue from `auto_fix_pending` back to `open` after the
/// retry execution fails — the problem was not actually fixed.
pub fn revert_auto_fix_pending(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("healing_events", "healing_events::revert_auto_fix_pending", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE persona_healing_issues SET auto_fixed = 0, status = 'open' WHERE id = ?1 AND status = 'auto_fix_pending'",
            params![id],
        )?;
        if rows == 0 {
            tracing::warn!("revert_auto_fix_pending: 0 rows updated for issue {id} — status was not 'auto_fix_pending' (possible race condition)");
            return Err(AppError::Execution(format!(
                "Healing issue {id} is not in 'auto_fix_pending' status; revert to 'open' was lost"
            )));
        }
        Ok(())
    })
}

/// Find healing issues associated with an execution ID (used to update status
/// after a retry completes).
pub fn get_by_execution_id(pool: &DbPool, execution_id: &str) -> Result<Vec<PersonaHealingIssue>, AppError> {
    timed_query!("healing_events", "healing_events::get_by_execution_id", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_healing_issues WHERE execution_id = ?1",
        )?;
        let rows = stmt.query_map(params![execution_id], row_to_healing_issue)?;
        Ok(crate::db::repos::utils::collect_rows(rows, "healing_issues_by_exec"))
    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("healing_events", "healing_events::delete", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM persona_healing_issues WHERE id = ?1",
            params![id],
        )?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Healing Knowledge Base
// ============================================================================

// row_to_knowledge uses custom logic (occurrence_count unwrap_or) -- keep manual
fn row_to_knowledge(row: &rusqlite::Row) -> rusqlite::Result<HealingKnowledge> {
    Ok(HealingKnowledge {
        id: row.get("id")?,
        service_type: row.get("service_type")?,
        pattern_key: row.get("pattern_key")?,
        description: row.get("description")?,
        recommended_delay_secs: row.get("recommended_delay_secs")?,
        occurrence_count: row.get::<_, Option<i64>>("occurrence_count")?.unwrap_or(1),
        last_seen_at: row.get("last_seen_at")?,
        created_at: row.get("created_at")?,
    })
}

/// Upsert a knowledge entry: increment count if exists, create if not.
pub fn upsert_knowledge(
    pool: &DbPool,
    service_type: &str,
    pattern_key: &str,
    description: &str,
    recommended_delay_secs: Option<i64>,
) -> Result<HealingKnowledge, AppError> {
    timed_query!("healing_events", "healing_events::upsert_knowledge", {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();

    // Try to update existing entry
    let updated = conn.execute(
        "UPDATE healing_knowledge SET
            occurrence_count = occurrence_count + 1,
            last_seen_at = ?1,
            description = ?2,
            recommended_delay_secs = COALESCE(?3, recommended_delay_secs)
         WHERE service_type = ?4 AND pattern_key = ?5",
        params![now, description, recommended_delay_secs, service_type, pattern_key],
    )?;

    if updated > 0 {
        // Return the updated entry
        let entry = conn.query_row(
            "SELECT * FROM healing_knowledge WHERE service_type = ?1 AND pattern_key = ?2",
            params![service_type, pattern_key],
            row_to_knowledge,
        )?;
        return Ok(entry);
    }

    // Insert new entry
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO healing_knowledge
         (id, service_type, pattern_key, description, recommended_delay_secs, occurrence_count, last_seen_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
        params![id, service_type, pattern_key, description, recommended_delay_secs, now],
    )?;

    conn.query_row(
        "SELECT * FROM healing_knowledge WHERE id = ?1",
        params![id],
        row_to_knowledge,
    )
    .map_err(AppError::Database)
    })
}

/// Get knowledge entries for a given service type (e.g., "gmail", "slack").
pub fn get_knowledge_by_service(
    pool: &DbPool,
    service_type: &str,
) -> Result<Vec<HealingKnowledge>, AppError> {
    timed_query!("healing_events", "healing_events::get_knowledge_by_service", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM healing_knowledge WHERE service_type = ?1 ORDER BY occurrence_count DESC",
        )?;
        let rows = stmt.query_map(params![service_type], row_to_knowledge)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Get all knowledge entries.
pub fn get_all_knowledge(pool: &DbPool) -> Result<Vec<HealingKnowledge>, AppError> {
    timed_query!("healing_events", "healing_events::get_all_knowledge", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM healing_knowledge ORDER BY occurrence_count DESC, last_seen_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_knowledge)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Look up a knowledge hint (recommended delay + occurrence count) for a
/// specific service + pattern combination. Returns `None` if no entry exists.
pub fn get_knowledge_hint(
    pool: &DbPool,
    service_type: &str,
    pattern_key: &str,
) -> Result<Option<crate::engine::healing::KnowledgeHint>, AppError> {
    timed_query!("healing_events", "healing_events::get_knowledge_hint", {
        let conn = pool.get()?;
        let result = conn.query_row(
            "SELECT recommended_delay_secs, occurrence_count FROM healing_knowledge
             WHERE service_type = ?1 AND pattern_key = ?2",
            params![service_type, pattern_key],
            |row| {
                let delay: Option<i64> = row.get(0)?;
                let count: i64 = row.get::<_, Option<i64>>(1)?.unwrap_or(1);
                Ok((delay, count))
            },
        );
        match result {
            Ok((delay, count)) => Ok(Some(crate::engine::healing::KnowledgeHint {
                recommended_delay_secs: delay.map(|d| d as u64),
                occurrence_count: count,
            })),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

// ============================================================================
// Healing Audit Log
// ============================================================================

row_mapper!(row_to_audit_entry -> HealingAuditEntry {
    id, persona_id, execution_id, event_type, subsystem, message, detail, created_at,
});

/// Insert a healing audit log entry (fire-and-forget, never fails the caller).
pub fn create_audit_entry(
    pool: &DbPool,
    persona_id: Option<&str>,
    execution_id: Option<&str>,
    event_type: &str,
    subsystem: &str,
    message: &str,
    detail: Option<&str>,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    match pool.get() {
        Ok(conn) => {
            if let Err(e) = conn.execute(
                "INSERT INTO healing_audit_log (id, persona_id, execution_id, event_type, subsystem, message, detail, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, persona_id, execution_id, event_type, subsystem, message, detail, now],
            ) {
                tracing::error!("Failed to write healing audit entry: {}", e);
            }
        }
        Err(e) => tracing::error!("Failed to get DB connection for healing audit: {}", e),
    }
}

/// List healing audit log entries, optionally filtered by persona_id.
pub fn list_audit_log(
    pool: &DbPool,
    persona_id: Option<&str>,
    limit: i64,
) -> Result<Vec<HealingAuditEntry>, AppError> {
    timed_query!("healing_audit", "healing_audit::list_audit_log", {
        let conn = pool.get()?;
        let (sql, param_values): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(pid) = persona_id {
            (
                "SELECT * FROM healing_audit_log WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT ?2".into(),
                vec![Box::new(pid.to_string()), Box::new(limit)],
            )
        } else {
            (
                "SELECT * FROM healing_audit_log ORDER BY created_at DESC LIMIT ?1".into(),
                vec![Box::new(limit)],
            )
        };
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), row_to_audit_entry)?;
        Ok(crate::db::repos::utils::collect_rows(rows, "healing_audit_log"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::core::personas;

    #[test]
    fn test_healing_issue_crud() {
        let pool = init_test_db().unwrap();

        // Create a persona first (required as parent)
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Healer Agent".into(),
                system_prompt: "You fix things.".into(),
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
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        // Create healing issues
        let issue1 = create(
            &pool,
            &persona.id,
            "Prompt too long",
            "The system prompt exceeds 8000 tokens and causes timeouts.",
            false,
            Some("high"),
            Some("prompt"),
            None,
            Some("Split the prompt into sections and use structured_prompt."),
        )
        .unwrap()
        .expect("should create new issue");
        assert_eq!(issue1.title, "Prompt too long");
        assert_eq!(issue1.severity, "high");
        assert_eq!(issue1.category, "prompt");
        assert_eq!(issue1.status, "open");
        assert!(!issue1.auto_fixed);
        assert!(issue1.resolved_at.is_none());
        assert!(issue1.suggested_fix.is_some());

        let issue2 = create(
            &pool,
            &persona.id,
            "Missing API key",
            "Credential for OpenAI is not configured.",
            false,
            None, // defaults to "low"
            None, // defaults to "config"
            None,
            None,
        )
        .unwrap()
        .expect("should create new issue");
        assert_eq!(issue2.severity, "low");
        assert_eq!(issue2.category, "config");

        // Read by id
        let fetched = get_by_id(&pool, &issue1.id).unwrap();
        assert_eq!(fetched.description, "The system prompt exceeds 8000 tokens and causes timeouts.");

        // Get all (no filters)
        let all = get_all(&pool, None, None).unwrap();
        assert_eq!(all.len(), 2);

        // Get all filtered by persona_id
        let by_persona = get_all(&pool, Some(&persona.id), None).unwrap();
        assert_eq!(by_persona.len(), 2);

        // Get all filtered by status
        let open_issues = get_all(&pool, None, Some("open")).unwrap();
        assert_eq!(open_issues.len(), 2);

        // Update status to resolved
        update_status(&pool, &issue1.id, "resolved").unwrap();
        let resolved = get_by_id(&pool, &issue1.id).unwrap();
        assert_eq!(resolved.status, "resolved");
        assert!(resolved.resolved_at.is_some());

        // Update status to something else (not resolved)
        update_status(&pool, &issue2.id, "auto_fix_pending").unwrap();
        let pending = get_by_id(&pool, &issue2.id).unwrap();
        assert_eq!(pending.status, "auto_fix_pending");
        assert!(pending.resolved_at.is_none());

        // Filter by resolved status
        let resolved_list = get_all(&pool, None, Some("resolved")).unwrap();
        assert_eq!(resolved_list.len(), 1);
        assert_eq!(resolved_list[0].id, issue1.id);

        // Delete
        let deleted = delete(&pool, &issue1.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &issue1.id).is_err());

        // Delete non-existent returns false
        let deleted_again = delete(&pool, &issue1.id).unwrap();
        assert!(!deleted_again);

        let remaining = get_all(&pool, None, None).unwrap();
        assert_eq!(remaining.len(), 1);
    }

    #[test]
    fn test_duplicate_execution_id_prevented() {
        let pool = init_test_db().unwrap();

        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Dup Test".into(),
                system_prompt: "test".into(),
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
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let exec_id = "exec-001";

        // First insert succeeds
        let first = create(
            &pool, &persona.id, "Error A", "desc", false,
            None, None, Some(exec_id), None,
        )
        .unwrap();
        assert!(first.is_some(), "first insert should succeed");

        // Second insert with same (persona_id, execution_id) returns None
        let second = create(
            &pool, &persona.id, "Error B", "desc2", false,
            None, None, Some(exec_id), None,
        )
        .unwrap();
        assert!(second.is_none(), "duplicate should be silently ignored");

        // Only one row exists
        let all = get_all(&pool, Some(&persona.id), None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Error A");
    }

    #[test]
    fn test_confirm_auto_fix_lost_transition_returns_error() {
        let pool = init_test_db().unwrap();

        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Race Test".into(),
                system_prompt: "test".into(),
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
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let issue = create(
            &pool, &persona.id, "Flaky API", "timeout", false,
            None, None, None, None,
        )
        .unwrap()
        .expect("should create");

        // Issue is in 'open' status — confirm_auto_fix should fail (not auto_fix_pending)
        let err = confirm_auto_fix(&pool, &issue.id);
        assert!(err.is_err(), "confirm on non-pending issue should error");

        // Same for revert
        let err = revert_auto_fix_pending(&pool, &issue.id);
        assert!(err.is_err(), "revert on non-pending issue should error");

        // Now transition to auto_fix_pending and confirm — should succeed
        mark_auto_fix_pending(&pool, &issue.id).unwrap();
        confirm_auto_fix(&pool, &issue.id).unwrap();
        let resolved = get_by_id(&pool, &issue.id).unwrap();
        assert_eq!(resolved.status, "resolved");

        // Second confirm on already-resolved issue should fail (race simulation)
        let err = confirm_auto_fix(&pool, &issue.id);
        assert!(err.is_err(), "double confirm should error");
    }

    #[test]
    fn test_revert_auto_fix_pending_lost_transition_returns_error() {
        let pool = init_test_db().unwrap();

        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Revert Test".into(),
                system_prompt: "test".into(),
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
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let issue = create(
            &pool, &persona.id, "Bad config", "missing key", false,
            None, None, None, None,
        )
        .unwrap()
        .expect("should create");

        // Transition to pending, then revert — should succeed
        mark_auto_fix_pending(&pool, &issue.id).unwrap();
        revert_auto_fix_pending(&pool, &issue.id).unwrap();
        let reverted = get_by_id(&pool, &issue.id).unwrap();
        assert_eq!(reverted.status, "open");
        assert!(!reverted.auto_fixed);

        // Second revert on already-open issue should fail (race simulation)
        let err = revert_auto_fix_pending(&pool, &issue.id);
        assert!(err.is_err(), "double revert should error");
    }

    #[test]
    fn test_update_status_rejects_invalid_values() {
        let pool = init_test_db().unwrap();

        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Validation Test".into(),
                system_prompt: "test".into(),
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
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let issue = create(
            &pool, &persona.id, "Test issue", "desc", false,
            None, None, None, None,
        )
        .unwrap()
        .expect("should create");

        // Invalid statuses should be rejected
        for bad in &["", "Resolved", "OPEN", "investigating", "closed", "nonsense"] {
            let err = update_status(&pool, &issue.id, bad);
            assert!(err.is_err(), "status '{}' should be rejected", bad);
        }

        // Valid statuses should be accepted
        for good in &["open", "auto_fix_pending", "resolved"] {
            update_status(&pool, &issue.id, good).unwrap();
        }
    }
}
