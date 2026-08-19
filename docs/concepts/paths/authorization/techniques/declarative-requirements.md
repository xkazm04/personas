---
layer: technique
subject: authorization
technique: declarative-requirements
status: forged
laws: [gate-sees-target, one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Declarative requirements

The gate at the dispatch chokepoint can only enforce what it can read. This
technique is about the *form* in which each operation's authorization
requirement exists: **as declared data attached to the operation's
definition, extracted mechanically into the registry the gate consults** —
never as imperative checks scattered through handler bodies, and never as a
hand-maintained table living apart from the code it describes.

## Why declaration beats convention

Three forms compete for where a requirement lives, and only one survives
contributor turnover:

1. **In-handler checks** ("each handler knows its needs") — N copies of the
   decision, drifting independently, executing *after* untrusted input has
   been parsed. Coverage equals the discipline of the least careful author,
   forever.
2. **A central table maintained by hand** ("one place to review") — better,
   but the table and the handlers are now two artifacts describing one
   truth, and nothing forces an author adding operation 214 to visit the
   table. The table is a proxy for the code; the gate reads the proxy; the
   proxy diverges precisely when someone forgets — the
   [gate-sees-target](../../_laws.md#gate-sees-target) failure, verbatim.
3. **An annotation on the operation definition, mechanically extracted** —
   the requirement is *adjacent* to the code it governs (one screen, one
   diff, one review), and the registry the gate reads is *derived* from the
   annotations by the build, so it cannot drift from them. This is the
   technique.

Adjacency and derivation split the two failure modes between them: adjacency
makes the declaration reviewable (a requirement change and a behavior change
appear in the same diff, so the reviewer sees "this operation now writes to
disk *and* its tier didn't change" as one anomaly); derivation makes the
gate's view complete (the registry is regenerated from the annotations, so
a stale registry is a build failure, not a silent gap).

## The totality rule: unannotated is unbuildable

Declaration only kills default-creep if it is **total**: an operation with
no annotation is a build error, not a default tier. The enforcement wants to
live as early as the toolchain allows — ideally the same mechanism that
registers an operation with the dispatcher *requires* the requirement as a
parameter, making "registered but unclassified" unrepresentable rather than
merely detected. Where the platform offers attribute macros, decorators, or
annotation processors, the registration form and the requirement declaration
should be one syntactic unit; where it does not, a build-time linter over
the registration sites is the floor. The test of the mechanism: **can a
motivated author register a working operation without stating its
requirement?** If yes, one eventually will, under deadline, with the most
sensitive operation of the quarter.

## The annotation is the single source

Whatever the gate, the tripwire guards, the audit log, and the
documentation say about an operation's requirement, they all derive from
the one annotation
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to requirements). The corollaries:

- The in-handler tripwire (defense-in-depth layer of
  [dispatch-chokepoint-gating](dispatch-chokepoint-gating.md)) references
  the operation's declared requirement — it never re-states the tier as a
  second literal, because two literals disagree eventually and the
  disagreement is invisible until exploited.
- Generated artifacts — the operation catalog the UI reads, the security
  review table, the public documentation — are emitted by the same
  extraction, so the table a reviewer audits *is* the table the gate
  enforces, at the same revision.
- The extraction itself asserts its instrument: extracting zero annotations
  from a codebase known to register hundreds of operations is a fatal
  extraction failure, never an empty-but-green registry.

## When annotation and registry coexist, drift has two directions

The transitional state every real system passes through — and some never
leave — is an annotation on the handler *and* a separately maintained list
the gate reads. Two artifacts, one truth, and the danger is subtler than
"they drift": **each artifact typically enforces for a different subset of
operations** (one execution shape, one tier, one transport), so drift fails
in *opposite directions* depending on which subset the forgotten operation
lands in:

- where the **list** enforces, annotated-but-unlisted **fails closed** —
  every call refused, a visible availability incident, found within days
  because someone's feature broke;
- where the **annotation** is only advisory, annotated-but-unlisted is
  **silently unprotected** — the operation dispatches ungated, nothing
  breaks, nobody looks, and the author reasonably believes the annotation
  they wrote is protecting it.

The second direction is the disclosure; the first is the alarm. A design
review of any dual-artifact scheme must map, per operation shape and tier,
*which artifact is load-bearing* — because contributors will reason about
all shapes as one mechanism, and they will be wrong in the quiet direction.

Until the registry is derived and the duality is gone, the floor is a
**reconciliation gate**: an automated check that walks the annotations and
the list and fails on any asymmetric member. Two disciplines make it a real
gate rather than a comfort: it **asserts its instrument before its result**
([failure-not-empty-success](../../_laws.md#failure-not-empty-success) — a
walk that found zero annotations in a codebase known to have hundreds is a
broken walk, never a clean codebase), and its tolerated-exceptions baseline
is **typed, reasoned, and shrink-only** — every entry carries why it is
tolerated, and an entry that becomes resolved must be deleted, so the
baseline cannot quietly become the place unclassified operations go to
live.

## What the annotation carries

Minimum viable: the **tier**. Complete: tier, required **scopes** (for
operations below the brokered boundary), and — worth the column even when
sparsely used — a free-text **justification** for any operation whose
assignment would surprise a reviewer (the public operation that looks
sensitive, the elevated read). The justification field converts the
periodic tier audit from re-derivation into spot-checking, which is the
difference between an audit that happens and one that is perpetually
scheduled.

## Failure modes this form does not cover

Honesty about the boundary: declaration binds requirements to operations
*registered with the dispatcher*. Code paths that bypass dispatch — internal
reuse of handler logic, alternative transports added later — inherit
nothing. That gap belongs to the tripwire layer and to the architectural
rule that new transports route through the same gate; the declaration
mechanism should make that easy (the registry is queryable by any gate, not
welded to one dispatcher), but it cannot make it automatic.
