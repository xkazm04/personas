---
layer: technique
subject: audit-logging
technique: write-chokepoint
status: forged
laws: [one-validation-door]
shared_with: []
---

# Write chokepoint

Every promise an audit trail makes — sanitized, complete, well-formed,
bounded — is a promise about writes, and a promise about writes is only
checkable if you can point at where writes happen. This technique is the
structure that makes the pointing possible: **one insert door per ledger,
everything enforced inside it, and a short, listable set of callers**.

## One door, all properties inside it

The ledger exposes exactly one insert operation, and that operation is
where every invariant lives
([one-validation-door](../../_laws.md#one-validation-door)):

- **Sanitization** — secrets and oversized payloads are scrubbed here
  (the [write-path-sanitization](write-path-sanitization.md) technique),
  so no caller can leak by forgetting.
- **Schema** — required fields (actor, action, subject, outcome, origin)
  are demanded by the door's input type; a record missing its actor is
  unrepresentable, not merely discouraged.
- **Timestamping** — assigned here, one clock per ledger (see
  [append-only-design](append-only-design.md)).
- **Retention** — the horizon trim runs here (the
  [retention-and-partitioning](retention-and-partitioning.md) technique),
  so the ledger's size is maintained by the same code path that grows it.
- **Failure accounting** — the door is where a failed write increments
  the visible counter (the
  [best-effort-with-accounting](best-effort-with-accounting.md)
  technique).

Concentrating all five in one function has a compounding payoff: each new
invariant is one edit, effective for every writer that exists and every
writer added later. The sprinkled alternative — each call site building
its own insert — makes every invariant a campaign across N sites,
completed exactly until site N+1 ships.

## Enumerable writers

"Who writes to this ledger?" must have a short answer produced by search,
not archaeology. Practically: the door is the only code that touches the
ledger's storage; every writer calls the door by name; therefore the
writer list is the door's caller list — one query against the codebase,
verifiable in review, and stable enough to state in the module's own
documentation. When the list grows past what fits in a sentence, that is a
design smell: either callers are auditing at the wrong altitude (see
below) or one ledger is serving what should be several (see
[retention-and-partitioning](retention-and-partitioning.md)).

Enumerability is also what makes the *completeness* claim auditable. An
auditor asking "are all destructive operations recorded?" gets a
finite proof obligation: here are the destructive operations, here are the
writers, here is the mapping. Without enumerability the honest answer is
"we believe so," which is not an answer an audit accepts.

## Placement: attach to what the action cannot bypass

The chokepoint guarantees that *if* an action reaches the door, the record
is right. It cannot guarantee the action reaches the door — that is a
placement problem, and the ranked options are:

1. **A pipeline or middleware seam the operations already flow through.**
   Where a class of actions passes a common dispatch layer — a command
   pipeline, a request handler chain, a job runner — hang the audit write
   there, once, keyed on the operation's declared metadata. Coverage
   becomes a property of the architecture: a new operation added to the
   pipeline is audited on the day it ships, by code its author never saw.
   This is the strongest placement and worth minor contortions to reach.
2. **The domain service that owns the mutation.** Where no shared seam
   exists, the audit write lives in the same function that performs the
   change — not in the callers of that function. One writer per action
   type; still enumerable; forgettable only by the person editing the one
   function that also does the work.
3. **Call sites.** The fallback that isn't one: audit calls sprinkled
   where each feature happens to trigger the action. Every property
   degrades to the diligence of the most rushed contributor; coverage
   silently decays with each new entry point. If you find yourself here,
   the actual task is to build seam 1 or 2.

The placement decision interacts with the *observer* rule: the middleware
records what the operation declared and what the dispatcher observed
(operation name, actor, outcome, duration) — it does not reach into the
operation's internals. If the record needs domain detail the seam cannot
see, that detail is passed as declared audit metadata, not scraped.

## The door is not a bottleneck if it refuses to be

The standard objection to a single door is throughput and coupling. Both
have standard answers: the door does no slow work synchronously (the
write itself is best-effort and may be buffered — see
[best-effort-with-accounting](best-effort-with-accounting.md) for what
buffering must still account for), and the door's input is a plain data
contract, so callers couple to a stable shape, not to storage. What the
objection is usually protecting is the convenience of writing "just this
one" record directly — which is precisely the convenience the technique
exists to remove.
