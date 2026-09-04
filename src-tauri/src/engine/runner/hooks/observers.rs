//! The observers that ship with the surface.
//!
//! One, deliberately. A surface with no concrete consumer is speculative
//! infrastructure, and a surface whose only consumer was written to justify it
//! is worse. `RunTelemetryObserver` is neither: run-level telemetry is
//! something the runner already needed and did not have in a structured form.

use super::{ObservationPoint, Observer, RunEvent};

/// Structured run telemetry.
///
/// Before this, `run_execution` recorded its terminal facts as free text in
/// the per-execution log file — `logger.log("Duration: {ms}ms")` and
/// friends — which is readable by a human opening one file and by nothing
/// else. This emits the same facts as a `tracing` event with real fields, so a
/// subscriber can aggregate cost and duration across runs without parsing log
/// prose.
///
/// It is the proof the observer surface is not speculative: it is a consumer
/// that wanted to exist independently of the hook design, and it needed to
/// touch exactly one file to land.
pub(crate) struct RunTelemetryObserver;

impl Observer for RunTelemetryObserver {
    fn name(&self) -> &'static str {
        "run_telemetry"
    }

    fn observes(&self) -> &'static [ObservationPoint] {
        ObservationPoint::ALL
    }

    fn observe(&self, event: &RunEvent) {
        // `tags.*` fields become real Sentry event tags — see the
        // 2026-05-10-sentry-execution-scope-tags ADR; the runner already uses
        // this convention for its error paths.
        match event.point {
            ObservationPoint::TaskStart => {
                tracing::info!(
                    hook_point = %event.point,
                    tags.execution_id = %event.execution_id,
                    tags.persona_id = %event.persona_id,
                    "run telemetry: task started"
                );
            }
            ObservationPoint::TaskSuccess | ObservationPoint::TaskFailure => {
                tracing::info!(
                    hook_point = %event.point,
                    tags.execution_id = %event.execution_id,
                    tags.persona_id = %event.persona_id,
                    duration_ms = event.duration_ms.unwrap_or(0),
                    input_tokens = event.input_tokens.unwrap_or(0),
                    output_tokens = event.output_tokens.unwrap_or(0),
                    // Unknown is not free: an absent cost logs as None, never as 0.
                    cost_usd = ?event.cost_usd,
                    error = event.error.as_deref().unwrap_or(""),
                    "run telemetry: task finished"
                );
            }
            ObservationPoint::SessionEnd => {
                tracing::debug!(
                    hook_point = %event.point,
                    tags.execution_id = %event.execution_id,
                    tags.persona_id = %event.persona_id,
                    duration_ms = event.duration_ms.unwrap_or(0),
                    "run telemetry: session end"
                );
            }
        }
    }
}
