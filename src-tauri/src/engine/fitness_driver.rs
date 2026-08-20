//! Darwin Mode fitness driver — MEASURED fitness for genome offspring and
//! evolution challengers.
//!
//! Closes the loop the genome scaffold left open: offspring fitness was an
//! *inherited* (mid-parent) prediction, never a measurement. This module
//! replays a fixture set (lab scenarios) and/or the persona's recent REAL
//! workload inputs through a candidate genome, scores each replay on
//! **assertion pass-rate + cost + latency** from the trace, and folds the
//! samples into the existing `FitnessScore` shape via a pure, unit-tested
//! scorer. Results carry a `fitness_source: "measured"` provenance marker.
//!
//! Feedback-loop hygiene (hard rules, not conventions):
//! * Replay outputs are DISCARDED — nothing here writes `persona_executions`,
//!   knowledge entries, or assertion-result rows (`evaluate_assertions_dry`).
//!   A challenger therefore cannot feed its own future evidence.
//! * Replay scenarios are tagged with [`WORKLOAD_REPLAY_TAG`] so any log or
//!   evidence blob is attributable.
//! * Every replay loop is budget-capped: costs are recorded into the shared
//!   run-budget ledger and the loop HARD-stops at the ceiling regardless of
//!   the global enforce toggle (evolution burns real tokens; warn-only is not
//!   an acceptable failure mode here). The skip path is "stop measuring and
//!   keep whatever samples we have" — never "keep spending".

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{Persona, PersonaToolDefinition};
use crate::db::DbPool;
use crate::engine::genome::{FitnessObjective, PersonaGenome};
use crate::engine::output_assertions::evaluate_assertions_dry;
use crate::engine::test_runner::{execute_scenario, score_result, TestModelConfig, TestScenario};

/// Name prefix for scenarios rebuilt from real workload inputs. Tagged so
/// evidence blobs and logs can always be traced back to a challenger replay.
pub const WORKLOAD_REPLAY_TAG: &str = "[workload-replay]";

/// Max scenarios replayed per candidate (cost bound independent of budget).
pub const MAX_REPLAYS_PER_CANDIDATE: usize = 3;

/// How many recent REAL inputs the challenger harness replays.
pub const WORKLOAD_REPLAY_COUNT: usize = 3;

// =============================================================================
// Pure scoring
// =============================================================================

/// One replay's raw measurements, extracted from an executed scenario trace.
#[derive(Debug, Clone, PartialEq)]
pub struct ReplaySample {
    /// Assertions evaluated against the replay output (dry — never persisted).
    pub assertion_total: u32,
    pub assertion_passed: u32,
    /// LLM-eval composite (0.0--1.0) when available; the quality fallback for
    /// personas with no assertions configured.
    pub eval_composite: Option<f64>,
    pub cost_usd: f64,
    pub duration_ms: i64,
    /// False when the replay errored/timed out (counts as a zero-quality run).
    pub success: bool,
}

/// A measured fitness evaluation — the superset of `FitnessScore` written into
/// the existing `fitness_json` field, plus provenance and raw aggregates so the
/// evidence is inspectable without re-deriving it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MeasuredFitness {
    /// Weighted overall fitness (0.0--1.0) — same scale/weights as the
    /// inherited prediction it replaces, so rankings stay comparable.
    pub overall: f64,
    /// Speed component (0.0--1.0, inverted duration, 60s ceiling).
    pub speed: f64,
    /// Quality component (0.0--1.0): assertion pass-rate when assertions
    /// exist, else the LLM-eval composite, else the success fraction.
    pub quality: f64,
    /// Cost component (0.0--1.0, inverted cost, $1.00 ceiling).
    pub cost: f64,
    /// Always `"measured"` — the provenance marker.
    pub fitness_source: String,
    /// How many replays produced these numbers.
    #[ts(type = "number")]
    pub samples: u32,
    /// Total assertions evaluated across all replays (0 = none configured).
    #[ts(type = "number")]
    pub assertion_total: u32,
    #[ts(type = "number")]
    pub assertion_passed: u32,
    /// Which signal fed `quality`: `assertions` | `eval` | `success_rate`.
    pub quality_basis: String,
    pub avg_cost_usd: f64,
    #[ts(type = "number")]
    pub avg_duration_ms: i64,
    /// Replays that errored (still counted in the denominator).
    #[ts(type = "number")]
    pub failed_samples: u32,
}

/// Fold replay samples into a measured fitness. PURE — no IO, no clock.
///
/// Returns `None` for an empty sample set: sparse-data honesty means "we could
/// not measure" must stay distinguishable from "we measured zero" — callers
/// keep the inherited prediction (and its `inherited` marker) in that case.
pub fn score_measured_fitness(
    samples: &[ReplaySample],
    objective: &FitnessObjective,
) -> Option<MeasuredFitness> {
    if samples.is_empty() {
        return None;
    }

    let n = samples.len() as f64;
    let assertion_total: u32 = samples.iter().map(|s| s.assertion_total).sum();
    let assertion_passed: u32 = samples.iter().map(|s| s.assertion_passed).sum();
    let failed_samples = samples.iter().filter(|s| !s.success).count() as u32;
    let avg_cost = samples.iter().map(|s| s.cost_usd).sum::<f64>() / n;
    let avg_duration = samples.iter().map(|s| s.duration_ms).sum::<i64>() as f64 / n;

    // Quality: prefer machine-checkable assertions; fall back to the LLM-eval
    // composite; finally the bare success fraction. Failed replays contribute
    // zero through whichever basis applies.
    let (quality, quality_basis) = if assertion_total > 0 {
        (
            assertion_passed as f64 / assertion_total as f64,
            "assertions",
        )
    } else {
        let scored: Vec<f64> = samples
            .iter()
            .filter_map(|s| {
                if !s.success {
                    Some(0.0)
                } else {
                    s.eval_composite
                }
            })
            .collect();
        if !scored.is_empty() {
            (scored.iter().sum::<f64>() / scored.len() as f64, "eval")
        } else {
            (
                samples.iter().filter(|s| s.success).count() as f64 / n,
                "success_rate",
            )
        }
    };
    let quality = quality.clamp(0.0, 1.0);

    // Same normalization as `genome::compute_fitness` so measured and
    // historical numbers live on one scale.
    let speed = (1.0 - (avg_duration / 60_000.0)).clamp(0.0, 1.0);
    let cost = (1.0 - (avg_cost / 1.0)).clamp(0.0, 1.0);

    let overall = (objective.speed * speed + objective.quality * quality + objective.cost * cost)
        .clamp(0.0, 1.0);

    Some(MeasuredFitness {
        overall,
        speed,
        quality,
        cost,
        fitness_source: "measured".to_string(),
        samples: samples.len() as u32,
        assertion_total,
        assertion_passed,
        quality_basis: quality_basis.to_string(),
        avg_cost_usd: avg_cost,
        avg_duration_ms: avg_duration.round() as i64,
        failed_samples,
    })
}

// =============================================================================
// Workload replay scenarios (challenger harness input)
// =============================================================================

/// Rebuild lab scenarios from the persona's last `n` REAL completed execution
/// inputs — fitness against the actual workload, not just synthetic fixtures.
///
/// Read-only on `persona_executions`; replaying these scenarios creates no
/// execution rows, so replays can never appear in this query's own future
/// results (structural self-evidence exclusion).
pub fn workload_replay_scenarios(pool: &DbPool, persona_id: &str, n: usize) -> Vec<TestScenario> {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT input_data FROM persona_executions
          WHERE persona_id = ?1 AND status = 'completed'
            AND input_data IS NOT NULL AND TRIM(input_data) != ''
          ORDER BY created_at DESC LIMIT ?2",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let inputs: Vec<String> = match stmt.query_map(rusqlite::params![persona_id, n as i64], |row| {
        row.get::<_, String>(0)
    }) {
        Ok(rows) => rows.flatten().collect(),
        Err(_) => return Vec::new(),
    };

    inputs
        .into_iter()
        .enumerate()
        .map(|(i, raw)| build_replay_scenario(i, &raw))
        .collect()
}

/// PURE scenario construction from one raw execution input. JSON inputs are
/// carried structurally; plain text is wrapped as `{"input": "..."}`.
pub fn build_replay_scenario(index: usize, raw_input: &str) -> TestScenario {
    let input_data = match serde_json::from_str::<serde_json::Value>(raw_input) {
        Ok(v) => v,
        Err(_) => serde_json::json!({ "input": raw_input }),
    };
    TestScenario {
        name: format!("{WORKLOAD_REPLAY_TAG} recent input #{}", index + 1),
        description: format!(
            "Replay of a recent real execution input (challenger harness; output discarded). {WORKLOAD_REPLAY_TAG}"
        ),
        input_data: Some(input_data),
        mock_tools: Vec::new(),
        expected_behavior:
            "Handle this real workload input the way the persona's system prompt specifies, \
             producing a complete, correct response."
                .to_string(),
        expected_tool_sequence: None,
        expected_protocols: None,
    }
}

// =============================================================================
// Replay executor
// =============================================================================

/// Default evaluation model for fitness replays (matches the evolution cycle).
pub fn default_eval_model() -> TestModelConfig {
    TestModelConfig {
        id: "sonnet".to_string(),
        model: Some("claude-sonnet-4-6".to_string()),
        provider: "anthropic".to_string(),
        base_url: None,
        auth_token: None,
        effort: None,
    }
}

/// Replay up to [`MAX_REPLAYS_PER_CANDIDATE`] scenarios through `candidate`
/// and return the raw samples. Outputs are discarded — only measurements leave
/// this function.
///
/// `budget_run_id` must be registered in the run-budget ledger by the caller;
/// each replay's cost is recorded there and the loop HARD-stops once the
/// ledger reports the ceiling exceeded (unconditional — the enforce toggle is
/// deliberately not consulted on evolution spend).
pub async fn replay_candidate(
    pool: &DbPool,
    candidate: &Persona,
    tools: &[PersonaToolDefinition],
    scenarios: &[TestScenario],
    model: &TestModelConfig,
    budget_run_id: &str,
    assertion_persona_id: &str,
) -> Vec<ReplaySample> {
    let ledger = crate::engine::run_budget::ledger();
    // Assertions belong to the INCUMBENT persona id — candidates are ephemeral
    // and share its behavioral contract.
    let assertions = crate::db::repos::execution::assertions::list_enabled_by_persona(
        pool,
        assertion_persona_id,
    )
    .unwrap_or_default();

    let mut samples = Vec::new();
    // Callers bound the scenario set (see MAX_REPLAYS_PER_CANDIDATE /
    // WORKLOAD_REPLAY_COUNT); the ledger check below is the hard backstop.
    for scenario in scenarios.iter() {
        if ledger.is_exceeded(budget_run_id) {
            tracing::warn!(
                run_id = %budget_run_id,
                collected = samples.len(),
                "Fitness replay hard-stopped: budget ceiling reached (keeping partial samples)",
            );
            break;
        }
        match execute_scenario(candidate, tools, scenario, model).await {
            Ok(output) => {
                let scores = score_result(&output, scenario, candidate, pool).await;
                ledger.record(budget_run_id, output.cost_usd);
                let (passed, total) = evaluate_assertions_dry(&assertions, output.assistant_text());
                let composite = renorm_composite(
                    scores.tool_accuracy,
                    scores.output_quality,
                    scores.protocol_compliance,
                );
                samples.push(ReplaySample {
                    assertion_total: total,
                    assertion_passed: passed,
                    eval_composite: composite,
                    cost_usd: scores.cost_usd,
                    duration_ms: scores.duration_ms,
                    success: scores.error_message.is_none(),
                });
            }
            Err(e) => {
                tracing::debug!(
                    scenario = %scenario.name,
                    error = %e,
                    "Fitness replay scenario failed — counted as zero-quality sample",
                );
                samples.push(ReplaySample {
                    assertion_total: 0,
                    assertion_passed: 0,
                    eval_composite: None,
                    cost_usd: 0.0,
                    duration_ms: 0,
                    success: false,
                });
            }
        }
    }
    samples
}

/// Renormalized 0--1 composite over whichever of the three eval metrics were
/// scored (sandbox cells store `None` tool_accuracy). `None` when nothing was
/// scored. PURE.
pub fn renorm_composite(
    tool_accuracy: Option<i32>,
    output_quality: Option<i32>,
    protocol_compliance: Option<i32>,
) -> Option<f64> {
    let weighted: Vec<(f64, f64)> = [
        (tool_accuracy, 0.3),
        (output_quality, 0.4),
        (protocol_compliance, 0.3),
    ]
    .into_iter()
    .filter_map(|(score, w)| score.map(|s| (s as f64 / 100.0, w)))
    .collect();
    if weighted.is_empty() {
        return None;
    }
    let total_w: f64 = weighted.iter().map(|(_, w)| w).sum();
    Some((weighted.iter().map(|(s, w)| s * w).sum::<f64>() / total_w).clamp(0.0, 1.0))
}

/// Materialize an ephemeral candidate persona from a genome for replay. Never
/// persisted — the clone exists only for the duration of the measurement.
pub fn candidate_from_genome(base: &Persona, genome: &PersonaGenome) -> Persona {
    let mut candidate = base.clone();
    candidate.system_prompt = genome.reassemble_prompt();
    candidate.structured_prompt = None;
    candidate.timeout_ms = genome.model.timeout_ms;
    candidate.max_concurrent = genome.config.max_concurrent;
    candidate.max_budget_usd = genome.model.max_budget_usd;
    candidate.max_turns = genome.model.max_turns;
    candidate
}

// =============================================================================
// Tests (pure logic only — no CLI, no DB)
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn objective() -> FitnessObjective {
        FitnessObjective {
            speed: 0.3,
            quality: 0.4,
            cost: 0.3,
        }
    }

    fn sample(passed: u32, total: u32, cost: f64, dur: i64, success: bool) -> ReplaySample {
        ReplaySample {
            assertion_total: total,
            assertion_passed: passed,
            eval_composite: None,
            cost_usd: cost,
            duration_ms: dur,
            success,
        }
    }

    #[test]
    fn empty_samples_yield_none_not_zero() {
        // Sparse-data honesty: "could not measure" must never become a
        // measured zero that overwrites the inherited prediction.
        assert!(score_measured_fitness(&[], &objective()).is_none());
    }

    #[test]
    fn assertion_pass_rate_drives_quality() {
        let samples = vec![sample(3, 4, 0.0, 0, true), sample(1, 4, 0.0, 0, true)];
        let f = score_measured_fitness(&samples, &objective()).unwrap();
        assert_eq!(f.quality_basis, "assertions");
        assert!(
            (f.quality - 0.5).abs() < 1e-9,
            "4/8 assertions = 0.5, got {}",
            f.quality
        );
        assert_eq!(f.assertion_total, 8);
        assert_eq!(f.assertion_passed, 4);
        assert_eq!(f.fitness_source, "measured");
        assert_eq!(f.samples, 2);
    }

    #[test]
    fn eval_composite_is_quality_fallback_without_assertions() {
        let samples = vec![
            ReplaySample {
                eval_composite: Some(0.8),
                ..sample(0, 0, 0.0, 0, true)
            },
            ReplaySample {
                eval_composite: Some(0.4),
                ..sample(0, 0, 0.0, 0, true)
            },
        ];
        let f = score_measured_fitness(&samples, &objective()).unwrap();
        assert_eq!(f.quality_basis, "eval");
        assert!((f.quality - 0.6).abs() < 1e-9);
    }

    #[test]
    fn failed_replay_contributes_zero_quality() {
        let samples = vec![
            ReplaySample {
                eval_composite: Some(1.0),
                ..sample(0, 0, 0.0, 0, true)
            },
            // Errored replay: no composite, success=false → scored as 0.0.
            sample(0, 0, 0.0, 0, false),
        ];
        let f = score_measured_fitness(&samples, &objective()).unwrap();
        assert_eq!(f.quality_basis, "eval");
        assert!((f.quality - 0.5).abs() < 1e-9);
        assert_eq!(f.failed_samples, 1);
    }

    #[test]
    fn success_rate_is_last_resort_quality_basis() {
        let samples = vec![sample(0, 0, 0.0, 0, true), sample(0, 0, 0.0, 0, false)];
        let f = score_measured_fitness(&samples, &objective()).unwrap();
        assert_eq!(f.quality_basis, "success_rate");
        assert!((f.quality - 0.5).abs() < 1e-9);
    }

    #[test]
    fn cost_and_latency_normalization_matches_compute_fitness() {
        // 30s avg → speed 0.5; $0.25 avg → cost 0.75.
        let samples = vec![sample(1, 1, 0.25, 30_000, true)];
        let f = score_measured_fitness(&samples, &objective()).unwrap();
        assert!((f.speed - 0.5).abs() < 1e-9, "speed {}", f.speed);
        assert!((f.cost - 0.75).abs() < 1e-9, "cost {}", f.cost);
        // overall = 0.3*0.5 + 0.4*1.0 + 0.3*0.75 = 0.775
        assert!((f.overall - 0.775).abs() < 1e-9, "overall {}", f.overall);
        // Extremes clamp to [0,1].
        let extreme = vec![sample(1, 1, 5.0, 600_000, true)];
        let f2 = score_measured_fitness(&extreme, &objective()).unwrap();
        assert_eq!(f2.speed, 0.0);
        assert_eq!(f2.cost, 0.0);
    }

    #[test]
    fn renorm_composite_renormalizes_over_scored_metrics() {
        assert_eq!(renorm_composite(None, None, None), None);
        // Sandbox cell: no tool_accuracy → weights renormalize over 0.4 + 0.3.
        let c = renorm_composite(None, Some(80), Some(60)).unwrap();
        let expected = (0.8 * 0.4 + 0.6 * 0.3) / 0.7;
        assert!((c - expected).abs() < 1e-9);
        let full = renorm_composite(Some(100), Some(100), Some(100)).unwrap();
        assert!((full - 1.0).abs() < 1e-9);
    }

    #[test]
    fn replay_scenarios_are_tagged_and_json_aware() {
        let s = build_replay_scenario(0, r#"{"ticket": 42}"#);
        assert!(
            s.name.starts_with(WORKLOAD_REPLAY_TAG),
            "tag missing: {}",
            s.name
        );
        assert_eq!(s.input_data, Some(serde_json::json!({"ticket": 42})));
        assert!(s.mock_tools.is_empty());

        let plain = build_replay_scenario(1, "summarize the weekly report");
        assert_eq!(
            plain.input_data,
            Some(serde_json::json!({"input": "summarize the weekly report"}))
        );
    }
}
