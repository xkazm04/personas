# Experiment plan — is a relation-traversal lane worth building?

**Status: deferred by decision, 2026-08-28.** Not because the question is
settled, but because Gate 0 below needs a mass of real companion turns we do
not have yet. Revisit when we do. This document exists so that revisit starts
from a design instead of from an argument.

Companion recall works well today. That is the reason to be careful rather
than the reason to skip the question: a system that already works is exactly
where an improvement is most likely to be imagined, and least likely to be
noticed if it is real.

Background and the tree facts this rests on:
[memory-graph-and-storage-engine-assessment.md](memory-graph-and-storage-engine-assessment.md).

## What we are actually deciding

Not "should we add a traversal lane." The lane is the cheap half. Its input
does not exist:

- `companion_edge` — no writer, no reader.
- The markdown `links:` frontmatter that `graph.rs` declares its source of
  truth — **nothing writes that either**.

So building the lane means also building a **producer**: something that
decides which memories support, contradict or supersede which. That is the
expensive, assumption-laden half, and it carries the real risk. A wrong edge
does not merely fail to help — it drags a plausible, irrelevant item into the
slice behind a confident seed, which is worse than the absence it replaces.

**The question under test is therefore: can we produce typed relations good
enough to be worth traversing, and would traversing them reach anything our
four existing lanes miss?**

## Why not a live A/B

One user, one companion. Turn-level outcome differences will never reach
significance, and an underpowered online test that returns "no effect" is
indistinguishable from one that returns "no effect yet" — which is the exact
assumption this plan is meant to prevent.

The instrument is **paired offline replay**: the same historical turn, scored
under both configurations, differences measured within-pair. Vastly more power
than an unpaired online split, no user exposure, and repeatable against a
frozen snapshot.

## The gates

Cheapest first. Each one can end the project, and ending it early is a
success, not a failure.

| Gate | Question | Cost | Kill if |
| --- | --- | --- | --- |
| **0. Ceiling** | How often does recall miss something *for this specific reason*? | One labeling run, **no code** | Rate ≈ 0 |
| **1. Producer** | Can we extract typed edges that are correct? | Batch extraction on a sample + hand-check | Precision below the threshold set in advance |
| **2. Contribution** | Does traversal reach anything the other lanes did not? | Shadow replay, no labels | Unique-contribution ≈ 0 |
| **3. Quality** | Do the changed slices produce better answers? | Judge only the changed turns | No paired win |

### Gate 0 — the ceiling, and the only gate that matters right now

**Requires no implementation at all**, which is why it is first. Sample
historical companion turns. For each, present a judge with the slice the
system actually produced and the memory corpus it drew from, and ask:

> Is there an item that was **not** in the slice, that would have **materially
> improved** the answer, and that is reachable from a slice item by a
> **namable typed relation** rather than by similarity?

The rate is the ceiling on everything downstream. If it is near zero, the
whole idea is dead for the cost of one labeling pass, and the correct outcome
is to keep the relations as a record and stop.

Two things it yields beyond the number:

- **Which relation types actually fire.** The expectation is that
  `supersedes` earns its keep and `contradicts` fires rarely but decisively.
  If the data disagrees, that is worth more than the ceiling itself, because
  it scopes the producer.
- **The beginnings of a gold set.** Every "yes" is a labeled case Gate 2 can
  reuse.

**The precondition, and why this document is deferred:** the sample must be
drawn from real usage, across varied sessions and topics. Too few turns and
the ceiling estimate is noise wearing a decimal point. This is the thing to
wait for.

### Gate 1 — the producer, with a free head start

Wrong edges are the primary risk, so measure extraction precision before
building anything that consumes it.

**There is a natural experiment available today, at zero build cost.** The
dev-memory ledger already holds agent-written typed edges — `relates`,
`supersedes`, `blocks`, `covers`, `derived_from` — validated on write and
produced organically by real sessions. Hand-check a sample. That tells us
whether machine-extracted typed relations are trustworthy *in our stack, from
our agents*, before a companion-side producer exists.

It is not a perfect proxy: different system, different scope, different
prompt. But it is evidence we already own, and it is the cheapest available
signal on the risk that actually decides this.

### Gate 2 — contribution, and the trap that would make the test lie

**At a fixed slice budget, adding a lane is a substitution, not an addition.**
Traversal hits evict something. Two arms cannot distinguish "the lane is
useless" from "the lane is good and what it evicted was better," so run three:

- **A** — baseline, as shipped.
- **B** — baseline + traversal, **same** total budget. This is the real
  candidate configuration; its wins and losses are both genuine.
- **C** — baseline + traversal, **expanded** budget. Pure addition. Isolates
  the lane's own contribution from the cost of eviction.

Controls that must be fixed rather than explored:

- **Fusion is tier-beneath-seed, not peer.** A neighbour surfaced *because*
  its seed ranked is not independent evidence; fusing it as an RRF peer counts
  one signal twice, hardest exactly where the seeding lane was most confident.
  Testing peer fusion at the same time confounds the lane with the fusion
  strategy. If tier-fusion wins, peer fusion becomes a separate later arm.
- **Scope re-imposed on the neighbour's own row**, after traversal and before
  fusion. Never inherited from the seed.
- **Reachable set, not path enumeration.** Set expansion dedups per level;
  path enumeration multiplies by degree per level.

Metrics, each carrying its predicate (metric, k, gold-set version, snapshot,
configuration):

- **Unique-contribution rate** — share of slices where traversal supplies an
  item absent from the union of the other lanes' candidate pools. This is the
  cheap kill-switch: it needs no labels, and if it is near zero nothing
  downstream can rescue the lane.
- **Paired recall@k on the edge-reachable stratum** — the stratum where the
  hypothesis lives. A global average over generic queries will dilute a real
  effect into noise, because most queries have no relevant edge.
- **Precision damage on a should-be-empty stratum** — an expansion lane's
  characteristic failure is adding confident noise, not missing recall. Without
  this stratum the evaluation structurally rewards never returning empty.
- **Eviction ledger** — for arm B, what left the slice and whether it mattered.

**A self-labeling stratum, cheaply:** if A supersedes B, a query that retrieves
B *should* surface A. That stratum can be generated straight from the edge
table, and it measures the **baseline's blind spot** honestly with no hand
labeling. Do not over-claim from it — it demonstrates reachability, not answer
quality.

### Gate 3 — answer quality, only where the slice changed

Retrieval metrics are a proxy; the companion's real outcome is the answer.
Judge end-to-end quality **only on the turns whose slice actually differed**.
If 8% of turns change, 8% get judged — the rest carry no signal and would only
add cost and variance.

## Threats to validity, named in advance

- **Underpowered sample.** The reason this is deferred. A ceiling computed
  over a handful of turns is not a ceiling.
- **Judge bias toward the novel item.** A judge shown a "missed" candidate
  tends to find it relevant. Blind the arms; present items without their lane
  provenance.
- **Gold-set decay.** Relevance judgments are claims about a corpus state.
  Version them with the snapshot they were made over, or they will keep
  producing numbers after they stop being true.
- **Proxy drift in Gate 1.** Dev-ledger edge quality is evidence about our
  agents, not a guarantee about a companion-side producer.
- **Thresholds chosen after the fact.** The defense against the assumption
  this whole plan exists to prevent: **write the kill numbers down before
  running the gate.** A threshold set after seeing results is not a threshold.

## Harness note

`evals/` is vitest/TypeScript; retrieval is Rust. Gates 2 and 3 need a Rust
replay harness running both configurations over a frozen snapshot database, or
the evaluation work will quietly not happen. Gates 0 and 1 need no harness at
all — which is another reason they come first.

## Revisit trigger

Enough real companion usage to draw a varied turn sample for Gate 0. When that
arrives, run Gate 0 and nothing else, and let its number decide whether any of
the rest is worth building.
