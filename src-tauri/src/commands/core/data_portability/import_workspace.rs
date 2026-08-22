//! Import of workspace knowledge entries and adoptions.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// Import workspaces + their knowledge libraries. Faithful: ALL statuses
/// (including `rejected`) and every lifecycle column travel. Target workspace
/// matched by id first, then name (case-insensitive); created with the
/// original uuid when absent. Entries dedup by `dedup_key` within the target
/// workspace; NULL-key rows dedup by (kind, title).
pub(crate) fn import_workspace_knowledge(
    tx: &rusqlite::Transaction<'_>,
    bundle: &PortabilityBundle,
    now: &str,
    result: &mut PortabilityImportResult,
    workspace_id_map: &mut HashMap<String, String>,
    knowledge_id_map: &mut HashMap<String, String>,
) {
    for ws in &bundle.workspace_knowledge {
        let target_ws: Option<String> =
            if row_exists(tx, "SELECT 1 FROM dev_workspaces WHERE id = ?1", &ws.id) {
                Some(ws.id.clone())
            } else if let Ok(id) = tx.query_row(
                "SELECT id FROM dev_workspaces WHERE name = ?1 COLLATE NOCASE",
                [ws.name.as_str()],
                |r| r.get::<_, String>(0),
            ) {
                Some(id)
            } else {
                match tx.execute(
                "INSERT INTO dev_workspaces (id, name, color, description, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?5)",
                rusqlite::params![ws.id, ws.name, ws.color, ws.description, now],
            ) {
                Ok(_) => Some(ws.id.clone()),
                Err(e) => {
                    result.warnings.push(format!("Workspace '{}': {e}", ws.name));
                    None
                }
            }
            };
        let Some(target_ws) = target_ws else { continue };
        workspace_id_map.insert(ws.id.clone(), target_ws.clone());

        for k in &ws.knowledge {
            // Same row already present (re-import / resolution pass).
            if row_exists(tx, "SELECT 1 FROM workspace_knowledge WHERE id = ?1", &k.id) {
                knowledge_id_map.insert(k.id.clone(), k.id.clone());
                result.knowledge_skipped_duplicates += 1;
                continue;
            }
            // Dedup within the target workspace.
            let existing: Option<String> = if let Some(dk) = &k.dedup_key {
                tx.query_row(
                    "SELECT id FROM workspace_knowledge WHERE workspace_id = ?1 AND dedup_key = ?2",
                    rusqlite::params![target_ws, dk],
                    |r| r.get(0),
                )
                .ok()
            } else {
                tx.query_row(
                    "SELECT id FROM workspace_knowledge WHERE workspace_id = ?1 AND kind = ?2 \
                         AND title = ?3 COLLATE NOCASE",
                    rusqlite::params![target_ws, k.kind, k.title],
                    |r| r.get(0),
                )
                .ok()
            };
            if let Some(existing_id) = existing {
                knowledge_id_map.insert(k.id.clone(), existing_id);
                result.knowledge_skipped_duplicates += 1;
                continue;
            }

            // origin_project_id / governing_id / superseded_by are advisory
            // soft refs — kept as exported whether or not they resolve here.
            match tx.execute(
                "INSERT INTO workspace_knowledge (id, workspace_id, kind, title, statement, \
                     detail_md, topic, abstraction, ftype, durability, governing_id, \
                     evidence_count, applicability, status, origin_project_id, provenance, \
                     confidence, dedup_key, superseded_by, harvest_scope, valid_from, valid_to, \
                     decided_at, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,\
                     ?20,?21,?22,?23,?24,?25)",
                rusqlite::params![
                    k.id,
                    target_ws,
                    k.kind,
                    k.title,
                    k.statement,
                    k.detail_md,
                    k.topic,
                    k.abstraction,
                    k.ftype,
                    k.durability,
                    k.governing_id,
                    k.evidence_count,
                    k.applicability,
                    k.status,
                    k.origin_project_id,
                    k.provenance,
                    k.confidence,
                    k.dedup_key,
                    k.superseded_by,
                    k.harvest_scope,
                    k.valid_from,
                    k.valid_to,
                    k.decided_at,
                    k.created_at,
                    k.updated_at,
                ],
            ) {
                Ok(_) => {
                    knowledge_id_map.insert(k.id.clone(), k.id.clone());
                    result.knowledge_imported += 1;
                }
                Err(e) => result
                    .warnings
                    .push(format!("Knowledge '{}': {e}", k.title)),
            }
        }
    }
}
