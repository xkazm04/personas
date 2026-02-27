use rusqlite::{params, Row};

use crate::db::models::{CreateTriggerInput, PersonaTrigger, UpdateTriggerInput};
use crate::db::DbPool;
use crate::engine::scheduler;
use crate::error::AppError;

const VALID_TRIGGER_TYPES: &[&str] = &["schedule", "polling", "webhook", "manual", "chain"];
const MIN_INTERVAL_SECONDS: i64 = 60;

fn validate_trigger_type(trigger_type: &str) -> Result<(), AppError> {
    if !VALID_TRIGGER_TYPES.contains(&trigger_type) {
        return Err(AppError::Validation(format!(
            "Invalid trigger_type '{}'. Must be one of: {}",
            trigger_type,
            VALID_TRIGGER_TYPES.join(", ")
        )));
    }
    Ok(())
}

fn validate_config(config: Option<&str>) -> Result<(), AppError> {
    if let Some(config_str) = config {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(config_str) {
            if let Some(interval) = parsed.get("interval_seconds") {
                match interval.as_i64() {
                    Some(n) if n < MIN_INTERVAL_SECONDS => {
                        return Err(AppError::Validation(format!(
                            "interval_seconds must be at least {MIN_INTERVAL_SECONDS}"
                        )));
                    }
                    Some(_) => {}
                    None => {
                        return Err(AppError::Validation(
                            "interval_seconds must be a valid integer".into(),
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

fn row_to_trigger(row: &Row) -> rusqlite::Result<PersonaTrigger> {
    Ok(PersonaTrigger {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        trigger_type: row.get("trigger_type")?,
        config: row.get("config")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        last_triggered_at: row.get("last_triggered_at")?,
        next_trigger_at: row.get("next_trigger_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        use_case_id: row.get("use_case_id")?,
    })
}

pub fn get_all(pool: &DbPool) -> Result<Vec<PersonaTrigger>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_triggers ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_trigger)?;
    let triggers = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(triggers)
}

pub fn get_by_persona_id(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<PersonaTrigger>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_triggers WHERE persona_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![persona_id], row_to_trigger)?;
    let triggers = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(triggers)
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaTrigger, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_triggers WHERE id = ?1",
        params![id],
        row_to_trigger,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Trigger {id}")),
        other => AppError::Database(other),
    })
}

pub fn create(pool: &DbPool, input: CreateTriggerInput) -> Result<PersonaTrigger, AppError> {
    validate_trigger_type(&input.trigger_type)?;
    validate_config(input.config.as_deref())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let enabled = input.enabled.unwrap_or(true) as i32;

    {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO persona_triggers
             (id, persona_id, trigger_type, config, enabled, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, input.persona_id, input.trigger_type, input.config, enabled, input.use_case_id, now],
        )?;
    }

    // Immediately compute and persist next_trigger_at so the scheduler loop picks
    // up schedule/polling triggers without requiring a separate update.
    let trigger = get_by_id(pool, &id)?;
    if let Some(next_at) = scheduler::compute_next_trigger_at(&trigger, chrono::Utc::now()) {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE persona_triggers SET next_trigger_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![next_at, chrono::Utc::now().to_rfc3339(), id],
        )?;
        return get_by_id(pool, &id);
    }

    Ok(trigger)
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateTriggerInput,
) -> Result<PersonaTrigger, AppError> {
    if let Some(ref tt) = input.trigger_type {
        validate_trigger_type(tt)?;
    }
    if let Some(ref cfg) = input.config {
        validate_config(Some(cfg.as_str()))?;
    }

    // Verify exists
    get_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    // Build dynamic SET clause
    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.trigger_type, "trigger_type", sets, param_idx);
    push_field!(input.config, "config", sets, param_idx);
    push_field!(input.enabled, "enabled", sets, param_idx);
    push_field!(input.next_trigger_at, "next_trigger_at", sets, param_idx);

    let sql = format!(
        "UPDATE persona_triggers SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.trigger_type {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.config {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(v) = input.enabled {
        param_values.push(Box::new(v as i32));
    }
    if let Some(ref v) = input.next_trigger_at {
        param_values.push(Box::new(v.clone()));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM persona_triggers WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// Get enabled chain triggers whose source_persona_id matches the given value.
/// Uses SQL-level filtering with json_extract to avoid loading all triggers.
pub fn get_chain_triggers_for_source(
    pool: &DbPool,
    source_persona_id: &str,
) -> Result<Vec<PersonaTrigger>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_triggers
         WHERE trigger_type = 'chain'
           AND enabled = 1
           AND json_extract(config, '$.source_persona_id') = ?1
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![source_persona_id], row_to_trigger)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_due(pool: &DbPool, now: &str) -> Result<Vec<PersonaTrigger>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_triggers
         WHERE enabled = 1 AND next_trigger_at IS NOT NULL AND next_trigger_at <= ?1
         ORDER BY next_trigger_at ASC",
    )?;
    let rows = stmt.query_map(params![now], row_to_trigger)?;
    let triggers = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(triggers)
}

/// Returns a map of trigger_id -> health status ("healthy", "degraded", "failing", "unknown")
/// by joining triggers with the 3 most recent executions per trigger in a single query.
pub fn get_health_map(pool: &DbPool) -> Result<std::collections::HashMap<String, String>, AppError> {
    let conn = pool.get()?;
    // For each trigger, get the 3 most recent executions (ranked by created_at DESC).
    // Then aggregate: count failures in top 3, check if top 2 are both non-completed.
    let mut stmt = conn.prepare(
        "WITH ranked AS (
           SELECT
             e.trigger_id,
             e.status,
             ROW_NUMBER() OVER (PARTITION BY e.trigger_id ORDER BY e.created_at DESC) AS rn
           FROM persona_executions e
           WHERE e.trigger_id IS NOT NULL
         ),
         top3 AS (
           SELECT trigger_id, status, rn FROM ranked WHERE rn <= 3
         ),
         agg AS (
           SELECT
             trigger_id,
             COUNT(*) AS total,
             SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END) AS fail_count,
             -- Check if the two most recent are both non-completed
             SUM(CASE WHEN rn <= 2 AND status != 'completed' THEN 1 ELSE 0 END) AS top2_non_completed
           FROM top3
           GROUP BY trigger_id
         )
         SELECT trigger_id, total, fail_count, top2_non_completed FROM agg",
    )?;

    let mut health_map = std::collections::HashMap::new();
    let rows = stmt.query_map([], |row| {
        let trigger_id: String = row.get(0)?;
        let total: i64 = row.get(1)?;
        let fail_count: i64 = row.get(2)?;
        let top2_non_completed: i64 = row.get(3)?;
        Ok((trigger_id, total, fail_count, top2_non_completed))
    })?;

    for row in rows {
        let (trigger_id, total, fail_count, top2_non_completed) = row.map_err(AppError::Database)?;
        let health = if total == 0 {
            "unknown"
        } else if fail_count == 0 {
            "healthy"
        } else if total >= 2 && top2_non_completed >= 2 {
            "failing"
        } else {
            "degraded"
        };
        health_map.insert(trigger_id, health.to_string());
    }

    Ok(health_map)
}

/// Single-query chain link resolution using SQL JOINs + json_extract.
/// Returns (trigger_id, source_persona_id, source_name, target_persona_id, target_name, condition_type, enabled).
pub fn get_chain_links(
    pool: &DbPool,
) -> Result<
    Vec<(String, String, String, String, String, String, bool)>,
    AppError,
> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT
           t.id,
           COALESCE(json_extract(t.config, '$.source_persona_id'), '') AS source_persona_id,
           COALESCE(sp.name, 'Unknown') AS source_persona_name,
           t.persona_id AS target_persona_id,
           COALESCE(tp.name, 'Unknown') AS target_persona_name,
           COALESCE(json_extract(t.config, '$.condition.type'), 'any') AS condition_type,
           t.enabled
         FROM persona_triggers t
         LEFT JOIN personas sp ON sp.id = json_extract(t.config, '$.source_persona_id')
         LEFT JOIN personas tp ON tp.id = t.persona_id
         WHERE t.trigger_type = 'chain'
         ORDER BY t.created_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, i32>(6)? != 0,
        ))
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn mark_triggered(
    pool: &DbPool,
    id: &str,
    next_trigger_at: Option<String>,
) -> Result<bool, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let rows = conn.execute(
        "UPDATE persona_triggers
         SET last_triggered_at = ?1, next_trigger_at = ?2, updated_at = ?1
         WHERE id = ?3",
        params![now, next_trigger_at, id],
    )?;
    Ok(rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;

    fn create_test_persona(pool: &DbPool) -> crate::db::models::Persona {
        crate::db::repos::core::personas::create(
            pool,
            CreatePersonaInput {
                name: "Trigger Test Agent".into(),
                system_prompt: "You handle triggers.".into(),
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
        .unwrap()
    }

    #[test]
    fn test_crud_triggers() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create
        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();
        assert_eq!(trigger.trigger_type, "schedule");
        assert!(trigger.enabled);
        assert_eq!(trigger.persona_id, persona.id);

        // Get by ID
        let fetched = get_by_id(&pool, &trigger.id).unwrap();
        assert_eq!(fetched.config, Some(r#"{"cron":"0 * * * *"}"#.into()));

        // List by persona
        let list = get_by_persona_id(&pool, &persona.id).unwrap();
        assert_eq!(list.len(), 1);

        // Update
        let updated = update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: None,
                config: Some(r#"{"cron":"*/5 * * * *"}"#.into()),
                enabled: Some(false),
                next_trigger_at: None,
            },
        )
        .unwrap();
        assert!(!updated.enabled);
        assert_eq!(updated.config, Some(r#"{"cron":"*/5 * * * *"}"#.into()));

        // Delete
        let deleted = delete(&pool, &trigger.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &trigger.id).is_err());
    }

    #[test]
    fn test_get_due_and_mark_triggered() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create a trigger with a past next_trigger_at
        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Set next_trigger_at to a past time
        let past = "2020-01-01T00:00:00+00:00";
        update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: None,
                config: None,
                enabled: None,
                next_trigger_at: Some(Some(past.into())),
            },
        )
        .unwrap();

        // Should appear in due list
        let now = chrono::Utc::now().to_rfc3339();
        let due = get_due(&pool, &now).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, trigger.id);

        // Mark triggered with a future next_trigger_at
        let future = "2099-12-31T23:59:59+00:00";
        mark_triggered(&pool, &trigger.id, Some(future.into())).unwrap();

        // Should no longer be due (next_trigger_at is in the future)
        let due_after = get_due(&pool, &now).unwrap();
        assert_eq!(due_after.len(), 0);

        // Verify last_triggered_at was set
        let refreshed = get_by_id(&pool, &trigger.id).unwrap();
        assert!(refreshed.last_triggered_at.is_some());
        assert_eq!(refreshed.next_trigger_at, Some(future.into()));
    }

    #[test]
    fn test_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_by_id(&pool, "nonexistent-id");
        assert!(result.is_err());
    }

    #[test]
    fn test_mark_triggered_deleted_trigger() {
        let pool = init_test_db().unwrap();

        // mark_triggered on a nonexistent ID should return Ok(false)
        let result = mark_triggered(&pool, "nonexistent-id", None).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_invalid_trigger_type_rejected() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "invalid_type".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_zero_interval_rejected() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"interval_seconds":0}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_valid_interval_accepted() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"interval_seconds":3600}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_create_schedule_trigger_initializes_next_trigger_at() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // next_trigger_at must be set so the scheduler loop picks it up
        assert!(
            trigger.next_trigger_at.is_some(),
            "schedule trigger must have next_trigger_at initialized on create"
        );
    }

    #[test]
    fn test_create_polling_trigger_initializes_next_trigger_at() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "polling".into(),
                config: Some(r#"{"interval_seconds":300}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        assert!(
            trigger.next_trigger_at.is_some(),
            "polling trigger must have next_trigger_at initialized on create"
        );
    }

    #[test]
    fn test_create_manual_trigger_next_trigger_at_is_null() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "manual".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        assert!(
            trigger.next_trigger_at.is_none(),
            "manual trigger should have no next_trigger_at"
        );
    }

    #[test]
    fn test_null_interval_rejected() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"interval_seconds":null}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_update_rejects_invalid_trigger_type() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "manual".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let result = update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: Some("bogus".into()),
                config: None,
                enabled: None,
                next_trigger_at: None,
            },
        );
        assert!(result.is_err());
    }
}
