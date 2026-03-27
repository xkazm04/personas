//! Deterministic Dream Replay Engine.
//!
//! Re-executes past executions from stored trace spans without consuming LLM
//! tokens. Reconstructs execution state frame-by-frame at each span boundary,
//! enabling VCR-style debugging with time-travel stepping.
//!
//! Each span boundary produces a `DreamFrame` containing:
//! - All active spans at that point in time
//! - All completed spans up to that point
//! - Cumulative cost, token counts, and error state
//! - Span tree depth and currently executing branch

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::trace::{ExecutionTrace, SpanType, TraceSpan};

/// A single reconstructed state frame at a span boundary.
///
/// Each frame represents the complete execution state at a specific
/// millisecond boundary where a span started or ended.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DreamFrame {
    /// Frame index (0-based, ordered by time).
    pub index: usize,
    /// Timestamp in ms from execution start.
    #[ts(type = "number")]
    pub timestamp_ms: u64,
    /// What happened at this boundary.
    pub event_type: DreamFrameEvent,
    /// The span that triggered this frame.
    pub trigger_span_id: String,
    /// Human-readable description of what's happening.
    pub description: String,
    /// Span type of the trigger span.
    pub trigger_span_type: SpanType,
    /// All spans currently active (started but not ended) at this timestamp.
    pub active_span_ids: Vec<String>,
    /// All spans completed by this timestamp.
    pub completed_span_ids: Vec<String>,
    /// Current tree depth (nesting level of the trigger span).
    pub depth: usize,
    /// Cumulative cost up to this frame (USD).
    pub cumulative_cost_usd: f64,
    /// Cumulative input tokens up to this frame.
    #[ts(type = "number")]
    pub cumulative_input_tokens: u64,
    /// Cumulative output tokens up to this frame.
    #[ts(type = "number")]
    pub cumulative_output_tokens: u64,
    /// Error at this frame (if the trigger span ended with an error).
    pub error: Option<String>,
    /// Metadata from the trigger span (tool names, credential names, etc.).
    pub metadata: Option<serde_json::Value>,
}

/// The type of span boundary event that produced a frame.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
#[allow(clippy::enum_variant_names)]
pub enum DreamFrameEvent {
    /// A span started executing.
    SpanStart,
    /// A span completed successfully.
    SpanEnd,
    /// A span ended with an error.
    SpanError,
}

/// Complete dream replay session containing all reconstructed frames.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DreamReplaySession {
    /// The execution ID being replayed.
    pub execution_id: String,
    /// The persona ID.
    pub persona_id: String,
    /// The original trace ID.
    pub trace_id: String,
    /// Total execution duration in ms.
    #[ts(type = "number")]
    pub total_duration_ms: u64,
    /// Total number of spans in the trace.
    pub total_span_count: usize,
    /// All reconstructed frames, ordered by timestamp.
    pub frames: Vec<DreamFrame>,
    /// All spans from the original trace (for reference/lookup).
    pub spans: Vec<TraceSpan>,
    /// Whether the original execution had evicted spans (incomplete trace).
    pub is_incomplete: bool,
    /// Total cost of the original execution (USD).
    pub total_cost_usd: f64,
    /// Total input tokens of the original execution.
    #[ts(type = "number")]
    pub total_input_tokens: u64,
    /// Total output tokens of the original execution.
    #[ts(type = "number")]
    pub total_output_tokens: u64,
}

/// Build a dream replay session from a stored execution trace.
///
/// Processes all span boundaries chronologically, reconstructing the
/// execution state at each point. No LLM tokens consumed -- pure
/// deterministic reconstruction from stored trace data.
pub fn build_dream_replay(trace: &ExecutionTrace) -> DreamReplaySession {
    let spans = &trace.spans;

    // Collect all span boundary events and sort by time
    let mut events: Vec<(u64, bool, usize)> = Vec::new(); // (ms, is_start, span_index)

    for (i, span) in spans.iter().enumerate() {
        events.push((span.start_ms, true, i));
        if let Some(end_ms) = span.end_ms {
            events.push((end_ms, false, i));
        }
    }

    // Sort by timestamp, then starts before ends at the same ms
    events.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1)));

    // Build parent -> children map for depth calculation.
    // `visiting` tracks spans on the current recursion stack to detect circular
    // parent_span_id references (e.g. A->B->C->A or self-refs) and break them
    // with depth 0 instead of overflowing the stack.
    let mut depth_cache: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut visiting: std::collections::HashSet<String> = std::collections::HashSet::new();

    fn compute_depth(
        span_id: &str,
        spans: &[TraceSpan],
        cache: &mut std::collections::HashMap<String, usize>,
        visiting: &mut std::collections::HashSet<String>,
    ) -> usize {
        if let Some(&d) = cache.get(span_id) {
            return d;
        }
        // Cycle detection: if this span is already on the recursion stack, break
        // the cycle by treating it as a root (depth 0).
        if !visiting.insert(span_id.to_string()) {
            cache.insert(span_id.to_string(), 0);
            return 0;
        }
        let span = match spans.iter().find(|s| s.span_id == span_id) {
            Some(s) => s,
            None => {
                visiting.remove(span_id);
                cache.insert(span_id.to_string(), 0);
                return 0;
            }
        };
        let depth = match &span.parent_span_id {
            Some(parent_id) => compute_depth(parent_id, spans, cache, visiting) + 1,
            None => 0,
        };
        visiting.remove(span_id);
        cache.insert(span_id.to_string(), depth);
        depth
    }

    // Pre-compute depths
    for span in spans {
        compute_depth(&span.span_id, spans, &mut depth_cache, &mut visiting);
    }

    // Track state as we walk through events
    let mut active_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut completed_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut cumulative_cost: f64 = 0.0;
    let mut cumulative_input: u64 = 0;
    let mut cumulative_output: u64 = 0;

    let mut frames: Vec<DreamFrame> = Vec::with_capacity(events.len());

    for (ms, is_start, span_idx) in &events {
        let span = &spans[*span_idx];

        if *is_start {
            active_set.insert(span.span_id.clone());
        } else {
            active_set.remove(&span.span_id);
            completed_set.insert(span.span_id.clone());

            // Accumulate cost/tokens when a span ends
            if let Some(cost) = span.cost_usd {
                cumulative_cost += cost;
            }
            if let Some(inp) = span.input_tokens {
                cumulative_input += inp;
            }
            if let Some(out) = span.output_tokens {
                cumulative_output += out;
            }
        }

        let event_type = if *is_start {
            DreamFrameEvent::SpanStart
        } else if span.error.is_some() {
            DreamFrameEvent::SpanError
        } else {
            DreamFrameEvent::SpanEnd
        };

        let description = if *is_start {
            format!("{} started", span.name)
        } else if let Some(ref err) = span.error {
            format!("{} failed: {}", span.name, truncate(err, 80))
        } else {
            let dur = span.duration_ms.unwrap_or(0);
            format!("{} completed ({}ms)", span.name, dur)
        };

        let depth = depth_cache.get(&span.span_id).copied().unwrap_or(0);

        frames.push(DreamFrame {
            index: frames.len(),
            timestamp_ms: *ms,
            event_type,
            trigger_span_id: span.span_id.clone(),
            description,
            trigger_span_type: span.span_type.clone(),
            active_span_ids: active_set.iter().cloned().collect(),
            completed_span_ids: completed_set.iter().cloned().collect(),
            depth,
            cumulative_cost_usd: cumulative_cost,
            cumulative_input_tokens: cumulative_input,
            cumulative_output_tokens: cumulative_output,
            error: if !*is_start { span.error.clone() } else { None },
            metadata: span.metadata.clone(),
        });
    }

    // Extract root span totals
    let root = spans.iter().find(|s| s.parent_span_id.is_none());
    let total_cost = root.and_then(|s| s.cost_usd).unwrap_or(cumulative_cost);
    let total_input = root.and_then(|s| s.input_tokens).unwrap_or(cumulative_input);
    let total_output = root.and_then(|s| s.output_tokens).unwrap_or(cumulative_output);

    DreamReplaySession {
        execution_id: trace.execution_id.clone(),
        persona_id: trace.persona_id.clone(),
        trace_id: trace.trace_id.clone(),
        total_duration_ms: trace.total_duration_ms.unwrap_or(0),
        total_span_count: spans.len(),
        frames,
        spans: spans.clone(),
        is_incomplete: trace.evicted_span_count > 0,
        total_cost_usd: total_cost,
        total_input_tokens: total_input,
        total_output_tokens: total_output,
    }
}

use super::str_utils::truncate_owned as truncate;
