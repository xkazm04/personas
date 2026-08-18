---
layer: technique
subject: background-jobs
technique: job-progress-and-cancellation
status: forged
laws: [identity-survives-reuse, failure-not-empty-success, creation-names-reaper]
shared_with: []
---

# Job progress and cancellation

A job is background work long enough to be watched: an export, a reindex, a
bulk import, a render. The moment work crosses from "tick" to "job", it
acquires a contract with its observers — identity, progress, cancellation,
and re-attachment — and most of the defects in this genre are one clause of
that contract skipped because the first implementation only needed a spinner.

## Identity first

A job's identity is minted once, at admission — by the runner, or by the
requester and handed in (which additionally lets a retried request deduplicate
against itself) — and every other clause hangs off it: progress reports carry
it, cancellation targets it, re-attachment queries it, the terminal record
stores it, and every observer-side event handler filters on it, because a
channel that carries several jobs' updates will otherwise cross-wire them. The
tempting shortcuts all break under reuse
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): keying a
job by its *kind* ("the export") breaks the moment two run concurrently or
back-to-back — a viewer of the old job attaches to the new one, a cancel
aimed at one kills the other, and a stale completion event dismisses fresh
progress. The viewer holds a job id, not a job type.

## The progress model

Progress exists to answer three observer questions — is it moving, how far
along, how much longer — and each has an honesty rule.

- **Is it moving?** Report a monotonic heartbeat: last-activity time, or a
  current-phase marker that changes. This is the one signal that must never
  lie, because it is what distinguishes slow from stuck. A progress value
  repeated unchanged for minutes with no liveness signal alongside it is
  indistinguishable from a dead job.
- **How far?** Normalize to a declared unit: `done / total` where a total
  exists. Choose units that advance steadily (bytes, items, steps) over units
  that reflect phases of wildly unequal cost. When the total is genuinely
  unknown, say so — an *indeterminate* phase rendered as such beats a
  fabricated percentage, and the classic sins (a bar that sits at 99%, one
  that jumps 10→90→10 across phases, one that goes backwards without
  explanation) are all totals invented to avoid admitting indeterminacy.
  Multi-phase jobs declare their phases and weight them explicitly; the
  weights are estimates, but *declared* estimates, revisable in one place.
- **How much longer?** ETA is a derived guess and is presented as one:
  computed from recent throughput (not lifetime average, which lags phase
  changes), smoothed, shown at honest precision ("about 2 minutes", not
  "1:57"), and withheld entirely early on when the sample is noise. An ETA
  that counts up, or oscillates wildly, costs more trust than no ETA.

Progress is a **read model, not a control channel**: the job writes it,
observers read it, and nothing about the job's execution depends on anyone
reading. Throttle its publication (by time or by delta) so a hot loop does
not flood the channel; the observer needs a few updates per second at most.

## Cancellation is cooperative

Killing a job mid-write corrupts; therefore cancellation is a *request*, and
the job's cooperation is the mechanism. The shape:

- **A cancel token per job**, checked at safe points — between items, between
  phases, before each expensive step. Granularity is a design choice: checks
  too sparse make cancel feel ignored; the cost of a check is near zero, so
  err toward frequent.
- **Cancel is acknowledged in two steps.** The request flips the job to a
  *cancelling* state immediately (the observer's click must visibly land),
  and the job reaches its terminal *cancelled* state only when it has
  actually stopped and cleaned up. Collapsing these two states is how UIs
  end up showing "cancelled" over a job still writing output.
- **Cleanup is part of cancel.** Partial artifacts are removed or clearly
  marked partial; claimed resources are released; anything the job created
  names its reaper and the cancel path runs it
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)).
- **Some spans are honestly uncancellable** — a non-interruptible external
  call, a transaction that must land atomically. The token is checked before
  and after such a span, and the *cancelling* state is allowed to persist
  visibly through it. What is not allowed is pretending: reporting cancelled
  while the span completes and commits behind the observer's back.

Runtime shutdown reuses this exact path: the supervisor's stop sequence
cancels live jobs through their tokens, which is why jobs built to this
contract make [graceful shutdown](loop-supervision.md) nearly free.

## Terminal states are events, progress is a stream

A job ends in exactly one of a closed set of terminal states — **completed ·
failed · cancelled** (plus *interrupted*, applied by the
[startup sweep](startup-sweeps.md) to jobs a dead process left behind) — and
these are different facts requiring different renderings and follow-ups
([failure ≠ empty success](../../_laws.md#failure-not-empty-success):
"completed, 0 items" and "failed" and "cancelled" must never collapse into
one gray endpoint). Deliver terminal transitions as **discrete events on a
reliable channel**, separate from the lossy, throttled progress stream: it is
acceptable to miss a progress frame, and unacceptable to miss the ending. The
terminal event carries the summary (outcome, counts with predicates, error,
duration); the progress stream just stops.

## Re-attachment: the snapshot API

The observer is not the owner. A viewer navigating away, a window closing, a
client restarting — none of these touch the job. The corollary is that any
viewer must be able to (re)attach cold, and the mechanism is a **snapshot
API**: given a job id (or "the live jobs of kind X"), return the full current
state — status, phase, progress values, start time, and a bounded tail of
recent log lines — sufficient to rebuild the watching UI without replaying
history. Live updates then layer on top: attach = snapshot + subscribe, with
updates ignored if they predate the snapshot.

The log tail deserves its own bound: keep a ring of the last N lines per
job, not an unbounded transcript in memory. Full logs, where they matter,
belong to durable storage the snapshot can point at, not to the live channel.

Re-attachment is the clause most often skipped — a progress UI wired only to
events-since-mount works perfectly in every demo and shows a blank panel to
anyone arriving mid-job. Design the snapshot first and treat the event stream
as its delta feed; that ordering produces both.
