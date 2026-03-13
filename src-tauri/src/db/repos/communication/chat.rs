use rusqlite::{params, Row};

use crate::db::models::{ChatMessage, ChatSession, CreateChatMessageInput};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_chat_message(row: &Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        session_id: row.get("session_id")?,
        role: row.get("role")?,
        content: row.get("content")?,
        execution_id: row.get("execution_id")?,
        metadata: row.get("metadata")?,
        created_at: row.get("created_at")?,
    })
}

pub fn get_session_messages(
    pool: &DbPool,
    persona_id: &str,
    session_id: &str,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, AppError> {
    let limit = limit.unwrap_or(200);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM chat_messages
         WHERE persona_id = ?1 AND session_id = ?2
         ORDER BY created_at ASC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![persona_id, session_id, limit], row_to_chat_message)?;
    Ok(collect_rows(rows, "chat::get_session_messages"))
}

pub fn list_sessions(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<ChatSession>, AppError> {
    let limit = limit.unwrap_or(50);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT
            session_id,
            persona_id,
            COUNT(*) as message_count,
            MAX(created_at) as last_message_at,
            MIN(created_at) as created_at
         FROM chat_messages
         WHERE persona_id = ?1
         GROUP BY session_id
         ORDER BY last_message_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], |row| {
        Ok(ChatSession {
            session_id: row.get("session_id")?,
            persona_id: row.get("persona_id")?,
            message_count: row.get("message_count")?,
            last_message_at: row.get("last_message_at")?,
            created_at: row.get("created_at")?,
        })
    })?;
    Ok(collect_rows(rows, "chat::list_sessions"))
}

pub fn create(pool: &DbPool, input: CreateChatMessageInput) -> Result<ChatMessage, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO chat_messages
         (id, persona_id, session_id, role, content, execution_id, metadata, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            input.persona_id,
            input.session_id,
            input.role,
            input.content,
            input.execution_id,
            input.metadata,
            now,
        ],
    )?;

    let msg = conn
        .query_row(
            "SELECT * FROM chat_messages WHERE id = ?1",
            params![id],
            row_to_chat_message,
        )
        .map_err(|e| AppError::Database(e))?;
    Ok(msg)
}

pub fn delete_session(pool: &DbPool, persona_id: &str, session_id: &str) -> Result<i64, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM chat_messages WHERE persona_id = ?1 AND session_id = ?2",
        params![persona_id, session_id],
    )?;
    Ok(rows as i64)
}
