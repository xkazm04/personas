use rusqlite::{params, Row};

use crate::db::models::{
    ChatMessage, ChatSession, ChatSessionContext, CreateChatMessageInput,
    UpsertSessionContextInput,
};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;
use crate::validation::chat as cv;
use crate::validation::contract::check as validate_check;

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
    timed_query!("chat_messages", "chat_messages::get_session_messages", {
        let limit = limit.unwrap_or(200);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM (
                 SELECT * FROM chat_messages
                 WHERE persona_id = ?1 AND session_id = ?2
                 ORDER BY created_at DESC
                 LIMIT ?3
             ) ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![persona_id, session_id, limit], row_to_chat_message)?;
        Ok(collect_rows(rows, "chat::get_session_messages"))
    })
}

pub fn list_sessions(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<ChatSession>, AppError> {
    timed_query!("chat_sessions", "chat_sessions::list_sessions", {
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
    })
}

pub fn create(pool: &DbPool, input: CreateChatMessageInput) -> Result<ChatMessage, AppError> {
    timed_query!("chat_messages", "chat_messages::create", {
        // Validate content: non-empty and within length limit
        let mut errors = cv::validate_content(&input.content);

        // Validate metadata length if present
        if let Some(ref meta) = input.metadata {
            errors.extend(cv::validate_metadata(meta));
        }

        validate_check(errors)?;

        // Strip HTML tags from content for defence-in-depth against XSS
        let content = crate::validation::strip_html_tags(&input.content);

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
                content,
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
            .map_err(AppError::Database)?;
        Ok(msg)
    })
}

pub fn delete_session(pool: &DbPool, persona_id: &str, session_id: &str) -> Result<i64, AppError> {
    timed_query!("chat_sessions", "chat_sessions::delete_session", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        // Also remove session context when deleting a session
        tx.execute(
            "DELETE FROM chat_session_context WHERE session_id = ?1 AND persona_id = ?2",
            params![session_id, persona_id],
        )?;
        let rows = tx.execute(
            "DELETE FROM chat_messages WHERE persona_id = ?1 AND session_id = ?2",
            params![persona_id, session_id],
        )?;
        tx.commit()?;
        Ok(rows as i64)
    })
}

// -- Session Context persistence ------------------------------------------------

fn row_to_session_context(row: &Row) -> rusqlite::Result<ChatSessionContext> {
    Ok(ChatSessionContext {
        session_id: row.get("session_id")?,
        persona_id: row.get("persona_id")?,
        title: row.get("title")?,
        summary: row.get("summary")?,
        system_prompt_hash: row.get("system_prompt_hash")?,
        working_memory: row.get("working_memory")?,
        chat_mode: row.get("chat_mode")?,
        claude_session_id: row.get("claude_session_id")?,
        updated_at: row.get("updated_at")?,
        created_at: row.get("created_at")?,
    })
}

pub fn get_session_context(
    pool: &DbPool,
    session_id: &str,
) -> Result<Option<ChatSessionContext>, AppError> {
    timed_query!("chat_sessions", "chat_sessions::get_session_context", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM chat_session_context WHERE session_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![session_id], row_to_session_context)?;
        match rows.next() {
            Some(Ok(ctx)) => Ok(Some(ctx)),
            Some(Err(e)) => Err(AppError::Database(e)),
            None => Ok(None),
        }
    })
}

pub fn upsert_session_context(
    pool: &DbPool,
    input: UpsertSessionContextInput,
) -> Result<ChatSessionContext, AppError> {
    timed_query!("chat_sessions", "chat_sessions::upsert_session_context", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        conn.execute(
            "INSERT INTO chat_session_context
             (session_id, persona_id, title, summary, system_prompt_hash, working_memory, chat_mode, claude_session_id, updated_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?9, ?8, ?8)
             ON CONFLICT(session_id) DO UPDATE SET
               title = COALESCE(?3, title),
               summary = COALESCE(?4, summary),
               system_prompt_hash = COALESCE(?5, system_prompt_hash),
               working_memory = COALESCE(?6, working_memory),
               chat_mode = COALESCE(?7, chat_mode),
               claude_session_id = COALESCE(?9, claude_session_id),
               updated_at = ?8",
            params![
                input.session_id,
                input.persona_id,
                input.title,
                input.summary,
                input.system_prompt_hash,
                input.working_memory,
                input.chat_mode.unwrap_or_else(|| "ops".to_string()),
                now,
                input.claude_session_id,
            ],
        )?;

        let ctx = conn
            .query_row(
                "SELECT * FROM chat_session_context WHERE session_id = ?1",
                params![input.session_id],
                row_to_session_context,
            )
            .map_err(AppError::Database)?;
        Ok(ctx)
    })
}

pub fn get_latest_session(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<ChatSessionContext>, AppError> {
    timed_query!("chat_sessions", "chat_sessions::get_latest_session", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM chat_session_context
             WHERE persona_id = ?1
             ORDER BY updated_at DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![persona_id], row_to_session_context)?;
        match rows.next() {
            Some(Ok(ctx)) => Ok(Some(ctx)),
            Some(Err(e)) => Err(AppError::Database(e)),
            None => Ok(None),
        }
    })
}
