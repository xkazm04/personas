---
layer: technique
subject: proactive-nudges
technique: efficacy-feedback
status: forged
laws:
  - count-carries-predicate
  - deletion-is-not-repair
shared_with: []
---

# Efficacy feedback

The loop that makes a proactive system converge instead of merely being
capped: record what the user did with each delivered nudge, aggregate per
kind, and let the aggregate move that kind's allowance. Without it the
policy layer is static rationing — fair, but incapable of learning that
half its ration is being spent on messages nobody wants.

## Outcomes: a small closed set

Every delivered nudge resolves to exactly one outcome:

- **acted** — the user followed the nudge's affordance (opened the
  subject, ran the suggested step, clicked through). The strongest
  positive signal and the only one worth optimizing for.
- **dismissed** — the user explicitly waved it away. A weak negative:
  "not now" or "not this," deliberately ambiguous, and the record keeps
  it ambiguous rather than guessing.
- **ignored** — the nudge aged out with no interaction. The quiet
  majority outcome and, sustained, the strongest negative signal: the
  user does not consider this kind worth even the dismissal gesture.
- **expired-undelivered** is *not* an outcome of this loop — it never
  reached the user and says nothing about their preferences; it feeds cap
  and queue tuning instead. Mixing the two poisons the efficacy read.

Attribution requires the delivered record to carry the nudge identity and
kind forever; the outcome table is a join on identity. Aggregates are
reported with their predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
"maintenance-due: 2 acted / 1 dismissed / 9 ignored over 30 days" — never
a bare score whose window and denominator are folklore.

## Adaptation: down on ignore, never up on urgency

The core asymmetry:

> **Sustained non-action lowers a kind's budget toward a floor. Nothing
> raises a kind's volume — recovery is earned by the acted-rate of the
> few deliveries the floor still allows.**

- Adaptation moves **per-kind caps only**, within the global ceiling; the
  user's total contact never rises because one kind performs well.
- The response is slow and hysteretic: a rolling window long enough to
  see through vacations, a floor above zero (so the kind can still earn
  its way back), and movement in coarse steps. A twitchy budget teaches
  users that the system's behavior is weather.
- The floor exists because ignore-driven decay to zero is a silent
  self-kill: the kind vanishes, nobody decided that, and the record shows
  only a budget that drifted. Going to zero is reserved for the explicit
  kill switch — a human decision, recorded as one.
- Escalation on ignore — louder, earlier, more often — is the
  anti-pattern this technique exists to forbid. Ignoring *is* the vote.
  The legitimate response to "important kind, ignored anyway" is
  re-designing the nudge's content or affordance, not amplifying its
  delivery.

## The kill switch

- Per-kind opt-out, reachable **from the nudge itself** ("stop telling me
  this") — the moment of irritation is the moment the control must be in
  reach; a buried settings page converts irritation into channel-level
  revocation instead.
- Honored absolutely and immediately: evaluator may still run (its signal
  can feed passive surfaces), but the kind admits nothing to the delivery
  queue. Killed is a state the operator can list and revert.
- A killed kind is the policy *succeeding*. The temptation to treat high
  kill rates as a reason to remove the switch — or to reword the kind
  and relaunch it under a new name, resetting its record — is
  [deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) in
  reverse: laundering the defect's visibility instead of fixing the
  kind. A relaunched kind inherits its predecessor's record.

## Decision rules

- Instrument outcomes from the first shipped nudge. Retrofitted efficacy
  starts its window at retrofit time, and the noisiest kinds are
  precisely the ones whose history is then missing.
- Never infer "acted" from ambient behavior ("they opened that screen an
  hour later"); attribution is through the nudge's own affordance or not
  at all. Optimistic attribution inflates exactly the kinds that deserve
  cutting.
- Review the per-kind table on a cadence with a human in the loop. The
  automatic layer bounds damage between reviews; it does not replace the
  product judgment of whether a kind should exist.
