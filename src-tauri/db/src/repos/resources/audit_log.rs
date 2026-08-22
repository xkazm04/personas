use rusqlite::params;

use crate::models::{CredentialAuditEntry, CredentialDependent, CredentialUsageStats};
use crate::repos::utils::collect_rows;
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::utils::sanitization::sanitize_secrets;

/// One projection for every full-row read of `credential_audit_log`. Mirrors
/// `CREATE TABLE` at `migrations/schema.rs:677` and the incremental copy at
/// `migrations/incremental/e02_credentials_and_audit_trails.rs:122`, which
/// agree column for column.
const COLUMNS: &str = "id, credential_id, credential_name, operation, persona_id, \
     persona_name, detail, created_at";

row_mapper!(row_to_entry -> CredentialAuditEntry {
    id,
    credential_id,
    credential_name,
    operation,
    persona_id,
    persona_name,
    detail,
    created_at,
});

// ---------------------------------------------------------------------------
// Insert (append-only -- no update or delete functions)
// ---------------------------------------------------------------------------

/// Append a new entry to the credential audit log.
///
/// This is the single chokepoint for ALL credential audit writes (decrypt at
/// injection, healthcheck, CRUD ops). A failed write increments the
/// process-wide `credential_audit_write_failures` counter (see
/// `engine::crypto`) so a decrypt can never occur with a silently-missing
/// audit trail — callers stay free to treat the returned error as
/// non-blocking (availability over auditability), but the gap is COUNTED and
/// surfaced on `vault_status`.
pub fn insert(
    pool: &DbPool,
    credential_id: &str,
    credential_name: &str,
    operation: &str,
    persona_id: Option<&str>,
    persona_name: Option<&str>,
    detail: Option<&str>,
) -> Result<(), AppError> {
    let result = insert_inner(
        pool,
        credential_id,
        credential_name,
        operation,
        persona_id,
        persona_name,
        detail,
    );
    if let Err(ref e) = result {
        let failures = personas_core::crypto::record_credential_audit_write_failure();
        tracing::warn!(
            credential_id = %credential_id,
            operation = %operation,
            failures,
            error = %e,
            "credential audit-log write FAILED — operation proceeded without an audit trail (counted on vault_status)"
        );
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn insert_inner(
    pool: &DbPool,
    credential_id: &str,
    credential_name: &str,
    operation: &str,
    persona_id: Option<&str>,
    persona_name: Option<&str>,
    detail: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("audit_log", "audit_log::insert", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Sanitize detail field to prevent leaking secrets in audit log
        let sanitized_detail = detail.map(sanitize_secrets);

        conn.execute(
            "INSERT INTO credential_audit_log (id, credential_id, credential_name, operation, persona_id, persona_name, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, credential_id, credential_name, operation, persona_id, persona_name, sanitized_detail, now],
        )?;

        // Best-effort: promote credential failures into the incidents inbox.
        // No-op unless PERSONAS_INCIDENTS_PROMOTION=1; only failure-shaped
        // operations surface (see `audit_incidents_promoter::promote_credential_audit`).
        let entry = CredentialAuditEntry {
            id: id.clone(),
            credential_id: credential_id.to_string(),
            credential_name: credential_name.to_string(),
            operation: operation.to_string(),
            persona_id: persona_id.map(|s| s.to_string()),
            persona_name: persona_name.map(|s| s.to_string()),
            detail: sanitized_detail.clone(),
            created_at: now.clone(),
        };
        crate::audit_incidents_promoter::promote_credential_audit(pool, &entry);

        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/// Get audit log entries for a specific credential, newest first.
pub fn get_by_credential(
    pool: &DbPool,
    credential_id: &str,
    limit: u32,
) -> Result<Vec<CredentialAuditEntry>, AppError> {
    timed_query!("audit_log", "audit_log::get_by_credential", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS}
             FROM credential_audit_log
             WHERE credential_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        ))?;
        let rows = stmt.query_map(params![credential_id, limit], row_to_entry)?;
        let rows = collect_rows(rows, "audit_log::get_by_credential");
        Ok(rows)
    })
}

/// Get aggregated usage statistics for a credential.
pub fn get_usage_stats(
    pool: &DbPool,
    credential_id: &str,
) -> Result<CredentialUsageStats, AppError> {
    timed_query!("audit_log", "audit_log::get_usage_stats", {
        let conn = pool.get()?;
        let now = chrono::Utc::now();
        let cutoff_24h = (now - chrono::Duration::days(1)).to_rfc3339();
        let cutoff_7d = (now - chrono::Duration::days(7)).to_rfc3339();
        let row = conn.query_row(
            "SELECT
                COUNT(*) AS total_accesses,
                COUNT(DISTINCT persona_id) AS distinct_personas,
                MAX(created_at) AS last_accessed_at,
                MIN(created_at) AS first_accessed_at,
                SUM(CASE WHEN created_at >= ?2 THEN 1 ELSE 0 END) AS accesses_24h,
                SUM(CASE WHEN created_at >= ?3 THEN 1 ELSE 0 END) AS accesses_7d
             FROM credential_audit_log
             WHERE credential_id = ?1",
            params![credential_id, cutoff_24h, cutoff_7d],
            // Hand-written, not `row_mapper!`: `credential_id` comes from the
            // parameter rather than the row, and four counts narrow i64 to u32.
            // Note the two aliases that do NOT match their field —
            // `accesses_24h` feeds `accesses_last_24h` and `accesses_7d` feeds
            // `accesses_last_7d`. The SQL is left exactly as it was and the
            // read names the real alias; inferring a column from the field name
            // here would have compiled and failed at runtime.
            |row| {
                Ok(CredentialUsageStats {
                    credential_id: credential_id.to_string(),
                    total_accesses: row.get::<_, i64>("total_accesses")? as u32,
                    distinct_personas: row.get::<_, i64>("distinct_personas")? as u32,
                    last_accessed_at: row.get("last_accessed_at")?,
                    first_accessed_at: row.get("first_accessed_at")?,
                    accesses_last_24h: row.get::<_, i64>("accesses_24h")? as u32,
                    accesses_last_7d: row.get::<_, i64>("accesses_7d")? as u32,
                })
            },
        )?;
        Ok(row)
    })
}

/// Fire-and-forget audit log insert without persona context.
/// Errors are logged as warnings rather than propagated to the caller.
pub fn insert_warn(
    pool: &DbPool,
    credential_id: &str,
    credential_name: &str,
    operation: &str,
    detail: Option<&str>,
) {
    if let Err(e) = insert(
        pool,
        credential_id,
        credential_name,
        operation,
        None,
        None,
        detail,
    ) {
        tracing::warn!("audit_log::insert_warn failed (op={}): {}", operation, e);
    }
}

/// Convenience wrapper to log a credential decryption event.
///
/// `caller` identifies the subsystem that triggered the decryption
/// (e.g. "api_proxy", "healthcheck", "db_query").
pub fn log_decrypt(
    pool: &DbPool,
    credential_id: &str,
    credential_name: &str,
    caller: &str,
    persona_id: Option<&str>,
    persona_name: Option<&str>,
) -> Result<(), AppError> {
    insert(
        pool,
        credential_id,
        credential_name,
        "decrypt",
        persona_id,
        persona_name,
        Some(caller),
    )
}

/// Delete audit log entries older than the given number of days.
/// Returns the number of rows deleted.
pub fn cleanup_old_entries(pool: &DbPool, retention_days: i64) -> Result<usize, AppError> {
    timed_query!("audit_log", "audit_log::cleanup_old_entries", {
        let conn = pool.get()?;
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(retention_days)).to_rfc3339();
        let deleted = conn.execute(
            "DELETE FROM credential_audit_log WHERE created_at < ?1",
            params![cutoff],
        )?;
        Ok(deleted)
    })
}

/// Get all audit log entries across all credentials, newest first.
pub fn get_all(pool: &DbPool, limit: u32) -> Result<Vec<CredentialAuditEntry>, AppError> {
    timed_query!("audit_log", "audit_log::get_all", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS}
             FROM credential_audit_log
             ORDER BY created_at DESC
             LIMIT ?1",
        ))?;
        let rows = stmt.query_map(params![limit], row_to_entry)?;
        let rows = collect_rows(rows, "audit_log::get_all");
        Ok(rows)
    })
}

/// Get personas that depend on a credential, determined two ways:
/// 1. Tool -> Connector -> Credential link (structural dependency)
/// 2. Audit log history (observed usage)
pub fn get_dependents(
    pool: &DbPool,
    credential_id: &str,
) -> Result<Vec<CredentialDependent>, AppError> {
    timed_query!("audit_log", "audit_log::get_dependents", {
        let conn = pool.get()?;

        // First get the credential's service_type
        let service_type: String = conn
            .query_row(
                "SELECT service_type FROM persona_credentials WHERE id = ?1",
                params![credential_id],
                |row| row.get("service_type"),
            )
            .map_err(|_| AppError::NotFound(format!("Credential {credential_id}")))?;

        // Find structural dependents: personas whose tools use connectors matching this service_type.
        // Match the tool name against the connector's `services` JSON array as an
        // EXACT element (via json_each), not a substring. The old
        // `services LIKE '%' || ptd.name || '%'` reported false-positive
        // dependents — e.g. a tool named "git" matched services "github"/"gitlab"
        // — inflating the revocation blast radius. `json_valid` guards legacy
        // rows with malformed `services` (SQLite short-circuits the AND so
        // json_each is never run on invalid JSON).
        let mut stmt = conn.prepare(
            "SELECT DISTINCT p.id AS persona_id, p.name AS persona_name, cd.label AS via_connector
             FROM personas p
             INNER JOIN persona_tools pt ON pt.persona_id = p.id
             INNER JOIN persona_tool_definitions ptd ON ptd.id = pt.tool_id
             INNER JOIN connector_definitions cd ON cd.name = ?1
             WHERE json_valid(cd.services)
               AND EXISTS (
                 SELECT 1 FROM json_each(cd.services) je WHERE je.value = ptd.name
               )",
        )?;
        let structural = stmt.query_map(params![service_type], |row| {
            Ok(CredentialDependent {
                persona_id: row.get("persona_id")?,
                persona_name: row.get("persona_name")?,
                link_type: "tool_connector".to_string(),
                via_connector: row.get("via_connector")?,
                last_used_at: None,
            })
        })?;
        let structural = collect_rows(structural, "audit_log::get_dependents/structural");

        // Find observed dependents from audit log (personas that have used this
        // credential). INNER JOIN personas so a persona that has since been
        // DELETED is not surfaced as a live dependent: credential_audit_log is
        // append-only with no FK to personas, so its rows outlive the persona
        // they reference. Without this join the dependency graph showed every
        // persona that ever touched a credential — including hundreds of long-
        // deleted template/test personas — inflating the agent node count by
        // an order of magnitude (349 distinct ids vs 22 live personas in one
        // observed checkout). Use the live `p.name` rather than the audit-log
        // snapshot so renamed personas read correctly too, matching the
        // structural query above.
        let mut stmt2 = conn.prepare(
            "SELECT cal.persona_id AS persona_id, p.name AS persona_name,
                    MAX(cal.created_at) AS last_used_at
             FROM credential_audit_log cal
             INNER JOIN personas p ON p.id = cal.persona_id
             WHERE cal.credential_id = ?1 AND cal.persona_id IS NOT NULL
             GROUP BY cal.persona_id",
        )?;
        let observed = stmt2.query_map(params![credential_id], |row| {
            Ok(CredentialDependent {
                persona_id: row.get("persona_id")?,
                persona_name: row
                    .get::<_, Option<String>>("persona_name")?
                    .unwrap_or_default(),
                link_type: "audit_log".to_string(),
                via_connector: None,
                last_used_at: row.get("last_used_at")?,
            })
        })?;
        let observed = collect_rows(observed, "audit_log::get_dependents/observed");

        // Broker consumers (Zero-Plaintext Broker): external consumer keys
        // that have actually used this credential through the audited proxy.
        // These are LIVE edges — refreshed on every proxied call — so the
        // blast radius reflects observed reality, not just declared bindings.
        // INNER JOIN on active keys: a revoked consumer (kill-switch) drops
        // out of the blast radius immediately. Ids are prefixed `consumer:`
        // to keep them out of the persona id space.
        // Tolerate a DB predating the broker migration (older snapshots /
        // partial test schemas): treat a missing table as zero consumers
        // instead of failing the whole dependents read.
        let consumers = match conn.prepare(
            "SELECT e.consumer_key_id AS consumer_key_id,
                    e.consumer_name   AS consumer_name,
                    e.last_used_at    AS last_used_at
             FROM credential_consumer_edges e
             INNER JOIN external_api_keys k ON k.id = e.consumer_key_id
             WHERE e.credential_id = ?1 AND k.enabled = 1 AND k.revoked_at IS NULL
             ORDER BY e.last_used_at DESC",
        ) {
            Ok(mut stmt3) => {
                let rows = stmt3.query_map(params![credential_id], |row| {
                    Ok(CredentialDependent {
                        persona_id: format!(
                            "consumer:{}",
                            row.get::<_, String>("consumer_key_id")?
                        ),
                        persona_name: row.get("consumer_name")?,
                        link_type: "broker_consumer".to_string(),
                        via_connector: None,
                        last_used_at: row.get("last_used_at")?,
                    })
                })?;
                collect_rows(rows, "audit_log::get_dependents/broker_consumers")
            }
            Err(e) => {
                tracing::debug!(error = %e, "broker consumer-edge scan skipped (table missing?)");
                Vec::new()
            }
        };

        // Merge: structural first, then observed, then broker consumers
        // (skip duplicates by id).
        let mut result = structural;
        let mut existing_ids: std::collections::HashSet<String> =
            result.iter().map(|d| d.persona_id.clone()).collect();
        for dep in observed.into_iter().chain(consumers) {
            if existing_ids.insert(dep.persona_id.clone()) {
                result.push(dep);
            }
        }

        Ok(result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `COLUMNS` projection must prepare against the real migrated schema.
    /// A by-name read of a column the table does not have compiles fine and
    /// fails at runtime on the first row; this is the only gate that sees it.
    #[test]
    fn every_projection_prepares_against_the_real_schema() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        for (columns, table) in [(COLUMNS, "credential_audit_log")] {
            let sql = format!("SELECT {columns} FROM {table} LIMIT 0");
            conn.prepare(&sql)
                .unwrap_or_else(|e| panic!("{table} projection does not match schema: {e}"));
        }
    }

    /// The aggregate and join projections are not plain column lists, so the
    /// probe above cannot cover them; prepare the real statements instead.
    /// This is what catches an alias renamed on one side only.
    #[test]
    fn aggregate_and_join_projections_still_carry_their_aliases() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        let stats = conn
            .prepare(
                "SELECT
                COUNT(*) AS total_accesses,
                COUNT(DISTINCT persona_id) AS distinct_personas,
                MAX(created_at) AS last_accessed_at,
                MIN(created_at) AS first_accessed_at,
                SUM(CASE WHEN created_at >= ?2 THEN 1 ELSE 0 END) AS accesses_24h,
                SUM(CASE WHEN created_at >= ?3 THEN 1 ELSE 0 END) AS accesses_7d
             FROM credential_audit_log
             WHERE credential_id = ?1",
            )
            .unwrap();
        assert_eq!(
            stats.column_names(),
            vec![
                "total_accesses",
                "distinct_personas",
                "last_accessed_at",
                "first_accessed_at",
                "accesses_24h",
                "accesses_7d",
            ],
        );

        let observed = conn
            .prepare(
                "SELECT cal.persona_id AS persona_id, p.name AS persona_name,
                    MAX(cal.created_at) AS last_used_at
             FROM credential_audit_log cal
             INNER JOIN personas p ON p.id = cal.persona_id
             WHERE cal.credential_id = ?1 AND cal.persona_id IS NOT NULL
             GROUP BY cal.persona_id",
            )
            .unwrap();
        assert_eq!(
            observed.column_names(),
            vec!["persona_id", "persona_name", "last_used_at"],
        );
    }
    /// The projection probes prove the column NAMES resolve; this proves the
    /// mapping itself — every field arrives with the value that was written.
    /// A pair of adjacent same-typed columns swapped in the mapper survives a
    /// prepare and dies here.
    #[test]
    fn every_field_round_trips_through_the_named_mapper() {
        let pool = crate::init_test_db().unwrap();
        insert(
            &pool,
            "cred-1",
            "Production key",
            "decrypt",
            Some("persona-1"),
            Some("Analyst"),
            Some("api_proxy"),
        )
        .unwrap();

        let entries = get_by_credential(&pool, "cred-1", 10).unwrap();
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.credential_id, "cred-1");
        assert_eq!(e.credential_name, "Production key");
        assert_eq!(e.operation, "decrypt");
        assert_eq!(e.persona_id.as_deref(), Some("persona-1"));
        assert_eq!(e.persona_name.as_deref(), Some("Analyst"));
        assert_eq!(e.detail.as_deref(), Some("api_proxy"));
        assert!(!e.id.is_empty());
        assert!(!e.created_at.is_empty());

        // `get_all` uses the same projection and mapper.
        let all = get_all(&pool, 10).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, e.id);

        let stats = get_usage_stats(&pool, "cred-1").unwrap();
        assert_eq!(stats.credential_id, "cred-1");
        assert_eq!(stats.total_accesses, 1);
        assert_eq!(stats.distinct_personas, 1);
        assert_eq!(stats.accesses_last_24h, 1);
        assert_eq!(stats.accesses_last_7d, 1);
        assert_eq!(
            stats.last_accessed_at.as_deref(),
            Some(e.created_at.as_str())
        );
        assert_eq!(
            stats.first_accessed_at.as_deref(),
            Some(e.created_at.as_str())
        );
    }
}
