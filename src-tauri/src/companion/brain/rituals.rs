//! Rituals — recurring time/cadence-shaped preferences.
//!
//! Three kinds for v1:
//!   - **quiet_hours** — windows when proactive nudges are off-limits
//!     (e.g. weeknights 22:00–07:00, all weekend).
//!   - **cadence** — recurring check-ins (weekly retro Fridays at 17:00,
//!     monthly mood pulse).
//!   - **focus_window** — declared deep-work blocks Athena should respect
//!     (silence proactives, defer non-urgent observations).
//!
//! Schedule is stored as opaque JSON — Phase E (proactive engine) is
//! the consumer; this module is just storage + retrieval. Rituals do
//! NOT enter retrieval-into-prompt; they're behavioral guardrails for
//! the proactive scheduler, not memory.

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use std::fs;
use uuid::Uuid;

use crate::companion::disk;
use crate::db::UserDbPool;
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RitualKind {
    QuietHours,
    Cadence,
    FocusWindow,
}

impl RitualKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RitualKind::QuietHours => "quiet_hours",
            RitualKind::Cadence => "cadence",
            RitualKind::FocusWindow => "focus_window",
        }
    }
    pub fn parse(s: &str) -> Result<Self, AppError> {
        match s {
            "quiet_hours" => Ok(RitualKind::QuietHours),
            "cadence" => Ok(RitualKind::Cadence),
            "focus_window" => Ok(RitualKind::FocusWindow),
            other => Err(AppError::Internal(format!(
                "ritual kind `{other}` not in (quiet_hours|cadence|focus_window)"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Ritual {
    pub id: String,
    pub kind: String,
    pub description: String,
    pub schedule_json: String,
    pub active: bool,
    pub sources: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub file_path: String,
}

#[derive(Debug)]
pub struct RitualInput<'a> {
    pub kind: RitualKind,
    pub description: &'a str,
    pub schedule_json: &'a str,
    pub sources: &'a [String],
}

pub fn write_ritual(pool: &UserDbPool, input: &RitualInput<'_>) -> Result<String, AppError> {
    if input.description.trim().is_empty() {
        return Err(AppError::Internal(
            "ritual description must not be empty".into(),
        ));
    }
    // Validate schedule JSON parses, even though we don't enforce a
    // shape here — proactive engine (Phase E) owns the DSL semantics.
    let schedule: serde_json::Value = match serde_json::from_str(input.schedule_json) {
        Ok(v) => v,
        Err(e) => {
            return Err(AppError::Internal(format!(
                "ritual schedule_json is not valid JSON: {e}"
            )))
        }
    };
    // Quiet-hours / focus windows are interpreted by the proactive engine as
    // [from, to) local-time windows. A partially-edited window (missing or
    // unparseable from/to) silently resolves to "no window" at runtime — the
    // user's quiet hours quietly stop applying and Athena reaches them when
    // they expected silence. Reject the incomplete window at save time so the
    // misconfiguration surfaces instead of being swallowed.
    if matches!(input.kind.as_str(), "quiet_hours" | "focus_window") {
        for field in ["from", "to"] {
            let valid = schedule
                .get(field)
                .and_then(|v| v.as_str())
                .map(|s| chrono::NaiveTime::parse_from_str(s, "%H:%M").is_ok())
                .unwrap_or(false);
            if !valid {
                return Err(AppError::Validation(format!(
                    "{} ritual requires a valid \"{field}\" time in HH:MM format",
                    input.kind.as_str()
                )));
            }
        }
    }

    let id = format!("ritual_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let kind_s = input.kind.as_str();
    let rel_path = format!("rituals/{kind_s}/{id}.md");
    let abs_path = disk::brain_root()?.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = format_ritual_markdown(&id, kind_s, &now, input);
    fs::write(&abs_path, &body)?;
    let hash = sha256_hex(&body);
    let sources_json = serde_json::to_string(input.sources).unwrap_or_else(|_| "[]".into());

    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'ritual', ?2, ?3, 2, ?4, ?5, ?5)",
        params![id, rel_path, hash, input.description, now],
    )?;
    tx.execute(
        "INSERT INTO companion_ritual (id, kind, description, schedule_json, active, sources_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
        params![id, kind_s, input.description, input.schedule_json, sources_json, now],
    )?;
    tx.commit()?;
    Ok(id)
}

pub fn list_rituals(
    pool: &UserDbPool,
    kind: Option<RitualKind>,
    active_only: bool,
) -> Result<Vec<Ritual>, AppError> {
    let conn = pool.get()?;
    let mut clauses: Vec<&str> = Vec::new();
    if active_only {
        clauses.push("r.active = 1");
    }
    if kind.is_some() {
        clauses.push("r.kind = ?1");
    }
    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let sql = format!(
        "SELECT r.id, r.kind, r.description, r.schedule_json, r.active, r.sources_json,
                r.created_at, r.updated_at, n.file_path
         FROM companion_ritual r
         JOIN companion_node n ON n.id = r.id
         {where_clause}
         ORDER BY r.kind, r.created_at"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<Ritual> = if let Some(k) = kind {
        stmt.query_map(params![k.as_str()], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map([], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn get_ritual(pool: &UserDbPool, id: &str) -> Result<Option<Ritual>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT r.id, r.kind, r.description, r.schedule_json, r.active, r.sources_json,
                    r.created_at, r.updated_at, n.file_path
             FROM companion_ritual r
             JOIN companion_node n ON n.id = r.id
             WHERE r.id = ?1",
            params![id],
            map_row,
        )
        .optional()?;
    Ok(row)
}

pub fn set_active(pool: &UserDbPool, id: &str, active: bool) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE companion_ritual SET active = ?1, updated_at = ?2 WHERE id = ?3",
        params![if active { 1 } else { 0 }, now, id],
    )?;
    if updated == 0 {
        return Err(AppError::Internal(format!("ritual `{id}` not found")));
    }
    Ok(())
}

pub fn delete_ritual(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    let root = disk::brain_root()?;
    let conn = pool.get()?;
    let rel: Option<String> = conn
        .query_row(
            "SELECT file_path FROM companion_node WHERE id = ?1 AND kind = 'ritual'",
            params![id],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM companion_ritual WHERE id = ?1", params![id])?;
    tx.execute("DELETE FROM companion_node WHERE id = ?1", params![id])?;
    tx.commit()?;
    if let Some(rel) = rel {
        let src = root.join(&rel);
        let dst = root.join(format!(
            "rituals/_deleted/{}",
            src.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown.md")
        ));
        if let Some(parent) = dst.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::rename(&src, &dst);
    }
    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────────

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Ritual> {
    let sources_json: String = row.get(5)?;
    let sources: Vec<String> = serde_json::from_str(&sources_json).unwrap_or_default();
    Ok(Ritual {
        id: row.get(0)?,
        kind: row.get(1)?,
        description: row.get(2)?,
        schedule_json: row.get(3)?,
        active: row.get::<_, i32>(4)? != 0,
        sources,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        file_path: row.get(8)?,
    })
}

fn format_ritual_markdown(id: &str, kind: &str, now: &str, input: &RitualInput<'_>) -> String {
    let mut s = format!("---\nid: \"{id}\"\ntype: ritual\nkind: {kind}\ncreated: \"{now}\"\n",);
    if !input.sources.is_empty() {
        s.push_str("sources:\n");
        for src in input.sources {
            s.push_str(&format!("  - \"{src}\"\n"));
        }
    }
    s.push_str("---\n\n");
    s.push_str(input.description);
    s.push_str("\n\n## Schedule\n\n```json\n");
    s.push_str(input.schedule_json);
    s.push_str("\n```\n");
    s
}

fn sha256_hex(s: &str) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(s.as_bytes())))
}

fn short_uuid() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect()
}
