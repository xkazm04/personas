use rusqlite::{params, Row};

use crate::db::models::{ExecutionKnowledge, KnowledgeGraphSummary};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_knowledge(row: &Row) -> rusqlite::Result<ExecutionKnowledge> {
    Ok(ExecutionKnowledge {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        use_case_id: row.get("use_case_id")?,
        knowledge_type: row.get("knowledge_type")?,
        pattern_key: row.get("pattern_key")?,
        pattern_data: row.get("pattern_data")?,
        success_count: row.get::<_, Option<i64>>("success_count")?.unwrap_or(0),
        failure_count: row.get::<_, Option<i64>>("failure_count")?.unwrap_or(0),
        avg_cost_usd: row.get::<_, Option<f64>>("avg_cost_usd")?.unwrap_or(0.0),
        avg_duration_ms: row.get::<_, Option<f64>>("avg_duration_ms")?.unwrap_or(0.0),
        confidence: row.get::<_, Option<f64>>("confidence")?.unwrap_or(0.0),
        last_execution_id: row.get("last_execution_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Upsert a knowledge entry — update counts and averages if the unique key exists.
pub fn upsert(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: Option<&str>,
    knowledge_type: &str,
    pattern_key: &str,
    pattern_data: &str,
    success: bool,
    cost_usd: f64,
    duration_ms: f64,
    execution_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    // Use INSERT OR REPLACE with computed running averages
    conn.execute(
        "INSERT INTO execution_knowledge
            (id, persona_id, use_case_id, knowledge_type, pattern_key, pattern_data,
             success_count, failure_count, avg_cost_usd, avg_duration_ms,
             confidence, last_execution_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
         ON CONFLICT(persona_id, knowledge_type, pattern_key) DO UPDATE SET
            pattern_data = ?6,
            success_count = success_count + ?7,
            failure_count = failure_count + ?8,
            avg_cost_usd = CASE
                WHEN (success_count + failure_count + 1) > 0
                THEN (avg_cost_usd * (success_count + failure_count) + ?9) / (success_count + failure_count + 1)
                ELSE ?9
            END,
            avg_duration_ms = CASE
                WHEN (success_count + failure_count + 1) > 0
                THEN (avg_duration_ms * (success_count + failure_count) + ?10) / (success_count + failure_count + 1)
                ELSE ?10
            END,
            confidence = CASE
                WHEN (success_count + failure_count + 1) > 0
                THEN CAST(success_count + ?7 AS REAL) / (success_count + failure_count + 1)
                ELSE ?11
            END,
            last_execution_id = ?12,
            updated_at = ?13",
        params![
            id,
            persona_id,
            use_case_id,
            knowledge_type,
            pattern_key,
            pattern_data,
            if success { 1i64 } else { 0i64 },
            if success { 0i64 } else { 1i64 },
            cost_usd,
            duration_ms,
            if success { 1.0f64 } else { 0.0f64 },
            execution_id,
            now,
        ],
    )?;

    Ok(())
}

/// List knowledge entries for a persona, optionally filtered by type.
pub fn list_for_persona(
    pool: &DbPool,
    persona_id: &str,
    knowledge_type: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    let conn = pool.get()?;
    let limit = limit.unwrap_or(50);

    if let Some(kt) = knowledge_type {
        let mut stmt = conn.prepare(
            "SELECT * FROM execution_knowledge
             WHERE persona_id = ?1 AND knowledge_type = ?2
             ORDER BY confidence DESC, updated_at DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, kt, limit], row_to_knowledge)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM execution_knowledge
             WHERE persona_id = ?1
             ORDER BY confidence DESC, updated_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![persona_id, limit], row_to_knowledge)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    }
}

/// Get high-confidence knowledge for injection into execution prompts.
pub fn get_injection_guidance(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: Option<&str>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    let conn = pool.get()?;

    let mut stmt = conn.prepare(
        "SELECT * FROM execution_knowledge
         WHERE persona_id = ?1
           AND (use_case_id IS NULL OR use_case_id = ?2)
           AND confidence >= 0.5
           AND (success_count + failure_count) >= 3
         ORDER BY confidence DESC
         LIMIT 20",
    )?;

    let rows = stmt.query_map(
        params![persona_id, use_case_id.unwrap_or("")],
        row_to_knowledge,
    )?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Get a summary of the knowledge graph for dashboard display.
pub fn get_summary(
    pool: &DbPool,
    persona_id: Option<&str>,
) -> Result<KnowledgeGraphSummary, AppError> {
    let conn = pool.get()?;

    let (where_clause, persona_filter) = if let Some(pid) = persona_id {
        ("WHERE persona_id = ?1", Some(pid.to_string()))
    } else {
        ("", None)
    };

    let count_sql = format!(
        "SELECT
            COUNT(*) as total,
            SUM(CASE WHEN knowledge_type = 'tool_sequence' THEN 1 ELSE 0 END),
            SUM(CASE WHEN knowledge_type = 'failure_pattern' THEN 1 ELSE 0 END),
            SUM(CASE WHEN knowledge_type = 'model_performance' THEN 1 ELSE 0 END)
         FROM execution_knowledge {}",
        where_clause
    );

    let (total, tool_seq, fail_pat, model_perf) = if let Some(ref pid) = persona_filter {
        conn.query_row(&count_sql, params![pid], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            ))
        })?
    } else {
        conn.query_row(&count_sql, [], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            ))
        })?
    };

    // Top patterns by confidence
    let top_sql = format!(
        "SELECT * FROM execution_knowledge {}
         ORDER BY confidence DESC, (success_count + failure_count) DESC
         LIMIT 10",
        where_clause
    );
    let top_patterns = if let Some(ref pid) = persona_filter {
        let mut stmt = conn.prepare(&top_sql)?;
        let rows = stmt.query_map(params![pid], row_to_knowledge)?;
        rows.filter_map(|r| r.ok()).collect()
    } else {
        let mut stmt = conn.prepare(&top_sql)?;
        let rows = stmt.query_map([], row_to_knowledge)?;
        rows.filter_map(|r| r.ok()).collect()
    };

    // Recent learnings
    let recent_sql = format!(
        "SELECT * FROM execution_knowledge {}
         ORDER BY updated_at DESC
         LIMIT 10",
        where_clause
    );
    let recent_learnings = if let Some(ref pid) = persona_filter {
        let mut stmt = conn.prepare(&recent_sql)?;
        let rows = stmt.query_map(params![pid], row_to_knowledge)?;
        rows.filter_map(|r| r.ok()).collect()
    } else {
        let mut stmt = conn.prepare(&recent_sql)?;
        let rows = stmt.query_map([], row_to_knowledge)?;
        rows.filter_map(|r| r.ok()).collect()
    };

    Ok(KnowledgeGraphSummary {
        total_entries: total,
        tool_sequence_count: tool_seq,
        failure_pattern_count: fail_pat,
        model_performance_count: model_perf,
        top_patterns,
        recent_learnings,
    })
}
