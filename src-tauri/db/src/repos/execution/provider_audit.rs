use rusqlite::params;
use ts_rs::TS;

use crate::byom::ProviderAuditEntry;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// One projection for every full-row read of `provider_audit_log`, so the SELECT
/// and the mapper cannot drift apart. Mirrors `CREATE TABLE provider_audit_log`
/// (`migrations/incremental/e02_credentials_and_audit_trails.rs:420`).
const COLUMNS: &str = "id, execution_id, persona_id, persona_name, engine_kind, model_used,                        was_failover, routing_rule_name, compliance_rule_name, cost_usd,                        duration_ms, status, created_at";

/// Insert a provider audit log entry (append-only).
pub fn insert(pool: &DbPool, entry: &ProviderAuditEntry) -> Result<(), AppError> {
    timed_query!("provider_audit", "provider_audit::insert", {
        let conn = pool.conn("provider_audit::insert")?;
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
        // Best-effort: promote provider failovers into the incidents inbox.
        // No-op unless PERSONAS_INCIDENTS_PROMOTION=1; only `was_failover=1`
        // rows surface (see `audit_incidents_promoter::promote_provider_audit`).
        crate::audit_incidents_promoter::promote_provider_audit(pool, entry);
        Ok(())
    })
}

// `was_failover` is stored as INTEGER and modelled as `bool` — the `[bool]`
// annotation is what bridges those, not an escape hatch.
row_mapper!(row_to_entry -> ProviderAuditEntry {
    id,
    execution_id,
    persona_id,
    persona_name,
    engine_kind,
    model_used,
    was_failover [bool],
    routing_rule_name,
    compliance_rule_name,
    cost_usd,
    duration_ms,
    status,
    created_at,
});

/// List provider audit log entries, newest first. Optional limit (default 100).
pub fn list(pool: &DbPool, limit: Option<i64>) -> Result<Vec<ProviderAuditEntry>, AppError> {
    timed_query!("provider_audit", "provider_audit::list", {
        let conn = pool.conn("provider_audit::list")?;
        let limit = limit.unwrap_or(100);
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM provider_audit_log ORDER BY created_at DESC LIMIT ?1"
        ))?;
        let rows = crate::repos::utils::collect_rows(
            stmt.query_map(params![limit], row_to_entry)?,
            "provider_audit::list",
        );
        Ok(rows)
    })
}

/// List provider audit entries for a specific persona.
pub fn list_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<ProviderAuditEntry>, AppError> {
    timed_query!("provider_audit", "provider_audit::list_by_persona", {
        let conn = pool.conn("provider_audit::list_by_persona")?;
        let limit = limit.unwrap_or(100);
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM provider_audit_log WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        ))?;
        let rows = crate::repos::utils::collect_rows(
            stmt.query_map(params![persona_id, limit], row_to_entry)?,
            "provider_audit::list_by_persona",
        );
        Ok(rows)
    })
}

/// Get aggregate provider usage stats.
#[derive(Debug, Clone, serde::Serialize, TS)]
#[ts(export)]
pub struct ProviderUsageStats {
    pub engine_kind: String,
    pub execution_count: i64,
    pub total_cost_usd: f64,
    pub avg_duration_ms: f64,
    pub failover_count: i64,
}

/// A single day's aggregated usage for one engine_kind.
#[derive(Debug, Clone, serde::Serialize, TS)]
#[ts(export)]
pub struct ProviderUsageTimeseries {
    pub engine_kind: String,
    pub date: String,
    pub execution_count: i64,
    pub total_cost_usd: f64,
    pub avg_duration_ms: f64,
}

/// Get daily provider usage timeseries for the last N days.
pub fn get_usage_timeseries(
    pool: &DbPool,
    days: i64,
) -> Result<Vec<ProviderUsageTimeseries>, AppError> {
    timed_query!("provider_audit", "provider_audit::get_usage_timeseries", {
        let conn = pool.conn("provider_audit::get_usage_timeseries")?;
        let mut stmt = conn.prepare(
            "SELECT engine_kind,
                DATE(created_at) as day,
                COUNT(*) as execution_count,
                COALESCE(SUM(cost_usd), 0) as total_cost_usd,
                COALESCE(AVG(duration_ms), 0) as avg_duration_ms
         FROM provider_audit_log
         WHERE created_at >= DATE('now', ?1)
         GROUP BY engine_kind, DATE(created_at)
         ORDER BY engine_kind, day ASC",
        )?;
        let offset_str = format!("-{} days", days);
        let rows = crate::repos::utils::collect_rows(
            stmt.query_map(params![offset_str], |row| {
                Ok(ProviderUsageTimeseries {
                    engine_kind: row.get("engine_kind")?,
                    // NOTE the divergence: the struct field is `date`, the SQL
                    // alias is `day`. Read by the SQL name, never the field name.
                    date: row.get("day")?,
                    execution_count: row.get("execution_count")?,
                    total_cost_usd: row.get("total_cost_usd")?,
                    avg_duration_ms: row.get("avg_duration_ms")?,
                })
            })?,
            "provider_audit::get_usage_timeseries",
        );
        Ok(rows)
    })
}

pub fn get_usage_stats(pool: &DbPool) -> Result<Vec<ProviderUsageStats>, AppError> {
    timed_query!("provider_audit", "provider_audit::get_usage_stats", {
        let conn = pool.conn("provider_audit::get_usage_stats")?;
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
        let rows = crate::repos::utils::collect_rows(
            stmt.query_map([], |row| {
                Ok(ProviderUsageStats {
                    engine_kind: row.get("engine_kind")?,
                    execution_count: row.get("execution_count")?,
                    total_cost_usd: row.get("total_cost_usd")?,
                    avg_duration_ms: row.get("avg_duration_ms")?,
                    failover_count: row.get("failover_count")?,
                })
            })?,
            "provider_audit::get_usage_stats",
        );
        Ok(rows)
    })
}
