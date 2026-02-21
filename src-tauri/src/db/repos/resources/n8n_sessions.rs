use rusqlite::{params, Row};

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

    // Build SET clause dynamically to only update provided fields
    let mut sets = vec!["updated_at = ?1".to_string()];
    let mut param_idx = 2u32;
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.workflow_name {
        sets.push(format!("workflow_name = ?{param_idx}"));
        values.push(Box::new(v.clone()));
        param_idx += 1;
    }
    if let Some(ref v) = input.status {
        sets.push(format!("status = ?{param_idx}"));
        values.push(Box::new(v.clone()));
        param_idx += 1;
    }
    if let Some(ref v) = input.parser_result {
        sets.push(format!("parser_result = ?{param_idx}"));
        values.push(Box::new(v.clone()));
        param_idx += 1;
    }
    if let Some(ref v) = input.draft_json {
        sets.push(format!("draft_json = ?{param_idx}"));
        values.push(Box::new(v.clone()));
        param_idx += 1;
    }
    if let Some(ref v) = input.user_answers {
        sets.push(format!("user_answers = ?{param_idx}"));
        values.push(Box::new(v.clone()));
        param_idx += 1;
    }
    if let Some(ref v) = input.step {
        sets.push(format!("step = ?{param_idx}"));
        values.push(Box::new(v.clone()));
        param_idx += 1;
    }
    if let Some(ref v) = input.error {
        sets.push(format!("error = ?{param_idx}"));
        values.push(Box::new(v.clone()));
        param_idx += 1;
    }
    if let Some(ref v) = input.persona_id {
        sets.push(format!("persona_id = ?{param_idx}"));
        values.push(Box::new(v.clone()));
        param_idx += 1;
    }

    // id is the last param
    let sql = format!(
        "UPDATE n8n_transform_sessions SET {} WHERE id = ?{param_idx}",
        sets.join(", ")
    );
    values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|b| b.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get(pool, id)
}

/// Mark sessions stuck in 'transforming'/'analyzing' as 'failed'.
/// Called at startup — their CLI processes died when the app last exited.
pub fn recover_interrupted_sessions(pool: &DbPool) -> Result<u32, AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let count = conn.execute(
        "UPDATE n8n_transform_sessions
         SET status = 'failed',
             error = 'App closed during transform — click Retry to resume',
             updated_at = ?1
         WHERE status IN ('transforming', 'analyzing')",
        params![now],
    )?;
    Ok(count as u32)
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
