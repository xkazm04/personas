//! Backlog — Athena's self-promises and capability gaps.
//!
//! Two kinds:
//!   - **self_promise** — "I'll check on the deploy after lunch" or
//!     "let me get back to you on X". A specific commitment Athena
//!     made; the source episode pins down where it was made.
//!   - **capability_gap** — "I can't currently do X — should I propose
//!     wiring it up?". Surfaces in the backlog so the user can come
//!     back to it without Athena nagging.
//!
//! Append-only: items are resolved (`done` | `dropped`), not deleted.
//! `reminded_count` lets the proactive engine (Phase E) ratchet
//! frequency without re-pinging the same item every day.

use std::fs;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::companion::disk;
use crate::db::UserDbPool;
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BacklogKind {
    SelfPromise,
    CapabilityGap,
}

impl BacklogKind {
    pub fn as_str(self) -> &'static str {
        match self {
            BacklogKind::SelfPromise => "self_promise",
            BacklogKind::CapabilityGap => "capability_gap",
        }
    }
    pub fn parse(s: &str) -> Result<Self, AppError> {
        match s {
            "self_promise" => Ok(BacklogKind::SelfPromise),
            "capability_gap" => Ok(BacklogKind::CapabilityGap),
            other => Err(AppError::Internal(format!(
                "backlog kind `{other}` not in (self_promise|capability_gap)"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct BacklogItem {
    pub id: String,
    pub kind: String,
    pub summary: String,
    pub status: String,
    pub source_episode_id: Option<String>,
    pub reminded_count: i32,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub file_path: String,
}

#[derive(Debug)]
pub struct BacklogInput<'a> {
    pub kind: BacklogKind,
    pub summary: &'a str,
    /// Where Athena committed to this. Required for self_promise so
    /// the user can audit; optional for capability_gap.
    pub source_episode_id: Option<&'a str>,
}

pub fn write_item(pool: &UserDbPool, input: &BacklogInput<'_>) -> Result<String, AppError> {
    if input.summary.trim().is_empty() {
        return Err(AppError::Internal(
            "backlog summary must not be empty".into(),
        ));
    }
    if matches!(input.kind, BacklogKind::SelfPromise) && input.source_episode_id.is_none() {
        return Err(AppError::Internal(
            "backlog self_promise rejected: source_episode_id is required \
             (Athena needs to remember where she committed)"
                .into(),
        ));
    }

    let id = format!("blog_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let kind_s = input.kind.as_str();
    let rel_path = format!("backlog/{kind_s}/{id}.md");
    let abs_path = disk::brain_root()?.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = format_item_markdown(&id, kind_s, &now, input);
    fs::write(&abs_path, &body)?;
    let hash = sha256_hex(&body);

    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'backlog', ?2, ?3, 3, ?4, ?5, ?5)",
        params![id, rel_path, hash, input.summary, now],
    )?;
    tx.execute(
        "INSERT INTO companion_backlog_item (id, summary, kind, source_episode_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, input.summary, kind_s, input.source_episode_id, now],
    )?;
    tx.commit()?;
    Ok(id)
}

pub fn resolve_item(pool: &UserDbPool, id: &str, dropped: bool) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let new_status = if dropped { "dropped" } else { "done" };
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE companion_backlog_item
         SET status = ?1, resolved_at = ?2
         WHERE id = ?3 AND status = 'pending'",
        params![new_status, now, id],
    )?;
    if updated == 0 {
        return Err(AppError::Internal(format!(
            "backlog item `{id}` not found or already resolved"
        )));
    }
    // Drop importance so resolved items fall out of retrieval. The
    // markdown stays as the audit record.
    conn.execute(
        "UPDATE companion_node SET importance = 0, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn list_items(
    pool: &UserDbPool,
    kind: Option<BacklogKind>,
    pending_only: bool,
    limit: u32,
) -> Result<Vec<BacklogItem>, AppError> {
    let conn = pool.get()?;
    let mut clauses: Vec<&str> = Vec::new();
    if pending_only {
        clauses.push("b.status = 'pending'");
    }
    if kind.is_some() {
        clauses.push("b.kind = ?1");
    }
    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let sql = format!(
        "SELECT b.id, b.kind, b.summary, b.status, b.source_episode_id, b.reminded_count,
                b.created_at, b.resolved_at, n.file_path
         FROM companion_backlog_item b
         JOIN companion_node n ON n.id = b.id
         {where_clause}
         ORDER BY
           CASE b.status WHEN 'pending' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
           b.created_at DESC
         LIMIT ?{limit_param}",
        limit_param = if kind.is_some() { 2 } else { 1 }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<BacklogItem> = if let Some(k) = kind {
        stmt.query_map(params![k.as_str(), limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn get_item(pool: &UserDbPool, id: &str) -> Result<Option<BacklogItem>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT b.id, b.kind, b.summary, b.status, b.source_episode_id, b.reminded_count,
                    b.created_at, b.resolved_at, n.file_path
             FROM companion_backlog_item b
             JOIN companion_node n ON n.id = b.id
             WHERE b.id = ?1",
            params![id],
            map_row,
        )
        .optional()?;
    Ok(row)
}

/// Increment `reminded_count` so the proactive engine can ratchet
/// down its surfacing frequency. Returns the new count.
#[allow(dead_code)] // wired by Phase E proactive engine
pub fn bump_reminded(pool: &UserDbPool, id: &str) -> Result<i32, AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_backlog_item SET reminded_count = reminded_count + 1 WHERE id = ?1",
        params![id],
    )?;
    let count: i32 = conn.query_row(
        "SELECT reminded_count FROM companion_backlog_item WHERE id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    Ok(count)
}

// ── helpers ─────────────────────────────────────────────────────────────

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BacklogItem> {
    Ok(BacklogItem {
        id: row.get(0)?,
        kind: row.get(1)?,
        summary: row.get(2)?,
        status: row.get(3)?,
        source_episode_id: row.get(4)?,
        reminded_count: row.get(5)?,
        created_at: row.get(6)?,
        resolved_at: row.get(7)?,
        file_path: row.get(8)?,
    })
}

fn format_item_markdown(id: &str, kind: &str, now: &str, input: &BacklogInput<'_>) -> String {
    let mut s =
        format!("---\nid: \"{id}\"\ntype: backlog_item\nkind: {kind}\ncreated: \"{now}\"\n");
    if let Some(src) = input.source_episode_id {
        s.push_str(&format!("source_episode_id: \"{src}\"\n"));
    }
    s.push_str("---\n\n");
    s.push_str(input.summary);
    if !input.summary.ends_with('\n') {
        s.push('\n');
    }
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
