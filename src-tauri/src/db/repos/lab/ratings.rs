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
                       r.created_at AS created_at
                FROM lab_eval_results r JOIN lab_eval_runs run ON r.run_id = run.id
                WHERE run.persona_id = ?1 AND r.version_id IS NOT NULL AND r.status = 'completed'
                UNION ALL
                SELECT r.version_id, r.version_number, r.model_id, r.provider,
                       r.tool_accuracy_score, r.output_quality_score, r.protocol_compliance,
                       r.cost_usd, r.duration_ms, r.created_at
                FROM lab_ab_results r JOIN lab_ab_runs run ON r.run_id = run.id
                WHERE run.persona_id = ?1 AND r.version_id IS NOT NULL AND r.status = 'completed'
                UNION ALL
                SELECT r.version_id, r.version_number, r.model_id, r.provider,
                       r.tool_accuracy_score, r.output_quality_score, r.protocol_compliance,
                       r.cost_usd, r.duration_ms, r.created_at
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
                Ok(LabVersionRating {
                    version_id: row.get("version_id")?,
                    version_number: row.get::<_, Option<i32>>("version_number")?.unwrap_or(0),
                    model_id: row.get("model_id")?,
                    provider: row.get::<_, Option<String>>("provider")?.unwrap_or_default(),
                    composite_score: composite_from_parts(ta, oq, pc),
                    tool_accuracy: ta,
                    output_quality: oq,
                    protocol_compliance: pc,
                    cost_usd: row.get::<_, Option<f64>>("cost_avg")?.unwrap_or(0.0),
                    duration_ms: row.get::<_, Option<f64>>("dur_avg")?.unwrap_or(0.0),
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
