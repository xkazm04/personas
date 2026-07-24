//! Repository for the Workspace Knowledge Center
//! (docs/plans/workspace-knowledge-center.md): `dev_workspaces` (project
//! grouping — the "org"), `workspace_knowledge` (governed cross-project
//! practice library) and `workspace_practice_adoption` (per-project adoption
//! state). Single workspace per project via nullable
//! `dev_projects.workspace_id`.
//!
//! Deliberately NOT part of `repos::dev_tools` — that module is already
//! ~6k lines; this mirrors the `fleet_decisions` split.

use rusqlite::{params, OptionalExtension, Row};

use crate::db::models::{
    DevProject, DevWorkspace, WorkspaceImportItem, WorkspaceKnowledge, WorkspacePracticeAdoption,
};
use crate::db::DbPool;
use crate::error::AppError;

pub const KNOWLEDGE_KINDS: [&str; 5] = ["pattern", "pitfall", "decision", "howto", "fact"];
pub const KNOWLEDGE_STATUSES: [&str; 5] =
    ["observed", "proposed", "adopted", "deprecated", "rejected"];
pub const ADOPTION_STATES: [&str; 5] = ["na", "proposed", "dispatched", "adopted", "diverged"];

// ============================================================================
// Row mappers
// ============================================================================

fn row_to_workspace(row: &Row) -> rusqlite::Result<DevWorkspace> {
    Ok(DevWorkspace {
        id: row.get("id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        description: row.get("description")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_knowledge(row: &Row) -> rusqlite::Result<WorkspaceKnowledge> {
    Ok(WorkspaceKnowledge {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        kind: row.get("kind")?,
        title: row.get("title")?,
        statement: row.get("statement")?,
        detail_md: row.get("detail_md")?,
        applicability: row.get("applicability")?,
        status: row.get("status")?,
        origin_project_id: row.get("origin_project_id")?,
        provenance: row.get("provenance")?,
        confidence: row.get("confidence")?,
        dedup_key: row.get("dedup_key")?,
        superseded_by: row.get("superseded_by")?,
        valid_from: row.get("valid_from")?,
        valid_to: row.get("valid_to")?,
        decided_at: row.get("decided_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_adoption(row: &Row) -> rusqlite::Result<WorkspacePracticeAdoption> {
    Ok(WorkspacePracticeAdoption {
        practice_id: row.get("practice_id")?,
        project_id: row.get("project_id")?,
        state: row.get("state")?,
        fleet_key: row.get("fleet_key")?,
        note: row.get("note")?,
        last_verified_at: row.get("last_verified_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn validate_one_of(value: &str, allowed: &[&str], label: &str) -> Result<(), AppError> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "Invalid {label} '{value}' — expected one of: {}",
            allowed.join(", ")
        )))
    }
}

// ============================================================================
// Workspaces
// ============================================================================

pub fn list_workspaces(pool: &DbPool) -> Result<Vec<DevWorkspace>, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::list_workspaces", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM dev_workspaces ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], row_to_workspace)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn get_workspace_by_id(pool: &DbPool, id: &str) -> Result<DevWorkspace, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::get_workspace_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_workspaces WHERE id = ?1",
            params![id],
            row_to_workspace,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Workspace {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn create_workspace(
    pool: &DbPool,
    name: &str,
    color: Option<&str>,
    description: Option<&str>,
) -> Result<DevWorkspace, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Workspace name cannot be empty".into()));
    }
    timed_query!("dev_workspaces", "dev_workspaces::create_workspace", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_workspaces (id, name, color, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, name.trim(), color, description, now],
        )?;
        get_workspace_by_id(pool, &id)
    })
}

pub fn update_workspace(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    color: Option<Option<&str>>,
    description: Option<Option<&str>>,
) -> Result<DevWorkspace, AppError> {
    if let Some(n) = name {
        if n.trim().is_empty() {
            return Err(AppError::Validation("Workspace name cannot be empty".into()));
        }
    }
    timed_query!("dev_workspaces", "dev_workspaces::update_workspace", {
        get_workspace_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(
            name.map(|s| s.trim().to_string()),
            "name",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            color.map(|o| o.map(|s| s.to_string())),
            "color",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            description.map(|o| o.map(|s| s.to_string())),
            "description",
            sets,
            param_idx,
            param_values,
            clone
        );

        let sql = format!(
            "UPDATE dev_workspaces SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );
        param_values.push(Box::new(id.to_string()));
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_workspace_by_id(pool, id)
    })
}

/// Delete a workspace. Member projects are unassigned — never deleted. The
/// workspace's knowledge and adoption rows go with it (explicit deletes:
/// SQLite FK cascade only fires with `PRAGMA foreign_keys=ON`, which we don't
/// rely on here).
pub fn delete_workspace(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::delete_workspace", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE dev_projects SET workspace_id = NULL WHERE workspace_id = ?1",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM workspace_practice_adoption WHERE practice_id IN
                 (SELECT id FROM workspace_knowledge WHERE workspace_id = ?1)",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM workspace_knowledge WHERE workspace_id = ?1",
            params![id],
        )?;
        let rows = tx.execute("DELETE FROM dev_workspaces WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Membership
// ============================================================================

/// Does a practice's applicability envelope match a project's tech stack?
///
/// Conservative-by-default: an item with no `languages`/`frameworks` filters
/// applies everywhere; when filters exist, the project's free-text
/// `tech_stack` must contain at least one entry (case-insensitive substring).
/// Arc-1 heuristic — richer RepoEvidence matching arrives with the harvest
/// engine.
fn applicability_matches(applicability: Option<&str>, tech_stack: Option<&str>) -> bool {
    let Some(raw) = applicability else { return true };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return true;
    };
    let mut filters: Vec<String> = Vec::new();
    for key in ["languages", "frameworks"] {
        if let Some(arr) = value.get(key).and_then(|v| v.as_array()) {
            filters.extend(
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_lowercase()),
            );
        }
    }
    if filters.is_empty() {
        return true;
    }
    let stack = tech_stack.unwrap_or("").to_lowercase();
    filters.iter().any(|f| !f.is_empty() && stack.contains(f))
}

/// Move a project into a workspace (or out of every one when `None`).
///
/// Keeps the adoption matrix consistent in the same transaction:
/// - leaving the old workspace deletes the project's adoption rows there,
/// - joining a workspace fans out its `adopted` practices as the project's
///   to-adopt queue (`proposed`, or `na` when applicability doesn't match).
pub fn assign_project(
    pool: &DbPool,
    project_id: &str,
    workspace_id: Option<&str>,
) -> Result<DevProject, AppError> {
    if let Some(ws) = workspace_id {
        get_workspace_by_id(pool, ws)?;
    }
    let project = crate::db::repos::dev_tools::get_project_by_id(pool, project_id)?;

    timed_query!("dev_workspaces", "dev_workspaces::assign_project", {
        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        if let Some(old_ws) = project.workspace_id.as_deref() {
            if Some(old_ws) != workspace_id {
                tx.execute(
                    "DELETE FROM workspace_practice_adoption
                     WHERE project_id = ?1 AND practice_id IN
                         (SELECT id FROM workspace_knowledge WHERE workspace_id = ?2)",
                    params![project_id, old_ws],
                )?;
            }
        }

        tx.execute(
            "UPDATE dev_projects SET workspace_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![workspace_id, now, project_id],
        )?;

        if let Some(new_ws) = workspace_id {
            let adopted: Vec<(String, Option<String>)> = {
                let mut stmt = tx.prepare(
                    "SELECT id, applicability FROM workspace_knowledge
                     WHERE workspace_id = ?1 AND status = 'adopted'",
                )?;
                let rows = stmt
                    .query_map(params![new_ws], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            for (practice_id, applicability) in adopted {
                let state = if applicability_matches(
                    applicability.as_deref(),
                    project.tech_stack.as_deref(),
                ) {
                    "proposed"
                } else {
                    "na"
                };
                tx.execute(
                    "INSERT OR IGNORE INTO workspace_practice_adoption
                         (practice_id, project_id, state, updated_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![practice_id, project_id, state, now],
                )?;
            }
        }

        tx.commit()?;
        crate::db::repos::dev_tools::get_project_by_id(pool, project_id)
    })
}

/// One-time import of the retired localStorage prototype. Idempotent on
/// workspace name (case-insensitive); unknown project ids are skipped
/// silently (the prototype may reference deleted projects).
pub fn import_local(
    pool: &DbPool,
    items: &[WorkspaceImportItem],
) -> Result<Vec<DevWorkspace>, AppError> {
    let mut imported = Vec::new();
    for item in items {
        if item.name.trim().is_empty() {
            continue;
        }
        let existing: Option<String> = {
            let conn = pool.get()?;
            conn.query_row(
                "SELECT id FROM dev_workspaces WHERE name = ?1 COLLATE NOCASE",
                params![item.name.trim()],
                |r| r.get(0),
            )
            .optional()?
        };
        let ws = match existing {
            Some(id) => get_workspace_by_id(pool, &id)?,
            None => create_workspace(pool, &item.name, item.color.as_deref(), None)?,
        };
        for project_id in &item.project_ids {
            // Only assign projects that exist and aren't already in a workspace
            // (an explicit in-app assignment wins over the legacy prototype).
            let current: Option<Option<String>> = {
                let conn = pool.get()?;
                conn.query_row(
                    "SELECT workspace_id FROM dev_projects WHERE id = ?1",
                    params![project_id],
                    |r| r.get(0),
                )
                .optional()?
            };
            if matches!(current, Some(None)) {
                assign_project(pool, project_id, Some(&ws.id))?;
            }
        }
        imported.push(ws);
    }
    Ok(imported)
}

// ============================================================================
// Knowledge
// ============================================================================

pub fn list_knowledge(
    pool: &DbPool,
    workspace_id: &str,
    status: Option<&str>,
) -> Result<Vec<WorkspaceKnowledge>, AppError> {
    if let Some(s) = status {
        validate_one_of(s, &KNOWLEDGE_STATUSES, "status")?;
    }
    timed_query!("workspace_knowledge", "dev_workspaces::list_knowledge", {
        let conn = pool.get()?;
        if let Some(status) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM workspace_knowledge WHERE workspace_id = ?1 AND status = ?2
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![workspace_id, status], row_to_knowledge)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM workspace_knowledge WHERE workspace_id = ?1
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![workspace_id], row_to_knowledge)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
        }
    })
}

pub fn get_knowledge_by_id(pool: &DbPool, id: &str) -> Result<WorkspaceKnowledge, AppError> {
    timed_query!("workspace_knowledge", "dev_workspaces::get_knowledge_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM workspace_knowledge WHERE id = ?1",
            params![id],
            row_to_knowledge,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Workspace knowledge {id}"))
            }
            other => AppError::Database(other),
        })
    })
}

/// Create a human-authored practice. Lands as `proposed` (the author is
/// nominating it); machine writers (harvest/miners, Arc 2) use a dedicated
/// ingest path that lands `observed` with agent provenance.
#[allow(clippy::too_many_arguments)]
pub fn create_knowledge(
    pool: &DbPool,
    workspace_id: &str,
    kind: &str,
    title: &str,
    statement: &str,
    detail_md: Option<&str>,
    applicability: Option<&str>,
    origin_project_id: Option<&str>,
) -> Result<WorkspaceKnowledge, AppError> {
    validate_one_of(kind, &KNOWLEDGE_KINDS, "kind")?;
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    if statement.trim().is_empty() {
        return Err(AppError::Validation("Statement cannot be empty".into()));
    }
    if let Some(json) = applicability {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| AppError::Validation(format!("Invalid applicability JSON: {e}")))?;
    }
    get_workspace_by_id(pool, workspace_id)?;

    timed_query!("workspace_knowledge", "dev_workspaces::create_knowledge", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let provenance = "{\"actor_kind\":\"human\"}";
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO workspace_knowledge
                 (id, workspace_id, kind, title, statement, detail_md, applicability,
                  status, origin_project_id, provenance, valid_from, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'proposed', ?8, ?9, ?10, ?10, ?10)",
            params![
                id,
                workspace_id,
                kind,
                title.trim(),
                statement.trim(),
                detail_md,
                applicability,
                origin_project_id,
                provenance,
                now
            ],
        )?;
        get_knowledge_by_id(pool, &id)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_knowledge(
    pool: &DbPool,
    id: &str,
    kind: Option<&str>,
    title: Option<&str>,
    statement: Option<&str>,
    detail_md: Option<Option<&str>>,
    applicability: Option<Option<&str>>,
) -> Result<WorkspaceKnowledge, AppError> {
    if let Some(k) = kind {
        validate_one_of(k, &KNOWLEDGE_KINDS, "kind")?;
    }
    if let Some(Some(json)) = applicability {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| AppError::Validation(format!("Invalid applicability JSON: {e}")))?;
    }
    timed_query!("workspace_knowledge", "dev_workspaces::update_knowledge", {
        get_knowledge_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(
            kind.map(|s| s.to_string()),
            "kind",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            title.map(|s| s.trim().to_string()),
            "title",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            statement.map(|s| s.trim().to_string()),
            "statement",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            detail_md.map(|o| o.map(|s| s.to_string())),
            "detail_md",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            applicability.map(|o| o.map(|s| s.to_string())),
            "applicability",
            sets,
            param_idx,
            param_values,
            clone
        );

        let sql = format!(
            "UPDATE workspace_knowledge SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );
        param_values.push(Box::new(id.to_string()));
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_knowledge_by_id(pool, id)
    })
}

/// The single governance gate. `decision`:
/// - `propose`   — nominate an `observed` item (machine-harvested) for review
/// - `adopt`     — adopt a `proposed` item; fans out the adoption queue to
///                 every member project (`proposed`/`na` by applicability)
/// - `reject`    — reject with retention (miners dedup against it)
/// - `deprecate` — retire an adopted item, optionally superseded by another
pub fn decide_knowledge(
    pool: &DbPool,
    id: &str,
    decision: &str,
    superseded_by: Option<&str>,
) -> Result<WorkspaceKnowledge, AppError> {
    let item = get_knowledge_by_id(pool, id)?;
    let new_status = match decision {
        "propose" => "proposed",
        "adopt" => "adopted",
        "reject" => "rejected",
        "deprecate" => "deprecated",
        other => {
            return Err(AppError::Validation(format!(
                "Invalid decision '{other}' — expected propose, adopt, reject or deprecate"
            )))
        }
    };
    if let Some(sup) = superseded_by {
        if decision != "deprecate" {
            return Err(AppError::Validation(
                "superseded_by is only valid with decision 'deprecate'".into(),
            ));
        }
        get_knowledge_by_id(pool, sup)?;
    }

    timed_query!("workspace_knowledge", "dev_workspaces::decide_knowledge", {
        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        tx.execute(
            "UPDATE workspace_knowledge
             SET status = ?1, decided_at = ?2, updated_at = ?2,
                 superseded_by = COALESCE(?3, superseded_by),
                 valid_to = CASE WHEN ?1 IN ('deprecated','rejected') THEN ?2 ELSE valid_to END
             WHERE id = ?4",
            params![new_status, now, superseded_by, id],
        )?;

        if new_status == "adopted" {
            let members: Vec<(String, Option<String>)> = {
                let mut stmt = tx.prepare(
                    "SELECT id, tech_stack FROM dev_projects WHERE workspace_id = ?1",
                )?;
                let rows = stmt
                    .query_map(params![item.workspace_id], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            for (project_id, tech_stack) in members {
                let state = if applicability_matches(
                    item.applicability.as_deref(),
                    tech_stack.as_deref(),
                ) {
                    "proposed"
                } else {
                    "na"
                };
                tx.execute(
                    "INSERT OR IGNORE INTO workspace_practice_adoption
                         (practice_id, project_id, state, updated_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![id, project_id, state, now],
                )?;
            }
        }

        tx.commit()?;
        get_knowledge_by_id(pool, id)
    })
}

pub fn delete_knowledge(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("workspace_knowledge", "dev_workspaces::delete_knowledge", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM workspace_practice_adoption WHERE practice_id = ?1",
            params![id],
        )?;
        let rows = tx.execute("DELETE FROM workspace_knowledge WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Adoption matrix
// ============================================================================

pub fn list_adoption(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<WorkspacePracticeAdoption>, AppError> {
    timed_query!("workspace_practice_adoption", "dev_workspaces::list_adoption", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT a.* FROM workspace_practice_adoption a
             JOIN workspace_knowledge k ON k.id = a.practice_id
             WHERE k.workspace_id = ?1
             ORDER BY a.updated_at DESC",
        )?;
        let rows = stmt.query_map(params![workspace_id], row_to_adoption)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn set_adoption(
    pool: &DbPool,
    practice_id: &str,
    project_id: &str,
    state: &str,
    note: Option<&str>,
    fleet_key: Option<&str>,
) -> Result<WorkspacePracticeAdoption, AppError> {
    validate_one_of(state, &ADOPTION_STATES, "state")?;
    get_knowledge_by_id(pool, practice_id)?;
    timed_query!("workspace_practice_adoption", "dev_workspaces::set_adoption", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO workspace_practice_adoption
                 (practice_id, project_id, state, note, fleet_key, last_verified_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?3 = 'adopted' THEN ?6 ELSE NULL END, ?6)
             ON CONFLICT(practice_id, project_id) DO UPDATE SET
                 state = excluded.state,
                 note = COALESCE(excluded.note, note),
                 fleet_key = COALESCE(excluded.fleet_key, fleet_key),
                 last_verified_at = CASE WHEN excluded.state = 'adopted'
                                         THEN excluded.updated_at
                                         ELSE last_verified_at END,
                 updated_at = excluded.updated_at",
            params![practice_id, project_id, state, note, fleet_key, now],
        )?;
        conn.query_row(
            "SELECT * FROM workspace_practice_adoption WHERE practice_id = ?1 AND project_id = ?2",
            params![practice_id, project_id],
            row_to_adoption,
        )
        .map_err(AppError::Database)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applicability_matching() {
        // No envelope / no filters → applies everywhere.
        assert!(applicability_matches(None, Some("React, TypeScript")));
        assert!(applicability_matches(Some("{}"), None));
        assert!(applicability_matches(
            Some("{\"layers\":[\"ui\"]}"),
            Some("Rust")
        ));
        // Filter hit (case-insensitive substring).
        assert!(applicability_matches(
            Some("{\"frameworks\":[\"react\"]}"),
            Some("React 19, Vite")
        ));
        assert!(applicability_matches(
            Some("{\"languages\":[\"TypeScript\"],\"frameworks\":[\"axum\"]}"),
            Some("typescript")
        ));
        // Filter miss.
        assert!(!applicability_matches(
            Some("{\"frameworks\":[\"react\"]}"),
            Some("Rust, Axum")
        ));
        assert!(!applicability_matches(
            Some("{\"languages\":[\"python\"]}"),
            None
        ));
        // Malformed JSON fails open (never hides a practice on bad data).
        assert!(applicability_matches(Some("not json"), Some("Rust")));
    }
}
