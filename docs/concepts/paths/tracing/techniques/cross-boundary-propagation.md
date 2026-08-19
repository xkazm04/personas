---
layer: technique
subject: tracing
technique: cross-boundary-propagation
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Cross-boundary propagation

A run worth tracing rarely stays in one process. It starts in an interface,
crosses into an engine, spawns a subprocess, calls a remote producer, and may
hand off to a *successor run* hours later. The trace is only a tree if the
identities — trace id and parent span id — **survive every one of those
handoffs**. Each boundary that drops them fractures the record into fragments
that no viewer can rejoin, and the fracture is discovered exactly when
someone needs the end-to-end view: during an incident.

The rule: **identity crosses every boundary explicitly, as data in the
handoff envelope — never reconstructed on the far side, never inferred from
timing or naming.**

## The propagation contract

Two values travel: the **trace id** (which run) and the **parent span id**
(where in the tree the receiver's work attaches). The receiving side:

1. **adopts** the trace id — it must not mint a new one when handed one;
   double-minting is the most common fracture, and it is invisible locally
   because each fragment looks healthy on its own;
2. **opens its root-of-this-boundary span as a child** of the received
   parent id;
3. **propagates onward** — the contract is transitive; a middle tier that
   consumes the ids but forwards nothing re-fractures everything below it.

The carrier is explicit and boring: a named field in the request, the job
payload, the message envelope, the spawn arguments. Ambient carriers —
thread-locals, globals, "the current trace" — work in one process and betray
you at every queue, pool, and async boundary, because ambient context does
not follow the work; the envelope does.

## Boundary catalog

- **Process and language boundaries** (interface ↔ engine, engine ↔
  subprocess): the ids ride the invocation payload. Serialization must
  round-trip them byte-exactly — identity that survives reuse and restart is
  the law's requirement
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)), and a
  lossy re-encode (case-folding, truncation, re-formatting) is a silent
  identity change.
- **Queues and schedulers**: the ids are persisted *with the job*, because
  the dequeue may happen after a process restart, on another machine, next
  week. A job record without its trace identity permanently detaches
  everything the worker does.
- **Cooperative external producers**: pass the identity in whatever
  correlation slot the producer offers, so its own records can be joined back
  later. When the producer offers none, the caller's span *is* the boundary:
  everything the producer did is attributed to that one span, honestly
  opaque.
- **Parallel identity namespaces**: real runs accumulate ids — the run
  store's key, the trace id, an external protocol's correlation id, the
  producer's own session id. A second namespace is permissible **only if the
  join to the first is itself recorded** — a field on the same record, not a
  convention in someone's head. An id minted into its own namespace and
  never joined is not correlation; it is a second, unreachable story about
  the same run, and each unjoined namespace multiplies the guesswork of
  every future investigation.
- **Chained and successor runs**: see below — continuation is a decision,
  not a default.

## Chained runs: continue, or link — decide, don't drift

When run B is caused by run A — a follow-up turn, a healing attempt, a
scheduled successor — there are exactly two honest structures:

- **Continuation**: B's spans join A's trace, as children of the handoff
  point. Right when A and B are one logical run in the user's mind and the
  gap between them is short. The cost: the trace's lifetime and ceiling now
  span both.
- **New trace with a link**: B mints its own trace id and records A's
  identity as a *predecessor reference* (and A, when still writable, records
  a successor reference). Right when B is operationally its own run —
  separately retried, separately retained, separately billed.

Either is defensible; the failure mode is deciding *neither*: B silently
starts fresh with no reference, and the causal chain — the very thing an
investigator walks — exists only in someone's memory. Products with retries,
healing, or scheduling need the linked form as their default, because those
successor runs are precisely the ones investigated most.

## Clocks skew; only durations are portable

Each process stamps spans from its own clock, and clocks across process and
machine boundaries disagree — by milliseconds on one host, by seconds across
hosts. Two rules keep the waterfall honest:

- **A duration is trusted only from the clock that measured both ends.**
  Never compute an interval from a start stamped by one process and an end
  stamped by another; that interval measures clock skew, not work.
- **Alignment is a render-time adjustment, not a data mutation.** The viewer
  may shift a child fragment so it nests plausibly inside its parent (a child
  that "starts before" its cause is skew, not time travel), but the stored
  stamps stay as recorded, with the clock domain noted. Rewriting stamps at
  capture destroys the evidence needed to correct alignment later.

## Verify the seam, not the halves

Propagation bugs live *between* components, where neither side's tests look.
The test that catches them is end-to-end by construction: drive a run across
every boundary the product has — interface to engine, engine to subprocess,
across one queue, across one chained handoff — then assert **one trace id,
one root, zero orphans** in the assembled tree. Run it whenever a boundary
changes shape. Every fracture this technique names was shipped by a team
whose per-component trace tests were green.
