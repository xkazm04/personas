//! Phase F: companion-attached connectors.
//!
//! The user can pin a subset of their vault connectors into Athena's
//! chat surface. This module owns the persisted list (which connectors
//! are pinned, which are enabled). The prompt builder reads
//! `list_enabled_for_prompt` on every turn so Athena's awareness stays
//! in sync with the sidebar UI without additional plumbing.
//!
//! v1 scope: awareness only. We *list* the enabled connectors in the
//! prompt so Athena can reference them ("you have GitHub attached, want
//! me to look at your repos?") but she doesn't actually invoke them
//! yet — the `use_connector` op lands in a follow-up phase that needs
//! careful sandboxing of which credential payloads are passed through.

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::db::UserDbPool;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveConnector {
    pub connector_name: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// One capability a connector can perform. The registry below maps a
/// service-type slug (matches `vault_credential.service_type`) to the
/// capabilities it exposes to Athena's chat — so the prompt builder
/// can teach her concrete actions per pinned connector and the
/// `use_connector` executor can validate she's calling something real.
///
/// **Capability discipline**: keep these *intent-shaped* ("list recent
/// issues", not "GET /api/0/projects/X/issues/"). Athena talks intent;
/// the per-connector handler translates it into the API call.
#[derive(Debug, Clone, Copy)]
pub struct ConnectorCapability {
    /// Slug Athena emits in `OP: use_connector { capability: ... }`.
    pub slug: &'static str,
    /// One-line description Athena reads in the prompt.
    pub description: &'static str,
    /// Comma-separated arg names Athena must supply (informational).
    pub args: &'static str,
}

/// v1 capability registry. Each pinned-and-enabled connector teaches
/// Athena what it can do via these entries. Unknown service types
/// (no entry here) get an "awareness only — wiring in flight" line in
/// the prompt; she'll say so honestly instead of inventing a method.
///
/// Adding a new connector: extend this match arm + (when wiring real
/// API calls) the handler in `commands::companion::approvals::execute_use_connector`.
pub fn capabilities_for(service_type: &str) -> Option<&'static [ConnectorCapability]> {
    match service_type {
        "sentry" => Some(&[
            ConnectorCapability {
                slug: "list_issues",
                description:
                    "List recent unresolved issues from the user's Sentry project (top N).",
                args: "limit?: number (default 10)",
            },
            ConnectorCapability {
                slug: "get_issue",
                description: "Fetch one issue's title + last-seen + event count by id.",
                args: "issue_id: string",
            },
        ]),
        "github" => Some(&[
            ConnectorCapability {
                slug: "list_repos",
                description: "List repos the authenticated user can read.",
                args: "limit?: number (default 20)",
            },
            ConnectorCapability {
                slug: "list_open_prs",
                description: "List open pull requests for one repo.",
                args: "owner: string, repo: string",
            },
        ]),
        "gmail" | "google_workspace" => Some(&[ConnectorCapability {
            slug: "list_recent_threads",
            description: "List the most recent N inbox threads (subject + from + snippet).",
            args: "limit?: number (default 10)",
        }]),
        "slack" => Some(&[ConnectorCapability {
            slug: "list_channels",
            description: "List channels the bot user is a member of.",
            args: "(none)",
        }]),
        _ => None,
    }
}

pub fn list(pool: &UserDbPool) -> Result<Vec<ActiveConnector>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT connector_name, enabled, created_at, updated_at
         FROM companion_active_connector
         ORDER BY created_at",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ActiveConnector {
                connector_name: row.get(0)?,
                enabled: row.get::<_, i32>(1)? != 0,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Names of connectors that are pinned AND enabled. Used by the
/// prompt builder — keeps the prompt compact (no metadata) since
/// Athena only needs the names to mention them.
pub fn list_enabled_for_prompt(pool: &UserDbPool) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT connector_name FROM companion_active_connector
         WHERE enabled = 1
         ORDER BY connector_name",
    )?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Pin a connector. Idempotent — duplicate add of the same name is a
/// no-op (status preserved). Default enabled=true on first add.
pub fn add(pool: &UserDbPool, connector_name: &str) -> Result<(), AppError> {
    if connector_name.trim().is_empty() {
        return Err(AppError::Internal(
            "companion connector add: empty connector_name".into(),
        ));
    }
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_active_connector (connector_name, enabled, created_at, updated_at)
         VALUES (?1, 1, ?2, ?2)
         ON CONFLICT(connector_name) DO NOTHING",
        params![connector_name, now],
    )?;
    Ok(())
}

pub fn remove(pool: &UserDbPool, connector_name: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM companion_active_connector WHERE connector_name = ?1",
        params![connector_name],
    )?;
    Ok(())
}

pub fn set_enabled(pool: &UserDbPool, connector_name: &str, enabled: bool) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE companion_active_connector
         SET enabled = ?1, updated_at = ?2
         WHERE connector_name = ?3",
        params![if enabled { 1 } else { 0 }, now, connector_name],
    )?;
    if updated == 0 {
        return Err(AppError::Internal(format!(
            "connector `{connector_name}` not pinned"
        )));
    }
    Ok(())
}

/// Replace the entire pinned set with `names` in one transaction.
/// Used by the picker modal which sends an "apply" with the full
/// post-edit list — additions get inserted, removals get deleted.
/// Existing names keep their `enabled` state (no churn for a no-op).
pub fn replace_all(pool: &UserDbPool, names: &[String]) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    // Delete anything not in `names`.
    {
        let placeholders = if names.is_empty() {
            "''".to_string()
        } else {
            std::iter::repeat("?")
                .take(names.len())
                .collect::<Vec<_>>()
                .join(",")
        };
        let sql = format!(
            "DELETE FROM companion_active_connector WHERE connector_name NOT IN ({placeholders})"
        );
        let p: Vec<&dyn rusqlite::ToSql> =
            names.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        tx.execute(&sql, p.as_slice())?;
    }
    // Insert new names. ON CONFLICT preserves existing rows untouched.
    for name in names {
        let _ = tx.execute(
            "INSERT INTO companion_active_connector (connector_name, enabled, created_at, updated_at)
             VALUES (?1, 1, ?2, ?2)
             ON CONFLICT(connector_name) DO NOTHING",
            params![name, now],
        );
    }
    tx.commit()?;
    Ok(())
}

/// Lightweight existence check for the prompt builder — returns true
/// iff at least one enabled connector is pinned. Used to skip
/// rendering the prompt section entirely on empty state.
#[allow(dead_code)]
pub fn has_any_enabled(pool: &UserDbPool) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let row: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM companion_active_connector WHERE enabled = 1 LIMIT 1",
            params![],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    Ok(row.is_some())
}
