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
    /// When `true`, the dispatcher routes this capability through an
    /// approval card instead of auto-firing as a background job.
    /// Set true for any capability that writes to a user-visible
    /// external surface (post a message, send an email, delete data,
    /// run a SQL mutation) — the user should consciously approve those
    /// before they happen. Read-only listing / fetching stays auto-fire
    /// so Athena's "let me check your inbox" flows aren't gated on a
    /// card click.
    ///
    /// Surfaced spontaneously by Athena during the connector-audit run
    /// on 2026-05-27: *"the kind of action I'd want gated behind an
    /// approval card, not auto-fired through a generic connector call."*
    pub requires_approval: bool,
}

/// v1 capability registry. Each pinned-and-enabled connector teaches
/// Athena what it can do via these entries. Unknown service types
/// (no entry here) get an "awareness only — wiring in flight" line in
/// the prompt; she'll say so honestly instead of inventing a method.
///
/// Adding a new connector: extend this match arm + the handler in
/// `companion::jobs::connector_use::dispatch_capability` for reads
/// (auto-fire) or `commands::companion::approvals::execute_use_connector`'s
/// dispatch for writes (approval-gated).
pub fn capabilities_for(service_type: &str) -> Option<&'static [ConnectorCapability]> {
    match service_type {
        "sentry" => Some(&[
            ConnectorCapability {
                slug: "list_issues",
                description:
                    "List recent unresolved issues from the user's Sentry project (top N).",
                args: "limit?: number (default 10)",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "get_issue",
                description: "Fetch one issue's title + last-seen + event count by id.",
                args: "issue_id: string",
                requires_approval: false,
            },
        ]),
        "github" => Some(&[
            ConnectorCapability {
                slug: "list_repos",
                description: "List repos the authenticated user can read.",
                args: "limit?: number (default 20)",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "list_open_prs",
                description: "List open pull requests for one repo.",
                args: "owner: string, repo: string",
                requires_approval: false,
            },
        ]),
        "gmail" | "google_workspace" => Some(&[
            ConnectorCapability {
                slug: "list_recent_threads",
                description: "List the most recent N inbox threads (subject + from + snippet).",
                args: "limit?: number (default 10)",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "mark_thread_read",
                description: "Mark one Gmail thread as read (remove the UNREAD label).",
                args: "thread_id: string",
                requires_approval: true,
            },
            ConnectorCapability {
                slug: "send_message",
                description: "Send a Gmail message to one recipient (subject + plain-text body).",
                args: "to: string, subject: string, body: string",
                requires_approval: true,
            },
        ]),
        "slack" => Some(&[ConnectorCapability {
            slug: "list_channels",
            description: "List channels the bot user is a member of.",
            args: "(none)",
            requires_approval: false,
        }]),
        "discord" => Some(&[
            ConnectorCapability {
                slug: "list_recent_messages",
                description: "List the most recent N messages from one Discord channel (id + author + content).",
                args: "channel_id: string, limit?: number (default 20)",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "post_message",
                description: "Send a message to a Discord channel.",
                args: "channel_id: string, content: string",
                requires_approval: true,
            },
        ]),
        "notion" => Some(&[
            ConnectorCapability {
                slug: "list_pages",
                description: "Search Notion pages the integration can access. Returns title + id + last_edited_time. Filter older-than via `older_than_days`.",
                args: "limit?: number (default 20, max 100), older_than_days?: number, query?: string",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "get_page",
                description: "Fetch one Notion page's title + properties + last_edited_time by id.",
                args: "page_id: string",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "delete_page",
                description: "Archive one Notion page by id (Notion treats `archived=true` as soft-delete; the page disappears from search and most views).",
                args: "page_id: string",
                requires_approval: true,
            },
        ]),
        "local_drive" => Some(&[
            ConnectorCapability {
                slug: "list_files",
                description: "List files + subfolders directly under the local drive root (or a relative subpath).",
                args: "rel_path?: string (default \"\")",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "count_files",
                description: "Count files recursively under the local drive root (or a relative subpath).",
                args: "rel_path?: string (default \"\")",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "write_text_file",
                description: "Write (or overwrite) a UTF-8 text file at a relative path under the local drive root.",
                args: "rel_path: string, content: string",
                requires_approval: true,
            },
        ]),
        "elevenlabs" => Some(&[
            ConnectorCapability {
                slug: "list_voices",
                description: "List the user's custom + built-in ElevenLabs voices (name + voice_id + category).",
                args: "(none)",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "generate_tts",
                description: "Generate audio for a short text via one ElevenLabs voice; saves the MP3 to the local drive under `tts/` and returns the path.",
                args: "voice_id: string, text: string, out_rel_path?: string (default \"tts/clip-{timestamp}.mp3\")",
                requires_approval: true,
            },
        ]),
        "personas_database" => Some(&[
            ConnectorCapability {
                slug: "list_tables",
                description: "List user-defined tables in the Personas SQLite database (excluding internal sqlite_*).",
                args: "(none)",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "describe_table",
                description: "Show columns + types for one table.",
                args: "table_name: string",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "execute_select",
                description: "Run a single read-only SQL statement (SELECT only — any other verb is rejected at parse time). Returns rows as markdown.",
                args: "sql: string, limit?: number (default 50)",
                requires_approval: false,
            },
            ConnectorCapability {
                slug: "execute_mutation",
                description: "Run a single schema-mutating statement (CREATE/INSERT/UPDATE/DELETE/DROP). One statement per call.",
                args: "sql: string",
                requires_approval: true,
            },
        ]),
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

/// True iff `name` matches a builtin connector that declares
/// `"always_active": true` in its metadata. Those connectors
/// (`local_drive`, `personas_database`, the codebase builtins, ...)
/// need no vault credential and no user-pinning to be usable from
/// Athena's `use_connector` flow — they're available the moment the
/// app launches. The dispatcher's pin-gate consults this before
/// rejecting a `use_connector` op so always-active builtins don't
/// silently fail when the user hasn't manually pinned them.
pub fn is_always_active_builtin(name: &str) -> bool {
    crate::db::builtin_connectors::BUILTIN_CONNECTORS
        .iter()
        .find(|c| c.name == name)
        .and_then(|c| c.metadata)
        .map(|m| m.contains(r#""always_active":true"#))
        .unwrap_or(false)
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
