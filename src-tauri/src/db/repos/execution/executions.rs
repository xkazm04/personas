use rusqlite::{params, Row};

use crate::db::models::{GlobalExecutionRow, PersonaExecution, UpdateExecutionStatus};
use crate::db::DbPool;
use crate::engine::types::ExecutionState;
use crate::error::AppError;

fn row_to_execution(row: &Row) -> rusqlite::Result<PersonaExecution> {
    Ok(PersonaExecution {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        trigger_id: row.get("trigger_id")?,
        use_case_id: row.get("use_case_id")?,
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
        execution_config: row.get("execution_config").unwrap_or(None),
    })
}

pub fn get_by_persona_id(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_by_persona_id", {
        let limit = limit.unwrap_or(50);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_executions WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![persona_id, limit], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Fetch executions across all personas in a single query with persona metadata.
/// Replaces the N+1 pattern of calling get_by_persona_id once per persona.
pub fn get_all_global(
    pool: &DbPool,
    limit: Option<i64>,
    status: Option<&str>,
    persona_id: Option<&str>,
) -> Result<Vec<GlobalExecutionRow>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_all_global", {
    let limit = limit.unwrap_or(200);
    let conn = pool.get()?;

    // Build query dynamically based on which filters are present.
    let base = "SELECT e.*, \
                COALESCE(p.name, 'Unknown') as persona_name, \
                p.icon as persona_icon, \
                p.color as persona_color \
             FROM persona_executions e \
             LEFT JOIN personas p ON p.id = e.persona_id";

    let mut conditions: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(s) = status {
        param_values.push(Box::new(s.to_string()));
        conditions.push(format!("e.status = ?{}", param_values.len()));
    }
    if let Some(pid) = persona_id {
        param_values.push(Box::new(pid.to_string()));
        conditions.push(format!("e.persona_id = ?{}", param_values.len()));
    }

    param_values.push(Box::new(limit));
    let limit_idx = param_values.len();

    let sql = if conditions.is_empty() {
        format!("{base} ORDER BY e.created_at DESC LIMIT ?{limit_idx}")
    } else {
        format!("{base} WHERE {} ORDER BY e.created_at DESC LIMIT ?{limit_idx}", conditions.join(" AND "))
    };

    let mut stmt = conn.prepare(&sql)?;

    let row_mapper = |row: &Row| -> rusqlite::Result<GlobalExecutionRow> {
        Ok(GlobalExecutionRow {
            id: row.get("id")?,
            persona_id: row.get("persona_id")?,
            trigger_id: row.get("trigger_id")?,
            use_case_id: row.get("use_case_id")?,
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
            execution_config: row.get("execution_config").unwrap_or(None),
            persona_name: row.get("persona_name")?,
            persona_icon: row.get("persona_icon")?,
            persona_color: row.get("persona_color")?,
        })
    };

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(param_refs.as_slice(), row_mapper)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaExecution, AppError> {
    timed_query!("persona_executions", "persona_executions::get_by_id", {
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
    })
}

pub fn create(
    pool: &DbPool,
    persona_id: &str,
    trigger_id: Option<String>,
    input_data: Option<String>,
    model_used: Option<String>,
    use_case_id: Option<String>,
) -> Result<PersonaExecution, AppError> {
    timed_query!("persona_executions", "persona_executions::create", {
        create_with_idempotency(pool, persona_id, trigger_id, input_data, model_used, use_case_id, None)
    })
}

/// Create an execution record with an optional idempotency key.
/// If `idempotency_key` is `Some` and an execution with that key already exists,
/// the existing record is returned instead of creating a duplicate.
pub fn create_with_idempotency(
    pool: &DbPool,
    persona_id: &str,
    trigger_id: Option<String>,
    input_data: Option<String>,
    model_used: Option<String>,
    use_case_id: Option<String>,
    idempotency_key: Option<String>,
) -> Result<PersonaExecution, AppError> {
    timed_query!("persona_executions", "persona_executions::create_with_idempotency", {
        // Check for existing execution with this idempotency key
        if let Some(ref key) = idempotency_key {
            if let Some(existing) = get_by_idempotency_key(pool, key)? {
                tracing::info!(
                    idempotency_key = %key,
                    execution_id = %existing.id,
                    "Returning existing execution for idempotency key (dedup)"
                );
                return Ok(existing);
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO persona_executions
             (id, persona_id, trigger_id, status, input_data, model_used, input_tokens, output_tokens, cost_usd, use_case_id, idempotency_key, created_at)
             VALUES (?1, ?2, ?3, 'queued', ?4, ?5, 0, 0, 0, ?6, ?7, ?8)",
            params![id, persona_id, trigger_id, input_data, model_used, use_case_id, idempotency_key, now],
        )?;

        get_by_id(pool, &id)
    })
}

/// Look up an execution by its idempotency key.
pub fn get_by_idempotency_key(
    pool: &DbPool,
    key: &str,
) -> Result<Option<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_by_idempotency_key", {
        let conn = pool.get()?;
        match conn.query_row(
            "SELECT * FROM persona_executions WHERE idempotency_key = ?1",
            params![key],
            row_to_execution,
        ) {
            Ok(exec) => Ok(Some(exec)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

pub fn get_by_trigger_id(
    pool: &DbPool,
    trigger_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_by_trigger_id", {
        let limit = limit.unwrap_or(10);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_executions WHERE trigger_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![trigger_id, limit], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn get_by_use_case_id(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_by_use_case_id", {
        let limit = limit.unwrap_or(20);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_executions WHERE persona_id = ?1 AND use_case_id = ?2 ORDER BY created_at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, use_case_id, limit], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn update_status(
    pool: &DbPool,
    id: &str,
    input: UpdateExecutionStatus,
) -> Result<(), AppError> {
    timed_query!("persona_executions", "persona_executions::update_status", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let started_at: Option<String> = if input.status == ExecutionState::Running {
            Some(now.clone())
        } else {
            None
        };

        let completed_at: Option<String> = if input.status.is_terminal() {
            Some(now)
        } else {
            None
        };

        // Serialize ExecutionState to its DB string form
        let status_str = input.status.as_str();

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
                tool_steps = COALESCE(?13, tool_steps),
                claude_session_id = COALESCE(?14, claude_session_id),
                execution_config = COALESCE(?15, execution_config)
             WHERE id = ?12",
            params![
                status_str,
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
                input.claude_session_id,
                input.execution_config,
            ],
        )?;

        Ok(())
    })
}

/// Compare-and-swap status update: only writes if the current DB status is `running`.
///
/// Returns `true` if the row was updated (status was running), `false` if
/// the execution had already transitioned to a terminal state and was left
/// untouched. This prevents the cancel safety-net from overwriting a final
/// status that the spawned task already wrote.
pub fn update_status_if_running(
    pool: &DbPool,
    id: &str,
    input: UpdateExecutionStatus,
) -> Result<bool, AppError> {
    timed_query!("persona_executions", "persona_executions::update_status_if_running", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let started_at: Option<String> = if input.status == ExecutionState::Running {
            Some(now.clone())
        } else {
            None
        };

        let completed_at: Option<String> = if input.status.is_terminal() {
            Some(now)
        } else {
            None
        };

        let status_str = input.status.as_str();

        let rows_changed = conn.execute(
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
                tool_steps = COALESCE(?13, tool_steps),
                claude_session_id = COALESCE(?14, claude_session_id),
                execution_config = COALESCE(?15, execution_config)
             WHERE id = ?12 AND status = 'running'",
            params![
                status_str,
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
                input.claude_session_id,
                input.execution_config,
            ],
        )?;

        Ok(rows_changed > 0)
    })
}

/// Compare-and-swap status update: only writes if the current DB status is
/// still active (`running` or `cancelled`-by-safety-net).
///
/// This allows the spawned task to enrich a bare cancel (written by the
/// safety-net without metrics) with full execution metrics, but prevents
/// overwriting a truly terminal status written by another code path.
pub fn update_status_if_not_final(
    pool: &DbPool,
    id: &str,
    input: UpdateExecutionStatus,
) -> Result<bool, AppError> {
    timed_query!("persona_executions", "persona_executions::update_status_if_not_final", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let started_at: Option<String> = if input.status == ExecutionState::Running {
            Some(now.clone())
        } else {
            None
        };

        let completed_at: Option<String> = if input.status.is_terminal() {
            Some(now)
        } else {
            None
        };

        let status_str = input.status.as_str();

        // Allow overwrite when status is 'running' (normal path) or 'cancelled'
        // (safety-net wrote a bare cancel that we can now enrich with metrics).
        let rows_changed = conn.execute(
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
                tool_steps = COALESCE(?13, tool_steps),
                claude_session_id = COALESCE(?14, claude_session_id),
                execution_config = COALESCE(?15, execution_config)
             WHERE id = ?12 AND status IN ('running', 'cancelled')",
            params![
                status_str,
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
                input.claude_session_id,
                input.execution_config,
            ],
        )?;

        Ok(rows_changed > 0)
    })
}

pub fn get_recent(pool: &DbPool, limit: Option<i64>) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_recent", {
        let limit = limit.unwrap_or(20);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_executions ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn get_recent_failures(
    pool: &DbPool,
    persona_id: &str,
    limit: i64,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_recent_failures", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_executions WHERE persona_id = ?1 AND status = 'failed' ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![persona_id, limit], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn get_running(pool: &DbPool) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_running", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_executions WHERE status IN ('queued', 'running') ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Lightweight check: are any executions currently in-flight?
/// Used by the adaptive polling system to decide between active/idle intervals.
pub fn has_running_executions(pool: &DbPool) -> Result<bool, AppError> {
    timed_query!("persona_executions", "persona_executions::has_running_executions", {
        let conn = pool.get()?;
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM persona_executions WHERE status IN ('queued', 'running'))",
            [],
            |row| row.get(0),
        )?;
        Ok(exists)
    })
}

pub fn get_running_count_for_persona(pool: &DbPool, persona_id: &str) -> Result<i64, AppError> {
    timed_query!("persona_executions", "persona_executions::get_running_count_for_persona", {
        let conn = pool.get()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM persona_executions WHERE persona_id = ?1 AND status IN ('queued', 'running')",
            params![persona_id],
            |row| row.get(0),
        )?;
        Ok(count)
    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("persona_executions", "persona_executions::delete", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM persona_executions WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

/// Create an execution record that is a healing retry of `original_exec_id`.
pub fn create_retry(
    pool: &DbPool,
    persona_id: &str,
    original_exec_id: &str,
    retry_count: i64,
) -> Result<PersonaExecution, AppError> {
    timed_query!("persona_executions", "persona_executions::create_retry", {
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
    })
}

/// Count consecutive recent failures for a persona (unbroken streak of 'failed' status
/// from the most recent execution backwards).
pub fn get_consecutive_failure_count(pool: &DbPool, persona_id: &str) -> Result<u32, AppError> {
    timed_query!("persona_executions", "persona_executions::get_consecutive_failure_count", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT status FROM persona_executions
             WHERE persona_id = ?1
             ORDER BY created_at DESC
             LIMIT 20",
        )?;
        let statuses: Vec<String> = stmt
            .query_map(params![persona_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();

        let count = statuses
            .iter()
            .take_while(|s| s.as_str() == "failed")
            .count();
        Ok(count as u32)
    })
}

/// Get the retry chain for an execution (all retries linked to the same original).
pub fn get_retry_chain(pool: &DbPool, execution_id: &str) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_retry_chain", {
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
    })
}

/// Batch-fetch retry chains for multiple execution IDs in a single query.
/// Returns a map from each input execution_id to its retry chain (executions
/// with retry_count > 0). This eliminates the N+1 pattern when building the
/// healing timeline.
pub fn get_retry_chains_batch(
    pool: &DbPool,
    execution_ids: &[&str],
) -> Result<std::collections::HashMap<String, Vec<PersonaExecution>>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_retry_chains_batch", {
    if execution_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let conn = pool.get()?;

    // Step 1: resolve root IDs for all requested execution_ids
    let placeholders: String = execution_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");

    let root_sql = format!(
        "SELECT id, retry_of_execution_id FROM persona_executions WHERE id IN ({placeholders})"
    );
    let params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = execution_ids
        .iter()
        .map(|id| Box::new(id.to_string()) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        params_boxed.iter().map(|p| p.as_ref()).collect();

    let mut root_stmt = conn.prepare(&root_sql)?;
    let root_rows = root_stmt.query_map(params_ref.as_slice(), |row| {
        let id: String = row.get(0)?;
        let retry_of: Option<String> = row.get(1)?;
        Ok((id, retry_of))
    })?;

    // Map: original exec_id -> root_id
    let mut exec_to_root: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut root_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for row in root_rows {
        let (id, retry_of) = row.map_err(AppError::Database)?;
        let root = retry_of.unwrap_or_else(|| id.clone());
        root_ids.insert(root.clone());
        exec_to_root.insert(id, root);
    }

    if root_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    // Step 2: fetch all retry executions for these roots in one query
    let root_list: Vec<&str> = root_ids.iter().map(|s| s.as_str()).collect();
    let root_placeholders: String = root_list
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");

    let chain_sql = format!(
        "SELECT * FROM persona_executions
         WHERE (id IN ({root_placeholders}) OR retry_of_execution_id IN ({root_placeholders}))
         ORDER BY retry_count ASC, created_at ASC",
        root_placeholders = root_placeholders
    );
    let root_params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = root_list
        .iter()
        .map(|id| Box::new(id.to_string()) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    // Duplicate for both IN clauses
    let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    for p in &root_params_boxed {
        all_params.push(Box::new(p.as_ref().to_sql().unwrap().to_owned()));
    }
    for p in &root_params_boxed {
        all_params.push(Box::new(p.as_ref().to_sql().unwrap().to_owned()));
    }

    // Use simpler approach: single IN clause with OR
    let chain_sql = format!(
        "SELECT * FROM persona_executions
         WHERE id IN ({placeholders}) OR retry_of_execution_id IN ({placeholders})
         ORDER BY retry_count ASC, created_at ASC",
        placeholders = root_placeholders
    );
    // Params need to be repeated for both IN clauses
    let mut chain_params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    for id in &root_list {
        chain_params_boxed.push(Box::new(id.to_string()));
    }
    for id in &root_list {
        chain_params_boxed.push(Box::new(id.to_string()));
    }
    let chain_params_ref: Vec<&dyn rusqlite::types::ToSql> =
        chain_params_boxed.iter().map(|p| p.as_ref()).collect();

    let mut chain_stmt = conn.prepare(&chain_sql)?;
    let chain_rows = chain_stmt.query_map(chain_params_ref.as_slice(), row_to_execution)?;
    let all_executions: Vec<PersonaExecution> =
        crate::db::repos::utils::collect_rows(chain_rows, "retry_chains_batch");

    // Step 3: group by root_id, then map back to original exec_ids
    let mut root_to_chain: std::collections::HashMap<String, Vec<PersonaExecution>> =
        std::collections::HashMap::new();
    for exec in all_executions {
        let root = exec
            .retry_of_execution_id
            .as_deref()
            .unwrap_or(&exec.id)
            .to_string();
        root_to_chain.entry(root).or_default().push(exec);
    }

    // Build result keyed by original execution_id
    let mut result: std::collections::HashMap<String, Vec<PersonaExecution>> =
        std::collections::HashMap::new();
    for (exec_id, root_id) in &exec_to_root {
        if let Some(chain) = root_to_chain.get(root_id) {
            result.insert(exec_id.clone(), chain.clone());
        }
    }

    Ok(result)
    })
}

pub fn get_monthly_spend(pool: &DbPool, persona_id: &str) -> Result<f64, AppError> {
    timed_query!("persona_executions", "persona_executions::get_monthly_spend", {
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
    })
}

/// Default zombie threshold: 30 minutes.
const DEFAULT_ZOMBIE_THRESHOLD_SECS: i64 = 30 * 60;

/// Find executions stuck in 'running' state for longer than the zombie threshold
/// and transition them to 'incomplete'. Returns the IDs of transitioned executions.
pub fn sweep_zombie_executions(pool: &DbPool) -> Result<Vec<String>, AppError> {
    timed_query!("persona_executions", "persona_executions::sweep_zombie_executions", {
    let conn = pool.get()?;
    let now = chrono::Utc::now();
    let threshold_secs = DEFAULT_ZOMBIE_THRESHOLD_SECS;

    // Find running executions whose started_at is older than the threshold
    let mut stmt = conn.prepare(
        "SELECT id, started_at FROM persona_executions WHERE status = 'running'"
    )?;
    let candidates: Vec<(String, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut zombie_ids = Vec::new();
    for (id, started_at) in candidates {
        let is_zombie = match &started_at {
            Some(ts) => {
                if let Ok(started) = chrono::DateTime::parse_from_rfc3339(ts) {
                    (now - started.with_timezone(&chrono::Utc)).num_seconds() > threshold_secs
                } else {
                    // Unparseable timestamp — treat as zombie
                    true
                }
            }
            None => {
                // No started_at — check created_at instead (shouldn't happen, but defensive)
                true
            }
        };

        if is_zombie {
            let elapsed_str = started_at
                .as_deref()
                .unwrap_or("unknown");
            conn.execute(
                "UPDATE persona_executions SET
                    status = 'incomplete',
                    error_message = ?1,
                    completed_at = ?2
                 WHERE id = ?3 AND status = 'running'",
                params![
                    format!(
                        "Execution stalled: running since {} (>{} min) — marked as zombie",
                        elapsed_str,
                        threshold_secs / 60,
                    ),
                    now.to_rfc3339(),
                    id,
                ],
            )?;
            zombie_ids.push(id);
        }
    }

    Ok(zombie_ids)
    })
}

/// Delete old terminal executions beyond the retention period, but always keep
/// at least `min_keep_per_persona` most-recent records for each persona.
///
/// Only deletes executions with terminal status (completed, failed, incomplete,
/// cancelled) -- queued/running executions are never cleaned up.
///
/// Returns the total number of rows deleted.
pub fn cleanup_old_executions(
    pool: &DbPool,
    retention_days: i64,
    min_keep_per_persona: usize,
) -> Result<usize, AppError> {
    timed_query!("persona_executions", "persona_executions::cleanup_old_executions", {
    let conn = pool.get()?;

    // Two-phase approach:
    // 1. Find all persona_ids that have terminal executions older than the cutoff.
    // 2. For each persona, delete old terminal executions while preserving the
    //    most recent `min_keep_per_persona` rows.

    let cutoff = format!("-{retention_days} days");

    // Get distinct persona_ids with old terminal executions
    let mut persona_stmt = conn.prepare(
        "SELECT DISTINCT persona_id FROM persona_executions
         WHERE status IN ('completed', 'failed', 'incomplete', 'cancelled')
           AND created_at < datetime('now', ?1)",
    )?;
    let persona_ids: Vec<String> = persona_stmt
        .query_map(params![cutoff], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut total_deleted: usize = 0;

    for pid in &persona_ids {
        // Find the created_at threshold: the min_keep_per_persona-th most recent
        // terminal execution for this persona. Anything older AND beyond the
        // retention cutoff gets deleted.
        let keep_threshold: Option<String> = conn
            .query_row(
                "SELECT created_at FROM persona_executions
                 WHERE persona_id = ?1
                   AND status IN ('completed', 'failed', 'incomplete', 'cancelled')
                 ORDER BY created_at DESC
                 LIMIT 1 OFFSET ?2",
                params![pid, min_keep_per_persona as i64],
                |row| row.get(0),
            )
            .ok();

        // If there aren't enough rows to reach the offset, this persona has
        // fewer than min_keep_per_persona terminal executions -- skip it.
        let keep_threshold = match keep_threshold {
            Some(t) => t,
            None => continue,
        };

        let deleted = conn.execute(
            "DELETE FROM persona_executions
             WHERE persona_id = ?1
               AND status IN ('completed', 'failed', 'incomplete', 'cancelled')
               AND created_at < datetime('now', ?2)
               AND created_at <= ?3",
            params![pid, cutoff, keep_threshold],
        )?;

        total_deleted += deleted;
    }

    Ok(total_deleted)
    })
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
            None,
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
                status: ExecutionState::Running,
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
                status: ExecutionState::Completed,
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
