use rusqlite::{params, Row};

use crate::db::models::{
    ExecutionCounts, ExecutionListItem, ExecutionSearchResult, GlobalExecutionRow,
    PersonaExecution, UpdateExecutionStatus,
};
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
        log_truncated: row
            .get::<_, Option<bool>>("log_truncated")?
            .unwrap_or(false),
        is_simulation: row
            .get::<_, Option<bool>>("is_simulation")?
            .unwrap_or(false),
        business_outcome: row
            .get::<_, Option<String>>("business_outcome")?
            .unwrap_or_else(|| "unknown".to_string()),
    })
}

fn row_to_execution_list_item(row: &Row) -> rusqlite::Result<ExecutionListItem> {
    Ok(ExecutionListItem {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        use_case_id: row.get("use_case_id")?,
        status: row.get("status")?,
        input_tokens: row.get::<_, Option<i64>>("input_tokens")?.unwrap_or(0),
        output_tokens: row.get::<_, Option<i64>>("output_tokens")?.unwrap_or(0),
        cost_usd: row.get::<_, Option<f64>>("cost_usd")?.unwrap_or(0.0),
        error_message: row.get("error_message")?,
        duration_ms: row.get("duration_ms")?,
        retry_of_execution_id: row.get("retry_of_execution_id")?,
        retry_count: row.get::<_, Option<i64>>("retry_count")?.unwrap_or(0),
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        created_at: row.get("created_at")?,
        is_simulation: row
            .get::<_, Option<bool>>("is_simulation")?
            .unwrap_or(false),
        business_outcome: row
            .get::<_, Option<String>>("business_outcome")?
            .unwrap_or_else(|| "unknown".to_string()),
    })
}

fn build_fts5_query(query: &str) -> String {
    query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| token.len() >= 2)
        .take(12)
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

pub fn get_by_persona_id(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_by_persona_id",
        {
            let limit = limit.unwrap_or(50);
            let conn = pool.get()?;
            // Exclude ops chat executions (input_data contains "_ops") — those are
            // conversational queries from the Chat tab, not real agent executions.
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_executions
             WHERE persona_id = ?1
               AND (input_data IS NULL OR input_data NOT LIKE '%\"_ops\"%')
             ORDER BY created_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![persona_id, limit], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn list_items_by_persona_id(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<ExecutionListItem>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::list_items_by_persona_id",
        {
            let limit = limit.unwrap_or(50);
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT
                 id,
                 persona_id,
                 use_case_id,
                 status,
                 input_tokens,
                 output_tokens,
                 cost_usd,
                 error_message,
                 duration_ms,
                 retry_of_execution_id,
                 retry_count,
                 started_at,
                 completed_at,
                 created_at,
                 is_simulation
             FROM persona_executions
             WHERE persona_id = ?1
               AND (input_data IS NULL OR input_data NOT LIKE '%\"_ops\"%')
             ORDER BY created_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![persona_id, limit], row_to_execution_list_item)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Fetch executions across all personas in a single query with persona metadata.
/// Replaces the N+1 pattern of calling get_by_persona_id once per persona.
pub fn get_all_global(
    pool: &DbPool,
    limit: Option<i64>,
    status: Option<&str>,
    persona_id: Option<&str>,
) -> Result<Vec<GlobalExecutionRow>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_all_global",
        {
            let limit = limit.unwrap_or(200);
            let conn = pool.get()?;

            let base = "SELECT e.*, \
                COALESCE(p.name, 'Unknown') as persona_name, \
                p.icon as persona_icon, \
                p.color as persona_color \
             FROM persona_executions e \
             LEFT JOIN personas p ON p.id = e.persona_id";

            let mut qb = crate::db::query_builder::QueryBuilder::new();

            // Exclude ops chat executions from all execution lists
            qb.where_raw(
                |_| "(e.input_data IS NULL OR e.input_data NOT LIKE '%\"_ops\"%')".to_string(),
                vec![],
            );
            if let Some(s) = status {
                qb.where_eq("e.status", s.to_string());
            }
            if let Some(pid) = persona_id {
                qb.where_eq("e.persona_id", pid.to_string());
            }
            qb.order_by("e.created_at", "DESC");
            qb.limit(limit);

            let sql = qb.build_select(base);
            let mut stmt = conn.prepare_cached(&sql)?;

            // Read the 24 PersonaExecution columns via the shared mapper, then
            // tack on the 3 JOIN-only persona-metadata columns. Keeps the
            // nullable-column boilerplate (input_tokens/output_tokens/cost_usd/
            // log_truncated/business_outcome unwraps) in one place — a new
            // column on persona_executions touches one site, not two.
            let row_mapper = |row: &Row| -> rusqlite::Result<GlobalExecutionRow> {
                let base = row_to_execution(row)?;
                Ok(GlobalExecutionRow {
                    id: base.id,
                    persona_id: base.persona_id,
                    trigger_id: base.trigger_id,
                    use_case_id: base.use_case_id,
                    status: base.status,
                    input_data: base.input_data,
                    output_data: base.output_data,
                    claude_session_id: base.claude_session_id,
                    log_file_path: base.log_file_path,
                    execution_flows: base.execution_flows,
                    model_used: base.model_used,
                    input_tokens: base.input_tokens,
                    output_tokens: base.output_tokens,
                    cost_usd: base.cost_usd,
                    error_message: base.error_message,
                    duration_ms: base.duration_ms,
                    tool_steps: base.tool_steps,
                    retry_of_execution_id: base.retry_of_execution_id,
                    retry_count: base.retry_count,
                    started_at: base.started_at,
                    completed_at: base.completed_at,
                    created_at: base.created_at,
                    execution_config: base.execution_config,
                    log_truncated: base.log_truncated,
                    is_simulation: base.is_simulation,
                    business_outcome: base.business_outcome,
                    persona_name: row.get("persona_name")?,
                    persona_icon: row.get("persona_icon")?,
                    persona_color: row.get("persona_color")?,
                })
            };

            let rows = stmt.query_map(qb.params_ref().as_slice(), row_mapper)?;

            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Aggregate execution counts by high-level status bucket, optionally
/// filtered to a single persona. Returns precise server-side totals so the
/// Activity filter badges do not depend on how many rows have been paged in.
pub fn count_all_global(
    pool: &DbPool,
    persona_id: Option<&str>,
) -> Result<ExecutionCounts, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::count_all_global",
        {
            let conn = pool.get()?;
            let mut sql = String::from(
                "SELECT status, COUNT(*) AS n FROM persona_executions \
             WHERE (input_data IS NULL OR input_data NOT LIKE '%\"_ops\"%')",
            );
            if persona_id.is_some() {
                sql.push_str(" AND persona_id = ?1");
            }
            sql.push_str(" GROUP BY status");

            let mut stmt = conn.prepare_cached(&sql)?;
            let mut counts = ExecutionCounts::default();
            let map_row = |row: &Row| -> rusqlite::Result<(String, i64)> {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            };

            let iter: Box<dyn Iterator<Item = rusqlite::Result<(String, i64)>>> =
                if let Some(pid) = persona_id {
                    Box::new(stmt.query_map(params![pid], map_row)?)
                } else {
                    Box::new(stmt.query_map([], map_row)?)
                };

            for row in iter {
                let (status, n) = row.map_err(AppError::Database)?;
                counts.total += n;
                match status.as_str() {
                    "running" | "pending" => counts.running += n,
                    "completed" => counts.completed += n,
                    "failed" => counts.failed += n,
                    _ => {}
                }
            }
            Ok(counts)
        }
    )
}

pub fn search(
    pool: &DbPool,
    query: &str,
    limit: Option<i64>,
    persona_id: Option<&str>,
) -> Result<Vec<ExecutionSearchResult>, AppError> {
    timed_query!("persona_executions", "persona_executions::search", {
        let fts_query = build_fts5_query(query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }

        let limit = limit.unwrap_or(50).clamp(1, 200);
        let conn = pool.get()?;
        let mut sql = String::from(
            "SELECT e.id,
                    e.persona_id,
                    p.name AS persona_name,
                    p.icon AS persona_icon,
                    p.color AS persona_color,
                    e.use_case_id,
                    e.status,
                    snippet(executions_fts, -1, '<mark>', '</mark>', '...', 18) AS excerpt,
                    e.created_at,
                    e.completed_at
             FROM executions_fts
             JOIN persona_executions e ON e.rowid = executions_fts.rowid
             LEFT JOIN personas p ON p.id = e.persona_id
             WHERE executions_fts MATCH ?1
               AND (e.input_data IS NULL OR e.input_data NOT LIKE '%\"_ops\"%')",
        );
        if persona_id.is_some() {
            sql.push_str(" AND e.persona_id = ?2");
            sql.push_str(" ORDER BY bm25(executions_fts) ASC, e.created_at DESC LIMIT ?3");
        } else {
            sql.push_str(" ORDER BY bm25(executions_fts) ASC, e.created_at DESC LIMIT ?2");
        }

        let mut stmt = conn.prepare_cached(&sql)?;
        let mut rows = if let Some(persona_id) = persona_id {
            stmt.query(params![fts_query, persona_id, limit])?
        } else {
            stmt.query(params![fts_query, limit])?
        };

        let mut results = Vec::new();
        while let Some(row) = rows.next()? {
            results.push(ExecutionSearchResult {
                id: row.get("id")?,
                persona_id: row.get("persona_id")?,
                persona_name: row.get("persona_name")?,
                persona_icon: row.get("persona_icon")?,
                persona_color: row.get("persona_color")?,
                use_case_id: row.get("use_case_id")?,
                status: row.get("status")?,
                excerpt: row.get("excerpt")?,
                created_at: row.get("created_at")?,
                completed_at: row.get("completed_at")?,
            });
        }
        Ok(results)
    })
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaExecution, AppError> {
    timed_query!("persona_executions", "persona_executions::get_by_id", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached("SELECT * FROM persona_executions WHERE id = ?1")?;
        stmt.query_row(params![id], row_to_execution)
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
        create_with_idempotency(
            pool,
            persona_id,
            trigger_id,
            input_data,
            model_used,
            use_case_id,
            None,
            false,
        )
    })
}

/// Create an execution record with an optional idempotency key.
/// If `idempotency_key` is `Some` and an execution with that key already exists,
/// the existing record is returned instead of creating a duplicate.
///
/// `is_simulation` — Phase C3: when `true` the execution is flagged as a
/// simulation. Dispatch skips real notification delivery; activity feeds
/// filter these rows out by default.
pub fn create_with_idempotency(
    pool: &DbPool,
    persona_id: &str,
    trigger_id: Option<String>,
    input_data: Option<String>,
    model_used: Option<String>,
    use_case_id: Option<String>,
    idempotency_key: Option<String>,
    is_simulation: bool,
) -> Result<PersonaExecution, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::create_with_idempotency",
        {
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
            let mut stmt = conn.prepare_cached(
            "INSERT INTO persona_executions
             (id, persona_id, trigger_id, status, input_data, model_used, input_tokens, output_tokens, cost_usd, use_case_id, idempotency_key, is_simulation, created_at)
             VALUES (?1, ?2, ?3, 'queued', ?4, ?5, 0, 0, 0, ?6, ?7, ?8, ?9)",
            )?;
            stmt.execute(params![
                id,
                persona_id,
                trigger_id,
                input_data,
                model_used,
                use_case_id,
                idempotency_key,
                is_simulation as i64,
                now
            ])?;

            get_by_id(pool, &id)
        }
    )
}

/// Look up an execution by its idempotency key.
pub fn get_by_idempotency_key(
    pool: &DbPool,
    key: &str,
) -> Result<Option<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_by_idempotency_key",
        {
            let conn = pool.get()?;
            let mut stmt =
                conn.prepare_cached("SELECT * FROM persona_executions WHERE idempotency_key = ?1")?;
            match stmt.query_row(params![key], row_to_execution) {
                Ok(exec) => Ok(Some(exec)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(AppError::Database(e)),
            }
        }
    )
}

pub fn get_by_trigger_id(
    pool: &DbPool,
    trigger_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_by_trigger_id",
        {
            let limit = limit.unwrap_or(10);
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_executions WHERE trigger_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
            let rows = stmt.query_map(params![trigger_id, limit], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn get_by_use_case_id(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_by_use_case_id",
        {
            let limit = limit.unwrap_or(20);
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_executions WHERE persona_id = ?1 AND use_case_id = ?2 ORDER BY created_at DESC LIMIT ?3",
        )?;
            let rows = stmt.query_map(params![persona_id, use_case_id, limit], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Run an UPDATE on persona_executions with an optional WHERE-clause guard
/// (compare-and-swap pattern). The guard string is spliced after `WHERE id = ?12`;
/// pass `""` for an unconditional update or `" AND status = 'running'"` etc.
/// for a CAS variant.
///
/// Returns the number of rows that actually changed — callers can compare with
/// 0 to detect that the CAS lost. Single source of truth for the column list
/// and param tuple; adding a new column touches one SQL string instead of three.
fn update_status_with_guard(
    pool: &DbPool,
    id: &str,
    input: UpdateExecutionStatus,
    guard_sql: &str,
    timed_label: &'static str,
) -> Result<usize, AppError> {
    timed_query!("persona_executions", timed_label, {
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

        let sql = format!(
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
                execution_config = COALESCE(?15, execution_config),
                log_truncated = ?16,
                business_outcome = COALESCE(?17, business_outcome)
             WHERE id = ?12{}",
            guard_sql,
        );

        let mut stmt = conn.prepare_cached(&sql)?;
        let rows_changed = stmt.execute(params![
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
            input.log_truncated,
            input.business_outcome,
        ])?;

        Ok(rows_changed)
    })
}

pub fn update_status(
    pool: &DbPool,
    id: &str,
    input: UpdateExecutionStatus,
) -> Result<(), AppError> {
    update_status_with_guard(pool, id, input, "", "persona_executions::update_status")?;
    Ok(())
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
    let rows = update_status_with_guard(
        pool,
        id,
        input,
        " AND status = 'running'",
        "persona_executions::update_status_if_running",
    )?;
    Ok(rows > 0)
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
    let rows = update_status_with_guard(
        pool,
        id,
        input,
        " AND status IN ('running', 'cancelled')",
        "persona_executions::update_status_if_not_final",
    )?;
    Ok(rows > 0)
}

pub fn get_recent(pool: &DbPool, limit: Option<i64>) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_recent", {
        let limit = limit.unwrap_or(20);
        let conn = pool.get()?;
        let mut stmt = conn
            .prepare_cached("SELECT * FROM persona_executions ORDER BY created_at DESC LIMIT ?1")?;
        let rows = stmt.query_map(params![limit], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_recent_failures(
    pool: &DbPool,
    persona_id: &str,
    limit: i64,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_recent_failures",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_executions WHERE persona_id = ?1 AND status = 'failed' ORDER BY created_at DESC LIMIT ?2",
        )?;
            let rows = stmt.query_map(params![persona_id, limit], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn get_running(pool: &DbPool) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!("persona_executions", "persona_executions::get_running", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_executions WHERE status IN ('queued', 'running') ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], row_to_execution)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Lightweight check: are any executions currently in-flight?
/// Used by the adaptive polling system to decide between active/idle intervals.
pub fn has_running_executions(pool: &DbPool) -> Result<bool, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::has_running_executions",
        {
            let conn = pool.get()?;
            let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM persona_executions WHERE status IN ('queued', 'running'))",
            [],
            |row| row.get(0),
        )?;
            Ok(exists)
        }
    )
}

pub fn get_running_count_for_persona(pool: &DbPool, persona_id: &str) -> Result<i64, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_running_count_for_persona",
        {
            let conn = pool.get()?;
            let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM persona_executions WHERE persona_id = ?1 AND status IN ('queued', 'running')",
            params![persona_id],
            |row| row.get(0),
        )?;
            Ok(count)
        }
    )
}

pub fn count_for_persona_since(
    pool: &DbPool,
    persona_id: &str,
    since_rfc3339: &str,
) -> Result<i64, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::count_for_persona_since",
        {
            let conn = pool.get()?;
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM persona_executions WHERE persona_id = ?1 AND created_at >= ?2",
                params![persona_id, since_rfc3339],
                |row| row.get(0),
            )?;
            Ok(count)
        }
    )
}

/// Capability-scoped running-count: how many executions are queued/running for
/// this exact (persona_id, use_case_id) pair. Used by the event-bus cascade
/// guard so that a UC1→UC2 chain within the same persona isn't blocked by
/// UC1 still being in-flight when its emitted event lands.
pub fn get_running_count_for_persona_use_case(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: &str,
) -> Result<i64, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_running_count_for_persona_use_case",
        {
            let conn = pool.get()?;
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM persona_executions \
             WHERE persona_id = ?1 AND use_case_id = ?2 AND status IN ('queued', 'running')",
                params![persona_id, use_case_id],
                |row| row.get(0),
            )?;
            Ok(count)
        }
    )
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("persona_executions", "persona_executions::delete", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM persona_executions WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

/// Persist the W3C traceparent header generated for an execution so downstream
/// observability pipelines can correlate personas' trace with the CLI's spans.
/// Called near execution start, after `create()`.
pub fn set_traceparent(
    pool: &DbPool,
    execution_id: &str,
    traceparent: &str,
) -> Result<(), AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::set_traceparent",
        {
            let conn = pool.get()?;
            conn.execute(
                "UPDATE persona_executions SET traceparent = ?1 WHERE id = ?2",
                params![traceparent, execution_id],
            )?;
            Ok(())
        }
    )
}

/// Stamp the supervisory `last_heartbeat_at` column whenever the runner emits
/// a heartbeat tick. Read by the watchdog scan in `engine::healthcheck` to
/// detect long-silent runs without changing the canonical status lifecycle.
/// Errors are non-fatal — heartbeat is best-effort.
pub fn touch_last_heartbeat(pool: &DbPool, execution_id: &str) -> Result<(), AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::touch_last_heartbeat",
        {
            let conn = pool.get()?;
            let now = chrono::Utc::now().to_rfc3339();
            let mut stmt = conn.prepare_cached(
                "UPDATE persona_executions SET last_heartbeat_at = ?1 WHERE id = ?2",
            )?;
            stmt.execute(params![now, execution_id])?;
            Ok(())
        }
    )
}

/// Find still-running executions whose last heartbeat is older than the given
/// cutoff timestamp (RFC3339). Returns just the IDs — the watchdog only needs
/// to fire a passive event, not surface a typed row. Limited to keep a single
/// scan tick bounded.
pub fn find_silent_running(
    pool: &DbPool,
    cutoff_rfc3339: &str,
    limit: i64,
) -> Result<Vec<String>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::find_silent_running",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT id FROM persona_executions
             WHERE status = 'running'
               AND last_heartbeat_at IS NOT NULL
               AND last_heartbeat_at < ?1
             ORDER BY last_heartbeat_at ASC
             LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![cutoff_rfc3339, limit], |row| {
                row.get::<_, String>(0)
            })?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
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
        let mut stmt = conn.prepare_cached(
            "INSERT INTO persona_executions
             (id, persona_id, status, input_tokens, output_tokens, cost_usd, retry_of_execution_id, retry_count, created_at)
             VALUES (?1, ?2, 'queued', 0, 0, 0, ?3, ?4, ?5)",
        )?;
        stmt.execute(params![id, persona_id, original_exec_id, retry_count, now])?;

        get_by_id(pool, &id)
    })
}

/// Count consecutive recent failures for a persona (unbroken streak of 'failed' status
/// from the most recent execution backwards).
pub fn get_consecutive_failure_count(pool: &DbPool, persona_id: &str) -> Result<u32, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_consecutive_failure_count",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
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
        }
    )
}

/// Get the retry chain for an execution (all retries linked to the same original).
pub fn get_retry_chain(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<PersonaExecution>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_retry_chain",
        {
            // First, find the root execution
            let exec = get_by_id(pool, execution_id)?;
            let root_id = exec
                .retry_of_execution_id
                .as_deref()
                .unwrap_or(execution_id);

            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_executions
             WHERE id = ?1 OR retry_of_execution_id = ?1
             ORDER BY retry_count ASC, created_at ASC",
            )?;
            let rows = stmt.query_map(params![root_id], row_to_execution)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Batch-fetch retry chains for multiple execution IDs in a single query.
/// Returns a map from each input execution_id to its retry chain (executions
/// with retry_count > 0). This eliminates the N+1 pattern when building the
/// healing timeline.
pub fn get_retry_chains_batch(
    pool: &DbPool,
    execution_ids: &[&str],
) -> Result<std::collections::HashMap<String, Vec<PersonaExecution>>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_retry_chains_batch",
        {
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

            let mut root_stmt = conn.prepare_cached(&root_sql)?;
            let root_rows = root_stmt.query_map(params_ref.as_slice(), |row| {
                let id: String = row.get(0)?;
                let retry_of: Option<String> = row.get(1)?;
                Ok((id, retry_of))
            })?;

            // Map: original exec_id -> root_id
            let mut exec_to_root: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
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

            let _chain_sql = format!(
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

            let mut chain_stmt = conn.prepare_cached(&chain_sql)?;
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
        }
    )
}

pub fn get_monthly_spend(pool: &DbPool, persona_id: &str) -> Result<f64, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::get_monthly_spend",
        {
            let conn = pool.get()?;
            // Include completed, failed, incomplete, and cancelled executions in spend
            // tracking. Cancelled executions may have consumed API credits before the
            // process was killed, and those costs must count toward budget enforcement.
            // Exclude ops chat executions from spend tracking — they are conversational
            // queries from the Chat tab, not billable agent executions.
            let spend: f64 = conn.query_row(
                "SELECT COALESCE(SUM(cost_usd), 0.0) FROM persona_executions
             WHERE persona_id = ?1 AND status IN ('completed', 'failed', 'incomplete', 'cancelled')
             AND created_at >= datetime('now', 'start of month')
             AND (input_data IS NULL OR input_data NOT LIKE '%\"_ops\"%')",
                params![persona_id],
                |row| row.get(0),
            )?;
            Ok(spend)
        }
    )
}

/// Default zombie threshold: 30 minutes.
const DEFAULT_ZOMBIE_THRESHOLD_SECS: i64 = 30 * 60;

/// Find executions stuck in 'running' state for longer than the zombie threshold
/// and transition them to 'incomplete'. Returns the IDs of transitioned executions
/// that should be SURFACED to the user — i.e. those for which the persona does
/// not already have a newer completed execution. Zombies whose persona already
/// has a newer completed run are still cleaned up (transitioned to incomplete),
/// but their IDs are not returned, so the background sweep doesn't fire a
/// misleading "execution stalled" notification for runs the user has already
/// seen succeed via a later attempt.
pub fn sweep_zombie_executions(pool: &DbPool) -> Result<Vec<String>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::sweep_zombie_executions",
        {
            let conn = pool.get()?;
            let now = chrono::Utc::now();
            let threshold_secs = DEFAULT_ZOMBIE_THRESHOLD_SECS;

            // Find running executions whose started_at is older than the threshold.
            // Pull persona_id + created_at too so we can check "is there a newer
            // completed run for the same persona?" before deciding whether to
            // surface this zombie to the user.
            let mut stmt = conn.prepare_cached(
                "SELECT id, persona_id, started_at, created_at FROM persona_executions WHERE status = 'running'",
            )?;
            let candidates: Vec<(String, String, Option<String>, String)> = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?
                .filter_map(|r| r.ok())
                .collect();

            let mut surface_ids = Vec::new();
            for (id, persona_id, started_at, created_at) in candidates {
                let is_zombie = match &started_at {
                    Some(ts) => {
                        if let Ok(started) = chrono::DateTime::parse_from_rfc3339(ts) {
                            (now - started.with_timezone(&chrono::Utc)).num_seconds()
                                > threshold_secs
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
                    let elapsed_str = started_at.as_deref().unwrap_or("unknown");
                    let mut update_stmt = conn.prepare_cached(
                        "UPDATE persona_executions SET
                    status = 'incomplete',
                    error_message = ?1,
                    completed_at = ?2
                 WHERE id = ?3 AND status = 'running'",
                    )?;
                    update_stmt.execute(params![
                        format!(
                            "Execution stalled: running since {} (>{} min) — marked as zombie",
                            elapsed_str,
                            threshold_secs / 60,
                        ),
                        now.to_rfc3339(),
                        id,
                    ])?;

                    // Surface to user only if there's no newer completed run for
                    // the same persona. A newer completed run means the user
                    // already saw success — re-notifying about an old stalled
                    // attempt is just noise.
                    let mut superseded_stmt = conn.prepare_cached(
                        "SELECT 1 FROM persona_executions
                         WHERE persona_id = ?1
                           AND status = 'completed'
                           AND created_at > ?2
                         LIMIT 1",
                    )?;
                    let is_superseded: bool = superseded_stmt
                        .query_row(params![persona_id, created_at], |_| Ok(true))
                        .unwrap_or(false);

                    if !is_superseded {
                        surface_ids.push(id);
                    } else {
                        tracing::debug!(
                            execution_id = %id,
                            persona_id = %persona_id,
                            "zombie sweep: silently transitioned superseded execution to incomplete (newer completed run exists)"
                        );
                    }
                }
            }

            Ok(surface_ids)
        }
    )
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
    timed_query!(
        "persona_executions",
        "persona_executions::cleanup_old_executions",
        {
            let conn = pool.get()?;

            // Two-phase approach:
            // 1. Find all persona_ids that have terminal executions older than the cutoff.
            // 2. For each persona, delete old terminal executions while preserving the
            //    most recent `min_keep_per_persona` rows.

            let cutoff = format!("-{retention_days} days");

            // Get distinct persona_ids with old terminal executions
            let mut persona_stmt = conn.prepare_cached(
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
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreatePersonaInput, Json};
    use crate::db::repos::core::personas;

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
                execution_flows: Some(Json(serde_json::from_str("{\"flows\": []}").unwrap())),
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
