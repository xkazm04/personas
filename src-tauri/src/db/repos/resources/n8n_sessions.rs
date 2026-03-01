use rusqlite::{named_params, params, Row};

use crate::db::models::{CreateN8nSessionInput, N8nTransformSession, UpdateN8nSessionInput};
use crate::db::DbPool;
use crate::error::AppError;

// ── Row mapper ────────────────────────────────────────────────

fn row_to_session(row: &Row) -> rusqlite::Result<N8nTransformSession> {
    Ok(N8nTransformSession {
        id: row.get("id")?,
        workflow_name: row.get("workflow_name")?,
        status: row.get("status")?,
        raw_workflow_json: row.get("raw_workflow_json")?,
        parser_result: row.get("parser_result")?,
        draft_json: row.get("draft_json")?,
        user_answers: row.get("user_answers")?,
        step: row.get("step")?,
        error: row.get("error")?,
        persona_id: row.get("persona_id")?,
        transform_id: row.get("transform_id")?,
        questions_json: row.get("questions_json")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// ── CRUD ──────────────────────────────────────────────────────

pub fn create(
    pool: &DbPool,
    input: &CreateN8nSessionInput,
) -> Result<N8nTransformSession, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO n8n_transform_sessions
            (id, workflow_name, status, raw_workflow_json, step, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.workflow_name, input.status, input.raw_workflow_json, input.step, now, now],
    )?;
    get(pool, &id)
}

pub fn get(pool: &DbPool, id: &str) -> Result<N8nTransformSession, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM n8n_transform_sessions WHERE id = ?1",
        params![id],
        row_to_session,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("N8nTransformSession {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn list(pool: &DbPool) -> Result<Vec<N8nTransformSession>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM n8n_transform_sessions ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_session)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: &UpdateN8nSessionInput,
) -> Result<N8nTransformSession, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    // Static query: each column uses IIF(:flag, :value, existing) to conditionally update.
    // This avoids dynamic SQL with manual parameter index tracking.
    conn.execute(
        "UPDATE n8n_transform_sessions SET
            updated_at      = :now,
            workflow_name    = IIF(:has_workflow_name,  :workflow_name,  workflow_name),
            status           = IIF(:has_status,         :status,         status),
            parser_result    = IIF(:has_parser_result,  :parser_result,  parser_result),
            draft_json       = IIF(:has_draft_json,     :draft_json,     draft_json),
            user_answers     = IIF(:has_user_answers,   :user_answers,   user_answers),
            step             = IIF(:has_step,           :step,           step),
            error            = IIF(:has_error,          :error,          error),
            persona_id       = IIF(:has_persona_id,     :persona_id,     persona_id),
            transform_id     = IIF(:has_transform_id,   :transform_id,   transform_id),
            questions_json   = IIF(:has_questions_json,  :questions_json,  questions_json)
         WHERE id = :id",
        named_params! {
            ":now":               now,
            ":id":                id,
            ":has_workflow_name":  input.workflow_name.is_some(),
            ":workflow_name":     input.workflow_name.as_deref(),
            ":has_status":        input.status.is_some(),
            ":status":            input.status.as_deref(),
            ":has_parser_result": input.parser_result.is_some(),
            ":parser_result":     input.parser_result.as_ref().and_then(|v| v.as_deref()),
            ":has_draft_json":    input.draft_json.is_some(),
            ":draft_json":        input.draft_json.as_ref().and_then(|v| v.as_deref()),
            ":has_user_answers":  input.user_answers.is_some(),
            ":user_answers":      input.user_answers.as_ref().and_then(|v| v.as_deref()),
            ":has_step":          input.step.is_some(),
            ":step":              input.step.as_deref(),
            ":has_error":         input.error.is_some(),
            ":error":             input.error.as_ref().and_then(|v| v.as_deref()),
            ":has_persona_id":    input.persona_id.is_some(),
            ":persona_id":        input.persona_id.as_ref().and_then(|v| v.as_deref()),
            ":has_transform_id":  input.transform_id.is_some(),
            ":transform_id":      input.transform_id.as_ref().and_then(|v| v.as_deref()),
            ":has_questions_json": input.questions_json.is_some(),
            ":questions_json":    input.questions_json.as_ref().and_then(|v| v.as_deref()),
        },
    )?;

    get(pool, id)
}

/// Mark sessions stuck in 'transforming'/'analyzing' as 'failed' and return
/// the `transform_id`s that were active so the caller can clear in-memory job
/// state (dead cancellation tokens, expired status channels, etc.).
///
/// Sessions in 'awaiting_answers' are preserved — they have persisted questions
/// and can resume without re-running the transform.
/// Called at startup — their CLI processes died when the app last exited.
pub fn recover_interrupted_sessions(pool: &DbPool) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;

    // Collect transform_ids of sessions we're about to mark as failed
    let mut stmt = conn.prepare(
        "SELECT transform_id FROM n8n_transform_sessions
         WHERE status IN ('transforming', 'analyzing')
           AND transform_id IS NOT NULL",
    )?;
    let transform_ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE n8n_transform_sessions
         SET status = 'failed',
             error = 'App closed during transform — click Retry to resume',
             updated_at = ?1
         WHERE status IN ('transforming', 'analyzing')",
        params![now],
    )?;
    Ok(transform_ids)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM n8n_transform_sessions WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_session_crud() {
        let pool = init_test_db().unwrap();

        // Create
        let session = create(
            &pool,
            &CreateN8nSessionInput {
                workflow_name: "Email Manager".into(),
                raw_workflow_json: r#"{"nodes":[]}"#.into(),
                step: "upload".into(),
                status: "draft".into(),
            },
        )
        .unwrap();
        assert_eq!(session.workflow_name, "Email Manager");
        assert_eq!(session.status, "draft");
        assert_eq!(session.step, "upload");

        // Get
        let fetched = get(&pool, &session.id).unwrap();
        assert_eq!(fetched.id, session.id);

        // List
        let sessions = list(&pool).unwrap();
        assert_eq!(sessions.len(), 1);

        // Update
        let updated = update(
            &pool,
            &session.id,
            &UpdateN8nSessionInput {
                status: Some("analyzing".into()),
                step: Some("analyze".into()),
                parser_result: Some(Some(r#"{"tools":[]}"#.into())),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.status, "analyzing");
        assert_eq!(updated.step, "analyze");
        assert!(updated.parser_result.is_some());

        // Delete
        let deleted = delete(&pool, &session.id).unwrap();
        assert!(deleted);
        assert!(get(&pool, &session.id).is_err());
    }
}
