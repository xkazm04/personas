use rusqlite::params;

use crate::db::models::{CreateTemplateFeedbackInput, TemplateFeedback, TemplatePerformance};
use crate::db::DbPool;
use crate::error::AppError;

row_mapper!(row_to_feedback -> TemplateFeedback {
    id, review_id, persona_id, execution_id, rating,
    labels, comment, source, created_at,
});

/// Create a new template feedback entry.
/// Validates that both review_id and persona_id reference existing records before inserting.
pub fn create(pool: &DbPool, input: CreateTemplateFeedbackInput) -> Result<TemplateFeedback, AppError> {
    timed_query!("template_feedback", "template_feedback::create", {
    let conn = pool.get()?;

    // Validate review_id exists in persona_design_reviews
    let review_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM persona_design_reviews WHERE id = ?1)",
        params![input.review_id],
        |row| row.get(0),
    )?;
    if !review_exists {
        return Err(AppError::NotFound(format!(
            "Design review '{}' does not exist",
            input.review_id
        )));
    }

    // Validate persona_id exists in personas
    let persona_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM personas WHERE id = ?1)",
        params![input.persona_id],
        |row| row.get(0),
    )?;
    if !persona_exists {
        return Err(AppError::NotFound(format!(
            "Persona '{}' does not exist",
            input.persona_id
        )));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let labels_json = serde_json::to_string(&input.labels).unwrap_or_else(|_| "[]".to_string());
    let rating_str = serde_json::to_value(input.rating)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "neutral".to_string());

    conn.query_row(
        "INSERT INTO template_feedback (id, review_id, persona_id, execution_id, rating, labels, comment, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         RETURNING *",
        params![id, input.review_id, input.persona_id, input.execution_id, rating_str, labels_json, input.comment, input.source, now],
        row_to_feedback,
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::Internal("Failed to create template feedback".into()),
        other => AppError::Database(other),
    })
    })
}

/// List feedback for a specific template (design review).
pub fn list_for_review(pool: &DbPool, review_id: &str, limit: Option<i64>) -> Result<Vec<TemplateFeedback>, AppError> {
    timed_query!("template_feedback", "template_feedback::list_for_review", {
        let conn = pool.get()?;
        let limit = limit.unwrap_or(50);
        let mut stmt = conn.prepare(
            "SELECT * FROM template_feedback WHERE review_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![review_id, limit], row_to_feedback)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Get aggregated performance metrics for a template.
/// Returns NotFound if the review_id does not reference an existing design review.
pub fn get_performance(pool: &DbPool, review_id: &str) -> Result<TemplatePerformance, AppError> {
    timed_query!("template_feedback", "template_feedback::get_performance", {
    let conn = pool.get()?;

    // Verify the review exists before aggregating metrics
    let review_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM persona_design_reviews WHERE id = ?1)",
        params![review_id],
        |row| row.get(0),
    )?;
    if !review_exists {
        return Err(AppError::NotFound(format!(
            "Design review '{}' does not exist",
            review_id
        )));
    }

    let mut data_available = true;

    // Combined review metrics: adoption count + structural/semantic scores in one query
    let (total_adoptions, structural_score, semantic_score): (i64, f64, f64) = conn
        .query_row(
            "SELECT COALESCE(adoption_count, 0), COALESCE(structural_score, 50), COALESCE(semantic_score, 50) FROM persona_design_reviews WHERE id = ?1",
            params![review_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?, row.get::<_, f64>(2)?)),
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query review metrics, defaulting");
            data_available = false;
            (0, 50.0, 50.0)
        });

    // Combined execution stats: count, success count, and avg cost in one query
    let (total_executions, success_count, avg_cost): (i64, i64, f64) = conn
        .query_row(
            "SELECT COUNT(*), SUM(CASE WHEN pe.status = 'completed' THEN 1 ELSE 0 END), COALESCE(AVG(pe.cost_usd), 0.0)
             FROM persona_executions pe
             JOIN personas p ON pe.persona_id = p.id
             WHERE p.source_review_id = ?1",
            params![review_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0), row.get::<_, f64>(2)?)),
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query execution stats, defaulting");
            data_available = false;
            (0, 0, 0.0)
        });

    let success_rate = if total_executions > 0 {
        success_count as f64 / total_executions as f64
    } else {
        0.0
    };

    // Combined feedback: counts and labels in a single scan
    let mut positive_count: i64 = 0;
    let mut negative_count: i64 = 0;
    let mut label_counts: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT rating, labels FROM template_feedback WHERE review_id = ?1",
        )?;
        let rows = stmt.query_map(params![review_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows.flatten() {
            let (rating, labels_json) = row;
            if rating == "positive" {
                positive_count += 1;
            } else if rating == "negative" {
                negative_count += 1;
            }
            if let Ok(labels) = serde_json::from_str::<Vec<String>>(&labels_json) {
                for label in labels {
                    let entry = label_counts.entry(label).or_insert((0, 0));
                    if rating == "positive" {
                        entry.0 += 1;
                    } else if rating == "negative" {
                        entry.1 += 1;
                    }
                }
            }
        }
    }

    let mut top_positive: Vec<(String, i64)> = label_counts
        .iter()
        .filter(|(_, (p, _))| *p > 0)
        .map(|(k, (p, _))| (k.clone(), *p))
        .collect();
    top_positive.sort_by(|a, b| b.1.cmp(&a.1));

    let mut top_negative: Vec<(String, i64)> = label_counts
        .iter()
        .filter(|(_, (_, n))| *n > 0)
        .map(|(k, (_, n))| (k.clone(), *n))
        .collect();
    top_negative.sort_by(|a, b| b.1.cmp(&a.1));

    // Derived quality: 40% semantic + 30% structural + 30% success rate (all normalized to 0-100)
    let derived_quality_score = (semantic_score * 0.4) + (structural_score * 0.3) + (success_rate * 100.0 * 0.3);

    Ok(TemplatePerformance {
        review_id: review_id.to_string(),
        total_adoptions,
        total_executions,
        success_rate,
        avg_cost_usd: avg_cost,
        positive_count,
        negative_count,
        top_positive_labels: top_positive.into_iter().take(5).map(|(l, _)| l).collect(),
        top_negative_labels: top_negative.into_iter().take(5).map(|(l, _)| l).collect(),
        derived_quality_score,
        data_available,
    })
    })
}
