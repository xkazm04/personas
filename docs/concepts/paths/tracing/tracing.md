---
layer: golden-path
subject: tracing
status: forged
techniques:
  - span-model
  - trace-capture
  - cross-boundary-propagation
  - waterfall-rendering
  - synthetic-and-estimated-traces
  - raw-record-viewers
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

# Tracing & span inspection

A run of work — an agent turn, a pipeline execution, a chained sequence of
model calls and tool invocations — finishes, and someone must answer three
questions from what remains: **what actually happened, where did the time and
money go, and which part failed?** Tracing is the discipline of recording a
run as a **tree of spans** — timed, attributed, parent-linked units of work —
so that those questions are answered by *reading structure*, not by
correlating timestamps across log files in your head.

Tracing is the settled, structural record of a run. Its sibling surface, the
live stream, is what the user watches *while* the run happens — volatile,
lossy, owned by the current attempt
([streaming-output](../streaming-output/streaming-output.md)). The two are
different stores with different guarantees, and the boundary between them is
the run's finalization: the stream shows what is happening; the trace explains
what happened. A product that tries to make one surface do both jobs gets a
transcript that cannot be aggregated or a trace that lies while still moving.

What tracing is *not* also draws its edges:

- **Not logging.** A log line is a fact without a skeleton — it says something
  occurred but not inside what, after what, or costing what. Logs remain the
  floor beneath the trace (the raw record a human drills into when structure
  runs out), never the structure itself.
- **Not metrics.** A metric is an aggregate that has already forgotten which
  run it came from. Traces are the pre-aggregation truth; rollups and
  time-series (the metrics-rollups concern) are *derived from* spans, and the
  derivation must be recomputable, never a second bookkeeping system.
- **Not profiling.** A profiler samples where the machine spends cycles;
  tracing records where the *work* spends time, at the granularity of
  meaningful operations. The perf-instrumentation concern owns frame budgets
  and hot paths; tracing owns the operation tree.

## One span model, every producer, every viewer

The defining structural decision: **there is one span schema, and everything
that produces or renders spans speaks it.** A stage executed in the
interface process, a model call made by the backend, a tool invocation inside
a subagent, a step of a chained run in another process — all of these are the
same species: identity, parent, kind, name, start, end, status, attributes.

The alternative looks harmless for months: the backend records its spans, the
front records its "stages", a chained-run feature invents "steps", and each
viewer renders its own shape. Then someone asks for the one view the whole
discipline exists for — *the run, end to end, as one waterfall* — and the
shapes cannot be joined. Timelines misalign, statuses don't map, one side has
costs and the other has phases, and the unified view is rebuilt as a lossy
adapter that must be revised every time either side moves. **If a frontend
stage and a backend span are not the same species, the waterfall lies** —
or more often, is never built. The [span-model](techniques/span-model.md)
technique owns the schema, the closed kind and status vocabularies, and the
attribute discipline.

## Structure is the truth; attributes decorate

A span's **identity and parentage are the structural facts** of the trace:
which operation this was, and inside which operation it ran. Everything else —
name, kind, cost, payload references — decorates that skeleton. The
distinction has teeth:

- **Parentage explains; attributes describe.** "This retrieval ran inside
  that tool call, which ran inside turn three" is an explanation a reader can
  navigate. A flat list of richly-attributed spans with no reliable parent
  links is a log with extra fields.
- **Identity must survive everything the run does** — retries, reordering,
  resumption, cross-process handoffs
  ([identity-survives-reuse](../_laws.md#identity-survives-reuse)). A span
  identified by its position, its timestamp, or its name is a span that will
  be mis-parented the first time two similar operations overlap.
- **The tree is built from references, not from nesting-by-arrival.** A child
  names its parent by identity; the tree is assembled at read time from those
  references. Inferring parentage from timing ("it started while X was open,
  so it's inside X") fabricates structure exactly when the trace is
  interesting — under concurrency.

When work crosses a process, language, or run boundary, the identities must
cross with it, explicitly, in the handoff envelope — or the trace fractures
into per-process fragments that no viewer can rejoin. The
[cross-boundary-propagation](techniques/cross-boundary-propagation.md)
technique owns id travel, chained-run continuation, and clock skew.

## Attribution lives on spans, so aggregation is a fold

Latency, token counts, monetary cost, retry counts — the quantities everyone
eventually wants rolled up — are recorded **on the span that incurred them**,
at the moment they are known. This is the design choice that makes every
downstream question cheap:

- "What did this run cost?" — fold the tree, summing span costs.
- "Which subtree was slow?" — compare each span's duration to its children's;
  the difference is its own work.
- "What do tool calls of this kind cost per day?" — filter spans by kind,
  fold.

The alternative stores costs in a separate ledger keyed by run, tokens in the
producer's own accounting, and durations only in the spans — and every
question becomes a **join** across stores with different identities, different
retention, and different failure modes. Joins drift; folds cannot. Where a
rolled-up figure *is* stored (a per-run total, a dashboard series), it is a
cached derivation and names its recomputation — the fold over spans that
regenerates it
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)).
Failure attribution follows the same rule: a span's terminal status comes from
the failure vocabulary the rest of the product uses
([error-handling](../error-handling/error-handling.md)), so "which category of
failure dominates this pipeline" is also a fold, not a reclassification.

## Capture is bounded, and the bounds are honest

A trace records an unbounded process into a bounded store, so the bounds are
part of the contract, not an afterthought:

- **A span ceiling per trace.** A run gone pathological — a loop retrying
  forever, an agent fanning out without limit — must saturate its trace, not
  the storage or the viewer. When the ceiling is hit, the trace says so:
  a marker span or a truncation flag with the count of what was dropped,
  never a silently complete-looking tree.
- **Attribute and payload budgets per span.** Large payloads live in the raw
  record store and are *referenced* from spans, not embedded; a span is a
  skeleton entry, not a container.
- **Sampling, when volume demands it, is recorded on the trace.** A sampled
  trace states its sampling decision so every count derived from it carries
  its predicate — "N traces, sampled at rate R" is a measurement; a bare N
  scaled by an unstated rate is a lie waiting for a dashboard
  ([count-carries-predicate](../_laws.md#count-carries-predicate)).
- **A run that produced no trace is distinguishable from a run traced as
  doing nothing** — capture failure spelled differently from empty success
  ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).

The [trace-capture](techniques/trace-capture.md) technique owns ceilings,
buffering, flush timing, orphaned spans, and retention.

## Estimated data never masquerades as measurement

Products acquire tracing after they acquire history. Runs that predate
instrumentation, producers that report totals but not timings, boundaries that
strip detail — all of these tempt the same move: *reconstruct* a plausible
trace from what survived. Reconstruction is legitimate and often the only way
to give old runs a structural view. What is never legitimate is letting the
reconstruction render indistinguishably from measurement. Every synthetic
span, every estimated duration, every apportioned cost is **labeled as an
estimate at the datum level** — on the span, in the tooltip, in the export —
and estimated values never fold silently into aggregates alongside measured
ones. The
[synthetic-and-estimated-traces](techniques/synthetic-and-estimated-traces.md)
technique owns reconstruction rules and labeling.

## Reading a trace: the waterfall above, the raw record below

The span tree earns its keep at read time, and the reading surface has two
floors:

**The waterfall** is the structural view: one shared time axis, spans as bars
positioned by start and sized by duration, nesting shown by indentation in
structural order, status visible at a glance. Its single purpose is to let a
human **find the long pole and the failure without reading anything** — the
eye follows the widest bar and the failure color, then drills in. Layout,
collapse of subtrees, self-time versus child-time, and honest rendering of
still-open or truncated spans are owned by
[waterfall-rendering](techniques/waterfall-rendering.md).

**The raw record viewers** are the floor beneath it: when the structure has
localized the problem to one span, the human needs that span's actual
payloads — the request, the response, the log lines, the terminal output —
rendered legibly: highlighted, classified, searchable, and bounded. A trace
viewer without this floor strands the investigation at "something in here was
slow"; a raw viewer without the waterfall above it is the log-correlation
purgatory tracing exists to end. The
[raw-record-viewers](techniques/raw-record-viewers.md) technique owns this
layer.

## The lifecycle of a trace

| Phase | What exists | What the viewer shows |
| --- | --- | --- |
| **live** | root span open, children opening and closing | a growing tree; open spans render open-ended, never as zero-width |
| **finalizing** | terminal signal received; open spans being closed with an abnormal-end status | the tree freezing; nothing silently completes |
| **settled** | every span closed, rollups derivable | the durable waterfall; aggregates now safe to fold |
| **aged** | retention policy applied | either the full trace, or a summary that states what was shed |

Two rules fall out. **Finalization closes every span it finds open** — a
process that dies mid-run must not leave spans that read as "still running"
forever, nor may finalization stamp them "completed"; interrupted is its own
status. And **retention names its reaper** at creation: traces are the
highest-volume structured data most products ever store, and an unbounded
trace table is the storage incident scheduled at integration time
([creation-names-reaper](../_laws.md#creation-names-reaper)).

## The techniques

- [span-model](techniques/span-model.md) — the one schema: identity,
  parentage by reference, closed kind and status vocabularies, attribute
  discipline, measured quantities on the span.
- [trace-capture](techniques/trace-capture.md) — what opens a span, capture
  cost, buffering and flush, span ceilings, sampling honesty, orphan closure,
  retention.
- [cross-boundary-propagation](techniques/cross-boundary-propagation.md) —
  trace and parent identities across process, language, and chained-run
  boundaries; continuation versus new-trace-with-link; clock skew.
- [waterfall-rendering](techniques/waterfall-rendering.md) — the shared time
  axis, structural ordering, long-pole legibility, drill-down, honest
  rendering of open and truncated spans.
- [synthetic-and-estimated-traces](techniques/synthetic-and-estimated-traces.md)
  — reconstructing structure for uninstrumented history; estimate labeling at
  the datum level; keeping estimates out of measured aggregates.
- [raw-record-viewers](techniques/raw-record-viewers.md) — the payload floor:
  structured-data, log, and terminal viewers; highlighting as classification;
  bounded rendering with honest truncation.
