---
layer: technique
subject: eval-harness
technique: scenario-design
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Scenario design

A scenario is the unit of question the harness asks: an input, the context it
arrives in, and a declaration of the property the answer must have. The suite
is only as good as its scenarios — a harness with pristine judges and
airtight aggregation, run over scenarios that only cover the happy path,
produces precise measurements of nothing important.

## Identity first: a scenario is a versioned fixture

Scores attach to scenario identities. Every longitudinal claim the harness
will ever make — "quality improved between versions," "the regression
appeared here" — is a comparison of scores *across time at fixed scenario
identity*. That only works if identity is minted deliberately and survives
what scenarios actually undergo: reordering in the suite, reuse across
comparison modes, regeneration of the set they belong to
([_laws: identity-survives-reuse_](../../_laws.md#identity-survives-reuse)).
Positional identity ("scenario 7") breaks on insert; name-equality breaks on
edit. The standard is a stable id plus a content version: when a scenario's
substance changes, its version advances, and the harness refuses to splice
scores across versions as if they were one series.

## Two sources, opposite failure modes

**Captured reality.** Real inputs promoted into fixtures: a transcript that
exposed a defect, a request that produced a bad answer, an edge case a user
actually hit. These are representative by construction — the distribution
they sample is the true one — and each carries a story, which makes failures
interpretable. Their weakness is coverage: they accumulate slowly, cluster
around past incidents, and systematically miss the failure the system has
not had yet. Every production incident should leave a scenario behind as its
sediment; a defect fixed without a scenario is a defect the suite has agreed
to rediscover empirically.

**Generation.** A model synthesizes scenarios from a specification — a
persona, a capability contract, a coverage matrix of situations. Generation
buys breadth cheaply and can be pointed at regions captured reality never
visits. Its weaknesses are inherited blind spots (the generator finds the
cases the generator can imagine), a tendency toward well-formed inputs, and
a second layer of non-determinism: regenerating the set produces a
*different* set.

The mature suite uses both, in ratio to maturity: young systems lean on
generation because nothing has been captured yet; the ratio shifts toward
captured reality as incidents accrue.

## The cache key is an instrument-stability decision

Generated scenarios must be cached — regenerating per run is slow, costly,
and quietly re-rolls the exam. But the *scope of the cache key* is the
subtle decision, and it is worth stating as a rule:

> The key includes everything that defines the scenario's identity, and
> deliberately excludes everything that identifies the candidate the
> scenario will be run against.

Include: the scenario specification, the generator's version, the seed, the
count requested. Exclude: the candidate's instructions, its version, its
configuration — anything that changes when the *system under test* changes.
The exclusion is what makes version deltas comparable: candidate versions A
and B face the identical instrument, so the score delta is attributable to
the candidate. Widen the key to include candidate material and every
candidate change silently regenerates the scenarios — the delta now
confounds "the system changed" with "the questions changed," and no
downstream statistics can unmix them. This is not hypothetical: measured
live, a one-line change to a candidate's instructions produced a scenario
set with zero overlap against the previous one and a double-digit
"improvement" that was pure exam drift — the most convincing kind of
phantom result, because every individual score in it was honestly computed.

The scoping has a stated tradeoff, and stating it is part of the
technique: a candidate whose substance was materially rewritten keeps
facing an exam authored before the rewrite, for up to the cache lifetime.
That staleness is bounded and visible; exam drift is unbounded and
invisible. Choose the bounded defect, and write the choice down next to
the key so a future maintainer does not "fix" it backwards.

One more cache rule earned in production: **never cache an empty
generation.** A generator that produced nothing has failed, not answered;
caching the empty set converts one transient failure into a poisoned
instrument for the cache's whole lifetime.

The key's scope is a stored derivation, and it obeys the law that stored
derivations name their recomputation
([_laws: derivation-names-recomputation_](../../_laws.md#derivation-names-recomputation)):
write down, where the cache lives, exactly what is in the key, what is
deliberately out, and what invalidates an entry — a lifetime, a generator
upgrade, an explicit flush. A cache whose invalidation story is tribal
knowledge will be flushed at the wrong moment by someone debugging, and a
comparison series will die of it.

## Cover the ugly cases on purpose

Scenario sets drift toward politeness: well-formed inputs, cooperative
users, reasonable requests. The failures that matter live elsewhere, and
they are enumerable as a checklist because they recur across every domain:

- **Degenerate inputs** — empty, enormous, duplicated, truncated
  mid-structure.
- **Adversarial inputs** — instructions embedded in data, requests to
  violate the declared contract, bait for the system's known temptations.
- **Ambiguity** — under-specified requests where the *right* behavior is to
  ask, not to guess confidently.
- **Distribution shift** — inputs from adjacent domains the system will
  plausibly receive but was not tuned for.
- **Stress compositions** — several independently-handled features in one
  request, where integration seams fail.

Tag scenarios by which region they cover, and report coverage *by region*,
never as a bare count — five hundred polite scenarios and zero adversarial
ones is not "five hundred scenarios of coverage," and any number that
travels must carry its predicate
([_laws: count-carries-predicate_](../../_laws.md#count-carries-predicate)).

## Expected properties, not expected outputs

A deterministic fixture can declare its expected output. A scenario for a
non-deterministic system declares expected *properties*: constraints any
acceptable answer satisfies (must mention, must never claim, must stay
within, must conform to). Writing scenarios this way keeps them stable
across candidate versions — outputs change freely, the property contract
endures — and it is precisely what makes the downstream split between
mechanical assertion and judged evaluation possible: properties phrased
sharply enough become assertions, and only the remainder needs a judge (see
[assertion-vs-judgment](assertion-vs-judgment.md)).
