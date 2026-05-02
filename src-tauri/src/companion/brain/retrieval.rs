//! Hybrid retrieval bundling memory into the working context for each turn.
//!
//! Phase 2.5: returns episodes AND doctrine separately so the prompt can
//! render them in distinct sections. Both flow through the same vec0
//! search; we split by `companion_node.kind` after the search.
//!
//! Strategy:
//!   - Episodes: last 5 turns by recency + top 12 vector matches
//!   - Doctrine: top 8 vector matches (no recency — docs aren't conversational)
//!   - Wider vec0 search (top 30) is split by kind; cheap because the
//!     search is the costly step.
//!
//! When the vec table is empty (cold start), falls through to the
//! Phase-1 behavior of last-N raw episodes so the prompt is never empty.

use std::collections::HashSet;
#[cfg(feature = "ml")]
use std::sync::Arc;

use crate::companion::brain::embeddings;
use crate::companion::brain::episodic::{self, Episode};
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

const RECENCY_TURNS: u32 = 5;
const VECTOR_EPISODE_TOPK: usize = 12;
const VECTOR_DOCTRINE_TOPK: usize = 8;
/// We pull this many vec0 hits in one go and split by kind in app code.
/// vec0 doesn't natively support kind-filtered MATCH, and the search
/// itself is the expensive part. Generous so kind-imbalanced corpora
/// don't starve one tier.
const VECTOR_OVERFETCH: usize = 60;
const FALLBACK_LIMIT: u32 = 20;

/// What the prompt builder gets back per turn.
#[derive(Debug, Default)]
pub struct Recall {
    pub episodes: Vec<Episode>,
    pub doctrine: Vec<DoctrineHit>,
}

#[derive(Debug, Clone)]
pub struct DoctrineHit {
    /// `<rel_path>#<heading_anchor>`, e.g.
    /// `concepts/persona-capabilities/00-vision.md#the-mental-model-we-want`.
    pub file_path: String,
    /// Markdown body of the chunk (full content from disk-backed source).
    pub content: String,
}

#[cfg(feature = "ml")]
pub async fn retrieve(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    session_id: &str,
    query: &str,
) -> Result<Recall, AppError> {
    let recent = episodic::list_recent(pool, session_id, RECENCY_TURNS).unwrap_or_default();
    let recent_ids: HashSet<String> = recent.iter().map(|e| e.id.clone()).collect();

    let hits = embeddings::search_similar(pool, embedder, query, VECTOR_OVERFETCH)
        .await
        .unwrap_or_default();

    if recent.is_empty() && hits.is_empty() {
        // Cold start — full fallback.
        return Ok(Recall {
            episodes: episodic::list_recent(pool, session_id, FALLBACK_LIMIT).unwrap_or_default(),
            doctrine: Vec::new(),
        });
    }

    // Look up node kinds in one SQL round-trip, preserve search ordering.
    let kinds = lookup_kinds(pool, &hits.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>())?;

    let mut episode_ids: Vec<String> = Vec::new();
    let mut doctrine_ids: Vec<String> = Vec::new();
    for (id, _dist) in &hits {
        match kinds.get(id).map(String::as_str) {
            Some("episode") => {
                if !recent_ids.contains(id) && episode_ids.len() < VECTOR_EPISODE_TOPK {
                    episode_ids.push(id.clone());
                }
            }
            Some("doctrine") => {
                if doctrine_ids.len() < VECTOR_DOCTRINE_TOPK {
                    doctrine_ids.push(id.clone());
                }
            }
            _ => {} // Other kinds (semantic facts, playbooks) — ignore for now.
        }
    }

    // Episodes: load from disk (markdown), then merge with recent oldest-first.
    let mut extra_episodes = load_episodes_by_ids(pool, &episode_ids).unwrap_or_default();
    extra_episodes.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let mut episodes = extra_episodes;
    episodes.extend(recent);

    // Doctrine: load chunk content from disk (the file_path includes
    // #anchor — the disk file is the whole .md, but we want only the
    // chunk that matched. We re-extract the section from the file by its
    // heading slug.)
    let doctrine = load_doctrine_chunks(pool, &doctrine_ids).unwrap_or_default();

    Ok(Recall { episodes, doctrine })
}

#[cfg(not(feature = "ml"))]
pub async fn retrieve(
    pool: &UserDbPool,
    session_id: &str,
    _query: &str,
) -> Result<Recall, AppError> {
    Ok(Recall {
        episodes: episodic::list_recent(pool, session_id, FALLBACK_LIMIT).unwrap_or_default(),
        doctrine: Vec::new(),
    })
}

fn lookup_kinds(
    pool: &UserDbPool,
    ids: &[String],
) -> Result<std::collections::HashMap<String, String>, AppError> {
    if ids.is_empty() {
        return Ok(Default::default());
    }
    let conn = pool.get()?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, kind FROM companion_node WHERE id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> =
        ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().collect())
}

/// Read full episodes by id list. Drops any whose disk file is missing.
fn load_episodes_by_ids(pool: &UserDbPool, ids: &[String]) -> Result<Vec<Episode>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, file_path, created_at
         FROM companion_node
         WHERE kind = 'episode' AND id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> =
        ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let root = crate::companion::disk::brain_root()?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, rel_path, created_at) in rows {
        let full = match std::fs::read_to_string(root.join(&rel_path)) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (role, content) = parse_role_and_body(&full);
        out.push(Episode {
            id,
            session_id: String::new(),
            role,
            content,
            file_path: rel_path,
            created_at,
        });
    }
    Ok(out)
}

/// Load doctrine chunks by id. The `file_path` column is `<rel>#<anchor>`;
/// we read the whole .md from the docs root and re-extract the matching
/// H2 section. Falls back to the body_excerpt column if the file is gone
/// (e.g., stale index after a docs rename).
fn load_doctrine_chunks(pool: &UserDbPool, ids: &[String]) -> Result<Vec<DoctrineHit>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, file_path, body_excerpt FROM companion_node
         WHERE kind = 'doctrine' AND id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> =
        ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2).unwrap_or_default(),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Source from disk first (dev), embedded fallback otherwise (prod).
    // We always have a path here because read_curated_doc handles both.
    let docs_root = crate::companion::brain::doctrine::find_docs_root();
    let mut out = Vec::with_capacity(rows.len());
    for (_id, file_path, excerpt) in rows {
        let (rel_path, anchor) = split_path_anchor(&file_path);
        let content = crate::companion::brain::doctrine::read_curated_doc(
            rel_path,
            docs_root.as_deref(),
        )
        .and_then(|md| extract_section(&md, anchor))
        .unwrap_or_else(|| excerpt.clone());
        out.push(DoctrineHit {
            file_path,
            content,
        });
    }
    Ok(out)
}

fn split_path_anchor(file_path: &str) -> (&str, &str) {
    match file_path.split_once('#') {
        Some((p, a)) => (p, a),
        None => (file_path, "intro"),
    }
}

/// Re-extract the chunk for a given heading anchor from the full markdown.
/// Returns the section from its `## ` line through the start of the next
/// `## `. For `intro`, returns everything before the first `## `.
fn extract_section(md: &str, anchor: &str) -> Option<String> {
    // current_heading is updated as a side effect during scanning but the
    // function returns the buffered body; the heading itself is not surfaced
    // to callers today.
    #[allow(unused_assignments)]
    let mut current_heading = String::new();
    let mut current_anchor = "intro".to_string();
    let mut buf: Vec<&str> = Vec::new();
    let mut found: Option<String> = None;

    for line in md.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            if current_anchor == anchor {
                found = Some(buf.join("\n"));
                return found;
            }
            current_heading = rest.trim().to_string();
            current_anchor = slugify(&current_heading);
            buf.clear();
            buf.push(line);
        } else {
            buf.push(line);
        }
    }
    if current_anchor == anchor {
        return Some(buf.join("\n"));
    }
    found
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
        "section".into()
    } else {
        out
    }
}

fn parse_role_and_body(full: &str) -> (String, String) {
    let mut role = "unknown".to_string();
    let mut body = full.to_string();
    if let Some(after) = full.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            for line in after[..end].lines() {
                let line = line.trim();
                if let Some(rest) = line.strip_prefix("role:") {
                    role = rest.trim().to_string();
                }
            }
            body = after[end + 4..].trim_start().to_string();
        }
    }
    (role, body)
}
