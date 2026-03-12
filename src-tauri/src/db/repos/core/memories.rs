use rusqlite::{params, Row};

use crate::db::models::{CreatePersonaMemoryInput, PersonaMemory};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

/// Strip HTML/XML tags from a string to prevent stored XSS.
///
/// This is a defence-in-depth measure: persona memory content is AI-generated
/// and could contain injected HTML payloads. We strip tags before persisting
/// to SQLite so that the data is safe regardless of how the frontend renders it.
fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut inside_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' if inside_tag => inside_tag = false,
            _ if !inside_tag => out.push(ch),
            _ => {} // skip characters inside tags
        }
    }
    out
}

/// Escape LIKE metacharacters (%, _) so they are matched literally.
fn escape_like(input: &str) -> String {
    input.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

fn build_memory_filters(
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
) -> (String, Vec<String>) {
    let mut conditions: Vec<String> = Vec::new();
    let mut param_values: Vec<String> = Vec::new();
    let mut param_idx = 1u32;

    if let Some(pid) = persona_id {
        conditions.push(format!("persona_id = ?{param_idx}"));
        param_values.push(pid.to_string());
        param_idx += 1;
    }
    if let Some(cat) = category {
        conditions.push(format!("category = ?{param_idx}"));
        param_values.push(cat.to_string());
        param_idx += 1;
    }
    if let Some(q) = search {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            let pattern = format!("%{}%", escape_like(trimmed));
            conditions.push(format!(
                "(title LIKE ?{} ESCAPE '\\' OR content LIKE ?{} ESCAPE '\\')",
                param_idx,
                param_idx + 1
            ));
            param_values.push(pattern.clone());
            param_values.push(pattern);
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    (where_clause, param_values)
}

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
    search: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PersonaMemory>, AppError> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    let conn = pool.get()?;

    let (where_clause, filter_params) = build_memory_filters(persona_id, category, search);
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = filter_params
        .into_iter()
        .map(|value| Box::new(value) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    let limit_idx = param_values.len() + 1;

    let sql = format!(
        "SELECT * FROM persona_memories {} ORDER BY created_at DESC LIMIT ?{} OFFSET ?{}",
        where_clause,
        limit_idx,
        limit_idx + 1
    );

    param_values.push(Box::new(limit));
    param_values.push(Box::new(offset));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), row_to_memory)?;
    let results: Vec<PersonaMemory> = collect_rows(rows, "memories::get_all");
    Ok(results)
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
    let results: Vec<PersonaMemory> = collect_rows(rows, "memories::get_by_persona");
    Ok(results)
}

pub fn get_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<PersonaMemory>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_memories WHERE source_execution_id = ?1
         ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![execution_id], row_to_memory)?;
    let results: Vec<PersonaMemory> = collect_rows(rows, "memories::get_by_execution");
    Ok(results)
}

pub fn create(pool: &DbPool, input: CreatePersonaMemoryInput) -> Result<PersonaMemory, AppError> {
    let title = strip_html_tags(&input.title);
    let content = strip_html_tags(&input.content);

    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    if content.trim().is_empty() {
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
            title,
            content,
            category,
            input.source_execution_id,
            importance,
            input.tags,
            now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn get_total_count(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
) -> Result<i64, AppError> {
    let conn = pool.get()?;

    let (where_clause, filter_params) = build_memory_filters(persona_id, category, search);

    let sql = format!("SELECT COUNT(*) FROM persona_memories {where_clause}");
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = filter_params
        .iter()
        .map(|value| value as &dyn rusqlite::types::ToSql)
        .collect();

    let count: i64 = conn.query_row(&sql, params_ref.as_slice(), |row| row.get(0))?;
    Ok(count)
}

/// Aggregated memory statistics computed over the full dataset (not paginated).
#[derive(Debug, serde::Serialize)]
pub struct MemoryStats {
    pub total: i64,
    pub avg_importance: f64,
    /// (category, count) pairs for every category that has at least one memory.
    pub category_counts: Vec<(String, i64)>,
    /// (persona_id, count) pairs for every persona that owns at least one memory.
    pub agent_counts: Vec<(String, i64)>,
}

/// Return aggregate stats over the full (filtered) memory dataset.
pub fn get_stats(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
) -> Result<MemoryStats, AppError> {
    let conn = pool.get()?;

    let (where_clause, filter_params) = build_memory_filters(persona_id, category, search);
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = filter_params
        .iter()
        .map(|value| value as &dyn rusqlite::types::ToSql)
        .collect();

    // Total + avg importance in one query
    let agg_sql = format!(
        "SELECT COUNT(*), COALESCE(AVG(importance), 0) FROM persona_memories {where_clause}"
    );
    let (total, avg_importance): (i64, f64) =
        conn.query_row(&agg_sql, params_ref.as_slice(), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;

    // Category breakdown
    let cat_sql = format!(
        "SELECT category, COUNT(*) as cnt FROM persona_memories {where_clause} GROUP BY category ORDER BY cnt DESC"
    );
    let mut cat_stmt = conn.prepare(&cat_sql)?;
    let category_rows = cat_stmt
        .query_map(params_ref.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?;
    let category_counts: Vec<(String, i64)> =
        collect_rows(category_rows, "memories::get_stats/category_counts");

    // Agent breakdown
    let agent_sql = format!(
        "SELECT persona_id, COUNT(*) as cnt FROM persona_memories {where_clause} GROUP BY persona_id ORDER BY cnt DESC"
    );
    let mut agent_stmt = conn.prepare(&agent_sql)?;
    let agent_rows = agent_stmt
        .query_map(params_ref.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?;
    let agent_counts: Vec<(String, i64)> =
        collect_rows(agent_rows, "memories::get_stats/agent_counts");

    Ok(MemoryStats {
        total,
        avg_importance,
        category_counts,
        agent_counts,
    })
}

/// Combined result of list + count + stats in a single DB connection.
#[derive(Debug, serde::Serialize)]
pub struct MemoriesWithStats {
    pub memories: Vec<PersonaMemory>,
    pub total: i64,
    pub stats: MemoryStats,
}

/// Fetch memories, total count, and aggregate stats in a single DB connection.
/// Replaces three separate IPC calls with one.
pub fn get_all_with_stats(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<MemoriesWithStats, AppError> {
    let limit_val = limit.unwrap_or(50);
    let offset_val = offset.unwrap_or(0);

    let conn = pool.get()?;
    let (where_clause, filter_params) = build_memory_filters(persona_id, category, search);
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = filter_params
        .iter()
        .map(|value| value as &dyn rusqlite::types::ToSql)
        .collect();

    // 1. Total count + avg importance
    let agg_sql = format!(
        "SELECT COUNT(*), COALESCE(AVG(importance), 0) FROM persona_memories {where_clause}"
    );
    let (total, avg_importance): (i64, f64) =
        conn.query_row(&agg_sql, params_ref.as_slice(), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;

    // 2. Category breakdown
    let cat_sql = format!(
        "SELECT category, COUNT(*) as cnt FROM persona_memories {where_clause} GROUP BY category ORDER BY cnt DESC"
    );
    let mut cat_stmt = conn.prepare(&cat_sql)?;
    let category_rows = cat_stmt
        .query_map(params_ref.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?;
    let category_counts: Vec<(String, i64)> =
        collect_rows(category_rows, "memories::get_all_with_stats/category_counts");

    // 3. Agent breakdown
    let agent_sql = format!(
        "SELECT persona_id, COUNT(*) as cnt FROM persona_memories {where_clause} GROUP BY persona_id ORDER BY cnt DESC"
    );
    let mut agent_stmt = conn.prepare(&agent_sql)?;
    let agent_rows = agent_stmt
        .query_map(params_ref.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?;
    let agent_counts: Vec<(String, i64)> =
        collect_rows(agent_rows, "memories::get_all_with_stats/agent_counts");

    // 4. Paginated memories
    let mut mem_params: Vec<Box<dyn rusqlite::types::ToSql>> = filter_params
        .into_iter()
        .map(|v| Box::new(v) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    let limit_idx = mem_params.len() + 1;
    let mem_sql = format!(
        "SELECT * FROM persona_memories {} ORDER BY created_at DESC LIMIT ?{} OFFSET ?{}",
        where_clause,
        limit_idx,
        limit_idx + 1
    );
    mem_params.push(Box::new(limit_val));
    mem_params.push(Box::new(offset_val));
    let mem_params_ref: Vec<&dyn rusqlite::types::ToSql> =
        mem_params.iter().map(|p| p.as_ref()).collect();
    let mut mem_stmt = conn.prepare(&mem_sql)?;
    let mem_rows = mem_stmt.query_map(mem_params_ref.as_slice(), row_to_memory)?;
    let memories: Vec<PersonaMemory> = collect_rows(mem_rows, "memories::get_all_with_stats");

    Ok(MemoriesWithStats {
        memories,
        total,
        stats: MemoryStats {
            total,
            avg_importance,
            category_counts,
            agent_counts,
        },
    })
}

pub fn update_importance(pool: &DbPool, id: &str, importance: i32) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE persona_memories SET importance = ?1, updated_at = ?2 WHERE id = ?3",
        params![importance, now, id],
    )?;
    Ok(rows > 0)
}

pub fn batch_delete(pool: &DbPool, ids: &[String]) -> Result<i64, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let conn = pool.get()?;
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "DELETE FROM persona_memories WHERE id IN ({})",
        placeholders.join(", ")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> =
        ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
    let rows = conn.execute(&sql, params.as_slice())?;
    Ok(rows as i64)
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
    use crate::db::repos::core::personas;

    #[test]
    fn test_strip_html_tags() {
        assert_eq!(strip_html_tags("hello world"), "hello world");
        assert_eq!(strip_html_tags("<b>bold</b>"), "bold");
        assert_eq!(
            strip_html_tags("<img src=x onerror=alert(1)>payload"),
            "payload"
        );
        assert_eq!(
            strip_html_tags("<script>alert('xss')</script>safe text"),
            "alert('xss')safe text"
        );
        assert_eq!(strip_html_tags("no < tags > here"), "no  here");
        assert_eq!(strip_html_tags(""), "");
        assert_eq!(strip_html_tags("a < b and c > d"), "a  d");
    }

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
                notification_channels: None,
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
        let all = get_all(&pool, None, None, None, None, None).unwrap();
        assert_eq!(all.len(), 2);

        // Get all filtered by persona_id
        let by_persona = get_all(&pool, Some(&persona.id), None, None, None, None).unwrap();
        assert_eq!(by_persona.len(), 2);

        // Get all filtered by category
        let by_category = get_all(&pool, None, Some("preference"), None, None, None).unwrap();
        assert_eq!(by_category.len(), 1);
        assert_eq!(by_category[0].title, "User prefers dark mode");

        // Get all with limit
        let limited = get_all(&pool, None, None, None, Some(1), None).unwrap();
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

        let remaining = get_all(&pool, None, None, None, None, None).unwrap();
        assert_eq!(remaining.len(), 1);
    }
}
