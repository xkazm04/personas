---
layer: technique
subject: authorization
technique: failure-direction
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Failure direction

Every component fails; an authorization subsystem is distinguished by the
*direction* it fails in. This technique is one rule and its systematic
application: **every degraded state the authorization path can enter
resolves to refusal.** Fail-closed is not a preference among equals — the
two directions have asymmetric, irreversible costs. A fail-closed outage is
an availability incident: visible, bounded, fixed by fixing the subsystem.
A fail-open interval is a disclosure: invisible while it happens, unbounded
in what walked out, and unfixable after the fact. You can apologize for
downtime; you cannot un-disclose.

## Enumerate the degraded states — each is a decision

"Fail closed" stays a slogan until it is applied to the *specific* ways the
decision path degrades. The checklist a design review walks:

- **The unlisted operation.** An operation the requirement registry does not
  know → refused. The unlisted case is the default-deny case; a
  pass-through here re-opens the exact hole default-deny closed.
- **The unparseable rule.** A grant record whose scope field is corrupt, a
  requirement annotation that fails to parse → the *most restrictive*
  reading, and loudly. The seductive bug is the quiet one: a parser that
  maps "couldn't read the restriction list" to "no restrictions" has
  converted data corruption into privilege escalation. Corrupt-input
  restrictiveness deserves its own regression tests, because it is exactly
  the branch nobody exercises manually.
- **Absent versus corrupt are different facts.** A record with *no*
  restriction recorded (a legitimate, reviewed state) and a record whose
  restriction *failed to load* (an error) must resolve differently — the
  first to its documented default, the second to maximum restriction. Per
  [failure-not-empty-success](../../_laws.md#failure-not-empty-success),
  collapsing the two makes the error case inherit the legitimate case's
  permissiveness, silently.
- **The errored lookup.** The store holding grants is unreachable, the
  query times out → refuse, with an error distinguishable from "denied on
  the merits" (the caller's remediation differs: retry versus request
  access). Never serve a cached *allow* past its honesty horizon: a short,
  bounded decision cache is an availability tool; an unbounded one is a
  revocation bypass.
- **The missing proof.** Absent channel proof, malformed proof, wrong proof
  → one uniform refusal, evaluated in constant time. Distinguishing "no
  such token" from "almost right token" in the response or its timing is
  an oracle handed to the probing caller.
- **The crashed gate.** An exception *inside* the decision logic → refuse.
  The wrapper that calls the decision kernel treats "the kernel threw" as
  deny, structurally — an unhandled error escaping upward into "proceed to
  dispatch" is the catastrophic wiring, and it happens whenever
  authorization is bolted on as middleware whose failure the pipeline
  interprets as absence.

## Fail-closed needs a debugging story, or it gets removed

The operational failure mode of fail-closed is social, not technical: a
subsystem that refuses opaquely under degradation gets bypassed by the
people it inconvenienced. Every "when in doubt, refuse" branch therefore
pairs with legibility: the refusal names *which* degraded state produced it
(in the audit trail — not necessarily in the caller-visible response), and
degraded-state refusals are counted separately from merits-denials on the
health surface. "The gate is refusing because the grant store is
unreachable" is a fixable incident; "everything is mysteriously denied" is
the prelude to someone commenting the gate out under deadline — deletion
offered as repair.

## The kernel: pure, total, and tested at the corners

The strongest structural aid to fail-closed is making the decision function
**pure and total**: identifiers in, allow/deny plus reason out, no side
effects, every input combination mapped to an explicit outcome — corrupt
and absent inputs included. Purity makes the corner cases unit-testable
without infrastructure, and the tests to write first are precisely the
degraded ones: the empty scope list authorizes nothing; the corrupt record
resolves stricter than the absent one; the near-miss identifier does not
match. The kernel is also where the *one* authoritative deny/allow decision
lives ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to the decision itself): wrappers add transport and logging, never
a second opinion.

## Graduated enforcement is a migration state, not a destination

Rolling a new restriction onto a live system sometimes warrants a
**warn-only** mode: evaluate, record the would-be denial, allow anyway —
observation before enforcement, so the rollout's blast radius is measured
rather than guessed. Two disciplines keep warn-only from becoming the
permanent posture:

- warn-only is **per-restriction and dated** — a migration with an owner
  and an exit criterion, reviewed like any other temporary risk, not a
  global mode that quietly becomes the default;
- the *resolution rules above still apply inside it*: a corrupt restriction
  in warn-only mode resolves to **enforce-and-block**, not to warn —
  degradation must never grant more permissiveness than the healthy state
  would have.

The end state is always enforcement. A warn-only rule older than its
migration window is a decision nobody is willing to own, generating audit
noise that trains operators to ignore the very records the rollout was
supposed to validate.
