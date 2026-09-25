//! `dev_lifecycle_versions` + `dev_lifecycle_evidence` - Lifecycle v2 storage.
//!
//! This crate stores the lifecycle document as OPAQUE text: the shape
//! (`personas_core::models::LifecycleDoc`) and the standards projection are
//! owned by `app_lib::lifecycle`. Two rules live here because this is the one
//! door every writer goes through:
//!
//! - **Versions are append-only.** [`append_version`] allocates `MAX(version) + 1`
//!   inside the INSERT; nothing rewrites `doc_json`. The only later write is
//!   [`set_install_task`], which sets `install_task_id` once.
//! - **`standards_config` is a projection written in the SAME transaction** as
//!   the version append. The lifecycle is the authority; the column persona runs
//!   and the passport read can never disagree with the latest version.

use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension};

/// One `dev_lifecycle_versions` row as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct VersionRow {
    pub id: String,
    pub project_id: String,
    pub version: i64,
    /// `solo` | `team`.
    pub preset: String,
    pub doc_json: String,
    pub change_note: Option<String>,
    /// `operator` | `athena` | `system`.
    pub author: String,
    pub install_task_id: Option<String>,
    pub created_at: String,
}

/// One `dev_lifecycle_evidence` row as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct EvidenceRow {
    pub id: String,
    pub project_id: String,
    /// `task` (commit evidence is derived on read, never stored).
    pub source_kind: String,
    pub source_ref: String,
    pub title: String,
    pub outcomes_json: String,
    pub occurred_at: String,
    pub observed_at: String,
}

const VERSION_COLUMNS: &str =
    "id, project_id, version, preset, doc_json, change_note, author, install_task_id, created_at";
const EVIDENCE_COLUMNS: &str =
    "id, project_id, source_kind, source_ref, title, outcomes_json, occurred_at, observed_at";

row_mapper!(row_to_version -> VersionRow {
    id, project_id, version, preset, doc_json, change_note, author, install_task_id, created_at,
});

row_mapper!(row_to_evidence -> EvidenceRow {
    id, project_id, source_kind, source_ref, title, outcomes_json, occurred_at, observed_at,
});

/// The project's latest lifecycle version, or `None` (= implicit Solo v0).
pub fn latest_version(pool: &DbPool, project_id: &str) -> Result<Option<VersionRow>, AppError> {
    timed_query!("dev_lifecycle_versions", "dev_lifecycle::latest_version", {
        let conn = pool.get()?;
        let row = conn
            .query_row(
                &format!(
                    "SELECT {VERSION_COLUMNS} FROM dev_lifecycle_versions
                     WHERE project_id = ?1 ORDER BY version DESC LIMIT 1"
                ),
                params![project_id],
                row_to_version,
            )
            .optional()?;
        Ok(row)
    })
}

/// Every version of the project, newest first.
pub fn list_versions(pool: &DbPool, project_id: &str) -> Result<Vec<VersionRow>, AppError> {
    timed_query!("dev_lifecycle_versions", "dev_lifecycle::list_versions", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {VERSION_COLUMNS} FROM dev_lifecycle_versions
             WHERE project_id = ?1 ORDER BY version DESC"
        ))?;
        let rows = stmt
            .query_map(params![project_id], row_to_version)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
}

/// Append a new version (`MAX(version) + 1`, first stored version is 1) and
/// rewrite `dev_projects.standards_config` with `standards_json`, in ONE
/// transaction. `standards_json` is the caller's projection of `doc_json`.
#[allow(clippy::too_many_arguments)]
pub fn append_version(
    pool: &DbPool,
    project_id: &str,
    preset: &str,
    doc_json: &str,
    change_note: Option<&str>,
    author: &str,
    standards_json: &str,
) -> Result<VersionRow, AppError> {
    timed_query!("dev_lifecycle_versions", "dev_lifecycle::append_version", {
        let mut conn = pool.get()?;
        // IMMEDIATE: the MAX(version) read informs the write.
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let now = chrono::Utc::now().to_rfc3339();
        let updated = tx.execute(
            "UPDATE dev_projects SET standards_config = ?1, updated_at = ?2 WHERE id = ?3",
            params![standards_json, now, project_id],
        )?;
        if updated == 0 {
            return Err(AppError::NotFound(format!("Dev project {project_id}")));
        }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO dev_lifecycle_versions
                (id, project_id, version, preset, doc_json, change_note, author, created_at)
             VALUES (?1, ?2,
                     (SELECT COALESCE(MAX(version), 0) + 1 FROM dev_lifecycle_versions
                       WHERE project_id = ?2),
                     ?3, ?4, ?5, ?6, ?7)",
            params![id, project_id, preset, doc_json, change_note, author, now],
        )?;
        let row = tx.query_row(
            &format!("SELECT {VERSION_COLUMNS} FROM dev_lifecycle_versions WHERE id = ?1"),
            params![id],
            row_to_version,
        )?;
        tx.commit()?;
        Ok(row)
    })
}

/// Record the install task for a version. Set once: a version whose
/// `install_task_id` is already set is left untouched (returns `false`).
pub fn set_install_task(
    pool: &DbPool,
    project_id: &str,
    version: i64,
    task_id: &str,
) -> Result<bool, AppError> {
    timed_query!(
        "dev_lifecycle_versions",
        "dev_lifecycle::set_install_task",
        {
            let conn = pool.get()?;
            let n = conn.execute(
                "UPDATE dev_lifecycle_versions SET install_task_id = ?1
             WHERE project_id = ?2 AND version = ?3 AND install_task_id IS NULL",
                params![task_id, project_id, version],
            )?;
            Ok(n > 0)
        }
    )
}

/// Insert or replace the evidence row for one finished task (`source_kind =
/// 'task'`, `source_ref` = the task id).
pub fn upsert_task_evidence(
    pool: &DbPool,
    project_id: &str,
    task_id: &str,
    title: &str,
    outcomes_json: &str,
    occurred_at: &str,
) -> Result<EvidenceRow, AppError> {
    timed_query!(
        "dev_lifecycle_evidence",
        "dev_lifecycle::upsert_task_evidence",
        {
            let conn = pool.get()?;
            let now = chrono::Utc::now().to_rfc3339();
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
            "INSERT INTO dev_lifecycle_evidence
                (id, project_id, source_kind, source_ref, title, outcomes_json, occurred_at, observed_at)
             VALUES (?1, ?2, 'task', ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (project_id, source_kind, source_ref) DO UPDATE SET
                title = excluded.title,
                outcomes_json = excluded.outcomes_json,
                occurred_at = excluded.occurred_at,
                observed_at = excluded.observed_at",
            params![id, project_id, task_id, title, outcomes_json, occurred_at, now],
        )?;
            let row = conn.query_row(
                &format!(
                    "SELECT {EVIDENCE_COLUMNS} FROM dev_lifecycle_evidence
                 WHERE project_id = ?1 AND source_kind = 'task' AND source_ref = ?2"
                ),
                params![project_id, task_id],
                row_to_evidence,
            )?;
            Ok(row)
        }
    )
}

/// The project's stored task evidence, newest first, at most `limit` rows.
pub fn list_task_evidence(
    pool: &DbPool,
    project_id: &str,
    limit: usize,
) -> Result<Vec<EvidenceRow>, AppError> {
    timed_query!(
        "dev_lifecycle_evidence",
        "dev_lifecycle::list_task_evidence",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {EVIDENCE_COLUMNS} FROM dev_lifecycle_evidence
             WHERE project_id = ?1 ORDER BY occurred_at DESC, id DESC LIMIT ?2"
            ))?;
            let rows = stmt
                .query_map(params![project_id, limit as i64], row_to_evidence)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        }
    )
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
