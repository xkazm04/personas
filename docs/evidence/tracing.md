---
subject: tracing
evidence:
  - src-tauri/core/src/trace.rs                                          # one span schema (id/parent/kind/name/start/end/status/attrs), closed SpanType enum, MAX_SPANS ceiling with persisted evicted_span_count, orphan force-close at finalize, W3C traceparent minted for the child CLI
  - src-tauri/db/src/repos/execution/traces.rs                           # settled store; chain_trace_id grouping + idempotent root back-fill; indexed fan-out breadth guard with its under-count documented
  - src/features/agents/sub_executions/detail/inspector/TraceInspector.tsx  # the waterfall: one shared 0→total axis, structural rows, collapse, ghost-under-chrome, per-span error drill-down
  - src/features/agents/sub_executions/trace/SyntheticTrace.ts           # reconstructed traces carry isSynthetic so the renderer shows "Estimated" instead of ms-precision guesses as fact
  - src/features/agents/sub_executions/detail/chain/ChainTraceView.tsx   # chained runs rendered as one distributed trace, with structured stop reasons and an explicit partial-chain state
  - src/features/overview/sub_observability/components/SystemTraceViewer.tsx  # second viewer consuming the same UnifiedSpan model via shared buildSpanTree/flattenTree — one species, many surfaces
  - src/features/overview/sub_events/HighlightedJson.tsx                 # the raw floor: token-level highlighting, copy-the-truth, unparseable input rendered as text instead of crashing
  - src/lib/utils/terminalColors.ts                                      # terminal-line classification derived from line shapes, closed style vocabulary, neutral default for unmatched lines
counter_evidence:
  - docs/concepts/golden-paths/execution-trace-instrumentation.md        # measured: write-once-at-finalize left 126 abnormally-ended runs traceless (0% coverage for reaped runs); every token count in 2,942 traces is a confident Some(0) from one unasserted field read
deviations:
  - w5-tracing   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Tracing - evidence

How this codebase measures against the [`tracing`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
