//! Phase F: companion plugin toggles.
//!
//! A "plugin" here is a contextual capability the user toggles on so
//! Athena becomes *aware* of it and can lead the user through using it.
//! v1 ships one plugin — `dev_tools`, the codebase scan / idea gen /
//! task batching / projects state cluster.
//!
//! Toggle on → prompt builder appends a section explaining what the
//! plugin does and when Athena should suggest it. Toggle off →
//! Athena loses that awareness for the next turn.
//!
//! Why a separate table from connectors: connectors are *external*
//! credentials (GitHub, Gmail). Plugins are *internal* app capabilities
//! Athena can lean on. Different lifecycle, different UX (plugins are
//! a single canonical set, not a user-curated subset of a vault).

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::db::UserDbPool;
use crate::error::AppError;

/// The plugin slug. Add new variants here as more plugins land — the
/// frontend mirrors this list and the prompt builder dispatches on it
/// to render the right awareness block.
pub const PLUGIN_DEV_TOOLS: &str = "dev_tools";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginToggle {
    pub plugin_name: String,
    pub enabled: bool,
    pub updated_at: String,
}

/// Read all plugin toggles, with default rows synthesized for the
/// canonical set (so the frontend always sees `dev_tools` even before
/// the user has interacted with it). Anything not in the canonical
/// set is kept for forward-compat but won't appear in UI until the
/// frontend learns about it.
pub fn list(pool: &UserDbPool) -> Result<Vec<PluginToggle>, AppError> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("SELECT plugin_name, enabled, updated_at FROM companion_plugin_toggle")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PluginToggle {
                plugin_name: row.get(0)?,
                enabled: row.get::<_, i32>(1)? != 0,
                updated_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Synthesize defaults for any canonical plugin that's absent.
    let mut out = rows;
    for canonical in [PLUGIN_DEV_TOOLS] {
        if !out.iter().any(|r| r.plugin_name == canonical) {
            out.push(PluginToggle {
                plugin_name: canonical.to_string(),
                enabled: false,
                updated_at: Utc::now().to_rfc3339(),
            });
        }
    }
    Ok(out)
}

pub fn set_enabled(pool: &UserDbPool, plugin_name: &str, enabled: bool) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_plugin_toggle (plugin_name, enabled, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(plugin_name) DO UPDATE SET enabled = ?2, updated_at = ?3",
        params![plugin_name, if enabled { 1 } else { 0 }, now],
    )?;
    Ok(())
}

/// Names of plugins that are enabled. Cheap; called every turn by the
/// prompt builder.
pub fn list_enabled(pool: &UserDbPool) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("SELECT plugin_name FROM companion_plugin_toggle WHERE enabled = 1")?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[allow(dead_code)]
pub fn is_enabled(pool: &UserDbPool, plugin_name: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let row: Option<i32> = conn
        .query_row(
            "SELECT enabled FROM companion_plugin_toggle WHERE plugin_name = ?1",
            params![plugin_name],
            |r| r.get(0),
        )
        .optional()?;
    Ok(row == Some(1))
}
