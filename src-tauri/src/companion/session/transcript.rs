//! The persistent `claude_session_id` pointer and the transcript behind it —
//! reading it, writing it, clearing it, and wiping the whole thing.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use rusqlite::{params, OptionalExtension};

use crate::db::UserDbPool;
use crate::error::AppError;

/// Clear the persisted claude_session_id so the next turn starts a fresh
/// CLI session. The episodic transcript is untouched — every prior turn is
/// still on disk and re-enters the prompt via retrieval.
pub fn clear_claude_session_id(pool: &UserDbPool, session_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_session SET claude_session_id = NULL, last_active_at = datetime('now') WHERE id = ?1",
        params![session_id],
    )?;
    Ok(())
}

/// Wipe the conversation transcript so Athena starts fresh.
///
/// `conversation_id`: `Some(id)` wipes ONE thread's episodes (multiconv P1 —
/// resetting the "auth bug" thread must not erase "Q3 planning"); `None`
/// wipes every conversation (the pre-multiconv full reset).
///
/// Scope (deliberate):
///   - SQL: deletes episode rows from `companion_node`, plus their
///     companion_embedding entries. **Doctrine, identity, and any other node
///     kinds are preserved** — earlier versions of this function blindly
///     truncated all vec0 rows, which silently wiped doctrine and forced a
///     full re-ingest on the next start.
///   - Disk: renames `<brain>/episodes/` to `<brain>/episodes-archive-<ts>/`
///     so the markdown source-of-truth isn't actually destroyed (no-data-
///     loss principle), but the next turn sees an empty episodes dir.
///     A fresh empty `episodes/` is recreated. **Global-wipe only** — the
///     markdown dir isn't partitioned by conversation, so a scoped wipe
///     leaves disk untouched (SQL is what the UI binds to).
///   - Identity, constitution, doctrine, semantic facts: untouched.
pub fn wipe_transcript(pool: &UserDbPool, conversation_id: Option<&str>) -> Result<(), AppError> {
    let conn = pool.get()?;

    // Collect episode IDs first; we need them for the FTS + vec0 deletes
    // before we drop the parent node rows.
    let episode_ids: Vec<String> = {
        let (sql, args): (&str, Vec<&dyn rusqlite::ToSql>) = match conversation_id.as_ref() {
            Some(cid) => (
                "SELECT id FROM companion_node WHERE kind = 'episode' AND session_id = ?1",
                vec![cid as &dyn rusqlite::ToSql],
            ),
            None => (
                "SELECT id FROM companion_node WHERE kind = 'episode'",
                vec![],
            ),
        };
        match conn.prepare(sql) {
            Ok(mut stmt) => stmt
                .query_map(args.as_slice(), |row| row.get::<_, String>(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    };

    if !episode_ids.is_empty() {
        let placeholders = episode_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let p: Vec<&dyn rusqlite::ToSql> = episode_ids
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();

        // vec0 table is created lazily; this is best-effort.
        let _ = conn.execute(
            &format!("DELETE FROM companion_embedding WHERE node_id IN ({placeholders})"),
            p.as_slice(),
        );
        let _ = conn.execute(
            &format!("DELETE FROM companion_node WHERE id IN ({placeholders})"),
            p.as_slice(),
        );
    }

    // Archive the on-disk episodes folder — global wipe only (the markdown
    // dir isn't partitioned by conversation). Failure here is non-fatal —
    // SQL has already been wiped, which is what the UI binds to.
    if conversation_id.is_some() {
        return Ok(());
    }
    if let Ok(root) = crate::companion::disk::brain_root() {
        let episodes = root.join("episodes");
        if episodes.exists() {
            let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S");
            let archived = root.join(format!("episodes-archive-{stamp}"));
            if std::fs::rename(&episodes, &archived).is_ok() {
                let _ = std::fs::create_dir_all(&episodes);
                tracing::info!(archive = %archived.display(), "companion: wiped episodes — old set archived");
            }
        }
    }

    Ok(())
}

pub(super) fn read_claude_session_id(
    pool: &UserDbPool,
    session_id: &str,
) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let val = conn
        .query_row(
            "SELECT claude_session_id FROM companion_session WHERE id = ?1",
            params![session_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    Ok(val.flatten())
}

pub(super) fn upsert_claude_session_id(
    pool: &UserDbPool,
    session_id: &str,
    claude_session_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_session (id, claude_session_id, last_active_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           claude_session_id = excluded.claude_session_id,
           last_active_at    = datetime('now')",
        params![session_id, claude_session_id],
    )?;
    Ok(())
}
