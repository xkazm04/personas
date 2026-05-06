//! Goals — user-stated objectives Athena tracks across sessions.
//!
//! No provenance contract: the user *is* the source. Goals are stateful
//! (active/paused/completed/abandoned), have a priority (1-5), and an
//! optional target date. Body markdown holds the full description plus
//! any sub-bullets the user added.
//!
//! Surfaced in retrieval as a small high-priority block — Athena
//! shouldn't lose track of what the user said they're trying to do.

use std::fs;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::companion::disk;
use crate::db::UserDbPool;
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalStatus {
    Active,
    Paused,
    Completed,
    Abandoned,
}

impl GoalStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            GoalStatus::Active => "active",
            GoalStatus::Paused => "paused",
            GoalStatus::Completed => "completed",
            GoalStatus::Abandoned => "abandoned",
        }
    }
    pub fn parse(s: &str) -> Result<Self, AppError> {
        match s {
            "active" => Ok(GoalStatus::Active),
            "paused" => Ok(GoalStatus::Paused),
            "completed" => Ok(GoalStatus::Completed),
            "abandoned" => Ok(GoalStatus::Abandoned),
            other => Err(AppError::Internal(format!(
                "goal status `{other}` not in (active|paused|completed|abandoned)"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Goal {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: i32,
    pub target_date: Option<String>,
    pub sources: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub file_path: String,
}

#[derive(Debug)]
pub struct GoalInput<'a> {
    pub title: &'a str,
    pub description: &'a str,
    pub priority: i32,
    pub target_date: Option<&'a str>,
    /// Optional supportive episode IDs — useful but not required.
    pub sources: &'a [String],
}

pub fn write_goal(pool: &UserDbPool, input: &GoalInput<'_>) -> Result<String, AppError> {
    if input.title.trim().is_empty() {
        return Err(AppError::Internal("goal title must not be empty".into()));
    }
    let id = format!("goal_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let priority = input.priority.clamp(1, 5);

    let slug = slugify(input.title);
    let rel_path = format!("goals/{id}_{slug}.md");
    let abs_path = disk::brain_root()?.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = format_goal_markdown(&id, &now, input, "active");
    fs::write(&abs_path, &body)?;
    let hash = sha256_hex(&body);
    let excerpt = excerpt_500(&format!("{}\n\n{}", input.title, input.description));
    let sources_json = serde_json::to_string(input.sources).unwrap_or_else(|_| "[]".into());

    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'goal', ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, rel_path, hash, priority, excerpt, now],
    )?;
    tx.execute(
        "INSERT INTO companion_goal (id, title, status, priority, target_date, sources_json, created_at, updated_at)
         VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6, ?6)",
        params![id, input.title, priority, input.target_date, sources_json, now],
    )?;
    tx.execute(
        "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, 'kind:goal status:active')",
        params![id, format!("{}\n\n{}", input.title, input.description)],
    )?;
    tx.commit()?;
    Ok(id)
}

pub fn update_status(pool: &UserDbPool, id: &str, status: GoalStatus) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let completed_at = if matches!(status, GoalStatus::Completed) {
        Some(now.clone())
    } else {
        None
    };
    // The node's importance doubles as a "won't surface in retrieval"
    // signal: completed/abandoned drop to 0 so they fall out of the
    // active goals block. The disk markdown stays as the audit record.
    let next_importance: i32 = match status {
        GoalStatus::Active => 4,
        GoalStatus::Paused => 2,
        GoalStatus::Completed | GoalStatus::Abandoned => 0,
    };
    let updated = conn.execute(
        "UPDATE companion_goal
         SET status = ?1, completed_at = COALESCE(?2, completed_at), updated_at = ?3
         WHERE id = ?4",
        params![status.as_str(), completed_at, now, id],
    )?;
    if updated == 0 {
        return Err(AppError::Internal(format!("goal `{id}` not found")));
    }
    conn.execute(
        "UPDATE companion_node SET importance = ?1, updated_at = ?2 WHERE id = ?3",
        params![next_importance, now, id],
    )?;
    Ok(())
}

pub fn list_goals(
    pool: &UserDbPool,
    status: Option<GoalStatus>,
    limit: u32,
) -> Result<Vec<Goal>, AppError> {
    let conn = pool.get()?;
    let (sql, rows): (String, Vec<Goal>) = if let Some(s) = status {
        let sql = "SELECT g.id, g.title, n.body_excerpt, g.status, g.priority, g.target_date, g.sources_json,
                          g.created_at, g.updated_at, g.completed_at, n.file_path
                   FROM companion_goal g
                   JOIN companion_node n ON n.id = g.id
                   WHERE g.status = ?1
                   ORDER BY g.priority DESC, g.updated_at DESC
                   LIMIT ?2";
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map(params![s.as_str(), limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        (sql.into(), rows)
    } else {
        let sql = "SELECT g.id, g.title, n.body_excerpt, g.status, g.priority, g.target_date, g.sources_json,
                          g.created_at, g.updated_at, g.completed_at, n.file_path
                   FROM companion_goal g
                   JOIN companion_node n ON n.id = g.id
                   ORDER BY
                     CASE g.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                     g.priority DESC, g.updated_at DESC
                   LIMIT ?1";
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map(params![limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        (sql.into(), rows)
    };
    drop(sql);

    // Hydrate full descriptions from disk (excerpt is truncated).
    let mut out = Vec::with_capacity(rows.len());
    for mut g in rows {
        if let Ok(full) = fs::read_to_string(disk::brain_root()?.join(&g.file_path)) {
            g.description = body_after_frontmatter(&full);
        }
        out.push(g);
    }
    Ok(out)
}

pub fn get_goal(pool: &UserDbPool, id: &str) -> Result<Option<Goal>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT g.id, g.title, n.body_excerpt, g.status, g.priority, g.target_date, g.sources_json,
                    g.created_at, g.updated_at, g.completed_at, n.file_path
             FROM companion_goal g
             JOIN companion_node n ON n.id = g.id
             WHERE g.id = ?1",
            params![id],
            map_row,
        )
        .optional()?;
    match row {
        Some(mut g) => {
            if let Ok(full) = fs::read_to_string(disk::brain_root()?.join(&g.file_path)) {
                g.description = body_after_frontmatter(&full);
            }
            Ok(Some(g))
        }
        None => Ok(None),
    }
}

pub fn delete_goal(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    let root = disk::brain_root()?;
    let conn = pool.get()?;
    let rel: Option<String> = conn
        .query_row(
            "SELECT file_path FROM companion_node WHERE id = ?1 AND kind = 'goal'",
            params![id],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM companion_goal WHERE id = ?1", params![id])?;
    tx.execute("DELETE FROM companion_fts WHERE node_id = ?1", params![id])?;
    tx.execute("DELETE FROM companion_node WHERE id = ?1", params![id])?;
    tx.commit()?;
    if let Some(rel) = rel {
        let src = root.join(&rel);
        let dst = root.join(format!(
            "goals/_deleted/{}",
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

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Goal> {
    let sources_json: String = row.get(6)?;
    let sources: Vec<String> = serde_json::from_str(&sources_json).unwrap_or_default();
    Ok(Goal {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        status: row.get(3)?,
        priority: row.get(4)?,
        target_date: row.get(5)?,
        sources,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        completed_at: row.get(9)?,
        file_path: row.get(10)?,
    })
}

fn format_goal_markdown(id: &str, now: &str, input: &GoalInput<'_>, status: &str) -> String {
    let mut s = format!(
        "---\nid: \"{id}\"\ntype: goal\ntitle: \"{}\"\nstatus: {status}\npriority: {}\ncreated: \"{now}\"\n",
        escape_yaml(input.title),
        input.priority
    );
    if let Some(td) = input.target_date {
        s.push_str(&format!("target_date: \"{td}\"\n"));
    }
    if !input.sources.is_empty() {
        s.push_str("sources:\n");
        for src in input.sources {
            s.push_str(&format!("  - \"{src}\"\n"));
        }
    }
    s.push_str("---\n\n");
    s.push_str(input.description);
    if !input.description.ends_with('\n') {
        s.push('\n');
    }
    s
}

fn body_after_frontmatter(md: &str) -> String {
    if let Some(after) = md.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            return after[end + 4..].trim_start().to_string();
        }
    }
    md.to_string()
}

fn escape_yaml(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "goal".into()
    } else {
        out.chars().take(40).collect()
    }
}

fn sha256_hex(s: &str) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(s.as_bytes())))
}

fn excerpt_500(s: &str) -> String {
    if s.len() <= 500 {
        return s.to_string();
    }
    let mut end = 500;
    while !s.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    s[..end].to_string()
}

fn short_uuid() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect()
}
