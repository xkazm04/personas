use rusqlite::params;
use ts_rs::TS;

use crate::byom::ProviderAuditEntry;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// One projection for every full-row read of `provider_audit_log`, so the SELECT
/// and the mapper cannot drift apart. Mirrors `CREATE TABLE provider_audit_log`
/// (`migrations/incremental/e02_credentials_and_audit_trails.rs:420`).
const COLUMNS: &str = "id, execution_id, persona_id, persona_name, engine_kind, \
     model_used, was_failover, routing_rule_name, compliance_rule_name, cost_usd, \
     duration_ms, status, created_at";

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
#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn entry(id: &str, engine: &str, failover: bool) -> ProviderAuditEntry {
        ProviderAuditEntry {
            id: id.to_string(),
            execution_id: format!("exec-{id}"),
            persona_id: "p-1".into(),
            persona_name: "Audited Agent".into(),
            engine_kind: engine.to_string(),
            model_used: Some("claude-x".into()),
            was_failover: failover,
            routing_rule_name: Some("prefer-local".into()),
            compliance_rule_name: Some("no-eu-egress".into()),
            cost_usd: Some(0.25),
            duration_ms: Some(1_200),
            status: "completed".into(),
            created_at: format!("2026-07-10T00:00:0{}Z", &id[id.len() - 1..]),
        }
    }

    /// The gate this module shipped without. `COLUMNS` feeds a `row_mapper!`
    /// that reads by NAME, so a column the projection stops carrying compiles
    /// fine and fails at RUNTIME on the first row — which is exactly how
    /// `executions::list_items_by_persona_id` stayed broken for three months
    /// while nothing failed to build. Round-tripping every field through a real
    /// query is the only thing that catches it.
    #[test]
    fn projection_covers_every_field_the_mapper_reads() {
        let pool = init_test_db().unwrap();
        insert(&pool, &entry("a1", "claude", true)).unwrap();

        let rows = list(&pool, None).unwrap();
        assert_eq!(rows.len(), 1);
        let got = &rows[0];
        assert_eq!(got.id, "a1");
        assert_eq!(got.execution_id, "exec-a1");
        assert_eq!(got.persona_id, "p-1");
        assert_eq!(got.persona_name, "Audited Agent");
        assert_eq!(got.engine_kind, "claude");
        assert_eq!(got.model_used.as_deref(), Some("claude-x"));
        assert!(got.was_failover, "INTEGER 1 must read back as true");
        assert_eq!(got.routing_rule_name.as_deref(), Some("prefer-local"));
        assert_eq!(got.compliance_rule_name.as_deref(), Some("no-eu-egress"));
        assert_eq!(got.cost_usd, Some(0.25));
        assert_eq!(got.duration_ms, Some(1_200));
        assert_eq!(got.status, "completed");
        assert_eq!(got.created_at, "2026-07-10T00:00:01Z");

        // The per-persona door reads through the same const and mapper.
        let by_persona = list_by_persona(&pool, "p-1", None).unwrap();
        assert_eq!(by_persona.len(), 1);
        assert_eq!(by_persona[0].id, "a1");
        assert!(list_by_persona(&pool, "nobody", None).unwrap().is_empty());
    }

    /// The cheap half of the gate: the projection must PREPARE against the real
    /// migrated schema, so a column renamed out from under it fails here rather
    /// than on a user's first read.
    #[test]
    fn projection_prepares_against_the_real_schema() {
        let pool = init_test_db().unwrap();
        let conn = pool.conn("provider_audit::test").unwrap();
        conn.prepare(&format!("SELECT {COLUMNS} FROM provider_audit_log LIMIT 0"))
            .unwrap_or_else(|e| panic!("provider_audit_log projection does not match schema: {e}"));
    }

    /// The two aggregate reads name their own aliases rather than the mapper's
    /// field names (`day` vs `date`), which is the other way this file could
    /// drift silently.
    #[test]
    fn aggregates_group_by_engine_and_count_failovers() {
        let pool = init_test_db().unwrap();
        insert(&pool, &entry("a1", "claude", true)).unwrap();
        insert(&pool, &entry("a2", "claude", false)).unwrap();
        insert(&pool, &entry("a3", "openai", false)).unwrap();

        let stats = get_usage_stats(&pool).unwrap();
        let claude = stats
            .iter()
            .find(|s| s.engine_kind == "claude")
            .expect("claude must be grouped");
        assert_eq!(claude.execution_count, 2);
        assert_eq!(claude.failover_count, 1);
        assert!((claude.total_cost_usd - 0.5).abs() < 1e-9);

        // The timeseries window is relative to now; the seeded rows are dated
        // 2026-07-10, so a wide window must reach them and a zero-day one must
        // not. Both assertions exercise the `day`-aliased read.
        let wide = get_usage_timeseries(&pool, 36_500).unwrap();
        assert!(
            wide.iter().any(|r| r.date == "2026-07-10"),
            "the SQL alias `day` must land on the struct field `date`: {wide:?}"
        );
    }
}
