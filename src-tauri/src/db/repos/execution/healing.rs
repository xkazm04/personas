use rusqlite::{params, Row};

use crate::db::models::{HealingKnowledge, PersonaHealingIssue};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_healing_issue(row: &Row) -> rusqlite::Result<PersonaHealingIssue> {
    Ok(PersonaHealingIssue {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        execution_id: row.get("execution_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        severity: row.get("severity")?,
        category: row.get("category")?,
        suggested_fix: row.get("suggested_fix")?,
        auto_fixed: row.get::<_, i32>("auto_fixed")? != 0,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}

pub fn get_all(
    pool: &DbPool,
    persona_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<PersonaHealingIssue>, AppError> {
    let conn = pool.get()?;

    let mut conditions: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1u32;

    if let Some(pid) = persona_id {
        conditions.push(format!("persona_id = ?{}", param_idx));
        param_values.push(Box::new(pid.to_string()));
        param_idx += 1;
    }
    if let Some(st) = status {
        conditions.push(format!("status = ?{}", param_idx));
        param_values.push(Box::new(st.to_string()));
        #[allow(unused_assignments)]
        { param_idx += 1; }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT * FROM persona_healing_issues {} ORDER BY created_at DESC",
        where_clause
    );

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), row_to_healing_issue)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaHealingIssue, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_healing_issues WHERE id = ?1",
        params![id],
        row_to_healing_issue,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("PersonaHealingIssue {id}"))
        }
        other => AppError::Database(other),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create(
    pool: &DbPool,
    persona_id: &str,
    title: &str,
    description: &str,
    severity: Option<&str>,
    category: Option<&str>,
    execution_id: Option<&str>,
    suggested_fix: Option<&str>,
) -> Result<PersonaHealingIssue, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    if description.trim().is_empty() {
        return Err(AppError::Validation("Description cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let severity = severity.unwrap_or("low");
    let category = category.unwrap_or("config");

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_healing_issues
         (id, persona_id, execution_id, title, description, severity, category, suggested_fix, auto_fixed, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 'open', ?9)",
        params![
            id,
            persona_id,
            execution_id,
            title,
            description,
            severity,
            category,
            suggested_fix,
            now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn update_status(pool: &DbPool, id: &str, status: &str) -> Result<(), AppError> {
    // Verify exists
    get_by_id(pool, id)?;

    let conn = pool.get()?;

    if status == "resolved" {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE persona_healing_issues SET status = ?1, resolved_at = ?2 WHERE id = ?3",
            params![status, now, id],
        )?;
    } else {
        conn.execute(
            "UPDATE persona_healing_issues SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
    }

    Ok(())
}

pub fn mark_auto_fixed(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE persona_healing_issues SET auto_fixed = 1, status = 'resolved', resolved_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM persona_healing_issues WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

// ============================================================================
// Healing Knowledge Base
// ============================================================================

fn row_to_knowledge(row: &Row) -> rusqlite::Result<HealingKnowledge> {
    Ok(HealingKnowledge {
        id: row.get("id")?,
        service_type: row.get("service_type")?,
        pattern_key: row.get("pattern_key")?,
        description: row.get("description")?,
        recommended_delay_secs: row.get("recommended_delay_secs")?,
        occurrence_count: row.get::<_, Option<i64>>("occurrence_count")?.unwrap_or(1),
        last_seen_at: row.get("last_seen_at")?,
        created_at: row.get("created_at")?,
    })
}

/// Upsert a knowledge entry: increment count if exists, create if not.
pub fn upsert_knowledge(
    pool: &DbPool,
    service_type: &str,
    pattern_key: &str,
    description: &str,
    recommended_delay_secs: Option<i64>,
) -> Result<HealingKnowledge, AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();

    // Try to update existing entry
    let updated = conn.execute(
        "UPDATE healing_knowledge SET
            occurrence_count = occurrence_count + 1,
            last_seen_at = ?1,
            description = ?2,
            recommended_delay_secs = COALESCE(?3, recommended_delay_secs)
         WHERE service_type = ?4 AND pattern_key = ?5",
        params![now, description, recommended_delay_secs, service_type, pattern_key],
    )?;

    if updated > 0 {
        // Return the updated entry
        let entry = conn.query_row(
            "SELECT * FROM healing_knowledge WHERE service_type = ?1 AND pattern_key = ?2",
            params![service_type, pattern_key],
            row_to_knowledge,
        )?;
        return Ok(entry);
    }

    // Insert new entry
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO healing_knowledge
         (id, service_type, pattern_key, description, recommended_delay_secs, occurrence_count, last_seen_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
        params![id, service_type, pattern_key, description, recommended_delay_secs, now],
    )?;

    conn.query_row(
        "SELECT * FROM healing_knowledge WHERE id = ?1",
        params![id],
        row_to_knowledge,
    )
    .map_err(AppError::Database)
}

/// Get knowledge entries for a given service type (e.g., "gmail", "slack").
pub fn get_knowledge_by_service(
    pool: &DbPool,
    service_type: &str,
) -> Result<Vec<HealingKnowledge>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM healing_knowledge WHERE service_type = ?1 ORDER BY occurrence_count DESC",
    )?;
    let rows = stmt.query_map(params![service_type], row_to_knowledge)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Get all knowledge entries.
pub fn get_all_knowledge(pool: &DbPool) -> Result<Vec<HealingKnowledge>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM healing_knowledge ORDER BY occurrence_count DESC, last_seen_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_knowledge)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Look up recommended delay for a specific service + pattern combination.
/// Returns the recommended delay if a knowledge entry exists with sufficient occurrences.
pub fn get_recommended_delay(
    pool: &DbPool,
    service_type: &str,
    pattern_key: &str,
) -> Result<Option<u64>, AppError> {
    let conn = pool.get()?;
    let result: Result<Option<i64>, _> = conn.query_row(
        "SELECT recommended_delay_secs FROM healing_knowledge
         WHERE service_type = ?1 AND pattern_key = ?2 AND occurrence_count >= 2",
        params![service_type, pattern_key],
        |row| row.get(0),
    );
    match result {
        Ok(Some(delay)) => Ok(Some(delay as u64)),
        Ok(None) => Ok(None),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::core::personas;

    #[test]
    fn test_healing_issue_crud() {
        let pool = init_test_db().unwrap();

        // Create a persona first (required as parent)
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Healer Agent".into(),
                system_prompt: "You fix things.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        // Create healing issues
        let issue1 = create(
            &pool,
            &persona.id,
            "Prompt too long",
            "The system prompt exceeds 8000 tokens and causes timeouts.",
            Some("high"),
            Some("prompt"),
            None,
            Some("Split the prompt into sections and use structured_prompt."),
        )
        .unwrap();
        assert_eq!(issue1.title, "Prompt too long");
        assert_eq!(issue1.severity, "high");
        assert_eq!(issue1.category, "prompt");
        assert_eq!(issue1.status, "open");
        assert!(!issue1.auto_fixed);
        assert!(issue1.resolved_at.is_none());
        assert!(issue1.suggested_fix.is_some());

        let issue2 = create(
            &pool,
            &persona.id,
            "Missing API key",
            "Credential for OpenAI is not configured.",
            None, // defaults to "low"
            None, // defaults to "config"
            None,
            None,
        )
        .unwrap();
        assert_eq!(issue2.severity, "low");
        assert_eq!(issue2.category, "config");

        // Read by id
        let fetched = get_by_id(&pool, &issue1.id).unwrap();
        assert_eq!(fetched.description, "The system prompt exceeds 8000 tokens and causes timeouts.");

        // Get all (no filters)
        let all = get_all(&pool, None, None).unwrap();
        assert_eq!(all.len(), 2);

        // Get all filtered by persona_id
        let by_persona = get_all(&pool, Some(&persona.id), None).unwrap();
        assert_eq!(by_persona.len(), 2);

        // Get all filtered by status
        let open_issues = get_all(&pool, None, Some("open")).unwrap();
        assert_eq!(open_issues.len(), 2);

        // Update status to resolved
        update_status(&pool, &issue1.id, "resolved").unwrap();
        let resolved = get_by_id(&pool, &issue1.id).unwrap();
        assert_eq!(resolved.status, "resolved");
        assert!(resolved.resolved_at.is_some());

        // Update status to something else (not resolved)
        update_status(&pool, &issue2.id, "investigating").unwrap();
        let investigating = get_by_id(&pool, &issue2.id).unwrap();
        assert_eq!(investigating.status, "investigating");
        assert!(investigating.resolved_at.is_none());

        // Filter by resolved status
        let resolved_list = get_all(&pool, None, Some("resolved")).unwrap();
        assert_eq!(resolved_list.len(), 1);
        assert_eq!(resolved_list[0].id, issue1.id);

        // Delete
        let deleted = delete(&pool, &issue1.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &issue1.id).is_err());

        // Delete non-existent returns false
        let deleted_again = delete(&pool, &issue1.id).unwrap();
        assert!(!deleted_again);

        let remaining = get_all(&pool, None, None).unwrap();
        assert_eq!(remaining.len(), 1);
    }
}
