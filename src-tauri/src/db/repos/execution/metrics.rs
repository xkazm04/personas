use rusqlite::{params, Row};

use crate::db::models::{
    MetricsChartData, MetricsChartPoint, MetricsPersonaBreakdown,
    PersonaPromptVersion,
};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mappers
// ============================================================================

fn row_to_prompt_version(row: &Row) -> rusqlite::Result<PersonaPromptVersion> {
    Ok(PersonaPromptVersion {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        version_number: row.get("version_number")?,
        structured_prompt: row.get("structured_prompt")?,
        system_prompt: row.get("system_prompt")?,
        change_summary: row.get("change_summary")?,
        tag: row.get::<_, Option<String>>("tag")?.unwrap_or_else(|| "experimental".into()),
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Prompt Versions
// ============================================================================

pub fn create_prompt_version(
    pool: &DbPool,
    persona_id: &str,
    structured_prompt: Option<String>,
    system_prompt: Option<String>,
    change_summary: Option<String>,
) -> Result<PersonaPromptVersion, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let tag = "experimental".to_string();

    let conn = pool.get()?;

    // Auto-compute version_number as MAX + 1
    let version_number: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM persona_prompt_versions WHERE persona_id = ?1",
            params![persona_id],
            |row| row.get(0),
        )?;

    conn.execute(
        "INSERT INTO persona_prompt_versions
         (id, persona_id, version_number, structured_prompt, system_prompt, change_summary, tag, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            persona_id,
            version_number,
            structured_prompt,
            system_prompt,
            change_summary,
            tag,
            now,
        ],
    )?;

    Ok(PersonaPromptVersion {
        id,
        persona_id: persona_id.to_string(),
        version_number,
        structured_prompt,
        system_prompt,
        change_summary,
        tag,
        created_at: now,
    })
}

/// Creates a version only if the prompt actually changed from the latest version.
/// Returns Some(version) if created, None if unchanged.
pub fn create_prompt_version_if_changed(
    pool: &DbPool,
    persona_id: &str,
    structured_prompt: Option<String>,
    system_prompt: Option<String>,
) -> Result<Option<PersonaPromptVersion>, AppError> {
    let conn = pool.get()?;

    // Get latest version's prompt to diff
    let latest: Option<(Option<String>,)> = conn
        .query_row(
            "SELECT structured_prompt FROM persona_prompt_versions
             WHERE persona_id = ?1 ORDER BY version_number DESC LIMIT 1",
            params![persona_id],
            |row| Ok((row.get(0)?,)),
        )
        .ok();

    let latest_prompt = latest.and_then(|r| r.0);

    // Skip if prompts are identical
    if latest_prompt.as_deref() == structured_prompt.as_deref() {
        return Ok(None);
    }

    let version = create_prompt_version(
        pool,
        persona_id,
        structured_prompt,
        system_prompt,
        Some("Auto-saved".into()),
    )?;
    Ok(Some(version))
}

pub fn get_prompt_versions(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaPromptVersion>, AppError> {
    let limit = limit.unwrap_or(50);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_prompt_versions WHERE persona_id = ?1 ORDER BY version_number DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], row_to_prompt_version)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_prompt_version_by_id(
    pool: &DbPool,
    id: &str,
) -> Result<PersonaPromptVersion, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_prompt_versions WHERE id = ?1",
        params![id],
        row_to_prompt_version,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Prompt version {id}")),
        other => AppError::Database(other),
    })
}

pub fn update_prompt_version_tag(
    pool: &DbPool,
    id: &str,
    tag: &str,
) -> Result<PersonaPromptVersion, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "UPDATE persona_prompt_versions SET tag = ?1 WHERE id = ?2",
        params![tag, id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Prompt version {id}")));
    }
    get_prompt_version_by_id(pool, id)
}

/// Get the current production version for a persona, if any.
pub fn get_production_version(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<PersonaPromptVersion>, AppError> {
    let conn = pool.get()?;
    let result = conn.query_row(
        "SELECT * FROM persona_prompt_versions WHERE persona_id = ?1 AND tag = 'production' ORDER BY version_number DESC LIMIT 1",
        params![persona_id],
        row_to_prompt_version,
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Get recent error rate for a persona (last N executions).
pub fn get_recent_error_rate(
    pool: &DbPool,
    persona_id: &str,
    window: i64,
) -> Result<f64, AppError> {
    let conn = pool.get()?;
    let (total, failed): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END)
         FROM (SELECT status FROM persona_executions WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT ?2)",
        params![persona_id, window],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if total == 0 {
        return Ok(0.0);
    }
    Ok(failed as f64 / total as f64)
}

// ============================================================================
// Optional persona_id filter helper
// ============================================================================

/// Builds the optional `AND persona_id = ?N` clause and matching param vec.
/// The date_filter string is always `?1`; if `persona_id` is Some, it becomes `?2`.
fn persona_filter_params(
    date_filter: String,
    persona_id: Option<&str>,
) -> (String, Vec<Box<dyn rusqlite::types::ToSql>>) {
    match persona_id {
        Some(pid) => (
            " AND persona_id = ?2".to_string(),
            vec![
                Box::new(date_filter) as Box<dyn rusqlite::types::ToSql>,
                Box::new(pid.to_string()),
            ],
        ),
        None => (
            String::new(),
            vec![Box::new(date_filter) as Box<dyn rusqlite::types::ToSql>],
        ),
    }
}

// ============================================================================
// Live summary from persona_executions
// ============================================================================

pub fn get_summary(pool: &DbPool, days: Option<i64>, persona_id: Option<&str>) -> Result<serde_json::Value, AppError> {
    let days = days.unwrap_or(30);
    let conn = pool.get()?;
    let (pid_clause, param_values) = persona_filter_params(format!("-{} days", days), persona_id);

    let sql = format!(
        "SELECT
            COUNT(*) as total_executions,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as successful,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
            COALESCE(SUM(cost_usd), 0.0) as total_cost,
            COUNT(DISTINCT persona_id) as active_personas
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1){pid_clause}"
    );

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let row = conn.query_row(&sql, params_ref.as_slice(), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, f64>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;

    Ok(serde_json::json!({
        "total_executions": row.0,
        "successful_executions": row.1,
        "failed_executions": row.2,
        "total_cost_usd": row.3,
        "active_personas": row.4,
        "period_days": days,
    }))
}

// ============================================================================
// Pre-bucketed chart data (aggregated in SQL, replaces frontend pivot logic)
// ============================================================================

/// Returns chart-ready time-series and per-persona breakdown in a single call.
/// The SQL GROUP BY produces the same result as the ~30 lines of client-side
/// Map-based aggregation that previously ran in ObservabilityDashboard.
pub fn get_chart_data(
    pool: &DbPool,
    days: Option<i64>,
    persona_id: Option<&str>,
) -> Result<MetricsChartData, AppError> {
    let days = days.unwrap_or(30);
    let conn = pool.get()?;
    let (pid_clause, param_values) = persona_filter_params(format!("-{} days", days), persona_id);

    // 1) Date-bucketed chart points (GROUP BY date only)
    let chart_sql = format!(
        "SELECT
            DATE(created_at) as date,
            COALESCE(SUM(cost_usd), 0.0) as cost,
            COUNT(*) as executions,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as success,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
            COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) as tokens,
            COUNT(DISTINCT persona_id) as active_personas
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1){pid_clause}
         GROUP BY DATE(created_at)
         ORDER BY date ASC"
    );

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let chart_points = {
        let mut stmt = conn.prepare(&chart_sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok(MetricsChartPoint {
                date: row.get("date")?,
                cost: row.get("cost")?,
                executions: row.get("executions")?,
                success: row.get("success")?,
                failed: row.get("failed")?,
                tokens: row.get("tokens")?,
                active_personas: row.get("active_personas")?,
            })
        })?;
        rows.filter_map(|r| r.ok()).collect()
    };

    // 2) Per-persona breakdown (for pie chart)
    let breakdown_sql = format!(
        "SELECT
            persona_id,
            COUNT(*) as executions,
            COALESCE(SUM(cost_usd), 0.0) as cost
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1){pid_clause}
         GROUP BY persona_id
         HAVING executions > 0"
    );

    let persona_breakdown = {
        let mut stmt = conn.prepare(&breakdown_sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok(MetricsPersonaBreakdown {
                persona_id: row.get("persona_id")?,
                executions: row.get("executions")?,
                cost: row.get("cost")?,
            })
        })?;
        rows.filter_map(|r| r.ok()).collect()
    };

    Ok(MetricsChartData {
        chart_points,
        persona_breakdown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_prompt_version_auto_increment() {
        let pool = init_test_db().unwrap();

        let v1 = create_prompt_version(
            &pool,
            "persona-1",
            None,
            Some("You are v1.".into()),
            Some("Initial version".into()),
        )
        .unwrap();
        assert_eq!(v1.version_number, 1);

        let v2 = create_prompt_version(
            &pool,
            "persona-1",
            None,
            Some("You are v2.".into()),
            Some("Updated prompt".into()),
        )
        .unwrap();
        assert_eq!(v2.version_number, 2);

        // Different persona starts at 1
        let other = create_prompt_version(
            &pool,
            "persona-2",
            Some("structured".into()),
            None,
            None,
        )
        .unwrap();
        assert_eq!(other.version_number, 1);

        // List versions for persona-1
        let versions = get_prompt_versions(&pool, "persona-1", None).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].version_number, 2); // DESC order
        assert_eq!(versions[1].version_number, 1);
    }

    #[test]
    fn test_summary() {
        let pool = init_test_db().unwrap();

        // Summary with no executions
        let summary = get_summary(&pool, Some(30), None).unwrap();
        assert_eq!(summary["total_executions"], 0);
        assert_eq!(summary["active_personas"], 0);
    }
}
