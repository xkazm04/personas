use rusqlite::params;

use crate::db::models::DesignConversation;
use crate::db::DbPool;
use crate::error::AppError;

row_mapper!(row_to_conversation -> DesignConversation {
    id, persona_id, title, status, messages, last_result, created_at, updated_at,
});

/// List all conversations for a persona, newest first.
pub fn list_by_persona(pool: &DbPool, persona_id: &str) -> Result<Vec<DesignConversation>, AppError> {
    timed_query!("design_conversations", "design_conversations::list_by_persona", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM design_conversations WHERE persona_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_conversation)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

crud_get_by_id!(DesignConversation, "design_conversations", "Design conversation", row_to_conversation);

/// Get the active conversation for a persona (if any).
pub fn get_active(pool: &DbPool, persona_id: &str) -> Result<Option<DesignConversation>, AppError> {
    timed_query!("design_conversations", "design_conversations::get_active", {
        let conn = pool.get()?;
        let result = conn.query_row(
            "SELECT * FROM design_conversations WHERE persona_id = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
            params![persona_id],
            row_to_conversation,
        );
        match result {
            Ok(conv) => Ok(Some(conv)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

/// Create a new design conversation.
pub fn create(
    pool: &DbPool,
    id: &str,
    persona_id: &str,
    title: &str,
    messages: &str,
) -> Result<DesignConversation, AppError> {
    timed_query!("design_conversations", "design_conversations::create", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO design_conversations (id, persona_id, title, status, messages, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6)",
            params![id, persona_id, title, messages, now, now],
        )?;
        get_by_id(pool, id)
    })
}

/// Append a message to an existing conversation and update the timestamp.
pub fn append_message(
    pool: &DbPool,
    id: &str,
    messages_json: &str,
    last_result: Option<&str>,
) -> Result<DesignConversation, AppError> {
    timed_query!("design_conversations", "design_conversations::append_message", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE design_conversations SET messages = ?2, last_result = COALESCE(?3, last_result), updated_at = ?4 WHERE id = ?1",
            params![id, messages_json, last_result, now],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("Design conversation {id}")));
        }
        get_by_id(pool, id)
    })
}

/// Update the status of a conversation.
pub fn update_status(pool: &DbPool, id: &str, status: &str) -> Result<(), AppError> {
    timed_query!("design_conversations", "design_conversations::update_status", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE design_conversations SET status = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, status, now],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("Design conversation {id}")));
        }
        Ok(())
    })
}

/// Delete a conversation by ID.
pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("design_conversations", "design_conversations::delete", {
        let conn = pool.get()?;
        conn.execute("DELETE FROM design_conversations WHERE id = ?1", params![id])?;
        Ok(())
    })
}
