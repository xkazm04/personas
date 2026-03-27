use rusqlite::params;

use crate::db::models::{CreatePersonaMemoryInput, PersonaMemory, validate_importance, validate_category, DEFAULT_MEMORY_CATEGORY};
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

/// Normalize tags to a canonical JSON array string.
///
/// Accepts either a JSON array (e.g. `["a","b"]`) or comma-separated
/// values (e.g. `"a,b"`) and always returns a JSON array string.
fn normalize_tags(raw: Option<String>) -> Option<String> {
    let raw = raw?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // If it already parses as a JSON array of strings, pass through
    if let Ok(arr) = serde_json::from_str::<Vec<String>>(trimmed) {
        return Some(serde_json::to_string(&arr).unwrap_or_default());
    }
    // Otherwise treat as comma-separated
    let tags: Vec<String> = trimmed
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if tags.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&tags).unwrap_or_default())
    }
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

row_mapper!(row_to_memory -> PersonaMemory {
    id, persona_id, title, content, category,
    source_execution_id, importance, tags,
    created_at, updated_at,
});

/// Map user-provided sort column to a safe SQL column name.
fn validated_sort_column(col: Option<&str>) -> &str {
    match col {
        Some("importance") => "importance",
        Some("title") => "title",
        Some("category") => "category",
        Some("updated_at") => "updated_at",
        // Default to created_at
        _ => "created_at",
    }
}

fn validated_sort_direction(dir: Option<&str>) -> &str {
    match dir {
        Some(d) if d.eq_ignore_ascii_case("asc") => "ASC",
        _ => "DESC",
    }
}

#[allow(clippy::too_many_arguments)]
pub fn get_all(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort_column: Option<&str>,
    sort_direction: Option<&str>,
) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!("persona_memories", "persona_memories::get_all", {
        let limit = limit.unwrap_or(50);
        let offset = offset.unwrap_or(0);
        let order_col = validated_sort_column(sort_column);
        let order_dir = validated_sort_direction(sort_direction);

        let conn = pool.get()?;

        let (where_clause, filter_params) = build_memory_filters(persona_id, category, search);
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = filter_params
            .into_iter()
            .map(|value| Box::new(value) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        let limit_idx = param_values.len() + 1;

        let sql = format!(
            "SELECT * FROM persona_memories {} ORDER BY {} {} LIMIT ?{} OFFSET ?{}",
            where_clause,
            order_col,
            order_dir,
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
    })
}

/// Bulk-fetch all memories for multiple persona IDs in a single query.
pub fn get_all_by_persona_ids(
    pool: &DbPool,
    persona_ids: &[String],
) -> Result<Vec<PersonaMemory>, AppError> {
    if persona_ids.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!("persona_memories", "persona_memories::get_all_by_persona_ids", {
        let conn = pool.get()?;
        let placeholders: Vec<String> = persona_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT * FROM persona_memories WHERE persona_id IN ({}) ORDER BY created_at DESC",
            placeholders.join(", ")
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = persona_ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), row_to_memory)?;
        Ok(collect_rows(rows, "memories::get_all_by_persona_ids"))
    })
}

crud_get_by_id!(PersonaMemory, "persona_memories", "PersonaMemory", row_to_memory);

pub fn get_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!("persona_memories", "persona_memories::get_by_persona", {
        let limit = limit.unwrap_or(50);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_memories WHERE persona_id = ?1
             ORDER BY importance DESC, created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![persona_id, limit], row_to_memory)?;
        let results: Vec<PersonaMemory> = collect_rows(rows, "memories::get_by_persona");
        Ok(results)
    })
}

pub fn get_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!("persona_memories", "persona_memories::get_by_execution", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_memories WHERE source_execution_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![execution_id], row_to_memory)?;
        let results: Vec<PersonaMemory> = collect_rows(rows, "memories::get_by_execution");
        Ok(results)
    })
}

/// Count memories linked to a specific execution (used for post-mortem dedup check).
pub fn count_by_execution(pool: &DbPool, execution_id: &str) -> Result<i64, AppError> {
    timed_query!("persona_memories", "persona_memories::count_by_execution", {
        let conn = pool.get()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM persona_memories WHERE source_execution_id = ?1",
            params![execution_id],
            |row| row.get(0),
        )?;
        Ok(count)
    })
}

pub fn create(pool: &DbPool, input: CreatePersonaMemoryInput) -> Result<PersonaMemory, AppError> {
    timed_query!("persona_memories", "persona_memories::create", {
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
        let category = input.category.as_deref().unwrap_or(DEFAULT_MEMORY_CATEGORY);
        validate_category(category)?;
        let category = category.to_string();
        let importance = match input.importance {
            Some(v) => validate_importance(v)?,
            None => 3,
        };

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
                normalize_tags(input.tags),
                now,
            ],
        )?;

        get_by_id(pool, &id)
    })
}

pub fn get_total_count(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
) -> Result<i64, AppError> {
    timed_query!("persona_memories", "persona_memories::get_total_count", {
        let conn = pool.get()?;

        let (where_clause, filter_params) = build_memory_filters(persona_id, category, search);

        let sql = format!("SELECT COUNT(*) FROM persona_memories {where_clause}");
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = filter_params
            .iter()
            .map(|value| value as &dyn rusqlite::types::ToSql)
            .collect();

        let count: i64 = conn.query_row(&sql, params_ref.as_slice(), |row| row.get(0))?;
        Ok(count)
    })
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

/// Compute aggregate stats on a single connection using pre-built filter clause and params.
fn compute_memory_stats(
    conn: &rusqlite::Connection,
    where_clause: &str,
    params_ref: &[&dyn rusqlite::types::ToSql],
) -> Result<MemoryStats, AppError> {
    // Total + avg importance in one query
    let agg_sql = format!(
        "SELECT COUNT(*), COALESCE(AVG(importance), 0) FROM persona_memories {where_clause}"
    );
    let (total, avg_importance): (i64, f64) =
        conn.query_row(&agg_sql, params_ref, |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;

    // Category breakdown
    let cat_sql = format!(
        "SELECT category, COUNT(*) as cnt FROM persona_memories {where_clause} GROUP BY category ORDER BY cnt DESC"
    );
    let mut cat_stmt = conn.prepare(&cat_sql)?;
    let category_rows = cat_stmt
        .query_map(params_ref, |row| Ok((row.get(0)?, row.get(1)?)))?;
    let category_counts: Vec<(String, i64)> =
        collect_rows(category_rows, "memories::compute_memory_stats/category_counts");

    // Agent breakdown
    let agent_sql = format!(
        "SELECT persona_id, COUNT(*) as cnt FROM persona_memories {where_clause} GROUP BY persona_id ORDER BY cnt DESC"
    );
    let mut agent_stmt = conn.prepare(&agent_sql)?;
    let agent_rows = agent_stmt
        .query_map(params_ref, |row| Ok((row.get(0)?, row.get(1)?)))?;
    let agent_counts: Vec<(String, i64)> =
        collect_rows(agent_rows, "memories::compute_memory_stats/agent_counts");

    Ok(MemoryStats {
        total,
        avg_importance,
        category_counts,
        agent_counts,
    })
}

/// Return aggregate stats over the full (filtered) memory dataset.
pub fn get_stats(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
) -> Result<MemoryStats, AppError> {
    timed_query!("persona_memories", "persona_memories::get_stats", {
        let conn = pool.get()?;
        let (where_clause, filter_params) = build_memory_filters(persona_id, category, search);
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = filter_params
            .iter()
            .map(|value| value as &dyn rusqlite::types::ToSql)
            .collect();
        compute_memory_stats(&conn, &where_clause, &params_ref)
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
#[allow(clippy::too_many_arguments)]
pub fn get_all_with_stats(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort_column: Option<&str>,
    sort_direction: Option<&str>,
) -> Result<MemoriesWithStats, AppError> {
    timed_query!("persona_memories", "persona_memories::get_all_with_stats", {
        let limit_val = limit.unwrap_or(50);
        let offset_val = offset.unwrap_or(0);
        let order_col = validated_sort_column(sort_column);
        let order_dir = validated_sort_direction(sort_direction);

        let conn = pool.get()?;
        let (where_clause, filter_params) = build_memory_filters(persona_id, category, search);
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = filter_params
            .iter()
            .map(|value| value as &dyn rusqlite::types::ToSql)
            .collect();

        let stats = compute_memory_stats(&conn, &where_clause, &params_ref)?;
        let total = stats.total;

        // Paginated memories
        let mut mem_params: Vec<Box<dyn rusqlite::types::ToSql>> = filter_params
            .into_iter()
            .map(|v| Box::new(v) as Box<dyn rusqlite::types::ToSql>)
            .collect();
        let limit_idx = mem_params.len() + 1;
        let mem_sql = format!(
            "SELECT * FROM persona_memories {} ORDER BY {} {} LIMIT ?{} OFFSET ?{}",
            where_clause,
            order_col,
            order_dir,
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
            stats,
        })
    })
}

pub fn update_importance(pool: &DbPool, id: &str, importance: i32) -> Result<bool, AppError> {
    timed_query!("persona_memories", "persona_memories::update_importance", {
        validate_importance(importance)?;
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE persona_memories SET importance = ?1, updated_at = ?2 WHERE id = ?3",
            params![importance, now, id],
        )?;
        Ok(rows > 0)
    })
}

pub fn batch_delete(pool: &DbPool, ids: &[String]) -> Result<i64, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    timed_query!("persona_memories", "persona_memories::batch_delete", {
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
    })
}

crud_delete!("persona_memories");

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
        assert_eq!(fetched.tags, Some("[\"ui\",\"preference\"]".into()));

        // Get all (no filters)
        let all = get_all(&pool, None, None, None, None, None, None, None).unwrap();
        assert_eq!(all.len(), 2);

        // Get all filtered by persona_id
        let by_persona = get_all(&pool, Some(&persona.id), None, None, None, None, None, None).unwrap();
        assert_eq!(by_persona.len(), 2);

        // Get all filtered by category
        let by_category = get_all(&pool, None, Some("preference"), None, None, None, None, None).unwrap();
        assert_eq!(by_category.len(), 1);
        assert_eq!(by_category[0].title, "User prefers dark mode");

        // Get all with limit
        let limited = get_all(&pool, None, None, None, Some(1), None, None, None).unwrap();
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

        let remaining = get_all(&pool, None, None, None, None, None, None, None).unwrap();
        assert_eq!(remaining.len(), 1);
    }

    #[test]
    fn test_importance_boundary_validation() {
        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Boundary Agent".into(),
                system_prompt: "test".into(),
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

        let make_input = |importance: Option<i32>| CreatePersonaMemoryInput {
            persona_id: persona.id.clone(),
            title: "test".into(),
            content: "test content".into(),
            category: None,
            source_execution_id: None,
            importance,
            tags: None,
        };

        // Valid boundaries
        assert!(create(&pool, make_input(Some(1))).is_ok());
        assert!(create(&pool, make_input(Some(5))).is_ok());
        assert!(create(&pool, make_input(None)).is_ok()); // defaults to 3

        // Out-of-range values rejected
        assert!(create(&pool, make_input(Some(0))).is_err());
        assert!(create(&pool, make_input(Some(6))).is_err());
        assert!(create(&pool, make_input(Some(-1))).is_err());
        assert!(create(&pool, make_input(Some(999))).is_err());

        // update_importance boundaries
        let m = create(&pool, make_input(Some(3))).unwrap();
        assert!(update_importance(&pool, &m.id, 1).is_ok());
        assert!(update_importance(&pool, &m.id, 5).is_ok());
        assert!(update_importance(&pool, &m.id, 0).is_err());
        assert!(update_importance(&pool, &m.id, 6).is_err());
        assert!(update_importance(&pool, &m.id, -1).is_err());
    }
}
