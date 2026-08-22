use crate::models::WorkspacePatternEdge;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::params;

use super::knowledge::get_knowledge_by_id;

/// Closed relation vocabulary — must match the DB CHECK exactly.
pub const PATTERN_EDGE_RELS: &[&str] = &[
    "governs",
    "composes_with",
    "prerequisite",
    "conflicts_with",
    "supersedes",
    "extends",
];

/// Every edge whose endpoints both live in this workspace's library.
pub fn list_pattern_edges(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<WorkspacePatternEdge>, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::list_pattern_edges", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT e.from_id, e.to_id, e.rel, e.note, e.created_at
             FROM workspace_pattern_edges e
             JOIN workspace_knowledge f ON f.id = e.from_id
             WHERE f.workspace_id = ?1
             ORDER BY e.created_at",
        )?;
        let rows = stmt
            .query_map(params![workspace_id], |r| {
                Ok(WorkspacePatternEdge {
                    from_id: r.get(0)?,
                    to_id: r.get(1)?,
                    rel: r.get(2)?,
                    note: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// Create (or refresh the note of) one edge. Self-edges and unknown relations
/// are refused at the door — the DB CHECK is the backstop, not the message.
pub fn set_pattern_edge(
    pool: &DbPool,
    from_id: &str,
    to_id: &str,
    rel: &str,
    note: Option<&str>,
) -> Result<WorkspacePatternEdge, AppError> {
    if from_id == to_id {
        return Err(AppError::Validation(
            "A pattern cannot relate to itself".into(),
        ));
    }
    if !PATTERN_EDGE_RELS.contains(&rel) {
        return Err(AppError::Validation(format!(
            "Unknown relation '{rel}' — expected one of {}",
            PATTERN_EDGE_RELS.join(", ")
        )));
    }
    // Both endpoints must exist (and the error should say which is missing).
    get_knowledge_by_id(pool, from_id)?;
    get_knowledge_by_id(pool, to_id)?;
    timed_query!("dev_workspaces", "dev_workspaces::set_pattern_edge", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO workspace_pattern_edges (from_id, to_id, rel, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(from_id, to_id, rel) DO UPDATE SET note = excluded.note",
            params![from_id, to_id, rel, note, now],
        )?;
        Ok(WorkspacePatternEdge {
            from_id: from_id.to_string(),
            to_id: to_id.to_string(),
            rel: rel.to_string(),
            note: note.map(str::to_string),
            created_at: now,
        })
    })
}

pub fn delete_pattern_edge(
    pool: &DbPool,
    from_id: &str,
    to_id: &str,
    rel: &str,
) -> Result<(), AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::delete_pattern_edge", {
        let conn = pool.get()?;
        conn.execute(
            "DELETE FROM workspace_pattern_edges WHERE from_id = ?1 AND to_id = ?2 AND rel = ?3",
            params![from_id, to_id, rel],
        )?;
        Ok(())
    })
}

// ============================================================================
// Pattern fabric F1 — playbooks (docs/concepts/pattern-fabric.md S3)
// ============================================================================
