use rusqlite::params;

use crate::db::DbPool;
use crate::engine::byom::ProviderAuditEntry;
use crate::error::AppError;

/// Insert a provider audit log entry (append-only).
pub fn insert(
    pool: &DbPool,
    entry: &ProviderAuditEntry,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO provider_audit_log
         (id, execution_id, persona_id, persona_name, engine_kind, model_used,
          was_failover, routing_rule_name, compliance_rule_name, cost_usd,
          duration_ms, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            entry.id,
            entry.execution_id,
            entry.persona_id,
            entry.persona_name,
            entry.engine_kind,
            entry.model_used,
            entry.was_failover as i32,
            entry.routing_rule_name,
            entry.compliance_rule_name,
            entry.cost_usd,
            entry.duration_ms,
            entry.status,
            entry.created_at,
        ],
    )?;
    Ok(())
}

/// List provider audit log entries, newest first. Optional limit (default 100).
pub fn list(pool: &DbPool, limit: Option<i64>) -> Result<Vec<ProviderAuditEntry>, AppError> {
    let conn = pool.get()?;
    let limit = limit.unwrap_or(100);
    let mut stmt = conn.prepare(
        "SELECT id, execution_id, persona_id, persona_name, engine_kind, model_used,
                was_failover, routing_rule_name, compliance_rule_name, cost_usd,
                duration_ms, status, created_at
         FROM provider_audit_log
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(ProviderAuditEntry {
                id: row.get(0)?,
                execution_id: row.get(1)?,
                persona_id: row.get(2)?,
                persona_name: row.get(3)?,
                engine_kind: row.get(4)?,
                model_used: row.get(5)?,
                was_failover: row.get::<_, i32>(6)? != 0,
                routing_rule_name: row.get(7)?,
                compliance_rule_name: row.get(8)?,
                cost_usd: row.get(9)?,
                duration_ms: row.get(10)?,
                status: row.get(11)?,
                created_at: row.get(12)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// List provider audit entries for a specific persona.
pub fn list_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<ProviderAuditEntry>, AppError> {
    let conn = pool.get()?;
    let limit = limit.unwrap_or(100);
    let mut stmt = conn.prepare(
        "SELECT id, execution_id, persona_id, persona_name, engine_kind, model_used,
                was_failover, routing_rule_name, compliance_rule_name, cost_usd,
                duration_ms, status, created_at
         FROM provider_audit_log
         WHERE persona_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![persona_id, limit], |row| {
            Ok(ProviderAuditEntry {
                id: row.get(0)?,
                execution_id: row.get(1)?,
                persona_id: row.get(2)?,
                persona_name: row.get(3)?,
                engine_kind: row.get(4)?,
                model_used: row.get(5)?,
                was_failover: row.get::<_, i32>(6)? != 0,
                routing_rule_name: row.get(7)?,
                compliance_rule_name: row.get(8)?,
                cost_usd: row.get(9)?,
                duration_ms: row.get(10)?,
                status: row.get(11)?,
                created_at: row.get(12)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Get aggregate provider usage stats.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderUsageStats {
    pub engine_kind: String,
    pub execution_count: i64,
    pub total_cost_usd: f64,
    pub avg_duration_ms: f64,
    pub failover_count: i64,
}

pub fn get_usage_stats(pool: &DbPool) -> Result<Vec<ProviderUsageStats>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT engine_kind,
                COUNT(*) as execution_count,
                COALESCE(SUM(cost_usd), 0) as total_cost_usd,
                COALESCE(AVG(duration_ms), 0) as avg_duration_ms,
                SUM(CASE WHEN was_failover = 1 THEN 1 ELSE 0 END) as failover_count
         FROM provider_audit_log
         GROUP BY engine_kind
         ORDER BY execution_count DESC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProviderUsageStats {
                engine_kind: row.get(0)?,
                execution_count: row.get(1)?,
                total_cost_usd: row.get(2)?,
                avg_duration_ms: row.get(3)?,
                failover_count: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}
