//! Project-scoped memory for the development loop — `docs/plans/backlog-memory-loop.md`
//! Phase 2.
//!
//! The loop has three learning moments (a triage decision, a task outcome, a
//! scan funnel) and, before this store existed, only the first one was written
//! anywhere — into `team_memories`, which is keyed on a team. A project without
//! a team learned nothing, and the task executor (which knows a project, not a
//! team) had nothing to read, so a constraint carefully recorded at triage time
//! was forgotten at execution time.
//!
//! This repo is that store. It is deliberately small: append + read-for-
//! injection. Nothing here mutates persona or team memory; the two stores are
//! written in parallel and neither is authoritative over the other.
use rusqlite::params;

use crate::db::models::DevMemory;
use crate::db::DbPool;
use crate::error::AppError;

/// Importance floor/ceiling. Constraints (a durable "don't") sit at the top so
/// they win the injection budget against softer observations.
fn clamp_importance(v: i32) -> i32 {
    v.clamp(1, 10)
}

fn row_to_dev_memory(row: &rusqlite::Row<'_>) -> rusqlite::Result<DevMemory> {
    Ok(DevMemory {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        category: row.get("category")?,
        title: row.get("title")?,
        content: row.get("content")?,
        importance: row.get("importance")?,
        source_kind: row.get("source_kind")?,
        source_id: row.get("source_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Append a memory. Idempotent per source event: the partial unique index on
/// `(project_id, source_kind, source_id)` means re-recording the same decision
/// or the same task's outcome is a no-op returning `Ok(None)` — so a retried
/// task or a double-clicked triage button cannot inflate the loop's memory.
#[allow(clippy::too_many_arguments)]
pub fn record(
    pool: &DbPool,
    project_id: &str,
    category: &str,
    title: &str,
    content: &str,
    importance: i32,
    source_kind: &str,
    source_id: Option<&str>,
) -> Result<Option<DevMemory>, AppError> {
    if project_id.trim().is_empty() {
        return Err(AppError::Validation(
            "dev memory requires a project_id".into(),
        ));
    }
    if title.trim().is_empty() || content.trim().is_empty() {
        return Err(AppError::Validation(
            "dev memory requires a title and content".into(),
        ));
    }
    if !crate::db::models::DEV_MEMORY_SOURCES.contains(&source_kind) {
        return Err(AppError::Validation(format!(
            "Unknown dev memory source: {source_kind}"
        )));
    }

    timed_query!("dev_memories", "dev_memories::record", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        // `INSERT OR IGNORE` + the partial unique index makes duplicate source
        // events silent no-ops rather than errors the callers must all handle.
        let affected = conn.execute(
            "INSERT OR IGNORE INTO dev_memories
             (id, project_id, category, title, content, importance, source_kind, source_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![
                id,
                project_id,
                category,
                title.trim(),
                content.trim(),
                clamp_importance(importance),
                source_kind,
                source_id,
                now
            ],
        )?;
        if affected == 0 {
            return Ok(None);
        }

        let mut stmt = conn.prepare("SELECT * FROM dev_memories WHERE id = ?1")?;
        let memory = stmt.query_row(params![id], row_to_dev_memory)?;
        Ok(Some(memory))
    })
}

/// The memories to put in front of an agent working on this project, ordered so
/// the budget is spent on what changes behaviour first: constraints, then
/// decisions, then everything else, newest first within each band.
pub fn get_for_injection(
    pool: &DbPool,
    project_id: &str,
    limit: i64,
) -> Result<Vec<DevMemory>, AppError> {
    timed_query!("dev_memories", "dev_memories::get_for_injection", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_memories WHERE project_id = ?1
             ORDER BY CASE category
                        WHEN 'constraint' THEN 0
                        WHEN 'decision'   THEN 1
                        ELSE 2
                      END,
                      importance DESC,
                      created_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![project_id, limit], row_to_dev_memory)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Most recent memories of one kind — used to feed task OUTCOMES back into the
/// next scan prompt, which is what closes the loop end to end.
pub fn list_recent_by_kind(
    pool: &DbPool,
    project_id: &str,
    source_kind: &str,
    limit: i64,
) -> Result<Vec<DevMemory>, AppError> {
    timed_query!("dev_memories", "dev_memories::list_recent_by_kind", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_memories WHERE project_id = ?1 AND source_kind = ?2
             ORDER BY created_at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![project_id, source_kind, limit], row_to_dev_memory)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Render memories as a compact prompt block, hard-capped by character budget
/// so a long-lived project can never crowd out the actual task instructions.
/// Returns `None` when there is nothing worth injecting.
pub fn render_for_prompt(memories: &[DevMemory], char_budget: usize) -> Option<String> {
    if memories.is_empty() {
        return None;
    }
    let mut out = String::new();
    for m in memories {
        let line = format!("- [{}] {}: {}\n", m.category, m.title, m.content);
        if out.len() + line.len() > char_budget {
            break;
        }
        out.push_str(&line);
    }
    (!out.is_empty()).then_some(out)
}

// Phase 2 tests live in their own file for size; `#[path]` keeps them a child
// module of this one so `use super::*` reaches the repo directly.
#[cfg(test)]
#[path = "dev_memories_tests.rs"]
mod dev_memories_tests;
