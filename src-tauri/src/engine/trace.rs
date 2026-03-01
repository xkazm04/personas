//! Structured execution traces with span trees.
//!
//! Each execution produces a tree of typed spans: root span (execution) →
//! child spans (prompt assembly, credential resolution, CLI spawn, tool calls,
//! protocol dispatch, chain evaluation). Each span records start/end time,
//! cost attribution, token counts, and error info.
//!
//! Traces are stored as JSON in the `execution_traces` table and emitted to
//! the frontend via Tauri events for live rendering in an execution inspector.
//!
//! For chain triggers, a `chain_trace_id` propagates through payloads so
//! multi-persona execution chains appear as a single distributed trace.

use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// =============================================================================
// Span types
// =============================================================================

/// The type of work a span represents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SpanType {
    /// Root span covering the entire execution.
    Execution,
    /// Prompt assembly (identity, instructions, tool docs, etc.).
    PromptAssembly,
    /// Credential decryption and injection.
    CredentialResolution,
    /// CLI process spawn and argument construction.
    CliSpawn,
    /// Individual tool call within the execution.
    ToolCall,
    /// Protocol message dispatch (UserMessage, AgentMemory, etc.).
    ProtocolDispatch,
    /// Chain trigger evaluation after execution completes.
    ChainEvaluation,
    /// Output stream processing (reading stdout line-by-line).
    StreamProcessing,
    /// Outcome assessment (success/incomplete heuristic).
    OutcomeAssessment,
    /// Healing analysis after execution failure.
    HealingAnalysis,
}

/// A single span in the execution trace tree.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TraceSpan {
    /// Unique span identifier.
    pub span_id: String,
    /// Parent span ID (None for the root span).
    pub parent_span_id: Option<String>,
    /// What kind of work this span represents.
    pub span_type: SpanType,
    /// Human-readable name (e.g., "ToolCall: Read", "CredentialResolution: google").
    pub name: String,
    /// Start time as milliseconds from execution start.
    #[ts(type = "number")]
    pub start_ms: u64,
    /// End time as milliseconds from execution start (None if still running).
    #[ts(type = "number | null")]
    pub end_ms: Option<u64>,
    /// Duration in milliseconds (computed from start/end).
    #[ts(type = "number | null")]
    pub duration_ms: Option<u64>,
    /// Cost attributed to this span (USD).
    pub cost_usd: Option<f64>,
    /// Input tokens consumed in this span.
    #[ts(type = "number | null")]
    pub input_tokens: Option<u64>,
    /// Output tokens produced in this span.
    #[ts(type = "number | null")]
    pub output_tokens: Option<u64>,
    /// Error message if this span failed.
    pub error: Option<String>,
    /// Arbitrary metadata (e.g., tool name, prompt length, credential name).
    pub metadata: Option<serde_json::Value>,
}

/// A complete execution trace containing all spans.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionTrace {
    /// Unique trace identifier.
    pub trace_id: String,
    /// The execution this trace belongs to.
    pub execution_id: String,
    /// The persona that was executed.
    pub persona_id: String,
    /// Distributed trace ID for multi-persona chain executions.
    /// All executions in the same chain share this ID.
    pub chain_trace_id: Option<String>,
    /// All spans in the trace (flat list, tree reconstructed via parent_span_id).
    pub spans: Vec<TraceSpan>,
    /// Total trace duration in milliseconds.
    #[ts(type = "number | null")]
    pub total_duration_ms: Option<u64>,
    /// When the trace was created (ISO 8601).
    pub created_at: String,
}

// =============================================================================
// Tauri event payloads
// =============================================================================

/// Event payload emitted when a span starts or ends (live trace updates).
#[derive(Debug, Clone, Serialize)]
pub struct TraceSpanEvent {
    pub execution_id: String,
    pub span: TraceSpan,
    /// "start" or "end"
    pub event_type: String,
}

// =============================================================================
// TraceCollector — accumulates spans during execution
// =============================================================================

/// Thread-safe collector that accumulates trace spans during execution.
///
/// Passed through runner.rs and used to record the start/end of each
/// significant operation. At the end, the collected spans are serialized
/// and stored in the `execution_traces` table.
pub struct TraceCollector {
    trace_id: String,
    execution_id: String,
    persona_id: String,
    chain_trace_id: Option<String>,
    epoch: Instant,
    pub(crate) spans: Mutex<Vec<TraceSpan>>,
    root_span_id: String,
}

impl TraceCollector {
    /// Create a new trace collector for an execution.
    pub fn new(
        execution_id: &str,
        persona_id: &str,
        chain_trace_id: Option<String>,
    ) -> Self {
        let trace_id = uuid::Uuid::new_v4().to_string();
        let root_span_id = uuid::Uuid::new_v4().to_string();
        let epoch = Instant::now();

        let root_span = TraceSpan {
            span_id: root_span_id.clone(),
            parent_span_id: None,
            span_type: SpanType::Execution,
            name: "Execution".to_string(),
            start_ms: 0,
            end_ms: None,
            duration_ms: None,
            cost_usd: None,
            input_tokens: None,
            output_tokens: None,
            error: None,
            metadata: None,
        };

        Self {
            trace_id,
            execution_id: execution_id.to_string(),
            persona_id: persona_id.to_string(),
            chain_trace_id,
            epoch,
            spans: Mutex::new(vec![root_span]),
            root_span_id,
        }
    }

    /// The root span ID (parent for top-level child spans).
    #[allow(dead_code)]
    pub fn root_span_id(&self) -> &str {
        &self.root_span_id
    }

    /// The trace ID.
    #[allow(dead_code)]
    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    /// The chain trace ID (for distributed tracing across chain executions).
    #[allow(dead_code)]
    pub fn chain_trace_id(&self) -> Option<&str> {
        self.chain_trace_id.as_deref()
    }

    /// Start a new span. Returns the span_id so the caller can end it later.
    pub fn start_span(
        &self,
        span_type: SpanType,
        name: &str,
        parent_span_id: Option<&str>,
        metadata: Option<serde_json::Value>,
    ) -> String {
        let span_id = uuid::Uuid::new_v4().to_string();
        let start_ms = self.epoch.elapsed().as_millis() as u64;

        let span = TraceSpan {
            span_id: span_id.clone(),
            parent_span_id: Some(
                parent_span_id
                    .unwrap_or(&self.root_span_id)
                    .to_string(),
            ),
            span_type,
            name: name.to_string(),
            start_ms,
            end_ms: None,
            duration_ms: None,
            cost_usd: None,
            input_tokens: None,
            output_tokens: None,
            error: None,
            metadata,
        };

        self.spans.lock().unwrap().push(span);
        span_id
    }

    /// End a span by ID, recording duration and optional error/metrics.
    pub fn end_span(
        &self,
        span_id: &str,
        error: Option<String>,
        cost_usd: Option<f64>,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    ) {
        let end_ms = self.epoch.elapsed().as_millis() as u64;
        let mut spans = self.spans.lock().unwrap();

        if let Some(span) = spans.iter_mut().find(|s| s.span_id == span_id) {
            span.end_ms = Some(end_ms);
            span.duration_ms = Some(end_ms.saturating_sub(span.start_ms));
            span.error = error;
            if cost_usd.is_some() {
                span.cost_usd = cost_usd;
            }
            if input_tokens.is_some() {
                span.input_tokens = input_tokens;
            }
            if output_tokens.is_some() {
                span.output_tokens = output_tokens;
            }
        }
    }

    /// End a span with just an error (convenience).
    pub fn end_span_error(&self, span_id: &str, error: &str) {
        self.end_span(span_id, Some(error.to_string()), None, None, None);
    }

    /// End a span successfully (no error, no metrics).
    pub fn end_span_ok(&self, span_id: &str) {
        self.end_span(span_id, None, None, None, None);
    }

    /// Finalize the trace: close the root span and build the ExecutionTrace.
    pub fn finalize(
        &self,
        total_cost_usd: Option<f64>,
        total_input_tokens: Option<u64>,
        total_output_tokens: Option<u64>,
        error: Option<String>,
    ) -> ExecutionTrace {
        let end_ms = self.epoch.elapsed().as_millis() as u64;
        let mut spans = self.spans.lock().unwrap();

        // Close root span
        if let Some(root) = spans.iter_mut().find(|s| s.span_id == self.root_span_id) {
            root.end_ms = Some(end_ms);
            root.duration_ms = Some(end_ms);
            root.cost_usd = total_cost_usd;
            root.input_tokens = total_input_tokens;
            root.output_tokens = total_output_tokens;
            root.error = error;
        }

        ExecutionTrace {
            trace_id: self.trace_id.clone(),
            execution_id: self.execution_id.clone(),
            persona_id: self.persona_id.clone(),
            chain_trace_id: self.chain_trace_id.clone(),
            spans: spans.clone(),
            total_duration_ms: Some(end_ms),
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    /// Get a snapshot of a specific span (for emitting events).
    pub fn get_span(&self, span_id: &str) -> Option<TraceSpan> {
        self.spans
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.span_id == span_id)
            .cloned()
    }
}
