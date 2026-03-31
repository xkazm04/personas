use rusqlite::{params, Row};

use crate::db::models::{CreateTeamMemoryInput, TeamMemory, TeamMemoryStats};
use crate::db::query_builder::QueryBuilder;
use crate::db::DbPool;
use crate::error::AppError;

/// Valid importance range for team memories (matches UI expectations).
const IMPORTANCE_MIN: i32 = 1;
const IMPORTANCE_MAX: i32 = 10;

/// Clamp importance to the valid 1–10 range.
fn clamp_importance(value: i32) -> i32 {
    value.clamp(IMPORTANCE_MIN, IMPORTANCE_MAX)
}

/// Escape LIKE metacharacters (%, _) so they are matched literally.
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn row_to_team_memory(row: &Row) -> rusqlite::Result<TeamMemory> {
    Ok(TeamMemory {
        id: row.get("id")?,
        team_id: row.get("team_id")?,
        run_id: row.get("run_id")?,
        member_id: row.get("member_id")?,
        persona_id: row.get("persona_id")?,
        title: row.get("title")?,
        content: row.get("content")?,
        category: row.get("category")?,
        importance: row.get("importance")?,
        tags: row.get("tags")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn get_all(
    pool: &DbPool,
    team_id: &str,
    run_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<TeamMemory>, AppError> {
    timed_query!("team_memories", "team_memories::get_all", {
        let limit = limit.unwrap_or(50);
        let offset = offset.unwrap_or(0);

        let conn = pool.get()?;

        let mut qb = QueryBuilder::new();
        qb.where_eq("team_id", team_id.to_string());
        if let Some(rid) = run_id {
            qb.where_eq("run_id", rid.to_string());
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
        qb.order_by_multiple(&[("importance", "DESC"), ("created_at", "DESC")]);
        qb.limit(limit);
        qb.offset(offset);

        let sql = qb.build_select("SELECT * FROM team_memories");

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_team_memory)?;
        let results: Vec<TeamMemory> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(results)

    })
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<TeamMemory, AppError> {
    timed_query!("team_memories", "team_memories::get_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM team_memories WHERE id = ?1",
            params![id],
            row_to_team_memory,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("TeamMemory {id}"))
            }
            other => AppError::Database(other),
        })

    })
}

pub fn get_by_team(
    pool: &DbPool,
    team_id: &str,
    limit: Option<i64>,
) -> Result<Vec<TeamMemory>, AppError> {
    timed_query!("team_memories", "team_memories::get_by_team", {
        let limit = limit.unwrap_or(50);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM team_memories WHERE team_id = ?1
             ORDER BY importance DESC, created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![team_id, limit], row_to_team_memory)?;
        let results: Vec<TeamMemory> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(results)

    })
}

pub fn get_by_run(pool: &DbPool, run_id: &str) -> Result<Vec<TeamMemory>, AppError> {
    timed_query!("team_memories", "team_memories::get_by_run", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM team_memories WHERE run_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![run_id], row_to_team_memory)?;
        let results: Vec<TeamMemory> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(results)

    })
}

/// Return top N memories by importance for context injection into pipeline nodes.
pub fn get_for_injection(
    pool: &DbPool,
    team_id: &str,
    limit: i64,
) -> Result<Vec<TeamMemory>, AppError> {
    timed_query!("team_memories", "team_memories::get_for_injection", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM team_memories WHERE team_id = ?1
             ORDER BY importance DESC, created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![team_id, limit], row_to_team_memory)?;
        let results: Vec<TeamMemory> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(results)

    })
}

pub fn create(pool: &DbPool, input: CreateTeamMemoryInput) -> Result<TeamMemory, AppError> {
    timed_query!("team_memories", "team_memories::create", {
        if input.title.trim().is_empty() {
            return Err(AppError::Validation("Title cannot be empty".into()));
        }
        if input.content.trim().is_empty() {
            return Err(AppError::Validation("Content cannot be empty".into()));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let category = input.category.unwrap_or_else(|| "observation".into());
        let importance = clamp_importance(input.importance.unwrap_or(3));

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO team_memories
             (id, team_id, run_id, member_id, persona_id, title, content, category, importance, tags, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                id,
                input.team_id,
                input.run_id,
                input.member_id,
                input.persona_id,
                input.title,
                input.content,
                category,
                importance,
                input.tags,
                now,
            ],
        )?;

        get_by_id(pool, &id)

    })
}

pub fn update_importance(pool: &DbPool, id: &str, importance: i32) -> Result<bool, AppError> {
    timed_query!("team_memories", "team_memories::update_importance", {
        let importance = clamp_importance(importance);
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE team_memories SET importance = ?1, updated_at = ?2 WHERE id = ?3",
            params![importance, now, id],
        )?;
        Ok(rows > 0)

    })
}

pub fn update(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    content: Option<&str>,
    category: Option<&str>,
    importance: Option<i32>,
) -> Result<TeamMemory, AppError> {
    timed_query!("team_memories", "team_memories::update", {
        let conn = pool.get()?;

        // Read existing memory to build revision log from current values
        let existing = get_by_id(pool, id)?;

        // Build revision entry from current state (stored in tags as JSON array)
        let now = chrono::Utc::now().to_rfc3339();
        let revision = serde_json::json!({
            "title": existing.title,
            "content": existing.content,
            "category": existing.category,
            "importance": existing.importance,
            "edited_at": now,
        });

        // Parse existing tags to append revision
        let mut tags_obj: serde_json::Value = existing
            .tags
            .as_deref()
            .and_then(|t| serde_json::from_str(t).ok())
            .unwrap_or_else(|| {
                // If tags is a simple string like "auto" or "manual", preserve it
                let base = existing.tags.clone().unwrap_or_default();
                serde_json::json!({ "source": base, "revisions": [] })
            });

        // Ensure revisions array exists
        if tags_obj.get("revisions").is_none() {
            let source = if tags_obj.is_string() {
                tags_obj.as_str().unwrap_or("").to_string()
            } else {
                "".to_string()
            };
            tags_obj = serde_json::json!({ "source": source, "revisions": [] });
        }

        if let Some(revisions) = tags_obj.get_mut("revisions").and_then(|v| v.as_array_mut()) {
            // Keep at most 20 revisions
            if revisions.len() >= 20 {
                revisions.remove(0);
            }
            revisions.push(revision);
        }

        let tags_str = serde_json::to_string(&tags_obj).unwrap_or_default();
        let new_title = title.unwrap_or(&existing.title);
        let new_content = content.unwrap_or(&existing.content);
        let new_category = category.unwrap_or(&existing.category);
        let new_importance = clamp_importance(importance.unwrap_or(existing.importance));

        if new_title.trim().is_empty() {
            return Err(AppError::Validation("Title cannot be empty".into()));
        }
        if new_content.trim().is_empty() {
            return Err(AppError::Validation("Content cannot be empty".into()));
        }

        conn.execute(
            "UPDATE team_memories SET title = ?1, content = ?2, category = ?3, importance = ?4, tags = ?5, updated_at = ?6 WHERE id = ?7",
            params![new_title, new_content, new_category, new_importance, tags_str, now, id],
        )?;

        get_by_id(pool, id)

    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("team_memories", "team_memories::delete", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM team_memories WHERE id = ?1", params![id])?;
        Ok(rows > 0)

    })
}

pub fn batch_delete(pool: &DbPool, ids: &[String]) -> Result<i64, AppError> {
    timed_query!("team_memories", "team_memories::batch_delete", {
        if ids.is_empty() {
            return Ok(0);
        }

        // SQLite has a default SQLITE_MAX_VARIABLE_NUMBER of 999.
        // Chunk deletes into batches of 500 to stay well under the limit.
        const CHUNK_SIZE: usize = 500;
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let mut total_deleted: i64 = 0;

        for chunk in ids.chunks(CHUNK_SIZE) {
            let placeholders: Vec<String> = (1..=chunk.len()).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "DELETE FROM team_memories WHERE id IN ({})",
                placeholders.join(", ")
            );
            let params: Vec<&dyn rusqlite::types::ToSql> = chunk
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();
            let rows = tx.execute(&sql, params.as_slice())?;
            total_deleted += rows as i64;
        }

        tx.commit()?;
        Ok(total_deleted)

    })
}

pub fn get_total_count(
    pool: &DbPool,
    team_id: &str,
    run_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
) -> Result<i64, AppError> {
    timed_query!("team_memories", "team_memories::get_total_count", {
        let conn = pool.get()?;

        let mut qb = QueryBuilder::new();
        qb.where_eq("team_id", team_id.to_string());
        if let Some(rid) = run_id {
            qb.where_eq("run_id", rid.to_string());
        }
        if let Some(cat) = category {
            qb.where_eq("category", cat.to_string());
        }
        if let Some(s) = search {
            let pattern = format!("%{}%", escape_like(s));
            qb.where_like_escape_any(&["title", "content"], pattern);
        }

        let sql = qb.build_select("SELECT COUNT(*) FROM team_memories");
        let count: i64 = conn.query_row(&sql, qb.params_ref().as_slice(), |row| row.get(0))?;
        Ok(count)

    })
}

pub fn get_stats(
    pool: &DbPool,
    team_id: &str,
    category: Option<&str>,
    search: Option<&str>,
) -> Result<TeamMemoryStats, AppError> {
    timed_query!("team_memories", "team_memories::get_stats", {
        let conn = pool.get()?;

        // Build shared WHERE clause for all three queries
        let mut qb = QueryBuilder::new();
        qb.where_eq("team_id", team_id.to_string());
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

        let where_clause = qb.where_clause();

        // Total + avg importance + auto-generated count
        let sql_agg = format!(
            "SELECT COUNT(*), COALESCE(AVG(importance), 0),
                    SUM(CASE WHEN run_id IS NOT NULL THEN 1 ELSE 0 END)
             FROM team_memories {where_clause}"
        );
        let (total, avg_importance, auto_generated): (i64, f64, i64) =
            conn.query_row(&sql_agg, qb.params_ref().as_slice(), |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?;

        // Category breakdown
        let sql_cat = format!(
            "SELECT category, COUNT(*) as cnt FROM team_memories {where_clause} GROUP BY category ORDER BY cnt DESC"
        );
        let mut cat_stmt = conn.prepare(&sql_cat)?;
        let category_counts: Vec<(String, i64)> = cat_stmt
            .query_map(qb.params_ref().as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;

        // Run breakdown
        let sql_run = format!(
            "SELECT COALESCE(run_id, 'manual'), COUNT(*) as cnt FROM team_memories {where_clause} GROUP BY run_id ORDER BY cnt DESC"
        );
        let mut run_stmt = conn.prepare(&sql_run)?;
        let run_counts: Vec<(String, i64)> = run_stmt
            .query_map(qb.params_ref().as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;

        Ok(TeamMemoryStats {
            total,
            auto_generated,
            max_memories: DEFAULT_MAX_MEMORIES_PER_TEAM,
            avg_importance,
            category_counts,
            run_counts,
        })

    })
}

/// Default cap on the number of memories stored per team.
pub const DEFAULT_MAX_MEMORIES_PER_TEAM: i64 = 200;

/// Evict lowest-importance, oldest auto-generated memories when the total
/// memory count for a team exceeds `max_memories`. Only memories with a
/// non-NULL `run_id` (i.e. auto-created by pipeline runs) are eligible for
/// eviction — manually curated memories are never removed.
///
/// Returns the number of rows deleted.
pub fn evict_excess(
    pool: &DbPool,
    team_id: &str,
    max_memories: Option<i64>,
) -> Result<i64, AppError> {
    timed_query!("team_memories", "team_memories::evict_excess", {
        let cap = max_memories.unwrap_or(DEFAULT_MAX_MEMORIES_PER_TEAM);
        if cap <= 0 {
            return Ok(0);
        }

        let conn = pool.get()?;

        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM team_memories WHERE team_id = ?1",
            params![team_id],
            |row| row.get(0),
        )?;

        if total <= cap {
            return Ok(0);
        }

        let excess = total - cap;

        // Delete the `excess` lowest-value auto-generated memories.
        // Eviction order: lowest importance first, then oldest first.
        let deleted = conn.execute(
            "DELETE FROM team_memories WHERE id IN (
                SELECT id FROM team_memories
                WHERE team_id = ?1 AND run_id IS NOT NULL
                ORDER BY importance ASC, created_at ASC
                LIMIT ?2
            )",
            params![team_id, excess],
        )?;

        if deleted > 0 {
            tracing::info!(
                team_id = %team_id,
                evicted = deleted,
                cap = cap,
                "Evicted excess auto-generated team memories"
            );
        }

        Ok(deleted as i64)
    })
}
