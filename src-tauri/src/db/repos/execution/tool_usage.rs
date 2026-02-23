use rusqlite::{params, Row};

use crate::db::models::PersonaToolUsage;
use crate::db::DbPool;
use crate::error::AppError;

/// Internal CLI tools that should be excluded from usage analytics charts.
/// These are Claude Code's built-in tools, not persona-defined use-case tools.
const INTERNAL_TOOLS: &[&str] = &[
    "bash", "Bash",
    "read", "Read", "read_file",
    "write", "Write", "write_file",
    "edit", "Edit", "edit_file",
    "glob", "Glob",
    "grep", "Grep",
    "list_directory", "ListDirectory",
    "search_replace", "SearchReplace",
    "notebook_edit", "NotebookEdit",
    "web_search", "WebSearch",
    "web_fetch", "WebFetch",
    "todoread", "TodoRead", "todowrite", "TodoWrite",
];

/// Build a SQL NOT IN clause for excluding internal tools.
/// `col` is the column reference, e.g. "tool_name" or "u.tool_name".
fn internal_tools_exclusion(col: &str) -> String {
    let placeholders: Vec<String> = INTERNAL_TOOLS.iter().map(|t| format!("'{}'", t)).collect();
    format!("{} NOT IN ({})", col, placeholders.join(", "))
}

fn row_to_usage(row: &Row) -> rusqlite::Result<PersonaToolUsage> {
    Ok(PersonaToolUsage {
        id: row.get("id")?,
        execution_id: row.get("execution_id")?,
        persona_id: row.get("persona_id")?,
        tool_name: row.get("tool_name")?,
        invocation_count: row.get("invocation_count")?,
        created_at: row.get("created_at")?,
    })
}

pub fn record(
    pool: &DbPool,
    execution_id: &str,
    persona_id: &str,
    tool_name: &str,
    count: i32,
) -> Result<PersonaToolUsage, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
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
}

pub fn get_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<PersonaToolUsage>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_tool_usage
         WHERE execution_id = ?1
         ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![execution_id], row_to_usage)?;
    let usages = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(usages)
}

pub fn get_usage_summary(
    pool: &DbPool,
    since: &str,
    persona_id: Option<&str>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let conn = pool.get()?;
    let persona_clause = if persona_id.is_some() { " AND persona_id = ?2" } else { "" };
    let sql = format!(
        "SELECT tool_name,
                SUM(invocation_count) as total_invocations,
                COUNT(DISTINCT execution_id) as unique_executions,
                COUNT(DISTINCT persona_id) as unique_personas
         FROM persona_tool_usage
         WHERE created_at >= ?1 AND {}{}
         GROUP BY tool_name
         ORDER BY total_invocations DESC",
        internal_tools_exclusion("tool_name"),
        persona_clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(since.to_string())];
    if let Some(pid) = persona_id {
        param_values.push(Box::new(pid.to_string()));
    }
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(serde_json::json!({
            "tool_name": row.get::<_, String>("tool_name")?,
            "total_invocations": row.get::<_, i64>("total_invocations")?,
            "unique_executions": row.get::<_, i64>("unique_executions")?,
            "unique_personas": row.get::<_, i64>("unique_personas")?,
        }))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_usage_over_time(
    pool: &DbPool,
    since: &str,
    persona_id: Option<&str>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let conn = pool.get()?;
    let persona_clause = if persona_id.is_some() { " AND persona_id = ?2" } else { "" };
    let sql = format!(
        "SELECT DATE(created_at) as date,
                tool_name,
                SUM(invocation_count) as invocations
         FROM persona_tool_usage
         WHERE created_at >= ?1 AND {}{}
         GROUP BY date, tool_name
         ORDER BY date ASC, tool_name ASC",
        internal_tools_exclusion("tool_name"),
        persona_clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(since.to_string())];
    if let Some(pid) = persona_id {
        param_values.push(Box::new(pid.to_string()));
    }
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(serde_json::json!({
            "date": row.get::<_, String>("date")?,
            "tool_name": row.get::<_, String>("tool_name")?,
            "invocations": row.get::<_, i64>("invocations")?,
        }))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_usage_by_persona(
    pool: &DbPool,
    since: &str,
) -> Result<Vec<serde_json::Value>, AppError> {
    let conn = pool.get()?;
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
        Ok(serde_json::json!({
            "persona_id": row.get::<_, String>("persona_id")?,
            "persona_name": row.get::<_, String>("persona_name")?,
            "persona_icon": row.get::<_, Option<String>>("persona_icon")?,
            "persona_color": row.get::<_, Option<String>>("persona_color")?,
            "total_invocations": row.get::<_, i64>("total_invocations")?,
            "unique_tools": row.get::<_, i64>("unique_tools")?,
        }))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::{core::personas, execution::executions};

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
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let exec = executions::create(&pool, &persona.id, None, None, None).unwrap();

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
}
