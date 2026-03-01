use rusqlite::params;

use crate::db::DbPool;
use crate::engine::trace::ExecutionTrace;
use crate::error::AppError;

/// Save an execution trace to the database.
pub fn save(pool: &DbPool, trace: &ExecutionTrace) -> Result<(), AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let spans_json =
        serde_json::to_string(&trace.spans).map_err(|e| AppError::Internal(e.to_string()))?;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO execution_traces (id, execution_id, trace_id, persona_id, chain_trace_id, spans, total_duration_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            trace.execution_id,
            trace.trace_id,
            trace.persona_id,
            trace.chain_trace_id,
            spans_json,
            trace.total_duration_ms.map(|d| d as i64),
            trace.created_at,
        ],
    )?;

    Ok(())
}

/// Get the trace for a specific execution.
pub fn get_by_execution_id(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Option<ExecutionTrace>, AppError> {
    let conn = pool.get()?;
    let result = conn.query_row(
        "SELECT trace_id, execution_id, persona_id, chain_trace_id, spans, total_duration_ms, created_at
         FROM execution_traces WHERE execution_id = ?1 ORDER BY created_at DESC LIMIT 1",
        params![execution_id],
        |row| {
            let spans_json: String = row.get("spans")?;
            let total_duration_ms: Option<i64> = row.get("total_duration_ms")?;
            Ok(ExecutionTrace {
                trace_id: row.get("trace_id")?,
                execution_id: row.get("execution_id")?,
                persona_id: row.get("persona_id")?,
                chain_trace_id: row.get("chain_trace_id")?,
                spans: serde_json::from_str(&spans_json).unwrap_or_default(),
                total_duration_ms: total_duration_ms.map(|d| d as u64),
                created_at: row.get("created_at")?,
            })
        },
    );

    match result {
        Ok(trace) => Ok(Some(trace)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Get all traces sharing a chain_trace_id (distributed trace across chain executions).
pub fn get_by_chain_trace_id(
    pool: &DbPool,
    chain_trace_id: &str,
) -> Result<Vec<ExecutionTrace>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT trace_id, execution_id, persona_id, chain_trace_id, spans, total_duration_ms, created_at
         FROM execution_traces WHERE chain_trace_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![chain_trace_id], |row| {
        let spans_json: String = row.get("spans")?;
        let total_duration_ms: Option<i64> = row.get("total_duration_ms")?;
        Ok(ExecutionTrace {
            trace_id: row.get("trace_id")?,
            execution_id: row.get("execution_id")?,
            persona_id: row.get("persona_id")?,
            chain_trace_id: row.get("chain_trace_id")?,
            spans: serde_json::from_str(&spans_json).unwrap_or_default(),
            total_duration_ms: total_duration_ms.map(|d| d as u64),
            created_at: row.get("created_at")?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}
