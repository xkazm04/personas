use rusqlite::{params, Row};

use crate::db::models::{CreatePersonaInput, Persona, UpdatePersonaInput};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_persona(row: &Row) -> rusqlite::Result<Persona> {
    Ok(Persona {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        system_prompt: row.get("system_prompt")?,
        structured_prompt: row.get("structured_prompt")?,
        icon: row.get("icon")?,
        color: row.get("color")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        max_concurrent: row.get("max_concurrent")?,
        timeout_ms: row.get("timeout_ms")?,
        notification_channels: row.get("notification_channels")?,
        last_design_result: row.get("last_design_result")?,
        model_profile: row.get("model_profile")?,
        max_budget_usd: row.get("max_budget_usd")?,
        max_turns: row.get("max_turns")?,
        design_context: row.get("design_context")?,
        group_id: row.get("group_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn get_all(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM personas ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], row_to_persona)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<Persona, AppError> {
    let conn = pool.get()?;
    conn.query_row("SELECT * FROM personas WHERE id = ?1", params![id], row_to_persona)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Persona {id}")),
            other => AppError::Database(other),
        })
}

pub fn get_enabled(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM personas WHERE enabled = 1 ORDER BY name")?;
    let rows = stmt.query_map([], row_to_persona)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create(pool: &DbPool, input: CreatePersonaInput) -> Result<Persona, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }
    if input.system_prompt.trim().is_empty() {
        return Err(AppError::Validation("System prompt cannot be empty".into()));
    }
    if let Some(v) = input.max_concurrent {
        if v < 1 {
            return Err(AppError::Validation("max_concurrent must be >= 1".into()));
        }
    }
    if let Some(v) = input.timeout_ms {
        if v < 1000 {
            return Err(AppError::Validation("timeout_ms must be >= 1000".into()));
        }
    }
    if let Some(v) = input.max_budget_usd {
        if v < 0.0 {
            return Err(AppError::Validation("max_budget_usd must be >= 0".into()));
        }
    }
    if let Some(v) = input.max_turns {
        if v < 1 {
            return Err(AppError::Validation("max_turns must be >= 1".into()));
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let project_id = input.project_id.unwrap_or_else(|| "default".into());
    let enabled = input.enabled.unwrap_or(true) as i32;
    let max_concurrent = input.max_concurrent.unwrap_or(1);
    let timeout_ms = input.timeout_ms.unwrap_or(300_000);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO personas
         (id, project_id, name, description, system_prompt, structured_prompt,
          icon, color, enabled, max_concurrent, timeout_ms,
          model_profile, max_budget_usd, max_turns, design_context, group_id,
          created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)",
        params![
            id, project_id, input.name, input.description, input.system_prompt,
            input.structured_prompt, input.icon, input.color, enabled,
            max_concurrent, timeout_ms, input.model_profile,
            input.max_budget_usd, input.max_turns, input.design_context,
            input.group_id, now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn update(pool: &DbPool, id: &str, input: UpdatePersonaInput) -> Result<Persona, AppError> {
    // Verify exists
    get_by_id(pool, id)?;

    // Validate name and system_prompt when provided
    if let Some(ref name) = input.name {
        if name.trim().is_empty() {
            return Err(AppError::Validation("Name cannot be empty".into()));
        }
    }
    if let Some(ref prompt) = input.system_prompt {
        if prompt.trim().is_empty() {
            return Err(AppError::Validation("System prompt cannot be empty".into()));
        }
    }
    if let Some(v) = input.max_concurrent {
        if v < 1 {
            return Err(AppError::Validation("max_concurrent must be >= 1".into()));
        }
    }
    if let Some(v) = input.timeout_ms {
        if v < 1000 {
            return Err(AppError::Validation("timeout_ms must be >= 1000".into()));
        }
    }
    if let Some(Some(v)) = input.max_budget_usd {
        if v < 0.0 {
            return Err(AppError::Validation("max_budget_usd must be >= 0".into()));
        }
    }
    if let Some(Some(v)) = input.max_turns {
        if v < 1 {
            return Err(AppError::Validation("max_turns must be >= 1".into()));
        }
    }
    if let Some(ref channels_json) = input.notification_channels {
        if let Ok(channels) = serde_json::from_str::<Vec<serde_json::Value>>(channels_json) {
            for ch in &channels {
                let enabled = ch.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
                if !enabled {
                    continue;
                }
                let ch_type = ch.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let config = ch.get("config");
                let get_field = |key: &str| -> bool {
                    config
                        .and_then(|c| c.get(key))
                        .and_then(|v| v.as_str())
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false)
                };
                match ch_type {
                    "slack" if !get_field("channel") => {
                        return Err(AppError::Validation("Slack channel name is required".into()));
                    }
                    "telegram" if !get_field("chat_id") => {
                        return Err(AppError::Validation("Telegram chat ID is required".into()));
                    }
                    "email" if !get_field("to") => {
                        return Err(AppError::Validation("Email 'to' address is required".into()));
                    }
                    _ => {}
                }
            }
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    // Build dynamic SET clause
    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.name, "name", sets, param_idx);
    push_field!(input.description, "description", sets, param_idx);
    push_field!(input.system_prompt, "system_prompt", sets, param_idx);
    push_field!(input.structured_prompt, "structured_prompt", sets, param_idx);
    push_field!(input.icon, "icon", sets, param_idx);
    push_field!(input.color, "color", sets, param_idx);
    push_field!(input.enabled, "enabled", sets, param_idx);
    push_field!(input.max_concurrent, "max_concurrent", sets, param_idx);
    push_field!(input.timeout_ms, "timeout_ms", sets, param_idx);
    push_field!(input.notification_channels, "notification_channels", sets, param_idx);
    push_field!(input.last_design_result, "last_design_result", sets, param_idx);
    push_field!(input.model_profile, "model_profile", sets, param_idx);
    push_field!(input.max_budget_usd, "max_budget_usd", sets, param_idx);
    push_field!(input.max_turns, "max_turns", sets, param_idx);
    push_field!(input.design_context, "design_context", sets, param_idx);
    push_field!(input.group_id, "group_id", sets, param_idx);

    let sql = format!(
        "UPDATE personas SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    // Use a boxed params approach to handle dynamic binding
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.name { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.description { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.system_prompt { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.structured_prompt { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.icon { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.color { param_values.push(Box::new(v.clone())); }
    if let Some(v) = input.enabled { param_values.push(Box::new(v as i32)); }
    if let Some(v) = input.max_concurrent { param_values.push(Box::new(v)); }
    if let Some(v) = input.timeout_ms { param_values.push(Box::new(v)); }
    if let Some(ref v) = input.notification_channels { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.last_design_result { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.model_profile { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.max_budget_usd { param_values.push(Box::new(*v)); }
    if let Some(ref v) = input.max_turns { param_values.push(Box::new(*v)); }
    if let Some(ref v) = input.design_context { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.group_id { param_values.push(Box::new(v.clone())); }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM personas WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_crud_persona() {
        let pool = init_test_db().unwrap();

        // Create
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Test Agent".into(),
                system_prompt: "You are a test agent.".into(),
                project_id: None,
                description: Some("A test persona".into()),
                structured_prompt: None,
                icon: None,
                color: Some("#06b6d4".into()),
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
        assert_eq!(persona.name, "Test Agent");
        assert!(persona.enabled);

        // Read
        let fetched = get_by_id(&pool, &persona.id).unwrap();
        assert_eq!(fetched.description, Some("A test persona".into()));

        // List
        let all = get_all(&pool).unwrap();
        assert_eq!(all.len(), 1);

        // Update
        let updated = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: Some("Updated Agent".into()),
                description: None,
                system_prompt: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(false),
                max_concurrent: None,
                timeout_ms: None,
                notification_channels: None,
                last_design_result: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Updated Agent");
        assert!(!updated.enabled);

        // Enabled list should be empty now
        let enabled = get_enabled(&pool).unwrap();
        assert_eq!(enabled.len(), 0);

        // Delete
        let deleted = delete(&pool, &persona.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &persona.id).is_err());
    }

    #[test]
    fn test_validation() {
        let pool = init_test_db().unwrap();
        let result = create(
            &pool,
            CreatePersonaInput {
                name: "".into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_update_rejects_empty_name() {
        let pool = init_test_db().unwrap();
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Valid Agent".into(),
                system_prompt: "You are valid.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
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

        // Empty name should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: Some("".into()),
                description: None, system_prompt: None, structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, notification_channels: None, last_design_result: None,
                model_profile: None, max_budget_usd: None, max_turns: None,
                design_context: None, group_id: None,
            },
        );
        assert!(result.is_err());

        // Whitespace-only name should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: Some("   ".into()),
                description: None, system_prompt: None, structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, notification_channels: None, last_design_result: None,
                model_profile: None, max_budget_usd: None, max_turns: None,
                design_context: None, group_id: None,
            },
        );
        assert!(result.is_err());

        // Name unchanged in DB
        let fetched = get_by_id(&pool, &persona.id).unwrap();
        assert_eq!(fetched.name, "Valid Agent");
    }

    #[test]
    fn test_update_rejects_empty_system_prompt() {
        let pool = init_test_db().unwrap();
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Prompt Agent".into(),
                system_prompt: "Original prompt.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
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

        // Empty system_prompt should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: None, description: None,
                system_prompt: Some("".into()),
                structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, notification_channels: None, last_design_result: None,
                model_profile: None, max_budget_usd: None, max_turns: None,
                design_context: None, group_id: None,
            },
        );
        assert!(result.is_err());

        // Whitespace-only system_prompt should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: None, description: None,
                system_prompt: Some("  \n  ".into()),
                structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, notification_channels: None, last_design_result: None,
                model_profile: None, max_budget_usd: None, max_turns: None,
                design_context: None, group_id: None,
            },
        );
        assert!(result.is_err());

        // Prompt unchanged in DB
        let fetched = get_by_id(&pool, &persona.id).unwrap();
        assert_eq!(fetched.system_prompt, "Original prompt.");
    }

    #[test]
    fn test_create_validates_numeric_fields() {
        let pool = init_test_db().unwrap();

        let base = || CreatePersonaInput {
            name: "Agent".into(),
            system_prompt: "Prompt.".into(),
            project_id: None, description: None, structured_prompt: None,
            icon: None, color: None, enabled: None, max_concurrent: None,
            timeout_ms: None, model_profile: None, max_budget_usd: None,
            max_turns: None, design_context: None, group_id: None,
        };

        // max_concurrent < 1
        let mut input = base();
        input.max_concurrent = Some(0);
        assert!(create(&pool, input).is_err());

        // timeout_ms < 1000
        let mut input = base();
        input.timeout_ms = Some(999);
        assert!(create(&pool, input).is_err());

        // max_budget_usd < 0
        let mut input = base();
        input.max_budget_usd = Some(-0.01);
        assert!(create(&pool, input).is_err());

        // max_turns < 1
        let mut input = base();
        input.max_turns = Some(0);
        assert!(create(&pool, input).is_err());

        // Valid values should succeed
        let mut input = base();
        input.max_concurrent = Some(1);
        input.timeout_ms = Some(1000);
        input.max_budget_usd = Some(0.0);
        input.max_turns = Some(1);
        assert!(create(&pool, input).is_ok());
    }

    #[test]
    fn test_update_validates_numeric_fields() {
        let pool = init_test_db().unwrap();
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Numeric Agent".into(),
                system_prompt: "Prompt.".into(),
                project_id: None, description: None, structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, model_profile: None, max_budget_usd: None,
                max_turns: None, design_context: None, group_id: None,
            },
        )
        .unwrap();

        let base = || UpdatePersonaInput {
            name: None, description: None, system_prompt: None,
            structured_prompt: None, icon: None, color: None, enabled: None,
            max_concurrent: None, timeout_ms: None, notification_channels: None,
            last_design_result: None, model_profile: None, max_budget_usd: None,
            max_turns: None, design_context: None, group_id: None,
        };

        // max_concurrent < 1
        let mut input = base();
        input.max_concurrent = Some(0);
        assert!(update(&pool, &persona.id, input).is_err());

        // timeout_ms < 1000
        let mut input = base();
        input.timeout_ms = Some(500);
        assert!(update(&pool, &persona.id, input).is_err());

        // max_budget_usd negative
        let mut input = base();
        input.max_budget_usd = Some(Some(-1.0));
        assert!(update(&pool, &persona.id, input).is_err());

        // max_turns < 1
        let mut input = base();
        input.max_turns = Some(Some(0));
        assert!(update(&pool, &persona.id, input).is_err());

        // Clearing values (Some(None)) should be allowed
        let mut input = base();
        input.max_budget_usd = Some(None);
        input.max_turns = Some(None);
        assert!(update(&pool, &persona.id, input).is_ok());
    }
}
