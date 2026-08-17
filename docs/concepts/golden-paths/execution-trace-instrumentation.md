# Golden path — Execution trace instrumentation

> Situation node: `backend-runtime/backend-observability/execution-trace-instrumentation` ·
> [situation spine](../situation-spine.md) · recurrence **21** · risk **low** ·
> `sides: server` but **`twoSided: true`, `fusedAcrossSides: true`** — the spine carries an explicit
> `clientHalf` and `serverHalf`, so this document has both (§12 correction 1).
> Dimensions: **performance · cost · ui**.
> Spine's own framing: *"Making a new phase of work attributable in the execution inspector."*
>
> Composed 2026-08-17 against `master` @ `f432a4ef3`.
>
> **Sweep.** Source: `core/src/trace.rs` (572 lines, in full), `db/src/repos/execution/traces.rs`
> (303 lines, in full), every `start_span` / `end_span` call site in the tree (**31**, all in one
> file), `src/engine/runner/mod.rs`'s trace lane, `engine/src/parser.rs`'s `result`-line branch,
> `db/src/repos/execution/executions.rs`, and the whole client inspector
> (`sub_executions/detail/inspector/`, 13 files / 1,384 lines) plus `PipelineDots.tsx` and
> `lib/execution/pipeline.ts`. Corpus counts (963 `.rs`, 4,828 `.ts`) cite
> [`shared-facts.json`](../shared-facts.json).
>
> **Measured by executing, not by reading — three independent instruments:**
>
> 1. **A read-only copy of the live `personas.db`** (347,054,080 bytes, copied 2026-08-17 00:20 with
>    its `-wal` (0 bytes) and `-shm`; opened `readOnly: true`; the live file was never opened for
>    write). **All 2,942 `execution_traces` rows were parsed and all 90,813 spans classified** —
>    parent integrity, per-type population, per-field population, tree shape, and time overlap.
> 2. **One real execution was reconstructed end to end** from the store, as the brief asked. Result
>    in §0. It is the best half of this document and the worst.
> 3. **The operator's own 2,991 `ExecutionLogger` transcripts were read** (`%APPDATA%/…/logs/`), and
>    **314 real Claude-CLI `result` lines** parsed out of a deterministic 333-file spread sample —
>    because the question "does the producer emit the field the parser reads?" cannot be answered
>    from source. It does not. §0.2.
>
> **No `cargo` command and no build of any kind was run.** No execution was started. Every Rust claim
> is static and traces to a file opened during composition. **No secret value appears in this
> document**; the transcript scan reports key *names* and integer counts only.
>
> The **Deviations** section is a fix backlog. **Nothing in it was applied** — per the
> [runbook](../golden-path-runbook.md), the operator uses this app daily.

---

## 0 The headline: the tree is perfect, the numbers on it are zero, and the runs you most need to explain leave nothing

Three findings, in the order the measurement produced them.

### 0.1 Reconstruction succeeded — structurally, this is one of the best instruments in the repo

I picked one real failed run (`6a74ab4c-edc1-472f-a184-f7c94cf4c247`, 2026-06-26, `T: Code Reviewer`,
15-minute timeout) and rebuilt its waterfall from `execution_traces.spans`. It rebuilt **completely**:

```
[execution]        Execution                    0→900265 (900265ms)  ERR=Execution timed out after 900s
  [pipeline_stage] Pipeline: Validate           0→9      (9ms)
  [credential_res] Credential Resolution        1→9      (8ms)      md={"tool_count":2}
  [pipeline_stage] Pipeline: Spawn Engine       9→151    (142ms)
  [prompt_assembly]Prompt Assembly              9→140    (131ms)    md={"is_resume":false}
  [cli_spawn]      CLI Spawn: Claude Code CLI   151→151  (0ms)      md={"prompt_length":71549}
  [pipeline_stage] Pipeline: Stream Output      151→900161          ERR=Stream timed out
  [stream_proc]    Stream Processing            151→900161          ERR=Stream timed out
    [tool_call]    ToolCall: Bash               13134→24740 (11606ms)  md={"step_index":1}
    …50 more, step_index 2…51, one 120-second Bash at 612013→732106…
    [tool_call]    ToolCall: Bash               858861→900265         ERR=span not properly closed
  [pipeline_stage] Pipeline: Finalize Status    900161→900265 (104ms) ERR=Execution timed out after 900s
```

This is not a partial success. Across **all 90,813 spans in 2,942 traces**:

| structural property | measured |
| --- | ---: |
| spans whose `parent_span_id` names a span not in the same trace | **0** |
| spans that are their own parent | **0** |
| traces with exactly one root | **2,942 / 2,942** |
| spans with a negative duration | **0** |
| rows whose `spans` JSON failed to parse | **0** |
| traces where `evicted_span_count > 0` (silently truncated) | **0** |
| tool-call counts agreeing across `spans` / `tool_steps` / `persona_tool_usage` | **1,919 / 1,919** where all three exist — **zero disagreements** |

**Say this first, because the rest of the document is deviations:** the span tree is well-formed, the
force-close marker works (88 spans across 66 traces carry `"span not properly closed"`, which is how
I know the run above died mid-Bash), error state propagates correctly up three levels, and three
independent step stores agree exactly. **The construction is right. What is written onto it is not.**

### 0.2 Every token count in this app is zero, and the cause is one field name

| | measured |
| --- | ---: |
| spans (of 90,813) carrying any `input_tokens` or `output_tokens` value | **0** |
| child spans (of 87,871) carrying any `cost_usd` value | **0** |
| root spans (of 2,942) whose `input_tokens` is `Some(0)` | **2,942 / 2,942** |
| `persona_executions` rows (of 2,188) with `input_tokens = 0 AND output_tokens = 0` | **2,188 / 2,188** |
| …of which `status='completed'` | **1,928** |
| `SUM(cache_read_tokens)` over the same 2,188 rows | **648,406,049** |
| `SUM(cache_creation_tokens)` | **26,029,682** |
| `SUM(cost_usd)` | **$2,036.26** |

674 million tokens moved and $2,036 was spent by runs that all record zero input and zero output
tokens. The cause is two adjacent lines:

```rust
// engine/src/parser.rs:340-341  — the "result" branch
let total_input_tokens  = value.get("total_input_tokens").and_then(|t| t.as_u64());
let total_output_tokens = value.get("total_output_tokens").and_then(|t| t.as_u64());
// engine/src/parser.rs:347-350  — six lines below
let cache_read_input_tokens = usage
    .and_then(|u| u.get("cache_read_input_tokens"))
    .or_else(|| value.get("cache_read_input_tokens"))
    .and_then(serde_json::Value::as_u64);
```

**Measured against 314 real `result` lines in the operator's own transcripts:**

| field the parser reads | present in real CLI output |
| --- | ---: |
| top-level `total_input_tokens` | **0 / 314** |
| top-level `total_output_tokens` | **0 / 314** |
| top-level `model` (`parser.rs:371`) | **0 / 314** |
| `usage.input_tokens` | **314 / 314** (positive in **312**) |
| `usage.output_tokens` | **314 / 314** (positive in **312**) |
| `usage.cache_read_input_tokens` | **314 / 314** |

Two field reads, six lines apart, in one function, against one JSON object. The two that consult
`usage` first are populated at 648M and 26M. The two that only look at the top level have returned
`None` on every run this machine has ever executed, and `None` becomes `0`, and `0` is written into
the trace as `Some(0)` — a *definite measurement of nothing*, not a missing one.

**The blast radius is the whole client half.** `TraceSummary.tsx:24-25,61` renders a Tokens tile from
`rootSpan.input_tokens + rootSpan.output_tokens`, unconditionally, with no `> 0` guard — so the
execution inspector has displayed **`0` tokens for every run in the app's history**. `TraceSummary.tsx:90`
gates the cost-decomposition panel on `totalInput + totalOutput > 0`, so **`CostBreakdownBar` (91
lines, 8 UI strings translated into all 14 locales = 112 strings) has rendered 0 times in 2,942
executions.** `InspectorStatStrip` (`inspectorShared.tsx:40-41`) prints `"0"` in its Input-tokens and
Output-tokens tiles for the same reason, and computes its cache-hit percentage against a denominator
(`execution.input_tokens + cacheRead + cacheCreation`) whose first term is always 0.

**And the parser's own unit test is green.** `parser.rs:1105` feeds a fixture line carrying
`"total_input_tokens":1500,"total_output_tokens":800` — a shape the producer does not emit. Fixture
and parser were written together from the same wrong assumption, so the test asserts the code against
its own belief. This is [`client-rule-mirroring`](./client-rule-mirroring.md)'s finding in a new
costume: *a test that lives beside the thing it tests, and supplies its own input, is a third copy of
the assumption.* `CostBreakdownBar.test.tsx` is the same shape one layer up — it passes tokens the
producer cannot produce, and passes.

### 0.3 Trace coverage is inversely correlated with the need for a trace

| execution status | rows | with a trace | coverage |
| --- | ---: | ---: | ---: |
| `completed` | 1,928 | 1,928 | **100 %** |
| `cancelled` | 2 | 2 | 100 % |
| `failed` | 238 | 132 | **55.5 %** |
| `incomplete` | 20 | 0 | **0 %** |

And where a failed run *is* traced it is traced at half resolution: **31.5 spans on average for a
completed run, 15.6 for a failed one.**

The 126 untraced runs are not random. Grouped by their own `error_message`:

| what ended the run | count | who wrote the status |
| --- | ---: | --- |
| `App restarted while execution was running` | **74** | a boot-time reaper |
| `Internal error (panic): state() called before manage() …` | **20** | the panic hook |
| `Engine safety ceiling exceeded (20m). Execution forcibly terminated.` | **12** | an external killer |
| `Execution stalled: running since … (>30 min) — marked as zombie` | **20** | the zombie sweep |

**Every one of the 126 ended by a route the runner's own control flow does not pass through**, and
the trace exists only as `Mutex<SpanStore>` inside `TraceCollector` until `finalize()` drains it
(`core/src/trace.rs:443`) and `traces::save` writes it (`runner/mod.rs:2914`). One write, at the end,
from RAM. **A run that dies is a run whose trace dies with it — and dying is the case the trace was
built for.** This is [`stall-watchdog`](./stall-watchdog.md)'s P2 (*"in-process counters answer 'since
when?' with 'since the last restart'"*) arriving at a different table by the same road.

### 0.4 Three smaller results that each answer a question the brief asked

- **The correlation id is not one id.** A run carries `persona_executions.id` (UUID),
  `execution_traces.trace_id` (a *different* UUID, minted at `trace.rs:216`),
  `persona_executions.traceparent` (a W3C 128-bit hex trace id, minted at `trace.rs:493`, present on
  **2,168** rows), `claude_session_id` (the CLI's own, **2,162** rows), and `chain_trace_id`. **No
  column anywhere stores the join between `trace_id` and the traceparent's trace id**, and nothing in
  the repo reads a traceparent back — `trace.rs:471-473` says so in writing: *"We do NOT emit OTLP
  spans here — there is no collector wired up yet."* This is the brief's primed `fleet_decisions`
  hazard (10 of 46 rows with an empty `session_id`, 7 of 25 holding a Claude id in a Fleet-id column)
  reproduced structurally rather than by accident: **five namespaces, one run, zero joins.**
- **880 of 2,942 trace rows (29.9 %) name an `execution_id` that no longer exists.** Also 980 orphan
  `persona_tool_usage` rows (370 executions) and 583 orphan `execution_knowledge.last_execution_id`
  values of 2,343. **And the foreign key made no difference:** `execution_traces.execution_id` is a
  bare `TEXT NOT NULL` with no `REFERENCES` at all, while `persona_tool_usage.execution_id` *does*
  carry `REFERENCES persona_executions(id) ON DELETE CASCADE` — and both orphaned. Cause is upstream
  (a `foreign_keys = OFF` table rebuild, `incremental.rs:448-459`) and belongs to
  [`destructive-schema-change`](./destructive-schema-change.md); the *consequence* is this leaf's:
  **~30 % of the trace store is a recording of a run nobody can name.**
- **`chain_trace_id` has never grouped two executions.** Three distinct values live, one row each.
  The whole distributed-chain apparatus — `get_by_chain_trace_id`, `set_chain_trace_id`'s back-fill,
  `count_by_chain_trace_id`'s fan-out breadth guard, four unit tests, a Chain tab — has produced
  three chains of length one.

### Sibling boundaries, settled in prose

[**structured-logging**](./structured-logging.md) owns *what one log record is made of and whether it
is safe to keep*. **This path owns the record that makes one RUN reconstructable** — a different
artifact with a different lifetime. They meet at `ExecutionLogger`: that path's P0 (406 MB of
unpruned per-execution transcripts holding live credentials) is the *raw* half of this leaf's
question, and its Gap 8 — *"Nothing joins a log line to the execution that caused it"* — is answered
here from the other side: **595 of 2,074 `log_file_path` values point into `%TEMP%\personas\logs`,
and 0 of those 595 files exist** (§7 D6). The trace's pointer to the transcript is dead for 28.7 % of
runs.

[**stall-watchdog**](./stall-watchdog.md) owns *whether a repeating producer produced anything*.
**This path owns whether ONE unit of work can be replayed.** Its `outcomeless-tick` rule keys on
`fn tick(` definitions; nothing here touches those. Its P2 and this leaf's §0.3 are the same physics
at two scales: an instrument that lives in process memory cannot describe the event that ended the
process.

[**query-latency-instrumentation**](./query-latency-instrumentation.md) owns *how long one query
took*. This path owns *how long one phase of one run took*, and consumes its `timed_query!` wrapper
— all five `traces::` repo functions are wrapped, correctly.

[**llm-spend-accounting**](./llm-spend-accounting.md) and
[**number-and-cost-formatting**](./number-and-cost-formatting.md) own what a cost figure *means* and
how it is rendered. **This path owns whether the cost can be attributed to the step that incurred
it** — measured at 0 of 87,871 child spans.

[**domain-event-publication**](./domain-event-publication.md) owns whether an event was published.
**This path owns whether the events of one run form a narrative.** Its finding that `persona_events`
had 0 rows of any status between 2026-06-27 and 2026-07-31 is the same silence this leaf's
`execution_traces` shows (newest row `2026-06-26T16:36:54`): the instrument stopped when the thing it
measures stopped, and neither could say so.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file path, primitive
name or count, so an adopting repo can tell physics from local calibration. Each clause names its
warrant.

> **P1 — the whole subject, and an OPEN problem: 0 of 6 repos has solved it.** *A run's trace must be
> durable at the moment each phase ENDS, not at the moment the run ends.* An artifact assembled in
> process memory and written once, at completion, has coverage conditioned on the run finishing the
> way the writer expects — so it is systematically absent for crashes, restarts, external kills and
> reaper-declared deaths, which are exactly the runs a human opens the trace to understand. *Warrant:
> the fleet agrees on the omission, not on an answer — `brainiac` alone writes a run row on failure
> and says why (§6 clause 7); `ascent` deliberately writes nothing for a degraded run. Adopt this
> clause on its logic, not on anyone's precedent.*
>
> **P2 — physics, 3 independent instances.** *A metric that was never measured and a metric that
> measured zero must not be the same value, and a field read out of another program's output must be
> asserted at least once.* The collapse happens once, at the write, and is irreversible for the life
> of the record. *Warrant: three codebases in three languages aim a field read at a position the
> producer does not use, and in every case the miss is absorbed into a confident zero rather than
> raised (§6 clause 4) — including one that reads the SAME external tool correctly 150 lines away.*
>
> **P3 — physics as a defect, 0 of 6.** *Attribute cost and consumption to the phase that incurred
> them, not to the run.* A total on the root answers "what did this cost"; it can never answer "what
> was expensive", which is the only question that changes anyone's behaviour. *Warrant: nobody in the
> family does it, and one sibling declares the per-stage attribution key in a doc comment and passes
> `None` at its only call site (§6 clause 2).*
>
> **P4 — physics, 5 of 5 siblings comply and this repo does not.** *A phase's name is a constant,
> chosen by a person.* A label computed from a value's reflection, debug rendering, or ordinal
> position is not a name: it cannot be searched, cannot be aggregated, cannot survive a reordering of
> the type it was derived from, and is unreadable at the exact moment someone needs to read it.
> *Warrant: every sibling uses literals or an enum; `Protocol: {:?}` on a discriminant is unique to
> Personas and is 17.2 % of its spans.*
>
> **P5 — physics as a defect, 0 of 6.** *One run gets one correlation identity; a second identity is
> only permissible if the join between them is itself recorded.* An id minted in a second namespace
> and never joined is not correlation — it is a second, unreachable story about the same run.
> *Warrant: 4 to 8 namespaces per run across the family, joins unconstrained or absent everywhere.*
>
> **P6 — physics as a defect, 0 of 6, and the obvious fix is measurably not the fix.** *A record whose
> only purpose is to explain a parent must not outlive the parent unattributed.* An unattributable
> trace is indistinguishable from no trace, and worse, because it inflates every count taken over the
> store. *Warrant: the one sibling with an enforced cascade declares its run-child FKs with no
> `ON DELETE`, so they block instead of cascading; in this repo the table WITH the cascade orphaned
> 980 rows anyway (§6 clause 6, §7 D5).*
>
> **P7 — house defect, flagged, 0 sibling instances either way.** *Close a phase by the handle its
> start returned.* Closing "the most recent open one" is a stack discipline imposed on a stream that
> is not a stack, and it silently swaps durations between phases rather than failing. *Warrant: no
> sibling has nested phases at all, so nobody else can have this bug; adopt on logic.*
>
> **P8 — physics, 2 independent instances, and it is not optional.** *Every field the trace declares
> must have a producer before it has a renderer.* A field that only a schema and a UI believe in makes
> the surface confidently wrong, which is worse than a surface that admits it does not know.
> *Warrant: a sibling renders a "Tokens" KPI tile summing two columns its own orchestrator never
> writes — the same tile, the same zero, a different database and a different language.*
>
> **P9 — physics, and the one answer worth importing: 2 of 4 independent repos reinvented it.**
> *When a trace is truncated, capped, degraded or sampled, the truncation must survive into the
> artifact as a named caveat.* A reloaded trace that has forgotten it was partial reads as a confident
> complete one. *Warrant: `ascent` persists named caveats as `warningsJson` with the reason written
> into its schema; Personas persists `evicted_span_count` and surfaces it. The two repos that capped
> without recording cannot tell a short run from a truncated one.*
>
> **P10 — house convention, flagged.** *Prefer one representation of a run's steps.* This repo has
> seven; the cost so far is duplication rather than disagreement (they agree 1,919 / 1,919), so this
> is calibration, not physics — but each new one is another thing that can drift, and two of the
> seven already do.

---

## 1 Trigger

- "I need to see where the time went in this run."
- "Add a span / a step / a stage for this new phase of work."
- "Why did this execution take 15 minutes?" / "which tool call was slow?"
- "What did this run cost, and which part of it cost that?"
- "This run failed — what was it doing when it died?"
- "Can we correlate our trace with the CLI's / the provider's?"
- "The inspector shows nothing for this execution."

If you are about to type `start_span(`, `end_span(`, a new `SpanType` variant, `TraceCollector`,
`Instant::now()` inside a runner, a `step_index`, a `*_ms` field on a record that gets serialized, a
`format!` that produces a label a human will read in a timeline, or a `chain_trace_id` — you are in
this situation.

**Not this path:** *whether a periodic loop produced anything* is
[stall-watchdog](./stall-watchdog.md); *what a single log line is made of* is
[structured-logging](./structured-logging.md); *how long one SQL statement took* is
[query-latency-instrumentation](./query-latency-instrumentation.md); *whether a caught error reaches
a door* is [swallowed-error-telemetry](./swallowed-error-telemetry.md); *what a cost figure means* is
[llm-spend-accounting](./llm-spend-accounting.md).

## 2 The one way

**Give every phase of a run a constant name and a handle, close it by that handle, and persist it
when it closes — then render the tree from what was persisted, never from what a field promises.**
Concretely: (a) name the phase with a **literal or an enum variant**, never a formatted value, and if
the phase has an instance (which tool, which credential) put the instance in a metadata field beside
the name, not inside it. (b) `start_span` returns a handle; **close that handle**, never "the most
recent open span", because the stream you are instrumenting interleaves. (c) **Write the span down
when it ends**, not when the run ends — a row per span, or an append to a per-run file, so a process
that dies mid-run still leaves everything up to the death. The in-memory tree stays as a live-render
cache; it stops being the only copy. (d) **Attribute cost and tokens at the phase that incurred
them**, and if you genuinely only have a run-level total, put it on the root and leave the children
`None` — but then do not build a UI that decomposes what you did not measure. (e) **Never write a
zero for a value you did not observe.** `Option::None` is the measurement "I did not find out";
`Some(0)` is the measurement "it was zero", and the difference is the entire content of a
post-mortem. When you pull a number out of another program's output, the absence of the field is a
result — record it, at least once, at `warn!`. (f) **One identity per run.** If a second correlation
id must exist (a protocol requires it, an external collector expects it), store it in the same row as
the first so the join is a column and not a guess — and if nothing consumes it yet, say so where it
is minted. (g) **Key the trace to its run with a constraint the store enforces**, and if the store
cannot enforce it, own the reconciliation explicitly rather than discovering orphans years later.
(h) **Then stop.** Do not add an eighth representation of the same step list; extend the one that is
already durable.

If you must get one right first: **(c)**. Everything in §0.3 is downstream of it, and (a), (b), (d)
and (e) are all recoverable by a later backfill in a way that a trace which was never written is not.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `core/src/trace.rs:144` `TraceCollector` + `:269` `start_span` + `:351` `end_span` | **the one site to copy for tree construction.** Monotonic `Instant` epoch so every `start_ms` is relative and comparable; UUID span ids; `parent_span_id` defaulting to the root so a forgotten parent still lands in the tree rather than orphaning (`:302`); a `SpanStore` with an `O(1)` id→index map (`:156-211`) instead of a linear scan. Measured over 90,813 live spans: **0 dangling parents, 0 self-parents, one root per trace, every trace.** |
| `core/src/trace.rs:401-417` — the orphan force-close | The best single decision in this file. At `finalize`, any span still open is closed with `error: "span not properly closed"` and counted into a `warn!`. **88 live spans across 66 traces carry it**, and it is how a reader can tell "this phase never finished" from "this phase was fast". Copy this, verbatim, into any accumulator. |
| `core/src/trace.rs:284-298` — the Sentry breadcrumb at `PipelineStage` boundaries | A deliberately *gated* breadcrumb: pipeline stages only, so the shared bounded breadcrumb buffer ([structured-logging](./structured-logging.md) §2) is not flooded by 15,603 protocol spans. The comment at `:281-283` states the reasoning. This is the correct posture and the reasoning is written down. |
| `core/src/trace.rs:319-343` + `:429-436` — bounded accumulation with a **recorded** truncation | `MAX_SPANS = 10_000`, eviction, and — the part most implementations skip — `evicted_span_count` is **persisted on the trace row** and surfaced in the UI (`TraceSummary.tsx:101-111`) as *"this trace is incomplete"*. A truncation that the artifact admits to. Live: 0 traces truncated, so this is untested in production but correctly shaped. |
| `db/src/repos/execution/traces.rs:8-33` `save` + `:36-73` `get_by_execution_id` | The persistence pair. All five functions in the file go through `timed_query!`, satisfying [query-latency-instrumentation](./query-latency-instrumentation.md). `get_by_execution_id` orders `created_at DESC LIMIT 1`, so a re-run's trace supersedes rather than duplicating. |
| `src/features/agents/sub_executions/detail/inspector/traceInspectorTypes.ts:112-129` `applySpanEvent` | **The client half's one site to copy.** Pure, idempotent on `span_id`, and its docstring states the rule that matters: an `end` for a span whose `start` was never seen still materialises the span, *"dropping it would lose a leaf whose start event was missed."* An event stream that is allowed to lose events, handled as such. |
| `useTraceData.ts:62-106` — the fetch-window buffer | Opening a *running* execution races the initial fetch against the live event stream. Span events arriving during the fetch are buffered (`pendingSpanEventsRef`), then replayed onto the fetched trace exactly once. The comment names the bug it fixes. This is the correct answer to a real race and the same shape as `createSingletonListener`'s early-buffer. |
| `traceInspectorTypes.ts:25-77` `buildParentIndex` + `computeVisibleNodes` | Collapse/expand derived in `O(n)` amortised with a memoised ancestor-chain walk **and a cycle guard** (`:68`), deliberately decoupled from the tree build (`useTraceData.ts:178-181`) so expanding a node does not rebuild 10,000 spans. |
| `db/src/repos/execution/traces.rs:145-159` `count_by_chain_trace_id` | Read its doc comment (`:135-144`) before touching chain fan-out: it explains *why* traces are counted rather than events (the chain id lives in unindexed payload JSON on the event) and that the count under-reports by design, so the guard trips late rather than falsely. That is how a deliberate imprecision should be documented. |

**Do not exist — and this is the leaf's structural finding:**

- **There is no per-span durable write.** `traces::save` is called 4 times, all with a whole finished
  `ExecutionTrace`. There is no `save_span`, no `execution_spans` table, no append. §0.3 is entirely
  downstream of this.
- **There is no join between a run's identities.** No column, no function, no index relates
  `execution_traces.trace_id` to `persona_executions.traceparent` to `claude_session_id`.
- **Nothing reads a `traceparent` back.** It is minted (`trace.rs:493`), persisted
  (`executions.rs:1475`), injected into the child CLI's env (`runner/mod.rs:1602`,
  `prompt/cli_args.rs:78,:275`) and into MCP `tools/call` `_meta` (`mcp_tools.rs:1231`) — and there
  is no reader anywhere in 963 `.rs` and 4,828 `.ts` files.
- **There is no reconciliation for orphaned traces.** No sweep, no `NOT EXISTS` query, no count.

## 4 Steps

1. **Name the phase before you instrument it.** One noun phrase, a constant. If you cannot write it
   without interpolating a value, the value belongs in `metadata`, not in the name.
   `"Credential Resolution"` with `metadata: {"tool_count": 2}` is the shape (`runner/mod.rs:395`).
2. **Add the variant to the span-type enum, and add its producer in the same change.** Three of the
   eleven `SpanType` variants have never been emitted (§7 D3). An enum variant with no producer is a
   promise the UI is forced to keep.
3. **`let id = trace.start_span(TYPE, "Constant Name", Some(parent), metadata)` — and hold `id`.**
   Close it with `end_span(&id, …)`. Never re-find it by scanning.
4. **Decide, at the start-site, whether this phase can carry a metric.** If it can, close it with the
   metric-bearing `end_span(&id, err, cost, in_tok, out_tok)`. If it cannot, `end_span_ok` is
   correct — but then no UI may claim to decompose that metric per phase.
5. **Persist the span when it closes.** Today this step does not exist and cannot be taken; it is the
   gap in §8 and the fix in *Prefer a type over a gate*. Until it lands, treat every trace as
   best-effort and never build a surface that assumes one is present.
6. **When you pull a number out of another program's output, assert you found it.** A `.get("field")`
   that returns `None` for a field that should always be there is a finding, not a default. One
   `warn!` on the miss, once per run, would have made §0.2 a five-minute bug instead of a
   2,188-execution one.
7. **Never write a zero you did not observe.** Pass `None` up the whole chain; let the renderer
   decide how to draw "unknown" (`TraceSummary.tsx:51` already does this correctly for cost — `'-'`
   when the value is zero — two lines above the tokens tile that does not).
8. **If the phase produces a live event, emit both edges or neither.** Eight of the ten span kinds
   emit no live event at all (§7 D7), so a running execution's inspector shows tool calls appearing
   inside an empty frame until the run ends.
9. **Then stop.** Do not add an eighth per-run step store. Do not add a second correlation id without
   a column for the join. Do not add a field to `TraceSpan` before its producer exists.

## 5 Anti-patterns

- **A phase name computed from a value's Debug rendering.** *Failure:* the name is unreadable, unstable
  across a reordering of the type, and unsearchable. **Measured: `runner/mod.rs:2527` is
  `&format!("Protocol: {:?}", std::mem::discriminant(&protocol_msg))`. `std::mem::discriminant`'s
  `Debug` prints `Discriminant(<opaque index>)`. 15,603 spans — 17.2 % of every span in the store —
  are named `Protocol: Discriminant(0)` … `Protocol: Discriminant(9)`, and `SpanRow.tsx:54-56`
  renders `{span.name}` raw, so that is what a human sees.** Three lines below, at `:2545-2556`, the
  same function matches `&protocol_msg` against `ProtocolMessage::EmitEvent`, `::AgentMemory`,
  `::UserMessage` to increment counters. **The real name is in scope, in the same block.**
- **Building the whole artifact in memory and writing it once at the end.** *Failure:* coverage is
  conditioned on the run ending the way you expected. **Measured: 100 % of completed runs traced,
  55.5 % of failed, 0 % of the 20 reaped as `incomplete`.**
- **Collapsing "not measured" into zero at the write.** *Failure:* irreversible, and it makes the
  healthiest-looking value the one that means "no idea". **Measured: `Some(0)` on 2,942 of 2,942
  root spans, and 2,188 of 2,188 execution rows.**
- **Rendering a metric with no guard for "never populated".** *Failure:* the surface is confidently
  wrong rather than honestly empty. **Measured: `TraceSummary.tsx:61` prints `0` tokens for every run
  ever executed; `TraceSummary.tsx:51` prints `'-'` for an unknown cost, ten lines above.** The
  correct pattern is already in the same component.
- **Gating a whole panel on a field nothing populates.** *Failure:* the panel, its tests and its
  translations are all maintained and none of it has ever been seen. **Measured: `CostBreakdownBar`
  renders in 0 of 2,942 traces; 8 strings × 14 locales.**
- **Closing a span by scanning for "the most recent open one".** *Failure:* it silently swaps
  durations between concurrent phases instead of failing. **Measured: `runner/mod.rs:2484-2488` does
  `store.vec.iter().rev().find(|s| s.span_type == ToolCall && s.end_ms.is_none())`. 2,882 pairs of
  consecutive tool spans overlap in time, across 868 of 2,942 traces (29.5 %), and all 88
  force-closed spans in the corpus are `tool_call`.**
- **A span whose start and end are adjacent statements.** *Failure:* it measures the instrumentation,
  not the work. **Measured: `CLI Spawn` (`runner/mod.rs:1890` → `:1900`) reads `0 ms` in 2,920 of
  2,942 traces; the actual spawn cost sits in its parent `Pipeline: Spawn Engine`.**
- **A correlation id with no reader.** *Failure:* the cost is paid (a column, a migration, an env
  injection at three call sites, three unit tests) and the benefit requires a collector that does not
  exist. **Measured: `traceparent` on 2,168 rows, 0 readers.** `trace.rs:471-473` is honest about it;
  the honesty does not make the column useful.
- **A child record keyed to a parent by a bare id.** *Failure:* it outlives the parent and inflates
  every count over the store. **Measured: 880 of 2,942 (29.9 %) — and note that adding the
  `REFERENCES … ON DELETE CASCADE` would not have saved it, because `persona_tool_usage` has one and
  orphaned 980 rows anyway.**
- **A live-only surface that admits it is live-only.** `SubagentTree.tsx:23-24`: *"Live-only:
  subagent events aren't persisted yet, so a completed execution viewed post-hoc shows nothing."*
  Honest, and still means the internal structure of all **41 `ToolCall: Agent` fan-outs** in the
  corpus is gone forever.
- **A parser fixture that supplies the field the producer omits.** *Failure:* the test proves the
  parser matches its author's belief. `parser.rs:1105` and `CostBreakdownBar.test.tsx` both do this,
  and both pass.

## 6 Evidence

**The one site to copy: `core/src/trace.rs:388-448` — `TraceCollector::finalize`.** Read it as four
decisions:

1. **It closes what the run left open, and marks it as such** (`:401-417`) rather than dropping it or
   silently stamping a duration. The marker string is what makes an interrupted run legible.
2. **It counts what it dropped and puts the count in the artifact** (`:429-435` + the
   `evicted_span_count` column), so a truncated trace can say it is truncated. Most bounded buffers
   in this repo cannot.
3. **It drains rather than clones** (`:443`), with the reason in the doc comment — a 10,000-span deep
   copy at the end of every run is a real cost.
4. **It is the only place the root's totals are written** (`:420-427`), which is honest about where
   the numbers come from — and is exactly why §7 D2's fix must be upstream of it.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `core/src/trace.rs:302` | `parent_span_id: Some(parent.unwrap_or(&self.root_span_id))` — a forgotten parent lands under the root instead of orphaning. **0 dangling parents in 90,813 live spans.** |
| `core/src/trace.rs:281-298` | a breadcrumb emitted at *one* span type, with the flood it avoids named in the comment |
| `core/src/trace.rs:366-374` | `end_span` writes a metric only `if ….is_some()`, so a later close cannot erase an earlier measurement |
| `db/src/repos/execution/traces.rs:75-96` `set_chain_trace_id` | a back-fill whose doc comment explains the ordering problem that made it necessary (the root cannot know its own chain id at spawn time) and asserts idempotency |
| `traceInspectorTypes.ts:112-129` | the idempotent event-fold, with the "an `end` without a `start` still materialises" rule stated |
| `useTraceData.ts:55-62,:69-93` | the fetch-window buffer, and a comment naming the exact symptom it cures |
| `TraceSummary.tsx:85-89` | **the honesty note.** *"The tracer only ever attributes cost to the root span … so the finest decomposition this trace can honestly support is input vs output — apportioned from the SAME total shown in the Cost tile above, never recomputed."* A component that documents the limit of its own data. It is directly above the gate that stops it rendering. |
| `CostBreakdownBar.tsx:30-38` | *"we show the total alone rather than a fabricated 50/50 bar (the previous default), which asserted a decomposition nobody measured"* — a refusal to invent a split, written down |

### What this sweep CLEARED — say it, so nobody re-litigates it

- **The span tree is not the problem.** 0 dangling parents, 0 cycles, 0 multi-root traces, 0 parse
  failures, 0 negative durations, over 90,813 spans.
- **The three step stores do not disagree.** `spans`, `tool_steps` and `persona_tool_usage` agree on
  every tool and every count for all **1,919** executions where all three exist. A composer arriving
  expecting drift between them should stop looking.
- **The repo functions are correctly wrapped.** All 5 in `traces.rs` use `timed_query!`; the
  `chain_trace_id` index (`idx_et_chain`, `incremental.rs:853`) exists and the fan-out guard uses it.
- **The truncation path is correctly designed** even though it has never fired.

### Convergence — 5 sibling repos, all opened, and the `CONVERGED` label fails

Read-only sweep 2026-08-17 of `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened**; nothing below is reported by omission.
Searched for **mechanisms** (`opentelemetry`, `traceparent`, `trace_id`, `startSpan`,
`startTransaction`, `tracing::instrument`, `performance.mark`) **and for names**
(`run_id`, `job_id`, `execution_id`, `steps`, `stage`, `phase`, `timeline`, `waterfall`), plus a
`CREATE TABLE` sweep over every migration set (brainiac 49 SQL files, vibeman 237 TS migrations,
ascent's Prisma schema, cloud's `db.ts`).

**Lineage first, because it changes the denominator.** `personas-cloud` and `personas-web` are **not
two witnesses** — they are one system split across two repos: the root package is literally
`"name": "dac-cloud"`, personas-web imports `PersonaExecution`/`PersonaEvent` from
`@dac-cloud/shared` (`src/lib/types.ts:26-37`) and proxies the orchestrator's own SSE route. Their
agreement on the flat execution row is one data point wearing two coats. **`brainiac` and `ascent`
are independent on this leaf** — both carry ported Personas *methodology* overlays (`tiger/`,
`uat/`), so the vocabulary is shared, but the instrumentation code shares no comment, constant or
error string. **Effective independent sibling count: 4.**

**OTel is absent from all five.** One non-comment hit in the whole family, and it is a detector
reading someone *else's* repo (`ascent/src/lib/analyze/passport.ts:87`). Nobody in this family
instruments with spans except Personas.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **A per-run STEP/SPAN record exists at all** | **PERSONAS IS ALONE — 1 of 6, and the label's direction is backwards** | Every sibling has a flat run **row**, not a tree. `brainiac` `pipeline_runs`: 13 additive counter columns, one INSERT site (`worker.rs:508`). `personas-cloud`: flat row (`db.ts:349-370`); its per-stage state is a **cursor, not a history** — `ExecutionProgress` (`shared/types.ts:205-218`) holds one `stage` + one `stageStartedAt`, overwritten on transition (`parser.ts:323-329`), never written to disk. `vibeman`: three rival designs and `stages_state` / `metrics` / `process_log` all have **zero writers**. `ascent`: relational children (`ScanDimension`) that model rubric dimensions, with **no timestamp field at all**. Personas' span tree is the only one in the family. |
| 2 | **Cost / tokens attributed PER STEP** | **PHYSICS AS A DEFECT — 0 of 6, and one sibling reproduces our exact shape** | **`brainiac` is the finding.** `lighttrack::record`'s `name` parameter is documented at `brainiac-gateway/src/lighttrack.rs:101` as *"the stage/use-case rollup key when reachable"* — it has **one** call site (`providers/mod.rs:143`) and it passes **`None`** at `:147`, for all five provider entry points. The event body (`:151-167`) carries no run id either, so spend can never be joined to `pipeline_runs`. The repo already knows: `.claude/skills/tiger/SKILL.md:71` — *"Cost cannot be attributed per stage today."* `vibeman` has a per-step column that is dead. `personas-cloud` declares `input_tokens`/`output_tokens` on `persona_executions` (`db.ts:360-361`) and **never writes either across 7 `updateExecution` call sites**. **That is D2 and D3 of this document, in Rust and in TypeScript, arrived at independently.** |
| 3 | **A declared instrumentation field is rendered by a UI and populated by nobody** | **PHYSICS — 2 of 4 independent, and the second is *our own* defect in a sibling** | `personas-web/src/app/dashboard/executions/ExecutionDetailModal.tsx:31-32` sums `input_tokens + output_tokens` into a "Tokens" KPI tile rendered at `:72`. In live mode that tile is **structurally always `0`**, because the orchestrator never writes either column; the only nonzero values in the repo are in `mockData.ts`. **This is `TraceSummary.tsx:61` — same tile, same zero, same cause — in a repo with a different database and a different language.** Elevates P8 from ergonomics to physics. |
| 4 | **A consumer reads a field position the producer does not write, and the miss becomes a zero** | **PHYSICS — 3 independent instances, and this is the sweep's strongest result** | **`personas-cloud/packages/worker/src/parser.ts` makes D2's mistake against the same external tool.** It switches on *top-level* `obj.type` for `'content_block_start'` (`:268`), `'tool_use'` (`:289`) and `'tool_result'` (`:295`); `--output-format stream-json` nests those under `message.content[]`. `_toolCallsCompleted` is incremented only at `:296`, so it is **permanently 0**, which freezes `estimatePercent()` (`:334-337`) at its base for every stage. **And `detectPersonaEvents`, 150 lines above in the same file (`:101-103`), reads the nested position correctly** — exactly as our `cache_read_input_tokens` reads `usage` correctly six lines below the two fields that do not. `vibeman` supplies the third: `api/system-status/route.ts:379` runs `SELECT requirement_name, status, elapsed_time FROM conductor_runs` and `:392` averages `elapsed_time` — **neither column appears in any of the nine migrations that build that table**, and the `catch` at `:419` returns `status:'unknown'` with all-zero history, so that panel has always reported "no runs ever" and always will. **Three codebases, three languages: a reader aimed at a shape that does not exist, and in every case the failure is absorbed into a confident zero rather than raised.** |
| 5 | **Step/phase names are constants** | **PHYSICS — 5 of 5 siblings comply; PERSONAS IS THE ONLY REPO THAT DOES NOT** | Every sibling names its phases with literals or an enum (`vibeman`'s `SCAN_STEP_LABELS: Record<ScanEventType, string>` at `ScanProgressTimeline.tsx:29` is the cleanest). **`Protocol: {:?}` on `std::mem::discriminant` is unique to this repo**, and it accounts for 17.2 % of our spans. D1 is **local calibration in the worst sense — a house defect, not a house convention.** |
| 6 | **A child record is deleted with its run** | **PHYSICS AS A DEFECT — 0 of 6 get it right, and the one enforced FK blocks instead of cascading** | `brainiac/migrations/0001_init.sql:59` is `pipeline_run_id uuid,` — bare, sitting one line under a proper `REFERENCES sources(id)` at `:58`; the repo *can* cascade (`0043_retrieval_events.sql:87-89`) and didn't here. `personas-cloud` `db.ts:344/380/410` declare `execution_id TEXT NOT NULL` with no FK while `db.ts:389` on a different table does it correctly. `ascent` sets `relationMode = "prisma"` (`schema.prisma:26`), documented at `:4-5` as *"NO foreign-key constraints emitted"*. **`vibeman` is the only repo with a real enforced cascade** (`117_autonomous_agent.ts:53` + `sqlite.driver.ts:114` `pragma('foreign_keys = ON')`) — and its conductor FKs (`134_conductor_pipeline.ts:56,:82`) declare **no `ON DELETE`**, so under that same pragma they *block* deleting a run. Our D5 is the fleet's condition, and the sweep independently confirms that adding the constraint is not the fix. |
| 7 | **A FAILED run is instrumented as well as a successful one** | **1 of 6, and `brainiac` wrote down why** | `brainiac` is the only repo that writes a run row on failure — `worker.rs:451-467`, with a `summarize_error`, and the atomicity reason stated at `:484-493`. Its one hole is honest and small: an unparseable payload (`:472-477`) has no org to scope to, so no row is written. `personas-cloud`'s `onFailed` (`dispatcher.ts:490-504`) writes status and `completedAt` but **not `durationMs`**, which `onComplete` writes at `:459` — so failures lose their timing, inside a `catch { /* best effort */ }`. **`ascent` is the inverse of Personas and worse:** `api/scan/stream/route.ts:221-237` persists nothing on error, and `:189`'s `willPersist = !degradedToMock && !lowCoverage && !partialPrSlice` means even a run that *completed* is deliberately not written if it degraded. **Personas at 55.5 % / 0 % is mid-fleet, not an outlier — which is the point: nobody has solved this, and it is the leaf's central gap.** |
| 8 | **Truncation survives into the artifact** | **PHYSICS — 2 of 4 independent, and they are the two that got it right** | **`ascent` is the exemplar and the one practice worth importing verbatim.** `src/lib/scan.ts:506-528` pushes *named* caveats (*"its file tree was truncated…"*, *"GitHub returned a truncated page"*), `:529` folds them into `report.warnings`, and they are persisted as `Scan.warningsJson` — with `prisma/schema.prisma:319-322` stating the reason outright: so a reloaded scan *"keeps its reliability disclosure instead of silently reading as a confident full scan."* Personas reinvented the same clause with `evicted_span_count` (persisted, and surfaced at `TraceSummary.tsx:101-111`). `personas-web` and `brainiac` cap without recording; `vibeman` does not cap. **This is the one clause where the fleet supplies a converged ANSWER rather than a converged omission, and Personas is already on the right side of it.** |
| 9 | **One correlation identity per run** | **PHYSICS AS A DEFECT — 4 to 8 namespaces everywhere, joins unconstrained or absent** | `brainiac` 5 joined by one unconstrained column · `personas-cloud` **7**, joined by a bare `execution_id` · `vibeman` **8 across three stores, unjoined** · `ascent` 4, joined by a commit SHA · `personas-web` 5, no join. **Personas' 5 (D9) is mid-fleet.** Nobody has one identity; nobody records the join as a constraint. |
| 10 | **A run-as-tree / waterfall UI exists and is wired** | **PERSONAS IS ALONE — 1 of 6** | `brainiac`'s `getPipelineRuns` (`console/src/lib/api.ts:280`) is fully typed against its OpenAPI schema and has **zero callers in any `.tsx`**. `vibeman`'s `ScanProgressTimeline.tsx` is the best per-run waterfall *component* in the sweep — `TimelineNode{status, startedAt, completedAt}` at `:14-22`, constant labels, `buildDefaultNodes`/`advanceTimeline` — exported from `DecisionPanel/index.ts:11-13` and **imported by nothing**, over a `scan_events` table that is never persisted. `personas-web`'s four timeline features are all driven by `use-pipeline-simulation.ts:33` iterating **static examples**. |

> **The single strongest sibling result is `personas-cloud`'s parser, and it is a refutation of the
> instinct to treat D2 as carelessness.** Two independent teams, two languages, reading the *same*
> external tool's stream, both aimed a field read at a position that tool does not use — and in
> **both** cases the correct read is present elsewhere in the same file, written by the same author.
> The failure is not knowledge. It is that **nothing anywhere asserts a field read succeeded**, so a
> wrong guess and a right one are indistinguishable at every gate either repo owns. That is why §2(e)
> is a clause and not a footnote, and why §9's instrument checks field *population* rather than field
> *presence*.

> **The second strongest is `brainiac`'s `lighttrack::record`, because it is our own defect stated in
> prose.** A parameter documented as *"the stage/use-case rollup key"*, one call site, `None` passed,
> and a `SKILL.md` line that already concedes *"Cost cannot be attributed per stage today."* Compare
> `TraceSpan`'s module docstring (`core/src/trace.rs:5`): *"Each span records start/end time, **cost
> attribution, token counts**, and error info"* — against 0 of 87,871 child spans. **Two repos wrote
> the promise into a doc comment and never built the producer.**

> **One correction offered upward to a sibling, not applied** (per the runbook, sibling findings are
> reported, never edited): `vibeman`'s system-status panel queries two columns that no migration
> creates, and its `catch` converts that into `status:'unknown'` with a zeroed history — so the panel
> has never once shown a real run and cannot.


## 7 Deviations found

Every entry is live on `master` @ `f432a4ef3`, measured against a read-only copy of the operator's
database and his own execution transcripts. **Nothing was applied.**

### D1 — 15,603 spans are named after a discriminant index, and the real name is three lines away

`runner/mod.rs:2527`:

```rust
let dispatch_span = trace.start_span(
    SpanType::ProtocolDispatch,
    &format!("Protocol: {:?}", std::mem::discriminant(&protocol_msg)),
    Some(&stream_span),
    None,                       // ← and no metadata to recover the type from
);
```

`std::mem::discriminant` returns an opaque handle whose `Debug` is `Discriminant(<index>)`. Live
distribution: `Discriminant(2)` × 4,442 · `(3)` × 3,150 · `(0)` × 2,619 · `(5)` × 2,537 · `(6)` ×
2,490 · `(4)` × 274 · `(7)` × 68 · `(9)` × 11 · `(8)` × 10 · `(1)` × 2. **17.2 % of every span in the
store.** `SpanRow.tsx:54-56` renders `{span.name}` with `title={span.name}`, so the inspector shows
the string verbatim. The index is the enum's *declaration order*, so reordering `ProtocolMessage`
retroactively relabels three years of history.

At `:2545-2556`, inside the same `if let`, the code matches the message against named variants. A
second site does the same thing: `engine/dispatch.rs:220-224` writes
`"[OPS] Suppressed protocol dispatch: {:?}", std::mem::discriminant(msg)` into the execution log.

**Fix:** give `ProtocolMessage` a `fn kind(&self) -> &'static str` returning a written constant per
variant, use it for the span name, and put the variant name in `metadata` as well.

### D2 — every token count in the app is zero, from one field name

`engine/src/parser.rs:340-341` reads `total_input_tokens` / `total_output_tokens` from the top level
of the CLI `result` line. **0 of 314 real result lines carry either field**; `usage.input_tokens` and
`usage.output_tokens` are present in 314 and positive in 312. The two cache fields at `:347-354`
consult `usage` first and are populated at 648,406,049 and 26,029,682. Consequence chain, each link
measured: `metrics.input_tokens = 0` → `persona_executions.input_tokens = 0` on **2,188 / 2,188**
rows → `finalize(Some(cost), Some(0), Some(0), …)` (`runner/mod.rs:2908-2912`) → root span
`input_tokens = Some(0)` on **2,942 / 2,942** traces → `TraceSummary.tsx:61` renders `0` →
`TraceSummary.tsx:90` gates `CostBreakdownBar` off in **2,942 / 2,942**.

**Fix (one line per field, copying the shape already six lines below):**
`usage.and_then(|u| u.get("input_tokens")).or_else(|| value.get("total_input_tokens")).and_then(as_u64)`.
Then update `parser.rs:1105`'s fixture to the real shape, or the test will keep asserting the old
belief. **This is a behaviour change — it makes 2,188 historical rows disagree with 2,188 future ones
— so it is a note, not an apply.**

### D3 — 3 of 11 declared span types have never been emitted, and the frontend is forced to describe them

`SpanType` (`core/src/trace.rs:34-59`) declares eleven variants. Grepping every `SpanType::` in 963
`.rs` files finds **eight** constructed, all in `runner/mod.rs`. Live data confirms exactly eight.
Never emitted: **`ChainEvaluation`, `OutcomeAssessment`, `HealingAnalysis`** — three named phases of
work (chain cascade evaluation, the success/incomplete heuristic, post-failure healing analysis) that
all really happen and none of which is attributable in the inspector, which is precisely what the
spine says this leaf is for.

And `traceInspectorTypes.ts:135` types its config map as `Record<SpanType, …>`, so **the exhaustive
type obliged someone to write a label and four Tailwind classes for `chain_evaluation`,
`outcome_assessment` and `healing_analysis`**. This is doctrine Q1 in miniature: a closed map
guarantees the map covers the enum, and says nothing about whether a producer exists.

### D4 — the trace is written once, at the end, so 126 runs have none

Four `finalize` + `save` pairs (`runner/mod.rs:466-467`, `:1720-1721`, `:1978-1979`, `:2908-2914`);
the collector holds everything in `Mutex<SpanStore>` until then. Coverage: completed **1,928/1,928**,
failed **132/238**, incomplete **0/20**. The 126 misses are 74 app-restarts, 20 panics, 12
engine-ceiling kills and 20 zombie sweeps — all out-of-band terminations. Failed runs that *are*
traced average 15.6 spans against completed runs' 31.5.

**Compounding it: three of the four saves discard their own result.** `:467`, `:1721` and `:1979` are
`let _ = crate::db::repos::execution::traces::save(…)`; only `:2914` logs a failure. The three that
discard are the early-failure paths — the ones covering runs that died before spawning.

### D5 — 880 orphan traces (29.9 %), and the foreign key would not have helped

`execution_traces.execution_id` is `TEXT NOT NULL` with **no `REFERENCES` clause**
(`incremental.rs:841-850`), so nothing has ever related it to a run. 880 of 2,942 rows point at an
execution that does not exist. `persona_tool_usage.execution_id` **does** declare
`REFERENCES persona_executions(id) ON DELETE CASCADE` and still holds **980 orphan rows across 370
executions**; `execution_knowledge.last_execution_id` holds **583 of 2,343**. The pool sets
`PRAGMA foreign_keys = ON` on every acquire (`db/src/lib.rs:201`), but a table rebuild runs with it
off (`incremental.rs:448-459`), which is where the cascade was lost. **The cause belongs to
[destructive-schema-change](./destructive-schema-change.md); the consequence — a third of the trace
store cannot be attributed to a run — is this leaf's, and it is not fixable by adding a constraint.**

### D6 — the trace's pointer to the raw transcript is dead for 28.7 % of runs

Of 2,074 executions carrying a `log_file_path`, **1,479 point at
`%APPDATA%/com.personas.desktop/logs` (all present) and 595 point at
`%LOCALAPPDATA%/Temp/personas/logs` — of which 0 exist.** Windows sweeps `%TEMP%`. Checking whether
the file merely moved: 0 of the 595 are present in the APPDATA store under their execution id
either. So for 595 runs the trace records where the transcript is and the transcript is gone, with no
marker distinguishing that from a run that produced no log.

### D7 — the live waterfall shows two of ten span kinds

`EXECUTION_TRACE_SPAN` is emitted at exactly two sites (`runner/mod.rs:2419` start, `:2494` end),
both for `ToolCall`. The other eight span kinds — validate, credentials, spawn, prompt assembly, CLI
spawn, stream output, stream processing, finalize — appear only in the wholesale `EXECUTION_TRACE`
event at the end (`:2931`). So during a running execution the inspector shows tool calls with no
frame around them, and `applySpanEvent`'s `'end'` branch is exercised by exactly one producer.
*(Not proposed as a gate — see §9 refusal 4; emitting a live event for all 15,603 protocol spans
would be worse.)*

### D8 — LIFO span closing against an interleaving stream

`runner/mod.rs:2484-2488` closes "the last-started `ToolCall` span with no `end_ms`". The Claude CLI
can emit several `tool_use` blocks before any `tool_result`, and the `tool_result` carries an id the
close path does not use. **2,882 pairs of consecutive tool spans overlap in time, across 868 of 2,942
traces (29.5 %)**, and **all 88 force-closed spans in the corpus are `tool_call`** — i.e. 88 tool
spans never received a result at all. Every overlap is a case where the first result closes the last
span.

**Fix:** carry the `tool_use` id in the span's `metadata` at start (`:2411-2414` already builds a
metadata object) and close by looking it up, falling back to LIFO only when the id is absent.

### D9 — five identities per run, zero joins; one of them has no reader

`persona_executions.id` · `execution_traces.trace_id` (a different UUID) ·
`persona_executions.traceparent` (W3C, 2,168 rows) · `claude_session_id` (2,162) · `chain_trace_id`
(3). No column, function, index or query relates any two of them. The traceparent is minted at
`trace.rs:493`, persisted at `executions.rs:1475`, injected at `runner/mod.rs:1602`,
`cli_args.rs:78`, `cli_args.rs:275` and `mcp_tools.rs:1231` — and **read nowhere**, by design
(`trace.rs:471-473`: *"there is no collector wired up yet"*). It has three unit tests
(`trace.rs:528-570`) asserting its *shape*, which is the only thing about it that can be asserted.

### D10 — `chain_trace_id` has never grouped two executions

3 distinct values, 1 row each, in 2,942 traces. `get_by_chain_trace_id`, `set_chain_trace_id`,
`count_by_chain_trace_id`, the fan-out breadth guard (`db/src/chain.rs:384`), two IPC commands
(`commands/execution/executions.rs:755,:786`) and four unit tests exist for a relationship that has
never had more than one member.

### D11 — `CostBreakdownBar` has never rendered

Gated at `TraceSummary.tsx:90` on `stats.totalInput + stats.totalOutput > 0`, which is 0 for all
2,942 traces (D2). 91 lines, 8 i18n keys (`cost_breakdown`, `unknown_model_pricing`, `input_label`,
`output_label`, `total_label`, `input_pct`, `output_pct`, `subscription_cost_note`) translated into
**all 14 locales = 112 strings**, plus a passing test file that supplies the tokens the producer
cannot. It becomes live the moment D2 is fixed, which is the argument for fixing D2 rather than
deleting this.

### D12 — `CLI Spawn` measures nothing

`start_span` at `runner/mod.rs:1890`, `end_span_ok` at `:1900` — ten lines with no work between them.
**2,920 of 2,942 traces record `CLI Spawn: Claude Code CLI` at 0 ms.** The real spawn cost is in the
parent `Pipeline: Spawn Engine` (142 ms in the reconstructed run). A span that always reads zero is a
row in the waterfall that costs a line and carries no information.

### D13 — a second copy of the client trace-merge logic, reachable only from its test

`traceVisibility.ts` (67 lines) exports `mergeSpanEvent`, `buildParentMap` and `isAncestorCollapsed`
— byte-for-byte the same concepts as `applySpanEvent`, `buildParentIndex` and `computeVisibleNodes`
in `traceInspectorTypes.ts`. **Its only importer is `__tests__/traceInspector.test.ts`.** The
production hook imports the other copy. `traceInspectorTypes.ts:7-12` records that this exact split
already caused drift once and was consolidated; half of it survived. 23 test assertions currently
certify the copy nothing runs.

### D14 — seven representations of one run's steps

`execution_traces.spans` (2,942) · `persona_executions.tool_steps` (1,921) ·
`persona_executions.execution_flows` (1,762) · `persona_tool_usage` (5,720 rows / 2,289 executions) ·
`provider_audit_log` (4,001) · the frontend-side `pipelineTrace`
(`src/lib/execution/pipeline.ts`, 714 lines, merged at `useTraceData.ts:162`) · `SubagentTree`'s
live-only event accumulation. They currently **agree** (§0.1), so this is duplication rather than
drift — recorded because each one is a thing that can start disagreeing, and because two of them
(`provider_audit_log.model_used` NULL in **4,001/4,001**; `persona_executions.model_used` non-null in
1,004 of 2,188) **already do**: they are written 40 lines apart in the same function from two
different CLI stream lines, one of which does not carry the field (`parser.rs:371` reads a top-level
`model` that is absent in 314/314 real result lines; `executions.rs:731` `set_model_used_actual`
reads the `init` line, which does).

## 8 Gaps — what the primitives genuinely cannot do

1. **`TraceCollector` has no incremental sink.** `finalize` is the only method that produces an
   `ExecutionTrace`, and it *drains* the store, so it can be called exactly once. There is no
   `flush()`, no per-span callback, no `execution_spans` table. Everything in D4 is downstream of
   this and no call-site discipline can work around it.
2. **`SpanStore::remove` is `O(n)` and eviction is oldest-first.** `remove` (`trace.rs:190-197`) does
   `Vec::remove` then re-inserts every subsequent id into the index. At `MAX_SPANS = 10_000` a trace
   that overruns pays ~10,000 `String`-cloning HashMap inserts *per evicted span*, under the lock, on
   the streaming hot path. And it evicts the **oldest completed** span — for a waterfall that means
   validate/credentials/spawn go first, i.e. exactly the prefix that explains how the run started.
   Untested in production (0 traces have ever evicted) and structurally the wrong end to drop from.
3. **A span cannot express "this metric was not measured here"** distinctly from "this metric is
   zero here", because both are reachable: `Option<u64>` is the right type and `Some(0)` is spellable
   by anyone holding a `u64`. The type is correct; the boundary that fills it is not typed.
4. **Nothing relates a span to the log lines it produced.** The trace has `execution_id` and no
   timestamps in wall-clock terms (`start_ms` is relative to an `Instant` epoch that is never
   persisted); the rolling `tracing` log has wall-clock timestamps and no `execution_id`; the
   per-execution transcript has neither level nor span id. **Three records of one run, and no two
   share a key.** This is [structured-logging](./structured-logging.md) Gap 8 confirmed from the
   trace side and made worse: even if the log carried an `execution_id`, `start_ms` could not be
   converted to a wall clock.
5. **`serde_json::from_str(&spans_json).unwrap_or_default()`** (`traces.rs:58`, `:123`) turns a
   corrupt or schema-drifted `spans` blob into an empty trace that renders as "no spans" rather than
   as an error. A field renamed in `TraceSpan` would silently empty every historical trace, and the
   only surface that would notice is a human.
6. **The census cannot assert an absence, and most of this leaf is absences.** "No span is ever
   persisted before the run ends", "three enum variants have no producer", "nothing reads a
   traceparent", "no column joins two identities", "no CostBreakdownBar has ever rendered" — five of
   the largest findings above, none expressible as a count of something present. Same limit
   [stall-watchdog](./stall-watchdog.md) Gap 4 and
   [compile-time-env-embedding](./compile-time-env-embedding.md) Gap 7 recorded.
7. **No static analysis can see a field-name mismatch against another program's output.** D2 is the
   sharpest defect in this document and it is invisible to `rustc`, to clippy, to `tsc`, to the
   census and to the parser's own unit test. It is only visible by reading what the producer actually
   emitted, which is what §9's instrument does.
8. **The whole instrument has ten `start_span` call sites, all in one file.** A census rule's unit is a repeated
   call-site pattern; this leaf has no repetition to ratchet. That is the honest reason §9 declines,
   and it is a property of the leaf rather than of the analysis.

## Prefer a type over a gate

Per the [contract](../golden-path-contract.md), answered explicitly before §9.

**The answer is YES, and it is not the type I first reached for.**

The obvious candidate is to make the token/cost fields harder to get wrong — a `Measured<T>` newtype,
or narrowing `input_tokens` to `Option<NonZeroU64>`. **Held against the seven qualifications, it
fails Q7 and Q2 outright.** Nobody *forced* `finalize` to receive a zero; it receives a zero because
`metrics.input_tokens` is a plain `u64` that a parser set to `0` after failing to find a field.
Narrowing the type at `finalize` only moves the collapse one frame earlier (`NonZeroU64::new(0)` →
`None`, which is arguably the right answer, but the caller writes that conversion by hand and can
write `unwrap_or(0)` just as easily). And the value crosses a **serialization boundary** — the CLI's
stdout — before any Rust type exists to protect it, which is doctrine §1 item 4 exactly: *a type
authenticates nothing when the untrusted value crosses a serialization boundary before the type
exists.* **No type reaches D2.** Its fix is one field name and one `warn!`.

**The type that does reach is on the span's LIFETIME, not on its fields:**

```rust
/// A started span. There is no `Clone`, no `Copy`, and no public constructor:
/// the only way to obtain one is `start_span`, and the only way to consume one
/// is `end`. Dropping it without ending it is a compile-time warning
/// (`#[must_use]`) and a runtime record (the Drop impl closes it as orphaned).
#[must_use = "a started span must be ended by handle — closing `the most recent open span` is D8"]
pub struct OpenSpan<'a> {
    collector: &'a TraceCollector,
    span_id: String,
}

impl<'a> OpenSpan<'a> {
    pub fn end(self, outcome: SpanOutcome) { /* writes AND persists — see below */ }
}

/// What the phase produced. No `Default`, no `From<()>`: a phase must say what
/// happened. `Unmeasured` is a first-class answer and is NOT the same as
/// `Metered { cost: 0.0, .. }`.
#[non_exhaustive]
pub enum SpanOutcome {
    Ok,
    Unmeasured,
    Metered { cost_usd: Option<f64>, input_tokens: Option<u64>, output_tokens: Option<u64> },
    Failed { error: String },
}

pub fn start_span(&self, ty: SpanType, name: SpanName, parent: Option<&OpenSpan<'_>>, md: Option<Value>) -> OpenSpan<'_>;
```

Held against all seven qualifications:

1. **A required prop carries only what it actually encodes.** ✔ `OpenSpan` encodes "this phase is
   open and this is its handle" and nothing else. It deliberately does **not** encode whether the
   phase succeeded — that is `SpanOutcome`, supplied at `end`, because the two facts are known at
   different times. Folding them would repeat the `successRateSource` failure.
2. **Requiredness is orthogonal to closedness.** ✔ and both are used, for different defects.
   `SpanName` as a closed type (an enum, or `&'static str`) is what kills D1: `format!` no longer
   type-checks in the name position. `OpenSpan` being non-`Clone` and consumed by `end` is
   *requiredness* — it does not close anything, it removes the ability to have a handle you never
   used.
3. **A type nobody constructs constrains nothing.** ✔ and this is the discriminating point.
   **Construction sites: 10, and `rustc` creates every one of them** — there is no second way to
   start a span, no `Default`, no public field. Compare the corpus's catalogue of inert primitives
   (`ExecutionState::TERMINAL`, 0 production references; `claim_for_instance`, 0 callers and 0 of
   2,188 rows; `ProcessSession`, 0 implementors). Those are *available*. This is *unavoidable*.
4. **A type anyone can construct authenticates nothing.** ✔ with an honest limit. Nothing stops a
   lazy author writing `SpanOutcome::Unmeasured` for a phase that did measure something. What becomes
   **impossible** is the current state: closing a span you found by scanning (D8 — you have no
   `OpenSpan` for it), naming a span with a runtime string (D1 — `SpanName` refuses it), and finishing
   a run with spans that were never ended (the `Drop` impl records them, which `finalize` currently
   does after the fact).
5. **Withholding beats requiring.** ✔ read correctly. What is withheld is **the ability to address a
   span by anything other than the handle you were given**. `end_span(&span_id: &str)` today accepts
   any string, including one produced by `.rev().find(…)`. Removing the string-addressed door is the
   strong move; requiring an extra argument would be the weak one.
6. **Withhold the dangerous freedom, not the answer.** ✔ The dangerous freedom is *choosing which
   open span to close*. The answer — "this phase is done and here is what it produced" — stays fully
   expressible, and **gains** a distinction it does not have: `Ok` (finished, nothing to report) vs
   `Unmeasured` (finished, this phase cannot carry a metric) vs `Metered { .. : None }` (finished, we
   tried to measure and did not find out). D2 is exactly the case where the third collapses into a
   zero.
7. **Withholding a requirement only helps when the requirement was forcing the bad value.** ✔ and it
   rules out the alternative. Nobody was *forced* to render `0` in `TraceSummary.tsx:61`; the
   renderer prints `0` because that is what the data says. Relaxing any client-side type is inert.
   The distinction has to exist at the write or it does not exist at all.

**Does the type reach the code?** **Yes — with one caveat that is the whole reason §8 Gap 1 is the
first fix.** `start_span`/`end_span` are inherent methods on a concrete struct with 31 call sites (10
`start_span` + 21 `end_span*`), **29 of them in one file** and the other two inside the primitive's
own convenience wrappers, in
one file; `rustc` visits every one. There is no SQL string literal, no `OnceLock`, no environment
variable in this path. **But the `spans` column is `TEXT` holding a JSON array** — doctrine §1 item 4
and its `selective-per-item-verdicts` corollary: *no type reaches inside a serialized blob, and the
storage shape is upstream of every type you could add above it.* So `OpenSpan` guarantees that spans
are **constructed and closed** correctly; it guarantees nothing about what survives the round trip
through `serde_json::to_string` into a `TEXT` column and back out through
`unwrap_or_default()` (§8 Gap 5).

**Fix order:** (1) D2 — one field name, and the fixture beside it; (2) D1 — a `kind()` returning a
constant; (3) `OpenSpan` + `SpanOutcome`, which closes D1 permanently and D8 permanently; (4) **the
per-span durable write** (`OpenSpan::end` persists), which is the only thing that closes D4; (5) D5's
orphan reconciliation; (6) delete D13's dead copy.

## 9 The missing gate

### The conditions, stated stack-free first

Three, none of which is a count of anything present:

> **(A)** A run's trace is assembled in process memory and written once, at the end, so its coverage
> is conditioned on the run ending the way the writer expected.
> **(B)** A metric that was never measured is stored as zero, so "we did not find out" and "it was
> zero" are the same record forever after.
> **(C)** A record about an external process is populated by reading named fields out of that
> process's output, and nothing asserts the field was found.

Per the [portability test](../research/portability-test.md), an adopting repo inherits these three
sentences and re-derives its own instrument. What follows is a **reasoned decline** on the census,
with the numbers that forced each refusal, and the specification for the instrument that *can*
express all three.

### Existing rules checked first, by reading each definition rather than its title

All **145** rules in `scripts/census/rules.json` were enumerated; these seven were opened and read in
full because they are the nearest neighbours:

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `outcomeless-tick` (`stall-watchdog`, 8/45) | `fn tick(` definitions returning `()` | The nearest conceptual neighbour — "the loop cannot say what it produced". Keys on periodic-cycle definitions; nothing in this leaf is a `tick`. **0 shared match sites.** |
| `unqueryable-log-record` (`structured-logging`, 67/288) | a `tracing` macro whose message interpolates | A log line, not a run artifact. 0 shared sites. |
| `unknown-money-as-zero` (21/25) | `cost`-named value defaulted to `0` at the **read** | Closest to condition (B) — and structurally disjoint. It matches `?? 0` / `unwrap_or(0)` **at the consumer**. D2's zero is written by a *producer* that found nothing; there is no `??` and no `unwrap_or` anywhere in the chain. |
| `empty-sample-as-confident-zero` (16/34) | a rate over an empty sample materialised as `0.0` | An arithmetic guard shape (`if n > 0 { … } else { 0.0 }`). D2 has no division and no guard. |
| `absent-entity-count-as-zero` (30/40) · `read-failure-as-empty-value` (32/68) | TS-side `?? 0` on a map read; a `.catch` returning `[]`/`0`/`null` | Both are client-side default-on-absence. This leaf's zero is server-side and arrives as data. |
| `untimed-repo-query` (36/245) | a repo fn reaching SQL outside `timed_query!` | All five `traces.rs` functions are wrapped. Compliant already. |
| `constraintless-table-declaration` (6/15) · `undeclared-parent-fate` (1/3) | a `CREATE TABLE` with no `NOT NULL`; a `REFERENCES` with no `ON DELETE` | Nearest to D5 — and **D5 proves neither would have helped**: `persona_tool_usage` declares the FK *and* the `ON DELETE CASCADE` and orphaned 980 rows anyway. |

**None of the 145 keys on a per-run trace artifact.** Five candidates were then built and measured.
All five were refused.

### The five refusals, with the numbers that forced them

| # | candidate signal | violating | compliant | why refused |
| --- | --- | ---: | ---: | --- |
| 1 | **`start_span(…, &format!(…))`** — a phase name computed at runtime (D1's exact defect) | **3** / 1 file | **5** / 1 file | The sharpest condition in the document and unshippable. Of the 3 matches only **1** is the defect (`runner/mod.rs:2527`); `ToolCall: {tool_name}` (`:2408`) and `CLI Spawn: {engine}` (`:1890`) are *correct* — a bounded vocabulary belongs in the name. **Precision 1/3 = 33 %.** A one-production-match rule also dies structurally the moment it is fixed (the runner treats zero matches as a broken matcher). Same refusal `stall-watchdog` recorded for its string-literal `source_id` at 2 matches. *(Honest note on the control: 3 + 5 = 8 of the tree's 10 `start_span` sites, not 10 — two have parameter lists longer than the pattern's 120-char bound and fall in neither bucket. **Reported rather than tuned away**; it is a ratio, not a partition.)* |
| 2 | **`end_span_ok` / `end_span_error` / `end_span(…, None, None, None, None)`** — a phase closed with no metric | **19** of 19 | **0** | Refused on the **positive control**, not on precision. The control (`end_span` with a `Some(` metric argument) returns **one** match in 963 `.rs` files, and opening it shows it is `core/src/trace.rs:380` — **the body of `end_span_error` itself**, where the `Some(` is the *error* argument. So the true compliant population is **zero**, and the only thing the control can find is the implementation of one of the violations it was meant to contrast with. **A control that returns zero cannot distinguish "the compliant form is genuinely absent" from "my matcher is broken."** Identical refusal to [compile-time-env-embedding](./compile-time-env-embedding.md) §9.2, reached independently and confirmed here by the engine. |
| 3 | **`format!("…{:?}…")`** — a Debug rendering used to build a durable or displayed value (D1 generalised) | **29** / 24 files | 7 | Opened all 29. **Roughly 20 are error messages, validation strings, test fixtures and diagnostic reports**, where `{:?}` is the correct choice (`AppError::Validation(format!("unknown fleet state token: {:?}", …))`). **Precision ≈ 30 %. A gate that fires on correct content is worse than no gate.** |
| 4 | **a `start_span` with no matching `EXECUTION_TRACE_SPAN` emit** (D7) | **28** | 3 | Precision is fine and it partitions all 31 span-lifecycle calls exactly. Refused because **the prescription it would enforce is wrong**: emitting a live event for all 15,603 protocol-dispatch spans would flood the IPC channel and the Sentry breadcrumb buffer, which `trace.rs:281-283` deliberately avoids. A gate that pushes toward a worse design is worse than none. |
| 5 | **`value.get("literal").and_then(as_…)`** — an unasserted field pull out of another program's JSON (condition C) | **1,620** / 163 files | 211 | The most tempting, and the worst. This is the standard `serde_json` idiom and the overwhelming majority of the 1,620 read the app's **own** JSON (persona configs, trigger configs, template IR) where absence is legitimately optional. Narrowing by root to `src-tauri/engine/src` gives 296/25 with the same problem. **Precision would be well under 10 %.** |

**Every count in that table was produced twice** — by a standalone file-walking scanner written for
this composition, and by the census engine itself, run standalone from a composer-private registry
(`census-eti-9b41d7.json` — a filename unique to this composition, because sibling composers share
the scratchpad). **The full registry was NOT run**, per the doctrine. The two implementations agree
exactly on candidates 1, 2 and 3 (3/1, 17/1, 29/24) and **disagreed by one on candidate 2's control**
— the engine found the match my scanner missed, and opening it is what produced the sharper refusal
above. Disagreement was the useful part.

```
  rule                                            files  base  matches  base  walked  floor
  OK  runtime-formatted-phase-name                    1     1        3     3     963    900
  OK  runtime-formatted-phase-name-positive-control   1     —        5     —     963    900
  OK  debug-render-as-durable-label                  24    24       29    29     963    900
  OK  metricless-span-close                           1     1       17    17     963    900
  OK  metricless-span-close-positive-control          1     —        1     —     963    900

  census OK — 5 rule(s), 4815 file-visits, 55 surviving violation(s) across 28 file(s).   exit 0
```

`963 walked` is exactly `rust.files` in [`shared-facts.json`](../shared-facts.json) — an
independently derived count agreeing, which is the only reason to trust the walk. **None of these
five is proposed for merge.** They are published as the evidence behind the refusals; the registry
copy was deleted, and so were the database copies.

**Refusing here is the finding.** The reason is structural and is §8 Gap 8: **the entire trace
instrument is 31 call sites, 29 of them in one file.** The census ratchets a repeated call-site pattern; a leaf
with no repetition offers nothing to ratchet. Every genuine defect above is either a **single site**
(D1, D8, D12), an **absence** (D3, D4, D7, D9, D10, D11), or a **property of the deployment** (D5,
D6) — and the census can express none of the three.

### What the census cannot gate here, and the instrument that can

All three stack-free conditions are runtime properties of a **store**, not of source text. They were
found the only way they can be found: by copying the live database, parsing all 90,813 spans, and
reading what the external producer actually wrote. So the honest second half of this §9 is a
specification for a different instrument, in the shape of `scripts/check-csp-hosts.mjs` and
`stall-watchdog`'s proposed `check-loop-liveness.mjs` — both of which exist because a
set-coverage condition cannot live in the census.

**`scripts/check-trace-reconstructability.mjs`** — a dev-time probe over a **read-only copy** of the
local `personas.db`, ~150 lines, `node:sqlite`, no dependency:

1. **Its own fail-loud precondition first, and this is the part that matters.** Exit **2** if the
   database is absent, if `execution_traces` holds **zero** rows, if the declared-field inventory
   below resolves to **zero** fields, or if fewer than **50** traces are available to sample — the
   four ways this check could silently become the thing it is watching. Print the sample size and the
   field inventory on success, so a green log distinguishes "clean" from "checked nothing".
2. **A declared field inventory, committed beside the script**, derived from `TraceSpan`'s ts-rs
   binding (`src/lib/bindings/TraceSpan.ts`) — every field the span type declares. **Assert the
   inventory is non-empty and that every field in it appears in the parsed spans.** A field declared
   and populated in **0** of N spans is reported by name. That is D2, D3 and P8, caught mechanically:
   today it would print `input_tokens: 0/90,813 · output_tokens: 0/90,813 · cost_usd: 2,827/90,813
   (root only)`.
3. **Enum coverage.** Parse `SpanType`'s variants out of the same binding; report every variant with
   **0** live spans. Today: `chain_evaluation`, `outcome_assessment`, `healing_analysis`.
4. **Tree integrity, per trace**: exactly one root; every `parent_span_id` resolves within the trace;
   no cycles; no negative durations. Today all four pass on 2,942/2,942 — which is exactly why the
   check should exist, so a regression is visible against a known-clean baseline.
5. **Coverage by terminal status.** `persona_executions` grouped by `status`, LEFT JOINed to
   `execution_traces`. **Report the coverage ratio per status and flag any status whose coverage is
   below the `completed` ratio.** Today: 100 % / 55.5 % / 0 %. This is the single most valuable line
   the script would print and no source-level gate can produce it.
6. **Attribution.** Count trace rows whose `execution_id` matches no run (today 880 / 29.9 %), and
   `persona_executions.log_file_path` values whose file is absent (today 595 / 2,074).
7. **Name legibility.** Report span names matching a "computed label" shape — `Discriminant(`, a bare
   type path, `{:?}`-residue — as a *count with examples*. Today 15,603.
8. **Report; fail only on its own preconditions and on a NEW zero-population field.** An operator's
   machine legitimately has few traces, and a coverage ratio is not a build error. What *is* a build
   error is a field or enum variant that the type declares and no run has ever populated — that is
   the condition this leaf exists for, it is checkable, and it fails deterministically.

Running it today would print, in under two seconds: three dead enum variants, two never-populated
fields, 0 % trace coverage for `incomplete`, 880 unattributable traces, 595 dead log pointers and
15,603 illegible span names — which is most of §7, produced by the one thing nobody had built.

### On severity, if any of this ships as a lint rule

Nothing here is proposed as an ESLint rule, so the question does not arise — and it must not be
argued from warning volume in either direction. `npm run check` runs `eslint src/` with **no
`--max-warnings`** and the pre-commit hook runs `--quiet --max-warnings 99999`, where `--quiet`
discards warnings before they can be counted. **A warn-level rule enforces nothing at either gate, at
any count, by construction.** The proposed script is a `check:*` entry that exits non-zero, which is
a different mechanism.

### Where it would run

Not `ci.yml` — there is no `personas.db` on a CI runner, and per the §9 calibration `ci.yml` is red
on 10 pre-existing failures, so a gate that runs only there runs nowhere. This is a **local
`npm run check:traces`**, run by a developer touching the trace lane, exactly as the doctrine
prescribes for deployment properties.

## 12 Corrections to the brief

1. **The `CONVERGED` label FAILS — and it fails a THIRD way, which is the one worth adding to the
   doctrine.** Ten labels had been tested and ten failed; the tenth
   ([compile-time-env-embedding](./compile-time-env-embedding.md)) failed because *the fleet
   converged on the disease* — 6 of 6 repos unable to report their own build. **This one fails on
   both known modes at once and adds a new one.**

   - **Mode 1, converged on the disease — 5 clauses.** No per-step cost attribution (0 of 6); no
     enforced parent-child lifetime (0 of 6); 4–8 unjoined correlation namespaces per run (6 of 6);
     no per-phase durable write (0 of 6); a declared instrumentation field rendered by a UI and
     populated by nobody (2 of 4 independent, and one of them is *our own tokens tile*, in
     TypeScript, over a different database).
   - **Mode 2, converged SILENCE pointing the opposite way — 2 clauses, and they are the ones the
     label most implies.** *Does a per-run span tree exist at all?* **Personas is the only repo in
     the family that has one.** *Is there a wired run-as-tree viewer?* **Personas is the only repo
     that has one** — `brainiac`'s has zero callers, `vibeman`'s best-in-sweep timeline component is
     imported by nothing over a table that is never persisted, and all four of `personas-web`'s
     timelines are driven by static examples. A composer who read `converged` as "go find the
     prescription in a sibling" would have found four repos with a flat row and one detector that
     reads someone else's code.
   - **Mode 3 — NEW, and the reason this leaf is worth the doctrine entry: the fleet converged on the
     defect while this repo owns the fleet's best answer to it, AND independently commits a defect no
     sibling has.** Personas is simultaneously the most advanced repo on clauses 1, 8 and 10 and the
     **only** repo that violates clause 5 (constant phase names). *Being ahead of the fleet on the
     mechanism is not evidence of being ahead on its details*, and an oracle that scores a leaf as a
     single verdict cannot express that. Two clauses genuinely converge on an **answer**: record the
     truncation in the artifact (Personas + `ascent`, independently reinvented — P9), and write the
     run row on failure with the atomicity reason stated (`brainiac`, alone — P1's open half).

   **The correct spine label is `mixed`, and the honest one-line summary is: the situation is
   universal, the mechanism is local, the defects are universal, and exactly one of the ten clauses
   has an answer to adopt.**

2. **"sides=server" is wrong, and the spine itself says so.** The brief's header carries
   `sides=server`, and the spine leaf carries `"sides": "server"` — but it *also* carries
   `"twoSided": true`, `"fusedAcrossSides": true`, an explicit `clientHalf` (*"Rendering nested spans
   and related events as one collapsible duration narrative with drill-down"*) and a
   `mergedFrom` list naming **"Trace waterfall viewer"** and **"Event chain timeline"**. Per the
   [contract](../golden-path-contract.md) (*"Two-sided situations get one document with both halves
   … half a path is worse than none"*), the client half is in scope and this document has it. **It
   was worth the correction: four of the fourteen deviations (D7, D11, D13, and half of D14) are
   client-side, and D11 — a component with 112 translated strings that has never rendered — is only
   visible by reading the client against the server's data.** A composer who took `sides=server`
   literally would have shipped a half path and reported the trace as healthy at the point where it
   is most misleading.

3. **"All 10 `SchedulerStats` counters are rendered nowhere … 'the instrument exists and is used for
   the wrong purpose' was the most reproducible finding" — confirmed as a family, and this leaf
   supplies a sharper instance than the counters.** The counters are collected and unread. Here the
   *renderer exists and is wired* (`TraceSummary.tsx:61` is on screen for every execution) and the
   **producer** is the missing half. That is worse than an unread counter, because an unread counter
   is silent and a wired renderer is confident: it prints `0`. **The generalisation the corpus should
   carry forward is not "the instrument is used for the wrong purpose" but "one half of the
   instrument was built and nothing checks that the other half exists."** Three independent shapes of
   it are now measured — collected-and-unrendered (`SchedulerStats`), declared-and-unpopulated
   (`TraceSpan.input_tokens`, `SpanType`'s three dead variants), and rendered-but-unreachable
   (`CostBreakdownBar`).

4. **"760 try/catch bodies reach no error door" — confirmed as the shape, and this leaf adds the Rust
   twin at a much smaller but more consequential scale.** Three of the four `traces::save` call sites
   are `let _ = …` (D4), and they are the three covering *failed* runs. Not re-derived; routed to
   [swallowed-error-telemetry](./swallowed-error-telemetry.md)'s Rust annex, which already counted
   1,128–1,149 `let _ =` sites.

5. **"Not one of six repos can report its own commit, branch, build timestamp or profile at runtime.
   A trace you cannot attribute to a build is a trace you cannot compare across versions" —
   confirmed, and it is worse here than that framing suggests.** `execution_traces` has no build
   column, no app-version column and no schema-version column. But the sharper finding is one layer
   down: **`start_ms` is relative to an `Instant` epoch that is never persisted**
   (`trace.rs:218`, `:277`), and `execution_traces.created_at` is stamped at *finalize*
   (`trace.rs:446`), not at start. So a span's position cannot be converted to a wall clock at all,
   which is why §8 Gap 4 is unsolvable without a schema change. The trace cannot be aligned with a
   build, and it cannot be aligned with a log line either.

6. **"`fleet_decisions`: 10 of 46 rows have an empty `session_id`; 7 of 25 hold a Claude id, not a
   Fleet id. A correlation id that is sometimes absent and sometimes from another namespace is the
   leaf's core hazard in miniature" — confirmed, and the miniature is a scale model of something
   larger and *deliberate*.** `fleet_decisions` mixes namespaces by accident. This leaf mixes **five
   namespaces by design** (D9): a UUID execution id, a *different* UUID trace id, a W3C 128-bit
   traceparent, the CLI's own session id, and a chain id — with **zero** joins recorded and one
   (traceparent) having no reader at all. Independently confirmed: `execution_traces.trace_id` is
   minted by `uuid::Uuid::new_v4()` at `trace.rs:216` and the traceparent's trace id by
   `rand::thread_rng().fill_bytes()` at `trace.rs:498`. Two random numbers for one run, and nothing
   writes down that they belong together.

7. **"`persona_events` had 0 rows of any status between 2026-06-27 and 2026-07-31, and no instrument
   could distinguish that from a healthy quiet period" — the same silence is present here and is
   dated identically.** `execution_traces`' newest row is `2026-06-26T16:36:54`, `persona_executions`'
   newest is `2026-06-26T16:34:02`. **51 days.** Not re-derived — [stall-watchdog](./stall-watchdog.md)
   §0 owns it. Recorded because it bounds every number in this document: the corpus is a June
   snapshot, and a trace store with no rows for 51 days is indistinguishable, in every instrument
   this app owns, from a trace store that is working.

8. **The brief asked "what does a failed run record that a successful one does not". The answer is
   inverted and that inversion is the leaf's best single result: a failed run records LESS.** 100 %
   coverage for completed, 55.5 % for failed, 0 % for incomplete; 15.6 spans against 31.5. There is
   exactly one thing a failed run records that a successful one does not — the `error` string
   propagated up three levels of the tree, which is genuinely well done (§0.1). Everything else it
   records is a subset.

9. **How far the reconstruction got, stated plainly, because the brief asked.** *Structurally,
   all the way.* Every phase, every tool call, every nesting relationship, every duration and the
   full error chain of one real 15-minute failed run rebuilt from one column, with no gaps. **Where
   it broke: (i) the money and tokens — I know the run cost `$0` and consumed `0/0` tokens, and both
   are false; (ii) the raw transcript — `log_file_path` pointed at `%TEMP%` and the file was gone;
   (iii) which model actually ran — `persona_executions.model_used` said `claude-sonnet-4-6` and
   `provider_audit_log.model_used` said `NULL`, for the same run, written 40 lines apart; (iv) what
   the 4,442 `Protocol: Discriminant(2)` spans in the corpus were dispatching — unrecoverable without
   counting variants in the source, and unstable if anyone reorders them; (v) what the 52nd Bash call
   was doing when it died — the tool span carries `step_index` and no payload, and the payload lives
   in `tool_steps`, a different column, correlated only by the index.** So: the shape of what
   happened, completely. The content of what happened, partially. The cost of what happened, not at
   all.
