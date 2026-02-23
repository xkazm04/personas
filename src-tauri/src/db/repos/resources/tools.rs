use rusqlite::{params, Row};

use crate::db::models::{CreateToolDefinitionInput, PersonaTool, PersonaToolDefinition, UpdateToolDefinitionInput};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_tool_def(row: &Row) -> rusqlite::Result<PersonaToolDefinition> {
    Ok(PersonaToolDefinition {
        id: row.get("id")?,
        name: row.get("name")?,
        category: row.get("category")?,
        description: row.get("description")?,
        script_path: row.get("script_path")?,
        input_schema: row.get("input_schema")?,
        output_schema: row.get("output_schema")?,
        requires_credential_type: row.get("requires_credential_type")?,
        implementation_guide: row.get("implementation_guide")?,
        is_builtin: row.get::<_, i32>("is_builtin")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn get_all_definitions(pool: &DbPool) -> Result<Vec<PersonaToolDefinition>, AppError> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("SELECT * FROM persona_tool_definitions ORDER BY category, name")?;
    let rows = stmt.query_map([], row_to_tool_def)?;
    let defs = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(defs)
}

pub fn get_definition_by_id(pool: &DbPool, id: &str) -> Result<PersonaToolDefinition, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_tool_definitions WHERE id = ?1",
        params![id],
        row_to_tool_def,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Tool definition {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_definitions_by_category(
    pool: &DbPool,
    category: &str,
) -> Result<Vec<PersonaToolDefinition>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_tool_definitions WHERE category = ?1 ORDER BY name",
    )?;
    let rows = stmt.query_map(params![category], row_to_tool_def)?;
    let defs = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(defs)
}

pub fn create_definition(
    pool: &DbPool,
    input: CreateToolDefinitionInput,
) -> Result<PersonaToolDefinition, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let is_builtin = input.is_builtin.unwrap_or(false) as i32;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_tool_definitions
         (id, name, category, description, script_path,
          input_schema, output_schema, requires_credential_type,
          implementation_guide, is_builtin,
          created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
        params![
            id,
            input.name,
            input.category,
            input.description,
            input.script_path,
            input.input_schema,
            input.output_schema,
            input.requires_credential_type,
            input.implementation_guide,
            is_builtin,
            now,
        ],
    )?;

    get_definition_by_id(pool, &id)
}

pub fn update_definition(
    pool: &DbPool,
    id: &str,
    input: UpdateToolDefinitionInput,
) -> Result<PersonaToolDefinition, AppError> {
    if let Some(ref name) = input.name {
        if name.trim().is_empty() {
            return Err(AppError::Validation("Name cannot be empty".into()));
        }
    }

    // Verify exists
    get_definition_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.name, "name", sets, param_idx);
    push_field!(input.category, "category", sets, param_idx);
    push_field!(input.description, "description", sets, param_idx);
    push_field!(input.script_path, "script_path", sets, param_idx);
    push_field!(input.input_schema, "input_schema", sets, param_idx);
    push_field!(input.output_schema, "output_schema", sets, param_idx);
    push_field!(input.requires_credential_type, "requires_credential_type", sets, param_idx);
    push_field!(input.implementation_guide, "implementation_guide", sets, param_idx);

    let sql = format!(
        "UPDATE persona_tool_definitions SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.name {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.category {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.description {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.script_path {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.input_schema {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.output_schema {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.requires_credential_type {
        param_values.push(Box::new(v.clone()));
    }
    if let Some(ref v) = input.implementation_guide {
        param_values.push(Box::new(v.clone()));
    }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_definition_by_id(pool, id)
}

pub fn delete_definition(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows =
        conn.execute("DELETE FROM persona_tool_definitions WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

pub fn get_tools_for_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<PersonaToolDefinition>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT d.* FROM persona_tool_definitions d
         INNER JOIN persona_tools pt ON pt.tool_id = d.id
         WHERE pt.persona_id = ?1
         ORDER BY d.category, d.name",
    )?;
    let rows = stmt.query_map(params![persona_id], row_to_tool_def)?;
    let defs = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(defs)
}

pub fn assign_tool(
    pool: &DbPool,
    persona_id: &str,
    tool_id: &str,
    tool_config: Option<String>,
) -> Result<PersonaTool, AppError> {
    // Validate tool_id exists before assigning
    get_definition_by_id(pool, tool_id)?;

    let conn = pool.get()?;

    // Return existing assignment if already present
    let existing: Option<PersonaTool> = conn
        .query_row(
            "SELECT id, persona_id, tool_id, tool_config, created_at
             FROM persona_tools WHERE persona_id = ?1 AND tool_id = ?2",
            params![persona_id, tool_id],
            |row| {
                Ok(PersonaTool {
                    id: row.get(0)?,
                    persona_id: row.get(1)?,
                    tool_id: row.get(2)?,
                    tool_config: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )
        .ok();

    if let Some(tool) = existing {
        return Ok(tool);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO persona_tools (id, persona_id, tool_id, tool_config, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, persona_id, tool_id, tool_config, now],
    )?;

    Ok(PersonaTool {
        id,
        persona_id: persona_id.to_string(),
        tool_id: tool_id.to_string(),
        tool_config,
        created_at: now,
    })
}

pub fn unassign_tool(pool: &DbPool, persona_id: &str, tool_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM persona_tools WHERE persona_id = ?1 AND tool_id = ?2",
        params![persona_id, tool_id],
    )?;
    Ok(rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_crud_tool_definitions() {
        let pool = init_test_db().unwrap();

        // Create
        let def = create_definition(
            &pool,
            CreateToolDefinitionInput {
                name: "my_custom_tool".into(),
                category: "custom".into(),
                description: "A custom tool for testing".into(),
                script_path: "/path/to/script.sh".into(),
                input_schema: Some(r#"{"type":"object"}"#.into()),
                output_schema: None,
                requires_credential_type: None,
                implementation_guide: None,
                is_builtin: Some(false),
            },
        )
        .unwrap();
        assert_eq!(def.name, "my_custom_tool");
        assert_eq!(def.category, "custom");
        assert!(!def.is_builtin);

        // Get by ID
        let fetched = get_definition_by_id(&pool, &def.id).unwrap();
        assert_eq!(fetched.description, "A custom tool for testing");

        // Get by category
        let by_cat = get_definitions_by_category(&pool, "custom").unwrap();
        assert_eq!(by_cat.len(), 1);

        // List all (includes builtins seeded by init_test_db)
        let all = get_all_definitions(&pool).unwrap();
        assert!(all.len() > 1);

        // Delete
        let deleted = delete_definition(&pool, &def.id).unwrap();
        assert!(deleted);
        assert!(get_definition_by_id(&pool, &def.id).is_err());
    }

    #[test]
    fn test_validation() {
        let pool = init_test_db().unwrap();
        let result = create_definition(
            &pool,
            CreateToolDefinitionInput {
                name: "".into(),
                category: "custom".into(),
                description: "desc".into(),
                script_path: "/path".into(),
                input_schema: None,
                output_schema: None,
                requires_credential_type: None,
                implementation_guide: None,
                is_builtin: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_assign_unassign_tool() {
        let pool = init_test_db().unwrap();

        // Create a persona first
        use crate::db::models::CreatePersonaInput;
        let persona = crate::db::repos::core::personas::create(
            &pool,
            CreatePersonaInput {
                name: "Tool Test Agent".into(),
                system_prompt: "You test tools.".into(),
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

        // Use a builtin tool definition
        let all_defs = get_all_definitions(&pool).unwrap();
        let builtin = &all_defs[0];

        // Assign
        let assignment = assign_tool(&pool, &persona.id, &builtin.id, None).unwrap();
        assert_eq!(assignment.persona_id, persona.id);
        assert_eq!(assignment.tool_id, builtin.id);

        // Get tools for persona
        let tools = get_tools_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].id, builtin.id);

        // Unassign
        let removed = unassign_tool(&pool, &persona.id, &builtin.id).unwrap();
        assert!(removed);

        let tools_after = get_tools_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(tools_after.len(), 0);
    }

    #[test]
    fn test_duplicate_assign_returns_existing() {
        let pool = init_test_db().unwrap();

        use crate::db::models::CreatePersonaInput;
        let persona = crate::db::repos::core::personas::create(
            &pool,
            CreatePersonaInput {
                name: "Dup Tool Agent".into(),
                system_prompt: "Test.".into(),
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

        let all_defs = get_all_definitions(&pool).unwrap();
        let builtin = &all_defs[0];

        let first = assign_tool(&pool, &persona.id, &builtin.id, None).unwrap();
        let second = assign_tool(&pool, &persona.id, &builtin.id, None).unwrap();

        // Should return the same assignment, not create a duplicate
        assert_eq!(first.id, second.id);

        // Only one row should exist
        let tools = get_tools_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(tools.len(), 1);
    }
}
