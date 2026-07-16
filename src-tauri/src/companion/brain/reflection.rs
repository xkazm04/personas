//! Reflection: short prose summary of conversational patterns and
//! themes across recent episodes. Sister to consolidation, but lower
//! stakes — reflections are *observations*, not facts. They don't
//! enter retrieval; they're a journal Athena (and the user) can scan
//! to see what the relationship has been about.
//!
//! Storage: markdown file per reflection at
//! `~/.personas/companion-brain/reflections/<id>.md`, plus a
//! `companion_node` row (kind='reflection') so it appears in the
//! brain viewer's listing layer alongside episodes/facts.
//!
//! No sidecar table — reflections have no typed metadata to query on.

use std::fs;
use std::time::Duration;

use chrono::Utc;
use rusqlite::params;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::companion::brain::episodic;
use crate::companion::brain::oneshot::call_claude_text;
use crate::companion::disk;
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::UserDbPool;
use crate::error::AppError;

const EPISODE_WINDOW: u32 = 60;
const REFLECTION_TIMEOUT: Duration = Duration::from_secs(180);

/// Generate a reflection from recent episodes. Writes the markdown to
/// disk and inserts a `companion_node` row. Returns the new node id.
///
/// `instructions` is optional natural-language steering (≤4096 chars)
/// folded into the prompt as an "Additional guidance from operator"
/// block. Validated at the IPC boundary, not here.
pub async fn run_reflection(
    pool: &UserDbPool,
    instructions: Option<&str>,
) -> Result<String, AppError> {
    let episodes = episodic::list_recent(pool, DEFAULT_SESSION_ID, EPISODE_WINDOW)?;
    if episodes.is_empty() {
        return Err(AppError::Internal(
            "no episodes to reflect on yet — chat with Athena first".into(),
        ));
    }

    let prompt = build_reflection_prompt(&episodes, instructions);
    let reflection_text = call_claude_oneshot(&prompt).await?;

    let id = format!("ref_{}", short_uuid());
    let now = Utc::now();
    let now_str = now.to_rfc3339();
    let date_slug = now.format("%Y-%m-%d").to_string();

    let rel_path = format!("reflections/{date_slug}_{id}.md");
    let abs_path = disk::brain_root()?.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = format!(
        "---\nid: \"{id}\"\ntype: reflection\ncreated: \"{now_str}\"\nepisodes_window: {n}\n---\n\n{text}\n",
        n = episodes.len(),
        text = reflection_text.trim()
    );
    fs::write(&abs_path, &body)?;

    let hash = format!("sha256:{}", hex::encode(Sha256::digest(body.as_bytes())));
    let excerpt = excerpt_500(&reflection_text);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'reflection', ?2, ?3, 2, ?4, ?5, ?5)",
        params![id, rel_path, hash, excerpt, now_str],
    )?;
    Ok(id)
}

pub fn list_reflections(pool: &UserDbPool, limit: u32) -> Result<Vec<ReflectionRow>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, file_path, body_excerpt, created_at
         FROM companion_node
         WHERE kind = 'reflection'
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(ReflectionRow {
                id: row.get(0)?,
                file_path: row.get(1)?,
                preview: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn read_reflection(pool: &UserDbPool, id: &str) -> Result<ReflectionDetail, AppError> {
    let conn = pool.get()?;
    let (file_path, created_at): (String, String) = conn.query_row(
        "SELECT file_path, created_at FROM companion_node WHERE kind='reflection' AND id=?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let root = disk::brain_root()?;
    let full = fs::read_to_string(root.join(&file_path))
        .unwrap_or_else(|_| format!("(file unreadable: {file_path})"));
    let body = body_after_frontmatter(&full);
    Ok(ReflectionDetail {
        id: id.to_string(),
        body,
        created_at,
    })
}

#[derive(Debug)]
pub struct ReflectionRow {
    pub id: String,
    pub file_path: String,
    pub preview: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct ReflectionDetail {
    pub id: String,
    pub body: String,
    pub created_at: String,
}

// ── helpers ─────────────────────────────────────────────────────────────

fn build_reflection_prompt(episodes: &[episodic::Episode], instructions: Option<&str>) -> String {
    let mut p = String::new();
    p.push_str(
        "You are Athena, reflecting on recent conversations with Michal. \
         Write a short journal entry (4-8 paragraphs) in *first person*, \
         from your point of view, looking back at the episodes below. This \
         is not a summary of what was said. It's an observation of patterns: \
         what's been preoccupying him, what shifted, what you noticed about \
         his energy or rhythms, what felt unresolved.\n\n",
    );
    p.push_str(
        "Tone: warm, direct, observant. Sound like a thoughtful person \
         who has been paying attention, not a logbook. No bullet points, \
         no headings — flowing prose. Don't restate everything; pick \
         3-5 threads that actually mattered.\n\n",
    );
    p.push_str(
        "Don't make claims you can't substantiate from these episodes. \
         If you're inferring rather than recalling, soften the language \
         (\"seems\", \"I noticed\"). This file becomes part of his record \
         of what the relationship has been about.\n\n",
    );
    p.push_str("Output: ONLY the prose. No frontmatter, no preface. Begin directly.\n\n");

    if let Some(extra) = instructions.map(str::trim).filter(|s| !s.is_empty()) {
        p.push_str("## Additional guidance from operator\n\n");
        p.push_str(extra);
        p.push_str("\n\n");
    }

    p.push_str("# Recent episodes (oldest first):\n\n");
    for ep in episodes {
        p.push_str(&format!(
            "## {role} — {created}\n\n{content}\n\n",
            role = ep.role,
            created = ep.created_at,
            content = ep.content.trim()
        ));
    }
    p
}

/// Spawn/stream/timeout plumbing lives in
/// [`oneshot::call_claude_text`](crate::companion::brain::oneshot::call_claude_text);
/// this wrapper owns only the reflection-specific model choice and the
/// empty-output guard (reflection returns free-form prose, not JSON, so
/// there's no envelope to parse).
async fn call_claude_oneshot(prompt: &str) -> Result<String, AppError> {
    let text = call_claude_text(
        prompt,
        "claude-opus-4-8",
        "reflection",
        REFLECTION_TIMEOUT,
    )
    .await?;
    if text.trim().is_empty() {
        return Err(AppError::Internal("reflection output was empty".into()));
    }
    Ok(text)
}

fn body_after_frontmatter(md: &str) -> String {
    if let Some(after) = md.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            return after[end + 4..].trim_start().to_string();
        }
    }
    md.to_string()
}

fn excerpt_500(s: &str) -> String {
    crate::utils::text::truncate_on_char_boundary(s, 500).to_string()
}

fn short_uuid() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect()
}
