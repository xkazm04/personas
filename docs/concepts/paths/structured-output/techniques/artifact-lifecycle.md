---
layer: technique
subject: structured-output
technique: artifact-lifecycle
status: forged
laws: [identity-survives-reuse, creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Artifact lifecycle

Every artifact-producing flow — generate a configuration, draft an
automation, synthesize a report — walks the same road: spawn a producer,
watch it stream, extract from the settled text, validate, land in a terminal
state. Build that road **once** as a reusable state machine parameterized by
the parts that differ, or watch each flow re-improvise it and each
re-improvisation forget a different transition. The forgotten transition is
always one of the exits: the producer that errors mid-stream, the user who
cancels, the view that unmounts — and a flow that forgot an exit is a flow
stuck reporting "running" forever.

## The machine

| State | Entered when | Exits to |
| --- | --- | --- |
| **idle** | flow registered, or a previous run fully settled and was acknowledged | running |
| **running** | producer spawned | extracting (producer settled cleanly) · failed (producer error, cancellation, timeout) |
| **extracting** | settled text in hand; strategies, validation, repair turns executing | completed (artifact or explicit empty) · failed (no candidate / budget exhausted) |
| **completed** | artifact delivered | idle (acknowledged) |
| **failed** | any exit path's terminal | idle (acknowledged) |

Rules the table implies but implementations lose:

- **Every path out of `running` reaches exactly one terminal state.**
  Producer done, producer error, user cancel, timeout, host teardown — all
  converge on one finalization routine, idempotent, first-caller-wins. A
  flow with two terminal reports, or none, surfaces as duplicated results
  or a spinner that never dies.
- **`failed` is one state with many reasons, not many states.** The reason —
  producer error, cancelled, timed out, extraction failed with its evidence
  — travels as data on the terminal event. Downstream renders reasons
  differently; the machine does not multiply states for them
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
  the reasons must be distinguishable, and they are — in the payload).
- **Extraction happens on the settled record**, never on the live tail. The
  boundary with [streaming-output](../../streaming-output/streaming-output.md)
  is exactly here: that subject finalizes the text; this machine consumes
  the finalized text. An extractor racing the stream reads a payload that
  ends mid-token some fraction of the time, and that fraction is your new
  background failure rate.

## Single-flight per flow

Each flow key admits **one run in flight**. A second start request while
one is running is answered by policy — rejected with "already running",
or superseding (cancel-then-start) — but never raced. Two concurrent runs
of one flow are a corruption engine with three pistons: interleaved
progress events, two writers for one artifact slot, and a finalization
that reports whichever finished last as if it were the only one.

The registry that enforces single-flight is also the machine's directory:
it knows every flow's current state, which makes "what is running right
now" answerable — the question every progress surface, shutdown routine,
and support conversation eventually asks.

## Identity

Each run mints an identity at spawn and every event it emits carries it
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
Consumers apply an event only if it names the run they are watching —
the discipline [streaming-output](../../streaming-output/streaming-output.md)
calls run attribution, inherited here wholesale because supersede-and-
restart is a *normal* lifecycle operation, and the superseded run's late
events must land inert, not paint over the successor's progress.

## Progress is surfaced, not invented

While `running`, the machine relays what the live stream actually shows —
phase, recent output, elapsed time. While `extracting`, it says so; on slow
repair loops, the attempt number is honest progress ("first attempt
rejected; retrying"). What it never does is animate a fabricated
percentage: an extraction pipeline has no denominator, and a progress bar
without a denominator is a small lie that trains users to distrust the
big truths.

## Cleanup names its reaper

A run holds resources: a child process or connection, stream buffers,
listeners, a registry slot
([creation-names-reaper](../../_laws.md#creation-names-reaper)). The
finalization routine — the single convergent one — is the named reaper for
all of them, which is precisely why convergence matters: a forgotten exit
path is not just a wrong status, it is every resource on this list leaking
in a way that only shows up as the long-session slowdown nobody can bisect.
Two reaper rules: **cancellation reaps as thoroughly as success** (the
cancel path that kills the producer but strands the registry slot turns
single-flight into permanently-blocked), and **host teardown reaps
runningly** — the machine registers for the host's shutdown signal at
creation, because a producer that outlives its host is an orphan doing
unattributable work.

## What is parameterized, what is fixed

Per flow: the producer invocation, the extractor + schema (one pluggable
seam — extraction and validation plug in together, since a candidate
without its validator is half a pipeline), the event naming, the single-flight
policy on double-start, and the repair budget. Fixed for all flows: the
state set, the convergent finalization, identity discipline, and the
observability counters. The moment a flow needs a new *state*, that is a
design conversation about the machine, not a local patch — the machine's
value is exactly that its states mean the same thing everywhere.
