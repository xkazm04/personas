---
layer: technique
subject: ipc-contract
technique: call-wrapping
status: forged
laws: [one-validation-door, failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Call wrapping

The transport hands the interface world a raw primitive: "invoke this name
with this payload, get a promise back". This technique is the rule that **no
call site touches that primitive** — every crossing goes through one wrapper —
and the contract clauses (timeout classes, retry semantics, outcome-unknown
reporting) that live inside it.

## One chokepoint, mechanically enforced

The wrapper is the boundary's
[one-validation-door](../../_laws.md#one-validation-door): the single place
where timeout policy, error normalization, telemetry, environment detection,
and whatever policy next year needs can be added *once* and hold for every
call. The argument is not aesthetic. N raw call sites are N places where every
future cross-cutting concern is absent until someone visits all N — and the
site added next quarter makes it N+1, unvisited.

Two rules make the chokepoint real rather than aspirational:

- **Ban the raw primitive mechanically.** A lint rule or import restriction
  that fails on direct use of the transport primitive outside the wrapper
  module. Convention plus review catches most uses; the mechanical ban
  catches the rest, which is the part that matters.
- **The wrapper's signature is the primitive's plus policy.** It should cost a
  call site nothing to use the wrapper instead — same shape, one extra
  optional argument for the policy knobs. A wrapper that is harder to use
  than the primitive will be routed around, with lint suppressions as the
  tombstones.

## Timeout classes, not timeout numbers

Every crossing call must have a bounded wait — an unbounded await on a far
side that can stall is a hung surface with no diagnosis. But per-call ad-hoc
numbers scattered across call sites are a policy nobody can read or change.
The standard: a small set of **named timeout classes**, each with a budget and
a meaning, declared in the wrapper module:

- **interactive** (the default) — reads and light mutations the user is
  actively waiting on; a few seconds. The default class is deliberately the
  strictest: a call that needs more must *say so*, which makes slow calls
  enumerable by searching for the class names.
- **heavy** — known-expensive operations (bulk writes, scans, imports); tens
  of seconds, chosen per product.
- **kickoff** — starting a long job; short, because the correct shape for
  long work is start-fast-then-events, and the kickoff itself is cheap.
- **blocking mutation** — the exception that proves the restructuring rule.
  A mutation that runs inline to completion, cannot be cancelled, and is not
  idempotent gets a *generous ceiling*, not a tight bound: timing out such a
  call does not stop it, it only converts a slow success into "outcome
  unknown" and invites the double-execution retry. When the work cannot be
  made async yet, waiting for the real result is the safer contract; the
  ceiling exists only to bound a genuine hang.
- **none** — subscriptions and deliberately unbounded waits; permitted only
  explicitly, so that "unbounded" is a searchable decision, never a default.

**Budget membership belongs to the operation, not the call site.** Declare
which operations carry a non-default budget in one central table inside the
wrapper module, keyed by operation name, so every present and future caller
inherits the right budget automatically. A per-call override parameter must
exist (some one caller genuinely knows better), but watch its usage: when
ad-hoc call-site overrides outnumber entries in the central table, the same
slow operation is being rediscovered one call site at a time, and the callers
not yet burned are still running on the wrong budget. Class names travel in
telemetry with each call, so "which class times out in the field" is a
queryable fact — the feedback loop that keeps the budgets honest.

## Timeout is "outcome unknown", not "failed"

The wrapper's timeout races the far side's work; winning the race stops the
*waiting*, not the *work*. Unless cancellation is explicitly plumbed through
the transport and honored by the handler, a timed-out call's operation
**may still complete after the caller gave up** — and for a mutation that
means the timeout report "it failed" can be a lie the database contradicts.

Consequences the wrapper must encode:

- Timeout is a **distinct error code** — a third outcome beside success and
  refusal ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  Downstream handling differs: a refusal is safe to surface as "didn't
  happen"; a timeout must surface as "didn't confirm", and any surface that
  shows the affected data should refetch rather than assume.
- **Never auto-retry a timed-out mutation.** Retry-on-timeout is
  double-execution unless the operation is idempotent or deduplicated. Where
  automatic retry of mutations is genuinely needed, the caller mints an
  **idempotency identity** once, before the first attempt, and sends the same
  identity on every retry so the far side can collapse duplicates
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). No
  identity, no retry — reads may retry freely within a small budget; writes
  may not.
- **Near-side in-flight dedup is not idempotency.** A wrapper that folds
  concurrent calls carrying the same key into one pending promise protects
  against *simultaneous* duplicates only — the moment the original settles or
  times out, a retry is a brand-new call the dedup map has already forgotten.
  Post-timeout retry safety requires the **far side** to honor the identity
  (return the already-running or already-completed result for a seen key);
  the near-side map is a convenience for fan-in, and mistaking it for the
  safety mechanism is how a "deduplicated" mutation runs twice. State which of
  the two each operation actually has.
- **Timed out is not not-registered is not refused.** The wrapper normalizes
  the transport's failure zoo into distinguishable categories: the far side
  said no (refusal, carries the error envelope), the far side never answered
  (timeout), the far side has no such operation (registration gap — the
  [command-registration](command-registration.md) technique's territory), and
  there is no far side at all (running outside the host shell, in tests or a
  plain-browser dev mode — a detectable environment, not an error to toast).

## What the wrapper is not

The wrapper is transport policy, not business logic. Payload validation
belongs to the far side's handler (the store's own validation door); response
interpretation belongs to the caller; user-facing error copy belongs to the
[error-shape-mapping](error-shape-mapping.md) door. A wrapper that accretes
per-operation branches has become a second dispatch table — split the policy
(keep it) from the specifics (evict them to the call sites or the handlers).
