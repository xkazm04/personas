---
layer: technique
subject: error-handling
technique: taxonomy-design
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Taxonomy design

The taxonomy is the closed vocabulary of failure kinds that every consumer —
retry policy, automated recovery, user copy, dashboards — branches on. Its
design determines whether classification happens once or is re-improvised at
every consumer.

## Closed, small, consumer-driven

- **The set is closed.** An enumerated type, not an open string field. Open
  vocabularies grow one ad-hoc value per contributor until no consumer can
  branch on them; a closed set forces every new failure kind through a
  deliberate decision: which existing category does this belong to, or what
  does a new category let a consumer do differently?
- **A category earns its place only if some consumer branches on it.**
  "Timeout" and "unreachable" deserve separate categories only if retry
  policy, recovery, or user copy treat them differently; if every consumer
  handles them identically, they are one category with two causes. Taxonomies
  designed by enumerating everything that can go wrong grow to dozens of
  entries nobody branches on; taxonomies designed from the consumers'
  questions stay under about ten.
- **The catch-all is an explicit member.** There is always a failure the
  classifier does not recognize; "unknown" is a first-class category with the
  most conservative properties (not retryable without human judgment, generic
  honest copy) — never an accidental fall-through into whichever category
  happens to be the default branch.

## The axes every consumer asks about

Whatever the category names, each category must answer three questions,
because these are the questions consumers branch on:

- **Transience — can retrying possibly succeed?** Transient (timeout,
  unreachable, throttled) versus permanent (malformed request, not found,
  forbidden, invariant violation). This is the single most valuable bit in
  the taxonomy: it is the difference between a retry loop that heals a blip
  and one that hammers a dependency with requests that can never succeed.
- **Fault line — whose situation must change?** The system's (retry,
  failover), the user's (fix the input, choose a different name), or the
  relationship's (re-authenticate, grant access, pay). This axis drives user
  copy: it decides whether the next action offered is "wait", "edit", or
  "sign in".
- **Remediation hint — what would recovery do?** Categories that automated
  recovery acts on (refresh the credential, re-establish the connection,
  back off) carry that hint as data, so recovery logic switches on the
  category rather than re-inspecting the raw error.

## Retry-interval extraction

Throttling deserves special handling: it is the one category where the
*failure itself states the remediation schedule*. When the raw error carries
a stated wait interval — a header, a structured field, a documented value —
extract it **at classification time** and carry it as a typed field on the
classified error. Consumers must never re-parse the raw error to find it;
half of them will forget, and those retry at their default cadence, which
against a throttling peer means retrying *into* the penalty window and
extending it. Absent a stated interval, the category's default backoff
applies — but the stated interval, when present, always wins.

## One authority, mirrored — never re-declared

The taxonomy is consumed everywhere failures flow: multiple layers, often
multiple languages, often across a process or wire boundary. The governing
law is [one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary):

- **Exactly one definition is authoritative** — declared once, in the layer
  closest to where classification happens.
- **Every other representation is generated from it**, not hand-maintained.
  A hand-copied mirror on the far side of a language boundary is a race with
  a delay fuse: the copies diverge exactly when someone adds a category and
  finds only one of them, and the far side's default branch silently absorbs
  the new category — the taxonomy's own catch-all defect, self-inflicted.
- **The wire format is part of the contract.** The serialized spelling of
  each category (its tag string, its casing) is fixed by the authority and
  round-trip tested, because a category that serializes on one side and
  fails to parse on the other degrades to "unknown" without any error —
  a misclassification that no gate sees.

## Evolving the taxonomy

- **Adding a category** is safe when every consumer has a total match
  (compilers enforce exhaustiveness) or a deliberate catch-all with
  conservative behavior. Add the category at the authority, regenerate
  mirrors, then teach consumers — in that order.
- **Splitting a category** (one kind becomes two) is the common real-world
  evolution: some consumer discovers it needs to treat two causes
  differently. Split at the authority and let exhaustiveness checking walk
  you through every consumer; the sites the compiler cannot reach (wire
  parsers, stored historical values) are the ones to audit by hand.
- **Never repurpose a tag.** A stored or logged category value is a
  historical record; reusing its spelling for a different meaning corrupts
  every dashboard and every stored failure retroactively.
