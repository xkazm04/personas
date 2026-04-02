use rusqlite::{params, Row};
use tracing::warn;

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
        scope_type: row.get::<_, Option<String>>("scope_type")?.unwrap_or_else(|| "persona".to_string()),
        scope_id: row.get("scope_id")?,
        annotation_text: row.get("annotation_text")?,
        annotation_source: row.get("annotation_source")?,
        is_verified: row.get::<_, Option<bool>>("is_verified")?.unwrap_or(false),
    })
}

/// Upsert a knowledge entry -- update counts and averages if the unique key exists.
/// Also maintains a `recentResults` array (last 10 booleans) in pattern_data for sparkline display.
#[allow(clippy::too_many_arguments)]
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
    timed_query!("knowledge_entries", "knowledge_entries::upsert", {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    // Merge recentResults into pattern_data (keep last 10 execution outcomes)
    let merged_pattern_data = {
        let mut new_data: serde_json::Value = serde_json::from_str(pattern_data)
            .unwrap_or_else(|_| serde_json::Value::Object(Default::default()));

        let existing: Option<String> = conn
            .query_row(
                "SELECT pattern_data FROM execution_knowledge WHERE persona_id = ?1 AND knowledge_type = ?2 AND pattern_key = ?3",
                params![persona_id, knowledge_type, pattern_key],
                |row| row.get(0),
            )
            .ok();

        let mut recent: Vec<bool> = existing
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("recentResults").cloned())
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        recent.push(success);
        if recent.len() > 10 {
            let start = recent.len() - 10;
            recent = recent[start..].to_vec();
        }

        new_data["recentResults"] = serde_json::json!(recent);
        new_data.to_string()
    };

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
            merged_pattern_data,
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
    })
}

/// Upsert a knowledge annotation -- cross-persona knowledge scoped to a tool, connector, or global.
#[allow(clippy::too_many_arguments)]
pub fn upsert_annotation(
    pool: &DbPool,
    persona_id: &str,
    scope_type: &str,
    scope_id: Option<&str>,
    annotation_text: &str,
    annotation_source: &str,
    execution_id: Option<&str>,
) -> Result<ExecutionKnowledge, AppError> {
    timed_query!("knowledge_entries", "knowledge_entries::upsert_annotation", {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    // For annotations, the knowledge_type is based on source
    let knowledge_type = match annotation_source {
        "user" => "user_annotation",
        _ => "agent_annotation",
    };

    // Pattern key: scope_type:scope_id:hash_of_text for dedup
    let scope_key = scope_id.unwrap_or("_global");
    let pattern_key = format!("{}:{}:{}", scope_type, scope_key,
        &format!("{:x}", fnv1a_hash(annotation_text))[..8]);

    let pattern_data = serde_json::json!({
        "scope_type": scope_type,
        "scope_id": scope_id,
    }).to_string();

    conn.execute(
        "INSERT INTO execution_knowledge
            (id, persona_id, knowledge_type, pattern_key, pattern_data,
             success_count, failure_count, avg_cost_usd, avg_duration_ms,
             confidence, last_execution_id, created_at, updated_at,
             scope_type, scope_id, annotation_text, annotation_source, is_verified)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, 0, 0.0, 0.0, 0.5, ?6, ?7, ?7,
                 ?8, ?9, ?10, ?11, 0)
         ON CONFLICT(persona_id, knowledge_type, pattern_key) DO UPDATE SET
            annotation_text = ?10,
            annotation_source = ?11,
            success_count = success_count + 1,
            confidence = CASE
                WHEN is_verified = 1 THEN 1.0
                ELSE MIN(0.9, confidence + 0.1)
            END,
            last_execution_id = ?6,
            updated_at = ?7",
        params![
            id, persona_id, knowledge_type, pattern_key, pattern_data,
            execution_id, now,
            scope_type, scope_id, annotation_text, annotation_source,
        ],
    )?;

    // Return the upserted row
    let row = conn.query_row(
        "SELECT * FROM execution_knowledge WHERE persona_id = ?1 AND knowledge_type = ?2 AND pattern_key = ?3",
        params![persona_id, knowledge_type, pattern_key],
        row_to_knowledge,
    )?;
    Ok(row)
    })
}

/// FNV-1a hash for deduplication (not cryptographic).
fn fnv1a_hash(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Mark a knowledge annotation as verified by a user.
pub fn verify_annotation(pool: &DbPool, knowledge_id: &str) -> Result<(), AppError> {
    timed_query!("knowledge_entries", "knowledge_entries::verify_annotation", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE execution_knowledge SET is_verified = 1, confidence = 1.0, updated_at = ?1 WHERE id = ?2",
            params![now, knowledge_id],
        )?;
        Ok(())
    })
}

/// Dismiss (delete) a knowledge annotation.
pub fn dismiss_annotation(pool: &DbPool, knowledge_id: &str) -> Result<(), AppError> {
    timed_query!("knowledge_entries", "knowledge_entries::dismiss_annotation", {
        let conn = pool.get()?;
        conn.execute("DELETE FROM execution_knowledge WHERE id = ?1", params![knowledge_id])?;
        Ok(())
    })
}

/// List knowledge by scope (cross-persona). Returns entries from any persona
/// that match the given scope type and optional scope ID.
pub fn list_by_scope(
    pool: &DbPool,
    scope_type: &str,
    scope_id: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    timed_query!("knowledge_entries", "knowledge_entries::list_by_scope", {
        let conn = pool.get()?;

        let mut qb = crate::db::query_builder::QueryBuilder::new();
        qb.where_eq("scope_type", scope_type.to_string());
        if let Some(sid) = scope_id {
            qb.where_eq("scope_id", sid.to_string());
        }
        qb.order_by_multiple(&[("is_verified", "DESC"), ("confidence", "DESC"), ("updated_at", "DESC")]);
        qb.limit(limit.unwrap_or(50));

        let sql = qb.build_select("SELECT * FROM execution_knowledge");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_knowledge)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Get cross-persona knowledge for prompt injection based on tool/connector assignments.
/// Returns high-confidence, tool/connector/global scoped knowledge entries.
///
/// Uses batched IN clauses instead of per-item queries to avoid N+1 overhead.
pub fn get_shared_injection(
    pool: &DbPool,
    tool_names: &[&str],
    connector_types: &[&str],
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    timed_query!("knowledge_entries", "knowledge_entries::get_shared_injection", {
    let conn = pool.get()?;

    let mut results = Vec::new();

    // Helper: build a batched query with dynamic IN clause placeholders
    fn fetch_scoped(
        conn: &rusqlite::Connection,
        scope_type: &str,
        scope_ids: &[&str],
        min_confidence: f64,
    ) -> Result<Vec<ExecutionKnowledge>, AppError> {
        if scope_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (0..scope_ids.len()).map(|i| format!("?{}", i + 3)).collect();
        let sql = format!(
            "SELECT * FROM execution_knowledge
             WHERE scope_type = ?1 AND scope_id IN ({})
               AND confidence >= ?2
               AND (success_count + failure_count) >= 2
             ORDER BY is_verified DESC, confidence DESC",
            placeholders.join(", "),
        );
        let mut stmt = conn.prepare(&sql)?;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::with_capacity(scope_ids.len() + 2);
        param_values.push(Box::new(scope_type.to_string()));
        param_values.push(Box::new(min_confidence));
        for id in scope_ids {
            param_values.push(Box::new(id.to_string()));
        }
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), row_to_knowledge)?;
        Ok(rows.filter_map(|r| match r {
            Ok(v) => Some(v),
            Err(e) => {
                warn!(scope = scope_type, error = %e, "Failed to read knowledge row");
                None
            }
        }).collect())
    }

    // Tool-scoped knowledge (single batched query)
    results.extend(fetch_scoped(&conn, "tool", tool_names, 0.5)?);

    // Connector-scoped knowledge (single batched query)
    results.extend(fetch_scoped(&conn, "connector", connector_types, 0.5)?);

    // Global knowledge
    let mut stmt = conn.prepare(
        "SELECT * FROM execution_knowledge
         WHERE scope_type = 'global'
           AND confidence >= 0.6
         ORDER BY is_verified DESC, confidence DESC
         LIMIT 10",
    )?;
    let rows = stmt.query_map([], row_to_knowledge)?;
    results.extend(rows.filter_map(|r| match r {
        Ok(v) => Some(v),
        Err(e) => {
            warn!(scope = "global", error = %e, "Failed to read knowledge row");
            None
        }
    }));

    // Dedup by pattern_key
    let mut seen = std::collections::HashSet::new();
    results.retain(|e| seen.insert(e.pattern_key.clone()));

    Ok(results)
    })
}

/// List knowledge entries for a persona, optionally filtered by type.
pub fn list_for_persona(
    pool: &DbPool,
    persona_id: &str,
    knowledge_type: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    timed_query!("knowledge_entries", "knowledge_entries::list_for_persona", {
        let conn = pool.get()?;

        let mut qb = crate::db::query_builder::QueryBuilder::new();
        qb.where_eq("persona_id", persona_id.to_string());
        if let Some(kt) = knowledge_type {
            qb.where_eq("knowledge_type", kt.to_string());
        }
        qb.order_by_multiple(&[("confidence", "DESC"), ("updated_at", "DESC")]);
        qb.limit(limit.unwrap_or(50));

        let sql = qb.build_select("SELECT * FROM execution_knowledge");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_knowledge)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Get high-confidence knowledge for injection into execution prompts.
pub fn get_injection_guidance(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: Option<&str>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    timed_query!("knowledge_entries", "knowledge_entries::get_injection_guidance", {
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
    })
}

/// Query execution_knowledge with an optional persona_id filter, returning mapped rows.
fn query_with_optional_persona(
    conn: &rusqlite::Connection,
    sql: &str,
    persona_id: Option<&str>,
) -> Result<Vec<ExecutionKnowledge>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = if let Some(pid) = persona_id {
        stmt.query_map(params![pid], row_to_knowledge)?
    } else {
        stmt.query_map([], row_to_knowledge)?
    };
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Get a summary of the knowledge graph for dashboard display.
pub fn get_summary(
    pool: &DbPool,
    persona_id: Option<&str>,
) -> Result<KnowledgeGraphSummary, AppError> {
    timed_query!("knowledge_entries", "knowledge_entries::get_summary", {
    let conn = pool.get()?;

    let where_clause = if persona_id.is_some() {
        "WHERE persona_id = ?1"
    } else {
        ""
    };

    let count_sql = format!(
        "SELECT
            COUNT(*) as total,
            SUM(CASE WHEN knowledge_type = 'tool_sequence' THEN 1 ELSE 0 END),
            SUM(CASE WHEN knowledge_type = 'failure_pattern' THEN 1 ELSE 0 END),
            SUM(CASE WHEN knowledge_type = 'model_performance' THEN 1 ELSE 0 END),
            SUM(CASE WHEN knowledge_type IN ('agent_annotation','user_annotation') THEN 1 ELSE 0 END)
         FROM execution_knowledge {where_clause}"
    );

    let (total, tool_seq, fail_pat, model_perf, annotation_cnt) = if let Some(pid) = persona_id {
        conn.query_row(&count_sql, params![pid], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                row.get::<_, Option<i64>>(4)?.unwrap_or(0),
            ))
        })?
    } else {
        conn.query_row(&count_sql, [], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                row.get::<_, Option<i64>>(4)?.unwrap_or(0),
            ))
        })?
    };

    let top_sql = format!(
        "SELECT * FROM execution_knowledge {where_clause}
         ORDER BY confidence DESC, (success_count + failure_count) DESC
         LIMIT 10"
    );
    let top_patterns = query_with_optional_persona(&conn, &top_sql, persona_id)?;

    let recent_sql = format!(
        "SELECT * FROM execution_knowledge {where_clause}
         ORDER BY updated_at DESC
         LIMIT 10"
    );
    let recent_learnings = query_with_optional_persona(&conn, &recent_sql, persona_id)?;

    Ok(KnowledgeGraphSummary {
        total_entries: total,
        tool_sequence_count: tool_seq,
        failure_pattern_count: fail_pat,
        model_performance_count: model_perf,
        annotation_count: annotation_cnt,
        top_patterns,
        recent_learnings,
    })
    })
}
