use std::collections::HashMap;

use personas_db::models::CreateLabResultBaseInput;
use personas_db::DbPool;

use super::{
    avg_scored, best_value_model, compute_value_score, provider_cost_is_known,
    renormalized_composite, ScoreResult, TestModelConfig, TestScenario,
};

/// Build a keyed summary (used by A/B, eval, matrix modes).
#[allow(clippy::type_complexity)]
pub(crate) fn build_keyed_summary(
    tracker: &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
    _models: &[TestModelConfig],
) -> serde_json::Value {
    let mut summary_obj = serde_json::Map::new();
    for (key, results) in tracker.iter() {
        let count = results.len() as f64;
        let avg_ta = avg_scored(results.iter().map(|r| r.0)).unwrap_or(0.0);
        let avg_oq = avg_scored(results.iter().map(|r| r.1)).unwrap_or(0.0);
        let avg_pc = avg_scored(results.iter().map(|r| r.2)).unwrap_or(0.0);
        let total_cost: f64 = results.iter().map(|r| r.3).sum();
        // Renormalise over present sub-scores (sandbox runs omit tool_accuracy)
        // — mirrors `verdict_status`.
        let composite = renormalized_composite(
            avg_scored(results.iter().map(|r| r.0)),
            avg_scored(results.iter().map(|r| r.1)),
            avg_scored(results.iter().map(|r| r.2)),
        )
        .unwrap_or(0.0);
        summary_obj.insert(
            key.clone(),
            serde_json::json!({
                "avg_tool_accuracy": avg_ta.round() as i32,
                "avg_output_quality": avg_oq.round() as i32,
                "avg_protocol_compliance": avg_pc.round() as i32,
                "composite_score": composite.round() as i32,
                "total_cost_usd": (total_cost * 10000.0).round() / 10000.0,
                "scenarios_tested": count as i32,
            }),
        );
    }
    serde_json::Value::Object(summary_obj)
}

/// Build arena-style ranked summary.
#[allow(clippy::type_complexity)]
pub(crate) fn build_arena_summary(
    tracker: &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
    models: &[TestModelConfig],
) -> serde_json::Value {
    let mut rankings: Vec<serde_json::Value> = Vec::new();
    for model in models {
        if let Some(results) = tracker.get(&model.id) {
            let count = results.len() as f64;
            let avg_ta = avg_scored(results.iter().map(|r| r.0)).unwrap_or(0.0);
            let avg_oq = avg_scored(results.iter().map(|r| r.1)).unwrap_or(0.0);
            let avg_pc = avg_scored(results.iter().map(|r| r.2)).unwrap_or(0.0);
            let total_cost: f64 = results.iter().map(|r| r.3).sum();
            let avg_duration = results.iter().map(|r| r.4 as f64).sum::<f64>() / count;
            // Renormalise over present sub-scores (sandbox runs omit
            // tool_accuracy) — mirrors `verdict_status`.
            let composite = renormalized_composite(
                avg_scored(results.iter().map(|r| r.0)),
                avg_scored(results.iter().map(|r| r.1)),
                avg_scored(results.iter().map(|r| r.2)),
            )
            .unwrap_or(0.0);
            let cost_known = provider_cost_is_known(&model.provider);
            let value_score = compute_value_score(composite, total_cost);
            rankings.push(serde_json::json!({
                "model_id": model.id,
                "provider": model.provider,
                "avg_tool_accuracy": avg_ta.round() as i32,
                "avg_output_quality": avg_oq.round() as i32,
                "avg_protocol_compliance": avg_pc.round() as i32,
                "composite_score": composite.round() as i32,
                "total_cost_usd": (total_cost * 10000.0).round() / 10000.0,
                "cost_unknown": !cost_known,
                "avg_duration_ms": avg_duration.round() as i64,
                "value_score": value_score.round() as i32,
                "scenarios_tested": count as i32,
            }));
        }
    }
    rankings.sort_by(|a, b| {
        let sa = a
            .get("composite_score")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let sb = b
            .get("composite_score")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        sb.cmp(&sa)
    });
    let best_model = rankings
        .first()
        .and_then(|r| r.get("model_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let best_value = best_value_model(&rankings);
    serde_json::json!({
        "best_quality_model": best_model,
        "best_value_model": best_value,
        "rankings": rankings,
    })
}

/// Common fields extracted from a scenario + model + scores for persisting lab results.
pub(crate) fn make_common_result_fields(
    scenario: &TestScenario,
    model: &TestModelConfig,
    status: &str,
    scores: &ScoreResult,
) -> CreateLabResultBaseInput {
    CreateLabResultBaseInput {
        scenario_name: scenario.name.clone(),
        model_id: model.id.clone(),
        provider: model.provider.clone(),
        status: status.to_string(),
        output_preview: scores.output_preview.clone(),
        tool_calls_expected: scenario
            .expected_tool_sequence
            .as_ref()
            .map(|v| personas_db::models::Json(v.clone())),
        tool_calls_actual: scores.tool_calls_actual.clone(),
        tool_accuracy_score: scores.tool_accuracy,
        output_quality_score: scores.output_quality,
        protocol_compliance: scores.protocol_compliance,
        input_tokens: scores.input_tokens,
        output_tokens: scores.output_tokens,
        cost_usd: scores.cost_usd,
        duration_ms: scores.duration_ms,
        error_message: scores.error_message.clone(),
        rationale: scores.rationale.clone(),
        suggestions: scores.suggestions.clone(),
        eval_method: scores.eval_method.clone(),
    }
}

// ============================================================================
// Lab: Arena
// ============================================================================

/// Resolve a persona's active production prompt version for result attribution.
///
/// Mirrors the frontend active-version rule (`LabVersionsTable`): the version
/// tagged `production` wins; otherwise the highest `version_number`. Returns
/// `None` when the persona has no prompt versions at all, so unscoped arena
/// results correctly stay version-less rather than being attributed to an
/// invented id. Read-only single-row query; a pool/query error degrades to
/// `None` (attribution is best-effort, never a reason to fail the run).
pub(crate) fn resolve_active_version(pool: &DbPool, persona_id: &str) -> Option<(String, i32)> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT id, version_number FROM persona_prompt_versions
         WHERE persona_id = ?1
         ORDER BY (tag = 'production') DESC, version_number DESC
         LIMIT 1",
        [persona_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?)),
    )
    .ok()
}

/// Compute agreement rate: for each scenario, check how many samples agree
/// on the dominant output quality bucket (high/medium/low). Returns 0.0-1.0.
#[allow(dead_code)] // pending: helper for run_consensus_test (also dormant)
pub(crate) fn compute_agreement_rate(results: &[personas_db::models::LabConsensusResult]) -> f64 {
    use std::collections::HashMap;

    // Group results by scenario
    let mut by_scenario: HashMap<&str, Vec<&personas_db::models::LabConsensusResult>> =
        HashMap::new();
    for r in results {
        by_scenario
            .entry(&r.base.scenario_name)
            .or_default()
            .push(r);
    }

    if by_scenario.is_empty() {
        return 0.0;
    }

    let mut total_agreement = 0.0;
    for (_scenario, samples) in &by_scenario {
        let n = samples.len() as f64;
        if n <= 1.0 {
            total_agreement += 1.0;
            continue;
        }

        // Bucket each sample by quality score tier: high(>=80), medium(50-79), low(<50)
        let mut buckets = [0i32; 3]; // [low, medium, high]
        for s in samples {
            match s.base.output_quality_score.unwrap_or(0) {
                80.. => buckets[2] += 1,
                50..=79 => buckets[1] += 1,
                _ => buckets[0] += 1,
            }
        }
        let dominant = *buckets.iter().max().unwrap_or(&0) as f64;
        total_agreement += dominant / n;
    }

    total_agreement / by_scenario.len() as f64
}

/// Build summary for consensus mode — reports per-scenario agreement.
#[allow(dead_code)] // pending: helper for run_consensus_test (also dormant)
pub(crate) fn build_consensus_summary(
    tracker: &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
    models: &[TestModelConfig],
) -> serde_json::Value {
    // For consensus, all "models" in tracker are actually sample labels.
    // Flatten all results to compute aggregate stats.
    let all_results: Vec<_> = tracker.values().flatten().collect();
    let count = all_results.len() as f64;
    if count == 0.0 {
        return serde_json::json!({ "samples": 0, "agreement_note": "no results" });
    }
    let avg_oq = avg_scored(all_results.iter().map(|r| r.1)).unwrap_or(0.0);
    let total_cost: f64 = all_results.iter().map(|r| r.3).sum();
    let avg_duration = all_results.iter().map(|r| r.4 as f64).sum::<f64>() / count;

    serde_json::json!({
        "mode": "consensus",
        "total_samples": count as i32,
        "num_models": models.len(),
        "avg_output_quality": avg_oq.round() as i32,
        "total_cost_usd": (total_cost * 1000.0).round() / 1000.0,
        "avg_duration_ms": avg_duration.round() as i64,
        "agreement_note": "agreement_rate is computed post-loop and stored on the run"
    })
}
