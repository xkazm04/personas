use rusqlite::params;

use crate::db::models::{ToolExecutionAuditEntry, ToolPerformanceSummary};
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
    timed_query!("tool_audit_log", "tool_audit_log::insert", {
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
        // Best-effort: promote errors into the incidents inbox. No-op unless
        // PERSONAS_INCIDENTS_PROMOTION=1; only `result_status='error'` rows
        // surface as incidents (see `audit_incidents_promoter::promote_tool_audit`).
        if result_status == "error" {
            let entry = ToolExecutionAuditEntry {
                id: id.clone(),
                tool_id: tool_id.to_string(),
                tool_name: tool_name.to_string(),
                tool_type: tool_type.to_string(),
                persona_id: persona_id.map(|s| s.to_string()),
                persona_name: persona_name.map(|s| s.to_string()),
                credential_id: credential_id.map(|s| s.to_string()),
                result_status: result_status.to_string(),
                duration_ms: duration_ms.map(|d| d as i64),
                error_message: error_message.map(|s| s.to_string()),
                created_at: now.clone(),
            };
            crate::engine::audit_incidents_promoter::promote_tool_audit(pool, &entry);
        }
        Ok(())
    })
}

/// Get recent tool execution audit entries, newest first.
pub fn get_recent(pool: &DbPool, limit: u32) -> Result<Vec<ToolExecutionAuditEntry>, AppError> {
    timed_query!("tool_audit_log", "tool_audit_log::get_recent", {
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
    })
}

/// Aggregate tool performance metrics over a time window.
///
/// Groups by `(tool_name, tool_type)` and surfaces total runs, error count,
/// mean duration, and max duration. Drives the Overview tool-performance panel.
/// Median/p95 are deferred — SQLite has no native percentile function and the
/// caller doesn't need them for the v1 panel; total + mean + max + error rate
/// is enough to identify slow tools and flaky tools.
pub fn get_performance_summary(
    pool: &DbPool,
    since: &str,
    persona_id: Option<&str>,
    limit: u32,
) -> Result<Vec<ToolPerformanceSummary>, AppError> {
    timed_query!("tool_audit_log", "tool_audit_log::get_performance_summary", {
        let conn = pool.get()?;
        let sql = match persona_id {
            Some(_) => {
                "SELECT tool_name, tool_type,
                        COUNT(*) AS total_runs,
                        SUM(CASE WHEN result_status = 'error' THEN 1 ELSE 0 END) AS error_runs,
                        AVG(duration_ms) AS avg_duration_ms,
                        MAX(duration_ms) AS max_duration_ms
                 FROM tool_execution_audit_log
                 WHERE created_at >= ?1 AND persona_id = ?2
                 GROUP BY tool_name, tool_type
                 ORDER BY total_runs DESC
                 LIMIT ?3"
            }
            None => {
                "SELECT tool_name, tool_type,
                        COUNT(*) AS total_runs,
                        SUM(CASE WHEN result_status = 'error' THEN 1 ELSE 0 END) AS error_runs,
                        AVG(duration_ms) AS avg_duration_ms,
                        MAX(duration_ms) AS max_duration_ms
                 FROM tool_execution_audit_log
                 WHERE created_at >= ?1
                 GROUP BY tool_name, tool_type
                 ORDER BY total_runs DESC
                 LIMIT ?2"
            }
        };
        let mut stmt = conn.prepare(sql)?;
        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<ToolPerformanceSummary> {
            Ok(ToolPerformanceSummary {
                tool_name: row.get(0)?,
                tool_type: row.get(1)?,
                total_runs: row.get(2)?,
                error_runs: row.get(3)?,
                avg_duration_ms: row.get(4)?,
                max_duration_ms: row.get(5)?,
            })
        };
        let rows: Vec<ToolPerformanceSummary> = match persona_id {
            Some(pid) => stmt
                .query_map(params![since, pid, limit], map_row)?
                .filter_map(|r| r.ok())
                .collect(),
            None => stmt
                .query_map(params![since, limit], map_row)?
                .filter_map(|r| r.ok())
                .collect(),
        };
        Ok(rows)
    })
}

/// Get tool execution audit entries for a specific persona.
pub fn get_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: u32,
) -> Result<Vec<ToolExecutionAuditEntry>, AppError> {
    timed_query!("tool_audit_log", "tool_audit_log::get_by_persona", {
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
    })
}
