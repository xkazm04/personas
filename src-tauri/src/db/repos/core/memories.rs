use rusqlite::params;

use crate::db::models::{CreatePersonaMemoryInput, PersonaMemory, validate_importance, validate_category, DEFAULT_MEMORY_CATEGORY};
use crate::db::query_builder::QueryBuilder;
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

/// Strip HTML/XML tags from a string to prevent stored XSS.
///
/// This is a defence-in-depth measure: persona memory content is AI-generated
/// and could contain injected HTML payloads. We strip tags before persisting
/// to SQLite so that the data is safe regardless of how the frontend renders it.
///
/// Uses the `ammonia` crate to properly distinguish real HTML tags from
/// legitimate text containing `<` / `>` (e.g. math expressions, code snippets).
/// After stripping, HTML entities are decoded back so stored content remains
/// human-readable (the frontend renders as plain text, not raw HTML).
fn strip_html_tags(input: &str) -> String {
    let cleaned = ammonia::Builder::new()
        .tags(std::collections::HashSet::new())
        .clean(input)
        .to_string();
    // Decode entities that ammonia introduced for non-tag angle brackets.
    // Order matters: &amp; must be last so we don't double-decode.
    cleaned
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
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
) -> QueryBuilder {
    let mut qb = QueryBuilder::new();

    if let Some(pid) = persona_id {
        qb.where_eq("persona_id", pid.to_string());
    }
    if let Some(cat) = category {
        qb.where_eq("category", cat.to_string());
    }
    if let Some(q) = search {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            let pattern = format!("%{}%", escape_like(trimmed));
            qb.where_like_escape_any(&["title", "content"], pattern);
        }
    }

    qb
}

row_mapper!(row_to_memory -> PersonaMemory {
    id, persona_id, title, content, category,
    source_execution_id, importance, tags,
    tier [opt_str],
    access_count [opt_i32],
    last_accessed_at [opt],
    created_at, updated_at,
    use_case_id [opt],
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

        let mut qb = build_memory_filters(persona_id, category, search);
        qb.order_by(order_col, order_dir);
        qb.limit(limit);
        qb.offset(offset);

        let sql = qb.build_select("SELECT * FROM persona_memories");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_memory)?;
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
        let mut qb = QueryBuilder::new();
        qb.where_in("persona_id", persona_ids.iter().map(|s| s.to_string()).collect());
        qb.order_by("created_at", "DESC");
        let sql = qb.build_select("SELECT * FROM persona_memories");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_memory)?;
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
             (id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at, use_case_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)",
            params![
                id,
                input.persona_id,
                title,
                content,
                category,
                input.source_execution_id,
                importance,
                normalize_tags(input.tags.map(|j| serde_json::to_string(&j.0).unwrap_or_default())),
                now,
                input.use_case_id,
            ],
        )?;

        get_by_id(pool, &id)
    })
}

/// Insert multiple memories in a single transaction without read-back.
/// Returns the number of successfully inserted rows.
pub fn batch_create(pool: &DbPool, inputs: Vec<CreatePersonaMemoryInput>) -> Result<i64, AppError> {
    if inputs.is_empty() {
        return Ok(0);
    }
    timed_query!("persona_memories", "persona_memories::batch_create", {
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut count: i64 = 0;

        {
            let mut stmt = tx.prepare(
                "INSERT INTO persona_memories
                 (id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at, use_case_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)",
            )?;

            for input in inputs {
                let title = strip_html_tags(&input.title);
                let content = strip_html_tags(&input.content);
                if title.trim().is_empty() || content.trim().is_empty() {
                    continue;
                }
                let id = uuid::Uuid::new_v4().to_string();
                let category = input.category.as_deref().unwrap_or(DEFAULT_MEMORY_CATEGORY);
                if validate_category(category).is_err() {
                    continue;
                }
                let category = category.to_string();
                let importance = match input.importance {
                    Some(v) => match validate_importance(v) {
                        Ok(v) => v,
                        Err(_) => 3,
                    },
                    None => 3,
                };

                stmt.execute(params![
                    id,
                    input.persona_id,
                    title,
                    content,
                    category,
                    input.source_execution_id,
                    importance,
                    normalize_tags(input.tags.map(|j| serde_json::to_string(&j.0).unwrap_or_default())),
                    now,
                    input.use_case_id,
                ])?;
                count += 1;
            }
        }

        tx.commit()?;
        Ok(count)
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

        let qb = build_memory_filters(persona_id, category, search);
        let sql = format!("SELECT COUNT(*) FROM persona_memories {}", qb.where_clause());
        let count: i64 = conn.query_row(&sql, qb.params_ref().as_slice(), |row| row.get(0))?;
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
        let qb = build_memory_filters(persona_id, category, search);
        compute_memory_stats(&conn, &qb.where_clause(), &qb.params_ref())
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
        let filter_qb = build_memory_filters(persona_id, category, search);
        let where_clause = filter_qb.where_clause();
        let stats = compute_memory_stats(&conn, &where_clause, &filter_qb.params_ref())?;
        let total = stats.total;

        // Paginated memories — build a new QB with same filters + pagination
        let mut qb = build_memory_filters(persona_id, category, search);
        qb.order_by(order_col, order_dir);
        qb.limit(limit_val);
        qb.offset(offset_val);

        let mem_sql = qb.build_select("SELECT * FROM persona_memories");
        let mut mem_stmt = conn.prepare(&mem_sql)?;
        let mem_rows = mem_stmt.query_map(qb.params_ref().as_slice(), row_to_memory)?;
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

/// Batch-update importance for multiple memories in a single transaction.
/// Each tuple is (id, new_importance).
pub fn batch_update_importance(pool: &DbPool, updates: &[(String, i32)]) -> Result<i64, AppError> {
    if updates.is_empty() {
        return Ok(0);
    }
    timed_query!("persona_memories", "persona_memories::batch_update_importance", {
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut total_updated: i64 = 0;

        for (_id, importance) in updates {
            validate_importance(*importance)?;
        }

        let mut stmt = tx.prepare(
            "UPDATE persona_memories SET importance = ?1, updated_at = ?2 WHERE id = ?3",
        )?;
        for (id, importance) in updates {
            let rows = stmt.execute(params![importance, now, id])?;
            total_updated += rows as i64;
        }
        drop(stmt);

        tx.commit()?;
        Ok(total_updated)
    })
}

pub fn batch_delete(pool: &DbPool, ids: &[String]) -> Result<i64, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    timed_query!("persona_memories", "persona_memories::batch_delete", {
        // SQLite has a default SQLITE_MAX_VARIABLE_NUMBER of 999.
        // Chunk deletes into batches of 500 to stay well under the limit.
        const CHUNK_SIZE: usize = 500;
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let mut total_deleted: i64 = 0;

        for chunk in ids.chunks(CHUNK_SIZE) {
            let mut qb = QueryBuilder::new();
            qb.where_in("id", chunk.iter().map(|s| s.to_string()).collect());
            let sql = format!("DELETE FROM persona_memories {}", qb.where_clause());
            let rows = tx.execute(&sql, qb.params_ref().as_slice())?;
            total_deleted += rows as i64;
        }

        tx.commit()?;
        Ok(total_deleted)
    })
}

crud_delete!("persona_memories");

// -- Tier management ----------------------------------------------------------

/// Update the tier of a single memory.
pub fn update_tier(pool: &DbPool, id: &str, tier: &str) -> Result<bool, AppError> {
    // Validate tier value
    match tier {
        "core" | "active" | "working" | "archive" => {}
        _ => {
            return Err(AppError::Validation(format!(
                "Invalid tier '{tier}'. Valid tiers: core, active, working, archive"
            )));
        }
    }
    timed_query!("persona_memories", "persona_memories::update_tier", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE persona_memories SET tier = ?1, updated_at = ?2 WHERE id = ?3",
            params![tier, now, id],
        )?;
        Ok(rows > 0)
    })
}

/// Result of `get_for_injection` — memories split by tier for prompt injection.
#[derive(Debug)]
pub struct TieredMemories {
    /// Core memories: always injected (stable beliefs / preferences).
    pub core: Vec<PersonaMemory>,
    /// Active memories: scored and selected for injection.
    pub active: Vec<PersonaMemory>,
}

/// Fetch memories suitable for injection into a prompt, split by tier.
///
/// * `core_limit` — max number of core-tier memories to return.
/// * `active_limit` — max number of active-tier memories to return (scored by
///   importance DESC, access_count DESC, created_at DESC).
///
/// **Note:** `get_for_injection` is the persona-wide entry point used by
/// non-capability runs. Capability-aware execution should call
/// [`get_for_injection_v2`] which scopes active/working memories by use_case.
pub fn get_for_injection(
    pool: &DbPool,
    persona_id: &str,
    core_limit: i64,
    active_limit: i64,
) -> Result<TieredMemories, AppError> {
    get_for_injection_v2(pool, persona_id, None, core_limit, active_limit)
}

/// Phase C5 — capability-aware memory fetch for prompt injection.
///
/// Tier rules:
/// - **Core** memories are always persona-wide regardless of `use_case_id`.
///   They define stable identity/principles and should be injected on every
///   execution.
/// - **Active / working** memories are scoped:
///   - When `use_case_id = Some(uc)`, fetch rows where
///     `use_case_id = uc OR use_case_id IS NULL` (capability-scoped + global).
///   - When `use_case_id = None`, fetch only persona-wide rows
///     (`use_case_id IS NULL`).
///
/// Ordering: importance DESC, access_count DESC, created_at DESC for active;
/// importance DESC, created_at DESC for core.
pub fn get_for_injection_v2(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: Option<&str>,
    core_limit: i64,
    active_limit: i64,
) -> Result<TieredMemories, AppError> {
    timed_query!("persona_memories", "persona_memories::get_for_injection_v2", {
        let conn = pool.get()?;

        // Active-tier scope predicate depends on whether a capability is set.
        // Inlining the column comparison (rather than using a parameter) keeps
        // the prepared-statement signature stable across the two branches.
        let (active_scope_sql, active_uc_param): (&str, Option<&str>) = match use_case_id {
            Some(uc) => ("AND (use_case_id = ?4 OR use_case_id IS NULL)", Some(uc)),
            None => ("AND use_case_id IS NULL", None),
        };

        let sql = format!(
            "SELECT * FROM (
                 SELECT * FROM persona_memories
                 WHERE persona_id = ?1 AND tier = 'core'
                 ORDER BY importance DESC, created_at DESC
                 LIMIT ?2
             )
             UNION ALL
             SELECT * FROM (
                 SELECT * FROM persona_memories
                 WHERE persona_id = ?1 AND tier IN ('active', 'working')
                 {active_scope_sql}
                 ORDER BY importance DESC, access_count DESC, created_at DESC
                 LIMIT ?3
             )"
        );

        let mut stmt = conn.prepare(&sql)?;
        let all: Vec<PersonaMemory> = if let Some(uc) = active_uc_param {
            let rows = stmt.query_map(
                params![persona_id, core_limit, active_limit, uc],
                row_to_memory,
            )?;
            collect_rows(rows, "memories::get_for_injection_v2(scoped)")
        } else {
            let rows = stmt.query_map(
                params![persona_id, core_limit, active_limit],
                row_to_memory,
            )?;
            collect_rows(rows, "memories::get_for_injection_v2(unscoped)")
        };

        let (core, active) = all.into_iter().partition(|m| m.tier == "core");

        Ok(TieredMemories { core, active })
    })
}

/// Fetch memories attributed to a specific capability (use case) on a persona.
/// Phase C5 — capability-scoped memory editor view.
pub fn get_by_use_case_id(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!("persona_memories", "persona_memories::get_by_use_case_id", {
        let limit = limit.unwrap_or(100);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_memories
             WHERE persona_id = ?1 AND use_case_id = ?2
             ORDER BY importance DESC, created_at DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, use_case_id, limit], row_to_memory)?;
        Ok(collect_rows(rows, "memories::get_by_use_case_id"))
    })
}

/// Increment access_count and update last_accessed_at for a batch of memory IDs.
pub fn increment_access_batch(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    timed_query!("persona_memories", "persona_memories::increment_access_batch", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut qb = QueryBuilder::new();
        let p_now1 = qb.push_param(now.clone());
        let p_now2 = qb.push_param(now);
        qb.where_in("id", ids.to_vec());
        let sql = format!(
            "UPDATE persona_memories SET access_count = access_count + 1, last_accessed_at = {p_now1}, updated_at = {p_now2} {}",
            qb.where_clause()
        );
        conn.execute(&sql, qb.params_ref().as_slice())?;
        Ok(())
    })
}

/// Run automatic memory lifecycle transitions for a persona.
///
/// - **Promote**: working-tier memories with access_count >= 5 are promoted to "active".
/// - **Archive**: working-tier memories older than 30 days with access_count == 0
///   are moved to "archive".
///
/// Returns `(promoted, archived)` counts.
pub fn run_lifecycle(pool: &DbPool, persona_id: &str) -> Result<(i64, i64), AppError> {
    timed_query!("persona_memories", "persona_memories::run_lifecycle", {
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let now = chrono::Utc::now();
        let updated_at = now.to_rfc3339();

        // Promote: working memories accessed frequently -> active
        let promoted = tx.execute(
            "UPDATE persona_memories
             SET tier = 'active', updated_at = ?1
             WHERE persona_id = ?2 AND tier = 'working' AND access_count >= 5",
            params![updated_at, persona_id],
        )? as i64;

        // Archive: working memories older than 30 days with no accesses -> archive
        let cutoff = (now - chrono::Duration::days(30)).to_rfc3339();
        let archived = tx.execute(
            "UPDATE persona_memories
             SET tier = 'archive', updated_at = ?1
             WHERE persona_id = ?2 AND tier = 'working' AND access_count = 0 AND created_at < ?3",
            params![updated_at, persona_id, cutoff],
        )? as i64;

        tx.commit()?;
        Ok((promoted, archived))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreatePersonaInput, CreatePersonaMemoryInput, Json};
    use crate::db::repos::core::personas;

    #[test]
    fn test_strip_html_tags() {
        // Plain text passes through unchanged
        assert_eq!(strip_html_tags("hello world"), "hello world");
        assert_eq!(strip_html_tags(""), "");

        // Actual HTML tags are stripped
        assert_eq!(strip_html_tags("<b>bold</b>"), "bold");
        assert_eq!(strip_html_tags("<img src=x onerror=alert(1)>payload"), "payload");
        assert_eq!(
            strip_html_tags("<script>alert('xss')</script>safe text"),
            "safe text"
        );

        // Comparison operators and math expressions are preserved
        assert_eq!(strip_html_tags("a < b and c > d"), "a < b and c > d");
        assert_eq!(strip_html_tags("no < tags > here"), "no < tags > here");
        assert_eq!(strip_html_tags("if x < 10"), "if x < 10");
        assert_eq!(strip_html_tags("latency > 500ms"), "latency > 500ms");

        // Valid-looking HTML tags are still stripped (e.g. Vec<String> looks like a tag)
        assert_eq!(strip_html_tags("Vec<String>"), "Vec");

        // Ampersands preserved
        assert_eq!(strip_html_tags("a & b"), "a & b");
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
                tags: Some(Json(vec!["ui".to_string(), "preference".to_string()])),
                use_case_id: None,
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
                use_case_id: None,
            },
        )
        .unwrap();
        assert_eq!(m2.category, "fact");
        assert_eq!(m2.importance, 3);

        // Read by id
        let fetched = get_by_id(&pool, &m1.id).unwrap();
        assert_eq!(fetched.title, "User prefers dark mode");
        assert_eq!(fetched.tags, Some(Json(vec!["ui".to_string(), "preference".to_string()])));

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
            use_case_id: None,
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

    #[test]
    fn test_batch_update_importance_validates_range() {
        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Batch Agent".into(),
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

        let m1 = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "mem1".into(),
                content: "content1".into(),
                category: None,
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: None,
            },
        )
        .unwrap();

        let m2 = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "mem2".into(),
                content: "content2".into(),
                category: None,
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // Valid batch update succeeds
        let result = batch_update_importance(&pool, &[
            (m1.id.clone(), 5),
            (m2.id.clone(), 1),
        ]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 2);

        // Out-of-range value in batch is rejected (no partial writes)
        assert!(batch_update_importance(&pool, &[
            (m1.id.clone(), 3),
            (m2.id.clone(), 0), // invalid
        ]).is_err());
        assert!(batch_update_importance(&pool, &[
            (m1.id.clone(), 6), // invalid
        ]).is_err());
        assert!(batch_update_importance(&pool, &[
            (m1.id.clone(), -1), // invalid
        ]).is_err());

        // Verify no partial write happened — m1 should still be 5 from the valid batch
        let m1_after = get_by_id(&pool, &m1.id).unwrap();
        assert_eq!(m1_after.importance, 5);
    }

    // ========================================================================
    // Phase C5 — capability-scoped memory injection
    // ========================================================================

    fn make_persona(pool: &DbPool, name: &str) -> String {
        personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "scope test".into(),
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
        .id
    }

    fn insert_scoped_memory(
        pool: &DbPool,
        persona_id: &str,
        title: &str,
        tier: &str,
        use_case_id: Option<&str>,
    ) -> String {
        let mem = create(
            pool,
            CreatePersonaMemoryInput {
                persona_id: persona_id.to_string(),
                title: title.to_string(),
                content: format!("content for {title}"),
                category: Some("fact".to_string()),
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: use_case_id.map(|s| s.to_string()),
            },
        )
        .unwrap();
        // Tier defaults to "active" — promote/demote as needed.
        if tier != "active" {
            update_tier(pool, &mem.id, tier).unwrap();
        }
        mem.id
    }

    /// v2 scoping (use_case_id = Some): core ALWAYS injected, active filtered
    /// to capability-scoped + persona-wide.
    #[test]
    fn test_get_for_injection_v2_scoped_capability() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 Scoped");
        let core_global = insert_scoped_memory(&pool, &persona_id, "core global", "core", None);
        let core_scoped =
            insert_scoped_memory(&pool, &persona_id, "core other-uc", "core", Some("other-uc"));
        let active_match =
            insert_scoped_memory(&pool, &persona_id, "active match", "active", Some("uc-a"));
        let active_global =
            insert_scoped_memory(&pool, &persona_id, "active global", "active", None);
        let active_other =
            insert_scoped_memory(&pool, &persona_id, "active other", "active", Some("uc-b"));

        let tiered = get_for_injection_v2(&pool, &persona_id, Some("uc-a"), 10, 40).unwrap();

        let core_ids: Vec<&str> = tiered.core.iter().map(|m| m.id.as_str()).collect();
        // Both core memories surface regardless of use_case_id (rule: core is
        // always persona-wide).
        assert!(core_ids.contains(&core_global.as_str()));
        assert!(core_ids.contains(&core_scoped.as_str()));

        let active_ids: Vec<&str> = tiered.active.iter().map(|m| m.id.as_str()).collect();
        assert!(active_ids.contains(&active_match.as_str()), "scoped match missing");
        assert!(active_ids.contains(&active_global.as_str()), "global active missing");
        assert!(
            !active_ids.contains(&active_other.as_str()),
            "other capability's active memory leaked"
        );
    }

    /// v2 scoping (use_case_id = None): persona-wide active memories only.
    #[test]
    fn test_get_for_injection_v2_unscoped_persona_wide() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 Unscoped");
        let core_global = insert_scoped_memory(&pool, &persona_id, "core global", "core", None);
        let active_global =
            insert_scoped_memory(&pool, &persona_id, "active global", "active", None);
        let active_scoped =
            insert_scoped_memory(&pool, &persona_id, "active scoped", "active", Some("uc-a"));

        let tiered = get_for_injection_v2(&pool, &persona_id, None, 10, 40).unwrap();

        assert_eq!(tiered.core.len(), 1);
        assert_eq!(tiered.core[0].id, core_global);

        let active_ids: Vec<&str> = tiered.active.iter().map(|m| m.id.as_str()).collect();
        assert!(active_ids.contains(&active_global.as_str()));
        assert!(
            !active_ids.contains(&active_scoped.as_str()),
            "scoped active memory leaked into persona-wide injection"
        );
    }

    /// Legacy `get_for_injection` is a thin wrapper that delegates to v2 with
    /// use_case_id=None — verify behaviour matches.
    #[test]
    fn test_get_for_injection_v1_matches_v2_unscoped() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 V1Compat");
        insert_scoped_memory(&pool, &persona_id, "global", "active", None);
        insert_scoped_memory(&pool, &persona_id, "scoped", "active", Some("uc-a"));

        let v1 = get_for_injection(&pool, &persona_id, 10, 40).unwrap();
        let v2 = get_for_injection_v2(&pool, &persona_id, None, 10, 40).unwrap();
        assert_eq!(v1.core.len(), v2.core.len());
        assert_eq!(v1.active.len(), v2.active.len());
    }

    /// `get_by_use_case_id` returns only memories attributed to the capability.
    #[test]
    fn test_get_by_use_case_id_filters() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 ByUC");
        insert_scoped_memory(&pool, &persona_id, "global", "active", None);
        let scoped =
            insert_scoped_memory(&pool, &persona_id, "scoped", "active", Some("uc-a"));
        insert_scoped_memory(&pool, &persona_id, "other", "active", Some("uc-b"));

        let rows = get_by_use_case_id(&pool, &persona_id, "uc-a", None).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, scoped);
        assert_eq!(rows[0].use_case_id.as_deref(), Some("uc-a"));
    }

    /// Verify `create()` round-trips `use_case_id` through the new column.
    #[test]
    fn test_create_persists_use_case_id() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 Persist");
        let mem = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona_id.clone(),
                title: "scoped".into(),
                content: "scoped content".into(),
                category: None,
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: Some("uc-x".into()),
            },
        )
        .unwrap();
        assert_eq!(mem.use_case_id.as_deref(), Some("uc-x"));
        let fetched = get_by_id(&pool, &mem.id).unwrap();
        assert_eq!(fetched.use_case_id.as_deref(), Some("uc-x"));
    }
}
