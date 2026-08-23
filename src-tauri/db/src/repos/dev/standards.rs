use crate::models::DevStandard;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

// ============================================================================
// Dev Standards (Pipeline Stage 3b — golden-standard scan findings)
// ============================================================================

fn row_to_standard(row: &Row) -> rusqlite::Result<DevStandard> {
    Ok(DevStandard {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        scan_id: row.get("scan_id").unwrap_or(None),
        rule_key: row.get("rule_key")?,
        category: row.get("category")?,
        title: row.get("title")?,
        status: row.get("status")?,
        severity: row.get("severity")?,
        evidence: row.get("evidence").unwrap_or(None),
        recommendation: row.get("recommendation").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_standard(
    pool: &DbPool,
    project_id: &str,
    scan_id: Option<&str>,
    rule_key: &str,
    category: &str,
    title: &str,
    status: &str,
    severity: &str,
    evidence: Option<&str>,
    recommendation: Option<&str>,
) -> Result<DevStandard, AppError> {
    timed_query!("dev_standards", "dev_standards::create_standard", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_standards (id, project_id, scan_id, rule_key, category, title, status, severity, evidence, recommendation, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![id, project_id, scan_id, rule_key, category, title, status, severity, evidence, recommendation, now],
        )?;
        conn.query_row(
            "SELECT * FROM dev_standards WHERE id = ?1",
            params![id],
            row_to_standard,
        )
        .map_err(Into::into)
    })
}

pub fn list_standards_by_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevStandard>, AppError> {
    timed_query!(
        "dev_standards",
        "dev_standards::list_standards_by_project",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_standards WHERE project_id = ?1 ORDER BY category, rule_key",
            )?;
            let rows = stmt.query_map(params![project_id], row_to_standard)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        }
    )
}

pub fn clear_standards_for_project(pool: &DbPool, project_id: &str) -> Result<usize, AppError> {
    timed_query!(
        "dev_standards",
        "dev_standards::clear_standards_for_project",
        {
            let conn = pool.get()?;
            let n = conn.execute(
                "DELETE FROM dev_standards WHERE project_id = ?1",
                params![project_id],
            )?;
            Ok(n)
        }
    )
}
