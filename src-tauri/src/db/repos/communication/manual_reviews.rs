use rusqlite::params;

use crate::db::models::{CreateManualReviewInput, CreateReviewMessageInput, ManualReviewStatus, PersonaManualReview, ReviewMessage};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_review(row: &rusqlite::Row) -> rusqlite::Result<PersonaManualReview> {
    Ok(PersonaManualReview {
        id: row.get("id")?,
        execution_id: row.get("execution_id")?,
        persona_id: row.get("persona_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        severity: row.get("severity")?,
        context_data: row.get("context_data")?,
        suggested_actions: row.get("suggested_actions")?,
        status: ManualReviewStatus::from_db(&row.get::<_, String>("status")?),
        reviewer_notes: row.get("reviewer_notes")?,
        resolved_at: row.get("resolved_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        use_case_id: row.get::<_, Option<String>>("use_case_id").unwrap_or(None),
    })
}

row_mapper!(row_to_message -> ReviewMessage {
    id, review_id, role, content, metadata, created_at,
});

crud_get_by_id!(PersonaManualReview, "persona_manual_reviews", "Manual review", row_to_review);

pub fn create(
    pool: &DbPool,
    input: CreateManualReviewInput,
) -> Result<PersonaManualReview, AppError> {
    timed_query!("manual_reviews", "manual_reviews::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let severity = input.severity.unwrap_or_else(|| "info".to_string());

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO persona_manual_reviews
             (id, execution_id, persona_id, title, description, severity, status,
              context_data, suggested_actions, created_at, updated_at, use_case_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?9, ?9, ?10)",
            params![
                id,
                input.execution_id,
                input.persona_id,
                input.title,
                input.description,
                severity,
                input.context_data,
                input.suggested_actions,
                now,
                input.use_case_id,
            ],
        )?;

        get_by_id(pool, &id)
    })
}

pub fn get_by_persona(
    pool: &DbPool,
    persona_id: &str,
    status: Option<&str>,
) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_by_persona", {
        let conn = pool.get()?;

        if let Some(status_filter) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE persona_id = ?1 AND status = ?2
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![persona_id, status_filter], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_by_persona(filtered)"))
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE persona_id = ?1
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![persona_id], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_by_persona"))
        }
    })
}

pub fn get_all(
    pool: &DbPool,
    status: Option<&str>,
) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_all", {
        let conn = pool.get()?;

        if let Some(status_filter) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE status = ?1
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![status_filter], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_all(filtered)"))
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map([], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_all"))
        }
    })
}

/// Fetch recently resolved (approved/rejected/resolved) reviews for a persona.
///
/// Used by the runner to inject prior review decisions into the next execution
/// so the agent can learn from past human feedback.
///
/// - `days`: lookback window in days
/// - `limit`: max number of reviews to return
pub fn get_recent_resolved(
    pool: &DbPool,
    persona_id: &str,
    days: i64,
    limit: i64,
) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_recent_resolved", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_manual_reviews
             WHERE persona_id = ?1
               AND status IN ('approved', 'rejected', 'resolved')
               AND (julianday('now') - julianday(created_at)) <= ?2
             ORDER BY created_at DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, days, limit], row_to_review)?;
        Ok(collect_rows(rows, "manual_reviews::get_recent_resolved"))
    })
}

/// Fetch reviews attributed to a specific capability (use case) on a persona.
/// Phase C5 — capability-scoped review queue.
pub fn get_by_use_case_id(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: &str,
    status: Option<&str>,
) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_by_use_case_id", {
        let conn = pool.get()?;

        if let Some(status_filter) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE persona_id = ?1 AND use_case_id = ?2 AND status = ?3
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![persona_id, use_case_id, status_filter], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_by_use_case_id(filtered)"))
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_manual_reviews
                 WHERE persona_id = ?1 AND use_case_id = ?2
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![persona_id, use_case_id], row_to_review)?;
            Ok(collect_rows(rows, "manual_reviews::get_by_use_case_id"))
        }
    })
}

/// Delete every review attached to an execution. Phase C5b — used by the
/// engine to cleanse reviews that were emitted by the LLM before a technical
/// failure (auth/network/provider/timeout) cut the run short. Returns the
/// number of rows deleted.
pub fn delete_for_execution(pool: &DbPool, execution_id: &str) -> Result<usize, AppError> {
    timed_query!("manual_reviews", "manual_reviews::delete_for_execution", {
        let conn = pool.get()?;
        let count = conn.execute(
            "DELETE FROM persona_manual_reviews WHERE execution_id = ?1",
            params![execution_id],
        )? as usize;
        Ok(count)
    })
}

pub fn get_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<PersonaManualReview>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_by_execution", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_manual_reviews
             WHERE execution_id = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![execution_id], row_to_review)?;
        Ok(collect_rows(rows, "manual_reviews::get_by_execution"))
    })
}

pub fn update_status(
    pool: &DbPool,
    id: &str,
    status: ManualReviewStatus,
    reviewer_notes: Option<String>,
) -> Result<(), AppError> {
    timed_query!("manual_reviews", "manual_reviews::update_status", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        // Fetch current status and validate the transition
        let current = get_by_id(pool, id)?;
        current.status.validate_transition(status).map_err(AppError::Validation)?;

        let resolved_at = match status {
            ManualReviewStatus::Approved | ManualReviewStatus::Rejected | ManualReviewStatus::Resolved => Some(now.clone()),
            ManualReviewStatus::Pending => None,
        };

        let rows = conn.execute(
            "UPDATE persona_manual_reviews
             SET status = ?1,
                 reviewer_notes = COALESCE(?2, reviewer_notes),
                 resolved_at = COALESCE(?3, resolved_at),
                 updated_at = ?4
             WHERE id = ?5",
            params![status.as_str(), reviewer_notes, resolved_at, now, id],
        )?;

        if rows == 0 {
            return Err(AppError::NotFound(format!("Manual review {id}")));
        }

        Ok(())
    })
}

pub fn get_pending_count(
    pool: &DbPool,
    persona_id: Option<&str>,
) -> Result<i64, AppError> {
    timed_query!("manual_reviews", "manual_reviews::get_pending_count", {
        let conn = pool.get()?;

        if let Some(pid) = persona_id {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM persona_manual_reviews
                 WHERE status = 'pending' AND persona_id = ?1",
                params![pid],
                |row| row.get(0),
            )?;
            Ok(count)
        } else {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM persona_manual_reviews WHERE status = 'pending'",
                [],
                |row| row.get(0),
            )?;
            Ok(count)
        }
    })
}

// -- Review Messages ---------------------------------------------

pub fn create_message(
    pool: &DbPool,
    input: CreateReviewMessageInput,
) -> Result<ReviewMessage, AppError> {
    timed_query!("manual_reviews", "manual_reviews::create_message", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO review_messages (id, review_id, role, content, metadata, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, input.review_id, input.role, input.content, input.metadata, now],
        )?;

        conn.query_row(
            "SELECT * FROM review_messages WHERE id = ?1",
            params![id],
            row_to_message,
        )
        .map_err(AppError::Database)
    })
}

pub fn list_messages(
    pool: &DbPool,
    review_id: &str,
) -> Result<Vec<ReviewMessage>, AppError> {
    timed_query!("manual_reviews", "manual_reviews::list_messages", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM review_messages WHERE review_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![review_id], row_to_message)?;
        Ok(collect_rows(rows, "review_messages::list"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::{core::personas, execution::executions};

    fn setup_persona_and_execution(pool: &DbPool) -> (String, String) {
        let persona = personas::create(
            pool,
            CreatePersonaInput {
                name: "Review Test Agent".into(),
                system_prompt: "You are a test agent.".into(),
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

        let exec = executions::create(pool, &persona.id, None, None, None, None).unwrap();
        (persona.id, exec.id)
    }

    #[test]
    fn test_manual_review_crud() {
        let pool = init_test_db().unwrap();
        let (persona_id, execution_id) = setup_persona_and_execution(&pool);

        // Create review
        let review = create(
            &pool,
            CreateManualReviewInput {
                execution_id: execution_id.clone(),
                persona_id: persona_id.clone(),
                title: "Check output quality".into(),
                description: Some("Review the generated output".into()),
                severity: Some("warning".into()),
                context_data: Some(r#"{"key":"value"}"#.into()),
                suggested_actions: Some("Verify manually".into()),
                use_case_id: None,
            },
        )
        .unwrap();
        assert_eq!(review.status, ManualReviewStatus::Pending);
        assert_eq!(review.severity, "warning");
        assert_eq!(review.title, "Check output quality");
        assert_eq!(review.persona_id, persona_id);
        assert_eq!(review.execution_id, execution_id);

        // Get by id
        let fetched = get_by_id(&pool, &review.id).unwrap();
        assert_eq!(fetched.id, review.id);

        // Get by persona
        let by_persona = get_by_persona(&pool, &persona_id, None).unwrap();
        assert_eq!(by_persona.len(), 1);

        // Get by persona with status filter
        let pending = get_by_persona(&pool, &persona_id, Some("pending")).unwrap();
        assert_eq!(pending.len(), 1);
        let resolved = get_by_persona(&pool, &persona_id, Some("resolved")).unwrap();
        assert_eq!(resolved.len(), 0);

        // Get by execution
        let by_exec = get_by_execution(&pool, &execution_id).unwrap();
        assert_eq!(by_exec.len(), 1);

        // Get pending count
        let count = get_pending_count(&pool, Some(&persona_id)).unwrap();
        assert_eq!(count, 1);
        let count_all = get_pending_count(&pool, None).unwrap();
        assert_eq!(count_all, 1);

        // Update status
        update_status(&pool, &review.id, ManualReviewStatus::Approved, Some("Looks good".into())).unwrap();
        let updated = get_by_id(&pool, &review.id).unwrap();
        assert_eq!(updated.status, ManualReviewStatus::Approved);
        assert_eq!(updated.reviewer_notes, Some("Looks good".into()));
        assert!(updated.resolved_at.is_some(), "resolved_at should be set when status is resolved");

        // Pending count should now be 0
        let count_after = get_pending_count(&pool, Some(&persona_id)).unwrap();
        assert_eq!(count_after, 0);
    }

    #[test]
    fn test_manual_review_default_severity() {
        let pool = init_test_db().unwrap();
        let (persona_id, execution_id) = setup_persona_and_execution(&pool);

        let review = create(
            &pool,
            CreateManualReviewInput {
                execution_id,
                persona_id,
                title: "Simple review".into(),
                description: None,
                severity: None,
                context_data: None,
                suggested_actions: None,
                use_case_id: None,
            },
        )
        .unwrap();
        assert_eq!(review.severity, "info");
    }

    #[test]
    fn test_manual_review_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_by_id(&pool, "nonexistent");
        assert!(result.is_err());
    }
}
