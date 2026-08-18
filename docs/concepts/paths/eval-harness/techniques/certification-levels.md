---
layer: technique
subject: eval-harness
technique: certification-levels
status: forged
laws: [gate-sees-target, failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Certification levels

Certifying an agent, a persona, or a journey — "this reliably does its job"
— is the most expensive claim an eval harness makes, because the only full
proof is empirical: drive the real system through the real flow and watch.
Empirical certification is slow, serial where the product is a singleton,
and costly per run. The technique is to structure certification as **ordered
levels**: a cheap theoretical pass that runs broadly and in parallel, gating
a costly empirical pass that runs narrowly — so the expensive instrument is
spent only on candidates the cheap instrument could not already disqualify.

## Level one: theoretical, over a derived model

The first level never touches the live system. It reasons over a **derived
model** of it: the declared capability surface, the wiring between
components, the contracts each step depends on — extracted from the source
of truth, not from anyone's memory of it. Against that model, an evaluator
walks each declared journey and asks: does every step have a mechanism? Is
the capability the journey needs actually wired to the entity that needs
it? Do the contracts compose — does step three consume what step two
produces?

Because nothing live is exercised, level one is cheap and embarrassingly
parallel — every journey, every candidate, in one fan-out — and that
cheapness is the point: it is the wide filter. What it catches is the
large class of failures visible in structure alone: the missing binding,
the misconfigured capability, the journey step no component implements,
the contract mismatch between producer and consumer. Real defects, found
at reading-the-plans cost instead of driving-the-product cost.

Two honesty rules keep level one from overclaiming:

- **The derived model is a stored derivation** — it names how it is rebuilt
  from the source of truth and when it was last rebuilt. Certifying against
  a stale surface model is certifying a system that no longer exists.
- **A level-one pass is labeled as what it is.** "Theoretically certified"
  means *the plans check out*. The derived model is a proxy, and a gate
  that saw only the proxy has not seen the target
  ([_laws: gate-sees-target_](../../_laws.md#gate-sees-target)).

## Level two: empirical, against the live system

Level two drives the **actual running product** — through its real entry
points or a test-only control surface, but with the real components, real
wiring, real persistence, and the real model behind it — and observes what
happens. This is the only level that measures behavior, and it exists
because the failures that matter most are invisible to structure: the step
that is wired correctly and produces garbage; the flow that completes but
takes unusably long; the output that satisfies every declared contract and
would still be rejected by any user who saw it.

Level two inherits the live lane's machinery from the
[test-harness](../../test-harness/test-harness.md) subject — the control
surface, the serial constraint when the product is a singleton, readback
for fire-and-forget operations. What this subject adds is the judgment
layer on top: level-two verdicts on quality properties come from the same
pinned-judge, declared-rubric apparatus as any other eval
([judge-stability](judge-stability.md),
[assertion-vs-judgment](assertion-vs-judgment.md)), because a live run
scored by an unpinned judge is empirical theater.

And level two is where the golden path's hardest-won lesson bites: **a
gate that asserts data is not a gate on behavior.** A live run can write
every artifact, round-trip every number, exit green — and the outputs can
still be garbage a human would spot in seconds. The level-two protocol
therefore includes observation of actual outputs — sampled transcripts,
rendered artifacts, end-state inspection — not merely assertions over run
metadata. Green pipelines have shipped visibly broken work while two
confident judges scored it highly; the checklist line is "a human (or at
minimum a different instrument) looked at the thing itself."

## Promotion: declared criteria, ordered spend

The levels connect through explicit promotion rules:

- **Level one gates level two.** A candidate failing theoretically is not
  sent to the live lane — the defect is already located, and empirical
  spend would only rediscover it. The gate is economic (see
  [eval-economics](eval-economics.md)): the wide cheap filter shrinks the
  population the narrow expensive one must certify.
- **Promotion criteria are declared before the run** — which journeys, what
  pass-rate over how many trials, which quality bar under which judge
  packet. Certification awarded by post-hoc interpretation is opinion in a
  certificate's clothing.
- **A certificate names its level, scope, and instrument.** "Certified" as
  a bare word is a number without its predicate
  ([_laws: count-carries-predicate_](../../_laws.md#count-carries-predicate));
  the durable record is "certified at level N, on journeys J, at date D,
  under instrument versions V." Consumers of the certificate — release
  gates, dashboards, adoption decisions — see the level, because a
  theoretical pass presented as certification-full-stop is precisely the
  overclaim the level structure exists to prevent.
- **Certificates expire with their subject.** A certification is a
  statement about a version. When the candidate, its capabilities, or the
  journeys change, the certificate reverts to the highest level whose
  inputs are still current — usually level one, rerun cheaply — rather
  than lingering as a green badge over a changed system
  ([_laws: failure-not-empty-success_](../../_laws.md#failure-not-empty-success):
  "was certified once" must be spelled differently from "is certified").

## The ladder generalizes

Two levels is the minimum, not the law. The same ordering logic admits
finer rungs — static contract checks below level one; a mocked-model
rehearsal of the live flow between the levels; a long-horizon lane above
level two certifying behavior over days, per the long-lane discipline of
the deterministic subject. Each rung earns its place the same way: it is
cheaper than the rung above, it catches a class the rungs below cannot see,
and its verdict is labeled with exactly what it saw.
