//! Import of workspace rows.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`; the
//! knowledge-library half was dropped when the in-app Workspace Knowledge
//! library was retired. A bundle written before that still carries
//! `knowledge` / `adoption` arrays per workspace — serde ignores them.

use super::*;

/// Import workspace rows. Target workspace matched by id first, then name
/// (case-insensitive); created with the original uuid when absent. Every
/// bundled id is recorded in `workspace_id_map` so bundled projects can be
/// re-pointed at the workspace they belonged to.
pub(crate) fn import_workspaces(
    tx: &rusqlite::Transaction<'_>,
    bundle: &PortabilityBundle,
    now: &str,
    result: &mut PortabilityImportResult,
    workspace_id_map: &mut HashMap<String, String>,
) {
    for ws in &bundle.workspaces {
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
        if let Some(target_ws) = target_ws {
            workspace_id_map.insert(ws.id.clone(), target_ws);
        }
    }
}
