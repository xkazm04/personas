//! Procedural memory — durable how-to behaviors Athena follows.
//!
//! A procedural rule is *behavior*, not state. "When the user opens
//! the chat after a long break, lead with whatever's most stale in
//! observability" is a procedural — it tells Athena *how to act*, not
//! *what to remember*. Distinct from semantic facts which describe
//! the user/world.
//!
//! Persistence shape mirrors `semantic.rs`:
//!   1. Markdown on disk under `procedurals/<scope>/<id>.md` (source).
//!   2. `companion_node` row with `kind='procedural'`.
//!   3. `companion_procedural` sidecar (typed metadata).
//!   4. `companion_provenance` rows linking to source episodes.
//!
//! **Provenance contract**: every rule cites ≥1 source episode where
//! the behavior was confirmed/agreed-upon. Same anti-hallucination
//! rule as facts — Athena can't bury a self-invented behavior by
//! leaving sources empty.

use std::fs;
#[cfg(feature = "ml")]
use std::sync::Arc;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::companion::brain::embeddings;
use crate::companion::disk;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Where the rule applies. Scopes are intentionally coarse — a rule
/// is either chat-shaped (how to talk), action-shaped (how to choose
/// what to propose), memory-shaped (when to write a fact), or build-
/// shaped (how to help with persona/template work).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProceduralScope {
    Chat,
    Action,
    Memory,
    Build,
}

impl ProceduralScope {
    pub fn as_str(self) -> &'static str {
        match self {
            ProceduralScope::Chat => "chat",
            ProceduralScope::Action => "action",
            ProceduralScope::Memory => "memory",
            ProceduralScope::Build => "build",
        }
    }
    pub fn parse(s: &str) -> Result<Self, AppError> {
        match s {
            "chat" => Ok(ProceduralScope::Chat),
            "action" => Ok(ProceduralScope::Action),
            "memory" => Ok(ProceduralScope::Memory),
            "build" => Ok(ProceduralScope::Build),
            other => Err(AppError::Internal(format!(
                "procedural scope `{other}` not in (chat|action|memory|build)"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Procedural {
    pub id: String,
    pub scope: String,
    pub trigger: String,
    pub behavior: String,
    pub importance: i32,
    pub confidence: f32,
    pub sources: Vec<String>,
    pub supersedes_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: String,
    pub file_path: String,
}

#[derive(Debug)]
pub struct ProceduralInput<'a> {
    pub scope: ProceduralScope,
    pub trigger: &'a str,
    pub behavior: &'a str,
    pub sources: &'a [String],
    pub importance: i32,
    pub confidence: f32,
    pub supersedes_id: Option<&'a str>,
}

pub fn write_rule(pool: &UserDbPool, input: &ProceduralInput<'_>) -> Result<String, AppError> {
    if input.sources.is_empty() {
        return Err(AppError::Internal(
            "procedural rule rejected: at least one source episode_id is required \
             (anti-hallucination contract)"
                .into(),
        ));
    }
    if input.trigger.trim().is_empty() {
        return Err(AppError::Internal(
            "procedural trigger must not be empty".into(),
        ));
    }
    if input.behavior.trim().is_empty() {
        return Err(AppError::Internal(
            "procedural behavior must not be empty".into(),
        ));
    }

    let id = format!("proc_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let scope_s = input.scope.as_str();
    let importance = input.importance.clamp(1, 5);
    let confidence = input.confidence.clamp(0.0, 1.0);

    let slug = slugify(input.trigger);
    let rel_path = format!("procedurals/{scope_s}/{id}_{slug}.md");
    let abs_path = disk::brain_root()?.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = format_rule_markdown(&id, scope_s, &now, input);
    fs::write(&abs_path, &body)?;

    let hash = sha256_hex(&body);
    let excerpt = excerpt_500(&format!("{}\n\n{}", input.trigger, input.behavior));

    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'procedural', ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, rel_path, hash, importance, excerpt, now],
    )?;
    tx.execute(
        "INSERT INTO companion_procedural (id, scope, trigger_pattern, confidence, supersedes_id, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, scope_s, input.trigger, confidence, input.supersedes_id, now],
    )?;
    for src in input.sources {
        tx.execute(
            "INSERT OR IGNORE INTO companion_provenance (fact_id, episode_id) VALUES (?1, ?2)",
            params![id, src],
        )?;
    }
    tx.execute(
        "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, ?3)",
        params![
            id,
            format!("{}\n\n{}", input.trigger, input.behavior),
            format!("kind:procedural scope:{scope_s}")
        ],
    )?;
    if let Some(prior) = input.supersedes_id {
        tx.execute(
            "UPDATE companion_node SET importance = 0, updated_at = ?1 WHERE id = ?2",
            params![now, prior],
        )?;
    }
    tx.commit()?;
    Ok(id)
}

#[cfg(feature = "ml")]
pub async fn write_rule_and_embed(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    input: &ProceduralInput<'_>,
) -> Result<String, AppError> {
    let id = write_rule(pool, input)?;
    let embed_text = format!("{}\n\n{}", input.trigger, input.behavior);
    if let Err(e) = embeddings::embed_and_store(pool, embedder, &id, &embed_text).await {
        tracing::warn!(rule_id = %id, error = %e, "procedural embed failed (continuing)");
    }
    Ok(id)
}

#[cfg(not(feature = "ml"))]
#[allow(dead_code)]
pub async fn write_rule_and_embed(
    pool: &UserDbPool,
    input: &ProceduralInput<'_>,
) -> Result<String, AppError> {
    write_rule(pool, input)
}

pub fn list_rules(
    pool: &UserDbPool,
    scope: Option<ProceduralScope>,
    include_superseded: bool,
    limit: u32,
) -> Result<Vec<Procedural>, AppError> {
    let conn = pool.get()?;
    let scope_filter = match scope {
        Some(_) => "AND p.scope = ?1",
        None => "",
    };
    let imp_filter = if include_superseded {
        ""
    } else {
        "AND n.importance > 0"
    };
    let sql = format!(
        "SELECT n.id, p.scope, p.trigger_pattern, n.body_excerpt, n.importance,
                p.confidence, p.supersedes_id,
                n.created_at, n.updated_at, p.last_used_at, n.file_path
         FROM companion_procedural p
         JOIN companion_node n ON n.id = p.id
         WHERE n.kind = 'procedural' {scope_filter} {imp_filter}
         ORDER BY n.importance DESC, n.updated_at DESC
         LIMIT ?{limit_param}",
        limit_param = if scope.is_some() { 2 } else { 1 }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<Procedural> = if let Some(s) = scope {
        stmt.query_map(params![s.as_str(), limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    };
    drop(stmt);

    let mut out = Vec::with_capacity(rows.len());
    for mut r in rows {
        r.sources = load_sources(&conn, &r.id)?;
        let full = fs::read_to_string(disk::brain_root()?.join(&r.file_path)).ok();
        if let Some(full) = full {
            r.behavior = body_after_frontmatter(&full);
        }
        out.push(r);
    }
    Ok(out)
}

pub fn get_rule(pool: &UserDbPool, id: &str) -> Result<Option<Procedural>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT n.id, p.scope, p.trigger_pattern, n.body_excerpt, n.importance,
                    p.confidence, p.supersedes_id,
                    n.created_at, n.updated_at, p.last_used_at, n.file_path
             FROM companion_procedural p
             JOIN companion_node n ON n.id = p.id
             WHERE n.id = ?1",
            params![id],
            map_row,
        )
        .optional()?;
    match row {
        Some(mut r) => {
            r.sources = load_sources(&conn, &r.id)?;
            if let Ok(full) = fs::read_to_string(disk::brain_root()?.join(&r.file_path)) {
                r.behavior = body_after_frontmatter(&full);
            }
            Ok(Some(r))
        }
        None => Ok(None),
    }
}

pub fn delete_rule(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    let root = disk::brain_root()?;
    let conn = pool.get()?;
    let rel: Option<String> = conn
        .query_row(
            "SELECT file_path FROM companion_node WHERE id = ?1 AND kind = 'procedural'",
            params![id],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM companion_provenance WHERE fact_id = ?1",
        params![id],
    )?;
    tx.execute(
        "DELETE FROM companion_procedural WHERE id = ?1",
        params![id],
    )?;
    tx.execute("DELETE FROM companion_fts WHERE node_id = ?1", params![id])?;
    tx.execute("DELETE FROM companion_node WHERE id = ?1", params![id])?;
    let _ = tx.execute(
        "DELETE FROM companion_embedding WHERE node_id = ?1",
        params![id],
    );
    tx.commit()?;
    if let Some(rel) = rel {
        let src = root.join(&rel);
        let dst = root.join(format!(
            "procedurals/_deleted/{}",
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

pub fn touch_last_used(pool: &UserDbPool, ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = pool.get()?;
    let now = Utc::now().to_rfc3339();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql =
        format!("UPDATE companion_procedural SET last_used_at = ? WHERE id IN ({placeholders})");
    let mut p: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len() + 1);
    p.push(&now);
    for id in ids {
        p.push(id as &dyn rusqlite::ToSql);
    }
    conn.execute(&sql, p.as_slice())?;
    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────────

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Procedural> {
    Ok(Procedural {
        id: row.get(0)?,
        scope: row.get(1)?,
        trigger: row.get(2)?,
        behavior: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        importance: row.get(4)?,
        confidence: row.get(5)?,
        supersedes_id: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        last_used_at: row.get(9)?,
        file_path: row.get(10)?,
        sources: Vec::new(),
    })
}

fn load_sources(conn: &rusqlite::Connection, id: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT episode_id FROM companion_provenance WHERE fact_id = ?1 ORDER BY episode_id",
    )?;
    let rows = stmt
        .query_map(params![id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn format_rule_markdown(id: &str, scope: &str, now: &str, input: &ProceduralInput<'_>) -> String {
    let mut s = format!(
        "---\nid: \"{id}\"\ntype: procedural\nscope: {scope}\ntrigger: \"{}\"\ncreated: \"{now}\"\nimportance: {}\nconfidence: {:.2}\nsources:\n",
        escape_yaml(input.trigger),
        input.importance,
        input.confidence
    );
    for src in input.sources {
        s.push_str(&format!("  - \"{src}\"\n"));
    }
    if let Some(sup) = input.supersedes_id {
        s.push_str(&format!("supersedes: \"{sup}\"\n"));
    }
    s.push_str("---\n\n");
    s.push_str(input.behavior);
    if !input.behavior.ends_with('\n') {
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
        "procedural".into()
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
