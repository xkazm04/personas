//! ExecutionProtocol trait -- formal boundary between the execution runtime
//! and its persistence/notification side effects.
//!
//! This trait declares the contract that any execution backend must implement:
//! - Protocol message dispatch (7 message types from the AI output stream)
//! - Execution event emission (output, structured events, heartbeats)
//! - Status finalization (terminal state + metrics)
//!
//! The same protocol is expressed in TypeScript in `src/lib/execution/pipeline.ts`
//! (7-stage pipeline model with typed payloads). This Rust trait is the backend
//! counterpart, enabling the engine to run in different modes:
//! - Desktop mode: `TauriDispatcher` (SQLite + Tauri events + OS notifications)
//! - Test mode: `MockProtocol` (in-memory capture for assertions)
//! - Future: HTTP/cloud dispatch, WebSocket relay, etc.

use serde::Serialize;

use super::types::{
    ExecutionOutputEvent, ExecutionState, ExecutionStatusEvent, HeartbeatEvent, ProtocolMessage,
    StructuredExecutionEvent,
};

// =============================================================================
// Pipeline stages -- Rust counterpart of frontend PIPELINE_STAGES
// =============================================================================

/// The 7 ordered stages of an execution pipeline.
///
/// Each stage represents a boundary crossing in the system, matching the
/// frontend's `PIPELINE_STAGES` array in `pipeline.ts`.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStage {
    /// User triggers execution via UI.
    Initiate,
    /// Tauri command validates concurrency, budget, loads persona + tools.
    Validate,
    /// Creates PersonaExecution row in DB.
    CreateRecord,
    /// Engine spawns tokio task for CLI process.
    SpawnEngine,
    /// Runner streams stdout, parses protocol messages.
    StreamOutput,
    /// Runner writes final status, emits terminal event.
    FinalizeStatus,
    /// Frontend processes terminal event, clears state.
    FrontendComplete,
}

#[allow(dead_code)]
impl PipelineStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Initiate => "initiate",
            Self::Validate => "validate",
            Self::CreateRecord => "create_record",
            Self::SpawnEngine => "spawn_engine",
            Self::StreamOutput => "stream_output",
            Self::FinalizeStatus => "finalize_status",
            Self::FrontendComplete => "frontend_complete",
        }
    }

    /// All stages in pipeline order.
    pub const ALL: &'static [PipelineStage] = &[
        PipelineStage::Initiate,
        PipelineStage::Validate,
        PipelineStage::CreateRecord,
        PipelineStage::SpawnEngine,
        PipelineStage::StreamOutput,
        PipelineStage::FinalizeStatus,
        PipelineStage::FrontendComplete,
    ];
}

impl std::fmt::Display for PipelineStage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// =============================================================================
// Status finalization -- the terminal contract
// =============================================================================

/// Outcome of execution finalization, passed to `ExecutionProtocol::finalize_status`.
///
/// Captures the terminal state plus metrics that the frontend needs to
/// transition the execution to its final state.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct StatusFinalization {
    pub execution_id: String,
    pub status: ExecutionState,
    pub error: Option<String>,
    pub duration_ms: Option<u64>,
    pub cost_usd: Option<f64>,
}

#[allow(dead_code)]
impl StatusFinalization {
    /// Convert to the event payload used by Tauri event emission.
    pub fn to_status_event(&self) -> ExecutionStatusEvent {
        ExecutionStatusEvent {
            execution_id: self.execution_id.clone(),
            status: self.status,
            error: self.error.clone(),
            duration_ms: self.duration_ms,
            cost_usd: self.cost_usd,
        }
    }
}

// =============================================================================
// ExecutionProtocol trait
// =============================================================================

/// Formal boundary between the execution runtime and its side effects.
///
/// The 7 protocol message types handled by `dispatch_message`:
/// 1. `UserMessage` — persist to messages repo, notify user
/// 2. `PersonaAction` — persist as persona_action event
/// 3. `EmitEvent` — persist as custom event
/// 4. `AgentMemory` — persist to memories repo (with quality gate)
/// 5. `ManualReview` — persist to reviews repo, notify user
/// 6. `ExecutionFlow` — log only (stored at execution completion)
/// 7. `KnowledgeAnnotation` — upsert to knowledge repo
///
/// The pipeline stages (declared in `PipelineStage`) define the execution
/// lifecycle. The status finalization contract (`finalize_status`) marks
/// the transition to a terminal state.
#[allow(dead_code)]
pub trait ExecutionProtocol {
    /// Handle a parsed protocol message from the AI output stream.
    fn dispatch_message(&mut self, msg: &ProtocolMessage);

    /// Emit an execution output line for frontend display.
    fn emit_output(&self, event: &ExecutionOutputEvent);

    /// Emit a structured execution event for typed frontend consumption.
    fn emit_structured_event(&self, event: &StructuredExecutionEvent);

    /// Emit a heartbeat during stream silence.
    fn emit_heartbeat(&self, event: &HeartbeatEvent);

    /// Finalize execution with a terminal status.
    ///
    /// This is the status finalization contract — the last step of the
    /// `FinalizeStatus` pipeline stage where the execution transitions
    /// to a terminal state and the frontend is notified.
    fn finalize_status(&self, finalization: &StatusFinalization);
}

// =============================================================================
// MockProtocol -- test implementation
// =============================================================================

/// In-memory protocol implementation for testing.
///
/// Captures all dispatched messages, emitted events, and status finalizations
/// for assertion in unit/integration tests. Enables running the engine
/// without a database or Tauri runtime.
#[allow(dead_code)]
#[derive(Debug, Default)]
pub struct MockProtocol {
    pub dispatched_messages: Vec<ProtocolMessage>,
    pub output_events: Vec<ExecutionOutputEvent>,
    pub structured_events: Vec<StructuredExecutionEvent>,
    pub heartbeat_events: Vec<HeartbeatEvent>,
    pub finalizations: Vec<StatusFinalization>,
}

#[allow(dead_code)]
impl MockProtocol {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns true if any protocol message of the given discriminant was dispatched.
    pub fn has_message_type(&self, type_name: &str) -> bool {
        self.dispatched_messages.iter().any(|m| {
            let disc = match m {
                ProtocolMessage::UserMessage { .. } => "UserMessage",
                ProtocolMessage::PersonaAction { .. } => "PersonaAction",
                ProtocolMessage::EmitEvent { .. } => "EmitEvent",
                ProtocolMessage::AgentMemory { .. } => "AgentMemory",
                ProtocolMessage::ManualReview { .. } => "ManualReview",
                ProtocolMessage::ExecutionFlow { .. } => "ExecutionFlow",
                ProtocolMessage::KnowledgeAnnotation { .. } => "KnowledgeAnnotation",
            };
            disc == type_name
        })
    }

    /// Returns the terminal status from the last finalization, if any.
    pub fn final_status(&self) -> Option<ExecutionState> {
        self.finalizations.last().map(|f| f.status)
    }
}

impl ExecutionProtocol for MockProtocol {
    fn dispatch_message(&mut self, msg: &ProtocolMessage) {
        self.dispatched_messages.push(msg.clone());
    }

    fn emit_output(&self, _event: &ExecutionOutputEvent) {
        // MockProtocol uses interior mutability pattern would be needed
        // to capture in &self methods. For now, output events are not
        // captured in the mock (they're display-only).
    }

    fn emit_structured_event(&self, _event: &StructuredExecutionEvent) {
        // Same as emit_output -- display-only events not captured.
    }

    fn emit_heartbeat(&self, _event: &HeartbeatEvent) {
        // Heartbeats not captured in mock.
    }

    fn finalize_status(&self, _finalization: &StatusFinalization) {
        // Would need interior mutability to capture. The primary test
        // path is through dispatch_message assertions.
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_stages_count() {
        assert_eq!(PipelineStage::ALL.len(), 7);
    }

    #[test]
    fn pipeline_stage_as_str_matches_frontend() {
        // These must match the frontend PIPELINE_STAGES array in pipeline.ts
        let expected = [
            "initiate",
            "validate",
            "create_record",
            "spawn_engine",
            "stream_output",
            "finalize_status",
            "frontend_complete",
        ];
        for (stage, expected_str) in PipelineStage::ALL.iter().zip(expected.iter()) {
            assert_eq!(stage.as_str(), *expected_str);
        }
    }

    #[test]
    fn status_finalization_to_event() {
        let fin = StatusFinalization {
            execution_id: "exec-1".to_string(),
            status: ExecutionState::Completed,
            error: None,
            duration_ms: Some(1500),
            cost_usd: Some(0.05),
        };
        let event = fin.to_status_event();
        assert_eq!(event.execution_id, "exec-1");
        assert_eq!(event.duration_ms, Some(1500));
    }

    #[test]
    fn mock_protocol_captures_messages() {
        let mut mock = MockProtocol::new();
        let msg = ProtocolMessage::EmitEvent {
            event_type: "test_event".to_string(),
            data: None,
        };
        mock.dispatch_message(&msg);
        assert!(mock.has_message_type("EmitEvent"));
        assert!(!mock.has_message_type("UserMessage"));
        assert_eq!(mock.dispatched_messages.len(), 1);
    }
}
