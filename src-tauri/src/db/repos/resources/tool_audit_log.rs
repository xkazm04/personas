use rusqlite::params;

use crate::db::DbPool;
use crate::error::AppError;

/// Append a tool execution entry to the audit log.
#[allow(clippy::too_many_arguments)]
pub fn insert(
    pool: &DbPool,
    tool_id: &str,
    tool_name: &str,
    tool_type: &str,
    persona_id: Option<&str>,
    persona_name: Option<&str>,
    credential_id: Option<&str>,
    result_status: &str,
    duration_ms: Option<u64>,
    error_message: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO tool_execution_audit_log
         (id, tool_id, tool_name, tool_type, persona_id, persona_name, credential_id, result_status, duration_ms, error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            tool_id,
            tool_name,
            tool_type,
            persona_id,
            persona_name,
            credential_id,
            result_status,
            duration_ms.map(|d| d as i64),
            error_message,
            now,
        ],
    )?;
    Ok(())
}

/// Get recent tool execution audit entries, newest first.
pub fn get_recent(
    pool: &DbPool,
    limit: u32,
) -> Result<Vec<ToolExecutionAuditEntry>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, tool_id, tool_name, tool_type, persona_id, persona_name, credential_id, result_status, duration_ms, error_message, created_at
         FROM tool_execution_audit_log
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(ToolExecutionAuditEntry {
                id: row.get(0)?,
                tool_id: row.get(1)?,
                tool_name: row.get(2)?,
                tool_type: row.get(3)?,
                persona_id: row.get(4)?,
                persona_name: row.get(5)?,
                credential_id: row.get(6)?,
                result_status: row.get(7)?,
                duration_ms: row.get(8)?,
                error_message: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Get tool execution audit entries for a specific persona.
pub fn get_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: u32,
) -> Result<Vec<ToolExecutionAuditEntry>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, tool_id, tool_name, tool_type, persona_id, persona_name, credential_id, result_status, duration_ms, error_message, created_at
         FROM tool_execution_audit_log
         WHERE persona_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![persona_id, limit], |row| {
            Ok(ToolExecutionAuditEntry {
                id: row.get(0)?,
                tool_id: row.get(1)?,
                tool_name: row.get(2)?,
                tool_type: row.get(3)?,
                persona_id: row.get(4)?,
                persona_name: row.get(5)?,
                credential_id: row.get(6)?,
                result_status: row.get(7)?,
                duration_ms: row.get(8)?,
                error_message: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// A single tool execution audit log entry.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecutionAuditEntry {
    pub id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub tool_type: String,
    pub persona_id: Option<String>,
    pub persona_name: Option<String>,
    pub credential_id: Option<String>,
    pub result_status: String,
    pub duration_ms: Option<i64>,
    pub error_message: Option<String>,
    pub created_at: String,
}
