//! Athena conversations (threads) — the multi-conversation data layer.
//!
//! See `docs/features/companion/athena-multiconversation.md`. Each conversation
//! is one user-facing dialogue thread with its own transcript, its own Claude
//! CLI `--resume` continuity (the `claude_session_id` column), and its own
//! episode-recency lane (`companion_node.session_id`). Everything ABOVE the
//! thread — the brain (facts/goals/procedurals/doctrine/identity), the Task
//! pool, the proactive economy — stays global, which is what keeps Athena a
//! single mind across all threads.
//!
//! This module owns only the conversation *registry* (the `companion_session`
//! table, generalized from its old single `'default'` row). The per-turn
//! `claude_session_id` read/write helpers live in `session.rs` and are already
//! keyed by conversation id.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::UserDbPool;
use crate::error::AppError;

/// The migrated / always-present default conversation. Matches
/// `session::DEFAULT_SESSION_ID` so pre-multiconv episodes (backfilled to
/// `session_id='default'`) belong to it.
pub const DEFAULT_CONVERSATION_ID: &str = "default";

/// The single system-owned thread where ownerless proactive nudges land
/// (daily brief, incident/blocker nudges, cadence/on-this-day). Pinned,
/// archivable-but-not-deletable. Decided in the design doc §4.3.
pub const NOTICES_CONVERSATION_ID: &str = "athena-notices";

/// One conversation row as the UI consumes it. `unread_count` /
/// `message_count` are computed per-list from the episode lane.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRow {
    pub id: String,
    /// Auto-titled from the first message; NULL until titled.
    pub title: Option<String>,
    /// `active` | `archived`.
    pub status: String,
    /// `user` | `forwarded` | `proactive`.
    pub origin: String,
    pub pinned: bool,
    pub last_active_at: String,
    pub created_at: String,
    pub last_read_at: Option<String>,
    /// Episodes newer than `last_read_at` (all-NULL read state = all unread).
    pub unread_count: i64,
    /// Total episodes in this conversation.
    pub message_count: i64,
}

const SELECT_COLS: &str = "\
    s.id, s.title, s.status, s.origin, s.pinned, s.last_active_at, s.created_at, s.last_read_at, \
    (SELECT COUNT(*) FROM companion_node n \
       WHERE n.kind='episode' AND n.session_id = s.id) AS message_count, \
    (SELECT COUNT(*) FROM companion_node n \
       WHERE n.kind='episode' AND n.session_id = s.id \
         AND (s.last_read_at IS NULL OR n.created_at > s.last_read_at)) AS unread_count";

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationRow> {
    Ok(ConversationRow {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        origin: row.get(3)?,
        pinned: row.get::<_, i64>(4)? != 0,
        last_active_at: row.get(5)?,
        created_at: row.get(6)?,
        last_read_at: row.get(7)?,
        message_count: row.get(8)?,
        unread_count: row.get(9)?,
    })
}

/// Ensure the always-present system conversations exist. Idempotent — creates
/// the `default` ("General") + `athena-notices` ("Athena") rows if missing, and
/// backfills the default's title onto a pre-multiconv row that only had the
/// `claude_session_id` pointer. Safe to call on every list / init.
pub fn ensure_system_conversations(pool: &UserDbPool) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_session (id, title, status, origin, pinned, created_at, last_active_at) \
         VALUES (?1, 'General', 'active', 'user', 0, datetime('now'), datetime('now')) \
         ON CONFLICT(id) DO UPDATE SET title = COALESCE(companion_session.title, 'General')",
        params![DEFAULT_CONVERSATION_ID],
    )?;
    conn.execute(
        "INSERT INTO companion_session (id, title, status, origin, pinned, created_at, last_active_at) \
         VALUES (?1, 'Athena', 'active', 'proactive', 1, datetime('now'), datetime('now')) \
         ON CONFLICT(id) DO UPDATE SET title = COALESCE(companion_session.title, 'Athena')",
        params![NOTICES_CONVERSATION_ID],
    )?;
    Ok(())
}

/// List conversations, most-relevant first (pinned, then most-recently-active).
/// `include_archived=false` hides archived threads.
pub fn list(pool: &UserDbPool, include_archived: bool) -> Result<Vec<ConversationRow>, AppError> {
    ensure_system_conversations(pool)?;
    let conn = pool.get()?;
    let sql = format!(
        "SELECT {SELECT_COLS} FROM companion_session s \
         WHERE (?1 = 1 OR s.status = 'active') \
         ORDER BY s.pinned DESC, s.last_active_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![include_archived as i64], map_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Fetch one conversation by id.
pub fn get(pool: &UserDbPool, id: &str) -> Result<Option<ConversationRow>, AppError> {
    let conn = pool.get()?;
    let sql = format!("SELECT {SELECT_COLS} FROM companion_session s WHERE s.id = ?1");
    let row = conn
        .query_row(&sql, params![id], map_row)
        .optional()?;
    Ok(row)
}

/// Create a fresh conversation and return its row. `origin` is one of
/// `user` | `forwarded` | `proactive`.
pub fn create(
    pool: &UserDbPool,
    title: Option<&str>,
    origin: &str,
) -> Result<ConversationRow, AppError> {
    let id = format!("conv_{}", uuid::Uuid::new_v4().simple());
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_session (id, title, status, origin, pinned, created_at, last_active_at) \
         VALUES (?1, ?2, 'active', ?3, 0, datetime('now'), datetime('now'))",
        params![id, title, origin],
    )?;
    drop(conn);
    get(pool, &id)?.ok_or_else(|| AppError::Internal("conversation vanished after insert".into()))
}

/// Rename a conversation (also used by Athena's auto-titling).
pub fn rename(pool: &UserDbPool, id: &str, title: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_session SET title = ?2 WHERE id = ?1",
        params![id, title],
    )?;
    Ok(())
}

/// Archive a conversation (soft — the transcript stays on disk). The system
/// `default` / `athena-notices` threads refuse to archive.
pub fn archive(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    if id == DEFAULT_CONVERSATION_ID || id == NOTICES_CONVERSATION_ID {
        return Err(AppError::Validation(
            "the default and Athena threads can't be archived".into(),
        ));
    }
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_session SET status = 'archived' WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Mark a conversation read (clears its unread badge) as of now.
pub fn mark_read(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_session SET last_read_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// A compact digest of the user's OTHER open conversations, injected into every
/// turn's system prompt so a single Athena is aware of all her threads — the
/// "singular Athena" control plane (design §2). Excludes the current thread and
/// archived threads; returns "" when there are none so nothing is injected.
///
/// Read-only + best-effort: a query error yields an empty digest rather than
/// failing the turn. Reuses the same shape as the fleet operative-memory
/// digest that already rides in the prompt.
pub fn roster_digest_for_prompt(pool: &UserDbPool, current_id: &str) -> String {
    let rows = match list_active(pool) {
        Ok(r) => r,
        Err(_) => return String::new(),
    };
    let others: Vec<&ConversationRow> = rows.iter().filter(|c| c.id != current_id).collect();
    if others.is_empty() {
        return String::new();
    }
    let mut out = String::from(
        "\n## Your other open conversations\n\
         You are one Athena across all of these — same memory, same identity. The user is in a \
         different thread right now; reference these only when relevant (e.g. \"I've got that \
         running in your other conversation\").\n",
    );
    for c in others.iter().take(6) {
        let title = c.title.as_deref().unwrap_or("(untitled)");
        let state = if c.unread_count > 0 {
            "awaiting the user"
        } else {
            "idle"
        };
        out.push_str(&format!(
            "- \"{title}\" — {state}, last active {}\n",
            c.last_active_at
        ));
    }
    out
}

/// Read-only list of active conversations (no `ensure_system_conversations`
/// write side-effect) — for the per-turn roster digest, which must not write on
/// every prompt build.
fn list_active(pool: &UserDbPool) -> Result<Vec<ConversationRow>, AppError> {
    let conn = pool.get()?;
    let sql = format!(
        "SELECT {SELECT_COLS} FROM companion_session s \
         WHERE s.status = 'active' \
         ORDER BY s.pinned DESC, s.last_active_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], map_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}
