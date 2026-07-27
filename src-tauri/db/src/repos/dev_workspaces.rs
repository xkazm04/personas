//! Repository for the Workspace Knowledge Center
//! (docs/plans/workspace-knowledge-center.md): `dev_workspaces` (project
//! grouping — the "org"), `workspace_knowledge` (governed cross-project
//! practice library) and `workspace_practice_adoption` (per-project adoption
//! state). Single workspace per project via nullable
//! `dev_projects.workspace_id`.
//!
//! Deliberately NOT part of `repos::dev_tools` — that module is already
//! ~6k lines; this mirrors the `fleet_decisions` split.

use std::collections::HashMap;

use rusqlite::{params, OptionalExtension, Row};

use crate::models::{
    DevProject, DevWorkspace, WorkspaceImportItem, WorkspaceKnowledge, WorkspacePracticeAdoption,
};
use crate::DbPool;
use personas_core::error::AppError;

pub const KNOWLEDGE_KINDS: [&str; 5] = ["pattern", "pitfall", "decision", "howto", "fact"];
pub const KNOWLEDGE_STATUSES: [&str; 5] =
    ["observed", "proposed", "adopted", "deprecated", "rejected"];
pub const ADOPTION_STATES: [&str; 6] = [
    "na",
    "proposed",
    "to_process",
    "dispatched",
    "adopted",
    "diverged",
];

/// Kinds whose adoption implies WORK inside a member repo rather than a note
/// to carry: a `pitfall` names something to remove, a `pattern` names
/// something to converge on. `decision` / `howto` / `fact` are reference
/// material — they reach the repo through the memory projection
/// (`project_practices`) and need no execution.
pub const ACTIONABLE_KINDS: [&str; 2] = ["pitfall", "pattern"];

pub fn is_actionable_kind(kind: &str) -> bool {
    ACTIONABLE_KINDS.contains(&kind)
}

/// Seed state for a per-project adoption cell the moment a practice becomes
/// canon. `na` when the practice cannot apply to that stack at all;
/// `to_process` when it names work that repo owes (the queue a future executor
/// drains); plain `proposed` for reference material, which is "distributed"
/// rather than "done".
pub fn initial_adoption_state(
    kind: &str,
    applicability: Option<&str>,
    tech_stack: Option<&str>,
) -> &'static str {
    if !applicability_matches(applicability, tech_stack) {
        "na"
    } else if is_actionable_kind(kind) {
        "to_process"
    } else {
        "proposed"
    }
}

/// A machine-harvested knowledge candidate (from the `practice-harvest` skill
/// or a deterministic miner). Distinct from the human `create_knowledge` path:
/// candidates land `observed` with machine provenance and are dedup-gated
/// against the workspace's existing keys (incl. the 90-day rejected window).
#[derive(Debug, Clone)]
pub struct KnowledgeCandidate {
    pub kind: String,
    pub title: String,
    pub statement: String,
    pub detail_md: Option<String>,
    pub topic: Option<String>,
    /// Categorization axes (macro|meso|micro · finding-type · durable|situational|mechanical).
    pub abstraction: Option<String>,
    pub ftype: Option<String>,
    pub durability: Option<String>,
    /// Roll-up to a governing macro doctrine.
    pub governing_id: Option<String>,
    pub evidence_count: Option<i64>,
    /// JSON applicability envelope; validated parseable if present.
    pub applicability: Option<String>,
    pub origin_project_id: Option<String>,
    /// Miner idempotency key; the dedup gate keys off this.
    pub dedup_key: Option<String>,
    pub confidence: Option<f64>,
}

/// Result of an ingest run — inserted count + a per-row reason for every
/// candidate that was refused (a lossy ingest is never silent).
#[derive(Debug, Default, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct IngestSummary {
    pub inserted: u32,
    pub skipped: Vec<String>,
}

/// Hard cap on candidates accepted in one ingest call — a runaway harvest
/// (or a miner bug) must not flood the review queue.
pub const MAX_INGEST_PER_RUN: usize = 120;

/// Rejected practices are retained so miners don't re-propose them; the block
/// expires after this many days ("rejection is knowledge", but not forever).
pub const REJECTED_DEDUP_WINDOW_DAYS: i64 = 90;

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
        topic: row.get("topic")?,
        abstraction: row.get("abstraction")?,
        ftype: row.get("ftype")?,
        durability: row.get("durability")?,
        governing_id: row.get("governing_id")?,
        evidence_count: row.get("evidence_count")?,
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
pub fn applicability_matches(applicability: Option<&str>, tech_stack: Option<&str>) -> bool {
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
    let project = crate::repos::dev_tools::get_project_by_id(pool, project_id)?;

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
            let adopted: Vec<(String, String, Option<String>)> = {
                let mut stmt = tx.prepare(
                    "SELECT id, kind, applicability FROM workspace_knowledge
                     WHERE workspace_id = ?1 AND status = 'adopted'",
                )?;
                let rows = stmt
                    .query_map(params![new_ws], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            for (practice_id, kind, applicability) in adopted {
                let state = initial_adoption_state(
                    &kind,
                    applicability.as_deref(),
                    project.tech_stack.as_deref(),
                );
                tx.execute(
                    "INSERT OR IGNORE INTO workspace_practice_adoption
                         (practice_id, project_id, state, updated_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![practice_id, project_id, state, now],
                )?;
            }
        }

        tx.commit()?;
        crate::repos::dev_tools::get_project_by_id(pool, project_id)
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
    topic: Option<&str>,
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
                 (id, workspace_id, kind, title, statement, detail_md, topic, applicability,
                  status, origin_project_id, provenance, valid_from, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'proposed', ?9, ?10, ?11, ?11, ?11)",
            params![
                id,
                workspace_id,
                kind,
                title.trim(),
                statement.trim(),
                detail_md,
                // A hand-authored topic is normalized onto the taxonomy too, so
                // a stray `ui/…` cannot reopen an area the library already
                // merged away. Blank stays blank: the human path may leave a
                // practice untopiced, unlike the machine door.
                topic
                    .map(|t| t.trim())
                    .filter(|t| !t.is_empty())
                    .map(|t| super::workspace_taxonomy::normalize_topic(Some(t))),
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
    topic: Option<Option<&str>>,
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
            // Same normalization as the create path — an edit is another way
            // to reopen a merged-away area. Explicit clear (None) survives.
            topic.map(|o| o.map(|s| super::workspace_taxonomy::normalize_topic(Some(s)))),
            "topic",
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
                let state = initial_adoption_state(
                    &item.kind,
                    item.applicability.as_deref(),
                    tech_stack.as_deref(),
                );
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

// ============================================================================
// Materialization — adopted practice → Backlog ideas (plan 1C)
// ============================================================================

/// The finding origin every materialized practice idea carries. Also its
/// `scan_type`, so the Sensor Scoreboard groups them like any other sensor.
pub const PRACTICE_ORIGIN: &str = "workspace_practice";

/// How much of a practice's `detail_md` is carried into the idea description.
/// The idea seeds a task prompt, not an archive — the full record stays in the
/// library, one click away.
const PRACTICE_DETAIL_BUDGET: usize = 2_000;

/// Stable, project-agnostic dedup key for a practice's materialized ideas.
/// `create_finding` dedups per `(project_id, dedup_key)`, so the SAME key in
/// every member repo is exactly right: one idea per project, and re-adopting
/// (or re-joining) never stacks a second.
pub fn practice_dedup_key(practice_id: &str) -> String {
    format!("workspace_practice:{practice_id}")
}

/// Truncate on a char boundary, appending an ellipsis when anything was cut.
fn truncate_chars(s: &str, budget: usize) -> String {
    if s.chars().count() <= budget {
        return s.to_string();
    }
    let mut out: String = s.chars().take(budget).collect();
    out.push('…');
    out
}

/// Turn one adopted practice into the work each named project owes: one
/// `dev_idea` per project, through the idempotent `create_finding` door
/// (project-scoped `(project_id, dedup_key)` dedup), so this is safe to call
/// on every adopt, every join, and from the startup backfill.
///
/// MUST be called POST-COMMIT — `create_finding` takes its own pooled
/// connection and publishes `signal.raised` on the bus; calling it inside an
/// open transaction would deadlock the pool on a single-connection build and
/// announce work that a rollback could still erase.
///
/// Returns how many ideas were actually inserted (already-present ones count 0).
pub fn materialize_practice_ideas(
    pool: &DbPool,
    practice: &WorkspaceKnowledge,
    project_ids: &[String],
) -> Result<u32, AppError> {
    if !is_actionable_kind(&practice.kind) || project_ids.is_empty() {
        return Ok(0);
    }

    let title = match practice.kind.as_str() {
        "pitfall" => format!("Fix workspace pitfall: {}", practice.title),
        _ => format!("Adopt workspace practice: {}", practice.title),
    };
    let description = match practice.detail_md.as_deref().map(str::trim) {
        Some(d) if !d.is_empty() => format!(
            "{}\n\n{}",
            practice.statement.trim(),
            truncate_chars(d, PRACTICE_DETAIL_BUDGET)
        ),
        _ => practice.statement.trim().to_string(),
    };
    let category = crate::models::IdeaCategory::from_token(&practice.kind)
        .unwrap_or(crate::models::DEFAULT_IDEA_CATEGORY);
    let evidence = serde_json::json!({
        "practice_id": practice.id,
        "workspace_id": practice.workspace_id,
        "kind": practice.kind,
        "topic": practice.topic,
        "adopted_at": practice.decided_at.clone().unwrap_or_else(|| practice.updated_at.clone()),
    })
    .to_string();
    // Confidence is the only signal the library carries about how strongly the
    // practice is believed; effort and risk are unknown until someone looks at
    // the repo, and inventing them would poison the triage value score.
    let impact = practice
        .confidence
        .map(|c| ((c * 5.0).round() as i32).clamp(1, 5));
    let dedup_key = practice_dedup_key(&practice.id);

    let mut created = 0u32;
    for project_id in project_ids {
        match crate::repos::dev_tools::create_finding(
            pool,
            project_id,
            PRACTICE_ORIGIN,
            &title,
            Some(&description),
            Some(category.as_str()),
            None,
            None,
            Some(&evidence),
            &dedup_key,
            None,
            impact,
            None,
        ) {
            Ok(Some(_)) => created += 1,
            Ok(None) => {}
            // Best-effort per project: one unwritable repo row must not abort
            // the fan-out to its siblings.
            Err(e) => tracing::warn!(
                practice_id = %practice.id,
                project_id = %project_id,
                error = %e,
                "workspace practice materialization failed for one project"
            ),
        }
    }
    Ok(created)
}

/// Projects whose adoption cell for this practice sits in the execution queue
/// (`to_process`) — i.e. exactly the ones that owe the work. `na` (doesn't
/// apply), `dispatched`/`adopted` (already handled) and `diverged` (a human
/// said no) are all deliberately excluded.
pub fn to_process_projects(pool: &DbPool, practice_id: &str) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT project_id FROM workspace_practice_adoption
         WHERE practice_id = ?1 AND state = 'to_process'",
    )?;
    let rows = stmt.query_map(params![practice_id], |r| r.get::<_, String>(0))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Materialize every `to_process` cell of one practice. The single entry point
/// the adopt branch, the join branch and the backfill all share.
pub fn materialize_pending_for_practice(pool: &DbPool, practice_id: &str) -> Result<u32, AppError> {
    let practice = get_knowledge_by_id(pool, practice_id)?;
    if practice.status != "adopted" || !is_actionable_kind(&practice.kind) {
        return Ok(0);
    }
    let projects = to_process_projects(pool, practice_id)?;
    materialize_practice_ideas(pool, &practice, &projects)
}

/// Retire the ideas a practice put into member backlogs when the practice
/// itself is deprecated or rejected. Only `pending` rows are touched: work a
/// human already accepted (or rejected) keeps its own verdict, and the
/// `archived` row retains the dedup key so re-adoption cannot stack a second
/// copy (documented consequence — plan §"Open questions").
pub fn archive_practice_ideas(pool: &DbPool, practice_id: &str) -> Result<u32, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let rows = conn.execute(
        "UPDATE dev_ideas SET status = 'archived', updated_at = ?1
         WHERE origin = ?2 AND dedup_key = ?3 AND status = 'pending'",
        params![now, PRACTICE_ORIGIN, practice_dedup_key(practice_id)],
    )?;
    Ok(rows as u32)
}

/// Startup / on-demand reconciler: every `to_process` cell joined to an adopted
/// actionable practice gets its idea. Idempotent and cheap when there is
/// nothing to do (one indexed join, then the `create_finding` dedup gate), so
/// it is safe to run on every boot. This is what heals a cell seeded before
/// materialization existed, or one whose post-commit fan-out lost a race.
pub fn backfill_practice_ideas(pool: &DbPool) -> Result<u32, AppError> {
    let pairs: Vec<(String, String)> = {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT a.practice_id, a.project_id
             FROM workspace_practice_adoption a
             JOIN workspace_knowledge k ON k.id = a.practice_id
             WHERE a.state = 'to_process' AND k.status = 'adopted'
               AND k.kind IN ('pitfall','pattern')
             ORDER BY a.practice_id",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    if pairs.is_empty() {
        return Ok(0);
    }

    let mut by_practice: HashMap<String, Vec<String>> = HashMap::new();
    for (practice_id, project_id) in pairs {
        by_practice.entry(practice_id).or_default().push(project_id);
    }

    let mut created = 0u32;
    for (practice_id, project_ids) in by_practice {
        match get_knowledge_by_id(pool, &practice_id) {
            Ok(practice) => created += materialize_practice_ideas(pool, &practice, &project_ids)?,
            Err(e) => tracing::warn!(practice_id = %practice_id, error = %e, "backfill: practice unreadable"),
        }
    }
    Ok(created)
}

// ============================================================================
// Lifecycle sync — idea verdict / task outcome → adoption cell
// ============================================================================

/// Read the `practice_id` back out of a materialized idea's evidence blob.
/// Returns None for any idea that is not a practice materialization, so
/// callers can treat "not ours" and "malformed" identically.
pub fn practice_id_from_evidence(origin: Option<&str>, evidence: Option<&str>) -> Option<String> {
    if origin != Some(PRACTICE_ORIGIN) {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(evidence?).ok()?;
    parsed
        .get("practice_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Keep the adoption matrix honest when a materialized idea gets a verdict.
///
/// Rejecting the idea IS the project saying "we're not doing this" — the cell
/// becomes `diverged` (with the rejection reason as its note), which is the
/// state the library already renders as an explicit, reviewable exception.
/// Accepting changes nothing: the cell moves on `dispatched` (task created)
/// and `adopted` (task completed), which are facts about work, not intent.
///
/// Best-effort — mirrors `record_idea_decision`'s posture: the verdict is the
/// source of truth, the matrix is a projection, and a projection failure must
/// never fail the verdict.
pub fn sync_practice_adoption(pool: &DbPool, idea: &crate::models::DevIdea) {
    if idea.status != "rejected" {
        return;
    }
    let (Some(practice_id), Some(project_id)) = (
        practice_id_from_evidence(idea.origin.as_deref(), idea.evidence.as_deref()),
        idea.project_id.as_deref(),
    ) else {
        return;
    };
    let note = idea
        .rejection_reason
        .as_deref()
        .filter(|r| !r.trim().is_empty())
        .map(|r| format!("backlog rejected: {r}"))
        .unwrap_or_else(|| "backlog rejected".to_string());
    if let Err(e) = set_adoption(pool, &practice_id, project_id, "diverged", Some(&note), None) {
        tracing::warn!(
            idea_id = %idea.id,
            practice_id = %practice_id,
            error = %e,
            "workspace adoption sync failed (idea rejected)"
        );
    }
}

/// Move a materialized idea's adoption cell in response to a TASK lifecycle
/// event (`dispatched` on creation, `adopted` on success, back to `to_process`
/// on failure). Best-effort, same posture as [`sync_practice_adoption`].
pub fn sync_practice_adoption_for_task(
    pool: &DbPool,
    idea: &crate::models::DevIdea,
    state: &str,
    note: &str,
) {
    let (Some(practice_id), Some(project_id)) = (
        practice_id_from_evidence(idea.origin.as_deref(), idea.evidence.as_deref()),
        idea.project_id.as_deref(),
    ) else {
        return;
    };
    if let Err(e) = set_adoption(pool, &practice_id, project_id, state, Some(note), None) {
        tracing::warn!(
            idea_id = %idea.id,
            practice_id = %practice_id,
            state,
            error = %e,
            "workspace adoption sync failed (task lifecycle)"
        );
    }
}

// ============================================================================
// Ingest (machine-harvested candidates → observed) — Arc 2
// ============================================================================

/// Dedup verdict for one candidate against the workspace's existing rows.
enum DedupVerdict {
    /// No blocking row — insert.
    Fresh,
    /// A live (non-rejected) row already carries this key.
    Present,
    /// A rejected row carries this key within the retention window.
    RecentlyRejected,
}

/// Decide whether a `dedup_key` is clear to insert. A key with no rows is
/// Fresh; a key on any live row is Present; a key only on rejected rows is
/// RecentlyRejected while the newest rejection is within the window, else
/// Fresh again (the block has expired).
fn dedup_verdict(conn: &rusqlite::Connection, workspace_id: &str, dedup_key: &str) -> Result<DedupVerdict, AppError> {
    // Any live row with this key blocks immediately.
    let live: i64 = conn.query_row(
        "SELECT COUNT(*) FROM workspace_knowledge
         WHERE workspace_id = ?1 AND dedup_key = ?2 AND status != 'rejected'",
        params![workspace_id, dedup_key],
        |r| r.get(0),
    )?;
    if live > 0 {
        return Ok(DedupVerdict::Present);
    }
    // Otherwise, is there a rejection inside the retention window?
    let cutoff = format!("-{REJECTED_DEDUP_WINDOW_DAYS} days");
    let recent_reject: i64 = conn.query_row(
        "SELECT COUNT(*) FROM workspace_knowledge
         WHERE workspace_id = ?1 AND dedup_key = ?2 AND status = 'rejected'
           AND COALESCE(decided_at, updated_at) >= datetime('now', ?3)",
        params![workspace_id, dedup_key, cutoff],
        |r| r.get(0),
    )?;
    if recent_reject > 0 {
        Ok(DedupVerdict::RecentlyRejected)
    } else {
        Ok(DedupVerdict::Fresh)
    }
}

/// Ingest machine-harvested candidates into a workspace's library. Each lands
/// `observed` with the given machine provenance (`actor_kind` ∈ 'agent' |
/// 'miner'), dedup-gated on `dedup_key` (existing-live → skip; rejected within
/// the 90-day window → skip; otherwise insert). Candidates without a
/// `dedup_key` are always inserted (the caller owns novelty). Bounded by
/// `MAX_INGEST_PER_RUN`; every refusal is reported in `skipped`.
pub fn ingest_candidates(
    pool: &DbPool,
    workspace_id: &str,
    candidates: &[KnowledgeCandidate],
    actor_kind: &str,
    model_ref: Option<&str>,
) -> Result<IngestSummary, AppError> {
    get_workspace_by_id(pool, workspace_id)?;
    let mut summary = IngestSummary::default();

    timed_query!("workspace_knowledge", "dev_workspaces::ingest_candidates", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        let now = chrono::Utc::now().to_rfc3339();
        let provenance = match model_ref {
            Some(m) => format!("{{\"actor_kind\":\"{actor_kind}\",\"model_ref\":\"{m}\"}}"),
            None => format!("{{\"actor_kind\":\"{actor_kind}\"}}"),
        };
        // Keys accepted earlier in THIS batch — so two candidates carrying the
        // same key in one run don't both insert.
        let mut seen_in_batch: std::collections::HashSet<String> = std::collections::HashSet::new();

        for (i, c) in candidates.iter().enumerate() {
            if summary.inserted as usize >= MAX_INGEST_PER_RUN {
                summary.skipped.push(format!("#{i}: run cap reached ({MAX_INGEST_PER_RUN})"));
                continue;
            }
            if !KNOWLEDGE_KINDS.contains(&c.kind.as_str()) {
                summary.skipped.push(format!("#{i} '{}': invalid kind '{}'", c.title, c.kind));
                continue;
            }
            if c.title.trim().is_empty() || c.statement.trim().is_empty() {
                summary.skipped.push(format!("#{i}: empty title or statement"));
                continue;
            }
            if let Some(json) = c.applicability.as_deref() {
                if serde_json::from_str::<serde_json::Value>(json).is_err() {
                    summary.skipped.push(format!("#{i} '{}': applicability is not valid JSON", c.title));
                    continue;
                }
            }
            if let Some(key) = c.dedup_key.as_deref() {
                if seen_in_batch.contains(key) {
                    summary.skipped.push(format!("#{i} '{}': duplicate key within this run", c.title));
                    continue;
                }
                match dedup_verdict(&tx, workspace_id, key)? {
                    DedupVerdict::Present => {
                        summary.skipped.push(format!("#{i} '{}': already in the library", c.title));
                        continue;
                    }
                    DedupVerdict::RecentlyRejected => {
                        summary.skipped.push(format!("#{i} '{}': rejected within {REJECTED_DEDUP_WINDOW_DAYS}d", c.title));
                        continue;
                    }
                    DedupVerdict::Fresh => {}
                }
                seen_in_batch.insert(key.to_string());
            }

            let id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO workspace_knowledge
                     (id, workspace_id, kind, title, statement, detail_md, topic,
                      abstraction, ftype, durability, governing_id, evidence_count,
                      applicability, status, origin_project_id, provenance, confidence, dedup_key,
                      valid_from, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'observed', ?14, ?15, ?16, ?17, ?18, ?18, ?18)",
                params![
                    id,
                    workspace_id,
                    c.kind,
                    c.title.trim(),
                    c.statement.trim(),
                    c.detail_md,
                    // Every machine writer passes through here, so this is the
                    // one place that can hold the taxonomy. An unknown cluster
                    // under a known area survives (that is how the vocabulary
                    // grows); an unknown *area* is quarantined on a visible
                    // shelf rather than silently inventing a new top level.
                    crate::repos::workspace_taxonomy::normalize_topic(c.topic.as_deref()),
                    c.abstraction,
                    c.ftype,
                    c.durability,
                    c.governing_id,
                    c.evidence_count,
                    c.applicability,
                    c.origin_project_id,
                    provenance,
                    c.confidence,
                    c.dedup_key,
                    now,
                ],
            )?;
            summary.inserted += 1;
        }

        tx.commit()?;
        Ok(summary)
    })
}

// ============================================================================
// Deterministic miners (no LLM) — Arc 2
// ============================================================================

/// Full member projects of a workspace (name-sorted). Used by harvest prepare
/// to compose the sibling roster.
pub fn list_workspace_projects(pool: &DbPool, workspace_id: &str) -> Result<Vec<DevProject>, AppError> {
    timed_query!("dev_projects", "dev_workspaces::list_workspace_projects", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_projects WHERE workspace_id = ?1 ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map(params![workspace_id], crate::repos::dev_tools::row_to_project)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Workspace member projects (id + tech_stack), the "siblings" a miner
/// compares across. Empty when the workspace has no members.
fn workspace_members(pool: &DbPool, workspace_id: &str) -> Result<Vec<(String, Option<String>)>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, tech_stack FROM dev_projects WHERE workspace_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![workspace_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// A live finding row read for cross-project mining.
struct MinedFinding {
    project_id: String,
    origin: String,
    dedup_key: Option<String>,
    title: String,
}

/// Miner A — cross-project shared findings. Groups the workspace members' live
/// `dev_ideas` (pending/accepted, with an `origin` sensor tag) by a
/// project-agnostic identity and, where a group spans ≥2 distinct members,
/// proposes it as a shared `pitfall`. Identity = `(origin, dedup_key)` for
/// project-agnostic keys, falling back to `(origin, normalized-title)` so
/// repo-local keys (sentry ids, context-scoped scans) still cluster.
pub fn mine_shared_findings(pool: &DbPool, workspace_id: &str) -> Result<Vec<KnowledgeCandidate>, AppError> {
    let members = workspace_members(pool, workspace_id)?;
    if members.len() < 2 {
        return Ok(Vec::new());
    }
    let member_ids: Vec<String> = members.iter().map(|(id, _)| id.clone()).collect();

    let conn = pool.get()?;
    let placeholders = member_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        // LOOP PREVENTION (non-negotiable — plan 1C): a `workspace_practice`
        // idea IS this workspace's own adopted practice, fanned out to every
        // member repo. Mining it back would cluster N copies of one practice
        // into a "shared finding" and re-propose the practice as a new
        // candidate — an echo chamber that grows on every miner run. The
        // sensors mine reality; the library is not reality.
        "SELECT project_id, origin, dedup_key, title FROM dev_ideas
         WHERE project_id IN ({placeholders})
           AND origin IS NOT NULL
           AND origin != '{PRACTICE_ORIGIN}'
           AND status IN ('pending','accepted')"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params_vec: Vec<&dyn rusqlite::types::ToSql> =
        member_ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
    let findings: Vec<MinedFinding> = stmt
        .query_map(params_vec.as_slice(), |r| {
            Ok(MinedFinding {
                project_id: r.get(0)?,
                origin: r.get(1)?,
                dedup_key: r.get(2)?,
                title: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(cluster_shared_findings(&findings))
}

/// Pure clustering core (testable without a DB): bucket findings by identity,
/// keep buckets spanning ≥2 distinct projects, emit one candidate each.
fn cluster_shared_findings(findings: &[MinedFinding]) -> Vec<KnowledgeCandidate> {
    // identity key → (representative title, origin, set of project ids)
    let mut buckets: HashMap<String, (String, String, std::collections::BTreeSet<String>)> = HashMap::new();
    for f in findings {
        // Second gate for the same echo the SQL above already blocks. The
        // clustering core is pure and independently callable, so the guard
        // lives here too — a future caller that assembles findings by another
        // route must not be able to reopen the loop.
        if f.origin == PRACTICE_ORIGIN {
            continue;
        }
        let identity = match f.dedup_key.as_deref() {
            Some(k) if is_project_agnostic_key(k) => format!("{}|{}", f.origin, k),
            _ => format!(
                "{}|title:{}",
                f.origin,
                crate::repos::dev_tools::normalize_idea_title(&f.title)
            ),
        };
        let entry = buckets
            .entry(identity)
            .or_insert_with(|| (f.title.clone(), f.origin.clone(), std::collections::BTreeSet::new()));
        entry.2.insert(f.project_id.clone());
    }

    let mut out: Vec<(String, KnowledgeCandidate)> = Vec::new();
    for (identity, (title, origin, projects)) in buckets {
        if projects.len() < 2 {
            continue;
        }
        let n = projects.len();
        let confidence = (0.5 + 0.15 * (n as f64 - 2.0)).min(0.95);
        out.push((
            identity.clone(),
            KnowledgeCandidate {
                kind: "pitfall".into(),
                title: format!("Shared finding: {title}"),
                statement: format!(
                    "{n} projects in this workspace raised the same {origin} finding — \"{title}\". A recurring issue across the portfolio is worth a workspace-level practice."
                ),
                detail_md: None,
                topic: Some(finding_topic(&origin)),
                abstraction: Some("meso".into()),
                ftype: Some("data-flow".into()),
                durability: Some("durable".into()),
                governing_id: None,
                evidence_count: Some(n as i64),
                applicability: None,
                origin_project_id: None,
                dedup_key: Some(format!("miner:findings:{identity}")),
                confidence: Some(confidence),
            },
        ));
    }
    // Deterministic order (BTree of projects already sorts members; sort output
    // by dedup_key so the ingest order — and any test — is stable).
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.into_iter().map(|(_, c)| c).collect()
}

/// Findings whose `dedup_key` is derived from a project-agnostic identifier
/// (standards rule keys, kpi_sim signals, whole-project static scans) carry the
/// SAME key in every repo, so key-equality is a safe cross-project match.
/// Repo-local keys (`sentry:<id>`, context-scoped `scan:<type>:<ctxid>:…`) are
/// matched on normalized title instead.
fn is_project_agnostic_key(key: &str) -> bool {
    key.starts_with("standards:")
        || key.starts_with("kpi_sim:")
        || key.starts_with("scan:") && key.contains(":all:")
}

/// Coarse topic path for a finding origin, so shared findings slot into the
/// library tree instead of landing uncategorized.
///
/// These are the miners' contribution to the taxonomy in
/// [`workspace_taxonomy`](super::workspace_taxonomy) and must stay inside it —
/// the miners used to emit a third private vocabulary (`code-quality/…`,
/// `cost/…`, `reliability/…`, `product/…`) that overlapped neither the agents'
/// paths nor each other. An unrecognized origin quarantines rather than guesses.
fn finding_topic(origin: &str) -> String {
    match origin {
        "standards_finding" => "process/enforcement",
        "llm_cost" => "billing/limits",
        "sentry_spike" => "observability/diagnostics",
        "kpi_offtrack" | "kpi_sim" => "process/outcomes",
        "doc_rot" => "process/documentation",
        "skill_dormant" | "memory_disputed" => "process/knowledge",
        "passport_gap" => "process/readiness",
        _ => super::workspace_taxonomy::UNSORTED,
    }
    .to_string()
}

/// A skill's presence + 30-day usage in one member project.
struct MinedSkillUse {
    project_id: String,
    invokes_30d: i64,
}

/// Miner B — cross-project skill adoption. A skill installed and heavily used
/// (≥ `MIN_INVOKES` in 30 days) in one workspace member but absent from ≥1
/// sibling is proposed as a `howto` adoption candidate.
pub const MIN_SKILL_INVOKES_30D: i64 = 3;

pub fn mine_shared_skills(pool: &DbPool, workspace_id: &str) -> Result<Vec<KnowledgeCandidate>, AppError> {
    let members = workspace_members(pool, workspace_id)?;
    if members.len() < 2 {
        return Ok(Vec::new());
    }
    let member_ids: std::collections::BTreeSet<String> =
        members.iter().map(|(id, _)| id.clone()).collect();

    let conn = pool.get()?;
    // Skills present (on disk) in each member, per the registry.
    let placeholders = member_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let present_sql = format!(
        "SELECT name, project_id FROM skill_registry
         WHERE scope = 'project' AND missing_since IS NULL AND project_id IN ({placeholders})"
    );
    let params_vec: Vec<&dyn rusqlite::types::ToSql> =
        member_ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
    let mut present: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();
    {
        let mut stmt = conn.prepare(&present_sql)?;
        let rows = stmt.query_map(params_vec.as_slice(), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (name, pid) = row?;
            present.entry(name).or_default().insert(pid);
        }
    }

    // 30-day usage per (skill, project).
    let usage_sql = format!(
        "SELECT skill_name, project_id, COUNT(*) FROM skill_usage_events
         WHERE project_id IN ({placeholders})
           AND occurred_at >= datetime('now','-30 days')
         GROUP BY skill_name, project_id"
    );
    let mut usage: HashMap<String, Vec<MinedSkillUse>> = HashMap::new();
    {
        let mut stmt = conn.prepare(&usage_sql)?;
        let rows = stmt.query_map(params_vec.as_slice(), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(2)?))
        })?;
        for row in rows {
            let (name, pid, count) = row?;
            if let Some(pid) = pid {
                usage.entry(name).or_default().push(MinedSkillUse { project_id: pid, invokes_30d: count });
            }
        }
    }

    Ok(cluster_skill_adoption(&member_ids, &present, &usage))
}

/// Pure adoption-candidate core (testable): for each skill with heavy use in
/// some member and absence in ≥1 sibling, emit one candidate.
fn cluster_skill_adoption(
    members: &std::collections::BTreeSet<String>,
    present: &HashMap<String, std::collections::BTreeSet<String>>,
    usage: &HashMap<String, Vec<MinedSkillUse>>,
) -> Vec<KnowledgeCandidate> {
    let mut out: Vec<KnowledgeCandidate> = Vec::new();
    let mut names: Vec<&String> = usage.keys().collect();
    names.sort();
    for name in names {
        let uses = &usage[name];
        let heavy = uses.iter().filter(|u| u.invokes_30d >= MIN_SKILL_INVOKES_30D).count();
        if heavy == 0 {
            continue;
        }
        let have = present.get(name).cloned().unwrap_or_default();
        let missing: Vec<&String> = members.iter().filter(|m| !have.contains(*m)).collect();
        if missing.is_empty() {
            continue;
        }
        let top = uses.iter().map(|u| u.invokes_30d).max().unwrap_or(0);
        out.push(KnowledgeCandidate {
            kind: "howto".into(),
            title: format!("Adopt the '{name}' skill workspace-wide"),
            statement: format!(
                "The '{name}' skill is actively used ({top}×/30d at peak) by {heavy} project(s) in this workspace but is missing from {} sibling(s). Consider adopting it across the workspace.",
                missing.len()
            ),
            detail_md: None,
            topic: Some("process/knowledge".into()),
            abstraction: Some("meso".into()),
            ftype: Some("extensibility".into()),
            durability: Some("situational".into()),
            governing_id: None,
            evidence_count: Some(heavy as i64),
            applicability: None,
            origin_project_id: None,
            dedup_key: Some(format!("miner:skill-adopt:{name}")),
            confidence: Some(0.6),
        });
    }
    out
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

    #[test]
    fn adoption_seed_state_splits_actionable_from_reference() {
        // Actionable canon owes work in the repo → the execution queue.
        assert_eq!(initial_adoption_state("pitfall", None, Some("Rust")), "to_process");
        assert_eq!(initial_adoption_state("pattern", None, Some("Rust")), "to_process");
        // Reference material is distributed, not executed.
        assert_eq!(initial_adoption_state("fact", None, Some("Rust")), "proposed");
        assert_eq!(initial_adoption_state("decision", None, Some("Rust")), "proposed");
        assert_eq!(initial_adoption_state("howto", None, Some("Rust")), "proposed");
        // Inapplicable beats actionable — a pitfall about React is not work a
        // Rust repo owes.
        assert_eq!(
            initial_adoption_state("pitfall", Some("{\"frameworks\":[\"react\"]}"), Some("Rust, Axum")),
            "na"
        );
        // Every seed state must survive the column CHECK.
        for kind in KNOWLEDGE_KINDS {
            assert!(ADOPTION_STATES.contains(&initial_adoption_state(kind, None, None)));
        }
    }

    #[test]
    fn project_agnostic_key_classification() {
        assert!(is_project_agnostic_key("standards:no-unwrap"));
        assert!(is_project_agnostic_key("kpi_sim:finding:k1:slug"));
        assert!(is_project_agnostic_key("scan:security:all:sql-injection-risk"));
        // Repo-local keys must NOT be treated as globally equal.
        assert!(!is_project_agnostic_key("sentry:AB12CD"));
        assert!(!is_project_agnostic_key("scan:security:ctx-uuid-123:sql-injection"));
    }

    fn finding(project: &str, origin: &str, dedup: Option<&str>, title: &str) -> MinedFinding {
        MinedFinding {
            project_id: project.into(),
            origin: origin.into(),
            dedup_key: dedup.map(|s| s.into()),
            title: title.into(),
        }
    }

    #[test]
    fn shared_findings_cluster_across_two_projects_by_agnostic_key() {
        let findings = vec![
            finding("p1", "standards_finding", Some("standards:no-unwrap"), "Avoid unwrap"),
            finding("p2", "standards_finding", Some("standards:no-unwrap"), "Avoid .unwrap()"),
        ];
        let out = cluster_shared_findings(&findings);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "pitfall");
        assert_eq!(out[0].dedup_key.as_deref(), Some("miner:findings:standards_finding|standards:no-unwrap"));
        assert_eq!(out[0].topic.as_deref(), Some("process/enforcement"));
    }

    #[test]
    fn single_project_finding_is_not_shared() {
        let findings = vec![
            finding("p1", "standards_finding", Some("standards:no-unwrap"), "Avoid unwrap"),
            finding("p1", "standards_finding", Some("standards:no-unwrap"), "Avoid unwrap again"),
        ];
        assert!(cluster_shared_findings(&findings).is_empty());
    }

    #[test]
    fn repo_local_keys_cluster_on_normalized_title() {
        // Different sentry ids per repo, but the same normalized title → shared.
        let findings = vec![
            finding("p1", "sentry_spike", Some("sentry:AA11"), "Null pointer in checkout flow"),
            finding("p2", "sentry_spike", Some("sentry:BB22"), "Null pointer in checkout flow!"),
        ];
        let out = cluster_shared_findings(&findings);
        assert_eq!(out.len(), 1, "repo-local keys should fall back to title matching");
        assert_eq!(out[0].topic.as_deref(), Some("observability/diagnostics"));
    }

    #[test]
    fn confidence_grows_with_project_count() {
        let two = cluster_shared_findings(&[
            finding("p1", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
            finding("p2", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
        ]);
        let three = cluster_shared_findings(&[
            finding("p1", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
            finding("p2", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
            finding("p3", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
        ]);
        assert!(three[0].confidence.unwrap() > two[0].confidence.unwrap());
    }

    fn members(ids: &[&str]) -> std::collections::BTreeSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn skill_adoption_flags_heavy_use_absent_in_sibling() {
        let mem = members(&["p1", "p2", "p3"]);
        let mut present: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();
        present.insert("kpi-sim".into(), members(&["p1"])); // only p1 has it
        let mut usage: HashMap<String, Vec<MinedSkillUse>> = HashMap::new();
        usage.insert(
            "kpi-sim".into(),
            vec![MinedSkillUse { project_id: "p1".into(), invokes_30d: 9 }],
        );
        let out = cluster_skill_adoption(&mem, &present, &usage);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "howto");
        assert_eq!(out[0].dedup_key.as_deref(), Some("miner:skill-adopt:kpi-sim"));
    }

    #[test]
    fn skill_present_everywhere_is_not_proposed() {
        let mem = members(&["p1", "p2"]);
        let mut present: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();
        present.insert("shared".into(), members(&["p1", "p2"]));
        let mut usage: HashMap<String, Vec<MinedSkillUse>> = HashMap::new();
        usage.insert("shared".into(), vec![MinedSkillUse { project_id: "p1".into(), invokes_30d: 20 }]);
        assert!(cluster_skill_adoption(&mem, &present, &usage).is_empty());
    }

    #[test]
    fn lightly_used_skill_is_not_proposed() {
        let mem = members(&["p1", "p2"]);
        let present: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();
        let mut usage: HashMap<String, Vec<MinedSkillUse>> = HashMap::new();
        // below MIN_SKILL_INVOKES_30D
        usage.insert("rare".into(), vec![MinedSkillUse { project_id: "p1".into(), invokes_30d: 1 }]);
        assert!(cluster_skill_adoption(&mem, &present, &usage).is_empty());
    }

    // ------------------------------------------------------------------
    // Loop prevention (plan 1C) — the non-negotiable guard
    // ------------------------------------------------------------------

    /// THE loop this feature could have created: adopting one practice writes a
    /// `workspace_practice` idea into every member repo. If the finding miner
    /// then read those back, two repos carrying the SAME practice would look
    /// exactly like a "shared finding" and be re-proposed as a new workspace
    /// practice — which, adopted, fans out again. Each miner run would inflate
    /// the library with echoes of itself.
    ///
    /// So: a workspace_practice finding present in ≥2 projects — the exact
    /// shape that clusters for every other origin — must yield NO candidate.
    #[test]
    fn workspace_practice_findings_never_cluster_into_a_candidate() {
        let key = practice_dedup_key("prac-1");
        let echo = vec![
            finding("p1", PRACTICE_ORIGIN, Some(key.as_str()), "Adopt workspace practice: Use design tokens"),
            finding("p2", PRACTICE_ORIGIN, Some(key.as_str()), "Adopt workspace practice: Use design tokens"),
            finding("p3", PRACTICE_ORIGIN, Some(key.as_str()), "Adopt workspace practice: Use design tokens"),
        ];
        assert!(
            cluster_shared_findings(&echo).is_empty(),
            "materialized practices must never be mined back into the library"
        );

        // Control: the identical shape from a real sensor DOES cluster, proving
        // the guard is origin-specific and not just a broken clusterer.
        let real = vec![
            finding("p1", "standards_finding", Some("standards:no-unwrap"), "Avoid unwrap"),
            finding("p2", "standards_finding", Some("standards:no-unwrap"), "Avoid unwrap"),
        ];
        assert_eq!(cluster_shared_findings(&real).len(), 1);

        // And a mixed batch keeps the real signal while dropping the echo.
        let mut mixed = echo;
        mixed.extend(real);
        let out = cluster_shared_findings(&mixed);
        assert_eq!(out.len(), 1);
        assert!(!out[0].dedup_key.as_deref().unwrap().contains(PRACTICE_ORIGIN));
    }

    #[test]
    fn practice_dedup_key_is_project_agnostic_and_not_miner_matchable() {
        assert_eq!(practice_dedup_key("abc"), "workspace_practice:abc");
        // Must NOT be classified project-agnostic: even with the SQL + cluster
        // guards removed, key-equality matching should never be the thing that
        // saves us.
        assert!(!is_project_agnostic_key(&practice_dedup_key("abc")));
    }

    #[test]
    fn practice_id_is_recovered_only_from_our_own_ideas() {
        let ev = r#"{"practice_id":"prac-9","workspace_id":"ws-1","kind":"pattern"}"#;
        assert_eq!(
            practice_id_from_evidence(Some(PRACTICE_ORIGIN), Some(ev)).as_deref(),
            Some("prac-9")
        );
        // Another sensor's evidence is never ours, whatever it contains.
        assert!(practice_id_from_evidence(Some("sentry_spike"), Some(ev)).is_none());
        assert!(practice_id_from_evidence(None, Some(ev)).is_none());
        // Missing / malformed / empty evidence degrades to None, never a panic.
        assert!(practice_id_from_evidence(Some(PRACTICE_ORIGIN), None).is_none());
        assert!(practice_id_from_evidence(Some(PRACTICE_ORIGIN), Some("not json")).is_none());
        assert!(practice_id_from_evidence(Some(PRACTICE_ORIGIN), Some(r#"{"practice_id":""}"#)).is_none());
    }

    #[test]
    fn detail_truncation_respects_char_boundaries() {
        assert_eq!(truncate_chars("abc", 10), "abc");
        assert_eq!(truncate_chars("abcdef", 3), "abc…");
        // Multi-byte input must not panic or split a code point.
        assert_eq!(truncate_chars("héllo wörld", 4), "héll…");
    }

    // ------------------------------------------------------------------
    // Materialization + lifecycle (DB-backed)
    // ------------------------------------------------------------------

    fn test_pool() -> DbPool {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:ws_practice_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder().max_size(4).build(manager).expect("pool");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::migrations::run(&conn).expect("migrations");
            crate::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    /// A workspace with `n` member projects and one proposed actionable
    /// practice. Returns (workspace_id, practice_id, project_ids).
    fn seeded(pool: &DbPool, n: usize, kind: &str) -> (String, String, Vec<String>) {
        let ws = create_workspace(pool, "WS", None, None).unwrap();
        let mut projects = Vec::new();
        for i in 0..n {
            let p = crate::repos::dev_tools::create_project(
                pool,
                &format!("Proj {i}"),
                &format!("/tmp/proj{i}"),
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            assign_project(pool, &p.id, Some(&ws.id)).unwrap();
            projects.push(p.id);
        }
        let k = create_knowledge(
            pool,
            &ws.id,
            kind,
            "Use design tokens",
            "Raw Tailwind colours drift; use the semantic tokens.",
            Some("Long detail here."),
            Some("ui/tokens"),
            None,
            None,
        )
        .unwrap();
        (ws.id, k.id, projects)
    }

    fn practice_ideas(pool: &DbPool, practice_id: &str) -> Vec<crate::models::DevIdea> {
        let conn = pool.get().unwrap();
        let mut stmt = conn
            .prepare("SELECT * FROM dev_ideas WHERE dedup_key = ?1 ORDER BY project_id")
            .unwrap();
        let rows = stmt
            .query_map(params![practice_dedup_key(practice_id)], crate::repos::dev_tools::row_to_idea)
            .unwrap();
        rows.collect::<Result<Vec<_>, _>>().unwrap()
    }

    fn cell(pool: &DbPool, practice_id: &str, project_id: &str) -> String {
        pool.get()
            .unwrap()
            .query_row(
                "SELECT state FROM workspace_practice_adoption WHERE practice_id = ?1 AND project_id = ?2",
                params![practice_id, project_id],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
    }

    #[test]
    fn adopting_an_actionable_practice_materializes_one_idea_per_project_exactly_once() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "pattern");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();

        assert_eq!(materialize_pending_for_practice(&pool, &practice).unwrap(), 2);
        let ideas = practice_ideas(&pool, &practice);
        assert_eq!(ideas.len(), 2);
        assert!(ideas.iter().all(|i| i.origin.as_deref() == Some(PRACTICE_ORIGIN)));
        assert!(ideas.iter().all(|i| i.status == "pending"));
        assert_eq!(ideas[0].title, "Adopt workspace practice: Use design tokens");
        // Statement AND detail reach the description — this text seeds the task prompt.
        let desc = ideas[0].description.clone().unwrap();
        assert!(desc.contains("semantic tokens"));
        assert!(desc.contains("Long detail here."));
        // Evidence round-trips the practice id, which is how every later
        // lifecycle write finds its way back to the adoption cell.
        assert_eq!(
            practice_id_from_evidence(ideas[0].origin.as_deref(), ideas[0].evidence.as_deref()),
            Some(practice.clone())
        );

        // IDEMPOTENCY: re-adopting (or a second backfill) inserts nothing new.
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        assert_eq!(materialize_pending_for_practice(&pool, &practice).unwrap(), 0);
        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 0);
        assert_eq!(practice_ideas(&pool, &practice).len(), 2);

        // Every project got exactly one.
        let mut seen: Vec<String> = practice_ideas(&pool, &practice)
            .into_iter()
            .filter_map(|i| i.project_id)
            .collect();
        seen.sort();
        let mut expected = projects.clone();
        expected.sort();
        assert_eq!(seen, expected);
    }

    #[test]
    fn pitfall_titles_read_as_removal_work() {
        let pool = test_pool();
        let (_ws, practice, _p) = seeded(&pool, 1, "pitfall");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        materialize_pending_for_practice(&pool, &practice).unwrap();
        assert_eq!(
            practice_ideas(&pool, &practice)[0].title,
            "Fix workspace pitfall: Use design tokens"
        );
    }

    #[test]
    fn reference_kinds_never_reach_the_backlog() {
        // `fact` / `decision` / `howto` are carried as knowledge, not executed —
        // their cells seed `proposed`, so nothing is owed and nothing is written.
        let pool = test_pool();
        let (_ws, practice, _p) = seeded(&pool, 2, "fact");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        assert_eq!(materialize_pending_for_practice(&pool, &practice).unwrap(), 0);
        assert!(practice_ideas(&pool, &practice).is_empty());
        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 0);
    }

    #[test]
    fn backfill_materializes_a_queue_seeded_before_the_feature_existed() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "pattern");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        // Cells exist at `to_process` but no ideas — the pre-P6 world.
        assert!(practice_ideas(&pool, &practice).is_empty());

        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 2);
        assert_eq!(practice_ideas(&pool, &practice).len(), 2);
        // Second run is a no-op — safe to call on every boot.
        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 0);

        // A cell that has moved on is not re-materialized either.
        set_adoption(&pool, &practice, &projects[0], "diverged", None, None).unwrap();
        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 0);
    }

    #[test]
    fn deprecating_a_practice_archives_only_its_undecided_ideas() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "pattern");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        materialize_pending_for_practice(&pool, &practice).unwrap();

        // One project already accepted the work: that verdict is a human's and
        // survives the practice being retired.
        let accepted = practice_ideas(&pool, &practice)
            .into_iter()
            .find(|i| i.project_id.as_deref() == Some(projects[0].as_str()))
            .unwrap();
        crate::repos::dev_tools::update_idea(
            &pool, &accepted.id, None, None, Some("accepted"), None, None, None, None, None,
        )
        .unwrap();

        assert_eq!(archive_practice_ideas(&pool, &practice).unwrap(), 1);
        let after = practice_ideas(&pool, &practice);
        assert_eq!(after.iter().filter(|i| i.status == "archived").count(), 1);
        assert_eq!(after.iter().filter(|i| i.status == "accepted").count(), 1);

        // The archived row keeps the dedup key, so re-adoption cannot stack a
        // second copy (documented trade-off, plan §Open questions).
        assert_eq!(materialize_pending_for_practice(&pool, &practice).unwrap(), 0);
    }

    #[test]
    fn adoption_cell_follows_the_idea_and_its_task() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "pattern");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        materialize_pending_for_practice(&pool, &practice).unwrap();
        let ideas = practice_ideas(&pool, &practice);
        let for_project = |pid: &str| {
            ideas
                .iter()
                .find(|i| i.project_id.as_deref() == Some(pid))
                .unwrap()
                .clone()
        };

        // Reject → the repo has explicitly opted out. `diverged` (not `na`) is
        // the state that stays visible as a reviewable exception.
        let mut rejected = for_project(&projects[0]);
        rejected.status = "rejected".into();
        rejected.rejection_reason = Some("we use CSS modules".into());
        sync_practice_adoption(&pool, &rejected);
        assert_eq!(cell(&pool, &practice, &projects[0]), "diverged");
        let note: Option<String> = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT note FROM workspace_practice_adoption WHERE practice_id = ?1 AND project_id = ?2",
                params![practice, projects[0]],
                |r| r.get(0),
            )
            .unwrap();
        assert!(note.unwrap().contains("we use CSS modules"));

        // Accepting alone changes nothing — intent is not shipped work.
        let mut accepted = for_project(&projects[1]);
        accepted.status = "accepted".into();
        sync_practice_adoption(&pool, &accepted);
        assert_eq!(cell(&pool, &practice, &projects[1]), "to_process");

        // Task created → dispatched; task failed → back in the queue; task
        // succeeded → adopted. Failure must never leave the matrix claiming a
        // practice is adopted.
        sync_practice_adoption_for_task(&pool, &accepted, "dispatched", "task:t1");
        assert_eq!(cell(&pool, &practice, &projects[1]), "dispatched");
        sync_practice_adoption_for_task(&pool, &accepted, "to_process", "task:t1 failed: boom");
        assert_eq!(cell(&pool, &practice, &projects[1]), "to_process");
        sync_practice_adoption_for_task(&pool, &accepted, "adopted", "task:t2 completed");
        assert_eq!(cell(&pool, &practice, &projects[1]), "adopted");
    }

    #[test]
    fn lifecycle_sync_ignores_ideas_that_are_not_materialized_practices() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 1, "pattern");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        materialize_pending_for_practice(&pool, &practice).unwrap();

        let mut foreign = practice_ideas(&pool, &practice)[0].clone();
        foreign.origin = Some("sentry_spike".into());
        foreign.status = "rejected".into();
        sync_practice_adoption(&pool, &foreign);
        // Untouched — a sensor finding's rejection says nothing about a practice.
        assert_eq!(cell(&pool, &practice, &projects[0]), "to_process");
    }

    #[test]
    fn mining_skips_materialized_practices_end_to_end() {
        let pool = test_pool();
        let (ws, practice, _projects) = seeded(&pool, 2, "pattern");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        materialize_pending_for_practice(&pool, &practice).unwrap();
        // Two member projects now hold the same practice idea — the miner must
        // read past them and find nothing.
        assert!(mine_shared_findings(&pool, &ws).unwrap().is_empty());
    }
}
