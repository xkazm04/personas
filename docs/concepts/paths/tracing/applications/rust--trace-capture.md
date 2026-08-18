---
layer: application
subject: tracing
technique: trace-capture
stack: rust
---

# Trace capture in the Rust engine — `TraceCollector`

How Personas' execution engine applies (and in one place deviates from) the
[trace-capture](../techniques/trace-capture.md) technique. Canonical source:
`src-tauri/core/src/trace.rs` (the collector), `src-tauri/db/src/repos/execution/traces.rs`
(the settled store), and the `start_span`/`end_span` call sites in
`src-tauri/src/engine/runner/mod.rs`.

## What opens a span

`TraceCollector::new` (trace.rs:215) mints the trace id, the root span id, and a
monotonic `Instant` epoch — every `start_ms` is milliseconds from run start in one
clock domain, so spans are comparable without wall-clock arithmetic. The **root span
is created first, before any work**, so even a trace that never gains children still
says "this run began".

`start_span` (trace.rs:269) opens spans for exactly the units the technique names:
pipeline stages, prompt assembly, credential resolution, CLI spawn, tool calls,
protocol dispatch — the closed `SpanType` enum (trace.rs:34-59). A forgotten parent
defaults to the root (`parent_span_id: Some(parent.unwrap_or(&self.root_span_id))`,
trace.rs:302) — measured over 90,813 live spans: zero dangling parents (see the
legacy leaf `docs/concepts/golden-paths/execution-trace-instrumentation.md` §0.1).

## Capture cost

Open and close are constant-time appends under one mutex; `SpanStore`
(trace.rs:156-211) pairs the span vec with an O(1) `span_id -> index` map so
`end_span` never scans. Nothing on the hot path touches storage; the one Sentry
breadcrumb is deliberately gated to `PipelineStage` spans only (trace.rs:284-298),
with the flood it avoids named in the comment.

## Ceilings with a confession

`MAX_SPANS = 10_000` (trace.rs:24). At capacity, `start_span` evicts the oldest
*completed* non-root span (falling back to the oldest open one), increments
`evicted_span_count`, and warns once per trace (trace.rs:319-343). The count is
**persisted on the trace row** (traces.rs `save`) and surfaced in the inspector
(`TraceSummary.tsx:101-111`) as "this trace is incomplete" — the truncation survives
into the artifact, exactly the technique's confession rule.

## Orphan closure

`finalize` (trace.rs:391-448) force-closes every span still open, stamps
`error: "span not properly closed"`, counts them into a `warn!`, then closes the
root with the run's totals and drains (not clones) the store. 88 live spans across
66 traces carry the marker — it is how a reader distinguishes "this tool call never
got a result" from "this tool call was fast".

## The known deviations (kept as the standard, reported)

1. **Write-once-at-finalize.** The trace is durable only when `finalize()` +
   `traces::save` run. Measured consequence: 100% trace coverage for completed
   runs, 55.5% for failed, **0% for the 20 runs reaped as `incomplete`** — the
   inverted-coverage profile the technique forbids. The technique's rule (spans
   durable as they close) is the fix; registered in the legacy leaf's deviation
   D4, not applied here.
2. **`Some(0)` for unmeasured tokens.** `engine/src/parser.rs:340-341` reads two
   top-level fields the producer never emits; the miss becomes `Some(0)` on every
   root span in the store (2,942/2,942). The span-model technique's
   "absent and zero are different measurements" rule exists because of exactly
   this class of defect (legacy leaf D2).
3. **LIFO tool-span closing.** `runner/mod.rs:2484-2488` closes "the most recent
   open ToolCall" rather than the handle/id — under interleaved tool results this
   swaps durations (2,882 overlapping pairs across 29.5% of traces; legacy leaf D8).
4. **Unparseable spans read back as empty.** `traces.rs` `get_by_execution_id`
   deserializes with `.unwrap_or_default()` — a corrupt `spans` JSON column would
   render as an empty trace rather than a read failure (failure spelled as empty
   success). Zero live occurrences measured, but the door exists.
