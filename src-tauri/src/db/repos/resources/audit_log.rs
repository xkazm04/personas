use rusqlite::params;

use crate::db::models::{CredentialAuditEntry, CredentialDependent, CredentialUsageStats};
use crate::db::DbPool;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Insert (append-only — no update or delete functions)
// ---------------------------------------------------------------------------

/// Append a new entry to the credential audit log.
pub fn insert(
    pool: &DbPool,
    credential_id: &str,
    credential_name: &str,
    operation: &str,
    persona_id: Option<&str>,
    persona_name: Option<&str>,
    detail: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO credential_audit_log (id, credential_id, credential_name, operation, persona_id, persona_name, detail, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, credential_id, credential_name, operation, persona_id, persona_name, detail, now],
    )?;
    Ok(())
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
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, credential_id, credential_name, operation, persona_id, persona_name, detail, created_at
         FROM credential_audit_log
         WHERE credential_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![credential_id, limit], |row| {
            Ok(CredentialAuditEntry {
                id: row.get(0)?,
                credential_id: row.get(1)?,
                credential_name: row.get(2)?,
                operation: row.get(3)?,
                persona_id: row.get(4)?,
                persona_name: row.get(5)?,
                detail: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Get aggregated usage statistics for a credential.
pub fn get_usage_stats(
    pool: &DbPool,
    credential_id: &str,
) -> Result<CredentialUsageStats, AppError> {
    let conn = pool.get()?;
    let row = conn.query_row(
        "SELECT
            COUNT(*) AS total_accesses,
            COUNT(DISTINCT persona_id) AS distinct_personas,
            MAX(created_at) AS last_accessed_at,
            MIN(created_at) AS first_accessed_at,
            SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS accesses_24h,
            SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS accesses_7d
         FROM credential_audit_log
         WHERE credential_id = ?1",
        params![credential_id],
        |row| {
            Ok(CredentialUsageStats {
                credential_id: credential_id.to_string(),
                total_accesses: row.get::<_, i64>(0)? as u32,
                distinct_personas: row.get::<_, i64>(1)? as u32,
                last_accessed_at: row.get(2)?,
                first_accessed_at: row.get(3)?,
                accesses_last_24h: row.get::<_, i64>(4)? as u32,
                accesses_last_7d: row.get::<_, i64>(5)? as u32,
            })
        },
    )?;
    Ok(row)
}

/// Get all audit log entries across all credentials, newest first.
pub fn get_all(
    pool: &DbPool,
    limit: u32,
) -> Result<Vec<CredentialAuditEntry>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, credential_id, credential_name, operation, persona_id, persona_name, detail, created_at
         FROM credential_audit_log
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(CredentialAuditEntry {
                id: row.get(0)?,
                credential_id: row.get(1)?,
                credential_name: row.get(2)?,
                operation: row.get(3)?,
                persona_id: row.get(4)?,
                persona_name: row.get(5)?,
                detail: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Get personas that depend on a credential, determined two ways:
/// 1. Tool → Connector → Credential link (structural dependency)
/// 2. Audit log history (observed usage)
pub fn get_dependents(
    pool: &DbPool,
    credential_id: &str,
) -> Result<Vec<CredentialDependent>, AppError> {
    let conn = pool.get()?;

    // First get the credential's service_type
    let service_type: String = conn
        .query_row(
            "SELECT service_type FROM persona_credentials WHERE id = ?1",
            params![credential_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("Credential {credential_id}")))?;

    // Find structural dependents: personas whose tools use connectors matching this service_type
    let mut stmt = conn.prepare(
        "SELECT DISTINCT p.id, p.name, cd.label
         FROM personas p
         INNER JOIN persona_tools pt ON pt.persona_id = p.id
         INNER JOIN persona_tool_definitions ptd ON ptd.id = pt.tool_id
         INNER JOIN connector_definitions cd ON cd.name = ?1
         WHERE cd.services LIKE '%' || ptd.name || '%'",
    )?;
    let structural: Vec<CredentialDependent> = stmt
        .query_map(params![service_type], |row| {
            Ok(CredentialDependent {
                persona_id: row.get(0)?,
                persona_name: row.get(1)?,
                link_type: "tool_connector".to_string(),
                via_connector: row.get(2)?,
                last_used_at: None,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Find observed dependents from audit log (personas that have used this credential)
    let mut stmt2 = conn.prepare(
        "SELECT persona_id, persona_name, MAX(created_at) AS last_used
         FROM credential_audit_log
         WHERE credential_id = ?1 AND persona_id IS NOT NULL
         GROUP BY persona_id",
    )?;
    let observed: Vec<CredentialDependent> = stmt2
        .query_map(params![credential_id], |row| {
            Ok(CredentialDependent {
                persona_id: row.get(0)?,
                persona_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                link_type: "audit_log".to_string(),
                via_connector: None,
                last_used_at: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Merge: structural first, then observed (skip duplicates)
    let mut result = structural;
    let existing_ids: std::collections::HashSet<String> =
        result.iter().map(|d| d.persona_id.clone()).collect();
    for dep in observed {
        if !existing_ids.contains(&dep.persona_id) {
            result.push(dep);
        }
    }

    Ok(result)
}
