//! Export of workspace knowledge entries and adoptions.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// Collect workspaces with their knowledge library and adoption cells.
/// `filter_ids: None` = all workspaces; `Some(ids)` = exactly those.
/// Adoption is filtered to `bundled_project_ids` so the bundle never carries
/// cells pointing at projects that don't travel with it.
pub(crate) fn collect_workspace_knowledge_exports(
    pool: &DbPool,
    filter_ids: Option<&[String]>,
    bundled_project_ids: &[String],
    export_warnings: &mut Vec<String>,
) -> Result<Vec<WorkspaceKnowledgeExport>, AppError> {
    if filter_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;

    type WorkspaceRow = (String, String, Option<String>, Option<String>);
    let map_workspace = |r: &rusqlite::Row<'_>| -> rusqlite::Result<WorkspaceRow> {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    };

    let workspace_rows: Vec<WorkspaceRow> = match filter_ids {
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
            out
        }
        Some(ids) => {
            let mut seen = std::collections::HashSet::new();
            let mut out = Vec::new();
            for id in ids {
                if !seen.insert(id.clone()) {
                    continue;
                }
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, color, description FROM dev_workspaces WHERE id = ?1",
                    )
                    .map_err(AppError::Database)?;
                let mut rows = stmt
                    .query_map([id.as_str()], map_workspace)
                    .map_err(AppError::Database)?;
                if let Some(row) = rows.next() {
                    out.push(row.map_err(AppError::Database)?);
                }
            }
            out
        }
    };

    let mut exports = Vec::with_capacity(workspace_rows.len());
    for (id, name, color, description) in workspace_rows {
        // ALL statuses travel — the lifecycle (observed → adopted /
        // deprecated / rejected) is itself the data being ported.
        let knowledge = query_rows(
            &conn,
            "SELECT id, kind, title, statement, detail_md, topic, abstraction, ftype, \
                    durability, governing_id, evidence_count, applicability, status, \
                    origin_project_id, provenance, confidence, dedup_key, superseded_by, \
                    harvest_scope, valid_from, valid_to, decided_at, created_at, updated_at \
             FROM workspace_knowledge WHERE workspace_id = ?1 ORDER BY created_at",
            &id,
            |r| {
                Ok(WorkspaceKnowledgeEntryExport {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    title: r.get(2)?,
                    statement: r.get(3)?,
                    detail_md: r.get(4)?,
                    topic: r.get(5)?,
                    abstraction: r.get(6)?,
                    ftype: r.get(7)?,
                    durability: r.get(8)?,
                    governing_id: r.get(9)?,
                    evidence_count: r.get(10)?,
                    applicability: r.get(11)?,
                    status: r.get(12)?,
                    origin_project_id: r.get(13)?,
                    provenance: r.get(14)?,
                    confidence: r.get(15)?,
                    dedup_key: r.get(16)?,
                    superseded_by: r.get(17)?,
                    harvest_scope: r.get(18)?,
                    valid_from: r.get(19)?,
                    valid_to: r.get(20)?,
                    decided_at: r.get(21)?,
                    created_at: r.get(22)?,
                    updated_at: r.get(23)?,
                })
            },
        )?;
        push_truncation_warning(
            export_warnings,
            "knowledge entries",
            MAX_KNOWLEDGE_ENTRIES.min(knowledge.len()),
            knowledge.len(),
            &format!("Workspace '{name}'"),
        );
        let knowledge: Vec<WorkspaceKnowledgeEntryExport> =
            knowledge.into_iter().take(MAX_KNOWLEDGE_ENTRIES).collect();

        let adoption_all = query_rows(
            &conn,
            "SELECT a.practice_id, a.project_id, a.state, a.note, a.last_verified_at \
             FROM workspace_practice_adoption a \
             JOIN workspace_knowledge k ON k.id = a.practice_id \
             WHERE k.workspace_id = ?1",
            &id,
            |r| {
                Ok(WorkspaceAdoptionExport {
                    practice_id: r.get(0)?,
                    project_id: r.get(1)?,
                    state: r.get(2)?,
                    note: r.get(3)?,
                    last_verified_at: r.get(4)?,
                })
            },
        )?;
        let adoption: Vec<WorkspaceAdoptionExport> = adoption_all
            .into_iter()
            .filter(|a| bundled_project_ids.contains(&a.project_id))
            .collect();

        exports.push(WorkspaceKnowledgeExport {
            id,
            name,
            color,
            description,
            knowledge,
            adoption,
        });
    }

    Ok(exports)
}
