//! Per-project tracking subscription. Owned by the Dev Tools plugin
//! (Phase 4 wires the editor UI); read by the engine scheduler each tick
//! to decide which projects to poll and which sources are enabled.
//!
//! Schema is in `dev_tools_project_subscription` (see Phase 0 migration).

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::UserDbPool;
use crate::error::AppError;

/// Per-project tracking config. One row per row in
/// `companion_known_project`. The Dev Tools edit form writes these;
/// the engine reads them.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub project_id: String,
    /// Project filesystem path — denormalized from
    /// `companion_known_project.path` for the watcher's convenience.
    pub project_path: String,
    pub watch_git: bool,
    pub watch_active_runs: bool,
    pub watch_obsidian: bool,
    pub obsidian_vault_path: Option<String>,
    pub enabled: bool,
    pub last_pulse_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Read all enabled subscriptions joined to their project path. The
/// scheduler iterates this set on every tick.
pub fn list_enabled(pool: &UserDbPool) -> Result<Vec<Subscription>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT s.project_id, p.path, s.watch_git, s.watch_active_runs,
                s.watch_obsidian, s.obsidian_vault_path, s.enabled,
                s.last_pulse_at, s.created_at, s.updated_at
         FROM dev_tools_project_subscription s
         JOIN companion_known_project p ON p.id = s.project_id
         WHERE s.enabled = 1",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Subscription {
                project_id: row.get(0)?,
                project_path: row.get(1)?,
                watch_git: row.get::<_, i64>(2)? != 0,
                watch_active_runs: row.get::<_, i64>(3)? != 0,
                watch_obsidian: row.get::<_, i64>(4)? != 0,
                obsidian_vault_path: row.get(5)?,
                enabled: row.get::<_, i64>(6)? != 0,
                last_pulse_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Read one subscription by project_id (returns None if not yet
/// subscribed). Used by Phase 5 for chat-context preflight.
pub fn get(
    pool: &UserDbPool,
    project_id: &str,
) -> Result<Option<Subscription>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT s.project_id, p.path, s.watch_git, s.watch_active_runs,
                s.watch_obsidian, s.obsidian_vault_path, s.enabled,
                s.last_pulse_at, s.created_at, s.updated_at
         FROM dev_tools_project_subscription s
         JOIN companion_known_project p ON p.id = s.project_id
         WHERE s.project_id = ?1",
    )?;
    let row = stmt
        .query_row(params![project_id], |row| {
            Ok(Subscription {
                project_id: row.get(0)?,
                project_path: row.get(1)?,
                watch_git: row.get::<_, i64>(2)? != 0,
                watch_active_runs: row.get::<_, i64>(3)? != 0,
                watch_obsidian: row.get::<_, i64>(4)? != 0,
                obsidian_vault_path: row.get(5)?,
                enabled: row.get::<_, i64>(6)? != 0,
                last_pulse_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .optional()?;
    Ok(row)
}

/// Stamp the most-recent successful tick. The next tick uses this as
/// the lower bound when polling watchers (only emit events newer than
/// this).
pub fn update_last_pulse_at(
    pool: &UserDbPool,
    project_id: &str,
    when: DateTime<Utc>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE dev_tools_project_subscription
         SET last_pulse_at = ?1, updated_at = datetime('now')
         WHERE project_id = ?2",
        params![when.to_rfc3339(), project_id],
    )?;
    Ok(())
}

/// Effective lower-bound for the next watcher poll. Falls back to "24h
/// ago" on first enable (per the user's "first-run experience" decision
/// — backfill consumes the last 24h and produces an immediate pulse).
pub fn watch_since(sub: &Subscription) -> DateTime<Utc> {
    if let Some(stamp) = &sub.last_pulse_at {
        if let Ok(parsed) = DateTime::parse_from_rfc3339(stamp) {
            return parsed.with_timezone(&Utc);
        }
    }
    Utc::now() - chrono::Duration::hours(24)
}

/// Read all subscriptions joined to project name + path. Phase 4's
/// editor lists all projects and their subscription state, including
/// disabled ones (so the user can flip them on).
pub fn list_with_projects(
    pool: &UserDbPool,
) -> Result<Vec<SubscriptionWithProject>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.path,
                COALESCE(s.watch_git, 1),
                COALESCE(s.watch_active_runs, 1),
                COALESCE(s.watch_obsidian, 0),
                s.obsidian_vault_path,
                COALESCE(s.enabled, 0),
                s.last_pulse_at,
                s.created_at,
                s.updated_at
         FROM companion_known_project p
         LEFT JOIN dev_tools_project_subscription s ON s.project_id = p.id
         ORDER BY p.name",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SubscriptionWithProject {
                project_id: row.get(0)?,
                project_name: row.get(1)?,
                project_path: row.get(2)?,
                watch_git: row.get::<_, i64>(3)? != 0,
                watch_active_runs: row.get::<_, i64>(4)? != 0,
                watch_obsidian: row.get::<_, i64>(5)? != 0,
                obsidian_vault_path: row.get(6)?,
                enabled: row.get::<_, i64>(7)? != 0,
                last_pulse_at: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// UI-shape for the Dev Tools tracking editor. Joins project metadata
/// with subscription flags so a single row renders without a follow-up
/// fetch.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionWithProject {
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    pub watch_git: bool,
    pub watch_active_runs: bool,
    pub watch_obsidian: bool,
    pub obsidian_vault_path: Option<String>,
    pub enabled: bool,
    pub last_pulse_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Upsert the subscription for one project. Insert-on-missing,
/// update-on-existing. The engine scheduler picks up the change on its
/// next tick (no signal needed — list_enabled re-reads each tick).
pub fn upsert(
    pool: &UserDbPool,
    update: &SubscriptionUpdate,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_tools_project_subscription
            (project_id, watch_git, watch_active_runs, watch_obsidian,
             obsidian_vault_path, enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(project_id) DO UPDATE SET
            watch_git = excluded.watch_git,
            watch_active_runs = excluded.watch_active_runs,
            watch_obsidian = excluded.watch_obsidian,
            obsidian_vault_path = excluded.obsidian_vault_path,
            enabled = excluded.enabled,
            updated_at = datetime('now')",
        params![
            update.project_id,
            update.watch_git as i64,
            update.watch_active_runs as i64,
            update.watch_obsidian as i64,
            update.obsidian_vault_path,
            update.enabled as i64,
        ],
    )?;
    Ok(())
}

/// Inputs for [`upsert`]. Mirrors `Subscription` but excludes the
/// engine-managed fields (`last_pulse_at`, timestamps).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionUpdate {
    pub project_id: String,
    pub watch_git: bool,
    pub watch_active_runs: bool,
    pub watch_obsidian: bool,
    pub obsidian_vault_path: Option<String>,
    pub enabled: bool,
}
