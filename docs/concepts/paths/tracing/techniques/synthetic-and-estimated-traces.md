---
layer: technique
subject: tracing
technique: synthetic-and-estimated-traces
status: forged
laws: [derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Synthetic and estimated traces

Instrumentation always arrives after history. There are runs that finished
before spans existed, producers that report only totals, boundaries that
strip timing detail — and the structural view is too useful to withhold from
all of them. So products **reconstruct**: they synthesize a plausible span
tree from whatever settled evidence survived — start/end stamps, ordered
event logs, reported totals, known pipeline shape. Reconstruction is
legitimate. What this technique polices is the line between reconstruction
and counterfeit: **an estimated value must be impossible to mistake for a
measured one, at every zoom level, in every export, inside every aggregate.**

The stakes are asymmetric. A missing trace sends the investigator to other
evidence; a *fabricated-but-plausible* trace sends them to a confident wrong
conclusion — the worst outcome an observability surface can produce.

## The reconstruction hierarchy

Synthetic spans are built from evidence of descending strength, and each
span records which tier produced it:

1. **Anchored**: both endpoints exist in the surviving record (the run's own
   start/end stamps, a logged event pair). Structure and duration are real;
   only spanhood is retroactive.
2. **Interpolated**: one endpoint or only an ordering survives; the other
   endpoint is inferred from neighbors ("stage two began when stage one's
   completion was logged").
3. **Apportioned**: only a total survives (one cost figure, one duration for
   the whole run), distributed across known parts by a stated rule —
   proportional to counts, to typical shares, or evenly.
4. **Typical-shaped**: nothing per-run survives; the tree is the pipeline's
   *known shape* with durations from population statistics. This tier is a
   diagram of what usually happens, not a record of this run — useful for
   orientation, and it must say exactly that.

The tier ladder is also the improvement path: every producer upgrade should
move spans up a tier, and the labeling (below) is what makes the remaining
debt visible enough to schedule.

## The reconstruction is a named, versioned derivation

A synthetic trace is a **stored derivation**, and it names its recomputation
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
which inputs it was derived from, by which rule, at which version of that
rule. Consequences, each load-bearing:

- **Regenerable**: when the rule improves, old synthetic traces can be
  re-derived rather than living forever as fossils of the worst-ever
  heuristic.
- **Attributable**: a reader who doubts a synthetic span can walk to the
  evidence it came from — the derivation is an argument, not an oracle.
- **Never re-ingested**: a synthetic trace must never be mistaken for
  capture input and re-stored as measurement — derivation output feeding
  back in as ground truth is how estimates launder themselves into facts.

## Labeling: at the datum, not the page

The marking lives **on each estimated value**, because values travel and
banners do not. A page-level "some data estimated" disclaimer detaches the
moment a span is exported, screenshotted, aggregated, or quoted. Required:

- **On the span**: an estimate flag plus its tier, rendered in the waterfall
  as a visibly distinct bar treatment (and distinguishable without color),
  restated in the span's detail view with the derivation.
- **On every aggregate that ingests any estimate**: a fold over mixed spans
  either excludes estimates (stating "measured spans only: N of M") or
  includes them and labels the result estimated — silent mixing is the
  primary laundering path, since aggregates strip provenance by default. A
  number that travels carries what was counted and how
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)).
- **In precision**: an estimated duration rendered to the millisecond wears
  a measurement's costume. Round estimates to the precision the evidence
  supports; the coarseness *is* the honest signal.

## Mixed traces are the steady state, not the transition

Real traces settle into part-measured, part-estimated: instrumented stages
measured, an opaque external call apportioned, a legacy stage typical-shaped.
This is fine — the value of structure does not require uniform provenance —
provided every rule above is applied per-span, and per-subtree rollups state
the mix ("subtree duration: measured 82%, estimated 18%"). What is not fine
is graduating a whole trace to "measured" because *most* of it is.

## Retirement, or honest coexistence

When real instrumentation reaches a formerly-synthetic region, the synthetic
generator for that region is **retired or explicitly demoted to fallback** —
never left running as a parallel producer. Two producers emitting the same
region, one measuring and one guessing, will eventually disagree, and a
viewer picking between them nondeterministically is a coin-flip oracle. The
selection rule is fixed and stated: measurement always wins when present;
synthesis fills only where measurement is absent, and says so.
