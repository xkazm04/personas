//! Per-scenario score push to Langfuse. Stage 2 of the Lab-score-push toggle.
//!
//! Whenever `engine::test_runner::score_result` finishes scoring a scenario,
//! we synthesize a one-span execution trace AND push the three rubrics to
//! `/api/public/scores` with a matching `traceId`. Both calls are
//! fire-and-forget; the gate inside `exporter::push_lab_scores` honours the
//! user's `push_lab_scores` opt-in (so this is a no-op when disabled).
//!
//! Why we emit a synthetic trace alongside the score push: Langfuse stores
//! scores as siblings of traces, indexed by `traceId`. Without a trace at
//! that id the score appears as an orphan in the Langfuse UI — not useful.
//! The synthetic span carries the scenario context (persona, scenario name +
//! description) so the row is interpretable in Langfuse.

use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use crate::engine::trace::{ExecutionTrace, SpanType, TraceSpan};
use crate::langfuse::exporter;

#[allow(clippy::too_many_arguments)]
pub fn ship_lab_score(
    persona_id: &str,
    persona_name: &str,
    persona_export_enabled: bool,
    scenario_name: &str,
    scenario_description: &str,
    tool_accuracy: Option<i32>,
    output_quality: Option<i32>,
    protocol_compliance: Option<i32>,
    rationale_summary: Option<String>,
    input_tokens: u64,
    output_tokens: u64,
    cost_usd: f64,
    duration_ms: u64,
) {
    // First gate: per-persona export opt-out. When OFF, this persona's lab
    // scenarios stay local — neither trace nor score crosses to Langfuse.
    if !persona_export_enabled {
        return;
    }

    let trace_uuid = Uuid::new_v4().to_string();
    let span_uuid = Uuid::new_v4().to_string();
    let execution_id = format!("lab-{trace_uuid}");

    let trace = ExecutionTrace {
        trace_id: trace_uuid.clone(),
        execution_id,
        persona_id: persona_id.to_string(),
        chain_trace_id: None,
        spans: vec![TraceSpan {
            span_id: span_uuid,
            parent_span_id: None,
            span_type: SpanType::Execution,
            name: format!("Lab scenario: {scenario_name}"),
            start_ms: 0,
            end_ms: Some(duration_ms),
            duration_ms: Some(duration_ms),
            cost_usd: Some(cost_usd),
            input_tokens: Some(input_tokens),
            output_tokens: Some(output_tokens),
            error: None,
            metadata: Some(json!({
                "personas.lab.persona": persona_name,
                "personas.lab.scenario": scenario_name,
                "personas.lab.scenario_description": scenario_description,
            })),
        }],
        total_duration_ms: Some(duration_ms),
        evicted_span_count: 0,
        created_at: Utc::now().to_rfc3339(),
    };

    // Fire-and-forget through the existing channel; the worker handles the
    // POST in the background. No-op when no exporter is installed.
    exporter::export_trace(&trace);

    // Same gate semantics as the trace: no-op when push_lab_scores is OFF.
    exporter::push_lab_scores(
        exporter::trace_id_hex(&trace_uuid),
        tool_accuracy,
        output_quality,
        protocol_compliance,
        rationale_summary,
    );
}
