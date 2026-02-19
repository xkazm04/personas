use rusqlite::{params, Row};

use crate::db::models::{CreateDesignReviewInput, PersonaDesignPattern, PersonaDesignReview};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Row mappers
// ============================================================================

fn row_to_review(row: &Row) -> rusqlite::Result<PersonaDesignReview> {
    Ok(PersonaDesignReview {
        id: row.get("id")?,
        test_case_id: row.get("test_case_id")?,
        test_case_name: row.get("test_case_name")?,
        instruction: row.get("instruction")?,
        status: row.get("status")?,
        structural_score: row.get("structural_score")?,
        semantic_score: row.get("semantic_score")?,
        connectors_used: row.get("connectors_used")?,
        trigger_types: row.get("trigger_types")?,
        design_result: row.get("design_result")?,
        structural_evaluation: row.get("structural_evaluation")?,
        semantic_evaluation: row.get("semantic_evaluation")?,
        test_run_id: row.get("test_run_id")?,
        had_references: {
            let v: Option<i32> = row.get("had_references")?;
            v.map(|i| i != 0)
        },
        suggested_adjustment: row.get("suggested_adjustment")?,
        adjustment_generation: row.get("adjustment_generation")?,
        reviewed_at: row.get("reviewed_at")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_pattern(row: &Row) -> rusqlite::Result<PersonaDesignPattern> {
    Ok(PersonaDesignPattern {
        id: row.get("id")?,
        pattern_type: row.get("pattern_type")?,
        pattern_text: row.get("pattern_text")?,
        trigger_condition: row.get("trigger_condition")?,
        confidence: row.get("confidence")?,
        source_review_ids: row.get("source_review_ids")?,
        usage_count: row.get("usage_count")?,
        last_validated_at: row.get("last_validated_at")?,
        is_active: row.get::<_, i32>("is_active")? != 0,
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Design Reviews
// ============================================================================

pub fn get_reviews(
    pool: &DbPool,
    test_run_id: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<PersonaDesignReview>, AppError> {
    let limit = limit.unwrap_or(50);
    let conn = pool.get()?;

    if let Some(run_id) = test_run_id {
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_design_reviews WHERE test_run_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![run_id, limit], row_to_review)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_design_reviews ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], row_to_review)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    }
}

pub fn get_review_by_id(pool: &DbPool, id: &str) -> Result<PersonaDesignReview, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_design_reviews WHERE id = ?1",
        params![id],
        row_to_review,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Design review {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create_review(
    pool: &DbPool,
    input: &CreateDesignReviewInput,
) -> Result<PersonaDesignReview, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let had_refs_int: Option<i32> = input.had_references.map(|b| b as i32);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_design_reviews
         (id, test_case_id, test_case_name, instruction, status,
          structural_score, semantic_score, connectors_used, trigger_types,
          design_result, structural_evaluation, semantic_evaluation,
          test_run_id, had_references, suggested_adjustment, adjustment_generation,
          reviewed_at, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
        params![
            id,
            input.test_case_id,
            input.test_case_name,
            input.instruction,
            input.status,
            input.structural_score,
            input.semantic_score,
            input.connectors_used,
            input.trigger_types,
            input.design_result,
            input.structural_evaluation,
            input.semantic_evaluation,
            input.test_run_id,
            had_refs_int,
            input.suggested_adjustment,
            input.adjustment_generation,
            input.reviewed_at,
            now,
        ],
    )?;

    get_review_by_id(pool, &id)
}

pub fn delete_review(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM persona_design_reviews WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

// ============================================================================
// Design Patterns
// ============================================================================

pub fn get_active_patterns(pool: &DbPool) -> Result<Vec<PersonaDesignPattern>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_design_patterns WHERE is_active = 1 ORDER BY confidence DESC",
    )?;
    let rows = stmt.query_map([], row_to_pattern)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn create_pattern(
    pool: &DbPool,
    pattern_type: &str,
    pattern_text: &str,
    trigger_condition: &str,
    confidence: i32,
) -> Result<PersonaDesignPattern, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_design_patterns
         (id, pattern_type, pattern_text, trigger_condition, confidence,
          source_review_ids, usage_count, is_active, created_at)
         VALUES (?1,?2,?3,?4,?5,'[]',0,1,?6)",
        params![id, pattern_type, pattern_text, trigger_condition, confidence, now],
    )?;

    Ok(PersonaDesignPattern {
        id,
        pattern_type: pattern_type.to_string(),
        pattern_text: pattern_text.to_string(),
        trigger_condition: trigger_condition.to_string(),
        confidence,
        source_review_ids: "[]".to_string(),
        usage_count: 0,
        last_validated_at: None,
        is_active: true,
        created_at: now,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_review_crud() {
        let pool = init_test_db().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        // Create review
        let review = create_review(
            &pool,
            &CreateDesignReviewInput {
                test_case_id: "tc-001".into(),
                test_case_name: "Basic routing test".into(),
                instruction: "Create a pipeline that routes messages".into(),
                status: "passed".into(),
                structural_score: Some(85),
                semantic_score: Some(90),
                connectors_used: Some(r#"["http","gmail"]"#.into()),
                trigger_types: Some(r#"["schedule"]"#.into()),
                design_result: Some("design json here".into()),
                structural_evaluation: Some("structural eval".into()),
                semantic_evaluation: Some("semantic eval".into()),
                test_run_id: "run-001".into(),
                had_references: Some(true),
                suggested_adjustment: None,
                adjustment_generation: None,
                reviewed_at: now,
            },
        )
        .unwrap();
        assert_eq!(review.test_case_id, "tc-001");
        assert_eq!(review.status, "passed");
        assert_eq!(review.structural_score, Some(85));
        assert_eq!(review.had_references, Some(true));

        // Get by ID
        let fetched = get_review_by_id(&pool, &review.id).unwrap();
        assert_eq!(fetched.id, review.id);

        // List reviews
        let all = get_reviews(&pool, None, None).unwrap();
        assert_eq!(all.len(), 1);

        // List by test_run_id
        let by_run = get_reviews(&pool, Some("run-001"), None).unwrap();
        assert_eq!(by_run.len(), 1);

        let empty = get_reviews(&pool, Some("run-999"), None).unwrap();
        assert_eq!(empty.len(), 0);
    }

    #[test]
    fn test_pattern_crud() {
        let pool = init_test_db().unwrap();

        // Create pattern
        let pattern = create_pattern(
            &pool,
            "routing",
            "Use conditional routing when multiple output paths exist",
            "output_count > 1",
            80,
        )
        .unwrap();
        assert_eq!(pattern.pattern_type, "routing");
        assert!(pattern.is_active);
        assert_eq!(pattern.confidence, 80);
        assert_eq!(pattern.usage_count, 0);

        // Get active patterns
        let active = get_active_patterns(&pool).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, pattern.id);
    }

    #[test]
    fn test_review_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_review_by_id(&pool, "nonexistent");
        assert!(result.is_err());
    }
}
