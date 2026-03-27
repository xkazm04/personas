use rusqlite::{params, Row};

use crate::db::models::{CreateTeamMemoryInput, TeamMemory, TeamMemoryStats};
use crate::db::DbPool;
use crate::error::AppError;

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

        let mut conditions: Vec<String> = Vec::new();
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut param_idx = 1u32;

        // team_id is always required
        conditions.push(format!("team_id = ?{param_idx}"));
        param_values.push(Box::new(team_id.to_string()));
        param_idx += 1;

        if let Some(rid) = run_id {
            conditions.push(format!("run_id = ?{param_idx}"));
            param_values.push(Box::new(rid.to_string()));
            param_idx += 1;
        }
        if let Some(cat) = category {
            conditions.push(format!("category = ?{param_idx}"));
            param_values.push(Box::new(cat.to_string()));
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
                param_values.push(Box::new(pattern.clone()));
                param_values.push(Box::new(pattern));
                param_idx += 2;
            }
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let sql = format!(
            "SELECT * FROM team_memories {} ORDER BY importance DESC, created_at DESC LIMIT ?{} OFFSET ?{}",
            where_clause, param_idx, param_idx + 1
        );

        param_values.push(Box::new(limit));
        param_values.push(Box::new(offset));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), row_to_team_memory)?;
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
        let importance = input.importance.unwrap_or(3);

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
        let new_importance = importance.unwrap_or(existing.importance);

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
        let conn = pool.get()?;
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "DELETE FROM team_memories WHERE id IN ({})",
            placeholders.join(", ")
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = conn.execute(&sql, params.as_slice())?;
        Ok(rows as i64)

    })
}

pub fn get_total_count(
    pool: &DbPool,
    team_id: &str,
    run_id: Option<&str>,
    category: Option<&str>,
) -> Result<i64, AppError> {
    timed_query!("team_memories", "team_memories::get_total_count", {
        let conn = pool.get()?;

        let mut conditions: Vec<String> = Vec::new();
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut param_idx = 1u32;

        conditions.push(format!("team_id = ?{param_idx}"));
        param_values.push(Box::new(team_id.to_string()));
        param_idx += 1;

        if let Some(rid) = run_id {
            conditions.push(format!("run_id = ?{param_idx}"));
            param_values.push(Box::new(rid.to_string()));
            param_idx += 1;
        }
        if let Some(cat) = category {
            conditions.push(format!("category = ?{param_idx}"));
            param_values.push(Box::new(cat.to_string()));
            param_idx += 1;
        }
        let _ = param_idx; // suppress unused-assignment warning; keep idx correct for future filters

        let where_clause = format!("WHERE {}", conditions.join(" AND "));
        let sql = format!("SELECT COUNT(*) FROM team_memories {where_clause}");
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let count: i64 = conn.query_row(&sql, params_ref.as_slice(), |row| row.get(0))?;
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
        let mut conditions: Vec<String> = vec!["team_id = ?1".to_string()];
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> =
            vec![Box::new(team_id.to_string())];
        let mut param_idx = 2u32;

        if let Some(cat) = category {
            conditions.push(format!("category = ?{param_idx}"));
            param_values.push(Box::new(cat.to_string()));
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
                param_values.push(Box::new(pattern.clone()));
                param_values.push(Box::new(pattern));
                param_idx += 2;
            }
        }
        let _ = param_idx;

        let where_clause = format!("WHERE {}", conditions.join(" AND "));
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        // Total + avg importance
        let sql_agg = format!(
            "SELECT COUNT(*), COALESCE(AVG(importance), 0) FROM team_memories {where_clause}"
        );
        let (total, avg_importance): (i64, f64) =
            conn.query_row(&sql_agg, params_ref.as_slice(), |row| {
                Ok((row.get(0)?, row.get(1)?))
            })?;

        // Category breakdown
        let sql_cat = format!(
            "SELECT category, COUNT(*) as cnt FROM team_memories {where_clause} GROUP BY category ORDER BY cnt DESC"
        );
        let mut cat_stmt = conn.prepare(&sql_cat)?;
        let category_counts: Vec<(String, i64)> = cat_stmt
            .query_map(params_ref.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;

        // Run breakdown
        let sql_run = format!(
            "SELECT COALESCE(run_id, 'manual'), COUNT(*) as cnt FROM team_memories {where_clause} GROUP BY run_id ORDER BY cnt DESC"
        );
        let mut run_stmt = conn.prepare(&sql_run)?;
        let run_counts: Vec<(String, i64)> = run_stmt
            .query_map(params_ref.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;

        Ok(TeamMemoryStats {
            total,
            avg_importance,
            category_counts,
            run_counts,
        })

    })
}
