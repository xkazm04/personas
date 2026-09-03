use rusqlite::params;

use crate::models::{PersonaToolUsage, PersonaUsageSummary, ToolUsageOverTime, ToolUsageSummary};
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// Internal CLI tools that should be excluded from usage analytics charts.
/// These are Claude Code's built-in tools, not persona-defined use-case tools.
const INTERNAL_TOOLS: &[&str] = &[
    "bash",
    "Bash",
    "read",
    "Read",
    "read_file",
    "write",
    "Write",
    "write_file",
    "edit",
    "Edit",
    "edit_file",
    "glob",
    "Glob",
    "grep",
    "Grep",
    "list_directory",
    "ListDirectory",
    "search_replace",
    "SearchReplace",
    "notebook_edit",
    "NotebookEdit",
    "web_search",
    "WebSearch",
    "web_fetch",
    "WebFetch",
    "todoread",
    "TodoRead",
    "todowrite",
    "TodoWrite",
];

/// Build a SQL NOT IN clause for excluding internal tools.
/// `col` is the column reference, e.g. "tool_name" or "u.tool_name".
fn internal_tools_exclusion(col: &str) -> String {
    let placeholders: Vec<String> = INTERNAL_TOOLS.iter().map(|t| format!("'{t}'")).collect();
    format!("{} NOT IN ({})", col, placeholders.join(", "))
}

/// One projection for every full-row read of `persona_tool_usage`, in the order
/// `row_to_usage` consumes it. Mirrors `CREATE TABLE persona_tool_usage`
/// (`migrations/schema.rs:301`).
///
/// `SELECT *` is what this replaces, and the cost of it is not hypothetical:
/// the mapper reads by NAME, so a column the projection stops carrying compiles
/// fine and fails at runtime on the first row — the exact shape that left
/// `list_items_by_persona_id` broken for three months in `executions.rs`.
/// `projection_covers_every_field_the_mapper_reads` is the gate.
const COLUMNS: &str = "id, execution_id, persona_id, tool_name, invocation_count, created_at";

row_mapper!(row_to_usage -> PersonaToolUsage {
    id, execution_id, persona_id, tool_name, invocation_count, created_at,
});

pub fn record(
    pool: &DbPool,
    execution_id: &str,
    persona_id: &str,
    tool_name: &str,
    count: i32,
) -> Result<PersonaToolUsage, AppError> {
    timed_query!("tool_usage", "tool_usage::record", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.conn("tool_usage::record")?;
        conn.execute(
            "INSERT INTO persona_tool_usage
             (id, execution_id, persona_id, tool_name, invocation_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, execution_id, persona_id, tool_name, count, now],
        )?;

        Ok(PersonaToolUsage {
            id,
            execution_id: execution_id.to_string(),
            persona_id: persona_id.to_string(),
            tool_name: tool_name.to_string(),
            invocation_count: count,
            created_at: now,
        })
    })
}

/// Current-calendar-month invocation totals per tool for one persona.
///
/// Month boundary is the same UTC `datetime('now', 'start of month')`
/// expression as `executions::MONTHLY_SPEND_PREDICATE`, so the connector
/// counters the KP outbound reporter (`engine/kp_reporter.rs`) sends ride the
/// same window as the cost/run rollup. Internal CLI tools are excluded — KP
/// only cares about connector-shaped usage, matching the analytics charts.
pub fn get_monthly_totals_by_tool(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<(String, i64)>, AppError> {
    timed_query!("tool_usage", "tool_usage::get_monthly_totals_by_tool", {
        let conn = pool.conn("tool_usage::get_monthly_totals_by_tool")?;
        let sql = format!(
            "SELECT tool_name, COALESCE(SUM(invocation_count), 0)
             FROM persona_tool_usage
             WHERE persona_id = ?1
               AND created_at >= datetime('now', 'start of month')
               AND {}
             GROUP BY tool_name
             ORDER BY tool_name ASC",
            internal_tools_exclusion("tool_name")
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![persona_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let totals = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(totals)
    })
}

pub fn get_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<PersonaToolUsage>, AppError> {
    timed_query!("tool_usage", "tool_usage::get_by_execution", {
        let conn = pool.conn("tool_usage::get_by_execution")?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM persona_tool_usage \
             WHERE execution_id = ?1 ORDER BY created_at ASC"
        ))?;
        let rows = stmt.query_map(params![execution_id], row_to_usage)?;
        let usages = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(usages)
    })
}

pub fn get_usage_summary(
    pool: &DbPool,
    since: &str,
    persona_id: Option<&str>,
) -> Result<Vec<ToolUsageSummary>, AppError> {
    timed_query!("tool_usage", "tool_usage::get_usage_summary", {
        let conn = pool.conn("tool_usage::get_usage_summary")?;
        let mut qb = QueryBuilder::new();
        qb.where_gte("created_at", since.to_string());
        if let Some(pid) = persona_id {
            qb.where_eq("persona_id", pid.to_string());
        }

        let sql = format!(
            "SELECT tool_name,
                SUM(invocation_count) as total_invocations,
                COUNT(DISTINCT execution_id) as unique_executions,
                COUNT(DISTINCT persona_id) as unique_personas
         FROM persona_tool_usage
         {} AND {}
         GROUP BY tool_name
         ORDER BY total_invocations DESC",
            qb.where_clause(),
            internal_tools_exclusion("tool_name")
        );

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), |row| {
            Ok(ToolUsageSummary {
                tool_name: row.get("tool_name")?,
                total_invocations: row.get("total_invocations")?,
                unique_executions: row.get("unique_executions")?,
                unique_personas: row.get("unique_personas")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_usage_over_time(
    pool: &DbPool,
    since: &str,
    persona_id: Option<&str>,
) -> Result<Vec<ToolUsageOverTime>, AppError> {
    timed_query!("tool_usage", "tool_usage::get_usage_over_time", {
        let conn = pool.conn("tool_usage::get_usage_over_time")?;
        let mut qb = QueryBuilder::new();
        qb.where_gte("created_at", since.to_string());
        if let Some(pid) = persona_id {
            qb.where_eq("persona_id", pid.to_string());
        }

        let sql = format!(
            "SELECT DATE(created_at) as date,
                tool_name,
                SUM(invocation_count) as invocations
         FROM persona_tool_usage
         {} AND {}
         GROUP BY date, tool_name
         ORDER BY date ASC, tool_name ASC",
            qb.where_clause(),
            internal_tools_exclusion("tool_name")
        );

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), |row| {
            Ok(ToolUsageOverTime {
                date: row.get("date")?,
                tool_name: row.get("tool_name")?,
                invocations: row.get("invocations")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_usage_by_persona(
    pool: &DbPool,
    since: &str,
) -> Result<Vec<PersonaUsageSummary>, AppError> {
    timed_query!("tool_usage", "tool_usage::get_usage_by_persona", {
        let conn = pool.conn("tool_usage::get_usage_by_persona")?;
        let sql = format!(
            "SELECT u.persona_id,
                p.name as persona_name,
                p.icon as persona_icon,
                p.color as persona_color,
                SUM(u.invocation_count) as total_invocations,
                COUNT(DISTINCT u.tool_name) as unique_tools
         FROM persona_tool_usage u
         JOIN personas p ON p.id = u.persona_id
         WHERE u.created_at >= ?1 AND {}
         GROUP BY u.persona_id
         ORDER BY total_invocations DESC",
            internal_tools_exclusion("u.tool_name")
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![since], |row| {
            Ok(PersonaUsageSummary {
                persona_id: row.get("persona_id")?,
                persona_name: row.get("persona_name")?,
                persona_icon: row.get("persona_icon")?,
                persona_color: row.get("persona_color")?,
                total_invocations: row.get("total_invocations")?,
                unique_tools: row.get("unique_tools")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::models::CreatePersonaInput;
    use crate::repos::{core::personas, execution::executions};

    #[test]
    fn test_tool_usage_crud() {
        let pool = init_test_db().unwrap();

        // Create a persona and execution first (required by FK)
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Tool Usage Test Agent".into(),
                system_prompt: "You are a test agent.".into(),
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
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();

        let exec = executions::create(&pool, &persona.id, None, None, None, None).unwrap();

        // Record tool usage
        let usage = record(&pool, &exec.id, &persona.id, "http_request", 5).unwrap();
        assert_eq!(usage.tool_name, "http_request");
        assert_eq!(usage.invocation_count, 5);
        assert_eq!(usage.execution_id, exec.id);
        assert_eq!(usage.persona_id, persona.id);

        // Record another tool
        let usage2 = record(&pool, &exec.id, &persona.id, "file_read", 3).unwrap();
        assert_eq!(usage2.tool_name, "file_read");
        assert_eq!(usage2.invocation_count, 3);

        // Get by execution
        let by_exec = get_by_execution(&pool, &exec.id).unwrap();
        assert_eq!(by_exec.len(), 2);

        // Empty execution
        let empty = get_by_execution(&pool, "nonexistent-exec").unwrap();
        assert_eq!(empty.len(), 0);
    }

    /// The projection must prepare against the real migrated schema AND carry
    /// every field `row_to_usage` reads. `SELECT *` could not fail either check
    /// by construction — a wildcard always matches, which is precisely why it
    /// hides a mid-table `ALTER TABLE ADD COLUMN` until a user hits it.
    #[test]
    fn projection_covers_every_field_the_mapper_reads() {
        let pool = init_test_db().unwrap();
        let conn = pool.conn("tool_usage::test").unwrap();
        conn.prepare(&format!("SELECT {COLUMNS} FROM persona_tool_usage LIMIT 0"))
            .unwrap_or_else(|e| panic!("persona_tool_usage projection does not match schema: {e}"));
        drop(conn);

        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Projection Agent".into(),
                system_prompt: "You are a test agent.".into(),
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
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();
        let exec = executions::create(&pool, &persona.id, None, None, None, None).unwrap();
        let written = record(&pool, &exec.id, &persona.id, "gmail", 4).unwrap();

        let read = get_by_execution(&pool, &exec.id).unwrap();
        assert_eq!(read.len(), 1);
        let got = &read[0];
        assert_eq!(got.id, written.id);
        assert_eq!(got.execution_id, exec.id);
        assert_eq!(got.persona_id, persona.id);
        assert_eq!(got.tool_name, "gmail");
        assert_eq!(got.invocation_count, 4);
        assert_eq!(got.created_at, written.created_at);
    }

    /// KP bridge (WP4): monthly connector totals group by tool, stay inside
    /// the current UTC calendar month, and drop internal CLI tools — the same
    /// axes the execution rollup uses.
    #[test]
    fn test_get_monthly_totals_by_tool_window_and_grouping() {
        use chrono::{Datelike, TimeZone, Utc};

        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "KP Connector Totals Agent".into(),
                system_prompt: "You are a test agent.".into(),
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
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();
        let exec = executions::create(&pool, &persona.id, None, None, None, None).unwrap();

        // In-month: gmail twice (3 + 2 calls), slack once, plus an internal
        // CLI tool that must not surface as a connector.
        record(&pool, &exec.id, &persona.id, "gmail", 3).unwrap();
        record(&pool, &exec.id, &persona.id, "gmail", 2).unwrap();
        record(&pool, &exec.id, &persona.id, "slack", 1).unwrap();
        record(&pool, &exec.id, &persona.id, "Bash", 7).unwrap();

        // Prior-month gmail row: backdate to just before the month boundary.
        let backdated = record(&pool, &exec.id, &persona.id, "gmail", 50).unwrap();
        let now = Utc::now();
        let prior = (Utc
            .with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
            .unwrap()
            - chrono::Duration::days(1))
        .to_rfc3339();
        pool.conn("tool_usage::test")
            .unwrap()
            .execute(
                "UPDATE persona_tool_usage SET created_at = ?1 WHERE id = ?2",
                params![prior, backdated.id],
            )
            .unwrap();

        let totals = get_monthly_totals_by_tool(&pool, &persona.id).unwrap();
        assert_eq!(
            totals,
            vec![("gmail".to_string(), 5), ("slack".to_string(), 1)]
        );

        // Unknown persona: empty, not an error.
        assert!(get_monthly_totals_by_tool(&pool, "nope")
            .unwrap()
            .is_empty());
    }
}
