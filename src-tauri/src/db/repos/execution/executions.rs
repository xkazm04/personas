use rusqlite::{params, Row};

use crate::db::models::{PersonaExecution, UpdateExecutionStatus};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_execution(row: &Row) -> rusqlite::Result<PersonaExecution> {
    Ok(PersonaExecution {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        trigger_id: row.get("trigger_id")?,
        status: row.get("status")?,
        input_data: row.get("input_data")?,
        output_data: row.get("output_data")?,
        claude_session_id: row.get("claude_session_id")?,
        log_file_path: row.get("log_file_path")?,
        execution_flows: row.get("execution_flows")?,
        model_used: row.get("model_used")?,
        input_tokens: row.get::<_, Option<i64>>("input_tokens")?.unwrap_or(0),
        output_tokens: row.get::<_, Option<i64>>("output_tokens")?.unwrap_or(0),
        cost_usd: row.get::<_, Option<f64>>("cost_usd")?.unwrap_or(0.0),
        error_message: row.get("error_message")?,
        duration_ms: row.get("duration_ms")?,
        tool_steps: row.get("tool_steps")?,
        retry_of_execution_id: row.get("retry_of_execution_id")?,
        retry_count: row.get::<_, Option<i64>>("retry_count")?.unwrap_or(0),
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        created_at: row.get("created_at")?,
    })
}

pub fn get_by_persona_id(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    let limit = limit.unwrap_or(50);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_executions WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], row_to_execution)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaExecution, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_executions WHERE id = ?1",
        params![id],
        row_to_execution,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Execution {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create(
    pool: &DbPool,
    persona_id: &str,
    trigger_id: Option<String>,
    input_data: Option<String>,
    model_used: Option<String>,
) -> Result<PersonaExecution, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_executions
         (id, persona_id, trigger_id, status, input_data, model_used, input_tokens, output_tokens, cost_usd, created_at)
         VALUES (?1, ?2, ?3, 'queued', ?4, ?5, 0, 0, 0, ?6)",
        params![id, persona_id, trigger_id, input_data, model_used, now],
    )?;

    get_by_id(pool, &id)
}

pub fn update_status(
    pool: &DbPool,
    id: &str,
    input: UpdateExecutionStatus,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let started_at: Option<String> = if input.status == "running" {
        Some(now.clone())
    } else {
        None
    };

    let completed_at: Option<String> =
        if ["completed", "failed", "cancelled", "incomplete"].contains(&input.status.as_str()) {
            Some(now)
        } else {
            None
        };

    conn.execute(
        "UPDATE persona_executions SET
            status = ?1,
            output_data = COALESCE(?2, output_data),
            error_message = COALESCE(?3, error_message),
            duration_ms = COALESCE(?4, duration_ms),
            log_file_path = COALESCE(?5, log_file_path),
            execution_flows = COALESCE(?6, execution_flows),
            input_tokens = COALESCE(?7, input_tokens),
            output_tokens = COALESCE(?8, output_tokens),
            cost_usd = COALESCE(?9, cost_usd),
            started_at = COALESCE(?10, started_at),
            completed_at = COALESCE(?11, completed_at),
            tool_steps = COALESCE(?13, tool_steps)
         WHERE id = ?12",
        params![
            input.status,
            input.output_data,
            input.error_message,
            input.duration_ms,
            input.log_file_path,
            input.execution_flows,
            input.input_tokens,
            input.output_tokens,
            input.cost_usd,
            started_at,
            completed_at,
            id,
            input.tool_steps,
        ],
    )?;

    Ok(())
}

pub fn get_recent(pool: &DbPool, limit: Option<i64>) -> Result<Vec<PersonaExecution>, AppError> {
    let limit = limit.unwrap_or(20);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_executions ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], row_to_execution)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_recent_failures(
    pool: &DbPool,
    persona_id: &str,
    limit: i64,
) -> Result<Vec<PersonaExecution>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_executions WHERE persona_id = ?1 AND status = 'failed' ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], row_to_execution)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_running(pool: &DbPool) -> Result<Vec<PersonaExecution>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_executions WHERE status IN ('queued', 'running') ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], row_to_execution)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_running_count_for_persona(pool: &DbPool, persona_id: &str) -> Result<i64, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persona_executions WHERE persona_id = ?1 AND status IN ('queued', 'running')",
        params![persona_id],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM persona_executions WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// Create an execution record that is a healing retry of `original_exec_id`.
pub fn create_retry(
    pool: &DbPool,
    persona_id: &str,
    original_exec_id: &str,
    retry_count: i64,
) -> Result<PersonaExecution, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_executions
         (id, persona_id, status, input_tokens, output_tokens, cost_usd, retry_of_execution_id, retry_count, created_at)
         VALUES (?1, ?2, 'queued', 0, 0, 0, ?3, ?4, ?5)",
        params![id, persona_id, original_exec_id, retry_count, now],
    )?;

    get_by_id(pool, &id)
}

/// Count consecutive recent failures for a persona (unbroken streak of 'failed' status).
pub fn get_consecutive_failure_count(pool: &DbPool, persona_id: &str) -> Result<i64, AppError> {
    let conn = pool.get()?;
    // Count recent executions that are 'failed' until the first non-failed one
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM (
            SELECT status FROM persona_executions
            WHERE persona_id = ?1
            ORDER BY created_at DESC
            LIMIT 20
        ) sub
        WHERE status = 'failed'
        AND NOT EXISTS (
            SELECT 1 FROM persona_executions e2
            WHERE e2.persona_id = ?1
            AND e2.status IN ('completed', 'running', 'queued')
            AND e2.created_at > (
                SELECT MIN(created_at) FROM (
                    SELECT created_at FROM persona_executions
                    WHERE persona_id = ?1 AND status = 'failed'
                    ORDER BY created_at DESC
                    LIMIT 1
                )
            )
        )",
        params![persona_id],
        |row| row.get(0),
    ).unwrap_or(0);
    Ok(count)
}

/// Get the retry chain for an execution (all retries linked to the same original).
pub fn get_retry_chain(pool: &DbPool, execution_id: &str) -> Result<Vec<PersonaExecution>, AppError> {
    // First, find the root execution
    let exec = get_by_id(pool, execution_id)?;
    let root_id = exec.retry_of_execution_id.as_deref().unwrap_or(execution_id);

    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_executions
         WHERE id = ?1 OR retry_of_execution_id = ?1
         ORDER BY retry_count ASC, created_at ASC",
    )?;
    let rows = stmt.query_map(params![root_id], row_to_execution)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_monthly_spend(pool: &DbPool, persona_id: &str) -> Result<f64, AppError> {
    let conn = pool.get()?;
    // Include completed, failed, incomplete, and cancelled executions in spend
    // tracking. Cancelled executions may have consumed API credits before the
    // process was killed, and those costs must count toward budget enforcement.
    let spend: f64 = conn.query_row(
        "SELECT COALESCE(SUM(cost_usd), 0.0) FROM persona_executions
         WHERE persona_id = ?1 AND status IN ('completed', 'failed', 'incomplete', 'cancelled')
         AND created_at >= datetime('now', 'start of month')",
        params![persona_id],
        |row| row.get(0),
    )?;
    Ok(spend)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::repos::core::personas;
    use crate::db::models::CreatePersonaInput;

    #[test]
    fn test_execution_crud() {
        let pool = init_test_db().unwrap();

        // Create a persona first (required by FK)
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Exec Test Agent".into(),
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

        // Create execution
        let exec = create(
            &pool,
            &persona.id,
            None,
            Some("test input".into()),
            Some("claude-sonnet".into()),
        )
        .unwrap();
        assert_eq!(exec.status, "queued");
        assert_eq!(exec.persona_id, persona.id);
        assert_eq!(exec.input_data, Some("test input".into()));
        assert_eq!(exec.model_used, Some("claude-sonnet".into()));
        assert_eq!(exec.input_tokens, 0);
        assert_eq!(exec.output_tokens, 0);
        assert!(exec.started_at.is_none());

        // Get by id
        let fetched = get_by_id(&pool, &exec.id).unwrap();
        assert_eq!(fetched.id, exec.id);

        // Get by persona id
        let by_persona = get_by_persona_id(&pool, &persona.id, None).unwrap();
        assert_eq!(by_persona.len(), 1);

        // Get running
        let running = get_running(&pool).unwrap();
        assert_eq!(running.len(), 1); // queued counts as running

        // Get running count for persona
        let count = get_running_count_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(count, 1);

        // Update status to running
        update_status(
            &pool,
            &exec.id,
            UpdateExecutionStatus {
                status: "running".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let updated = get_by_id(&pool, &exec.id).unwrap();
        assert_eq!(updated.status, "running");
        assert!(updated.started_at.is_some());
        assert!(updated.completed_at.is_none());

        // Update status to completed with token data
        update_status(
            &pool,
            &exec.id,
            UpdateExecutionStatus {
                status: "completed".into(),
                output_data: Some("output result".into()),
                duration_ms: Some(1500),
                log_file_path: Some("/tmp/log.txt".into()),
                execution_flows: Some("{\"flows\": []}".into()),
                input_tokens: Some(100),
                output_tokens: Some(200),
                cost_usd: Some(0.005),
                ..Default::default()
            },
        )
        .unwrap();
        let completed = get_by_id(&pool, &exec.id).unwrap();
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.output_data, Some("output result".into()));
        assert_eq!(completed.duration_ms, Some(1500));
        assert_eq!(completed.input_tokens, 100);
        assert_eq!(completed.output_tokens, 200);
        assert!((completed.cost_usd - 0.005).abs() < f64::EPSILON);
        assert!(completed.completed_at.is_some());

        // Get recent
        let recent = get_recent(&pool, Some(10)).unwrap();
        assert_eq!(recent.len(), 1);

        // After completion, running count should be 0
        let count_after = get_running_count_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(count_after, 0);

        // Delete
        let deleted = delete(&pool, &exec.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &exec.id).is_err());
    }
}
