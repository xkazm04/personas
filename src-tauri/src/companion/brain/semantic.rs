//! Semantic memory: distilled facts about the user, projects, and world.
//!
//! Each fact has three persistence layers, in priority order:
//!   1. Markdown on disk under `~/.personas/companion-brain/semantic/<scope>/<id>.md`
//!      — source of truth, readable by humans, recoverable if the index is wiped.
//!   2. `companion_node` row (kind='fact') — drives generic listing/retrieval.
//!   3. `companion_fact` sidecar — typed metadata for queries (scope, key,
//!      confidence, supersedes/contradicts, last_seen).
//! Plus `companion_provenance` rows linking the fact to source episode IDs.
//!
//! **Provenance contract**: every fact write requires ≥1 source episode id.
//! Writes without sources are rejected at this layer — Athena can't bury a
//! hallucination by leaving the field empty. The dispatcher rejects the same
//! way at the op-parse layer for fast feedback.

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

/// Scope of a fact. We keep the trio small — three buckets are enough to
/// keep retrieval focused while making it cheap to reason about "what
/// does Athena know about *me* vs. about *this project*".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FactScope {
    User,
    Project,
    World,
}

impl FactScope {
    pub fn as_str(self) -> &'static str {
        match self {
            FactScope::User => "user",
            FactScope::Project => "project",
            FactScope::World => "world",
        }
    }

    pub fn parse(s: &str) -> Result<Self, AppError> {
        match s {
            "user" => Ok(FactScope::User),
            "project" => Ok(FactScope::Project),
            "world" => Ok(FactScope::World),
            other => Err(AppError::Internal(format!(
                "fact scope `{other}` not in (user|project|world)"
            ))),
        }
    }
}

/// One semantic fact, fully assembled across the three persistence layers.
#[derive(Debug, Clone)]
pub struct Fact {
    pub id: String,
    pub scope: String,
    pub key: String,
    pub value: String,
    pub importance: i32,
    pub confidence: f32,
    pub sources: Vec<String>,
    pub supersedes_id: Option<String>,
    pub contradicts_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_seen_at: String,
    pub file_path: String,
}

/// Input for writing a fact. `sources` non-empty is mandatory — caller
/// must build this from real episode IDs Athena cited in the proposal.
#[derive(Debug)]
pub struct FactInput<'a> {
    pub scope: FactScope,
    pub key: &'a str,
    pub value: &'a str,
    pub sources: &'a [String],
    pub importance: i32, // 1..5
    pub confidence: f32, // 0..1
    pub supersedes_id: Option<&'a str>,
    pub contradicts_id: Option<&'a str>,
}

pub fn write_fact(pool: &UserDbPool, input: &FactInput<'_>) -> Result<String, AppError> {
    if input.sources.is_empty() {
        return Err(AppError::Internal(
            "semantic fact rejected: at least one source episode_id is required \
             (anti-hallucination contract)"
                .into(),
        ));
    }
    if input.key.trim().is_empty() {
        return Err(AppError::Internal("fact key must not be empty".into()));
    }
    if input.value.trim().is_empty() {
        return Err(AppError::Internal("fact value must not be empty".into()));
    }

    let id = format!("fact_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let scope_s = input.scope.as_str();
    let importance = input.importance.clamp(1, 5);
    let confidence = input.confidence.clamp(0.0, 1.0);

    // Slugify the key so the filename stays portable (the key itself is
    // preserved verbatim in the SQL row + frontmatter).
    let slug = slugify(input.key);
    let rel_path = format!("semantic/{scope_s}/{id}_{slug}.md");
    let abs_path = disk::brain_root()?.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = format_fact_markdown(&id, scope_s, input.key, input.value, &now, input);
    fs::write(&abs_path, &body)?;

    let hash = sha256_hex(&body);
    let excerpt = excerpt_500(input.value);

    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'fact', ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, rel_path, hash, importance, excerpt, now],
    )?;

    tx.execute(
        "INSERT INTO companion_fact (id, scope, fact_key, confidence, supersedes_id, contradicts_id, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            scope_s,
            input.key,
            confidence,
            input.supersedes_id,
            input.contradicts_id,
            now,
        ],
    )?;

    for src in input.sources {
        // Tolerate duplicates silently — multiple cites of the same
        // episode aren't an error, they're just redundant.
        tx.execute(
            "INSERT OR IGNORE INTO companion_provenance (fact_id, episode_id) VALUES (?1, ?2)",
            params![id, src],
        )?;
    }

    tx.execute(
        "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, ?3)",
        params![
            id,
            input.value,
            format!("kind:fact scope:{scope_s} key:{}", input.key)
        ],
    )?;

    // Mark the prior fact as superseded (importance -> 0) without deleting:
    // historical record is preserved, but it stops winning retrieval.
    if let Some(prior) = input.supersedes_id {
        tx.execute(
            "UPDATE companion_node SET importance = 0, updated_at = ?1 WHERE id = ?2",
            params![now, prior],
        )?;
    }

    tx.commit()?;
    Ok(id)
}

/// Same as `write_fact`, but also embeds the value into vec0 so retrieval
/// can find it by similarity. Failure to embed is logged, not fatal.
#[cfg(feature = "ml")]
pub async fn write_fact_and_embed(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    input: &FactInput<'_>,
) -> Result<String, AppError> {
    let id = write_fact(pool, input)?;
    if let Err(e) = embeddings::embed_and_store(pool, embedder, &id, input.value).await {
        tracing::warn!(fact_id = %id, error = %e, "companion fact embed failed (continuing)");
    }
    Ok(id)
}

#[cfg(not(feature = "ml"))]
#[allow(dead_code)]
pub async fn write_fact_and_embed(
    pool: &UserDbPool,
    input: &FactInput<'_>,
) -> Result<String, AppError> {
    write_fact(pool, input)
}

/// List facts, optionally filtered by scope. Excludes superseded
/// (importance=0) entries by default — the consolidator can pass
/// `include_superseded=true` to inspect history.
pub fn list_facts(
    pool: &UserDbPool,
    scope: Option<FactScope>,
    include_superseded: bool,
    limit: u32,
) -> Result<Vec<Fact>, AppError> {
    let conn = pool.get()?;
    let scope_filter = match scope {
        Some(_) => "AND f.scope = ?1",
        None => "",
    };
    let imp_filter = if include_superseded {
        ""
    } else {
        "AND n.importance > 0"
    };
    let sql = format!(
        "SELECT n.id, f.scope, f.fact_key, n.body_excerpt, n.importance,
                f.confidence, f.supersedes_id, f.contradicts_id,
                n.created_at, n.updated_at, f.last_seen_at, n.file_path
         FROM companion_fact f
         JOIN companion_node n ON n.id = f.id
         WHERE n.kind = 'fact' {scope_filter} {imp_filter}
         ORDER BY n.importance DESC, n.updated_at DESC
         LIMIT ?{limit_param}",
        limit_param = if scope.is_some() { 2 } else { 1 }
    );

    let mut stmt = conn.prepare(&sql)?;

    let rows: Vec<Fact> = if let Some(s) = scope {
        stmt.query_map(params![s.as_str(), limit], map_fact_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![limit], map_fact_row)?
            .collect::<Result<Vec<_>, _>>()?
    };

    drop(stmt);
    // Hydrate sources per row from companion_provenance.
    let mut out = Vec::with_capacity(rows.len());
    for mut f in rows {
        f.sources = load_sources(&conn, &f.id)?;
        out.push(f);
    }
    Ok(out)
}

/// Look up a single fact by id (any scope; includes superseded).
pub fn get_fact(pool: &UserDbPool, id: &str) -> Result<Option<Fact>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT n.id, f.scope, f.fact_key, n.body_excerpt, n.importance,
                    f.confidence, f.supersedes_id, f.contradicts_id,
                    n.created_at, n.updated_at, f.last_seen_at, n.file_path
             FROM companion_fact f
             JOIN companion_node n ON n.id = f.id
             WHERE n.id = ?1",
            params![id],
            map_fact_row,
        )
        .optional()?;
    match row {
        Some(mut f) => {
            f.sources = load_sources(&conn, &f.id)?;
            Ok(Some(f))
        }
        None => Ok(None),
    }
}

/// Delete a fact (rare, audit-trail only). The disk markdown moves to
/// `semantic/_deleted/<id>.md` rather than being unlinked, so a recovery
/// cycle can rebuild the index. SQL rows are removed.
pub fn delete_fact(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    let root = disk::brain_root()?;
    let conn = pool.get()?;
    let rel: Option<String> = conn
        .query_row(
            "SELECT file_path FROM companion_node WHERE id = ?1 AND kind = 'fact'",
            params![id],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM companion_provenance WHERE fact_id = ?1", params![id])?;
    tx.execute("DELETE FROM companion_fact WHERE id = ?1", params![id])?;
    tx.execute("DELETE FROM companion_fts WHERE node_id = ?1", params![id])?;
    tx.execute("DELETE FROM companion_node WHERE id = ?1", params![id])?;
    // Best-effort embedding cleanup — vec0's table name is fixed; skip
    // if missing. The orphaned row is harmless (no node references it).
    let _ = tx.execute(
        "DELETE FROM companion_embedding WHERE node_id = ?1",
        params![id],
    );
    tx.commit()?;

    if let Some(rel) = rel {
        let src = root.join(&rel);
        let dst = root.join(format!(
            "semantic/_deleted/{}",
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

/// Touch the `last_seen_at` for a set of fact ids. Called by retrieval
/// when a fact is pulled into the working context, so reinforcement
/// resets the decay clock without needing an explicit user action.
pub fn touch_last_seen(pool: &UserDbPool, ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = pool.get()?;
    let now = Utc::now().to_rfc3339();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "UPDATE companion_fact SET last_seen_at = ? WHERE id IN ({placeholders})"
    );
    let mut p: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len() + 1);
    p.push(&now);
    for id in ids {
        p.push(id as &dyn rusqlite::ToSql);
    }
    conn.execute(&sql, p.as_slice())?;
    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────────

fn map_fact_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Fact> {
    Ok(Fact {
        id: row.get(0)?,
        scope: row.get(1)?,
        key: row.get(2)?,
        value: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        importance: row.get(4)?,
        confidence: row.get(5)?,
        supersedes_id: row.get(6)?,
        contradicts_id: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        last_seen_at: row.get(10)?,
        file_path: row.get(11)?,
        sources: Vec::new(),
    })
}

fn load_sources(conn: &rusqlite::Connection, fact_id: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT episode_id FROM companion_provenance WHERE fact_id = ?1 ORDER BY episode_id",
    )?;
    let rows = stmt
        .query_map(params![fact_id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn format_fact_markdown(
    id: &str,
    scope: &str,
    key: &str,
    value: &str,
    now: &str,
    input: &FactInput<'_>,
) -> String {
    let mut frontmatter = format!(
        "---\nid: \"{id}\"\ntype: fact\nscope: {scope}\nkey: \"{}\"\ncreated: \"{now}\"\nimportance: {}\nconfidence: {:.2}\nsources:\n",
        escape_yaml(key),
        input.importance,
        input.confidence
    );
    for src in input.sources {
        frontmatter.push_str(&format!("  - \"{src}\"\n"));
    }
    if let Some(s) = input.supersedes_id {
        frontmatter.push_str(&format!("supersedes: \"{s}\"\n"));
    }
    if let Some(c) = input.contradicts_id {
        frontmatter.push_str(&format!("contradicts: \"{c}\"\n"));
    }
    frontmatter.push_str("---\n\n");
    frontmatter.push_str(value);
    if !value.ends_with('\n') {
        frontmatter.push('\n');
    }
    frontmatter
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
        "fact".into()
    } else {
        out
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
