use rusqlite::{params, Row};

use crate::db::models::{CreateTemplateFeedbackInput, TemplateFeedback, TemplatePerformance};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_feedback(row: &Row) -> rusqlite::Result<TemplateFeedback> {
    Ok(TemplateFeedback {
        id: row.get("id")?,
        review_id: row.get("review_id")?,
        persona_id: row.get("persona_id")?,
        execution_id: row.get("execution_id")?,
        rating: row.get("rating")?,
        labels: row.get("labels")?,
        comment: row.get("comment")?,
        source: row.get("source")?,
        created_at: row.get("created_at")?,
    })
}

/// Create a new template feedback entry.
pub fn create(pool: &DbPool, input: CreateTemplateFeedbackInput) -> Result<TemplateFeedback, AppError> {
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let labels_json = serde_json::to_string(&input.labels).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO template_feedback (id, review_id, persona_id, execution_id, rating, labels, comment, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, input.review_id, input.persona_id, input.execution_id, input.rating, labels_json, input.comment, input.source, now],
    )?;

    let row = conn.query_row(
        "SELECT * FROM template_feedback WHERE id = ?1",
        params![id],
        row_to_feedback,
    )?;
    Ok(row)
}

/// List feedback for a specific template (design review).
pub fn list_for_review(pool: &DbPool, review_id: &str, limit: Option<i64>) -> Result<Vec<TemplateFeedback>, AppError> {
    let conn = pool.get()?;
    let limit = limit.unwrap_or(50);
    let mut stmt = conn.prepare(
        "SELECT * FROM template_feedback WHERE review_id = ?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![review_id, limit], row_to_feedback)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Get aggregated performance metrics for a template.
pub fn get_performance(pool: &DbPool, review_id: &str) -> Result<TemplatePerformance, AppError> {
    let conn = pool.get()?;

    // Adoption count from the design review
    let total_adoptions: i64 = conn
        .query_row(
            "SELECT COALESCE(adoption_count, 0) FROM persona_design_reviews WHERE id = ?1",
            params![review_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query adoption count, defaulting to 0");
            0
        });

    // Execution stats from personas linked to this template
    let (total_executions, success_count): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), SUM(CASE WHEN pe.status = 'completed' THEN 1 ELSE 0 END)
             FROM persona_executions pe
             JOIN personas p ON pe.persona_id = p.id
             WHERE p.source_review_id = ?1",
            params![review_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0))),
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query execution stats, defaulting to (0, 0)");
            (0, 0)
        });

    let success_rate = if total_executions > 0 {
        success_count as f64 / total_executions as f64
    } else {
        0.0
    };

    let avg_cost: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(pe.cost_usd), 0.0)
             FROM persona_executions pe
             JOIN personas p ON pe.persona_id = p.id
             WHERE p.source_review_id = ?1",
            params![review_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query avg cost, defaulting to 0.0");
            0.0
        });

    // Feedback counts
    let positive_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM template_feedback WHERE review_id = ?1 AND rating = 'positive'",
            params![review_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query positive feedback count, defaulting to 0");
            0
        });

    let negative_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM template_feedback WHERE review_id = ?1 AND rating = 'negative'",
            params![review_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query negative feedback count, defaulting to 0");
            0
        });

    // Top labels (parse all feedback labels and count)
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

    // Get structural and semantic scores from review
    let (structural_score, semantic_score): (f64, f64) = conn
        .query_row(
            "SELECT COALESCE(structural_score, 50), COALESCE(semantic_score, 50) FROM persona_design_reviews WHERE id = ?1",
            params![review_id],
            |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query structural/semantic scores, defaulting to (50, 50)");
            (50.0, 50.0)
        });

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
    })
}
