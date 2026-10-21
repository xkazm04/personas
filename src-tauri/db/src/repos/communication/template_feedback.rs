use rusqlite::params;

use crate::models::{CreateTemplateFeedbackInput, TemplateFeedback, TemplatePerformance};
use crate::repos::utils::collect_rows;
use crate::DbPool;
use personas_core::error::AppError;

row_mapper!(row_to_feedback -> TemplateFeedback {
    id, review_id, persona_id, execution_id, rating,
    labels, comment, source, created_at,
});

/// Create a new template feedback entry.
/// Validates that both review_id and persona_id reference existing records before inserting.
pub fn create(
    pool: &DbPool,
    input: CreateTemplateFeedbackInput,
) -> Result<TemplateFeedback, AppError> {
    timed_query!("template_feedback", "template_feedback::create", {
        let conn = pool.get()?;

        // Validate review_id exists in persona_design_reviews
        let review_exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM persona_design_reviews WHERE id = ?1) AS present",
            params![input.review_id],
            |row| row.get("present"),
        )?;
        if !review_exists {
            return Err(AppError::NotFound(format!(
                "Design review '{}' does not exist",
                input.review_id
            )));
        }

        // Validate persona_id exists in personas
        let persona_exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM personas WHERE id = ?1) AS present",
            params![input.persona_id],
            |row| row.get("present"),
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
pub fn list_for_review(
    pool: &DbPool,
    review_id: &str,
    limit: Option<i64>,
) -> Result<Vec<TemplateFeedback>, AppError> {
    timed_query!("template_feedback", "template_feedback::list_for_review", {
        let conn = pool.get()?;
        let limit = limit.unwrap_or(50);
        let mut stmt = conn.prepare(
            "SELECT * FROM template_feedback WHERE review_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![review_id, limit], row_to_feedback)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Get aggregated performance metrics for a template.
/// Returns NotFound if the review_id does not reference an existing design review.
pub fn get_performance(pool: &DbPool, review_id: &str) -> Result<TemplatePerformance, AppError> {
    timed_query!("template_feedback", "template_feedback::get_performance", {
        let conn = pool.get()?;

        // Verify the review exists before aggregating metrics
        let review_exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM persona_design_reviews WHERE id = ?1) AS present",
            params![review_id],
            |row| row.get("present"),
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
            "SELECT COALESCE(adoption_count, 0) AS adoptions, COALESCE(structural_score, 50) AS structural, COALESCE(semantic_score, 50) AS semantic FROM persona_design_reviews WHERE id = ?1",
            params![review_id],
            |row| Ok((row.get::<_, i64>("adoptions")?, row.get::<_, f64>("structural")?, row.get::<_, f64>("semantic")?)),
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query review metrics, defaulting");
            data_available = false;
            (0, 50.0, 50.0)
        });

        // Combined execution stats: count, success count, decided count and avg
        // cost in one query. The success rate's denominator is the DECIDED runs:
        // every terminal state of ExecutionState::TERMINAL except `cancelled`,
        // which is the operator's choice rather than an outcome. A queued or
        // running run is not an outcome yet, and counting it as one made every
        // in-flight run read as a failure on the template's Overview tab.
        // `incomplete` (a run whose process died) counts as not-a-success: the
        // SLA rollups' ('completed','failed') leaves it out, which is the defect
        // docs/concepts/golden-paths/terminal-state-and-recovery.md measures.
        let (total_executions, success_count, decided_count, avg_cost): (i64, i64, i64, f64) = conn
        .query_row(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN pe.status = 'completed' THEN 1 ELSE 0 END) AS succeeded,
                    SUM(CASE WHEN pe.status IN ('completed', 'failed', 'incomplete') THEN 1 ELSE 0 END) AS decided,
                    COALESCE(AVG(pe.cost_usd), 0.0) AS avg_cost
             FROM persona_executions pe
             JOIN personas p ON pe.persona_id = p.id
             WHERE p.source_review_id = ?1",
            params![review_id],
            |row| {
                Ok((
                    row.get::<_, i64>("total")?,
                    row.get::<_, Option<i64>>("succeeded")?.unwrap_or(0),
                    row.get::<_, Option<i64>>("decided")?.unwrap_or(0),
                    row.get::<_, f64>("avg_cost")?,
                ))
            },
        )
        .unwrap_or_else(|e| {
            tracing::warn!(review_id = %review_id, error = %e, "Failed to query execution stats, defaulting");
            data_available = false;
            (0, 0, 0, 0.0)
        });

        let success_rate = if decided_count > 0 {
            success_count as f64 / decided_count as f64
        } else {
            0.0
        };

        // Combined feedback: counts and labels in a single scan
        let mut positive_count: i64 = 0;
        let mut negative_count: i64 = 0;
        let mut label_counts: std::collections::HashMap<String, (i64, i64)> =
            std::collections::HashMap::new();
        {
            let mut stmt =
                conn.prepare("SELECT rating, labels FROM template_feedback WHERE review_id = ?1")?;
            let rows = stmt.query_map(params![review_id], |row| {
                Ok((
                    row.get::<_, String>("rating")?,
                    row.get::<_, String>("labels")?,
                ))
            })?;
            for row in collect_rows(rows, "template_feedback::get_performance") {
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
        top_positive.sort_by_key(|e| std::cmp::Reverse(e.1));

        let mut top_negative: Vec<(String, i64)> = label_counts
            .iter()
            .filter(|(_, (_, n))| *n > 0)
            .map(|(k, (_, n))| (k.clone(), *n))
            .collect();
        top_negative.sort_by_key(|e| std::cmp::Reverse(e.1));

        // Derived quality: 40% semantic + 30% structural + 30% success rate (all normalized to 0-100)
        // A template with no decided run has no measured success rate: score the
        // two measured dimensions renormalised, instead of counting it as 0%.
        let derived_quality_score = if decided_count > 0 {
            (semantic_score * 0.4) + (structural_score * 0.3) + (success_rate * 100.0 * 0.3)
        } else {
            ((semantic_score * 0.4) + (structural_score * 0.3)) / 0.7
        };

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    /// One design review, one persona adopted from it, and executions in the
    /// given statuses. Raw INSERTs on the production schema (init_test_db).
    fn seed(pool: &DbPool, statuses: &[&str]) -> Result<String, Box<dyn std::error::Error>> {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO persona_design_reviews
                 (id, test_case_id, test_case_name, instruction, status, test_run_id, reviewed_at, created_at)
             VALUES ('rev-1', 'tc', 'Test case', 'do it', 'passed', 'run-1', ?1, ?1)",
            params![now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, source_review_id, created_at, updated_at)
             VALUES ('p-1', 'Adopted', 'prompt', 'rev-1', ?1, ?1)",
            params![now],
        )
        .unwrap();
        for (i, status) in statuses.iter().enumerate() {
            conn.execute(
                "INSERT INTO persona_executions (id, persona_id, status, created_at)
                 VALUES (?1, 'p-1', ?2, ?3)",
                params![format!("ex-{i}"), status, now],
            )
            .unwrap();
        }
        Ok("rev-1".to_string())
    }

    #[test]
    fn success_rate_ignores_runs_that_have_not_finished() {
        let pool = init_test_db().unwrap();
        // One success, one failure, and two runs still in flight. The in-flight
        // runs are not outcomes yet: the rate is 1 of 2 decided, not 1 of 4.
        let review_id = seed(&pool, &["completed", "failed", "running", "queued"]).unwrap();
        let perf = get_performance(&pool, &review_id).unwrap();
        assert!(perf.data_available);
        assert_eq!(perf.total_executions, 4);
        assert!(
            (perf.success_rate - 0.5).abs() < 1e-9,
            "expected 0.5 over decided runs, got {}",
            perf.success_rate
        );
    }

    #[test]
    fn success_rate_counts_a_lost_run_against_it_but_not_a_cancelled_one() {
        let pool = init_test_db().unwrap();
        // A cancelled run is the operator's choice and decides nothing; an
        // incomplete run (its process died) is a run that did not succeed.
        let review_id = seed(
            &pool,
            &["completed", "completed", "cancelled", "incomplete"],
        )
        .unwrap();
        let perf = get_performance(&pool, &review_id).unwrap();
        assert!(
            (perf.success_rate - 2.0 / 3.0).abs() < 1e-9,
            "expected 2/3 over decided runs, got {}",
            perf.success_rate
        );
    }

    /// A template nobody has run has no measured success rate: its quality is
    /// the two measured dimensions renormalised, not capped at 70.
    #[test]
    fn quality_score_renormalises_when_no_run_is_decided() {
        let pool = init_test_db().unwrap();
        let review_id = seed(&pool, &["running"]).unwrap();
        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE persona_design_reviews SET structural_score = 100, semantic_score = 100 WHERE id = ?1",
            params![review_id],
        )
        .unwrap();
        drop(conn);
        let perf = get_performance(&pool, &review_id).unwrap();
        assert!(
            (perf.derived_quality_score - 100.0).abs() < 1e-9,
            "perfect measured dimensions must score 100, got {}",
            perf.derived_quality_score
        );
    }

    #[test]
    fn success_rate_is_zero_when_nothing_has_been_decided() {
        let pool = init_test_db().unwrap();
        let review_id = seed(&pool, &["running"]).unwrap();
        let perf = get_performance(&pool, &review_id).unwrap();
        assert_eq!(perf.success_rate, 0.0);
    }
}
