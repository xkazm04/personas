//! Export of workspace rows.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`; the
//! knowledge-entry and adoption-cell sections were dropped when the in-app
//! Workspace Knowledge library was retired.

use super::*;

/// Collect workspace rows. `filter_ids: None` = all workspaces; `Some(ids)` =
/// exactly those, where an EMPTY slice means none.
pub(crate) fn collect_workspace_exports(
    pool: &DbPool,
    filter_ids: Option<&[String]>,
) -> Result<Vec<WorkspaceExport>, AppError> {
    if filter_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;

    let map_workspace = |r: &rusqlite::Row<'_>| -> rusqlite::Result<WorkspaceExport> {
        Ok(WorkspaceExport {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            description: r.get(3)?,
        })
    };

    match filter_ids {
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, color, description FROM dev_workspaces ORDER BY created_at",
                )
                .map_err(AppError::Database)?;
            let rows = stmt
                .query_map([], map_workspace)
                .map_err(AppError::Database)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::Database)?);
            }
            Ok(out)
        }
        Some(ids) => {
            let mut seen = std::collections::HashSet::new();
            let mut out = Vec::new();
            let mut stmt = conn
                .prepare("SELECT id, name, color, description FROM dev_workspaces WHERE id = ?1")
                .map_err(AppError::Database)?;
            for id in ids {
                if !seen.insert(id.clone()) {
                    continue;
                }
                let mut rows = stmt
                    .query_map([id.as_str()], map_workspace)
                    .map_err(AppError::Database)?;
                if let Some(row) = rows.next() {
                    out.push(row.map_err(AppError::Database)?);
                }
            }
            Ok(out)
        }
    }
}
