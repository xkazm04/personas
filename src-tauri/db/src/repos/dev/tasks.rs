use super::goals::list_goal_statuses_with_deps;
use crate::models::DevTask;
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};
use std::collections::{HashMap, HashSet};

fn row_to_task(row: &Row) -> rusqlite::Result<DevTask> {
    Ok(DevTask {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        source_idea_id: row.get("source_idea_id")?,
        goal_id: row.get("goal_id")?,
        status: row.get("status")?,
        session_id: row.get("session_id")?,
        progress_pct: row.get::<_, Option<i32>>("progress_pct")?.unwrap_or(0),
        output_lines: row.get::<_, Option<i32>>("output_lines")?.unwrap_or(0),
        error: row.get("error")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        created_at: row.get("created_at")?,
        // Same tolerant read as the retry-lineage columns below: a row seen
        // through a pre-migration connection (or a SELECT that omits it) must
        // still map rather than fail the whole Run Desk.
        updated_at: row.get("updated_at").unwrap_or(None),
        depth: row
            .get::<_, Option<String>>("depth")?
            .unwrap_or_else(|| "quick".to_string()),
        // Retry-lineage columns — tolerant `unwrap_or` for the same reason as
        // `dedup_key` on ideas: a row read through a pre-migration connection
        // (or a SELECT that omits them) must still map.
        parent_task_id: row.get("parent_task_id").unwrap_or(None),
        attempt: row
            .get::<_, Option<i32>>("attempt")
            .unwrap_or(None)
            .unwrap_or(1),
    })
}

/// Warn (never reject) on a status outside `TASK_STATUSES`. Rejecting would
/// strand a task mid-run; a warning is enough to catch a new writer that
/// invents a vocabulary the Run Desk cannot render.
fn warn_unknown_task_status(status: &str, op: &str) {
    if !crate::models::TASK_STATUSES.contains(&status) {
        tracing::warn!(
            status,
            op,
            "dev_tasks: unknown status written — the Run Desk renders only {:?}",
            crate::models::TASK_STATUSES
        );
    }
}

// ============================================================================
// Tasks
// ============================================================================

pub fn list_tasks(
    pool: &DbPool,
    project_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<DevTask>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::list_tasks", {
        let conn = pool.get()?;
        let mut qb = QueryBuilder::new();

        if let Some(v) = project_id {
            qb.where_eq("project_id", v.to_string());
        }
        if let Some(v) = status {
            qb.where_eq("status", v.to_string());
        }

        qb.order_by("created_at", "DESC");

        let sql = qb.build_select("SELECT * FROM dev_tasks");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_task)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_task_by_id(pool: &DbPool, id: &str) -> Result<DevTask, AppError> {
    timed_query!("dev_tasks", "dev_tasks::get_task_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_tasks WHERE id = ?1",
            params![id],
            row_to_task,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev task {id}")),
            other => AppError::Database(other),
        })
    })
}

/// Return up to `limit` queued tasks for `project_id` whose upstream goal
/// chain is fully `completed` (or whose `goal_id` is NULL — orphan-ready).
///
/// Tasks whose upstream contains a `failed` or `cancelled` goal are
/// **excluded** from the ready set; they remain `queued` in the DB until
/// the user manually re-runs after fixing the upstream.
///
/// Sorted FIFO by `created_at`. Used by the auto-run scheduler.
pub fn list_ready_tasks(
    pool: &DbPool,
    project_id: &str,
    limit: usize,
) -> Result<Vec<DevTask>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::list_ready_tasks", {
        let goal_state = list_goal_statuses_with_deps(pool, project_id)?;

        // Walks the upstream closure of `gid` and reports the *worst* status seen.
        // Returns: "completed" if every upstream goal is completed (or gid has no
        // upstream); "blocked" if any upstream is queued/in_progress; "failed" if
        // any upstream is failed/cancelled.
        fn upstream_state(gid: &str, map: &HashMap<String, (String, Vec<String>)>) -> &'static str {
            let mut visited: HashSet<String> = HashSet::new();
            let mut stack: Vec<String> = vec![gid.to_string()];
            let mut blocked = false;
            while let Some(node) = stack.pop() {
                if !visited.insert(node.clone()) {
                    continue;
                }
                if let Some((status, deps)) = map.get(&node) {
                    // The starting node's own status is irrelevant for readiness;
                    // only its upstream matters. Skip it.
                    if node != gid {
                        match status.as_str() {
                            "failed" | "cancelled" => return "failed",
                            "completed" => {}
                            _ => blocked = true,
                        }
                    }
                    for d in deps {
                        stack.push(d.clone());
                    }
                }
            }
            if blocked {
                "blocked"
            } else {
                "completed"
            }
        }

        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_tasks \
             WHERE project_id = ?1 AND status = 'queued' \
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_task)?;

        let mut out: Vec<DevTask> = Vec::new();
        for r in rows {
            let task = r.map_err(AppError::Database)?;
            let ready = match task.goal_id.as_deref() {
                None => true,
                Some(gid) => upstream_state(gid, &goal_state) == "completed",
            };
            if ready {
                out.push(task);
                if out.len() >= limit {
                    break;
                }
            }
        }
        Ok(out)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_task(
    pool: &DbPool,
    project_id: Option<&str>,
    title: &str,
    description: Option<&str>,
    source_idea_id: Option<&str>,
    goal_id: Option<&str>,
    status: Option<&str>,
    depth: Option<&str>,
) -> Result<DevTask, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }

    timed_query!("dev_tasks", "dev_tasks::create_task", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let status = status.unwrap_or("queued");
        warn_unknown_task_status(status, "create_task");
        let depth = depth.unwrap_or("quick");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, status, depth, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, project_id, title, description, source_idea_id, goal_id, status, depth, now],
        )?;

        get_task_by_id(pool, &id)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_task(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    description: Option<Option<&str>>,
    status: Option<&str>,
    session_id: Option<Option<&str>>,
    progress_pct: Option<i32>,
    output_lines: Option<i32>,
    error: Option<Option<&str>>,
    started_at: Option<Option<&str>>,
    completed_at: Option<Option<&str>>,
) -> Result<DevTask, AppError> {
    timed_query!("dev_tasks", "dev_tasks::update_task", {
        get_task_by_id(pool, id)?;
        if let Some(s) = status {
            warn_unknown_task_status(s, "update_task");
        }
        let conn = pool.get()?;

        let mut sets: Vec<String> = Vec::new();
        let mut param_idx = 1u32;

        push_field!(title, "title", sets, param_idx);
        push_field!(description, "description", sets, param_idx);
        push_field!(status, "status", sets, param_idx);
        push_field!(session_id, "session_id", sets, param_idx);
        push_field!(progress_pct, "progress_pct", sets, param_idx);
        push_field!(output_lines, "output_lines", sets, param_idx);
        push_field!(error, "error", sets, param_idx);
        push_field!(started_at, "started_at", sets, param_idx);
        push_field!(completed_at, "completed_at", sets, param_idx);

        if sets.is_empty() {
            // Nothing actually changed — do NOT bump updated_at. Every caller
            // that passes all-None is a no-op, and stamping one would forge a
            // heartbeat the attention queue reads as "this task is alive".
            return get_task_by_id(pool, id);
        }

        // Every real mutation stamps updated_at. This is the single choke point:
        // task_executor.rs drives all of its writes (start, progress milestones,
        // output-volume fallback, terminal status) through this function, so
        // stamping here covers every path that touches a task.
        let touched_at = chrono::Utc::now().to_rfc3339();
        sets.push(format!("updated_at = ?{param_idx}"));
        param_idx += 1;

        let sql = format!(
            "UPDATE dev_tasks SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(v) = title {
            param_values.push(Box::new(v.to_string()));
        }
        if let Some(v) = description {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = status {
            param_values.push(Box::new(v.to_string()));
        }
        if let Some(v) = session_id {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = progress_pct {
            param_values.push(Box::new(v));
        }
        if let Some(v) = output_lines {
            param_values.push(Box::new(v));
        }
        if let Some(v) = error {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = started_at {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = completed_at {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        param_values.push(Box::new(touched_at));
        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_task_by_id(pool, id)
    })
}

pub fn delete_task(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_tasks", "dev_tasks::delete_task", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_tasks WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

/// One keyset page of tasks plus per-status counts. Same cursor scheme as
/// `triage_ideas` (`"{created_at}|{id}"`, `created_at DESC, id DESC`).
/// `list_tasks` stays untouched for the existing unpaginated callers.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TasksPage {
    pub tasks: Vec<DevTask>,
    pub cursor: Option<String>,
    pub has_more: bool,
    /// Per-status totals scoped to the project (NOT to the status filter), so
    /// status chips stay truthful beyond the loaded page.
    pub counts: HashMap<String, u32>,
}

const TASKS_PAGE_DEFAULT_LIMIT: i64 = 40;
const TASKS_PAGE_MAX_LIMIT: i64 = 200;

pub fn tasks_page(
    pool: &DbPool,
    project_id: Option<&str>,
    statuses: Option<&[String]>,
    limit: Option<i64>,
    cursor: Option<&str>,
) -> Result<TasksPage, AppError> {
    timed_query!("dev_tasks", "dev_tasks::tasks_page", {
        let limit = limit
            .unwrap_or(TASKS_PAGE_DEFAULT_LIMIT)
            .clamp(1, TASKS_PAGE_MAX_LIMIT);

        let mut clauses: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(pid) = project_id {
            clauses.push("project_id = ?".to_string());
            params.push(Box::new(pid.to_string()));
        }
        // An empty `statuses` vec is "no status filter", not "match nothing" —
        // an empty IN () is a SQL error and a blank filter chip must not
        // silently blank the list.
        if let Some(list) = statuses.filter(|s| !s.is_empty()) {
            let placeholders = vec!["?"; list.len()].join(", ");
            clauses.push(format!("status IN ({placeholders})"));
            for s in list {
                params.push(Box::new(s.clone()));
            }
        }
        if let Some(raw) = cursor.filter(|c| !c.is_empty()) {
            let (created_at, id) = raw
                .split_once('|')
                .ok_or_else(|| AppError::Validation(format!("Malformed tasks cursor: {raw}")))?;
            clauses.push("(created_at < ? OR (created_at = ? AND id < ?))".to_string());
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(id.to_string()));
        }

        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", clauses.join(" AND "))
        };
        let sql = format!(
            "SELECT * FROM dev_tasks{where_sql} ORDER BY created_at DESC, id DESC LIMIT {}",
            limit + 1
        );

        let conn = pool.get()?;
        let mut tasks: Vec<DevTask> = {
            let mut stmt = conn.prepare(&sql)?;
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt
                .query_map(params_ref.as_slice(), row_to_task)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            rows
        };

        let has_more = tasks.len() as i64 > limit;
        if has_more {
            tasks.truncate(limit as usize);
        }
        let next_cursor = if has_more {
            tasks.last().map(|t| format!("{}|{}", t.created_at, t.id))
        } else {
            None
        };

        let counts: HashMap<String, u32> = {
            let (count_sql, count_params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
                match project_id {
                    Some(pid) => (
                        "SELECT status, COUNT(*) AS n FROM dev_tasks WHERE project_id = ? GROUP BY status"
                            .to_string(),
                        vec![Box::new(pid.to_string())],
                    ),
                    None => (
                        "SELECT status, COUNT(*) AS n FROM dev_tasks GROUP BY status".to_string(),
                        Vec::new(),
                    ),
                };
            let mut stmt = conn.prepare(&count_sql)?;
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                count_params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt
                .query_map(params_ref.as_slice(), |row| {
                    Ok((
                        row.get::<_, String>("status")?,
                        row.get::<_, i64>("n")?.max(0) as u32,
                    ))
                })?
                .collect::<Result<HashMap<_, _>, _>>()
                .map_err(AppError::Database)?;
            rows
        };

        Ok(TasksPage {
            tasks,
            cursor: next_cursor,
            has_more,
            counts,
        })
    })
}

/// Create a fresh `queued` task as a re-attempt of `task_id`.
///
/// The title is copied VERBATIM — no `[Retry] ` prefix. The prefix used to
/// accumulate across attempts and, worse, it changed the text the executor
/// prompts with, so a retry was not a re-run of the same instruction. Lineage
/// lives in `parent_task_id` / `attempt`, which the UI renders as a chip.
pub fn retry_task(pool: &DbPool, task_id: &str) -> Result<DevTask, AppError> {
    timed_query!("dev_tasks", "dev_tasks::retry_task", {
        let parent = get_task_by_id(pool, task_id)?;

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, status, depth, parent_task_id, attempt, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?8, ?9, ?10, ?10)",
            params![
                id,
                parent.project_id,
                parent.title,
                parent.description,
                parent.source_idea_id,
                parent.goal_id,
                parent.depth,
                parent.id,
                parent.attempt.saturating_add(1),
                now,
            ],
        )?;

        get_task_by_id(pool, &id)
    })
}

// Keyset-pagination + retry-lineage tests for the unified Backlog / Run Desk.
// Same `#[path]` arrangement as the backlog tests beside the ideas repo.
#[cfg(test)]
#[path = "tasks_page_tests.rs"]
mod page_tests;
