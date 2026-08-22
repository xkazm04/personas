use crate::models::WorkspaceKnowledgeEvidence;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

use super::knowledge::validate_one_of;

fn row_to_evidence(row: &Row) -> rusqlite::Result<WorkspaceKnowledgeEvidence> {
    Ok(WorkspaceKnowledgeEvidence {
        id: row.get("id")?,
        knowledge_id: row.get("knowledge_id")?,
        project_id: row.get("project_id")?,
        refs: row.get("refs")?,
        quote: row.get("quote")?,
        source: row.get("source")?,
        recorded_at: row.get("recorded_at")?,
        verified_at: row.get("verified_at")?,
    })
}

/// Evidence rows for one knowledge item, newest first.
pub fn list_knowledge_evidence(
    pool: &DbPool,
    knowledge_id: &str,
) -> Result<Vec<WorkspaceKnowledgeEvidence>, AppError> {
    timed_query!(
        "dev_workspaces",
        "dev_workspaces::list_knowledge_evidence",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM workspace_knowledge_evidence
             WHERE knowledge_id = ?1 ORDER BY recorded_at DESC",
            )?;
            let rows = stmt.query_map(params![knowledge_id], row_to_evidence)?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        }
    )
}

/// Add one evidence row. `source` is closed at the door ('harvest' | 'verify'
/// | 'manual'); the knowledge row must exist (FK).
pub fn add_knowledge_evidence(
    pool: &DbPool,
    knowledge_id: &str,
    project_id: Option<&str>,
    refs: &[String],
    quote: Option<&str>,
    source: &str,
) -> Result<WorkspaceKnowledgeEvidence, AppError> {
    validate_one_of(source, &["harvest", "verify", "manual"], "evidence source")?;
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let refs_json = serde_json::to_string(refs)
        .map_err(|e| AppError::Internal(format!("serialize evidence refs: {e}")))?;
    conn.execute(
        "INSERT INTO workspace_knowledge_evidence
             (id, knowledge_id, project_id, refs, quote, source, recorded_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, knowledge_id, project_id, refs_json, quote, source, now],
    )?;
    conn.query_row(
        "SELECT * FROM workspace_knowledge_evidence WHERE id = ?1",
        params![id],
        row_to_evidence,
    )
    .map_err(Into::into)
}

pub fn delete_knowledge_evidence(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM workspace_knowledge_evidence WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}
