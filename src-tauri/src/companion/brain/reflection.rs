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
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use rusqlite::params;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

use crate::companion::brain::episodic;
use crate::companion::disk;
use crate::companion::session::{base_cli_invocation, DEFAULT_SESSION_ID};
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

async fn call_claude_oneshot(prompt: &str) -> Result<String, AppError> {
    let cwd = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let (cmd_program, mut argv) = base_cli_invocation();
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        "claude-opus-4-8".into(),
    ]);
    let mut cmd = Command::new(&cmd_program);
    cmd.args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    // Subscription-only — never the API account.
    crate::engine::cli_process::force_subscription_auth(&mut cmd);
    // No console window on Windows (desktop-heap / 0xC0000142 guard).
    crate::companion::session::apply_no_console_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude (reflection): {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("write stdin: {e}")))?;
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("claude stdout missing".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("claude stderr missing".into()))?;

    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stderr_handle = {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut g = buf.lock().await;
                if !g.is_empty() {
                    g.push('\n');
                }
                g.push_str(&line);
            }
        })
    };

    let mut text = String::new();
    let mut reader = BufReader::new(stdout).lines();
    let collect = async {
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|e| AppError::Internal(format!("read stdout: {e}")))?
        {
            if let Some(delta) = extract_assistant_text(&line) {
                text.push_str(&delta);
            }
        }
        Ok::<(), AppError>(())
    };

    timeout(REFLECTION_TIMEOUT, collect).await.map_err(|_| {
        AppError::Internal(format!(
            "reflection timed out after {:?}",
            REFLECTION_TIMEOUT
        ))
    })??;

    let _ = stderr_handle.await;
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("await claude: {e}")))?;
    if !status.success() {
        let err = stderr_buf.lock().await.clone();
        return Err(AppError::Internal(format!(
            "claude reflection exited {}: {}",
            status.code().map(|c| c.to_string()).unwrap_or("?".into()),
            err
        )));
    }
    if text.trim().is_empty() {
        return Err(AppError::Internal("reflection output was empty".into()));
    }
    Ok(text)
}

fn extract_assistant_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let blocks = v.get("message")?.get("content")?.as_array()?;
    let mut out = String::new();
    for b in blocks {
        if b.get("type").and_then(|x| x.as_str()) == Some("text") {
            if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
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
