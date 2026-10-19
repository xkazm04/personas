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

/// Make `scan_id` the project's verdict: retire every finding that did not come
/// from it. The standards scan calls this only AFTER it finished with findings,
/// so a scan that fails, times out or parses nothing never erases the verdict
/// it was meant to replace (the old shape cleared the table before the CLI even
/// spawned, so one failed run left the project with no standards at all).
pub fn supersede_standards(
    pool: &DbPool,
    project_id: &str,
    scan_id: &str,
) -> Result<usize, AppError> {
    timed_query!("dev_standards", "dev_standards::supersede_standards", {
        let conn = pool.get()?;
        let n = conn.execute(
            "DELETE FROM dev_standards
             WHERE project_id = ?1 AND (scan_id IS NULL OR scan_id <> ?2)",
            params![project_id, scan_id],
        )?;
        Ok(n)
    })
}

/// Drop what a failed scan managed to write before it failed, so the previous
/// verdict is the only one listed (and the compliance figure is not computed
/// over two half-overlapping scans).
pub fn discard_scan_standards(
    pool: &DbPool,
    project_id: &str,
    scan_id: &str,
) -> Result<usize, AppError> {
    timed_query!("dev_standards", "dev_standards::discard_scan_standards", {
        let conn = pool.get()?;
        let n = conn.execute(
            "DELETE FROM dev_standards WHERE project_id = ?1 AND scan_id = ?2",
            params![project_id, scan_id],
        )?;
        Ok(n)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::dev::projects::create_project;

    fn seed(
        pool: &DbPool,
        project_id: &str,
        scan_id: Option<&str>,
        rule: &str,
    ) -> Result<(), AppError> {
        create_standard(
            pool, project_id, scan_id, rule, "docs", rule, "present", "info", None, None,
        )?;
        Ok(())
    }

    fn rules(pool: &DbPool, project_id: &str) -> Result<Vec<(String, Option<String>)>, AppError> {
        Ok(list_standards_by_project(pool, project_id)?
            .into_iter()
            .map(|s| (s.rule_key, s.scan_id))
            .collect())
    }

    #[test]
    fn a_finished_scan_supersedes_every_older_finding_of_its_project_only() -> Result<(), AppError>
    {
        let pool = crate::init_test_db()?;
        let p = create_project(&pool, "P", "/tmp/std-p", None, None, None, None, None)?;
        let q = create_project(&pool, "Q", "/tmp/std-q", None, None, None, None, None)?;
        seed(&pool, &p.id, Some("old"), "docs.readme")?;
        seed(&pool, &p.id, None, "docs.contributing")?;
        seed(&pool, &p.id, Some("new"), "docs.readme")?;
        seed(&pool, &q.id, Some("old"), "docs.readme")?;

        assert_eq!(supersede_standards(&pool, &p.id, "new")?, 2);
        assert_eq!(
            rules(&pool, &p.id)?,
            vec![("docs.readme".to_string(), Some("new".to_string()))]
        );
        assert_eq!(
            rules(&pool, &q.id)?.len(),
            1,
            "another project's verdict is untouched"
        );
        Ok(())
    }

    #[test]
    fn a_failed_scan_leaves_the_previous_verdict_standing() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let p = create_project(&pool, "P", "/tmp/std-f", None, None, None, None, None)?;
        seed(&pool, &p.id, Some("old"), "docs.readme")?;
        seed(&pool, &p.id, Some("old"), "tests.exist")?;
        seed(&pool, &p.id, Some("failed"), "docs.readme")?;

        assert_eq!(discard_scan_standards(&pool, &p.id, "failed")?, 1);
        assert_eq!(
            rules(&pool, &p.id)?,
            vec![
                ("docs.readme".to_string(), Some("old".to_string())),
                ("tests.exist".to_string(), Some("old".to_string())),
            ]
        );
        Ok(())
    }
}
