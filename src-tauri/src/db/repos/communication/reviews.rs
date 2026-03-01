use rusqlite::{params, Row};

use crate::db::models::{
    CategoryWithCount, ConnectorWithCount, CreateDesignReviewInput, PersonaDesignPattern,
    PersonaDesignReview,
};
use crate::db::DbPool;
use crate::error::AppError;

/// Escape LIKE metacharacters (%, _) so they are matched literally.
fn escape_like(input: &str) -> String {
    input.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

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
        use_case_flows: row.get("use_case_flows")?,
        reviewed_at: row.get("reviewed_at")?,
        created_at: row.get("created_at")?,
        adoption_count: row.get::<_, Option<i32>>("adoption_count")?.unwrap_or(0),
        last_adopted_at: row.get("last_adopted_at")?,
        category: row.get("category")?,
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

    // Upsert: if a review with the same (test_case_name, test_run_id) already exists,
    // update it instead of creating a duplicate. Different runs preserve their own results.
    conn.execute(
        "INSERT INTO persona_design_reviews
         (id, test_case_id, test_case_name, instruction, status,
          structural_score, semantic_score, connectors_used, trigger_types,
          design_result, structural_evaluation, semantic_evaluation,
          test_run_id, had_references, suggested_adjustment, adjustment_generation,
          use_case_flows, reviewed_at, created_at, category)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
         ON CONFLICT(test_case_name, test_run_id) DO UPDATE SET
           test_case_id = excluded.test_case_id,
           instruction = excluded.instruction,
           status = excluded.status,
           structural_score = excluded.structural_score,
           semantic_score = excluded.semantic_score,
           connectors_used = excluded.connectors_used,
           trigger_types = excluded.trigger_types,
           design_result = excluded.design_result,
           structural_evaluation = excluded.structural_evaluation,
           semantic_evaluation = excluded.semantic_evaluation,
           had_references = excluded.had_references,
           suggested_adjustment = excluded.suggested_adjustment,
           adjustment_generation = excluded.adjustment_generation,
           use_case_flows = excluded.use_case_flows,
           reviewed_at = excluded.reviewed_at,
           created_at = excluded.created_at,
           category = excluded.category",
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
            input.use_case_flows,
            input.reviewed_at,
            now,
            input.category,
        ],
    )?;

    // After upsert, the row might have the old id (if updated) or the new id (if inserted).
    // Fetch by (test_case_name, test_run_id) to get the correct row.
    let row = conn.query_row(
        "SELECT * FROM persona_design_reviews WHERE test_case_name = ?1 AND test_run_id = ?2",
        params![input.test_case_name, input.test_run_id],
        row_to_review,
    )?;
    Ok(row)
}

pub fn delete_review(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM persona_design_reviews WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

#[allow(clippy::too_many_arguments)]
pub fn update_review_result(
    pool: &DbPool,
    id: &str,
    status: &str,
    structural_score: Option<i32>,
    semantic_score: Option<i32>,
    connectors_used: Option<&str>,
    trigger_types: Option<&str>,
    design_result: Option<&str>,
    use_case_flows: Option<&str>,
    suggested_adjustment: Option<&str>,
    reviewed_at: &str,
) -> Result<PersonaDesignReview, AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE persona_design_reviews
         SET status = ?1, structural_score = ?2, semantic_score = ?3,
             connectors_used = ?4, trigger_types = ?5, design_result = ?6,
             use_case_flows = ?7, suggested_adjustment = ?8, reviewed_at = ?9,
             structural_evaluation = NULL, semantic_evaluation = NULL
         WHERE id = ?10",
        params![
            status,
            structural_score,
            semantic_score,
            connectors_used,
            trigger_types,
            design_result,
            use_case_flows,
            suggested_adjustment,
            reviewed_at,
            id,
        ],
    )?;
    get_review_by_id(pool, id)
}

pub struct PaginatedReviewResult {
    pub items: Vec<PersonaDesignReview>,
    pub total: i64,
}

#[allow(clippy::too_many_arguments)]
pub fn get_reviews_paginated(
    pool: &DbPool,
    search: Option<&str>,
    connector_filter: Option<&[String]>,
    category_filter: Option<&[String]>,
    sort_by: Option<&str>,
    sort_dir: Option<&str>,
    page: i64,
    per_page: i64,
    coverage_filter: Option<&str>,
    coverage_service_types: Option<&[String]>,
) -> Result<PaginatedReviewResult, AppError> {
    let conn = pool.get()?;

    // Build WHERE clause
    let mut conditions: Vec<String> = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1usize;

    if let Some(q) = search {
        if !q.trim().is_empty() {
            let like = format!("%{}%", escape_like(q.trim()));
            conditions.push(format!(
                "(test_case_name LIKE ?{} ESCAPE '\\' OR instruction LIKE ?{} ESCAPE '\\')",
                param_idx,
                param_idx + 1
            ));
            params_vec.push(Box::new(like.clone()));
            params_vec.push(Box::new(like));
            param_idx += 2;
        }
    }

    if let Some(connectors) = connector_filter {
        if !connectors.is_empty() {
            // Each connector must be present: connectors_used LIKE '%"name"%'
            let mut connector_conds = Vec::new();
            for c in connectors {
                connector_conds.push(format!("connectors_used LIKE ?{}", param_idx));
                params_vec.push(Box::new(format!("%\"{}\"%", c)));
                param_idx += 1;
            }
            // ANY connector matches (OR logic)
            conditions.push(format!("({})", connector_conds.join(" OR ")));
        }
    }

    if let Some(categories) = category_filter {
        if !categories.is_empty() {
            let placeholders: Vec<String> = categories
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", param_idx + i))
                .collect();
            conditions.push(format!(
                "COALESCE(category, 'Other') IN ({})",
                placeholders.join(",")
            ));
            for c in categories {
                params_vec.push(Box::new(c.clone()));
            }
            param_idx += categories.len();
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };

    // Determine if we need coverage post-filtering
    let needs_coverage_filter = matches!(coverage_filter, Some("full") | Some("partial"));

    if needs_coverage_filter {
        // Coverage filter: fetch all WHERE-matched rows, post-filter in Rust, paginate manually
        let cred_set: std::collections::HashSet<&str> = coverage_service_types
            .map(|types| types.iter().map(|s| s.as_str()).collect())
            .unwrap_or_default();
        let is_full = coverage_filter == Some("full");

        // Sort
        let order_col = match sort_by.unwrap_or("created_at") {
            "name" => "test_case_name",
            "quality" => "COALESCE(structural_score,0) + COALESCE(semantic_score,0)",
            "trending" => "adoption_count",
            _ => "created_at",
        };
        let order_dir = match sort_dir.unwrap_or("desc") {
            "asc" => "ASC",
            _ => "DESC",
        };

        let select_sql = format!(
            "SELECT * FROM persona_design_reviews{} ORDER BY {} {}",
            where_clause, order_col, order_dir,
        );
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&select_sql)?;
        let rows = stmt.query_map(params_refs.as_slice(), row_to_review)?;
        let all_rows = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;

        // Post-filter by coverage
        let filtered: Vec<PersonaDesignReview> = all_rows
            .into_iter()
            .filter(|review| {
                let required: Vec<String> = review
                    .connectors_used
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                    .unwrap_or_default();
                let total_required = required.len();
                let covered = required.iter().filter(|c| cred_set.contains(c.as_str())).count();

                if is_full {
                    // Full: all connectors covered (includes zero-connector templates)
                    covered == total_required
                } else {
                    // Partial: some but not all covered
                    covered > 0 && covered < total_required
                }
            })
            .collect();

        let total = filtered.len() as i64;
        let offset = (page * per_page) as usize;
        let items: Vec<PersonaDesignReview> =
            filtered.into_iter().skip(offset).take(per_page as usize).collect();

        Ok(PaginatedReviewResult { items, total })
    } else {
        // Fast path: no coverage filter — use SQL LIMIT/OFFSET
        // Count total
        let count_sql = format!("SELECT COUNT(*) FROM persona_design_reviews{}", where_clause);
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let total: i64 = conn.query_row(&count_sql, params_refs.as_slice(), |row| row.get(0))?;

        // Sort
        let order_col = match sort_by.unwrap_or("created_at") {
            "name" => "test_case_name",
            "quality" => "COALESCE(structural_score,0) + COALESCE(semantic_score,0)",
            "trending" => "adoption_count",
            _ => "created_at",
        };
        let order_dir = match sort_dir.unwrap_or("desc") {
            "asc" => "ASC",
            _ => "DESC",
        };

        let offset = page * per_page;
        let select_sql = format!(
            "SELECT * FROM persona_design_reviews{} ORDER BY {} {} LIMIT ?{} OFFSET ?{}",
            where_clause, order_col, order_dir, param_idx, param_idx + 1,
        );

        let mut all_params = params_vec;
        all_params.push(Box::new(per_page));
        all_params.push(Box::new(offset));
        let all_refs: Vec<&dyn rusqlite::types::ToSql> =
            all_params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&select_sql)?;
        let rows = stmt.query_map(all_refs.as_slice(), row_to_review)?;
        let items = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;

        Ok(PaginatedReviewResult { items, total })
    }
}

/// Increment the adoption_count and update last_adopted_at for a template identified by name.
pub fn increment_adoption_count(pool: &DbPool, template_name: &str) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE persona_design_reviews
         SET adoption_count = adoption_count + 1, last_adopted_at = ?1
         WHERE test_case_name = ?2",
        params![now, template_name],
    )?;
    Ok(())
}

/// Get the top adopted templates in the last 7 days (trending).
pub fn get_trending_templates(
    pool: &DbPool,
    limit: i64,
) -> Result<Vec<PersonaDesignReview>, AppError> {
    let conn = pool.get()?;
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_design_reviews
         WHERE adoption_count > 0 AND last_adopted_at >= ?1
         ORDER BY adoption_count DESC, last_adopted_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![cutoff, limit], row_to_review)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

pub fn get_distinct_connectors(pool: &DbPool) -> Result<Vec<ConnectorWithCount>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT connectors_used FROM persona_design_reviews WHERE connectors_used IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |row| {
        let json_str: String = row.get(0)?;
        Ok(json_str)
    })?;

    let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for json_str in rows.flatten() {
        if let Ok(arr) = serde_json::from_str::<Vec<String>>(&json_str) {
            for name in arr {
                *counts.entry(name).or_insert(0) += 1;
            }
        }
    }
    let mut result: Vec<ConnectorWithCount> = counts
        .into_iter()
        .map(|(name, count)| ConnectorWithCount { name, count })
        .collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

pub fn get_distinct_categories(pool: &DbPool) -> Result<Vec<CategoryWithCount>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT COALESCE(category, 'Other') AS cat, COUNT(*) AS cnt
         FROM persona_design_reviews
         GROUP BY cat
         ORDER BY cnt DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(CategoryWithCount {
            name: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Get all reviews that have no category (NULL).
/// Returns (id, instruction, connectors_used) tuples for backfilling.
pub fn get_uncategorized_reviews(
    pool: &DbPool,
) -> Result<Vec<(String, String, Option<String>)>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, instruction, connectors_used FROM persona_design_reviews WHERE category IS NULL",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Update the category for a single review.
pub fn update_review_category(pool: &DbPool, id: &str, category: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE persona_design_reviews SET category = ?1 WHERE id = ?2",
        params![category, id],
    )?;
    Ok(())
}

/// Delete duplicate reviews, keeping only the newest per test_case_name.
/// Returns the number of rows deleted.
pub fn cleanup_duplicate_reviews(pool: &DbPool) -> Result<i64, AppError> {
    let conn = pool.get()?;
    // Delete all rows that are NOT the newest per test_case_name
    let deleted = conn.execute(
        "DELETE FROM persona_design_reviews
         WHERE id NOT IN (
           SELECT id FROM (
             SELECT id,
                    ROW_NUMBER() OVER (PARTITION BY test_case_name ORDER BY created_at DESC) AS rn
             FROM persona_design_reviews
           ) WHERE rn = 1
         )",
        [],
    )?;
    Ok(deleted as i64)
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
                use_case_flows: None,
                reviewed_at: now,
                category: Some("Development".into()),
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
