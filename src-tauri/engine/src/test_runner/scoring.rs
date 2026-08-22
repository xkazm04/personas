use personas_db::models::Persona;
use personas_db::DbPool;

use super::{truncate_chars, ExecutionOutput, ScoreResult, TestScenario};
use crate::eval::{
    self, EvalInput, WEIGHT_OUTPUT_QUALITY, WEIGHT_PROTOCOL_COMPLIANCE, WEIGHT_TOOL_ACCURACY,
};

// -- Phase 2: Execute scenario with a specific model ------------

/// Per-scenario pass threshold on the composite score
/// (tool*0.4 + quality*0.4 + protocol*0.2). Mirrors eval.rs's `>= 50` verdict.
const SCENARIO_PASS_THRESHOLD: f64 = 50.0;

/// Weighted composite (0-100) renormalised over whichever sub-scores are
/// present, mirroring `db::repos::lab::ratings::composite_from_parts` (which does
/// the same at the aggregate rating level). `None` only when every sub-score is
/// absent.
///
/// This is what makes **sandbox cells** scorable. A sandbox scenario instructs
/// the agent NOT to call real tools (see [`build_sandbox_section`]), so its
/// `tool_accuracy` is deliberately absent (`score_result` stores NULL). Treating
/// that absence as a literal `0` — the old `unwrap_or(0)` — sank an
/// otherwise-passing cell (e.g. output_quality 80 / protocol 80 gave a composite
/// of 48, below the 50 threshold, so it "failed"). Renormalising over the
/// present weights instead scores it on its own terms (→ 80). Cells with all
/// three sub-scores present (every real-tool cell) renormalise over the full
/// weight base, so the result is identical to the previous weighted sum — real
/// scoring is unchanged.
pub(crate) fn renormalized_composite(
    ta: Option<f64>,
    oq: Option<f64>,
    pc: Option<f64>,
) -> Option<f64> {
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
        Some(sum / wsum)
    } else {
        None
    }
}

/// Derive a real pass/fail verdict from the scores instead of conflating "the
/// CLI returned Ok" with "the scenario passed". A scenario whose evaluation did
/// not actually run — LLM eval timed out / fell back to heuristics, which return
/// optimistic "nothing-expected = 100" sentinels — is reported "inconclusive",
/// never "passed", so a total eval outage can't masquerade as green.
///
/// The composite renormalises over the *present* sub-scores (see
/// [`renormalized_composite`]): a sandbox cell carries no `tool_accuracy`, so it
/// must not be counted as a zero. A cell with no sub-scores at all is
/// "inconclusive" rather than a spurious "failed".
pub(crate) fn verdict_status(s: &ScoreResult) -> String {
    if matches!(
        s.eval_method.as_deref(),
        Some("timeout") | Some("heuristic_fallback")
    ) {
        return "inconclusive".to_string();
    }
    match renormalized_composite(
        s.tool_accuracy.map(|v| v as f64),
        s.output_quality.map(|v| v as f64),
        s.protocol_compliance.map(|v| v as f64),
    ) {
        Some(composite) if composite >= SCENARIO_PASS_THRESHOLD => "passed".to_string(),
        Some(_) => "failed".to_string(),
        None => "inconclusive".to_string(),
    }
}

// -- Scoring (delegates to unified eval framework + LLM eval) ---

pub async fn score_result(
    output: &ExecutionOutput,
    scenario: &TestScenario,
    persona: &Persona,
    pool: &DbPool,
) -> ScoreResult {
    let expected_tools = scenario.expected_tool_sequence.as_deref();
    let expected_protocols = scenario.expected_protocols.as_deref();

    // A scenario with mock tools ran in sandbox mode: the agent was told NOT to
    // call real tools (see `build_sandbox_section`), so its real-tool-call
    // channel is empty by construction and `tool_accuracy` measured as
    // expected-vs-actual real calls is degenerate.
    let is_sandbox = !scenario.mock_tools.is_empty();

    let eval_input = EvalInput {
        output: &output.assistant_text,
        expected_behavior: Some(&scenario.expected_behavior),
        expected_tools,
        actual_tools: Some(&output.tool_calls),
        expected_protocols,
        has_tools: true,
    };

    let tool_calls_json = if output.tool_calls.is_empty() {
        None
    } else {
        Some(personas_db::models::Json(output.tool_calls.clone()))
    };

    let preview = if output.assistant_text.is_empty() {
        None
    } else {
        Some(truncate_chars(&output.assistant_text, 2000))
    };

    // Try LLM-based evaluation for richer scoring with rationale/suggestions
    let llm_result = eval::eval_with_llm(
        &eval_input,
        &persona.name,
        persona.description.as_deref().unwrap_or(""),
        &scenario.name,
        &scenario.description,
        is_sandbox,
        pool,
        Some(persona.id.as_str()),
    )
    .await;

    // Serialize structured rationale as JSON for rich frontend display.
    // The rationale field stores a JSON object with per-metric breakdowns
    // when available, falling back to a plain string for older results.
    let rationale_json = serde_json::json!({
        "summary": llm_result.rationale,
        "verdict": llm_result.verdict,
        "tool_accuracy": llm_result.tool_accuracy_rationale,
        "output_quality": llm_result.output_quality_rationale,
        "protocol": llm_result.protocol_rationale,
    });

    // Exclude tool_accuracy from sandbox cells: store NULL so the composite
    // renormalises over output_quality + protocol_compliance (see
    // `renormalized_composite`) and the ratings rollup flags `partial_coverage`
    // instead of auto-failing the cell on a degenerate zero. The judge's
    // tool-usage rationale is still preserved in `rationale_json` above.
    let tool_accuracy = if is_sandbox {
        None
    } else {
        Some(llm_result.tool_accuracy.clamp(0, 100))
    };
    let output_quality = Some(llm_result.output_quality.clamp(0, 100));
    let protocol_compliance = Some(llm_result.protocol_compliance.clamp(0, 100));

    ScoreResult {
        tool_accuracy,
        output_quality,
        protocol_compliance,
        output_preview: preview,
        tool_calls_actual: tool_calls_json,
        input_tokens: output.input_tokens as i64,
        output_tokens: output.output_tokens as i64,
        cost_usd: output.cost_usd,
        duration_ms: output.duration_ms as i64,
        error_message: output.error.clone(),
        rationale: Some(serde_json::to_string(&rationale_json).unwrap_or(llm_result.rationale)),
        suggestions: Some(llm_result.suggestions),
        eval_method: Some(llm_result.eval_method.as_str().to_string()),
        events: output.events.clone(),
    }
}

// -- Summary builder --------------------------------------------

/// Average only the non-None scores from an iterator of Option<i32>.
/// Returns None if no scored values exist.
pub(crate) fn avg_scored(iter: impl Iterator<Item = Option<i32>>) -> Option<f64> {
    let scored: Vec<i32> = iter.flatten().collect();
    if scored.is_empty() {
        None
    } else {
        Some(scored.iter().map(|&v| v as f64).sum::<f64>() / scored.len() as f64)
    }
}

/// Cost-decay rate for the value-score efficiency curve, in units of 1/USD.
///
/// The efficiency multiplier is `exp(-total_cost * RATE)`, an exponential decay
/// that starts at 1.0 for zero cost and halves roughly every `ln(2)/RATE ≈
/// $0.069`. Concretely, at RATE = 10: $0.001 → ~0.99, $0.01 → ~0.90,
/// $0.07 → ~0.50, $0.10 → ~0.37, $0.30 → ~0.05. The shape rewards near-free
/// runs almost fully while punishing runs past a few cents steeply — chosen so
/// a small quality edge can't justify a 10× cost blowout. Tune this single
/// constant to move the whole curve; larger = harsher cost penalty.
const VALUE_SCORE_COST_DECAY_RATE: f64 = 10.0;

/// Compute value_score on a consistent 0-100 scale for both free and paid models.
/// For paid models: composite * efficiency_factor, where efficiency_factor
/// penalizes higher costs but stays in [0, 1].
/// For free models: composite score directly (perfect efficiency).
///
/// NOTE: a caller must not pass a cost of 0.0 for a *cost-unknown* model (e.g.
/// Ollama, whose cost is hardcoded 0.0) expecting a meaningful value — that
/// would score it as a perfect-efficiency free model and let it win any
/// best-value ranking. Cost-unknown models are excluded upstream in the summary
/// builders instead.
pub(crate) fn compute_value_score(composite: f64, total_cost: f64) -> f64 {
    if total_cost > 0.0 {
        let efficiency = (-total_cost * VALUE_SCORE_COST_DECAY_RATE).exp();
        (composite * efficiency).clamp(0.0, 100.0)
    } else {
        composite // Free models get full composite as value
    }
}

/// Whether a provider reports a real per-call cost. Ollama's cost is hardcoded
/// to 0.0 in the runner, so a zero there means "unknown", not "free" — such
/// models must be excluded from the best-value verdict rather than treated as
/// infinitely efficient.
pub(crate) fn provider_cost_is_known(provider: &str) -> bool {
    provider != personas_core::types::providers::OLLAMA
}

/// Pick the best-value model from a set of ranking objects, considering ONLY
/// cost-known models (`cost_unknown != true`). A cost-unknown model (Ollama)
/// has a hardcoded-zero cost that would otherwise score as perfect efficiency
/// and always win — so it can never be awarded the best-value verdict. Returns
/// `"unknown"` when every candidate is cost-unknown.
pub(crate) fn best_value_model(rankings: &[serde_json::Value]) -> String {
    rankings
        .iter()
        .filter(|r| {
            !r.get("cost_unknown")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .max_by_key(|r| r.get("value_score").and_then(|v| v.as_i64()).unwrap_or(0))
        .and_then(|r| r.get("model_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string()
}
