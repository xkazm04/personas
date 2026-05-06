//! Phase G: project registry — repos/projects Athena's Dev Tools knows
//! about.
//!
//! On first run we seed the Personas repo (the one this binary was
//! compiled in) as the default project so "list projects" and "scan
//! project X" have something to act on out-of-the-box. Users register
//! more via the `register_project` op (or directly via the Tauri
//! command).
//!
//! This is a small surface — the registry is a list of `(name, path,
//! description, last_scan_at, last_scan_summary)`. Anything heavier
//! (per-project metadata, multi-repo orchestration) lands later.

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::UserDbPool;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownProject {
    pub id: String,
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub last_scan_at: Option<String>,
    pub last_scan_summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list(pool: &UserDbPool) -> Result<Vec<KnownProject>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, path, description, last_scan_at, last_scan_summary, created_at, updated_at
         FROM companion_known_project
         ORDER BY name",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(KnownProject {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                description: row.get(3)?,
                last_scan_at: row.get(4)?,
                last_scan_summary: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(pool: &UserDbPool, id: &str) -> Result<Option<KnownProject>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT id, name, path, description, last_scan_at, last_scan_summary, created_at, updated_at
             FROM companion_known_project WHERE id = ?1",
            params![id],
            |row| {
                Ok(KnownProject {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    description: row.get(3)?,
                    last_scan_at: row.get(4)?,
                    last_scan_summary: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

pub fn register(
    pool: &UserDbPool,
    name: &str,
    path: &str,
    description: Option<&str>,
) -> Result<String, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Internal("project name must not be empty".into()));
    }
    if path.trim().is_empty() {
        return Err(AppError::Internal("project path must not be empty".into()));
    }
    let id = format!("proj_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    // Upsert on path so re-registering the same repo updates the name
    // / description rather than erroring out — friendlier when the
    // user wants to rename a project.
    conn.execute(
        "INSERT INTO companion_known_project (id, name, path, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(path) DO UPDATE SET name = ?2, description = ?4, updated_at = ?5",
        params![id, name, path, description, now],
    )?;
    // Look up the row by path to return the right id (might be the
    // pre-existing one on conflict).
    let final_id: String = conn.query_row(
        "SELECT id FROM companion_known_project WHERE path = ?1",
        params![path],
        |r| r.get(0),
    )?;
    Ok(final_id)
}

pub fn record_scan(
    pool: &UserDbPool,
    project_id: &str,
    summary: &str,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_known_project
         SET last_scan_at = ?1, last_scan_summary = ?2, updated_at = ?1
         WHERE id = ?3",
        params![now, summary, project_id],
    )?;
    Ok(())
}

/// Seed the registry with the Personas repo on first init. Idempotent
/// via the `path` UNIQUE constraint. The path is computed from
/// `CARGO_MANIFEST_DIR` at compile time (which is `src-tauri/`) and
/// resolved up one level to the repo root.
pub fn seed_default_project(pool: &UserDbPool) -> Result<(), AppError> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // CARGO_MANIFEST_DIR points at src-tauri/, repo root is its parent.
    let repo_root = manifest_dir
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or(manifest_dir.clone());
    let path_str = repo_root.to_string_lossy().to_string();
    let _ = register(
        pool,
        "Personas",
        &path_str,
        Some("Local-first desktop app for designing and operating AI agents."),
    )?;
    Ok(())
}

fn short_uuid() -> String {
    Uuid::new_v4().simple().to_string().chars().take(10).collect()
}
