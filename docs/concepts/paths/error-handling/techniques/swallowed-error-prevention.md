---
layer: technique
subject: error-handling
technique: swallowed-error-prevention
status: forged
laws: [gate-sees-target, count-carries-predicate]
shared_with: []
---

# Swallowed-error prevention

The swallowed catch — a handler that catches a failure and lets it reach no
door — is the dominant error-handling defect in long-lived codebases: more
common than crashes, more common than bad copy, more common than
misclassification, because it is the path of least resistance at every site
where a failure feels unimportant, and because it produces no symptom where
it happens. This technique is about why the usual enforcement fails to stop
it, and what actually works.

## Why the gate misses: syntax is not the condition

The standard enforcement is a lint rule against the empty catch block. It is
worth having — and it is almost entirely beside the point, for a reason the
law [gate-sees-target](../../_laws.md#gate-sees-target) names: the gate
observes a proxy (the catch block's emptiness) instead of the target (does
the caught failure reach a door). The swallow that survives is never empty:

- it logs to a debugging console nobody ships or watches;
- it sets a local flag or state no one reads for reporting;
- it returns a fallback value — right behavior, no door;
- it adds a code comment — documentation of the swallow, not a door.

Every one of those bodies is non-empty, green under the gate, and erased
from the operator's world. A gate at maximum strictness with zero findings
coexists comfortably with hundreds of routed-nowhere handlers — the gate
worked; it just gated a different condition than the standard.

The same mechanism explains a pattern measured repeatedly: **two syntaxes
for the same concept, wildly different compliance.** Where a rejection-
handler idiom is visited by a rule and the equivalent catch-block idiom is
not, adoption of the routed path diverges by tens of points *in the same
codebase, among the same authors, in the same review culture*. The
difference is not discipline; it is which syntax the gate could see.
Discipline follows tooling reach, which means the fix is tooling reach.

## Measure door coverage, with the predicate stated

Because the defect is invisible at its site, health is established only by
counting — and per
[count-carries-predicate](../../_laws.md#count-carries-predicate), the count
means nothing without its predicate. The useful census:

- **Denominator:** every catch site in production code (catch blocks *and*
  rejection handlers *and* result-inspection branches — the defect lives in
  whichever form the gate ignores).
- **Numerator:** sites whose body reaches a recognized door — one of the
  sanctioned helpers, a telemetry call, an escalating rethrow whose chain
  ends in a door.
- **Report the gap as a list, not just a rate.** The rate trends; the list
  is actionable. Classify the gap by what the body *does* instead
  (console-only, fallback-only, flag-only, truly empty) — the classes have
  different fixes and different risks.

Expect the first census to shock. Then make the number a ratchet: the count
may fall, never rise, enforced at review or in a scheduled check.

## Make the routed path the cheap path

Counting reveals; structure fixes. The swallow wins because at the moment
of writing, the swallow is the cheapest thing that compiles. Invert that:

- **One-call door helpers** (the pair from [error-doors](error-doors.md)):
  when routing a failure costs one call with two arguments, the swallow's
  cost advantage drops to near zero and review can demand the call
  unconditionally.
- **Absorb the catch into the helper.** Even cheaper than "call this in
  every catch" is "you don't write the catch": wrappers that take the risky
  operation and the routing choice, own the catch internally, and return a
  settled result. Sites that never contain a catch block cannot contain a
  swallowed one — the door count becomes structural
  rather than disciplinary.
- **Declare the legitimate drops.** The genuinely intentional cases —
  probes where failure is an expected answer, cleanup where nothing is
  lost — get an explicit, greppable marker that states the justification.
  This converts the census's remainder from "unknown risk" to "audited
  list", and makes an *undeclared* bare swallow unambiguous in review.

## Keep the gate honest over time

- **Extend the gate toward the target as far as static analysis allows:**
  flag catch bodies with no call into the sanctioned door set, not just
  empty ones. The gate will still have blind spots; the census covers what
  the gate cannot see, and the gap between gate findings and census
  findings is itself a number to watch.
- **Enforcement level is part of the design.** A rule that only warns,
  in a codebase whose gates ignore warnings, enforces nothing at either
  commit or merge — it changes behavior only through editor feedback. If
  the standard is mandatory, the rule fails builds; anything softer is
  advice wearing a uniform.
- **New code first.** Ratchets and strict gates apply cleanly to new and
  touched code; bulk-fixing hundreds of legacy swallows in one pass
  produces unreviewable diffs and regressions in the least-tested paths.
  Fix-as-you-touch, with the census tracking the ratchet.
