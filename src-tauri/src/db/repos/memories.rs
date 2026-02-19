use rusqlite::{params, Row};

use crate::db::models::{CreatePersonaMemoryInput, PersonaMemory};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_memory(row: &Row) -> rusqlite::Result<PersonaMemory> {
    Ok(PersonaMemory {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        title: row.get("title")?,
        content: row.get("content")?,
        category: row.get("category")?,
        source_execution_id: row.get("source_execution_id")?,
        importance: row.get("importance")?,
        tags: row.get("tags")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn get_all(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PersonaMemory>, AppError> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    let conn = pool.get()?;

    let mut conditions: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1u32;

    if let Some(pid) = persona_id {
        conditions.push(format!("persona_id = ?{}", param_idx));
        param_values.push(Box::new(pid.to_string()));
        param_idx += 1;
    }
    if let Some(cat) = category {
        conditions.push(format!("category = ?{}", param_idx));
        param_values.push(Box::new(cat.to_string()));
        param_idx += 1;
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT * FROM persona_memories {} ORDER BY created_at DESC LIMIT ?{} OFFSET ?{}",
        where_clause,
        param_idx,
        param_idx + 1
    );

    param_values.push(Box::new(limit));
    param_values.push(Box::new(offset));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), row_to_memory)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaMemory, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_memories WHERE id = ?1",
        params![id],
        row_to_memory,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("PersonaMemory {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaMemory>, AppError> {
    let limit = limit.unwrap_or(50);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_memories WHERE persona_id = ?1
         ORDER BY importance DESC, created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], row_to_memory)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create(pool: &DbPool, input: CreatePersonaMemoryInput) -> Result<PersonaMemory, AppError> {
    if input.title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    if input.content.trim().is_empty() {
        return Err(AppError::Validation("Content cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let category = input.category.unwrap_or_else(|| "fact".into());
    let importance = input.importance.unwrap_or(3);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_memories
         (id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            input.persona_id,
            input.title,
            input.content,
            category,
            input.source_execution_id,
            importance,
            input.tags,
            now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM persona_memories WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreatePersonaInput, CreatePersonaMemoryInput};
    use crate::db::repos::personas;

    #[test]
    fn test_memory_crud() {
        let pool = init_test_db().unwrap();

        // Create a persona first (required as parent)
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Memory Agent".into(),
                system_prompt: "You remember things.".into(),
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

        // Create memories
        let m1 = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "User prefers dark mode".into(),
                content: "The user mentioned they always use dark mode.".into(),
                category: Some("preference".into()),
                source_execution_id: None,
                importance: Some(5),
                tags: Some("ui,preference".into()),
            },
        )
        .unwrap();
        assert_eq!(m1.title, "User prefers dark mode");
        assert_eq!(m1.category, "preference");
        assert_eq!(m1.importance, 5);

        let m2 = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "Project uses Rust".into(),
                content: "The project backend is written in Rust.".into(),
                category: None, // defaults to "fact"
                source_execution_id: None,
                importance: None, // defaults to 3
                tags: None,
            },
        )
        .unwrap();
        assert_eq!(m2.category, "fact");
        assert_eq!(m2.importance, 3);

        // Read by id
        let fetched = get_by_id(&pool, &m1.id).unwrap();
        assert_eq!(fetched.title, "User prefers dark mode");
        assert_eq!(fetched.tags, Some("ui,preference".into()));

        // Get all (no filters)
        let all = get_all(&pool, None, None, None, None).unwrap();
        assert_eq!(all.len(), 2);

        // Get all filtered by persona_id
        let by_persona = get_all(&pool, Some(&persona.id), None, None, None).unwrap();
        assert_eq!(by_persona.len(), 2);

        // Get all filtered by category
        let by_category = get_all(&pool, None, Some("preference"), None, None).unwrap();
        assert_eq!(by_category.len(), 1);
        assert_eq!(by_category[0].title, "User prefers dark mode");

        // Get all with limit
        let limited = get_all(&pool, None, None, Some(1), None).unwrap();
        assert_eq!(limited.len(), 1);

        // Get by persona (ordered by importance DESC)
        let by_persona_sorted = get_by_persona(&pool, &persona.id, None).unwrap();
        assert_eq!(by_persona_sorted.len(), 2);
        assert_eq!(by_persona_sorted[0].title, "User prefers dark mode"); // importance 5
        assert_eq!(by_persona_sorted[1].title, "Project uses Rust"); // importance 3

        // Delete
        let deleted = delete(&pool, &m1.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &m1.id).is_err());

        let remaining = get_all(&pool, None, None, None, None).unwrap();
        assert_eq!(remaining.len(), 1);
    }
}
