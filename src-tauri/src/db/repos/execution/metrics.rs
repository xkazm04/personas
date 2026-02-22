use rusqlite::{params, Row};

use crate::db::models::{CreateMetricsSnapshotInput, PersonaMetricsSnapshot, PersonaPromptVersion};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mappers
// ============================================================================

fn row_to_snapshot(row: &Row) -> rusqlite::Result<PersonaMetricsSnapshot> {
    Ok(PersonaMetricsSnapshot {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        snapshot_date: row.get("snapshot_date")?,
        total_executions: row.get("total_executions")?,
        successful_executions: row.get("successful_executions")?,
        failed_executions: row.get("failed_executions")?,
        total_cost_usd: row.get("total_cost_usd")?,
        total_input_tokens: row.get("total_input_tokens")?,
        total_output_tokens: row.get("total_output_tokens")?,
        avg_duration_ms: row.get("avg_duration_ms")?,
        tools_used: row.get("tools_used")?,
        events_emitted: row.get("events_emitted")?,
        events_consumed: row.get("events_consumed")?,
        messages_sent: row.get("messages_sent")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_prompt_version(row: &Row) -> rusqlite::Result<PersonaPromptVersion> {
    Ok(PersonaPromptVersion {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        version_number: row.get("version_number")?,
        structured_prompt: row.get("structured_prompt")?,
        system_prompt: row.get("system_prompt")?,
        change_summary: row.get("change_summary")?,
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Metrics Snapshots
// ============================================================================

pub fn create_snapshot(pool: &DbPool, input: CreateMetricsSnapshotInput) -> Result<(), AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_metrics_snapshots
         (id, persona_id, snapshot_date, total_executions, successful_executions,
          failed_executions, total_cost_usd, total_input_tokens, total_output_tokens,
          avg_duration_ms, tools_used, events_emitted, events_consumed, messages_sent, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            id,
            input.persona_id,
            input.snapshot_date,
            input.total_executions,
            input.successful_executions,
            input.failed_executions,
            input.total_cost_usd,
            input.total_input_tokens,
            input.total_output_tokens,
            input.avg_duration_ms,
            input.tools_used,
            input.events_emitted,
            input.events_consumed,
            input.messages_sent,
            now,
        ],
    )?;

    Ok(())
}

pub fn get_snapshots(
    pool: &DbPool,
    persona_id: Option<&str>,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<PersonaMetricsSnapshot>, AppError> {
    let conn = pool.get()?;

    let mut conditions: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1u32;

    if let Some(pid) = persona_id {
        conditions.push(format!("persona_id = ?{}", param_idx));
        param_values.push(Box::new(pid.to_string()));
        param_idx += 1;
    }
    if let Some(start) = start_date {
        conditions.push(format!("snapshot_date >= ?{}", param_idx));
        param_values.push(Box::new(start.to_string()));
        param_idx += 1;
    }
    if let Some(end) = end_date {
        conditions.push(format!("snapshot_date <= ?{}", param_idx));
        param_values.push(Box::new(end.to_string()));
        // param_idx not needed after this
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT * FROM persona_metrics_snapshots {} ORDER BY snapshot_date DESC",
        where_clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(params_ref.as_slice(), row_to_snapshot)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
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
         (id, persona_id, version_number, structured_prompt, system_prompt, change_summary, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            id,
            persona_id,
            version_number,
            structured_prompt,
            system_prompt,
            change_summary,
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
        created_at: now,
    })
}

pub fn get_prompt_versions(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaPromptVersion>, AppError> {
    let limit = limit.unwrap_or(20);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_prompt_versions WHERE persona_id = ?1 ORDER BY version_number DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], row_to_prompt_version)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ============================================================================
// Live summary from persona_executions
// ============================================================================

pub fn get_summary(pool: &DbPool, days: Option<i64>) -> Result<serde_json::Value, AppError> {
    let days = days.unwrap_or(30);
    let conn = pool.get()?;

    let row = conn.query_row(
        "SELECT
            COUNT(*) as total_executions,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as successful,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
            COALESCE(SUM(cost_usd), 0.0) as total_cost,
            COUNT(DISTINCT persona_id) as active_personas
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1)",
        params![format!("-{} days", days)],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        },
    )?;

    Ok(serde_json::json!({
        "total_executions": row.0,
        "successful_executions": row.1,
        "failed_executions": row.2,
        "total_cost_usd": row.3,
        "active_personas": row.4,
        "period_days": days,
    }))
}

/// Live time-series aggregated directly from `persona_executions` table.
/// Returns one row per (persona_id, date) so the frontend can build charts
/// without requiring the snapshot background job.
pub fn get_live_timeseries(
    pool: &DbPool,
    days: Option<i64>,
    persona_id: Option<&str>,
) -> Result<Vec<PersonaMetricsSnapshot>, AppError> {
    let days = days.unwrap_or(30);
    let conn = pool.get()?;

    let (sql, param_values): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(pid) = persona_id {
        (
            format!(
                "SELECT
                    persona_id,
                    DATE(created_at) as snapshot_date,
                    COUNT(*) as total_executions,
                    COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as successful_executions,
                    COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed_executions,
                    COALESCE(SUM(cost_usd), 0.0) as total_cost_usd,
                    COALESCE(SUM(input_tokens), 0) as total_input_tokens,
                    COALESCE(SUM(output_tokens), 0) as total_output_tokens,
                    COALESCE(AVG(duration_ms), 0.0) as avg_duration_ms
                 FROM persona_executions
                 WHERE created_at >= datetime('now', ?1) AND persona_id = ?2
                 GROUP BY persona_id, DATE(created_at)
                 ORDER BY snapshot_date ASC"
            ),
            vec![
                Box::new(format!("-{} days", days)) as Box<dyn rusqlite::types::ToSql>,
                Box::new(pid.to_string()),
            ],
        )
    } else {
        (
            format!(
                "SELECT
                    persona_id,
                    DATE(created_at) as snapshot_date,
                    COUNT(*) as total_executions,
                    COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as successful_executions,
                    COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed_executions,
                    COALESCE(SUM(cost_usd), 0.0) as total_cost_usd,
                    COALESCE(SUM(input_tokens), 0) as total_input_tokens,
                    COALESCE(SUM(output_tokens), 0) as total_output_tokens,
                    COALESCE(AVG(duration_ms), 0.0) as avg_duration_ms
                 FROM persona_executions
                 WHERE created_at >= datetime('now', ?1)
                 GROUP BY persona_id, DATE(created_at)
                 ORDER BY snapshot_date ASC"
            ),
            vec![Box::new(format!("-{} days", days)) as Box<dyn rusqlite::types::ToSql>],
        )
    };

    let mut stmt = conn.prepare(&sql)?;
    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(PersonaMetricsSnapshot {
            id: String::new(),
            persona_id: row.get("persona_id")?,
            snapshot_date: row.get("snapshot_date")?,
            total_executions: row.get("total_executions")?,
            successful_executions: row.get("successful_executions")?,
            failed_executions: row.get("failed_executions")?,
            total_cost_usd: row.get("total_cost_usd")?,
            total_input_tokens: row.get("total_input_tokens")?,
            total_output_tokens: row.get("total_output_tokens")?,
            avg_duration_ms: row.get("avg_duration_ms")?,
            tools_used: None,
            events_emitted: 0,
            events_consumed: 0,
            messages_sent: 0,
            created_at: String::new(),
        })
    })?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_snapshot_crud() {
        let pool = init_test_db().unwrap();

        // Create snapshot
        create_snapshot(
            &pool,
            CreateMetricsSnapshotInput {
                persona_id: "persona-1".into(),
                snapshot_date: "2025-01-15".into(),
                total_executions: 100,
                successful_executions: 90,
                failed_executions: 10,
                total_cost_usd: 5.25,
                total_input_tokens: 50000,
                total_output_tokens: 25000,
                avg_duration_ms: 1500.0,
                tools_used: Some(r#"["http_request","file_read"]"#.into()),
                events_emitted: 20,
                events_consumed: 15,
                messages_sent: 5,
            },
        )
        .unwrap();

        // Get all snapshots
        let all = get_snapshots(&pool, None, None, None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].persona_id, "persona-1");
        assert_eq!(all[0].total_executions, 100);

        // Get by persona
        let by_persona = get_snapshots(&pool, Some("persona-1"), None, None).unwrap();
        assert_eq!(by_persona.len(), 1);

        // Get by non-existent persona
        let empty = get_snapshots(&pool, Some("no-one"), None, None).unwrap();
        assert_eq!(empty.len(), 0);

        // Get with date range
        let in_range =
            get_snapshots(&pool, None, Some("2025-01-01"), Some("2025-01-31")).unwrap();
        assert_eq!(in_range.len(), 1);

        let out_range =
            get_snapshots(&pool, None, Some("2025-02-01"), Some("2025-02-28")).unwrap();
        assert_eq!(out_range.len(), 0);
    }

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
        let summary = get_summary(&pool, Some(30)).unwrap();
        assert_eq!(summary["total_executions"], 0);
        assert_eq!(summary["active_personas"], 0);
    }
}
