use rusqlite::{params, Row};

use crate::db::models::{CreateMessageInput, PersonaMessage, PersonaMessageDelivery};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row Mappers
// ============================================================================

fn row_to_message(row: &Row) -> rusqlite::Result<PersonaMessage> {
    Ok(PersonaMessage {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        execution_id: row.get("execution_id")?,
        title: row.get("title")?,
        content: row.get("content")?,
        content_type: row.get("content_type")?,
        priority: row.get("priority")?,
        is_read: row.get::<_, i32>("is_read")? != 0,
        metadata: row.get("metadata")?,
        created_at: row.get("created_at")?,
        read_at: row.get("read_at")?,
    })
}

fn row_to_delivery(row: &Row) -> rusqlite::Result<PersonaMessageDelivery> {
    Ok(PersonaMessageDelivery {
        id: row.get("id")?,
        message_id: row.get("message_id")?,
        channel_type: row.get("channel_type")?,
        status: row.get("status")?,
        error_message: row.get("error_message")?,
        external_id: row.get("external_id")?,
        delivered_at: row.get("delivered_at")?,
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Messages
// ============================================================================

pub fn get_all(
    pool: &DbPool,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PersonaMessage>, AppError> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);
    let conn = pool.get()?;

    let mut stmt = conn.prepare(
        "SELECT * FROM persona_messages
         ORDER BY created_at DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt.query_map(params![limit, offset], row_to_message)?;
    let messages = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(messages)
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaMessage, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_messages WHERE id = ?1",
        params![id],
        row_to_message,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("PersonaMessage {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_by_persona_id(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaMessage>, AppError> {
    let limit = limit.unwrap_or(50);
    let conn = pool.get()?;

    let mut stmt = conn.prepare(
        "SELECT * FROM persona_messages
         WHERE persona_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], row_to_message)?;
    let messages = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(messages)
}

pub fn get_unread_count(pool: &DbPool) -> Result<i64, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persona_messages WHERE is_read = 0",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub fn get_total_count(pool: &DbPool) -> Result<i64, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persona_messages",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub fn create(pool: &DbPool, input: CreateMessageInput) -> Result<PersonaMessage, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let content_type = input.content_type.unwrap_or_else(|| "text".into());
    let priority = input.priority.unwrap_or_else(|| "normal".into());

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_messages
         (id, persona_id, execution_id, title, content, content_type, priority, is_read, metadata, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9)",
        params![
            id,
            input.persona_id,
            input.execution_id,
            input.title,
            input.content,
            content_type,
            priority,
            input.metadata,
            now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn mark_as_read(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let rows = conn.execute(
        "UPDATE persona_messages SET is_read = 1, read_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;

    if rows == 0 {
        return Err(AppError::NotFound(format!("PersonaMessage {id}")));
    }

    Ok(())
}

pub fn mark_all_as_read(pool: &DbPool, persona_id: Option<&str>) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    if let Some(pid) = persona_id {
        conn.execute(
            "UPDATE persona_messages SET is_read = 1, read_at = ?1
             WHERE persona_id = ?2 AND is_read = 0",
            params![now, pid],
        )?;
    } else {
        conn.execute(
            "UPDATE persona_messages SET is_read = 1, read_at = ?1 WHERE is_read = 0",
            params![now],
        )?;
    }

    Ok(())
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM persona_messages WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

// ============================================================================
// Message Deliveries
// ============================================================================

pub fn get_delivery_by_id(pool: &DbPool, id: &str) -> Result<PersonaMessageDelivery, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_message_deliveries WHERE id = ?1",
        params![id],
        row_to_delivery,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("PersonaMessageDelivery {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_deliveries_by_message(
    pool: &DbPool,
    message_id: &str,
) -> Result<Vec<PersonaMessageDelivery>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_message_deliveries
         WHERE message_id = ?1
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![message_id], row_to_delivery)?;
    let deliveries = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(deliveries)
}

pub fn create_delivery(
    pool: &DbPool,
    message_id: &str,
    channel_type: &str,
    status: Option<String>,
) -> Result<PersonaMessageDelivery, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let status = status.unwrap_or_else(|| "pending".into());

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_message_deliveries
         (id, message_id, channel_type, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, message_id, channel_type, status, now],
    )?;

    get_delivery_by_id(pool, &id)
}

pub fn update_delivery_status(
    pool: &DbPool,
    id: &str,
    status: &str,
    error_message: Option<String>,
    external_id: Option<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;

    let delivered_at: Option<String> = if status == "delivered" {
        Some(chrono::Utc::now().to_rfc3339())
    } else {
        None
    };

    let rows = conn.execute(
        "UPDATE persona_message_deliveries
         SET status = ?1, error_message = ?2, external_id = ?3, delivered_at = ?4
         WHERE id = ?5",
        params![status, error_message, external_id, delivered_at, id],
    )?;

    if rows == 0 {
        return Err(AppError::NotFound(format!("PersonaMessageDelivery {id}")));
    }

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::personas;

    fn create_test_persona(pool: &DbPool) -> String {
        let persona = personas::create(
            pool,
            CreatePersonaInput {
                name: "Message Test Persona".into(),
                system_prompt: "You are a message test persona.".into(),
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
                group_id: None,
            },
        )
        .unwrap();
        persona.id
    }

    // ------------------------------------------------------------------
    // Message tests
    // ------------------------------------------------------------------

    #[test]
    fn test_create_and_get_message() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        let msg = create(
            &pool,
            CreateMessageInput {
                persona_id: persona_id.clone(),
                execution_id: None,
                title: Some("Build Report".into()),
                content: "Build succeeded with 0 warnings.".into(),
                content_type: None,
                priority: Some("high".into()),
                metadata: None,
            },
        )
        .unwrap();

        assert_eq!(msg.persona_id, persona_id);
        assert_eq!(msg.title, Some("Build Report".into()));
        assert_eq!(msg.content, "Build succeeded with 0 warnings.");
        assert_eq!(msg.content_type, "text");
        assert_eq!(msg.priority, "high");
        assert!(!msg.is_read);
        assert!(msg.read_at.is_none());

        // Fetch by id
        let fetched = get_by_id(&pool, &msg.id).unwrap();
        assert_eq!(fetched.id, msg.id);
    }

    #[test]
    fn test_get_by_id_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_by_id(&pool, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_all_messages() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        for i in 0..5 {
            create(
                &pool,
                CreateMessageInput {
                    persona_id: persona_id.clone(),
                    execution_id: None,
                    title: Some(format!("Msg {i}")),
                    content: format!("Content {i}"),
                    content_type: None,
                    priority: None,
                    metadata: None,
                },
            )
            .unwrap();
        }

        // Default limit
        let all = get_all(&pool, None, None).unwrap();
        assert_eq!(all.len(), 5);

        // With limit
        let limited = get_all(&pool, Some(3), None).unwrap();
        assert_eq!(limited.len(), 3);

        // With offset
        let offset = get_all(&pool, Some(10), Some(3)).unwrap();
        assert_eq!(offset.len(), 2);
    }

    #[test]
    fn test_get_by_persona_id() {
        let pool = init_test_db().unwrap();
        let p1 = create_test_persona(&pool);

        create(
            &pool,
            CreateMessageInput {
                persona_id: p1.clone(),
                execution_id: None,
                title: None,
                content: "Hello from p1".into(),
                content_type: None,
                priority: None,
                metadata: None,
            },
        )
        .unwrap();

        let msgs = get_by_persona_id(&pool, &p1, None).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "Hello from p1");

        let empty = get_by_persona_id(&pool, "other-persona", None).unwrap();
        assert_eq!(empty.len(), 0);
    }

    #[test]
    fn test_unread_count() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        assert_eq!(get_unread_count(&pool).unwrap(), 0);

        let msg1 = create(
            &pool,
            CreateMessageInput {
                persona_id: persona_id.clone(),
                execution_id: None,
                title: None,
                content: "Unread 1".into(),
                content_type: None,
                priority: None,
                metadata: None,
            },
        )
        .unwrap();

        create(
            &pool,
            CreateMessageInput {
                persona_id: persona_id.clone(),
                execution_id: None,
                title: None,
                content: "Unread 2".into(),
                content_type: None,
                priority: None,
                metadata: None,
            },
        )
        .unwrap();

        assert_eq!(get_unread_count(&pool).unwrap(), 2);

        // Mark one as read
        mark_as_read(&pool, &msg1.id).unwrap();
        assert_eq!(get_unread_count(&pool).unwrap(), 1);

        // Verify read_at is set
        let read_msg = get_by_id(&pool, &msg1.id).unwrap();
        assert!(read_msg.is_read);
        assert!(read_msg.read_at.is_some());
    }

    #[test]
    fn test_mark_as_read_not_found() {
        let pool = init_test_db().unwrap();
        let result = mark_as_read(&pool, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_mark_all_as_read() {
        let pool = init_test_db().unwrap();
        let p1 = create_test_persona(&pool);
        let p2 = create_test_persona(&pool);

        // Create messages for two personas
        create(
            &pool,
            CreateMessageInput {
                persona_id: p1.clone(),
                execution_id: None,
                title: None,
                content: "p1 msg".into(),
                content_type: None,
                priority: None,
                metadata: None,
            },
        )
        .unwrap();

        create(
            &pool,
            CreateMessageInput {
                persona_id: p2.clone(),
                execution_id: None,
                title: None,
                content: "p2 msg".into(),
                content_type: None,
                priority: None,
                metadata: None,
            },
        )
        .unwrap();

        assert_eq!(get_unread_count(&pool).unwrap(), 2);

        // Mark all for p1 only
        mark_all_as_read(&pool, Some(&p1)).unwrap();
        assert_eq!(get_unread_count(&pool).unwrap(), 1);

        // Mark all remaining
        mark_all_as_read(&pool, None).unwrap();
        assert_eq!(get_unread_count(&pool).unwrap(), 0);
    }

    #[test]
    fn test_delete_message() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        let msg = create(
            &pool,
            CreateMessageInput {
                persona_id: persona_id.clone(),
                execution_id: None,
                title: None,
                content: "To be deleted".into(),
                content_type: None,
                priority: None,
                metadata: None,
            },
        )
        .unwrap();

        let deleted = delete(&pool, &msg.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &msg.id).is_err());

        // Delete non-existent
        let not_deleted = delete(&pool, "nonexistent").unwrap();
        assert!(!not_deleted);
    }

    // ------------------------------------------------------------------
    // Delivery tests
    // ------------------------------------------------------------------

    #[test]
    fn test_delivery_crud() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        let msg = create(
            &pool,
            CreateMessageInput {
                persona_id: persona_id.clone(),
                execution_id: None,
                title: None,
                content: "Delivery test".into(),
                content_type: None,
                priority: None,
                metadata: None,
            },
        )
        .unwrap();

        // Create delivery
        let delivery = create_delivery(&pool, &msg.id, "email", None).unwrap();
        assert_eq!(delivery.message_id, msg.id);
        assert_eq!(delivery.channel_type, "email");
        assert_eq!(delivery.status, "pending");
        assert!(delivery.delivered_at.is_none());

        // Get deliveries by message
        let deliveries = get_deliveries_by_message(&pool, &msg.id).unwrap();
        assert_eq!(deliveries.len(), 1);

        // Update status to delivered
        update_delivery_status(
            &pool,
            &delivery.id,
            "delivered",
            None,
            Some("ext-123".into()),
        )
        .unwrap();

        let updated = get_deliveries_by_message(&pool, &msg.id).unwrap();
        assert_eq!(updated[0].status, "delivered");
        assert_eq!(updated[0].external_id, Some("ext-123".into()));
        assert!(updated[0].delivered_at.is_some());
    }

    #[test]
    fn test_delivery_with_error() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        let msg = create(
            &pool,
            CreateMessageInput {
                persona_id: persona_id.clone(),
                execution_id: None,
                title: None,
                content: "Delivery error test".into(),
                content_type: None,
                priority: None,
                metadata: None,
            },
        )
        .unwrap();

        let delivery = create_delivery(&pool, &msg.id, "slack", Some("queued".into())).unwrap();
        assert_eq!(delivery.status, "queued");

        // Mark as failed
        update_delivery_status(
            &pool,
            &delivery.id,
            "failed",
            Some("Connection refused".into()),
            None,
        )
        .unwrap();

        let deliveries = get_deliveries_by_message(&pool, &msg.id).unwrap();
        assert_eq!(deliveries[0].status, "failed");
        assert_eq!(
            deliveries[0].error_message,
            Some("Connection refused".into())
        );
        assert!(deliveries[0].delivered_at.is_none());
    }

    #[test]
    fn test_update_delivery_status_not_found() {
        let pool = init_test_db().unwrap();
        let result = update_delivery_status(&pool, "nonexistent", "delivered", None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_deliveries_per_message() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        let msg = create(
            &pool,
            CreateMessageInput {
                persona_id: persona_id.clone(),
                execution_id: None,
                title: None,
                content: "Multi-channel".into(),
                content_type: None,
                priority: None,
                metadata: None,
            },
        )
        .unwrap();

        create_delivery(&pool, &msg.id, "email", None).unwrap();
        create_delivery(&pool, &msg.id, "slack", None).unwrap();
        create_delivery(&pool, &msg.id, "desktop", None).unwrap();

        let deliveries = get_deliveries_by_message(&pool, &msg.id).unwrap();
        assert_eq!(deliveries.len(), 3);
    }
}
