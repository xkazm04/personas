---
layer: application
subject: tracing
technique: waterfall-rendering
stack: react
---

# Waterfall rendering in the execution inspector

How Personas' React inspector applies the
[waterfall-rendering](../techniques/waterfall-rendering.md) technique. Canonical
sources: `src/features/agents/sub_executions/detail/inspector/TraceInspector.tsx`
(the waterfall), `traceInspectorTypes.ts` + `useTraceData.ts` (tree assembly and
live/settled merge), `SpanRow.tsx` (the bar), and the sibling viewers
`SystemTraceViewer.tsx` (system operations) and `ChainTraceView.tsx` (chained runs).

## One shared axis, structural rows

`TraceInspector.tsx:72-111` renders a fixed axis header (`0ms` → `formatDuration(totalMs)`)
above the rows; every `SpanRow` positions and sizes its bar against the same
`totalMs`. Rows come from `computeVisibleNodes` in structural (tree) order with
depth indentation, never re-sorted by duration. The axis-end slot is reserved even
before spans land so the header geometry never shifts.

## One model, many viewers

The inspector renders `UnifiedSpan` — the same species whether the span came from
the backend `ExecutionTrace` (ts-rs binding of the Rust struct, one schema across
the language boundary) or from the frontend's live pipeline stages. Proof that the
model, not the producer, is what's consumed: `SystemTraceViewer.tsx` imports
`buildSpanTree`/`flattenTree` from the *agents* helpers and renders system-operation
traces with the identical tree/collapse machinery. `ChainTraceView.tsx` extends the
same read surface across chained runs sharing a `chain_trace_id`, with structured
stop reasons (via `tokenLabel`, a closed vocabulary) and an explicit *partial-chain*
banner — a truncated distributed trace confesses rather than posing as complete.

## Honest states

- **Loading**: `TraceGhostRows` (TraceInspector.tsx:165-191) — geometry-matched
  ghost bars *under* the real axis chrome, delayed 120ms so warm fetches paint no
  ghost. Law 1 of the loading doctrine is cited in-code: a fetch never hides
  rendered spans.
- **Empty vs. loading vs. failed** are three distinct renders: settled-only empty
  state ("no trace data" + hint), error panel with a retry action, ghost while
  fetching. A slow fetch never flashes "no trace".
- **Live runs**: `useTraceData.ts` buffers span events arriving during the initial
  fetch (`pendingSpanEventsRef`) and replays them exactly once; `applySpanEvent`
  (traceInspectorTypes.ts:112-129) is idempotent on `span_id` and materializes an
  `end` whose `start` was never seen — an event stream allowed to lose events,
  handled as such.
- **Truncation**: `TraceSummary.tsx:101-111` surfaces `evicted_span_count` as an
  incompleteness warning.
- **Estimates**: `SyntheticTrace.ts` stamps `isSynthetic: true` on reconstructed
  traces (fixed-percentage apportionment of wall time) so the pipeline waterfall
  shows an "Estimated" badge instead of presenting ms-precision guesses as fact.
- **Refusal to fabricate**: `CostBreakdownBar.tsx:30-38` renders the total alone
  rather than an invented 50/50 decomposition — a written refusal to decompose
  what was not measured.

## Scale

Rows use `contentVisibility: 'auto'` with a fixed intrinsic size
(TraceInspector.tsx:96-99) — windowed rendering for 10,000-span traces without a
virtualization library. Collapse state is a `Set` of collapsed span ids; visibility
is derived via a memoized ancestor walk with a cycle guard, decoupled from tree
building so toggling one node does not rebuild the tree.

## Deviations against the technique (reported, not fixed)

1. **Collapsed rows do not roll up worst status** — a collapsed subtree containing
   a failed span shows no failure marker on the survivor row; the separate error
   list below the waterfall (TraceInspector.tsx:115-140) partially compensates.
2. **No self-time or critical-path computation** — the long pole must still be
   found by eye; gaps between a parent and its children are not surfaced.
3. **Estimate labeling is per-trace, not per-datum** — `isSynthetic` marks the
   whole trace; individual synthetic spans carry no marking, and their durations
   render at ms precision. Acceptable while traces are all-or-nothing synthetic;
   becomes laundering the first time measured and estimated spans mix.
4. **Status is not a closed vocabulary** — a span is "failed" iff `error` is
   non-null and "running" iff `end_ms` is null; *cancelled* and *interrupted* are
   collapsed into error strings (the orphan sweep writes the literal
   `"span not properly closed"`). The waterfall therefore cannot color the three
   abnormal endings differently.
