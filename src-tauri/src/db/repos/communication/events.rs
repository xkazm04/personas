use rusqlite::{params, Row};

use crate::db::models::{
    CreateEventSubscriptionInput, CreatePersonaEventInput, PersonaEvent,
    PersonaEventSubscription, UpdateEventSubscriptionInput,
};
use crate::db::DbPool;
use crate::error::AppError;

/// Collect rows from a query, logging any row-mapping errors instead of silently dropping them.
fn collect_rows<T>(
    rows: impl Iterator<Item = rusqlite::Result<T>>,
    context: &str,
) -> Vec<T> {
    let mut results = Vec::new();
    for (idx, row_result) in rows.enumerate() {
        match row_result {
            Ok(item) => results.push(item),
            Err(e) => {
                tracing::warn!(
                    context = context,
                    row_index = idx,
                    error = %e,
                    "Failed to map database row — possible data corruption"
                );
            }
        }
    }
    results
}

// ============================================================================
// Row Mappers
// ============================================================================

fn row_to_event(row: &Row) -> rusqlite::Result<PersonaEvent> {
    Ok(PersonaEvent {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        event_type: row.get("event_type")?,
        source_type: row.get("source_type")?,
        source_id: row.get("source_id")?,
        target_persona_id: row.get("target_persona_id")?,
        payload: row.get("payload")?,
        status: row.get("status")?,
        error_message: row.get("error_message")?,
        processed_at: row.get("processed_at")?,
        created_at: row.get("created_at")?,
        use_case_id: row.get("use_case_id")?,
    })
}

fn row_to_subscription(row: &Row) -> rusqlite::Result<PersonaEventSubscription> {
    Ok(PersonaEventSubscription {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        event_type: row.get("event_type")?,
        source_filter: row.get("source_filter")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        use_case_id: row.get("use_case_id")?,
    })
}

// ============================================================================
// Events
// ============================================================================

pub fn publish(pool: &DbPool, input: CreatePersonaEventInput) -> Result<PersonaEvent, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let project_id = input.project_id.unwrap_or_else(|| "default".into());

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_events
         (id, project_id, event_type, source_type, source_id, target_persona_id, payload, use_case_id, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9)",
        params![
            id,
            project_id,
            input.event_type,
            input.source_type,
            input.source_id,
            input.target_persona_id,
            input.payload,
            input.use_case_id,
            now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaEvent, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_events WHERE id = ?1",
        params![id],
        row_to_event,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("PersonaEvent {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_pending(
    pool: &DbPool,
    limit: Option<i64>,
    project_id: Option<&str>,
) -> Result<Vec<PersonaEvent>, AppError> {
    let limit = limit.unwrap_or(100);
    let conn = pool.get()?;

    if let Some(pid) = project_id {
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_events
             WHERE status = 'pending' AND project_id = ?1
             ORDER BY created_at ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pid, limit], row_to_event)?;
        Ok(collect_rows(rows, "get_pending"))
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_events
             WHERE status = 'pending'
             ORDER BY created_at ASC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], row_to_event)?;
        Ok(collect_rows(rows, "get_pending"))
    }
}

pub fn update_status(
    pool: &DbPool,
    id: &str,
    status: &str,
    error_message: Option<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;

    let processed_at: Option<String> = if status != "pending" {
        Some(chrono::Utc::now().to_rfc3339())
    } else {
        None
    };

    let rows = conn.execute(
        "UPDATE persona_events
         SET status = ?1, error_message = ?2, processed_at = ?3
         WHERE id = ?4",
        params![status, error_message, processed_at, id],
    )?;

    if rows == 0 {
        return Err(AppError::NotFound(format!("PersonaEvent {id}")));
    }

    Ok(())
}

pub fn get_recent(
    pool: &DbPool,
    limit: Option<i64>,
    project_id: Option<&str>,
) -> Result<Vec<PersonaEvent>, AppError> {
    let limit = limit.unwrap_or(100);
    let conn = pool.get()?;

    if let Some(pid) = project_id {
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_events
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pid, limit], row_to_event)?;
        Ok(collect_rows(rows, "get_recent"))
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_events
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], row_to_event)?;
        Ok(collect_rows(rows, "get_recent"))
    }
}

pub fn cleanup(pool: &DbPool, older_than_days: Option<i64>) -> Result<i64, AppError> {
    let days = older_than_days.unwrap_or(30);
    let conn = pool.get()?;

    // Use chrono for the cutoff date to match the timestamp format used in publish().
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
    let rows = conn.execute(
        "DELETE FROM persona_events
         WHERE status IN ('completed', 'skipped', 'failed')
           AND created_at < ?1",
        params![cutoff],
    )?;

    Ok(rows as i64)
}

// ============================================================================
// Event Subscriptions
// ============================================================================

pub fn get_subscription_by_id(
    pool: &DbPool,
    id: &str,
) -> Result<PersonaEventSubscription, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_event_subscriptions WHERE id = ?1",
        params![id],
        row_to_subscription,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("PersonaEventSubscription {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_subscriptions_by_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_event_subscriptions
         WHERE persona_id = ?1
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![persona_id], row_to_subscription)?;
    Ok(collect_rows(rows, "get_subscriptions_by_persona"))
}

pub fn get_subscriptions_by_event_type(
    pool: &DbPool,
    event_type: &str,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_event_subscriptions
         WHERE event_type = ?1 AND enabled = 1
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![event_type], row_to_subscription)?;
    Ok(collect_rows(rows, "get_subscriptions_by_event_type"))
}

pub fn create_subscription(
    pool: &DbPool,
    input: CreateEventSubscriptionInput,
) -> Result<PersonaEventSubscription, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let enabled = input.enabled.unwrap_or(true) as i32;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_event_subscriptions
         (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            input.persona_id,
            input.event_type,
            input.source_filter,
            enabled,
            input.use_case_id,
            now,
        ],
    )?;

    get_subscription_by_id(pool, &id)
}

pub fn update_subscription(
    pool: &DbPool,
    id: &str,
    input: UpdateEventSubscriptionInput,
) -> Result<PersonaEventSubscription, AppError> {
    // Verify exists
    get_subscription_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.event_type, "event_type", sets, param_idx);
    push_field!(input.source_filter, "source_filter", sets, param_idx);
    push_field!(input.enabled, "enabled", sets, param_idx);

    let sql = format!(
        "UPDATE persona_event_subscriptions SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.event_type {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.source_filter {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(v) = input.enabled {
        param_values.push(Box::new(v as i32));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_subscription_by_id(pool, id)
}

pub fn delete_subscription(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM persona_event_subscriptions WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreatePersonaInput, CreateEventSubscriptionInput};
    use crate::db::repos::core::personas;

    fn create_test_persona(pool: &DbPool) -> String {
        let persona = personas::create(
            pool,
            CreatePersonaInput {
                name: "Event Test Persona".into(),
                system_prompt: "You are an event test persona.".into(),
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
                notification_channels: None,
            },
        )
        .unwrap();
        persona.id
    }

    // ------------------------------------------------------------------
    // Event tests
    // ------------------------------------------------------------------

    #[test]
    fn test_publish_and_get_event() {
        let pool = init_test_db().unwrap();

        let event = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "file_changed".into(),
                source_type: "watcher".into(),
                project_id: Some("proj-1".into()),
                source_id: Some("watcher-1".into()),
                target_persona_id: None,
                payload: Some(r#"{"path":"src/main.rs"}"#.into()),
                use_case_id: None,
            },
        )
        .unwrap();

        assert_eq!(event.event_type, "file_changed");
        assert_eq!(event.source_type, "watcher");
        assert_eq!(event.project_id, "proj-1");
        assert_eq!(event.status, "pending");
        assert!(event.processed_at.is_none());

        // Fetch by id
        let fetched = get_by_id(&pool, &event.id).unwrap();
        assert_eq!(fetched.id, event.id);
        assert_eq!(fetched.payload, Some(r#"{"path":"src/main.rs"}"#.into()));
    }

    #[test]
    fn test_get_by_id_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_by_id(&pool, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_pending_events() {
        let pool = init_test_db().unwrap();

        // Publish two pending events
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "build_complete".into(),
                source_type: "ci".into(),
                project_id: Some("proj-a".into()),
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "test_passed".into(),
                source_type: "ci".into(),
                project_id: Some("proj-b".into()),
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // All pending
        let all_pending = get_pending(&pool, None, None).unwrap();
        assert_eq!(all_pending.len(), 2);

        // Filtered by project
        let proj_a = get_pending(&pool, None, Some("proj-a")).unwrap();
        assert_eq!(proj_a.len(), 1);
        assert_eq!(proj_a[0].event_type, "build_complete");

        // With limit
        let limited = get_pending(&pool, Some(1), None).unwrap();
        assert_eq!(limited.len(), 1);
    }

    #[test]
    fn test_update_status() {
        let pool = init_test_db().unwrap();

        let event = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "deploy".into(),
                source_type: "pipeline".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // Mark completed
        update_status(&pool, &event.id, "completed", None).unwrap();
        let updated = get_by_id(&pool, &event.id).unwrap();
        assert_eq!(updated.status, "completed");
        assert!(updated.processed_at.is_some());

        // Mark with error
        let event2 = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "deploy".into(),
                source_type: "pipeline".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        update_status(
            &pool,
            &event2.id,
            "failed",
            Some("timeout exceeded".into()),
        )
        .unwrap();
        let failed = get_by_id(&pool, &event2.id).unwrap();
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.error_message, Some("timeout exceeded".into()));
        assert!(failed.processed_at.is_some());
    }

    #[test]
    fn test_update_status_not_found() {
        let pool = init_test_db().unwrap();
        let result = update_status(&pool, "nonexistent", "completed", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_recent() {
        let pool = init_test_db().unwrap();

        for i in 0..3 {
            publish(
                &pool,
                CreatePersonaEventInput {
                    event_type: format!("event_{i}"),
                    source_type: "test".into(),
                    project_id: Some("proj-x".into()),
                    source_id: None,
                    target_persona_id: None,
                    payload: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }

        let recent = get_recent(&pool, Some(2), None).unwrap();
        assert_eq!(recent.len(), 2);

        let recent_proj = get_recent(&pool, None, Some("proj-x")).unwrap();
        assert_eq!(recent_proj.len(), 3);
    }

    #[test]
    fn test_cleanup() {
        let pool = init_test_db().unwrap();

        let event = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "old_event".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // Mark as completed (cleanup only deletes completed/skipped/failed)
        update_status(&pool, &event.id, "completed", None).unwrap();

        // Cleanup with 0 days should delete it (created_at < now - 0 days is already true)
        let deleted = cleanup(&pool, Some(0)).unwrap();
        assert_eq!(deleted, 1);

        // Verify gone
        assert!(get_by_id(&pool, &event.id).is_err());
    }

    // ------------------------------------------------------------------
    // Subscription tests
    // ------------------------------------------------------------------

    #[test]
    fn test_subscription_crud() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        // Create
        let sub = create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "file_changed".into(),
                source_filter: Some("src/**".into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        assert_eq!(sub.persona_id, persona_id);
        assert_eq!(sub.event_type, "file_changed");
        assert_eq!(sub.source_filter, Some("src/**".into()));
        assert!(sub.enabled);

        // Get by id
        let fetched = get_subscription_by_id(&pool, &sub.id).unwrap();
        assert_eq!(fetched.id, sub.id);

        // Update
        let updated = update_subscription(
            &pool,
            &sub.id,
            UpdateEventSubscriptionInput {
                event_type: Some("build_complete".into()),
                source_filter: None,
                enabled: Some(false),
            },
        )
        .unwrap();
        assert_eq!(updated.event_type, "build_complete");
        assert!(!updated.enabled);

        // Delete
        let deleted = delete_subscription(&pool, &sub.id).unwrap();
        assert!(deleted);
        assert!(get_subscription_by_id(&pool, &sub.id).is_err());
    }

    #[test]
    fn test_subscription_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_subscription_by_id(&pool, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_subscriptions_by_persona() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "event_a".into(),
                source_filter: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "event_b".into(),
                source_filter: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let subs = get_subscriptions_by_persona(&pool, &persona_id).unwrap();
        assert_eq!(subs.len(), 2);
    }

    #[test]
    fn test_get_subscriptions_by_event_type() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        // One enabled, one disabled
        create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "deploy".into(),
                source_filter: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "deploy".into(),
                source_filter: Some("staging".into()),
                enabled: Some(false),
                use_case_id: None,
            },
        )
        .unwrap();

        // Only enabled ones returned
        let subs = get_subscriptions_by_event_type(&pool, "deploy").unwrap();
        assert_eq!(subs.len(), 1);
        assert!(subs[0].enabled);
    }

    #[test]
    fn test_delete_subscription_not_found() {
        let pool = init_test_db().unwrap();
        let deleted = delete_subscription(&pool, "nonexistent").unwrap();
        assert!(!deleted);
    }
}
