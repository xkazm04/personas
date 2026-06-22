//! Tauri event helpers shared by the streaming + tool-loop paths. These mirror
//! the CLI path's event contract; the caller persists the terminal DB row.

use std::time::Instant;

use crate::engine::event_registry::event_name;
use crate::engine::events::{emit_to, ExecutionEventEmitter};
use crate::engine::types::{
    ExecutionOutputEvent, ExecutionResult, ExecutionState, ExecutionStatusEvent,
};

pub(super) fn emit_output(emitter: &dyn ExecutionEventEmitter, execution_id: &str, line: &str) {
    emit_to(
        emitter,
        event_name::EXECUTION_OUTPUT,
        &ExecutionOutputEvent {
            execution_id: execution_id.to_string(),
            line: line.to_string(),
        },
    );
}

pub(super) fn emit_status(
    emitter: &dyn ExecutionEventEmitter,
    execution_id: &str,
    status: ExecutionState,
    error: Option<&str>,
    duration_ms: u64,
    cost_usd: Option<f64>,
) {
    emit_to(
        emitter,
        event_name::EXECUTION_STATUS,
        &ExecutionStatusEvent {
            execution_id: execution_id.to_string(),
            status,
            error: error.map(str::to_string),
            duration_ms: Some(duration_ms),
            cost_usd,
        },
    );
}

/// Emit a failure status + return a failed `ExecutionResult`.
pub(super) fn fail(
    emitter: &dyn ExecutionEventEmitter,
    execution_id: &str,
    error_msg: &str,
    start_time: Instant,
) -> ExecutionResult {
    let duration_ms = start_time.elapsed().as_millis() as u64;
    tracing::warn!(execution_id, error = error_msg, "[http_engine] failed");
    emit_status(emitter, execution_id, ExecutionState::Failed, Some(error_msg), duration_ms, None);
    ExecutionResult {
        success: false,
        error: Some(error_msg.to_string()),
        duration_ms,
        ..Default::default()
    }
}
