use rusqlite::{params, Row};

use crate::db::models::ExecutionAnnotation;
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_annotation(row: &Row) -> rusqlite::Result<ExecutionAnnotation> {
    let tags_json: Option<String> = row.get("tags")?;
    let tags: Vec<String> = tags_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    Ok(ExecutionAnnotation {
        id: row.get("id")?,
        execution_id: row.get("execution_id")?,
        persona_id: row.get("persona_id")?,
        author: row.get("author")?,
        tags,
        note: row.get("note")?,
        starred: row.get::<_, i32>("starred")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Upsert an annotation for (execution_id, author). On conflict, overwrites
/// tags / note / starred and refreshes `updated_at`.
pub fn upsert(
    pool: &DbPool,
    execution_id: &str,
    persona_id: &str,
    author: &str,
    tags: &[String],
    note: Option<&str>,
    starred: bool,
) -> Result<ExecutionAnnotation, AppError> {
    timed_query!(
        "persona_execution_annotations",
        "persona_execution_annotations::upsert",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
            let starred_int = if starred { 1i32 } else { 0i32 };

            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO persona_execution_annotations
                    (id, execution_id, persona_id, author, tags, note, starred, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
                 ON CONFLICT(execution_id, author) DO UPDATE SET
                    tags       = excluded.tags,
                    note       = excluded.note,
                    starred    = excluded.starred,
                    updated_at = excluded.updated_at",
                params![
                    id,
                    execution_id,
                    persona_id,
                    author,
                    tags_json,
                    note,
                    starred_int,
                    now,
                ],
            )?;

            get_by_execution_and_author(pool, execution_id, author)?.ok_or_else(|| {
                AppError::Database(rusqlite::Error::QueryReturnedNoRows)
            })
        }
    )
}

pub fn get_by_execution_and_author(
    pool: &DbPool,
    execution_id: &str,
    author: &str,
) -> Result<Option<ExecutionAnnotation>, AppError> {
    timed_query!(
        "persona_execution_annotations",
        "persona_execution_annotations::get_by_execution_and_author",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_execution_annotations
                 WHERE execution_id = ?1 AND author = ?2 LIMIT 1",
            )?;
            let mut rows = stmt.query_map(params![execution_id, author], row_to_annotation)?;
            match rows.next() {
                Some(Ok(a)) => Ok(Some(a)),
                Some(Err(e)) => Err(AppError::Database(e)),
                None => Ok(None),
            }
        }
    )
}

pub fn list_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<ExecutionAnnotation>, AppError> {
    timed_query!(
        "persona_execution_annotations",
        "persona_execution_annotations::list_by_execution",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_execution_annotations
                 WHERE execution_id = ?1 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map(params![execution_id], row_to_annotation)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// All annotations for a persona — used by the activity filter (tag/starred)
/// and by ExecutionComparison's "auto-pick the last starred pair" feature.
pub fn list_by_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<ExecutionAnnotation>, AppError> {
    timed_query!(
        "persona_execution_annotations",
        "persona_execution_annotations::list_by_persona",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_execution_annotations
                 WHERE persona_id = ?1 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![persona_id], row_to_annotation)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!(
        "persona_execution_annotations",
        "persona_execution_annotations::delete",
        {
            let conn = pool.get()?;
            conn.execute(
                "DELETE FROM persona_execution_annotations WHERE id = ?1",
                params![id],
            )?;
            Ok(())
        }
    )
}
