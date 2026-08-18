---
layer: golden-path
subject: streaming-output
status: forged
techniques:
  - stream-parsing
  - buffering-and-backpressure
  - render-throttling
  - run-attribution
  - phase-derivation
  - cancellation-and-finalization
evidence:
  - src/lib/execution/executionSink.ts                        # dual-budget ring (10k lines / 10 MB / 4 KB line clamp), head eviction, honest truncation notice, generation-gated visibility-aware throttled flushes, forceFlush-before-reset
  - src/hooks/execution/useStructuredStream.ts                # typed event union (11 variants) dispatched only after execution_id gating; singleton shared subscription
  - src/hooks/design/core/useTauriStream.ts                   # per-start generation counter making stale listeners/timeouts inert; listeners registered before invoke; bounded line buffer; timeout → error, never silent
  - src/features/plugins/companion/extractStreamPhase.ts      # phase derived from event shapes (tool_use > thinking; text yields to visible output), closed vocabulary, curated details
  - src-tauri/engine/src/safe_json.rs                         # bounded parse: 16 MiB size cap + nesting-depth cap before deserialization
  - src-tauri/engine/src/protocol.rs                          # the stream/finalize pipeline stages as a formal trait boundary (StreamOutput → FinalizeStatus)
counter_evidence:
  - src/features/shared/components/terminal/TerminalStrip.tsx # a shared component pinning the viewport to the tail without an at-bottom check — the scroll-contract violation the standard forbids
deviations:
  - w1-streaming-output   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Streaming model output

Streaming output is the surface you build when a producer — a model, a long
process, a remote agent — emits its result **incrementally over seconds or
minutes**, and the user must watch it happen. The job is not "show text as it
arrives". The job is to consume an unbounded, bursty, failure-prone event
sequence and render it live without exhausting memory, without thrashing the
renderer, and — hardest of all — **without ever lying about state**: whose
output this is, whether it is still flowing, and how it ended.

That definition decides when *not* to stream:

- **When the result arrives in under a perceptual beat**, streaming is
  ceremony. A response that settles in a few hundred milliseconds should render
  once, settled; incremental paint of a near-instant result reads as jitter.
- **When the user cannot act until the result is complete** — a computation
  whose partial output is meaningless — stream *progress*, not output. Showing
  half of an answer the user must not trust invites them to trust it.
- **When the producer's increments are not monotone** — it revises earlier
  output as it goes — a live transcript will visibly rewrite itself. Either
  render checkpoints (replace whole sections at coherent boundaries) or wait.

## The stream is a typed event sequence, not text

The ancestral defect of this surface is treating the stream as a growing
string. What arrives on the wire is transport chunks; what the surface
consumes must be **typed events** — content delta, tool invocation started,
tool result, phase marker, warning, terminal outcome — produced by a parser
that owns the framing rules and the malformed-input policy. Everything
downstream (buffering, throttling, phase display, finalization) becomes
tractable the moment events are typed, and hopeless while they are substrings:
you cannot attribute a substring to a run, you cannot derive a phase from it,
and you cannot tell the difference between "the producer said it failed" and
"the connection died mid-word". The [stream-parsing](techniques/stream-parsing.md)
technique owns this boundary.

## Anatomy: live state and settled record

Every streaming surface divides into two stores with opposite guarantees, and
most streaming defects are a confusion between them.

**Live state** is what the user watches: the tail of recent output, the
current phase, the running counters. It is volatile, append-mostly, bounded,
and *lossy by design* — it may hold only the last portion of a very long run,
and it evaporates when its run is replaced. Live state is owned by exactly one
run at a time (see below) and is never the system of record.

**The settled record** is what survives: the finalized turn, written **once**,
at finalization, from the authoritative accumulation — with its outcome
(completed, failed, cancelled, interrupted), its duration, and as much of its
output as the retention policy promises. It is written by the finalization
path and by nothing else. Persisting on every delta burns storage bandwidth to
record states nobody will ever read; scraping the render buffer at the end
records whatever truncation and throttling left behind rather than what the
producer said. Both are the same category error: letting the volatile store
and the durable store share a writer.

The [cancellation-and-finalization](techniques/cancellation-and-finalization.md)
technique owns the transition between the two.

## Ownership: one run, one surface

A surface renders **exactly one run's live state**, and it knows which run by
identity, not by recency of arrival. Runs restart, retry, and overlap: the
user stops a generation and immediately starts another; a reconnect races the
stream it replaced; a re-mounted view re-subscribes while the old
subscription's callbacks are still in flight. In every one of those, events
from a superseded run arrive *after* events from the current one — and a
surface that applies whatever arrives last will interleave two runs' output
into one transcript. The rule is absolute: **an event is applied only if its
run identity matches the surface's current run; anything else is inert** —
dropped, or routed to its own run's record, but never painted onto the live
surface. The [run-attribution](techniques/run-attribution.md) technique owns
the identity scheme and the races.

## Bounded memory is a contract term, not an optimization

The producer's output size is unbounded *by contract* — a run can emit for an
hour, one line can be enormous, and the surface must survive both. Therefore
every live buffer has a **budget stated in two currencies** — a count of
entries and a total byte size, because either alone is gameable by the other —
and evicts from the oldest end when a budget is exceeded. Eviction is honest:
the surface states that early output was dropped and how much, rather than
presenting a truncated transcript as complete. An unbounded "we'll probably
never hit it" buffer is a memory leak with a demo-day fuse. The
[buffering-and-backpressure](techniques/buffering-and-backpressure.md)
technique owns budgets, eviction, and what to do when the producer outruns
the consumer.

## Render cadence is decoupled from arrival cadence

Events arrive at machine rates — bursts of dozens per frame — and rendering at
arrival cadence melts the interface: layout thrash, input starvation, a
scrollbar that vibrates. The consumer therefore **coalesces**: events
accumulate in the live buffer at wire speed, and the renderer flushes the
accumulated delta at a perceptual cadence, as one mutation per flush. The two
clocks are independent by design; connecting them is the second ancestral
defect of this surface. The [render-throttling](techniques/render-throttling.md)
technique owns the cadence, the guaranteed trailing flush, and the scroll
contract.

## The surface never lies about state

A streaming surface makes three claims continuously, and each has a defined
truth source:

1. **"This is run X's output"** — guaranteed by run attribution, above.
2. **"It is currently doing Y"** — a human-readable phase *derived* from the
   shapes of recent events, recomputable from the event log, never a guess
   that outlives its evidence. Silence past a threshold must degrade the claim
   ("still working, no output for a while"), not freeze it. The
   [phase-derivation](techniques/phase-derivation.md) technique owns this.
3. **"It ended, and this is how"** — a terminal outcome from a closed set, in
   which *cancelled by the user*, *failed by the producer's own admission*,
   *interrupted by transport loss*, and *completed* are four different facts
   that look different and lead to different next actions. Promoting silence
   to success — rendering a stream that just stopped as if it finished — is
   the streaming form of failure spelled as empty success.

## The run lifecycle

A run is always in exactly one of these states, and the transitions are part
of the design:

| State | Meaning | The surface shows |
| --- | --- | --- |
| **pending** | requested, no event yet | an activity claim with a stall clock already running |
| **streaming** | events flowing | the live tail, the derived phase, a working stop control |
| **stalled** | live, but silent past threshold | the same, with the claim honestly degraded |
| **finalizing** | terminal signal received, settled record being written | output frozen; controls disabled, not removed |
| **settled** | record written, outcome known | the settled turn, styled by outcome |

Two rules fall out of the table, and they are the ones implementations break:

1. **Finalization is reached from every exit** — producer's done event,
   producer's error, user cancellation, transport loss, and consumer teardown
   all converge on the same idempotent finalization path, and exactly one of
   them wins. A run with two settled records, or none, is a bookkeeping bug
   that surfaces as duplicated or vanished turns.
2. **The stop control is live for the whole live region.** Cancellation is a
   first-class user right from the first pending moment, not a courtesy added
   to the happy path — and it produces a settled record that *preserves* what
   the user watched arrive.

## Accessibility posture

A streaming region updates continuously, which is exactly what assistive
technology handles worst if left undeclared.

- The live region is announced **politely and coarsely**: phase changes and
  the terminal outcome are announced; per-delta announcement is a firehose
  that renders a screen reader unusable. Throttle the accessibility
  announcements harder than the visual flushes.
- The stop control is a real button — reachable, focus-visible, and it does
  not move or vanish mid-stream while focused.
- The terminal outcome is conveyed in text, not only in color or motion.
- Reduced-motion preferences settle any streaming affectation (cursors,
  shimmer, progressive reveal) into plain appended text.

## The techniques

- [stream-parsing](techniques/stream-parsing.md) — transport chunks into
  typed events: framing, boundary carry, unknown-event forwarding, the
  malformed-frame policy.
- [buffering-and-backpressure](techniques/buffering-and-backpressure.md) —
  budgets in two currencies, head eviction, honest truncation, shedding when
  the producer cannot be slowed.
- [render-throttling](techniques/render-throttling.md) — coalesced flushes,
  the guaranteed trailing flush, visibility-aware cadence, the pin-to-tail
  scroll contract.
- [run-attribution](techniques/run-attribution.md) — run identity, subscriber
  generations, and why late events from a dead run are the defining race of
  this surface.
- [phase-derivation](techniques/phase-derivation.md) — honest human-readable
  progress derived from event shapes, with dwell smoothing and stall
  degradation.
- [cancellation-and-finalization](techniques/cancellation-and-finalization.md)
  — the stop path, idempotent finalization, outcome taxonomy, resource
  release, resume pointers.
