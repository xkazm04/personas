use rusqlite::params;

use crate::db::models::{CreateRatingInput, LabUserRating, LabVersionEconomics, LabVersionRating};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mapper -------------------------------------------------

row_mapper!(row_to_rating -> LabUserRating {
    id, run_id, result_id, scenario_name, rating, feedback, created_at,
});

// -- CRUD -------------------------------------------------------

/// Valid rating range, inclusive. The UI is a five-star widget; values
/// outside this range either come from a buggy renderer (e.g. a divide
/// returning Infinity) or from a future feature accepting raw user input.
/// Reject at the trust boundary so neither aggregations nor "top rationale"
/// summaries get poisoned with -5 / 999 / NaN-shaped junk.
const RATING_MIN: i32 = 1;
const RATING_MAX: i32 = 5;

pub fn upsert_rating(pool: &DbPool, input: &CreateRatingInput) -> Result<LabUserRating, AppError> {
    if !(RATING_MIN..=RATING_MAX).contains(&input.rating) {
        return Err(AppError::Validation(format!(
            "rating must be in {RATING_MIN}..={RATING_MAX}, got {}",
            input.rating
        )));
    }

    timed_query!("lab_ratings", "lab_ratings::upsert_rating", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Single-statement upsert backed by the UNIQUE expression index
        // idx_lab_ratings_unique on (run_id, scenario_name, COALESCE(result_id, '')).
        // On conflict we preserve the original id and created_at; only rating/feedback move.
        conn.execute(
            "INSERT INTO lab_user_ratings (id, run_id, result_id, scenario_name, rating, feedback, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(run_id, scenario_name, COALESCE(result_id, ''))
             DO UPDATE SET rating = excluded.rating, feedback = excluded.feedback",
            params![id, input.run_id, input.result_id, input.scenario_name, input.rating, input.feedback, now],
        )?;

        let row = conn
            .prepare(
                "SELECT * FROM lab_user_ratings
                 WHERE run_id = ?1 AND scenario_name = ?2
                   AND COALESCE(result_id, '') = COALESCE(?3, '')",
            )?
            .query_row(
                params![input.run_id, input.scenario_name, input.result_id],
                row_to_rating,
            )?;
        Ok(row)
    })
}

pub fn get_ratings_for_run(pool: &DbPool, run_id: &str) -> Result<Vec<LabUserRating>, AppError> {
    timed_query!("lab_ratings", "lab_ratings::get_ratings_for_run", {
        let conn = pool.get()?;
        let mut stmt = conn
            .prepare("SELECT * FROM lab_user_ratings WHERE run_id = ?1 ORDER BY created_at DESC")?;
        let ratings = stmt
            .query_map(params![run_id], row_to_rating)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ratings)
    })
}

pub fn delete_ratings_for_run(pool: &DbPool, run_id: &str) -> Result<bool, AppError> {
    timed_query!("lab_ratings", "lab_ratings::delete_ratings_for_run", {
        let conn = pool.get()?;
        let count = conn.execute(
            "DELETE FROM lab_user_ratings WHERE run_id = ?1",
            params![run_id],
        )?;
        Ok(count > 0)
    })
}

// -- Version × Model rating rollup ------------------------------

/// Weighted composite (0-100) over whichever sub-scores are present, renormalising
/// the canonical `SCORE_WEIGHTS` across the available components. `None` when no
/// component has a value (e.g. every sample for the pair errored before scoring).
///
/// When only some sub-scores are present the renormalisation makes the result
/// **not** directly comparable to a full-coverage composite. That partiality is
/// no longer silent — [`composite_and_coverage`] pairs this value with a
/// `partial_coverage` flag surfaced on the rating row so the UI can annotate it.
fn composite_from_parts(ta: Option<f64>, oq: Option<f64>, pc: Option<f64>) -> Option<f64> {
    use crate::engine::eval::{
        WEIGHT_OUTPUT_QUALITY, WEIGHT_PROTOCOL_COMPLIANCE, WEIGHT_TOOL_ACCURACY,
    };
    let mut sum = 0.0;
    let mut wsum = 0.0;
    for (val, w) in [
        (ta, WEIGHT_TOOL_ACCURACY),
        (oq, WEIGHT_OUTPUT_QUALITY),
        (pc, WEIGHT_PROTOCOL_COMPLIANCE),
    ] {
        if let Some(v) = val {
            sum += v * w;
            wsum += w;
        }
    }
    if wsum > 0.0 {
        let mean = sum / wsum; // already on the 0-100 scale
        Some((mean * 100.0).round() / 100.0) // round to 2 decimals
    } else {
        None
    }
}

/// Composite plus a `partial_coverage` flag. Coverage is partial when the
/// composite exists but at least one of the three sub-scores was missing (so the
/// weight base was renormalised). Full coverage (all three present) or an empty
/// cell (none present) are both `false` — only the renormalised-and-therefore-
/// incomparable case is flagged.
fn composite_and_coverage(
    ta: Option<f64>,
    oq: Option<f64>,
    pc: Option<f64>,
) -> (Option<f64>, bool) {
    let present = [ta, oq, pc].iter().filter(|v| v.is_some()).count();
    let composite = composite_from_parts(ta, oq, pc);
    let partial = composite.is_some() && present < 3;
    (composite, partial)
}

/// Aggregate measured scores per (prompt version, model) for one persona across
/// every version-attributed lab result (Arena / Eval / A-B). Powers the
/// consolidated Lab "Versions & Ratings" table. Only `completed` results carrying
/// a non-null `version_id` are counted, so legacy current-prompt arena runs are
/// excluded. The composite applies `SCORE_WEIGHTS` over the present sub-scores.
pub fn get_version_ratings(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<LabVersionRating>, AppError> {
    timed_query!("lab_version_ratings", "lab::get_version_ratings", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "WITH measured AS (
                SELECT r.version_id AS version_id, r.version_number AS version_number,
                       r.model_id AS model_id, r.provider AS provider,
                       r.tool_accuracy_score AS ta, r.output_quality_score AS oq,
                       r.protocol_compliance AS pc, r.cost_usd AS cost, r.duration_ms AS dur,
                       r.input_tokens AS in_tok, r.output_tokens AS out_tok,
                       r.eval_method AS eval_method,
                       r.created_at AS created_at
                FROM lab_eval_results r JOIN lab_eval_runs run ON r.run_id = run.id
                WHERE run.persona_id = ?1 AND r.version_id IS NOT NULL AND r.status = 'completed'
                UNION ALL
                SELECT r.version_id, r.version_number, r.model_id, r.provider,
                       r.tool_accuracy_score, r.output_quality_score, r.protocol_compliance,
                       r.cost_usd, r.duration_ms, r.input_tokens, r.output_tokens,
                       r.eval_method, r.created_at
                FROM lab_ab_results r JOIN lab_ab_runs run ON r.run_id = run.id
                WHERE run.persona_id = ?1 AND r.version_id IS NOT NULL AND r.status = 'completed'
                UNION ALL
                SELECT r.version_id, r.version_number, r.model_id, r.provider,
                       r.tool_accuracy_score, r.output_quality_score, r.protocol_compliance,
                       r.cost_usd, r.duration_ms, r.input_tokens, r.output_tokens,
                       r.eval_method, r.created_at
                FROM lab_arena_results r JOIN lab_arena_runs run ON r.run_id = run.id
                WHERE run.persona_id = ?1 AND r.version_id IS NOT NULL AND r.status = 'completed'
            )
            SELECT version_id,
                   MAX(version_number) AS version_number,
                   model_id,
                   MAX(provider) AS provider,
                   AVG(CAST(ta AS REAL)) AS ta_avg,
                   AVG(CAST(oq AS REAL)) AS oq_avg,
                   AVG(CAST(pc AS REAL)) AS pc_avg,
                   AVG(cost) AS cost_avg,
                   AVG(CAST(dur AS REAL)) AS dur_avg,
                   AVG(CAST(in_tok AS REAL)) AS in_tok_avg,
                   AVG(CAST(out_tok AS REAL)) AS out_tok_avg,
                   SUM(CASE WHEN eval_method IN ('heuristic_fallback', 'timeout')
                            THEN 1 ELSE 0 END) AS degraded_count,
                   COUNT(*) AS sample_count,
                   MAX(created_at) AS last_measured_at
            FROM measured
            GROUP BY version_id, model_id
            ORDER BY version_number DESC, model_id",
        )?;
        let rows = stmt
            .query_map(params![persona_id], |row| {
                let ta: Option<f64> = row.get("ta_avg")?;
                let oq: Option<f64> = row.get("oq_avg")?;
                let pc: Option<f64> = row.get("pc_avg")?;
                let provider = row.get::<_, Option<String>>("provider")?.unwrap_or_default();
                let (composite_score, partial_coverage) = composite_and_coverage(ta, oq, pc);
                // Ollama's per-call cost is hardcoded 0.0 in the runner — a zero
                // here is "unknown", not "free". Flag it so the value verdict skips it.
                let cost_unknown = provider == crate::engine::types::providers::OLLAMA;
                Ok(LabVersionRating {
                    version_id: row.get("version_id")?,
                    version_number: row.get::<_, Option<i32>>("version_number")?.unwrap_or(0),
                    model_id: row.get("model_id")?,
                    provider,
                    composite_score,
                    partial_coverage,
                    tool_accuracy: ta,
                    output_quality: oq,
                    protocol_compliance: pc,
                    cost_usd: row.get::<_, Option<f64>>("cost_avg")?.unwrap_or(0.0),
                    cost_unknown,
                    degraded_count: row.get::<_, Option<i64>>("degraded_count")?.unwrap_or(0),
                    duration_ms: row.get::<_, Option<f64>>("dur_avg")?.unwrap_or(0.0),
                    input_tokens: row.get::<_, Option<f64>>("in_tok_avg")?.unwrap_or(0.0),
                    output_tokens: row.get::<_, Option<f64>>("out_tok_avg")?.unwrap_or(0.0),
                    sample_count: row.get("sample_count")?,
                    last_measured_at: row.get("last_measured_at")?,
                })
            })
            .map_err(AppError::Database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// F21: per (version × model) eval economics — attempted-vs-resolved + cost-per-
/// success. Unlike [`get_version_ratings`] (which filters to completed results),
/// this counts ALL eval attempts so the resolve rate and cost efficiency are
/// visible. Scoped to `lab_eval_results` (the table that carries `error_message`).
pub fn get_version_economics(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<LabVersionEconomics>, AppError> {
    timed_query!("lab_version_economics", "lab::get_version_economics", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT r.version_id AS version_id, r.model_id AS model_id,
                    MAX(r.provider) AS provider,
                    COUNT(*) AS attempted,
                    SUM(CASE WHEN r.status = 'completed'
                                  AND (r.error_message IS NULL OR r.error_message = '')
                             THEN 1 ELSE 0 END) AS resolved,
                    COALESCE(SUM(r.cost_usd), 0) AS total_cost
             FROM lab_eval_results r JOIN lab_eval_runs run ON r.run_id = run.id
             WHERE run.persona_id = ?1 AND r.version_id IS NOT NULL
             GROUP BY r.version_id, r.model_id
             ORDER BY r.model_id",
        )?;
        let rows = stmt
            .query_map(params![persona_id], |row| {
                let attempted: i64 = row.get("attempted")?;
                let resolved: i64 = row.get("resolved")?;
                let total_cost: f64 = row.get::<_, Option<f64>>("total_cost")?.unwrap_or(0.0);
                Ok(LabVersionEconomics {
                    version_id: row.get("version_id")?,
                    model_id: row.get("model_id")?,
                    provider: row.get::<_, Option<String>>("provider")?.unwrap_or_default(),
                    attempted,
                    resolved,
                    resolve_rate: (attempted > 0).then(|| resolved as f64 / attempted as f64),
                    total_cost_usd: total_cost,
                    cost_per_success: (resolved > 0).then(|| total_cost / resolved as f64),
                })
            })
            .map_err(AppError::Database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Full coverage (all three sub-scores present) is never flagged partial and
    /// applies the canonical weights directly (0.4/0.4/0.2 sum to 1.0).
    #[test]
    fn composite_full_coverage_not_partial() {
        let (c, partial) = composite_and_coverage(Some(80.0), Some(90.0), Some(50.0));
        assert!(!partial, "all three present must not be flagged partial");
        // 80*0.4 + 90*0.4 + 50*0.2 = 32 + 36 + 10 = 78
        assert_eq!(c, Some(78.0));
    }

    /// Missing a sub-score renormalises the weight base — flagged so the UI knows
    /// the number is not directly comparable to a full-coverage composite.
    #[test]
    fn composite_partial_coverage_is_flagged() {
        // Only tool_accuracy + output_quality present: base renormalises to 0.4+0.4.
        let (c, partial) = composite_and_coverage(Some(80.0), Some(90.0), None);
        assert!(partial, "one missing sub-score must flag partial coverage");
        // (80*0.4 + 90*0.4) / 0.8 = 85
        assert_eq!(c, Some(85.0));
    }

    /// An empty cell (no sub-scores) yields no composite and is not "partial" —
    /// there is nothing renormalised to warn about.
    #[test]
    fn composite_empty_is_none_not_partial() {
        let (c, partial) = composite_and_coverage(None, None, None);
        assert_eq!(c, None);
        assert!(!partial);
    }
}
