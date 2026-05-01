//! Episodic memory: append-only log of conversation turns and observed
//! agent events. Source of truth lives at
//! `~/.personas/companion-brain/episodes/<YYYY>/<MM>/<DD>/<id>.md`.
//!
//! Episodes are NEVER deleted. They are the no-data-loss guarantee — every
//! distilled semantic fact links back to source episode IDs, so any
//! consolidation can be rebuilt from the source log if it drifts.

use std::fs;
#[cfg(feature = "ml")]
use std::sync::Arc;

use chrono::Utc;
use rusqlite::params;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::companion::brain::embeddings;
use crate::companion::disk;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Roles used in conversation episodes. Observation episodes (agent events
/// auto-captured by the companion) use a separate kind handled later.
#[derive(Debug, Clone, Copy)]
pub enum EpisodeRole {
    User,
    Assistant,
    System,
}

impl EpisodeRole {
    fn as_str(self) -> &'static str {
        match self {
            EpisodeRole::User => "user",
            EpisodeRole::Assistant => "assistant",
            EpisodeRole::System => "system",
        }
    }
}

/// One persisted conversation turn.
#[derive(Debug, Clone)]
pub struct Episode {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub file_path: String,
    pub created_at: String,
}

/// Append a conversation turn. Writes the markdown file to disk first
/// (source of truth), then inserts the SQL index row. Returns the new
/// episode's id.
pub fn append_episode(
    pool: &UserDbPool,
    session_id: &str,
    role: EpisodeRole,
    content: &str,
) -> Result<String, AppError> {
    let id = format!("ep_{}", short_uuid());
    let now = Utc::now();
    let now_str = now.to_rfc3339();
    let role_str = role.as_str();

    let rel_path = format!(
        "episodes/{}/{}/{}/{}_{}.md",
        now.format("%Y"),
        now.format("%m"),
        now.format("%d"),
        id,
        role_str
    );
    let abs_path = disk::brain_root()?.join(&rel_path);

    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = format_episode_markdown(&id, session_id, role_str, &now_str, content);
    fs::write(&abs_path, &body)?;

    let hash = sha256_hex(&body);
    let excerpt = excerpt_500(content);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'episode', ?2, ?3, 3, ?4, ?5, ?5)",
        params![id, rel_path, hash, excerpt, now_str],
    )?;

    // Mirror into FTS for keyword fallback retrieval (Phase 2 retrieval will
    // also use this; harmless to populate eagerly now).
    conn.execute(
        "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, ?3)",
        params![id, content, format!("session:{session_id} role:{role_str}")],
    )?;

    Ok(id)
}

/// Same as `append_episode`, but also embeds the content into the
/// `companion_embedding` vec0 table. Embedding failure is logged but does
/// NOT fail the episode write — the episode is persisted to disk + SQL
/// index regardless. (We can always reindex later from disk.)
#[cfg(feature = "ml")]
pub async fn append_episode_and_embed(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    session_id: &str,
    role: EpisodeRole,
    content: &str,
) -> Result<String, AppError> {
    let id = append_episode(pool, session_id, role, content)?;
    if let Err(e) = embeddings::embed_and_store(pool, embedder, &id, content).await {
        tracing::warn!(node_id = %id, error = %e, "companion embed_and_store failed (continuing)");
    }
    Ok(id)
}

#[cfg(not(feature = "ml"))]
pub async fn append_episode_and_embed(
    pool: &UserDbPool,
    session_id: &str,
    role: EpisodeRole,
    content: &str,
) -> Result<String, AppError> {
    append_episode(pool, session_id, role, content)
}

/// Read the most recent episodes for a session, oldest-first (so they can
/// be appended in order to the working-context bundle).
pub fn list_recent(
    pool: &UserDbPool,
    session_id: &str,
    limit: u32,
) -> Result<Vec<Episode>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, file_path, body_excerpt, created_at
         FROM companion_node
         WHERE kind = 'episode'
           AND body_excerpt IS NOT NULL
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;

    let rows = stmt
        .query_map([limit], |row| {
            let id: String = row.get(0)?;
            let file_path: String = row.get(1)?;
            let excerpt: String = row.get(2)?;
            let created_at: String = row.get(3)?;
            Ok((id, file_path, excerpt, created_at))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Read full content from disk for each (excerpt is only the first 500 chars).
    let root = disk::brain_root()?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, rel_path, _excerpt, created_at) in rows {
        let full = match fs::read_to_string(root.join(&rel_path)) {
            Ok(s) => s,
            Err(_) => continue, // file missing on disk — skip, don't fail the whole list
        };
        let (role, content) = parse_episode_body(&full);
        // Filter to the requested session by reading the frontmatter. Simple
        // for now; if it gets hot, add a session_id column to companion_node.
        let session_match = full.contains(&format!("session: \"{session_id}\""));
        if !session_match {
            continue;
        }
        out.push(Episode {
            id,
            session_id: session_id.to_string(),
            role,
            content,
            file_path: rel_path,
            created_at,
        });
    }

    // Reverse so callers get oldest-first.
    out.reverse();
    Ok(out)
}

// ── helpers ─────────────────────────────────────────────────────────────

fn format_episode_markdown(
    id: &str,
    session_id: &str,
    role: &str,
    created: &str,
    content: &str,
) -> String {
    format!(
        "---\nid: \"{id}\"\ntype: episode\nrole: {role}\nsession: \"{session_id}\"\ncreated: \"{created}\"\n---\n\n{content}\n"
    )
}

fn parse_episode_body(full: &str) -> (String, String) {
    // Extract role from frontmatter, body after second `---`.
    let mut role = "unknown".to_string();
    let mut body = full.to_string();
    if let Some(after) = full.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            let yaml = &after[..end];
            for line in yaml.lines() {
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

fn sha256_hex(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    format!("sha256:{}", hex::encode(digest))
}

fn excerpt_500(content: &str) -> String {
    if content.len() <= 500 {
        content.to_string()
    } else {
        // char-boundary safe truncation
        let mut end = 500;
        while !content.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        content[..end].to_string()
    }
}

fn short_uuid() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect()
}
