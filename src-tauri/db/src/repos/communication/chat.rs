use rusqlite::{params, Row};

use crate::models::{
    ChatMessage, ChatSession, ChatSessionContext, CreateChatMessageInput, UpsertSessionContextInput,
};
use crate::repos::utils::collect_rows;
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::validation::chat as cv;
use personas_core::validation::contract::check as validate_check;

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
        // Use chat_session_context (indexed) + lightweight count subquery
        // instead of GROUP BY across all chat_messages.
        let mut stmt = conn.prepare(
            "SELECT
                csc.session_id,
                csc.persona_id,
                COALESCE((SELECT COUNT(*) FROM chat_messages cm
                          WHERE cm.session_id = csc.session_id
                            AND cm.persona_id = csc.persona_id), 0) as message_count,
                csc.updated_at as last_message_at,
                csc.created_at
             FROM chat_session_context csc
             WHERE csc.persona_id = ?1
             ORDER BY csc.updated_at DESC
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
        // Validate role (defence-in-depth — ChatRole enum handles serde, this
        // covers any future loosening of the input type).
        let mut errors = cv::validate_role(&input.role.to_string());

        // Validate content: non-empty and within length limit
        errors.extend(cv::validate_content(&input.content));

        // Validate metadata length if present
        if let Some(ref meta) = input.metadata {
            errors.extend(cv::validate_metadata(meta));
        }

        validate_check(errors)?;

        // Strip HTML tags from content for defence-in-depth against XSS
        let content = personas_core::validation::strip_html_tags(&input.content);

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
        // The delete half of the cloud chat projection (PHASE2-SPEC 5.2): one
        // delete, one tombstone, atomically. The newest delete wins, like
        // `persona_tombstones`, so the cursor-driven sync pass sees it.
        tx.execute(
            "INSERT INTO chat_session_tombstones (session_id, persona_id, deleted_at) \
             VALUES (?1, ?2, ?3) \
             ON CONFLICT(session_id) DO UPDATE SET \
               persona_id = excluded.persona_id, deleted_at = excluded.deleted_at",
            params![
                session_id,
                persona_id,
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            ],
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
        let mut stmt = conn.prepare("SELECT * FROM chat_session_context WHERE session_id = ?1")?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::models::{ChatRole, CreatePersonaInput};
    use crate::repos::core::personas;

    fn persona(pool: &DbPool) -> String {
        personas::create(
            pool,
            CreatePersonaInput {
                name: "Chat Test Agent".into(),
                system_prompt: "You are a test agent.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    fn tombstones(pool: &DbPool) -> Result<Vec<(String, String, String)>, AppError> {
        let conn = pool.get()?;
        let mut stmt = conn
            .prepare("SELECT session_id, persona_id, deleted_at FROM chat_session_tombstones ORDER BY session_id")
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get("session_id")?,
                    r.get("persona_id")?,
                    r.get("deleted_at")?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// PHASE2-SPEC 5.2: deleting a session leaves a tombstone in the same
    /// transaction, so the cloud mirror can delete it too; a second delete of
    /// the same id moves the watermark forward instead of failing.
    #[test]
    fn deleting_a_session_writes_its_tombstone() {
        let pool = init_test_db().unwrap();
        let p = persona(&pool);
        create(
            &pool,
            CreateChatMessageInput {
                persona_id: p.clone(),
                session_id: "chat-1-abcd1234".into(),
                role: ChatRole::User,
                content: "hello".into(),
                execution_id: None,
                metadata: None,
            },
        )
        .unwrap();
        assert!(tombstones(&pool).unwrap().is_empty());
        assert_eq!(delete_session(&pool, &p, "chat-1-abcd1234").unwrap(), 1);
        let first = tombstones(&pool).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(
            (first[0].0.as_str(), first[0].1.as_str()),
            ("chat-1-abcd1234", p.as_str())
        );
        assert!(chrono::DateTime::parse_from_rfc3339(&first[0].2).is_ok());
        assert_eq!(delete_session(&pool, &p, "chat-1-abcd1234").unwrap(), 0);
        assert_eq!(tombstones(&pool).unwrap().len(), 1, "one row per session");
    }
}
