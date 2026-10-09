//! `doc_status` - read side only. The doc-rot scan
//! (`app_lib::commands::infrastructure::doc_rot`) owns every write and the
//! verdict vocabulary (`broken > stale > unverifiable > clean`); this reads the
//! rows back for Lifecycle's `docs` step health and its step detail.

use rusqlite::params;

use crate::DbPool;
use personas_core::error::AppError;

const DOC_STATUS_COLUMNS: &str =
    "doc_path, coupled_scope, dirty_since, changed_sources, broken_refs, scanned_at";

/// One `doc_status` row as stored (the JSON list columns still text).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocStatusRow {
    pub doc_path: String,
    /// `NULL` = unscoped: the scan could not couple the doc to any source.
    pub coupled_scope: Option<String>,
    pub dirty_since: Option<String>,
    pub changed_sources: Option<String>,
    pub broken_refs: Option<String>,
    pub scanned_at: String,
}

row_mapper!(row_to_doc_status -> DocStatusRow {
    doc_path, coupled_scope, dirty_since, changed_sources, broken_refs, scanned_at,
});

/// Every tracked doc of the project, by path.
pub fn list_doc_status(pool: &DbPool, project_id: &str) -> Result<Vec<DocStatusRow>, AppError> {
    timed_query!("doc_status", "doc_status::list_doc_status", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {DOC_STATUS_COLUMNS} FROM doc_status WHERE project_id = ?1 ORDER BY doc_path"
        ))?;
        let rows = stmt
            .query_map(params![project_id], row_to_doc_status)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_come_back_by_path_for_one_project_only() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        for (pid, doc, scope) in [
            ("p1", "docs/b.md", Some("[\"src/\"]")),
            ("p1", "README.md", None),
            ("p2", "docs/c.md", None),
        ] {
            conn.execute(
                "INSERT INTO doc_status (project_id, doc_path, coupled_scope, broken_refs)
                 VALUES (?1, ?2, ?3, '[]')",
                params![pid, doc, scope],
            )?;
        }
        drop(conn);
        let rows = list_doc_status(&pool, "p1")?;
        assert_eq!(
            rows.iter().map(|r| r.doc_path.as_str()).collect::<Vec<_>>(),
            ["README.md", "docs/b.md"]
        );
        assert!(rows[0].coupled_scope.is_none());
        assert_eq!(rows[1].broken_refs.as_deref(), Some("[]"));
        Ok(())
    }
}
