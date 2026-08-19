---
layer: technique
subject: codebase-scanning
technique: incremental-scanning
status: forged
laws:
  - gate-sees-target
  - derivation-names-recomputation
shared_with: []
---

# Incremental scanning

A full scan of a large codebase costs minutes to hours; the code that
changed since the last scan is usually a few files. Incremental scanning —
re-examining only what changed — is what makes scanning cheap enough to run
continuously instead of quarterly. It is also the family's most reliable
source of quiet dishonesty, because every incremental result is a statement
about a *subset* wearing the clothes of a statement about the *whole*. The
technique is the bookkeeping that keeps the economics without the lie.

## Change detection keyed on content, not on clocks

The incremental engine maintains a ledger: for every scanned unit, an
identity, a content digest from the last examination, and the ruleset
version it was examined under. A unit re-enters scan scope when any of the
three moves — its content digest changed, it is new to the ledger, or the
rules it was judged under have since been revised. That last trigger is the
one naive implementations omit: **a rule change invalidates every unit's
clean status under that rule**, or else the scanner reports units as clean
under standards they were never held to. Timestamps make a poor primary
key for change — they move without content changing and (on some stores)
fail to move when it does; digests answer the question actually being
asked.

## Labeled honestly: incremental is a different claim than full

An incremental result must carry its own scope: *these findings reflect
re-examination of N changed units; the remaining population carries
findings from prior sweeps.* Presenting an incremental sweep's small, calm
finding count as the health of the whole population is the technique's
signature deception — the number is true and the implication is false. The
report therefore distinguishes, always: what was re-examined this run, what
stands on prior examination and how old that examination is, and what has
*never* been examined. The unexamined-by-anything category must be printed,
not assumed empty; a scanner that cannot enumerate what it has never
looked at does not know its own coverage.

## The dependency-closure trap

Per-unit change detection embeds an assumption: that a unit's findings
depend only on that unit's content. Every interesting codebase violates
this. A change in one module can create a violation in an *unchanged*
module — a renamed export orphans its importers, a widened type invalidates
a caller's assumption, a deleted implementation strands a registration.
Cross-unit rules therefore declare their input span, and the incremental
engine expands the re-scan set to the dependency closure of the change —
or, where the closure is unknowable or too expensive, the rule is honestly
classified as **full-scan-only** and its findings are labeled with the last
full sweep that produced them. The failure mode this prevents is precise:
an incremental gate that checks only changed units passes exactly when the
violation it exists to catch lands in an unchanged one
([gate-sees-target](../../_laws.md#gate-sees-target)) — the check read a
proxy for the population, and the proxy diverged.

## Staleness decays; findings do not stand forever

A finding (or a clean bill) from an examination N sweeps ago is weaker
evidence than one from this morning, and the pipeline says so: results
carry their examination timestamp, surfaces render staleness, and
sufficiently old results decay from "known" to "unknown" rather than
standing as eternal fact. The decay horizon is domain-owned, but the
principle is not: **an assertion about code inherits the age of the last
time anything actually looked**, and an incremental system that never
decays converts its oldest unexamined corners into permanent phantom
confidence.

## The full scan is the incremental ledger's named recomputation

The ledger — digests, clean statuses, standing findings — is a derived
artifact, and like every stored derivation it must name how it is recomputed
from scratch
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
That recomputation is the scheduled **full scan**: it re-anchors every
digest, re-examines every unit under the current ruleset, expires findings
whose sites no longer exist, and — critically — *diffs its results against
what the incremental ledger predicted*. Drift between the two is the health
metric of the incremental machinery itself: zero drift earns confidence in
the cheap path; recurring drift in some rule family means that family's
dependency declarations are wrong and it must be demoted to full-scan-only.
Run the full scan on a cadence, run it after any change to the incremental
engine itself, and treat "we stopped scheduling full scans because
incremental seemed fine" as the announcement that the ledger has begun its
slow divergence from the world, unwitnessed.
